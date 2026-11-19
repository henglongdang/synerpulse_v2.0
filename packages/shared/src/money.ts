/**
 * Money is represented everywhere as an integer number of minor units ("cents").
 * JavaScript numbers represent integers exactly up to 2^53 (~$90 trillion in cents),
 * so integer arithmetic on cents is exact. Fractions (percentages) are expressed in
 * basis points (1 bp = 0.01%) and every multiplication is rounded exactly once, using
 * round-half-away-from-zero, so results are reproducible and auditable.
 */

export const MAX_ABS_CENTS = 99_999_999_999; // $999,999,999.99 — sane ceiling for a household ledger

export class MoneyParseError extends Error {}

/** Round a (possibly fractional) number of cents half away from zero. */
export function roundHalfAwayFromZero(value: number): number {
  const r = Math.round(Math.abs(value));
  // Math.round rounds .5 up for positives; mirror for negatives.
  return value < 0 ? -r : r;
}

/**
 * Parse a user-entered decimal amount ("1,234.5", "$12", "-3.07", "(45.00)") into integer cents
 * WITHOUT going through floating-point multiplication.
 */
export function parseMoneyToCents(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MoneyParseError('Amount must be a finite number');
    // Convert via string to avoid binary float artefacts like 0.1+0.2.
    return parseMoneyToCents(input.toFixed(2));
  }
  let s = input.trim();
  if (!s) throw new MoneyParseError('Amount is required');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[$€£¥\s,]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  const m = /^(\d+)(?:\.(\d{0,2}))?$|^\.(\d{1,2})$/.exec(s);
  if (!m) throw new MoneyParseError(`"${input}" is not a valid amount (use up to 2 decimal places)`);
  const whole = m[1] ?? '0';
  const frac = (m[2] ?? m[3] ?? '').padEnd(2, '0');
  if (whole.length > 12) throw new MoneyParseError('Amount is too large');
  const cents = Number(whole) * 100 + Number(frac);
  if (cents > MAX_ABS_CENTS) throw new MoneyParseError('Amount is too large');
  return negative && cents !== 0 ? -cents : cents;
}

/** Format cents for display. Uses Intl but feeds it an exact decimal string. */
export function formatCents(
  cents: number,
  currency = 'USD',
  opts: { signed?: boolean; compact?: boolean; noCents?: boolean } = {},
): string {
  const abs = Math.abs(cents);
  const value = abs / 100; // display only — never fed back into calculations
  const fmt = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: opts.compact ? 'compact' : 'standard',
    minimumFractionDigits: opts.noCents || opts.compact ? 0 : 2,
    maximumFractionDigits: opts.compact ? 1 : opts.noCents ? 0 : 2,
  });
  const body = fmt.format(value);
  if (cents < 0) return `−${body}`; // true minus sign for legibility
  if (opts.signed && cents > 0) return `+${body}`;
  return body;
}

/** Convert cents to a plain decimal string ("-1234.50") — for CSV export, inputs. */
export function centsToDecimalString(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

/** cents × (basisPoints / 10_000), rounded once. */
export function applyBasisPoints(cents: number, basisPoints: number): number {
  return roundHalfAwayFromZero((cents * basisPoints) / 10_000);
}

/** part / whole expressed in basis points (0 when whole is 0). */
export function ratioToBasisPoints(part: number, whole: number): number {
  if (whole === 0) return 0;
  return roundHalfAwayFromZero((part * 10_000) / whole);
}

/** Split an amount into n parts that sum exactly to the total (remainder spread from the front). */
export function allocateEvenly(cents: number, parts: number): number[] {
  if (parts <= 0 || !Number.isInteger(parts)) throw new Error('parts must be a positive integer');
  const sign = cents < 0 ? -1 : 1;
  const abs = Math.abs(cents);
  const base = Math.floor(abs / parts);
  let remainder = abs - base * parts;
  const out: number[] = [];
  for (let i = 0; i < parts; i++) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    out.push(sign * (base + extra));
  }
  return out;
}

export function sumCents(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function formatBasisPoints(bp: number, digits = 0): string {
  return `${(bp / 100).toFixed(digits)}%`;
}
