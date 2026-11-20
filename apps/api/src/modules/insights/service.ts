/**
 * Smart Tips — the prototype's "Smart Tips" panel, implemented as transparent, rule-based
 * heuristics (not machine learning; see paper §4.2). Each tip carries a `basis` string that
 * explains exactly how it was derived.
 */
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import {
  addDays,
  addMonths,
  formatCents,
  monthKey,
  startOfMonth,
  type BudgetMonthDTO,
  type ForecastResultDTO,
  type GoalDTO,
  type RecurringDTO,
  type Scope,
  type SmartTipDTO,
} from '@synerpulse/shared';
import type { Executor } from '../../db/client';
import { accounts, categories, transactions } from '../../db/schema';
import { accountVisibility } from '../accounts/service';

const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function budgetTips(b: BudgetMonthDTO, currency: string): SmartTipDTO[] {
  const tips: SmartTipDTO[] = [];
  const daysLeftPct = 100 - Math.round(b.monthElapsedBp / 100);
  for (const g of b.groups) {
    for (const l of g.lines) {
      if (l.status === 'over') {
        tips.push({
          id: `over:${l.categoryId}`,
          kind: 'over_limit',
          severity: 'critical',
          title: `${l.categoryName} is over budget`,
          detail: `${formatCents(-l.remainingCents, currency)} over this month. Consider moving money from another category or adjusting the plan.`,
          basis: `${formatCents(l.spentCents, currency)} spent vs a ${formatCents(l.budgetCents, currency)} budget.`,
          link: '/budget',
        });
      } else if (l.status === 'warning') {
        tips.push({
          id: `near:${l.categoryId}`,
          kind: 'near_limit',
          severity: 'warning',
          title: `You're close to your limit in ${l.categoryName.toLowerCase()}`,
          detail: `${formatCents(l.remainingCents, currency)} left with about ${daysLeftPct}% of the month to go. Consider revising.`,
          basis: `${Math.floor(l.usedBp / 100)}% of the ${formatCents(l.budgetCents, currency)} budget used; tips appear at 80%.`,
          link: '/budget',
        });
      }
    }
  }
  return tips;
}

/** Category spending this month running well ahead of its recent average ("Dining-out spending is higher than usual"). */
export async function aboveUsualTips(exec: Executor, householdId: string, userId: string, scope: Scope, today: string, monthElapsedBp: number, currency: string): Promise<SmartTipDTO[]> {
  if (monthElapsedBp < 2500) return []; // too early in the month to judge
  const thisStart = startOfMonth(today);
  const histStart = addMonths(thisStart, -3);
  const rows = await exec
    .select({
      categoryId: transactions.categoryId,
      name: categories.name,
      current: sql<number>`coalesce(sum(case when ${transactions.date} >= ${thisStart} then -${transactions.amountCents} else 0 end), 0)::bigint`,
      history: sql<number>`coalesce(sum(case when ${transactions.date} < ${thisStart} then -${transactions.amountCents} else 0 end), 0)::bigint`,
      histMonths: sql<number>`count(distinct case when ${transactions.date} < ${thisStart} then to_char(${transactions.date}, 'YYYY-MM') end)::int`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(transactions.deletedAt),
        eq(transactions.type, 'expense'),
        isNull(transactions.recurringId),
        gte(transactions.date, histStart),
        lte(transactions.date, today),
        accountVisibility(householdId, userId, scope),
      ),
    )
    .groupBy(transactions.categoryId, categories.name);
  const tips: SmartTipDTO[] = [];
  for (const r of rows) {
    if (r.histMonths < 2) continue;
    const avg = Number(r.history) / 3;
    const expectedSoFar = (avg * monthElapsedBp) / 10_000;
    const current = Number(r.current);
    if (expectedSoFar <= 0) continue;
    if (current >= expectedSoFar * 1.3 && current - expectedSoFar >= 4000) {
      tips.push({
        id: `usual:${r.categoryId}`,
        kind: 'above_usual',
        severity: 'info',
        title: `${r.name} spending is higher than usual`,
        detail: `You've spent ${formatCents(current, currency)} so far this month. Consider a cutback for the rest of the month.`,
        basis: `By this point in a typical month you'd have spent about ${formatCents(Math.round(expectedSoFar), currency)} (3-month average ${formatCents(Math.round(avg), currency)}/month).`,
        link: `/ledger?categoryId=${r.categoryId}`,
      });
    }
  }
  return tips.slice(0, 3);
}

/** Same merchant charged in 3+ of the last 4 months at a steady amount, not yet tracked as a bill. */
export async function recurringChargeTips(exec: Executor, householdId: string, userId: string, scope: Scope, today: string, tracked: RecurringDTO[], currency: string): Promise<SmartTipDTO[]> {
  const from = addMonths(startOfMonth(today), -3);
  const nameExpr = sql<string>`lower(coalesce(nullif(${transactions.merchant}, ''), ${transactions.description}))`;
  const rows = await exec
    .select({
      name: nameExpr,
      display: sql<string>`min(coalesce(nullif(${transactions.merchant}, ''), ${transactions.description}))`,
      months: sql<number>`count(distinct to_char(${transactions.date}, 'YYYY-MM'))::int`,
      avg: sql<number>`avg(-${transactions.amountCents})::bigint`,
      minAmt: sql<number>`min(-${transactions.amountCents})::bigint`,
      maxAmt: sql<number>`max(-${transactions.amountCents})::bigint`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(transactions.deletedAt),
        eq(transactions.type, 'expense'),
        isNull(transactions.recurringId),
        gte(transactions.date, from),
        lte(transactions.date, today),
        accountVisibility(householdId, userId, scope),
      ),
    )
    .groupBy(nameExpr)
    .having(sql`count(distinct to_char(${transactions.date}, 'YYYY-MM')) >= 3`);
  const trackedNames = tracked.map((t) => t.label.toLowerCase());
  const tips: SmartTipDTO[] = [];
  for (const r of rows) {
    const avg = Number(r.avg);
    if (avg <= 0 || Number(r.maxAmt) - Number(r.minAmt) > avg * 0.15) continue; // amounts vary too much to be a subscription
    if (trackedNames.some((t) => t.includes(r.name) || r.name.includes(t))) continue;
    tips.push({
      id: `recurring:${r.name}`,
      kind: 'recurring_charge',
      severity: 'info',
      title: `You have recurring charges for “${r.display}”`,
      detail: `About ${formatCents(avg, currency)} a month. Would you like to review it, or track it as a bill so the forecast includes it?`,
      basis: `Charged in ${r.months} of the last 4 months at a steady amount (${formatCents(Number(r.minAmt), currency)}–${formatCents(Number(r.maxAmt), currency)}).`,
      link: `/ledger?q=${encodeURIComponent(r.display)}`,
    });
  }
  return tips.slice(0, 3);
}

export function forecastTips(f: ForecastResultDTO, currency: string): SmartTipDTO[] {
  const s = f.baseline;
  if (s.firstDeficitDate) {
    return [
      {
        id: 'deficit',
        kind: 'deficit_ahead',
        severity: 'critical',
        title: `Cash could run short around ${fmtDate(s.firstDeficitDate)}`,
        detail: `Projected low of ${formatCents(s.lowestBalanceCents, currency)} on ${fmtDate(s.lowestBalanceDate)}. Try a scenario in the planner to see what fixes it.`,
        basis: `Day-by-day projection from today's liquid balance (${formatCents(s.startBalanceCents, currency)}), your recurring income and bills, and typical everyday spending.`,
        link: '/planner',
      },
    ];
  }
  if (s.firstBelowBufferDate && f.safetyBufferCents > 0) {
    return [
      {
        id: 'buffer',
        kind: 'deficit_ahead',
        severity: 'warning',
        title: `Balance dips below your safety buffer around ${fmtDate(s.firstBelowBufferDate)}`,
        detail: `Lowest projected balance is ${formatCents(s.lowestBalanceCents, currency)}.`,
        basis: `Your safety buffer is ${formatCents(f.safetyBufferCents, currency)} (Settings → Notifications).`,
        link: '/planner',
      },
    ];
  }
  return [];
}

export function goalTips(goals: GoalDTO[], currency: string): SmartTipDTO[] {
  return goals
    .filter((g) => g.onTrack === false && g.requiredMonthlyCents)
    .slice(0, 2)
    .map((g) => ({
      id: `goal:${g.id}`,
      kind: 'goal_behind' as const,
      severity: 'warning' as const,
      title: `${g.name} needs ${formatCents(g.requiredMonthlyCents!, currency, { noCents: true })}/month to stay on schedule`,
      detail: `You're planning ${formatCents(g.plannedMonthlyCents, currency, { noCents: true })}/month. Raise the contribution or move the target date.`,
      basis: `${formatCents(g.targetCents - g.savedCents, currency)} remaining ÷ months until ${g.targetDate}.`,
      link: '/budget#goals',
    }));
}

export async function uncategorizedTip(exec: Executor, householdId: string, userId: string, scope: Scope, today: string): Promise<SmartTipDTO[]> {
  const [row] = await exec
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(transactions.deletedAt),
        isNull(transactions.categoryId),
        sql`${transactions.type} in ('expense','income')`,
        gte(transactions.date, addDays(today, -45)),
        accountVisibility(householdId, userId, scope),
      ),
    );
  if (!row?.count) return [];
  return [
    {
      id: 'uncategorized',
      kind: 'uncategorized',
      severity: 'info',
      title: `${row.count} recent ${row.count === 1 ? 'entry needs' : 'entries need'} a category`,
      detail: 'Categorised entries make budgets, tips and forecasts more accurate. A rule can do it automatically next time.',
      basis: `Entries from the last 45 days without a category (${monthKey(today)}).`,
      link: '/ledger?categoryId=uncategorized',
    },
  ];
}
