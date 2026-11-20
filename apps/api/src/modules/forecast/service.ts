import { eq } from 'drizzle-orm';
import { DEFAULT_NOTIFICATION_PREFS, type ForecastRequest, type ForecastResultDTO } from '@familypulse/shared';
import type { Executor } from '../../db/client';
import { recurringItems, users } from '../../db/schema';
import { everydayBaseline, listGoals, listRecurring, liquidAccounts } from '../finance/service';
import { simulate, type EngineInputs } from './engine';

export async function runForecast(
  exec: Executor,
  householdId: string,
  userId: string,
  req: ForecastRequest,
  /** The household's calendar date (see householdToday). */
  today: string,
): Promise<ForecastResultDTO> {
  const [liquid, recurring, goalList, [user]] = await Promise.all([
    liquidAccounts(exec, householdId, userId, req.scope),
    listRecurring(exec, householdId, userId, { scope: req.scope, activeOnly: true }),
    listGoals(exec, householdId, today),
    exec.select({ prefs: users.notificationPrefs }).from(users).where(eq(users.id, userId)),
  ]);
  const anchors = new Map(
    (await exec.select({ id: recurringItems.id, anchorDay: recurringItems.anchorDay }).from(recurringItems).where(eq(recurringItems.householdId, householdId))).map(
      (r) => [r.id, r.anchorDay],
    ),
  );
  const incomes = recurring.filter((r) => r.kind === 'income');
  const bills = recurring.filter((r) => r.kind === 'bill');
  const billCategoryIds = [...new Set(bills.map((b) => b.categoryId).filter((x): x is string => Boolean(x)))];
  const everyday = await everydayBaseline(exec, householdId, userId, req.scope, today, billCategoryIds);
  const safetyBufferCents = { ...DEFAULT_NOTIFICATION_PREFS, ...(user?.prefs ?? {}) }.safetyBufferCents;
  const startingBalanceCents = liquid.reduce((s, a) => s + a.balanceCents, 0);

  const inputs: EngineInputs = {
    asOf: today,
    horizonMonths: req.horizonMonths,
    granularity: req.granularity,
    incomeMode: req.incomeMode,
    safetyBufferCents,
    startingBalanceCents,
    incomes: incomes.map((r) => ({ ...r, anchorDay: anchors.get(r.id) })),
    bills: bills.map((r) => ({ ...r, anchorDay: anchors.get(r.id) })),
    everydayByCategory: everyday.byCategory,
  };
  const baseline = simulate(inputs);
  const scenario = req.adjustments.length ? simulate(inputs, req.adjustments) : null;

  return {
    asOf: today,
    horizonMonths: req.horizonMonths,
    granularity: req.granularity,
    incomeMode: req.incomeMode,
    safetyBufferCents,
    baseline: baseline.series,
    scenario: scenario?.series ?? null,
    assumptions: {
      startingBalanceCents,
      liquidAccounts: liquid,
      incomeStreams: incomes.map((r) => ({
        id: r.id,
        label: r.label,
        amountCents: r.amountCents,
        usedAmountCents: req.incomeMode === 'conservative' && r.minAmountCents != null ? r.minAmountCents : r.amountCents,
        frequency: r.frequency,
        nextDate: r.nextDate,
      })),
      bills: bills.map((r) => ({ id: r.id, label: r.label, amountCents: r.amountCents, frequency: r.frequency, nextDate: r.nextDate })),
      everydaySpendMonthlyCents: everyday.byCategory.reduce((s, c) => s + c.monthlyCents, 0),
      everydaySpendBasis: everyday.basis,
      goalContributionsMonthlyCents: goalList.reduce((s, g) => s + g.plannedMonthlyCents, 0),
    },
    upcomingEvents: (scenario ?? baseline).events.slice(0, 60),
  };
}
