import { describe, expect, it } from 'vitest';
import { monthlyEquivalent, occurrences, stepAfter } from '../src/modules/finance/recurrence';
import { goalMath, monthsUntil } from '../src/modules/finance/goals';
import { simulate, type EngineInputs } from '../src/modules/forecast/engine';
import { applyRules, ruleMatches } from '../src/modules/rules/engine';

describe('recurrence', () => {
  it('keeps month-end anchors (Jan 31 → Feb 28 → Mar 31)', () => {
    expect(occurrences({ frequency: 'monthly', nextDate: '2026-01-31', anchorDay: 31 }, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });
  it('handles biweekly, semimonthly, quarterly, once and end dates', () => {
    expect(occurrences({ frequency: 'biweekly', nextDate: '2026-01-02' }, '2026-01-01', '2026-02-01')).toEqual(['2026-01-02', '2026-01-16', '2026-01-30']);
    expect(occurrences({ frequency: 'semimonthly', nextDate: '2026-01-01' }, '2026-01-01', '2026-02-28')).toEqual(['2026-01-01', '2026-01-16', '2026-02-01', '2026-02-16']);
    expect(occurrences({ frequency: 'semimonthly', nextDate: '2026-01-30', anchorDay: 30 }, '2026-01-01', '2026-02-28')).toEqual(['2026-01-30', '2026-02-15', '2026-02-28']);
    expect(occurrences({ frequency: 'quarterly', nextDate: '2026-01-15' }, '2026-01-01', '2026-12-31')).toHaveLength(4);
    expect(occurrences({ frequency: 'once', nextDate: '2026-03-01' }, '2026-01-01', '2026-12-31')).toEqual(['2026-03-01']);
    expect(occurrences({ frequency: 'weekly', nextDate: '2026-01-01', endDate: '2026-01-20' }, '2026-01-01', '2026-12-31')).toHaveLength(3);
    expect(stepAfter({ frequency: 'once', nextDate: '2026-01-01' }, '2026-01-01')).toBeNull();
  });
  it('converts to monthly equivalents', () => {
    expect(monthlyEquivalent(100_00, 'weekly')).toBe(433_33);
    expect(monthlyEquivalent(2_950_00, 'biweekly')).toBe(6_391_67);
    expect(monthlyEquivalent(1_200_00, 'yearly')).toBe(100_00);
  });
});

describe('goal math', () => {
  it('computes progress, required monthly contribution and on-track status', () => {
    const g = goalMath({ targetCents: 30_000_00, savedCents: 27_900_00, targetDate: '2027-06-19', plannedMonthlyCents: 150_00 }, '2026-11-19');
    expect(g.progressBp).toBe(9300); // the prototype's "Education 93%"
    expect(g.requiredMonthlyCents).toBe(Math.ceil(2_100_00 / monthsUntil('2026-11-19', '2027-06-19')));
    expect(g.onTrack).toBe(false);
    expect(goalMath({ targetCents: 100, savedCents: 150, targetDate: null, plannedMonthlyCents: 0 }, '2026-01-01')).toMatchObject({ progressBp: 10_000, onTrack: true });
    expect(goalMath({ targetCents: 1200_00, savedCents: 0, targetDate: null, plannedMonthlyCents: 100_00 }, '2026-01-15').projectedCompletion).toBe('2027-01-15');
  });
});

/** A freelancer household: $4,000 freelance on the 25th, rent $2,600 on the 1st, $900/month everyday spending. */
const freelancer = (overrides: Partial<EngineInputs> = {}): EngineInputs => ({
  asOf: '2026-01-10',
  horizonMonths: 6,
  granularity: 'month',
  incomeMode: 'expected',
  safetyBufferCents: 0,
  startingBalanceCents: 2_500_00,
  incomes: [{ id: 'free', label: 'Freelance', amountCents: 4_000_00, minAmountCents: 2_400_00, frequency: 'monthly', nextDate: '2026-01-25' }],
  bills: [{ id: 'rent', label: 'Rent', amountCents: 2_600_00, frequency: 'monthly', nextDate: '2026-02-01', categoryId: 'housing' }],
  everydayByCategory: [{ categoryId: 'food', monthlyCents: 900_00 }],
  ...overrides,
});

describe('forecast engine', () => {
  it('conserves money: end balance = start + inflows − outflows (exact cents)', () => {
    const { series } = simulate(freelancer());
    expect(series.endBalanceCents).toBe(series.startBalanceCents + series.totalInflowCents - series.totalOutflowCents);
    expect(series.periods.reduce((s, p) => s + p.netCents, 0)).toBe(series.endBalanceCents - series.startBalanceCents);
    // 6 rent payments (Feb–Jul 1st); everyday spend is spread daily across the horizon.
    expect(series.firstDeficitDate).toBeNull();
  });

  it('paper task 2: a 30% income drop reveals the first deficit month', () => {
    const base = simulate(freelancer());
    const cut = simulate(freelancer(), [{ kind: 'income_change', recurringId: null, basisPoints: -3000 }]);
    expect(base.series.firstDeficitDate).toBeNull();
    expect(cut.series.firstDeficitDate).not.toBeNull();
    // Monthly net under the cut is −$700, but rent lands on the 1st and pay on the 25th, so the
    // balance first dips below zero on the day before April's payday — not at a month end.
    // Hand trace: Apr 1 ≈ $690 after rent; 24 days × $30/day everyday spend ≈ −$30 on Apr 24.
    expect(cut.series.firstDeficitDate).toBe('2026-04-24');
    const deficitPeriod = cut.series.periods.find((p) => p.minBalanceCents < 0)!;
    expect(deficitPeriod.label).toBe('Apr 2026');
    expect(deficitPeriod.endBalanceCents).toBeGreaterThan(0); // a month-end view would have missed it
    expect(cut.events.find((e) => e.kind === 'income')!.amountCents).toBe(2_800_00);
  });

  it('paper task 4: delaying a major payment by two weeks moves the low point', () => {
    const base = simulate(freelancer({ startingBalanceCents: 1_000_00, horizonMonths: 3, granularity: 'week' }));
    const delayed = simulate(freelancer({ startingBalanceCents: 1_000_00, horizonMonths: 3, granularity: 'week' }), [{ kind: 'delay_bill', recurringId: 'rent', days: 14 }]);
    const rentEvents = delayed.events.filter((e) => e.label.startsWith('Rent'));
    expect(rentEvents[0]).toMatchObject({ date: '2026-02-15', source: 'scenario' });
    expect(rentEvents[1].date).toBe('2026-03-01'); // only the next occurrence moves
    expect(delayed.series.lowestBalanceCents).toBeGreaterThanOrEqual(base.series.lowestBalanceCents);
    expect(base.series.periods[0].label).toMatch(/^Wk of /);
  });

  it('conservative mode uses the minimum expected income', () => {
    const r = simulate(freelancer({ incomeMode: 'conservative' }));
    expect(r.events.find((e) => e.kind === 'income')!.amountCents).toBe(2_400_00);
  });

  it('applies one-time events, new recurring items and category-specific changes', () => {
    const r = simulate(freelancer(), [
      { kind: 'one_time', label: 'Tax refund', amountCents: 1_200_00, date: '2026-03-15' },
      { kind: 'new_recurring', label: 'Gym', amountCents: -60_00, frequency: 'monthly', startDate: '2026-02-05' },
      { kind: 'expense_change', categoryId: 'housing', basisPoints: 1000 }, // rent +10%
      { kind: 'expense_change', categoryId: null, basisPoints: -5000, startDate: '2026-04-01', endDate: '2026-04-30' }, // halve everyday spend in April
    ]);
    expect(r.events.some((e) => e.label === 'Tax refund' && e.amountCents === 1_200_00)).toBe(true);
    expect(r.events.filter((e) => e.label === 'Gym')).toHaveLength(6);
    expect(r.events.find((e) => e.label === 'Rent')!.amountCents).toBe(-2_860_00);
    const april = r.series.periods.find((p) => p.label === 'Apr 2026')!;
    const march = r.series.periods.find((p) => p.label === 'Mar 2026')!;
    expect(april.outflowCents).toBeLessThan(march.outflowCents);
  });

  it('flags the safety buffer separately from a true deficit', () => {
    // Baseline low point is ≈ $2,519 (Feb 24, just before payday) — above zero but below a $3,000 buffer.
    const r = simulate(freelancer({ safetyBufferCents: 3_000_00 }));
    expect(r.series.firstBelowBufferDate).not.toBeNull();
    expect(r.series.firstDeficitDate).toBeNull();
  });
});

describe('automation rules', () => {
  const facts = { type: 'income' as const, description: 'Client invoice #1042', merchant: 'Atlas', tags: [], categoryId: null, accountId: 'acc', amountCents: 1_500_00 };
  it('chains rules: tagging enables a later 20% savings reallocation (paper §2.5 example)', () => {
    const out = applyRules(
      [
        { id: 'tag', name: 'tag', enabled: true, conditions: { descriptionContains: 'INVOICE' }, actions: { addTags: ['freelance'], setCategoryId: 'cat-free' } },
        { id: 'save', name: 'save', enabled: true, conditions: { type: 'income', tag: 'freelance' }, actions: { allocateToGoal: { goalId: 'g', basisPoints: 2000 } } },
      ],
      facts,
      { categoryExplicit: false },
    );
    expect(out.tags).toEqual(['freelance']);
    expect(out.categoryId).toBe('cat-free');
    expect(out.allocations).toEqual([{ ruleId: 'save', goalId: 'g', amountCents: 300_00 }]);
    expect(out.appliedRuleIds).toEqual(['tag', 'save']);
  });
  it('never overrides an explicit category and skips disabled rules', () => {
    const out = applyRules(
      [
        { id: 'a', name: 'a', enabled: true, conditions: { type: 'income' }, actions: { setCategoryId: 'other' } },
        { id: 'b', name: 'b', enabled: false, conditions: { type: 'income' }, actions: { addTags: ['x'] } },
      ],
      { ...facts, categoryId: 'mine' },
      { categoryExplicit: true },
    );
    expect(out.categoryId).toBe('mine');
    expect(out.appliedRuleIds).toEqual([]);
  });
  it('matches amount ranges and merchants case-insensitively', () => {
    expect(ruleMatches({ merchantContains: 'atl', minAmountCents: 1_000_00, maxAmountCents: 2_000_00 }, facts)).toBe(true);
    expect(ruleMatches({ maxAmountCents: 1_000_00 }, facts)).toBe(false);
  });
});
