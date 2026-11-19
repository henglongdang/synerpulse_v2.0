/**
 * Calendar-date helpers operating on ISO "YYYY-MM-DD" strings in UTC.
 * Financial dates are calendar days, not instants — keeping them as strings avoids
 * time-zone drift (a transaction on the 31st must never appear on the 30th).
 */

export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidISODate(s: string): boolean {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function parseISODate(s: ISODate): Date {
  if (!isValidISODate(s)) throw new Error(`Invalid date: ${s}`);
  return new Date(`${s}T00:00:00.000Z`);
}

export function toISODate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now);
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = parseISODate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toISODate(d);
}

/** Add months, clamping to the end of month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(s: ISODate, n: number, anchorDay?: number): ISODate {
  const d = parseISODate(s);
  const day = anchorDay ?? d.getUTCDate();
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + n;
  const y = Math.floor(total / 12);
  const m0 = total - y * 12;
  const clamped = Math.min(day, daysInMonth(y, m0 + 1));
  return toISODate(new Date(Date.UTC(y, m0, clamped)));
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** "2026-11" */
export function monthKey(s: ISODate): string {
  return s.slice(0, 7);
}

export function startOfMonth(s: ISODate): ISODate {
  return `${s.slice(0, 7)}-01`;
}

export function endOfMonth(s: ISODate): ISODate {
  const [y, m] = [Number(s.slice(0, 4)), Number(s.slice(5, 7))];
  return `${s.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

export function isValidMonthKey(k: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(k);
}

/** ISO week start (Monday). */
export function startOfWeek(s: ISODate): ISODate {
  const d = parseISODate(s);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(s, -dow);
}

export function monthLabel(key: string, style: 'short' | 'long' = 'short'): string {
  const d = new Date(`${key}-01T00:00:00.000Z`);
  return d.toLocaleDateString('en-US', { month: style, year: 'numeric', timeZone: 'UTC' });
}
