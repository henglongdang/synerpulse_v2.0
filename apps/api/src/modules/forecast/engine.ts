/**
 * Cash-flow forecast & scenario engine (paper §2.6 "Scenario Planner").
 *
 * A deterministic day-by-day simulation of liquid balance:
 *   balance(d) = balance(d-1) + income occurrences(d) − bill occurrences(d) − everyday spend(d) ± scenario events(d)
 * Daily resolution means a bill delayed by two weeks, or a payday landing after rent, changes
 * the low point — the "intra-month dip" that monthly spreadsheets hide. Results are aggregated
 * into weekly or monthly periods for display. All arithmetic is integer cents.
 */
import {
  addDays,
  addMonths,
  allocateEvenly,
  applyBasisPoints,
  daysInMonth,
  monthLabel,
  startOfWeek,
  type Adjustment,
  type ForecastEventDTO,
  type ForecastPeriodDTO,
  type ForecastSeriesDTO,
  type Frequency,
  type ISODate,
} from '@synerpulse/shared';
import { occurrences } from '../finance/recurrence';

export interface RecurringInput {
  id: string;
  label: string;
  amountCents: number;
  minAmountCents?: number | null;
  frequency: Frequency;
  nextDate: ISODate;
  endDate?: ISODate | null;
  anchorDay?: number;
  categoryId?: string | null;
}

export interface EngineInputs {
  asOf: ISODate;
  horizonMonths: number;
  granularity: 'week' | 'month';
  incomeMode: 'expected' | 'conservative';
  safetyBufferCents: number;
  startingBalanceCents: number;
  incomes: RecurringInput[];
  bills: RecurringInput[];
  /** Typical monthly everyday (non-bill) spending, split by category where known. */
  everydayByCategory: { categoryId: string | null; monthlyCents: number }[];
}

interface DayEvent {
  label: string;
  amountCents: number;
  kind: ForecastEventDTO['kind'];
  source: 'baseline' | 'scenario';
}

const inWindow = (d: ISODate, start?: ISODate, end?: ISODate) => (!start || d >= start) && (!end || d <= end);

function buildEvents(inp: EngineInputs, adjustments: Adjustment[], end: ISODate): Map<ISODate, DayEvent[]> {
  const from = addDays(inp.asOf, 1);
  const map = new Map<ISODate, DayEvent[]>();
  const push = (d: ISODate, e: DayEvent) => {
    if (d < from || d > end || e.amountCents === 0) return;
    const list = map.get(d);
    if (list) list.push(e);
    else map.set(d, [e]);
  };

  // Income streams
  for (const inc of inp.incomes) {
    const base = inp.incomeMode === 'conservative' && inc.minAmountCents != null ? inc.minAmountCents : inc.amountCents;
    for (const d of occurrences(inc, from, end)) {
      let amount = base;
      let changed = false;
      for (const a of adjustments) {
        if (a.kind === 'income_change' && (a.recurringId === null || a.recurringId === inc.id) && inWindow(d, a.startDate, a.endDate)) {
          amount += applyBasisPoints(base, a.basisPoints);
          changed = true;
        }
      }
      push(d, { label: inc.label, amountCents: Math.max(0, amount), kind: 'income', source: changed ? 'scenario' : 'baseline' });
    }
  }

  // Bills (with optional delay of the next occurrence, and category-level changes)
  for (const bill of inp.bills) {
    const dates = occurrences(bill, from, end);
    const delay = adjustments.find((a) => a.kind === 'delay_bill' && a.recurringId === bill.id) as Extract<Adjustment, { kind: 'delay_bill' }> | undefined;
    dates.forEach((d, i) => {
      let amount = bill.amountCents;
      let changed = false;
      for (const a of adjustments) {
        if (a.kind === 'expense_change' && a.categoryId !== null && a.categoryId === bill.categoryId && inWindow(d, a.startDate, a.endDate)) {
          amount += applyBasisPoints(bill.amountCents, a.basisPoints);
          changed = true;
        }
      }
      let date = d;
      if (delay && i === 0) {
        date = addDays(d, delay.days);
        changed = true;
      }
      push(date, { label: delay && i === 0 ? `${bill.label} (delayed ${delay.days} days)` : bill.label, amountCents: -Math.max(0, amount), kind: 'bill', source: changed ? 'scenario' : 'baseline' });
    });
  }

  // Everyday spending, spread evenly over each calendar month (exact cents).
  let cursor = from;
  while (cursor <= end) {
    const y = Number(cursor.slice(0, 4));
    const m = Number(cursor.slice(5, 7));
    const dim = daysInMonth(y, m);
    const firstDay = Number(cursor.slice(8, 10));
    const monthEnd = `${cursor.slice(0, 8)}${String(dim).padStart(2, '0')}`;
    const lastDay = monthEnd <= end ? dim : Number(end.slice(8, 10));
    for (const cat of inp.everydayByCategory) {
      const changes = adjustments.filter(
        (a): a is Extract<Adjustment, { kind: 'expense_change' }> => a.kind === 'expense_change' && (a.categoryId === null || a.categoryId === cat.categoryId),
      );
      const daily = allocateEvenly(cat.monthlyCents, dim);
      for (let day = firstDay; day <= lastDay; day++) {
        const date = `${cursor.slice(0, 8)}${String(day).padStart(2, '0')}`;
        let amount = daily[day - 1];
        let changed = false;
        for (const a of changes) {
          if (inWindow(date, a.startDate, a.endDate)) {
            amount += applyBasisPoints(daily[day - 1], a.basisPoints);
            changed = true;
          }
        }
        push(date, { label: 'Everyday spending', amountCents: -Math.max(0, amount), kind: 'everyday', source: changed ? 'scenario' : 'baseline' });
      }
    }
    cursor = addMonths(`${cursor.slice(0, 8)}01`, 1);
  }

  // Scenario-only events
  for (const a of adjustments) {
    if (a.kind === 'one_time') push(a.date, { label: a.label, amountCents: a.amountCents, kind: 'one_time', source: 'scenario' });
    if (a.kind === 'new_recurring') {
      for (const d of occurrences({ frequency: a.frequency, nextDate: a.startDate, endDate: a.endDate ?? null }, from, end)) {
        push(d, { label: a.label, amountCents: a.amountCents, kind: 'scenario', source: 'scenario' });
      }
    }
  }
  return map;
}

function periodKey(d: ISODate, granularity: 'week' | 'month'): ISODate {
  return granularity === 'month' ? `${d.slice(0, 7)}-01` : startOfWeek(d);
}

function periodLabel(start: ISODate, granularity: 'week' | 'month'): string {
  if (granularity === 'month') return monthLabel(start.slice(0, 7));
  const dt = new Date(`${start}T00:00:00Z`);
  return `Wk of ${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

export function simulate(inp: EngineInputs, adjustments: Adjustment[] = []): { series: ForecastSeriesDTO; events: ForecastEventDTO[] } {
  const end = addMonths(inp.asOf, inp.horizonMonths);
  const events = buildEvents(inp, adjustments, end);

  let balance = inp.startingBalanceCents;
  let lowest = balance;
  let lowestDate = inp.asOf;
  let firstDeficit: ISODate | null = balance < 0 ? inp.asOf : null;
  let firstBelowBuffer: ISODate | null = balance < inp.safetyBufferCents ? inp.asOf : null;
  let totalIn = 0;
  let totalOut = 0;
  const periods: ForecastPeriodDTO[] = [];
  let current: ForecastPeriodDTO | null = null;
  const flat: ForecastEventDTO[] = [];

  for (let d = addDays(inp.asOf, 1); d <= end; d = addDays(d, 1)) {
    const key = periodKey(d, inp.granularity);
    if (!current || current.start !== key) {
      if (current) periods.push(current);
      current = { start: key, end: d, label: periodLabel(key, inp.granularity), inflowCents: 0, outflowCents: 0, netCents: 0, endBalanceCents: balance, minBalanceCents: balance };
    }
    for (const e of events.get(d) ?? []) {
      balance += e.amountCents;
      if (e.amountCents > 0) {
        current.inflowCents += e.amountCents;
        totalIn += e.amountCents;
      } else {
        current.outflowCents += -e.amountCents;
        totalOut += -e.amountCents;
      }
      if (e.kind !== 'everyday') flat.push({ date: d, label: e.label, amountCents: e.amountCents, kind: e.kind, source: e.source });
    }
    current.netCents = current.inflowCents - current.outflowCents;
    current.endBalanceCents = balance;
    current.end = d;
    if (balance < current.minBalanceCents) current.minBalanceCents = balance;
    if (balance < lowest) {
      lowest = balance;
      lowestDate = d;
    }
    if (firstDeficit === null && balance < 0) firstDeficit = d;
    if (firstBelowBuffer === null && balance < inp.safetyBufferCents) firstBelowBuffer = d;
  }
  if (current) periods.push(current);

  return {
    series: {
      periods,
      startBalanceCents: inp.startingBalanceCents,
      endBalanceCents: balance,
      lowestBalanceCents: lowest,
      lowestBalanceDate: lowestDate,
      firstDeficitDate: firstDeficit,
      firstBelowBufferDate: firstBelowBuffer,
      totalInflowCents: totalIn,
      totalOutflowCents: totalOut,
    },
    events: flat,
  };
}
