import { describe, expect, it } from 'vitest';
import { addDays, addMonths, daysBetween, endOfMonth, isValidISODate, isValidTimeZone, startOfWeek, todayInZone } from '../src/dates';
import { can, canAssignRole, canManageMember, categoryAllowed } from '../src/permissions';
import { adjustmentSchema, createTransactionSchema, saveBudgetSchema } from '../src/schemas';

describe('dates', () => {
  it('validates real calendar dates', () => {
    expect(isValidISODate('2024-02-29')).toBe(true);
    expect(isValidISODate('2025-02-29')).toBe(false);
    expect(isValidISODate('2025-13-01')).toBe(false);
    expect(isValidISODate('2025-1-01')).toBe(false);
  });
  it('clamps month arithmetic to month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15');
  });
  it('computes "today" in the household time zone, not the server clock', () => {
    const instant = new Date('2026-11-20T04:30:00Z'); // 8:30 pm Nov 19 in Los Angeles
    expect(todayInZone('America/Los_Angeles', instant)).toBe('2026-11-19');
    expect(todayInZone('UTC', instant)).toBe('2026-11-20');
    expect(todayInZone('Asia/Tokyo', new Date('2026-11-19T16:00:00Z'))).toBe('2026-11-20');
    expect(todayInZone('Not/AZone', instant)).toBe('2026-11-20');
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
  it('does calendar arithmetic in UTC', () => {
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(startOfWeek('2026-11-19')).toBe('2026-11-16'); // Thursday → Monday
  });
});

describe('permissions', () => {
  it('viewers are read-only (plus comments)', () => {
    expect(can('viewer', 'household.view')).toBe(true);
    expect(can('viewer', 'comments.create')).toBe(true);
    expect(can('viewer', 'transactions.create')).toBe(false);
    expect(can('viewer', 'budgets.manage')).toBe(false);
  });
  it('contributors log entries but cannot manage structure', () => {
    expect(can('contributor', 'transactions.create')).toBe(true);
    expect(can('contributor', 'members.manage')).toBe(false);
    expect(can('contributor', 'accounts.manage')).toBe(false);
  });
  it('only owners delete households', () => {
    expect(can('admin', 'household.delete')).toBe(false);
    expect(can('owner', 'household.delete')).toBe(true);
  });
  it('prevents privilege escalation when assigning roles', () => {
    expect(canAssignRole('admin', 'admin')).toBe(false);
    expect(canAssignRole('admin', 'contributor')).toBe(true);
    expect(canAssignRole('owner', 'admin')).toBe(true);
    expect(canAssignRole('owner', 'owner')).toBe(false);
    expect(canAssignRole('contributor', 'viewer')).toBe(false);
    expect(canManageMember('admin', 'admin')).toBe(false);
    expect(canManageMember('admin', 'owner')).toBe(false);
    expect(canManageMember('owner', 'admin')).toBe(true);
  });
  it('applies category scopes to contributors only', () => {
    expect(categoryAllowed('contributor', ['a', 'b'], 'a')).toBe(true);
    expect(categoryAllowed('contributor', ['a', 'b'], 'c')).toBe(false);
    expect(categoryAllowed('contributor', ['a'], null)).toBe(false);
    expect(categoryAllowed('contributor', [], 'c')).toBe(true);
    expect(categoryAllowed('admin', ['a'], 'c')).toBe(true);
  });
});

describe('schemas', () => {
  const base = {
    accountId: '7aaa6175-1d08-480f-b9e8-aff95ff0cdf1',
    amountCents: 1250,
    date: '2026-11-02',
    description: 'Groceries',
    type: 'expense',
  };
  it('accepts a valid transaction and normalises tags', () => {
    const t = createTransactionSchema.parse({ ...base, tags: [' Freelance '] });
    expect(t.tags).toEqual(['freelance']);
  });
  it.each([
    [{ amountCents: -5 }, 'negative amount'],
    [{ amountCents: 12.5 }, 'fractional cents'],
    [{ date: '2026-02-30' }, 'impossible date'],
    [{ description: '   ' }, 'blank description'],
    [{ accountId: '1 OR 1=1' }, 'non-uuid id'],
  ] as [Record<string, unknown>, string][])('rejects %o (%s)', (patch) => {
    expect(createTransactionSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });
  it('rejects duplicate budget categories', () => {
    const id = '7aaa6175-1d08-480f-b9e8-aff95ff0cdf1';
    const r = saveBudgetSchema.safeParse({
      month: '2026-11',
      items: [
        { categoryId: id, amountCents: 1 },
        { categoryId: id, amountCents: 2 },
      ],
    });
    expect(r.success).toBe(false);
  });
  it('parses scenario adjustments', () => {
    expect(adjustmentSchema.parse({ kind: 'income_change', basisPoints: -3000 })).toMatchObject({ recurringId: null });
    expect(adjustmentSchema.safeParse({ kind: 'delay_bill', recurringId: base.accountId, days: 0 }).success).toBe(false);
  });
});

describe('update schemas never inject defaults (Zod 4 .partial() keeps them)', () => {
  it('a partial PATCH contains only the fields sent', async () => {
    const { updateGoalSchema, updateRecurringSchema, updateHouseholdSchema, updateCategorySchema } = await import('../src/schemas');
    expect(updateGoalSchema.parse({ archived: true })).toEqual({ archived: true });
    expect(updateRecurringSchema.parse({ active: false })).toEqual({ active: false });
    expect(updateHouseholdSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    expect(updateCategorySchema.parse({ archived: true })).toEqual({ archived: true });
  });
});
