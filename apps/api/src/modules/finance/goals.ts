import { addMonths, ratioToBasisPoints, type ISODate } from '@familypulse/shared';

export interface GoalMath {
  progressBp: number;
  requiredMonthlyCents: number | null;
  projectedCompletion: ISODate | null;
  onTrack: boolean | null;
}

/** Whole months from `from` to `to`, counting a partial month as a full one (min 1). */
export function monthsUntil(from: ISODate, to: ISODate): number {
  const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
  const partial = Number(to.slice(8, 10)) >= Number(from.slice(8, 10)) ? 0 : -1;
  return Math.max(1, months + partial + 1);
}

/**
 * Goal progress and planning math, exposed to users with its derivation:
 *  required monthly = ceil(remaining / months left until target date)
 *  projected completion = today + ceil(remaining / planned monthly) months
 */
export function goalMath(g: { targetCents: number; savedCents: number; targetDate: ISODate | null; plannedMonthlyCents: number }, today: ISODate): GoalMath {
  const remaining = Math.max(0, g.targetCents - g.savedCents);
  const progressBp = Math.min(10_000, Math.max(0, ratioToBasisPoints(g.savedCents, g.targetCents)));
  if (remaining === 0) return { progressBp, requiredMonthlyCents: 0, projectedCompletion: today, onTrack: true };

  let requiredMonthlyCents: number | null = null;
  if (g.targetDate) {
    requiredMonthlyCents = g.targetDate <= today ? remaining : Math.ceil(remaining / monthsUntil(today, g.targetDate));
  }
  let projectedCompletion: ISODate | null = null;
  if (g.plannedMonthlyCents > 0) {
    projectedCompletion = addMonths(today, Math.ceil(remaining / g.plannedMonthlyCents));
  }
  // On track = the planned monthly contribution covers what is required to hit the date.
  const onTrack = requiredMonthlyCents == null ? null : g.plannedMonthlyCents > 0 && g.plannedMonthlyCents >= requiredMonthlyCents;
  return { progressBp, requiredMonthlyCents, projectedCompletion, onTrack };
}
