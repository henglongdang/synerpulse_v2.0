import { Router } from 'express';
import { and, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ACCOUNT_TYPE_LABELS,
  addDays,
  addMonths,
  monthKey,
  ratioToBasisPoints,
  SCOPES,
  todayISO,
  type AccountType,
  type ActivityDTO,
  type DashboardDTO,
  type SmartTipDTO,
} from '@familypulse/shared';
import { accounts, activityEvents, categories, transactions, users } from '../../db/schema';
import { db } from '../../lib/deps';
import { parse } from '../../lib/errors';
import { currentHousehold, currentUser } from '../../lib/http';
import { accountVisibility, listAccounts } from '../accounts/service';
import { budgetMonth, listGoals, listRecurring, netWorthHistory, periodTotals, upcomingBills } from '../finance/service';
import { runForecast } from '../forecast/service';
import { aboveUsualTips, budgetTips, forecastTips, goalTips, recurringChargeTips, uncategorizedTip } from '../insights/service';
import { sweepHousehold } from '../alerts/service';

export const dashboardRouter = Router({ mergeParams: true });

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;

/** Most severe first, but at most two tips of any one kind so a single issue cannot crowd out the rest. */
function rankTips(tips: SmartTipDTO[], limit: number): SmartTipDTO[] {
  const perKind = new Map<string, number>();
  return [...tips]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .filter((t) => {
      const n = (perKind.get(t.kind) ?? 0) + 1;
      perKind.set(t.kind, n);
      return n <= 2;
    })
    .slice(0, limit);
}

function sampleDates(today: string, range: '1M' | '6M' | '1Y' | 'ALL', earliest: string | null): string[] {
  const dates: string[] = [];
  if (range === '1M') {
    for (let i = 30; i >= 0; i -= 2) dates.push(addDays(today, -i));
  } else if (range === '6M') {
    for (let i = 26; i >= 0; i--) dates.push(addDays(today, -i * 7));
  } else {
    const months = range === '1Y' ? 12 : Math.min(120, Math.max(12, earliest ? (Number(today.slice(0, 4)) - Number(earliest.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(earliest.slice(5, 7)) + 1 : 12));
    for (let i = months; i >= 1; i--) dates.push(addDays(addMonths(`${monthKey(today)}-01`, -i + 1), -1));
    dates.push(today);
  }
  return [...new Set(dates)];
}

dashboardRouter.get('/dashboard', async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const q = parse(z.object({ scope: z.enum(SCOPES).default('household'), range: z.enum(['1M', '6M', '1Y', 'ALL']).default('6M') }), req.query);
  const today = todayISO();
  void sweepHousehold(h.id); // throttled background alert evaluation

  const [accts, firstAcct] = await Promise.all([
    listAccounts(db(), h.id, user.id, { scope: q.scope }),
    db()
      .select({ d: sql<string | null>`min(${accounts.openingDate})` })
      .from(accounts)
      .where(accountVisibility(h.id, user.id, q.scope)),
  ]);
  const [history, last7, prev7, monthTotals, budget, goals, recurring, bills, forecast, cardSpend] = await Promise.all([
    netWorthHistory(db(), h.id, user.id, q.scope, sampleDates(today, q.range, firstAcct[0]?.d ?? null)),
    periodTotals(db(), h.id, user.id, q.scope, addDays(today, -6), today),
    periodTotals(db(), h.id, user.id, q.scope, addDays(today, -13), addDays(today, -7)),
    periodTotals(db(), h.id, user.id, q.scope, `${monthKey(today)}-01`, today),
    budgetMonth(db(), h.id, user.id, monthKey(today), today),
    listGoals(db(), h.id, today),
    listRecurring(db(), h.id, user.id, { scope: q.scope, activeOnly: true }),
    upcomingBills(db(), h.id, user.id, today, 14, q.scope),
    runForecast(db(), h.id, user.id, { horizonMonths: 3, granularity: 'month', scope: q.scope, incomeMode: 'expected', adjustments: [] }, today),
    db()
      .select({ total: sql<number>`coalesce(sum(-${transactions.amountCents}), 0)::bigint`, count: sql<number>`count(*)::int` })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(
        and(
          eq(transactions.householdId, h.id),
          isNull(transactions.deletedAt),
          eq(transactions.type, 'expense'),
          eq(accounts.type, 'credit_card'),
          gte(transactions.date, addDays(today, -6)),
          accountVisibility(h.id, user.id, q.scope),
        ),
      ),
  ]);

  const nw30 = await netWorthHistory(db(), h.id, user.id, q.scope, [addDays(today, -30)]);
  const assets = accts.filter((a) => a.balanceCents >= 0).reduce((s, a) => s + a.balanceCents, 0);
  const liabilities = accts.filter((a) => a.balanceCents < 0).reduce((s, a) => s - a.balanceCents, 0);
  const sum = (types: AccountType[]) => accts.filter((a) => types.includes(a.type)).reduce((s, a) => s + a.balanceCents, 0);

  const groupsOrder: AccountType[] = ['checking', 'savings', 'cash', 'investment', 'other_asset', 'credit_card', 'loan'];
  const accountGroups = groupsOrder
    .map((type) => {
      const list = accts.filter((a) => a.type === type);
      return { type, label: ACCOUNT_TYPE_LABELS[type], totalCents: list.reduce((s, a) => s + a.balanceCents, 0), accounts: list };
    })
    .filter((g) => g.accounts.length);

  const cards = accts.filter((a) => a.type === 'credit_card');
  const owed = cards.reduce((s, a) => s + Math.max(0, -a.balanceCents), 0);
  const limit = cards.reduce((s, a) => s + (a.creditLimitCents ?? 0), 0);

  const tips: SmartTipDTO[] = [
    ...forecastTips(forecast, h.currency),
    ...(q.scope === 'household' ? budgetTips(budget, h.currency) : []),
    ...(await aboveUsualTips(db(), h.id, user.id, q.scope, today, budget.monthElapsedBp, h.currency)),
    ...(await recurringChargeTips(db(), h.id, user.id, q.scope, today, recurring, h.currency)),
    ...(q.scope === 'household' ? goalTips(goals, h.currency) : []),
    ...(await uncategorizedTip(db(), h.id, user.id, q.scope, today)),
  ];

  const activity = await db()
    .select({ e: activityEvents, actorName: users.name })
    .from(activityEvents)
    .leftJoin(users, eq(users.id, activityEvents.actorId))
    .where(and(eq(activityEvents.householdId, h.id), or(isNull(activityEvents.visibleToUserId), eq(activityEvents.visibleToUserId, user.id))))
    .orderBy(desc(activityEvents.createdAt))
    .limit(6);

  const overCount = budget.groups.flatMap((g) => g.lines).filter((l) => l.status === 'over').length;
  const body: DashboardDTO = {
    scope: q.scope,
    currency: h.currency,
    asOf: today,
    netWorth: { currentCents: assets - liabilities, assetsCents: assets, liabilitiesCents: liabilities, change30dCents: assets - liabilities - (nw30[0]?.netWorthCents ?? 0) },
    history,
    totals: {
      income: { last7: last7.incomeCents, prev7: prev7.incomeCents, month: monthTotals.incomeCents },
      spend: { last7: last7.spendCents, prev7: prev7.spendCents, month: monthTotals.spendCents },
      savingsCents: sum(['savings']),
      loansCents: sum(['loan']),
      investmentsCents: sum(['investment']),
    },
    accountGroups,
    budget: {
      month: budget.month,
      totalBudgetCents: budget.totalBudgetCents,
      totalSpentCents: budget.totalSpentCents,
      usedBp: budget.totalBudgetCents ? ratioToBasisPoints(budget.totalSpentCents, budget.totalBudgetCents) : 0,
      monthElapsedBp: budget.monthElapsedBp,
      overCount,
    },
    upcomingBills: bills.slice(0, 8),
    goals,
    forecast: {
      lowestBalanceCents: forecast.baseline.lowestBalanceCents,
      lowestBalanceDate: forecast.baseline.lowestBalanceDate,
      firstDeficitDate: forecast.baseline.firstDeficitDate,
      endBalanceCents: forecast.baseline.endBalanceCents,
      horizonMonths: 3,
    },
    tips: rankTips(tips, 6),
    recentActivity: activity.map(({ e, actorName }): ActivityDTO => ({
      id: e.id,
      actor: e.actorId ? { id: e.actorId, name: actorName ?? 'Former member' } : null,
      entityType: e.entityType,
      entityId: e.entityId,
      action: e.action,
      summary: e.summary,
      createdAt: e.createdAt.toISOString(),
    })),
    creditCards: {
      totalOwedCents: owed,
      totalLimitCents: limit,
      utilizationBp: limit > 0 ? ratioToBasisPoints(owed, limit) : null,
      spend7Cents: Number(cardSpend[0]?.total ?? 0),
      txnCount7: cardSpend[0]?.count ?? 0,
    },
  };
  res.json(body);
});

dashboardRouter.get('/insights', async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const today = todayISO();
  const [budget, goals, recurring, forecast] = await Promise.all([
    budgetMonth(db(), h.id, user.id, monthKey(today), today),
    listGoals(db(), h.id, today),
    listRecurring(db(), h.id, user.id, { scope: 'household', activeOnly: true }),
    runForecast(db(), h.id, user.id, { horizonMonths: 3, granularity: 'month', scope: 'household', incomeMode: 'expected', adjustments: [] }, today),
  ]);
  const tips = [
    ...forecastTips(forecast, h.currency),
    ...budgetTips(budget, h.currency),
    ...(await aboveUsualTips(db(), h.id, user.id, 'household', today, budget.monthElapsedBp, h.currency)),
    ...(await recurringChargeTips(db(), h.id, user.id, 'household', today, recurring, h.currency)),
    ...goalTips(goals, h.currency),
    ...(await uncategorizedTip(db(), h.id, user.id, 'household', today)),
  ];
  res.json({ tips: rankTips(tips, 20) });
});

dashboardRouter.get('/spending', async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const q = parse(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), scope: z.enum(SCOPES).default('household') }), req.query);
  const month = q.month ?? monthKey(todayISO());
  const from = `${month}-01`;
  const to = addDays(addMonths(from, 1), -1);
  const totalExpr = sql<number>`coalesce(sum(-${transactions.amountCents}), 0)::bigint`;
  const rows = await db()
    .select({
      categoryId: categories.id,
      name: categories.name,
      group: categories.group,
      color: categories.color,
      total: totalExpr,
      count: sql<number>`count(${transactions.id})::int`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.householdId, h.id),
        isNull(transactions.deletedAt),
        eq(transactions.type, 'expense'),
        gte(transactions.date, from),
        lte(transactions.date, to),
        accountVisibility(h.id, user.id, q.scope),
      ),
    )
    .groupBy(categories.id, categories.name, categories.group, categories.color)
    .orderBy(desc(totalExpr));
  const categoriesOut = rows.map((r) => ({
    categoryId: r.categoryId ?? null,
    name: r.name ?? 'Uncategorised',
    group: r.group ?? 'unexpected',
    color: r.color ?? '#8A9A91',
    totalCents: Number(r.total),
    count: r.count,
  }));
  const total = categoriesOut.reduce((s, c) => s + c.totalCents, 0);
  res.json({ month, totalCents: total, categories: categoriesOut });
});
