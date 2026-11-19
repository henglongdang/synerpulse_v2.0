import { addDays, addMonths, daysInMonth, roundHalfAwayFromZero, type Frequency, type ISODate } from '@familypulse/shared';

export interface Schedule {
  frequency: Frequency;
  nextDate: ISODate;
  endDate?: ISODate | null;
  /** Day-of-month anchor for month-based schedules (defaults to nextDate's day). */
  anchorDay?: number;
}

function anchorOf(s: Schedule): number {
  return s.anchorDay ?? Number(s.nextDate.slice(8, 10));
}

/** The occurrence following `date` for a schedule (date itself is assumed to be an occurrence). */
export function stepAfter(s: Schedule, date: ISODate): ISODate | null {
  const anchor = anchorOf(s);
  switch (s.frequency) {
    case 'once':
      return null;
    case 'weekly':
      return addDays(date, 7);
    case 'biweekly':
      return addDays(date, 14);
    case 'monthly':
      return addMonths(date, 1, anchor);
    case 'quarterly':
      return addMonths(date, 3, anchor);
    case 'yearly':
      return addMonths(date, 12, anchor);
    case 'semimonthly': {
      // Two dates per month: the anchor day and 15 days later (or earlier), clamped to month end.
      const first = anchor > 15 ? anchor - 15 : anchor;
      const second = first + 15;
      const y = Number(date.slice(0, 4));
      const m = Number(date.slice(5, 7));
      const d = Number(date.slice(8, 10));
      const dim = daysInMonth(y, m);
      const secondClamped = Math.min(second, dim);
      if (d < first) return `${date.slice(0, 8)}${String(first).padStart(2, '0')}`;
      if (d < secondClamped) return `${date.slice(0, 8)}${String(secondClamped).padStart(2, '0')}`;
      const nextMonth = addMonths(`${date.slice(0, 8)}01`, 1);
      return `${nextMonth.slice(0, 8)}${String(first).padStart(2, '0')}`;
    }
  }
}

/** All occurrences within [from, to] inclusive, starting from the schedule's nextDate. */
export function occurrences(s: Schedule, from: ISODate, to: ISODate, max = 1000): ISODate[] {
  const out: ISODate[] = [];
  let d: ISODate | null = s.nextDate;
  let guard = 0;
  while (d && d <= to && guard++ < max) {
    if (s.endDate && d > s.endDate) break;
    if (d >= from) out.push(d);
    d = stepAfter(s, d);
  }
  return out;
}

const PER_YEAR: Record<Frequency, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, quarterly: 4, yearly: 1, once: 0 };

/** Average monthly cost of a recurring amount (e.g. $100 weekly ≈ $433.33/month). */
export function monthlyEquivalent(amountCents: number, frequency: Frequency): number {
  return roundHalfAwayFromZero((amountCents * PER_YEAR[frequency]) / 12);
}
