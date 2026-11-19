import { formatCents } from '@familypulse/shared';

export const money = (cents: number, currency = 'USD', opts?: Parameters<typeof formatCents>[2]) => formatCents(cents, currency, opts);

/** Compact axis/tile money: $12.4K, $1.2M; full under $10k. */
export function moneyShort(cents: number, currency = 'USD'): string {
  return Math.abs(cents) >= 1_000_000 ? formatCents(cents, currency, { compact: true }) : formatCents(cents, currency, { noCents: true });
}

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dateFmtYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });

export function shortDate(iso: string, withYear = false): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return (withYear || d.getUTCFullYear() !== new Date().getUTCFullYear() ? dateFmtYear : dateFmt).format(d);
}

export function dayLabel(iso: string, today: string): string {
  if (iso === today) return 'Today';
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000);
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return weekday.format(new Date(`${iso}T00:00:00Z`)) + ', ' + shortDate(iso);
  return shortDate(iso, true);
}

export function relativeTime(isoTs: string): string {
  const diffMs = Date.now() - Date.parse(isoTs);
  const m = Math.round(diffMs / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return shortDate(isoTs.slice(0, 10), true);
}

/** Local calendar date (not UTC) — what the user means by "today". */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

const AVATAR_COLORS = ['#8ee89b', '#c6cdff', '#f6c89a', '#e4c3ee', '#9fdbe6', '#f2d48e'];
export function avatarColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export const pct = (bp: number, digits = 0) => `${(bp / 100).toFixed(digits)}%`;
