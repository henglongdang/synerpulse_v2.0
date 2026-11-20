/**
 * Notification & Alerts Engine (paper §2.6): behavioural triggers evaluated server-side.
 * Every alert carries a dedupe key, so re-evaluation is idempotent and users are never spammed.
 *
 * Triggers
 *  - budget threshold / exceeded  (after any ledger or budget change)
 *  - bill due within N days        (periodic sweep, N from each user's preferences)
 *  - forecast deficit ahead        (periodic sweep; "pre-commitment nudge")
 *  - goal reached / halfway        (after contributions)
 */
import { eq } from 'drizzle-orm';
import { formatCents, monthKey, monthLabel, todayInZone } from '@synerpulse/shared';
import { householdMembers, households } from '../../db/schema';
import { db, deps } from '../../lib/deps';
import { logger } from '../../lib/logger';
import { budgetMonth, listGoals, upcomingBills } from '../finance/service';
import { runForecast } from '../forecast/service';
import { notify, prefsForUsers } from '../notifications/service';

async function membersOf(householdId: string) {
  return db().select({ userId: householdMembers.userId, role: householdMembers.role }).from(householdMembers).where(eq(householdMembers.householdId, householdId));
}

async function householdTodayById(householdId: string): Promise<string> {
  const [h] = await db().select({ tz: households.timezone }).from(households).where(eq(households.id, householdId));
  return todayInZone(h?.tz ?? 'UTC');
}

async function householdInfo(householdId: string) {
  const [h] = await db().select({ name: households.name, currency: households.currency }).from(households).where(eq(households.id, householdId));
  return h;
}

export async function evaluateBudgets(householdId: string, todayOverride?: string): Promise<void> {
  const today = todayOverride ?? (await householdTodayById(householdId));
  const info = await householdInfo(householdId);
  if (!info) return;
  const members = await membersOf(householdId);
  if (!members.length) return;
  const prefs = await prefsForUsers(db(), members.map((m) => m.userId));
  // Budgets are computed on shared accounts, so any member's id yields the same figures.
  const month = monthKey(today);
  const b = await budgetMonth(db(), householdId, members[0].userId, month, today);
  for (const g of b.groups) {
    for (const line of g.lines) {
      if (line.budgetCents <= 0) continue;
      for (const m of members) {
        const p = prefs.get(m.userId)!;
        const thresholdBp = p.budgetThresholdPct * 100;
        if (line.usedBp > 10_000) {
          await notify(db(), {
            userId: m.userId,
            householdId,
            type: 'budget_exceeded',
            title: `${line.categoryName} is over budget`,
            body: `${formatCents(line.spentCents, info.currency)} spent of ${formatCents(line.budgetCents, info.currency)} in ${monthLabel(month, 'long')} — ${formatCents(-line.remainingCents, info.currency)} over.`,
            link: '/budget',
            dedupeKey: `budget:${line.categoryId}:${month}:over`,
          });
        } else if (line.usedBp >= thresholdBp && !line.billCovered) {
          await notify(db(), {
            userId: m.userId,
            householdId,
            type: 'budget_threshold',
            title: `You're close to your ${line.categoryName} limit`,
            body: `${Math.floor(line.usedBp / 100)}% used (${formatCents(line.remainingCents, info.currency)} left for ${monthLabel(month, 'long')}). Consider revising before the month ends.`,
            link: '/budget',
            dedupeKey: `budget:${line.categoryId}:${month}:threshold`,
          });
        }
      }
    }
  }
}

export async function evaluateGoals(householdId: string, todayOverride?: string): Promise<void> {
  const today = todayOverride ?? (await householdTodayById(householdId));
  try {
    const members = await membersOf(householdId);
    const prefs = await prefsForUsers(db(), members.map((m) => m.userId));
    const info = await householdInfo(householdId);
    for (const g of await listGoals(db(), householdId, today)) {
      for (const m of members) {
        if (prefs.get(m.userId)?.goals === false) continue;
        if (g.progressBp >= 10_000) {
          await notify(db(), {
            userId: m.userId,
            householdId,
            type: 'goal_reached',
            title: `Goal reached: ${g.name}`,
            body: `You've saved ${formatCents(g.savedCents, info?.currency)} — the full target. Time to celebrate (and maybe set the next one).`,
            link: '/budget#goals',
            dedupeKey: `goal:${g.id}:reached`,
          });
        } else if (g.progressBp >= 5_000) {
          await notify(db(), {
            userId: m.userId,
            householdId,
            type: 'goal_milestone',
            title: `Halfway to ${g.name}`,
            body: `${formatCents(g.savedCents, info?.currency)} of ${formatCents(g.targetCents, info?.currency)} saved.`,
            link: '/budget#goals',
            dedupeKey: `goal:${g.id}:50`,
          });
        }
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'goal evaluation failed');
  }
}

export async function evaluateBills(householdId: string, todayOverride?: string): Promise<void> {
  const today = todayOverride ?? (await householdTodayById(householdId));
  const info = await householdInfo(householdId);
  const members = await membersOf(householdId);
  const prefs = await prefsForUsers(db(), members.map((m) => m.userId));
  for (const m of members) {
    const days = prefs.get(m.userId)?.billReminderDays ?? 3;
    if (days <= 0) continue;
    const bills = await upcomingBills(db(), householdId, m.userId, today, days);
    for (const b of bills) {
      if (b.daysUntil < 0) continue;
      await notify(db(), {
        userId: m.userId,
        householdId,
        type: 'bill_due',
        title: b.daysUntil === 0 ? `${b.label} is due today` : `${b.label} is due in ${b.daysUntil} day${b.daysUntil === 1 ? '' : 's'}`,
        body: `${formatCents(b.amountCents, info?.currency)}${b.autopay ? ' — set to autopay' : ' — remember to pay it, then mark it paid'}.`,
        link: '/budget#bills',
        dedupeKey: `bill:${b.recurringId}:${b.dueDate}`,
      });
    }
  }
}

export async function evaluateForecast(householdId: string, todayOverride?: string): Promise<void> {
  const today = todayOverride ?? (await householdTodayById(householdId));
  const info = await householdInfo(householdId);
  const members = await membersOf(householdId);
  const prefs = await prefsForUsers(db(), members.map((m) => m.userId));
  for (const m of members) {
    const p = prefs.get(m.userId);
    if (p?.forecastDeficit === false) continue;
    const f = await runForecast(db(), householdId, m.userId, { horizonMonths: 3, granularity: 'month', scope: 'household', incomeMode: 'expected', adjustments: [] }, today);
    const deficit = f.baseline.firstDeficitDate;
    if (!deficit) continue;
    await notify(db(), {
      userId: m.userId,
      householdId,
      type: 'forecast_deficit',
      title: `Shared balance may run short around ${new Date(`${deficit}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`,
      body: `At current income, bills and spending, shared cash could dip to ${formatCents(f.baseline.lowestBalanceCents, info?.currency)}. Open the planner to test a fix.`,
      link: '/planner',
      dedupeKey: `forecast:${monthKey(deficit)}`,
    });
  }
}

/** Fast path after ledger/budget writes. Never throws into the request that triggered it. */
export async function afterLedgerChange(householdId: string): Promise<void> {
  try {
    await evaluateBudgets(householdId);
    await evaluateGoals(householdId);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'post-change alert evaluation failed');
  }
}

const lastSweep = new Map<string, number>();

export async function sweepHousehold(householdId: string, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - (lastSweep.get(householdId) ?? 0) < 10 * 60_000) return;
  lastSweep.set(householdId, now);
  try {
    await evaluateBudgets(householdId);
    await evaluateGoals(householdId);
    await evaluateBills(householdId);
    await evaluateForecast(householdId);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'alert sweep failed');
  }
}

export function startAlertScheduler(): () => void {
  const minutes = deps().config.alertSweepMinutes;
  if (!minutes) return () => {};
  const run = async () => {
    const all = await db().select({ id: households.id }).from(households);
    for (const h of all) await sweepHousehold(h.id, true);
  };
  const timer = setInterval(() => void run().catch((e) => logger.warn({ err: e.message }, 'scheduler run failed')), minutes * 60_000);
  timer.unref();
  setTimeout(() => void run().catch(() => undefined), 5_000).unref();
  return () => clearInterval(timer);
}
