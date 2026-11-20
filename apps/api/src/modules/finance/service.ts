import { and, asc, desc, eq, gte, inArray, isNull, lte, notInArray, or, sql } from 'drizzle-orm';
import {
  addDays,
  addMonths,
  CATEGORY_GROUPS,
  daysBetween,
  daysInMonth,
  endOfMonth,
  EXPENSE_GROUPS,
  LIQUID_TYPES,
  monthKey,
  ratioToBasisPoints,
  startOfMonth,
  type BudgetGroupDTO,
  type BudgetLineDTO,
  type BudgetMonthDTO,
  type CategoryGroup,
  type Frequency,
  type GoalDTO,
  type NetWorthPointDTO,
  type RecurringDTO,
  type Scope,
  type UpcomingBillDTO,
} from '@synerpulse/shared';
import type { Executor } from '../../db/client';
import { accounts, budgetItems, budgetPlans, categories, goals, recurringItems, transactions } from '../../db/schema';
import { accountVisibility } from '../accounts/service';
import { goalMath } from './goals';
import { monthlyEquivalent, occurrences } from './recurrence';

export const WARNING_BP = 8000;

/** Sum of expense (positive cents) per category for visible accounts in [from, to]. */
export async function spendByCategory(
  exec: Executor,
  householdId: string,
  userId: string,
  scope: Scope,
  from: string,
  to: string,
  type: 'expense' | 'income' = 'expense',
): Promise<Map<string | null, number>> {
  const rows = await exec
    .select({ categoryId: transactions.categoryId, total: sql<number>`sum(${transactions.amountCents})::bigint` })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(transactions.deletedAt),
        eq(transactions.type, type),
        gte(transactions.date, from),
        lte(transactions.date, to),
        accountVisibility(householdId, userId, scope),
      ),
    )
    .groupBy(transactions.categoryId);
  const out = new Map<string | null, number>();
  for (const r of rows) out.set(r.categoryId, Math.abs(Number(r.total)));
  return out;
}

export async function periodTotals(exec: Executor, householdId: string, userId: string, scope: Scope, from: string, to: string) {
  const [row] = await exec
    .select({
      income: sql<number>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amountCents} else 0 end), 0)::bigint`,
      spend: sql<number>`coalesce(sum(case when ${transactions.type} = 'expense' then -${transactions.amountCents} else 0 end), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(transactions.deletedAt),
        gte(transactions.date, from),
        lte(transactions.date, to),
        accountVisibility(householdId, userId, scope),
      ),
    );
  return { incomeCents: Number(row?.income ?? 0), spendCents: Number(row?.spend ?? 0), count: row?.count ?? 0 };
}

/** The plan in effect for a month: the latest plan whose start month ≤ month. */
export async function planForMonth(exec: Executor, householdId: string, month: string) {
  const [plan] = await exec
    .select()
    .from(budgetPlans)
    .where(and(eq(budgetPlans.householdId, householdId), lte(budgetPlans.month, month)))
    .orderBy(desc(budgetPlans.month))
    .limit(1);
  if (!plan) return null;
  const items = await exec.select().from(budgetItems).where(eq(budgetItems.planId, plan.id));
  return { plan, items };
}

export async function budgetMonth(exec: Executor, householdId: string, userId: string, month: string, today: string): Promise<BudgetMonthDTO> {
  const from = `${month}-01`;
  const to = endOfMonth(from);
  const [cats, planned, spent, income, bills] = await Promise.all([
    exec.select().from(categories).where(eq(categories.householdId, householdId)).orderBy(asc(categories.name)),
    planForMonth(exec, householdId, month),
    spendByCategory(exec, householdId, userId, 'household', from, to, 'expense'),
    spendByCategory(exec, householdId, userId, 'household', from, to, 'income'),
    exec
      .select({ categoryId: recurringItems.categoryId })
      .from(recurringItems)
      .where(and(eq(recurringItems.householdId, householdId), eq(recurringItems.kind, 'bill'), eq(recurringItems.active, true))),
  ]);
  const budgetOf = new Map(planned?.items.map((i) => [i.categoryId, Number(i.amountCents)]) ?? []);
  // Categories paid by scheduled bills (rent, daycare…) reach 100% in one payment; that is "on plan", not a warning.
  const billCategories = new Set(bills.map((b) => b.categoryId).filter(Boolean));
  const groups: BudgetGroupDTO[] = [];
  for (const group of EXPENSE_GROUPS) {
    const lines: BudgetLineDTO[] = [];
    for (const c of cats.filter((x) => x.group === group)) {
      const budget = budgetOf.get(c.id) ?? 0;
      const sp = spent.get(c.id) ?? 0;
      if (c.archivedAt && budget === 0 && sp === 0) continue;
      const usedBp = budget > 0 ? ratioToBasisPoints(sp, budget) : 0;
      const billCovered = billCategories.has(c.id);
      lines.push({
        categoryId: c.id,
        categoryName: c.name,
        group,
        color: c.color,
        budgetCents: budget,
        spentCents: sp,
        remainingCents: budget - sp,
        usedBp,
        billCovered,
        status:
          budget === 0 ? (sp > 0 ? 'unbudgeted' : 'ok') : usedBp > 10_000 ? 'over' : usedBp >= WARNING_BP && !billCovered ? 'warning' : 'ok',
      });
    }
    const b = lines.reduce((s, l) => s + l.budgetCents, 0);
    const sp = lines.reduce((s, l) => s + l.spentCents, 0);
    groups.push({ group, budgetCents: b, spentCents: sp, usedBp: b > 0 ? ratioToBasisPoints(sp, b) : 0, lines });
  }
  // Uncategorised spending still counts toward the month total.
  const uncategorised = spent.get(null) ?? 0;
  const totalBudget = groups.reduce((s, g) => s + g.budgetCents, 0);
  const totalSpent = groups.reduce((s, g) => s + g.spentCents, 0) + uncategorised;
  const dim = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
  const elapsedDays = today < from ? 0 : today > to ? dim : Number(today.slice(8, 10));
  return {
    month,
    planMonth: planned?.plan.month ?? null,
    expectedIncomeCents: Number(planned?.plan.expectedIncomeCents ?? 0),
    actualIncomeCents: [...income.values()].reduce((a, b) => a + b, 0),
    totalBudgetCents: totalBudget,
    totalSpentCents: totalSpent,
    monthElapsedBp: ratioToBasisPoints(elapsedDays, dim),
    groups,
  };
}

export async function listGoals(exec: Executor, householdId: string, today: string, includeArchived = false): Promise<GoalDTO[]> {
  const rows = await exec
    .select({
      g: goals,
      saved: sql<number>`coalesce((select sum(gc.amount_cents) from goal_contributions gc where gc.goal_id = "goals"."id"), 0)::bigint`,
    })
    .from(goals)
    .where(and(eq(goals.householdId, householdId), includeArchived ? undefined : isNull(goals.archivedAt)))
    .orderBy(asc(goals.createdAt));
  return rows.map(({ g, saved }) => {
    const savedCents = Number(saved);
    const m = goalMath({ targetCents: Number(g.targetCents), savedCents, targetDate: g.targetDate, plannedMonthlyCents: Number(g.plannedMonthlyCents) }, today);
    return {
      id: g.id,
      name: g.name,
      icon: g.icon,
      targetCents: Number(g.targetCents),
      savedCents,
      targetDate: g.targetDate,
      plannedMonthlyCents: Number(g.plannedMonthlyCents),
      progressBp: m.progressBp,
      requiredMonthlyCents: m.requiredMonthlyCents,
      projectedCompletion: m.projectedCompletion,
      onTrack: m.onTrack,
      archived: Boolean(g.archivedAt),
    };
  });
}

/** Recurring items the caller may see (items tied to someone's private account stay private). */
export async function listRecurring(exec: Executor, householdId: string, userId: string, opts: { scope?: Scope; activeOnly?: boolean } = {}) {
  const rows = await exec
    .select({ r: recurringItems, accountName: accounts.name, accountVisibility: accounts.visibility, accountOwner: accounts.ownerUserId, categoryName: categories.name })
    .from(recurringItems)
    .leftJoin(accounts, eq(accounts.id, recurringItems.accountId))
    .leftJoin(categories, eq(categories.id, recurringItems.categoryId))
    .where(
      and(
        eq(recurringItems.householdId, householdId),
        opts.activeOnly ? eq(recurringItems.active, true) : undefined,
        opts.scope === 'personal'
          ? and(eq(accounts.visibility, 'private'), eq(accounts.ownerUserId, userId))
          : opts.scope === 'household'
            ? or(isNull(recurringItems.accountId), eq(accounts.visibility, 'shared'))
            : or(isNull(recurringItems.accountId), eq(accounts.visibility, 'shared'), eq(accounts.ownerUserId, userId)),
      ),
    )
    .orderBy(asc(recurringItems.nextDate));
  return rows.map(({ r, accountName, categoryName }) => toRecurringDTO(r, accountName, categoryName));
}

export function toRecurringDTO(r: typeof recurringItems.$inferSelect, accountName: string | null, categoryName: string | null): RecurringDTO {
  return {
    id: r.id,
    kind: r.kind,
    label: r.label,
    amountCents: Number(r.amountCents),
    minAmountCents: r.minAmountCents == null ? null : Number(r.minAmountCents),
    frequency: r.frequency as Frequency,
    nextDate: r.nextDate,
    endDate: r.endDate,
    accountId: r.accountId,
    accountName,
    categoryId: r.categoryId,
    categoryName,
    autopay: r.autopay,
    active: r.active,
    monthlyEquivalentCents: monthlyEquivalent(Number(r.amountCents), r.frequency as Frequency),
  };
}

/** scope undefined = everything the user can see (shared + their private items). */
export async function upcomingBills(exec: Executor, householdId: string, userId: string, today: string, days: number, scope?: Scope): Promise<UpcomingBillDTO[]> {
  const items = (await listRecurring(exec, householdId, userId, { scope, activeOnly: true })).filter((r) => r.kind === 'bill');
  const until = addDays(today, days);
  const out: UpcomingBillDTO[] = [];
  for (const r of items) {
    // Overdue (nextDate in the past, not yet marked paid) is surfaced too.
    const start = r.nextDate < today ? r.nextDate : today;
    for (const d of occurrences({ frequency: r.frequency, nextDate: r.nextDate, endDate: r.endDate }, start, until, 60)) {
      out.push({ recurringId: r.id, label: r.label, amountCents: r.amountCents, dueDate: d, daysUntil: daysBetween(today, d), autopay: r.autopay, categoryName: r.categoryName });
    }
  }
  return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

/**
 * Typical monthly everyday spending: the average of up to three most recent *complete* months of
 * expenses, excluding entries created from recurring bills and categories already modelled as bills
 * (so the forecast does not count rent twice). Falls back to the budget, then to zero.
 */
export async function everydayBaseline(
  exec: Executor,
  householdId: string,
  userId: string,
  scope: Scope,
  today: string,
  billCategoryIds: string[],
): Promise<{ byCategory: { categoryId: string | null; monthlyCents: number }[]; basis: string }> {
  const thisMonthStart = startOfMonth(today);
  const earliestTxn = await exec
    .select({ d: sql<string | null>`min(${transactions.date})::text` })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(eq(transactions.householdId, householdId), isNull(transactions.deletedAt), accountVisibility(householdId, userId, scope)));
  const first = earliestTxn[0]?.d ?? null;
  let months = 0;
  if (first) {
    for (let i = 1; i <= 3; i++) {
      if (addMonths(thisMonthStart, -i) >= startOfMonth(first)) months = i;
    }
  }
  if (months > 0) {
    const from = addMonths(thisMonthStart, -months);
    const to = addDays(thisMonthStart, -1);
    const rows = await exec
      .select({ categoryId: transactions.categoryId, total: sql<number>`sum(-${transactions.amountCents})::bigint` })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(
        and(
          eq(transactions.householdId, householdId),
          isNull(transactions.deletedAt),
          eq(transactions.type, 'expense'),
          isNull(transactions.recurringId),
          gte(transactions.date, from),
          lte(transactions.date, to),
          accountVisibility(householdId, userId, scope),
          billCategoryIds.length ? or(isNull(transactions.categoryId), notInArray(transactions.categoryId, billCategoryIds)) : undefined,
        ),
      )
      .groupBy(transactions.categoryId);
    const byCategory = rows.map((r) => ({ categoryId: r.categoryId, monthlyCents: Math.round(Number(r.total) / months) }));
    return {
      byCategory,
      basis: `Average of your last ${months} complete month${months > 1 ? 's' : ''} of everyday spending (${monthKey(from)} to ${monthKey(to)}), excluding bills already listed as recurring.`,
    };
  }
  if (scope === 'household') {
    const plan = await planForMonth(exec, householdId, monthKey(today));
    if (plan) {
      const cats = await exec.select({ id: categories.id, group: categories.group }).from(categories).where(eq(categories.householdId, householdId));
      const expenseCats = new Set(cats.filter((c) => c.group !== 'income').map((c) => c.id));
      const byCategory = plan.items
        .filter((i) => expenseCats.has(i.categoryId) && !billCategoryIds.includes(i.categoryId))
        .map((i) => ({ categoryId: i.categoryId, monthlyCents: Number(i.amountCents) }));
      return { byCategory, basis: 'Your monthly budget (there is not yet a full month of history), excluding categories covered by recurring bills.' };
    }
  }
  return { byCategory: [], basis: 'No spending history or budget yet — add transactions or set a budget to improve the forecast.' };
}

export async function liquidAccounts(exec: Executor, householdId: string, userId: string, scope: Scope) {
  const rows = await exec
    .select({
      id: accounts.id,
      name: accounts.name,
      balance: sql<number>`(${accounts.openingBalanceCents} + coalesce((select sum(t.amount_cents) from transactions t where t.account_id = "accounts"."id" and t.deleted_at is null), 0))::bigint`,
    })
    .from(accounts)
    .where(and(accountVisibility(householdId, userId, scope), isNull(accounts.archivedAt), inArray(accounts.type, LIQUID_TYPES)));
  return rows.map((r) => ({ id: r.id, name: r.name, balanceCents: Number(r.balance) }));
}

/**
 * Net worth at each sample date = Σ over visible accounts opened by that date of
 * (opening balance + transactions dated on/before it). Liabilities carry negative balances.
 */
export async function netWorthHistory(exec: Executor, householdId: string, userId: string, scope: Scope, dates: string[]): Promise<NetWorthPointDTO[]> {
  const accts = await exec
    .select({ id: accounts.id, type: accounts.type, opening: accounts.openingBalanceCents, openingDate: accounts.openingDate })
    .from(accounts)
    .where(and(accountVisibility(householdId, userId, scope), isNull(accounts.archivedAt)));
  if (!accts.length) return dates.map((date) => ({ date, assetsCents: 0, liabilitiesCents: 0, netWorthCents: 0 }));
  const ids = accts.map((a) => a.id);
  // Daily net movement per account; cumulative sums are computed in memory (small: accounts × days with activity).
  const moves = await exec
    .select({ accountId: transactions.accountId, date: transactions.date, sum: sql<number>`sum(${transactions.amountCents})::bigint` })
    .from(transactions)
    .where(and(inArray(transactions.accountId, ids), isNull(transactions.deletedAt), lte(transactions.date, dates[dates.length - 1])))
    .groupBy(transactions.accountId, transactions.date)
    .orderBy(asc(transactions.date));
  const sorted = [...dates].sort();
  const out: NetWorthPointDTO[] = [];
  for (const date of sorted) {
    let assets = 0;
    let liabilities = 0;
    for (const a of accts) {
      if (a.openingDate > date) continue;
      let bal = Number(a.opening);
      for (const m of moves) if (m.accountId === a.id && m.date <= date) bal += Number(m.sum);
      // Classified by sign: debts (and overdrawn accounts) are liabilities, everything else assets.
      if (bal < 0) liabilities += -bal;
      else assets += bal;
    }
    out.push({ date, assetsCents: assets, liabilitiesCents: liabilities, netWorthCents: assets - liabilities });
  }
  return out;
}

export function isExpenseGroup(g: string): g is CategoryGroup {
  return (CATEGORY_GROUPS as readonly string[]).includes(g) && g !== 'income';
}
