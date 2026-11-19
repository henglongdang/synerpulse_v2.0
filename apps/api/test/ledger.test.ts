import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, createTestEnv, setupHousehold, type TestEnv } from './helpers';

let env: TestEnv;
let ctx: Awaited<ReturnType<typeof setupHousehold>>;
const T = () => `${ctx.base}/transactions`;

const entry = (patch: object = {}) => ({
  accountId: ctx.checkingId,
  type: 'expense',
  amountCents: 2599,
  date: '2026-02-10',
  description: 'Groceries',
  merchant: 'Corner Co-op',
  categoryId: ctx.cat('Groceries'),
  tags: ['weekly'],
  ...patch,
});

beforeAll(async () => {
  env = await createTestEnv();
  ctx = await setupHousehold(env.app);
});
afterAll(() => env.close());

describe('creating entries', () => {
  it('stores signed integer cents and returns a complete DTO', async () => {
    const res = await ctx.owner.c.post(T(), entry());
    expect(res.status).toBe(201);
    expect(res.body.transaction).toMatchObject({ amountCents: -2599, type: 'expense', categoryName: 'Groceries', tags: ['weekly'], version: 1, canEdit: true });
    const inc = await ctx.owner.c.post(T(), entry({ type: 'income', amountCents: 100_000, description: 'Paycheck', categoryId: ctx.cat('Salary'), tags: [] }));
    expect(inc.body.transaction.amountCents).toBe(100_000);
  });

  it.each([
    [{ amountCents: -5 }, 'amountCents'],
    [{ amountCents: 10.5 }, 'amountCents'],
    [{ date: '2026-02-30' }, 'date'],
    [{ date: '2024-12-31' }, 'date'], // before the account opened
    [{ description: '' }, 'description'],
    [{ categoryId: null, type: 'income', amountCents: 5, description: 'x', tags: ['ok', 'bad!tag'] }, 'tags.1'],
  ])('rejects invalid input %o', async (patch, field) => {
    const res = await ctx.owner.c.post(T(), entry(patch));
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details ?? { date: 1 })).toContain(field);
  });

  it('rejects category/type mismatches (income in a spending category)', async () => {
    const res = await ctx.owner.c.post(T(), entry({ type: 'income', categoryId: ctx.cat('Groceries') }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.categoryId).toBeDefined();
  });

  it('is idempotent on clientRequestId (safe offline retries)', async () => {
    const clientRequestId = randomUUID();
    const a = await ctx.owner.c.post(T(), entry({ clientRequestId, description: 'Retry me' }));
    const b = await ctx.owner.c.post(T(), entry({ clientRequestId, description: 'Retry me' }));
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.transaction.id).toBe(a.body.transaction.id);
    expect((await ctx.owner.c.get(`${T()}?q=Retry`)).body.total).toBe(1);
  });
});

describe('listing', () => {
  beforeAll(async () => {
    for (let i = 1; i <= 12; i++) {
      await ctx.owner.c.post(T(), entry({ description: `Coffee ${i}`, amountCents: 100 * i, date: `2026-01-${String(i).padStart(2, '0')}`, categoryId: ctx.cat('Dining out'), tags: i % 2 ? ['caffeine'] : [] }));
    }
  });

  it('paginates with a stable total', async () => {
    const p1 = (await ctx.owner.c.get(`${T()}?q=coffee&pageSize=5&page=1`)).body;
    const p3 = (await ctx.owner.c.get(`${T()}?q=coffee&pageSize=5&page=3`)).body;
    expect(p1.total).toBe(12);
    expect(p1.items).toHaveLength(5);
    expect(p3.items).toHaveLength(2);
  });

  it('sorts by amount and date', async () => {
    const asc = (await ctx.owner.c.get(`${T()}?q=coffee&sort=amount&dir=asc&pageSize=3`)).body.items.map((t: { amountCents: number }) => t.amountCents);
    expect(asc).toEqual([-100, -200, -300]);
    const desc = (await ctx.owner.c.get(`${T()}?q=coffee&sort=date&dir=desc&pageSize=1`)).body.items[0];
    expect(desc.date).toBe('2026-01-12');
  });

  it('filters by tag, category, type and date range', async () => {
    expect((await ctx.owner.c.get(`${T()}?tag=caffeine`)).body.total).toBe(6);
    expect((await ctx.owner.c.get(`${T()}?categoryId=${ctx.cat('Dining out')}&from=2026-01-05&to=2026-01-07`)).body.total).toBe(3);
    expect((await ctx.owner.c.get(`${T()}?type=income`)).body.items.every((t: { type: string }) => t.type === 'income')).toBe(true);
  });

  it('treats LIKE wildcards in search literally and rejects malformed filters', async () => {
    expect((await ctx.owner.c.get(`${T()}?q=%25`)).body.total).toBe(0);
    expect((await ctx.owner.c.get(`${T()}?pageSize=1000`)).status).toBe(400);
    expect((await ctx.owner.c.get(`${T()}?from=yesterday`)).status).toBe(400);
  });
});

describe('collaborative editing', () => {
  it('records a version-controlled history and supports revert', async () => {
    const created = (await ctx.owner.c.post(T(), entry({ description: 'Hardware store' }))).body.transaction;
    const v2 = await ctx.owner.c.patch(`${T()}/${created.id}`, { expectedVersion: 1, amountCents: 4999, notes: 'Includes paint' });
    expect(v2.status).toBe(200);
    expect(v2.body.transaction).toMatchObject({ version: 2, amountCents: -4999, notes: 'Includes paint' });
    const hist = (await ctx.owner.c.get(`${T()}/${created.id}/history`)).body.revisions;
    expect(hist.map((r: { version: number }) => r.version)).toEqual([2, 1]);
    expect(hist[0].changes.map((c: { field: string }) => c.field).sort()).toEqual(['amount', 'notes']);
    const reverted = await ctx.owner.c.post(`${T()}/${created.id}/revert`, { version: 1, expectedVersion: 2 });
    expect(reverted.body.transaction).toMatchObject({ version: 3, amountCents: -2599, notes: null });
    expect((await ctx.owner.c.get(`${T()}/${created.id}/history`)).body.revisions[0].action).toBe('reverted');
  });

  it('detects conflicting edits (optimistic concurrency) and returns the current copy', async () => {
    const admin = await addMember(env.app, ctx.owner.c, ctx.hid, 'admin', undefined, 'Ari Admin');
    const t = (await ctx.owner.c.post(T(), entry({ description: 'Shared dinner' }))).body.transaction;
    expect((await admin.c.patch(`${T()}/${t.id}`, { expectedVersion: 1, amountCents: 6000 })).status).toBe(200);
    const stale = await ctx.owner.c.patch(`${T()}/${t.id}`, { expectedVersion: 1, amountCents: 5000 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.current).toMatchObject({ version: 2, amountCents: -6000, updatedBy: { name: 'Ari Admin' } });
  });

  it('soft-deletes and restores (error recovery)', async () => {
    const t = (await ctx.owner.c.post(T(), entry({ description: 'Oops entry' }))).body.transaction;
    expect((await ctx.owner.c.delete(`${T()}/${t.id}`)).status).toBe(204);
    expect((await ctx.owner.c.get(`${T()}/${t.id}`)).status).toBe(404);
    const restored = await ctx.owner.c.post(`${T()}/${t.id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.transaction.version).toBe(3);
  });

  it('threads comments, notifies @mentions, and logs activity', async () => {
    const member = await addMember(env.app, ctx.owner.c, ctx.hid, 'contributor', undefined, 'Casey Contributor');
    const t = (await ctx.owner.c.post(T(), entry({ description: 'Pharmacy' }))).body.transaction;
    const res = await ctx.owner.c.post(`${T()}/${t.id}/comments`, { body: 'Was this the prescription refill?', mentions: [member.id, randomUUID()] });
    expect(res.status).toBe(201);
    expect(res.body.comments[0].mentions).toEqual([{ id: member.id, name: 'Casey Contributor' }]); // unknown ids dropped
    const inbox = (await member.c.get('/api/notifications')).body;
    expect(inbox.items[0]).toMatchObject({ type: 'mention', link: `/ledger?txn=${t.id}` });
    expect(inbox.unread).toBeGreaterThan(0);
    const feed = (await member.c.get(`${ctx.base}/activity`)).body.items;
    expect(feed.some((e: { action: string }) => e.action === 'commented')).toBe(true);
  });
});

describe('transfers', () => {
  it('posts two balanced legs that are excluded from income/spend and delete together', async () => {
    const sav = (await ctx.owner.c.post(`${ctx.base}/accounts`, { name: 'Savings', type: 'savings', openingBalanceCents: 0, openingDate: '2025-01-01' })).body.account;
    const before = (await ctx.owner.c.get(`${ctx.base}/budgets/2026-02`)).body.budget.totalSpentCents;
    const tr = await ctx.owner.c.post(`${T()}/transfers`, { fromAccountId: ctx.checkingId, toAccountId: sav.id, amountCents: 50_000, date: '2026-02-11', description: 'To savings' });
    expect(tr.status).toBe(201);
    const after = (await ctx.owner.c.get(`${ctx.base}/budgets/2026-02`)).body.budget.totalSpentCents;
    expect(after).toBe(before);
    const accts = (await ctx.owner.c.get(`${ctx.base}/accounts`)).body.accounts;
    expect(accts.find((a: { id: string }) => a.id === sav.id).balanceCents).toBe(50_000);
    await ctx.owner.c.delete(`${T()}/${tr.body.transaction.id}`);
    const accts2 = (await ctx.owner.c.get(`${ctx.base}/accounts`)).body.accounts;
    expect(accts2.find((a: { id: string }) => a.id === sav.id).balanceCents).toBe(0);
    expect((await ctx.owner.c.post(`${T()}/transfers`, { fromAccountId: sav.id, toAccountId: sav.id, amountCents: 1, date: '2026-02-11' })).status).toBe(400);
  });

  it('records balance updates as auditable adjustments', async () => {
    const inv = (await ctx.owner.c.post(`${ctx.base}/accounts`, { name: 'Brokerage', type: 'investment', openingBalanceCents: 100_000, openingDate: '2025-01-01' })).body.account;
    const res = await ctx.owner.c.post(`${ctx.base}/accounts/${inv.id}/balance`, { balanceCents: 112_345, date: '2026-02-01', note: 'Statement' });
    expect(res.body).toEqual({ adjusted: true, balanceCents: 112_345 });
    const adj = (await ctx.owner.c.get(`${T()}?accountId=${inv.id}`)).body.items[0];
    expect(adj).toMatchObject({ type: 'adjustment', amountCents: 12_345, source: 'adjustment' });
  });

  it('rejects positive opening balances on debts', async () => {
    const res = await ctx.owner.c.post(`${ctx.base}/accounts`, { name: 'Card', type: 'credit_card', openingBalanceCents: 5000, openingDate: '2025-01-01' });
    expect(res.status).toBe(400);
  });
});

describe('attachments', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fe0def46b80000000049454e44ae426082', 'hex');
  it('accepts real images, rejects spoofed types, and serves them privately', async () => {
    const t = (await ctx.owner.c.post(T(), entry({ description: 'Receipt test' }))).body.transaction;
    const ok = await ctx.owner.c.upload(`${T()}/${t.id}/attachments`, png, 'receipt.png', 'image/png');
    expect(ok.status).toBe(201);
    const spoof = await ctx.owner.c.upload(`${T()}/${t.id}/attachments`, Buffer.from('<script>alert(1)</script>'), 'x.png', 'image/png');
    expect(spoof.status).toBe(400);
    const html = await ctx.owner.c.upload(`${T()}/${t.id}/attachments`, Buffer.from('<html>'), 'x.html', 'text/html');
    expect(html.status).toBe(400);
    const list = (await ctx.owner.c.get(`${T()}/${t.id}/attachments`)).body.attachments;
    expect(list).toHaveLength(1);
    const file = await ctx.owner.c.get(`${T()}/${t.id}/attachments/${list[0].id}`);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['cache-control']).toContain('no-store');
  });
});

describe('CSV export', () => {
  it('neutralises spreadsheet formula injection', async () => {
    await ctx.owner.c.post(T(), entry({ description: '=HYPERLINK("http://evil")', date: '2026-02-12' }));
    const res = await ctx.owner.c.get(`${T()}/export.csv?q=HYPERLINK`);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(res.text).toContain('-25.99');
  });
});
