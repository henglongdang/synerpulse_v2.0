import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, addMonths, monthKey, todayISO } from '@synerpulse/shared';
import { addMember, client, createTestEnv, registerUser, setupHousehold, type TestEnv } from './helpers';
import { seed, SAMPLE_PASSWORD, SAMPLE_USERS } from '../src/db/seed';
import { sweepHousehold } from '../src/modules/alerts/service';

let env: TestEnv;
let ctx: Awaited<ReturnType<typeof setupHousehold>>;
const today = todayISO();
const month = monthKey(today);

beforeAll(async () => {
  env = await createTestEnv();
  ctx = await setupHousehold(env.app);
});
afterAll(() => env.close());

describe('budgets', () => {
  it('computes budget vs actual live, alerts once at the threshold and once when exceeded', async () => {
    const groceries = ctx.cat('Groceries');
    const put = await ctx.owner.c.put(`${ctx.base}/budgets`, { month, expectedIncomeCents: 500_000, items: [{ categoryId: groceries, amountCents: 10_000 }] });
    expect(put.status).toBe(200);
    const spend = (cents: number) =>
      ctx.owner.c.post(`${ctx.base}/transactions`, { accountId: ctx.checkingId, type: 'expense', amountCents: cents, date: today, description: 'Groceries', categoryId: groceries });
    await spend(8_500); // 85% → threshold alert
    let b = (await ctx.owner.c.get(`${ctx.base}/budgets/${month}`)).body.budget;
    const line = b.groups.find((g: { group: string }) => g.group === 'living').lines.find((l: { categoryId: string }) => l.categoryId === groceries);
    expect(line).toMatchObject({ budgetCents: 10_000, spentCents: 8_500, remainingCents: 1_500, usedBp: 8_500, status: 'warning' });
    await spend(100); // still above threshold — must not alert again
    await spend(2_000); // 106% → exceeded
    b = (await ctx.owner.c.get(`${ctx.base}/budgets/${month}`)).body.budget;
    expect(b.totalSpentCents).toBe(10_600);
    const inbox = (await ctx.owner.c.get('/api/notifications')).body.items as { type: string }[];
    expect(inbox.filter((n) => n.type === 'budget_threshold')).toHaveLength(1);
    expect(inbox.filter((n) => n.type === 'budget_exceeded')).toHaveLength(1);
  });

  it('carries plans forward and restores the previous plan on reset', async () => {
    const next = monthKey(addMonths(today, 1));
    expect((await ctx.owner.c.get(`${ctx.base}/budgets/${next}`)).body.budget.planMonth).toBe(month);
    await ctx.owner.c.put(`${ctx.base}/budgets`, { month: next, items: [{ categoryId: ctx.cat('Groceries'), amountCents: 20_000 }] });
    expect((await ctx.owner.c.get(`${ctx.base}/budgets/${next}`)).body.budget.totalBudgetCents).toBe(20_000);
    const reset = await ctx.owner.c.delete(`${ctx.base}/budgets/${next}`);
    expect(reset.body.budget).toMatchObject({ planMonth: month, totalBudgetCents: 10_000 });
  });

  it('rejects budgets on income categories', async () => {
    const res = await ctx.owner.c.put(`${ctx.base}/budgets`, { month, items: [{ categoryId: ctx.cat('Salary'), amountCents: 1 }] });
    expect(res.status).toBe(400);
  });
});

describe('recurring bills and the forecast', () => {
  it('marks a bill paid: posts a linked entry and advances the schedule', async () => {
    const created = await ctx.owner.c.post(`${ctx.base}/recurring`, {
      kind: 'bill',
      label: 'Rent',
      amountCents: 200_000,
      frequency: 'monthly',
      nextDate: addDays(today, 2),
      accountId: ctx.checkingId,
      categoryId: ctx.cat('Housing'),
    });
    expect(created.status).toBe(201);
    const id = created.body.item.id;
    const pay = await ctx.owner.c.post(`${ctx.base}/recurring/${id}/pay`, {});
    expect(pay.status).toBe(200);
    const items = (await ctx.owner.c.get(`${ctx.base}/recurring`)).body.items;
    expect(items.find((r: { id: string }) => r.id === id).nextDate).toBe(addMonths(addDays(today, 2), 1));
    const txn = (await ctx.owner.c.get(`${ctx.base}/transactions/${pay.body.transactionId}`)).body.transaction;
    expect(txn).toMatchObject({ source: 'recurring', amountCents: -200_000, description: 'Rent' });
  });

  it('returns a transparent forecast and compares a scenario to the baseline', async () => {
    await ctx.owner.c.post(`${ctx.base}/recurring`, { kind: 'income', label: 'Salary', amountCents: 400_000, minAmountCents: 300_000, frequency: 'monthly', nextDate: addDays(today, 5), accountId: ctx.checkingId, categoryId: ctx.cat('Salary') });
    const res = await ctx.owner.c.post(`${ctx.base}/forecast`, { horizonMonths: 6, granularity: 'month', adjustments: [{ kind: 'income_change', basisPoints: -10_000 }] });
    expect(res.status).toBe(200);
    const f = res.body.forecast;
    expect(f.assumptions.startingBalanceCents).toBe(f.baseline.startBalanceCents);
    expect(f.assumptions.incomeStreams[0]).toMatchObject({ label: 'Salary', usedAmountCents: 400_000 });
    expect(f.scenario.endBalanceCents).toBeLessThan(f.baseline.endBalanceCents);
    expect(f.scenario.firstDeficitDate).not.toBeNull();
    expect((await ctx.owner.c.post(`${ctx.base}/forecast`, { horizonMonths: 5 })).status).toBe(400);
  });

  it('saves scenarios for the household', async () => {
    const s = await ctx.owner.c.post(`${ctx.base}/scenarios`, { name: 'Job loss', horizonMonths: 12, granularity: 'week', incomeMode: 'conservative', adjustments: [{ kind: 'income_change', recurringId: null, basisPoints: -10_000 }] });
    expect(s.status).toBe(201);
    expect((await ctx.owner.c.get(`${ctx.base}/scenarios`)).body.scenarios[0].name).toBe('Job loss');
  });
});

describe('goals & automation rules', () => {
  it('tracks contributions, prevents over-withdrawal, and applies a 20% freelance rule', async () => {
    const goal = (await ctx.owner.c.post(`${ctx.base}/goals`, { name: 'Down payment', targetCents: 1_000_000, targetDate: addMonths(today, 10), plannedMonthlyCents: 50_000, icon: 'home' })).body.goal;
    expect(goal).toMatchObject({ savedCents: 0, progressBp: 0, onTrack: false });
    await ctx.owner.c.post(`${ctx.base}/goals/${goal.id}/contributions`, { amountCents: 500_000, date: today });
    expect((await ctx.owner.c.post(`${ctx.base}/goals/${goal.id}/contributions`, { amountCents: -600_000, date: today })).status).toBe(400);
    const rule = await ctx.owner.c.post(`${ctx.base}/rules`, { name: 'Freelance 20%', conditions: { type: 'income', tag: 'freelance' }, actions: { allocateToGoal: { goalId: goal.id, basisPoints: 2000 } } });
    expect(rule.status).toBe(201);
    const inc = await ctx.owner.c.post(`${ctx.base}/transactions`, { accountId: ctx.checkingId, type: 'income', amountCents: 150_000, date: today, description: 'Invoice', categoryId: ctx.cat('Freelance'), tags: ['freelance'] });
    expect(inc.body.appliedRules).toEqual([rule.body.rule.id]);
    const goals = (await ctx.owner.c.get(`${ctx.base}/goals`)).body.goals;
    expect(goals.find((g: { id: string }) => g.id === goal.id).savedCents).toBe(530_000);
    const inbox = (await ctx.owner.c.get('/api/notifications')).body.items as { type: string }[];
    expect(inbox.some((n) => n.type === 'goal_milestone')).toBe(true); // crossed 50%
  });

  it('rejects rules that point at another household’s data', async () => {
    const other = await registerUser(env.app);
    const h = (await other.c.post('/api/households', { name: 'Other', currency: 'USD' })).body.household.id;
    const theirGoal = (await other.c.post(`/api/households/${h}/goals`, { name: 'Theirs', targetCents: 100 })).body.goal.id;
    const res = await ctx.owner.c.post(`${ctx.base}/rules`, { name: 'Steal', conditions: { type: 'income' }, actions: { allocateToGoal: { goalId: theirGoal, basisPoints: 10_000 } } });
    expect(res.status).toBe(400);
  });
});

describe('CSV import', () => {
  const csv = ['Date,Description,Amount,Category', '2026-02-01,Coffee shop,-4.50,Dining out', '2026-02-01,Coffee shop,-4.50,Dining out', '2026-02-03,Refund,12.00,', '2026-02-31,Bad date,-1.00,', '2026-02-05,Formula,=1+1,'].join('\n');
  const body = () => ({ accountId: ctx.checkingId, csv, mapping: { date: 'Date', description: 'Description', amount: 'Amount', category: 'Category' }, dateFormat: 'YYYY-MM-DD' });

  it('previews, flags errors, imports once and detects duplicates on re-import', async () => {
    const preview = (await ctx.owner.c.post(`${ctx.base}/imports/preview`, body())).body;
    expect(preview).toMatchObject({ validCount: 3, errorCount: 2, duplicateCount: 0 });
    const commit = (await ctx.owner.c.post(`${ctx.base}/imports/commit`, body())).body;
    expect(commit.importedCount).toBe(3);
    const again = (await ctx.owner.c.post(`${ctx.base}/imports/preview`, body())).body;
    expect(again).toMatchObject({ validCount: 0, duplicateCount: 3 });
    const coffees = (await ctx.owner.c.get(`${ctx.base}/transactions?q=coffee%20shop`)).body;
    expect(coffees.total).toBe(2); // two identical purchases are both kept
    expect(coffees.items[0]).toMatchObject({ source: 'import', categoryName: 'Dining out', amountCents: -450 });
  });

  it('explains unknown columns', async () => {
    const res = await ctx.owner.c.post(`${ctx.base}/imports/preview`, { ...body(), mapping: { date: 'When', description: 'Description', amount: 'Amount' } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('When');
  });
});

describe('household time zone & settings', () => {
  it('stores the creator’s time zone, rejects unknown zones, and keeps fields on a partial update', async () => {
    const u = await registerUser(env.app);
    expect((await u.c.post('/api/households', { name: 'Tokyo flat', currency: 'JPY', timezone: 'Mars/Olympus' })).status).toBe(400);
    const h = (await u.c.post('/api/households', { name: 'Tokyo flat', currency: 'JPY', timezone: 'Asia/Tokyo' })).body.household.id;
    // Regression: a rename-only PATCH must not reset currency or time zone to their defaults.
    expect((await u.c.patch(`/api/households/${h}`, { name: 'Tokyo apartment' })).status).toBe(200);
    const me = (await u.c.get('/api/auth/me')).body;
    expect(me.households[0]).toMatchObject({ name: 'Tokyo apartment', currency: 'JPY', timezone: 'Asia/Tokyo' });
    expect((await u.c.get(`/api/households/${h}`)).body.household.timezone).toBe('Asia/Tokyo');
  });
});

describe('sample data, dashboard and privacy controls', () => {
  it('seeds a coherent fictional household whose dashboard figures reconcile', async () => {
    const { householdId } = await seed(env.database.db); // seeds "today" in the sample household's own time zone
    await sweepHousehold(householdId, true);
    const mary = client(env.app);
    expect((await mary.post('/api/auth/login', { email: SAMPLE_USERS[0].email, password: SAMPLE_PASSWORD })).status).toBe(200);
    const me = (await mary.get('/api/auth/me')).body;
    expect(me.households[0]).toMatchObject({ name: 'Okafor-Lin Household', isSample: true, role: 'owner', memberCount: 4 });
    const d = (await mary.get(`/api/households/${householdId}/dashboard?range=6M`)).body;
    const accountsTotal = d.accountGroups.reduce((s: number, g: { totalCents: number }) => s + g.totalCents, 0);
    expect(d.netWorth.currentCents).toBe(accountsTotal);
    expect(d.history.at(-1).netWorthCents).toBe(d.netWorth.currentCents);
    expect(d.goals.find((g: { name: string }) => g.name === 'Education fund').progressBp).toBeGreaterThan(8500);
    expect(d.tips.some((t: { kind: string }) => t.kind === 'recurring_charge')).toBe(true); // the "Fortnite" tip
    // Power's private account never reaches Mary.
    expect(d.accountGroups.flatMap((g: { accounts: { name: string }[] }) => g.accounts).some((a: { name: string }) => a.name.includes('personal'))).toBe(false);
    const liam = client(env.app);
    await liam.post('/api/auth/login', { email: SAMPLE_USERS[3].email, password: SAMPLE_PASSWORD });
    expect((await liam.post(`/api/households/${householdId}/transactions`, {})).status).toBe(403);
  });

  it('exports the user’s data and deletes the account', async () => {
    const u = await registerUser(env.app);
    const h = (await u.c.post('/api/households', { name: 'Solo', currency: 'EUR' })).body.household.id;
    await u.c.post(`/api/households/${h}/accounts`, { name: 'Cash', type: 'cash', openingBalanceCents: 1234, openingDate: '2025-01-01' });
    const exp = await u.c.get('/api/me/export');
    expect(exp.status).toBe(200);
    expect(exp.headers['content-disposition']).toContain('attachment');
    expect(exp.body.households[0].accounts[0]).toMatchObject({ name: 'Cash', openingBalanceCents: 1234 });
    expect(JSON.stringify(exp.body)).not.toContain('password');
    expect((await u.c.delete('/api/me', { password: 'wrong' })).status).toBe(400);
    expect((await u.c.delete('/api/me', { password: 'correct horse battery' })).status).toBe(204);
    expect((await u.c.get('/api/auth/me')).status).toBe(401);
    expect((await client(env.app).post('/api/auth/login', { email: u.email, password: 'correct horse battery' })).status).toBe(401);
  });

  it('blocks deleting an account that still owns a household with other members', async () => {
    await addMember(env.app, ctx.owner.c, ctx.hid, 'viewer');
    const res = await ctx.owner.c.delete('/api/me', { password: 'correct horse battery' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('Transfer ownership');
    expect((await ctx.owner.c.get('/api/auth/me')).status).toBe(200);
  });
});
