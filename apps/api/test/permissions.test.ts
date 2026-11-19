import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, createTestEnv, registerUser, setupHousehold, type Client, type TestEnv } from './helpers';

let env: TestEnv;
let ctx: Awaited<ReturnType<typeof setupHousehold>>;
let admin: { c: Client; id: string };
let contributor: { c: Client; id: string };
let viewer: { c: Client; id: string };
let outsider: { c: Client; id: string };
let ownerTxnId: string;

const expense = (accountId: string, categoryId: string | null, extra: object = {}) => ({
  accountId,
  type: 'expense',
  amountCents: 4200,
  date: '2026-03-04',
  description: 'Test entry',
  categoryId,
  ...extra,
});

beforeAll(async () => {
  env = await createTestEnv();
  ctx = await setupHousehold(env.app);
  admin = await addMember(env.app, ctx.owner.c, ctx.hid, 'admin');
  contributor = await addMember(env.app, ctx.owner.c, ctx.hid, 'contributor', [ctx.cat('Groceries')]);
  viewer = await addMember(env.app, ctx.owner.c, ctx.hid, 'viewer');
  outsider = await registerUser(env.app, 'Oscar Outsider');
  await outsider.c.post('/api/households', { name: 'Elsewhere', currency: 'USD' });
  const t = await ctx.owner.c.post(`${ctx.base}/transactions`, expense(ctx.checkingId, ctx.cat('Groceries')));
  ownerTxnId = t.body.transaction.id;
});
afterAll(() => env.close());

describe('cross-household isolation (ID manipulation)', () => {
  it('returns 404 — not 403 — for another household and all of its resources', async () => {
    const o = outsider.c;
    expect((await o.get(ctx.base)).status).toBe(404);
    expect((await o.get(`${ctx.base}/accounts`)).status).toBe(404);
    expect((await o.get(`${ctx.base}/transactions/${ownerTxnId}`)).status).toBe(404);
    expect((await o.get(`${ctx.base}/dashboard`)).status).toBe(404);
    expect((await o.post(`${ctx.base}/transactions`, expense(ctx.checkingId, null))).status).toBe(404);
    expect((await o.patch(`${ctx.base}/transactions/${ownerTxnId}`, { expectedVersion: 1, description: 'pwned' })).status).toBe(404);
    expect((await o.get('/api/households/not-a-uuid/accounts')).status).toBe(404);
  });

  it('cannot reference another household’s account or transaction from inside its own household', async () => {
    const mine = (await outsider.c.get('/api/auth/me')).body.households[0].id;
    const res = await outsider.c.post(`/api/households/${mine}/transactions`, expense(ctx.checkingId, null));
    expect(res.status).toBe(404); // owner's account id is invisible from the outsider's household
    expect((await outsider.c.get(`/api/households/${mine}/transactions/${ownerTxnId}`)).status).toBe(404);
    expect((await outsider.c.get(`/api/households/${mine}/transactions/${ownerTxnId}/history`)).status).toBe(404);
  });

  it('cannot attach a foreign category to its own entries', async () => {
    const mine = (await outsider.c.get('/api/auth/me')).body.households[0].id;
    const acct = await outsider.c.post(`/api/households/${mine}/accounts`, { name: 'Mine', type: 'checking', openingBalanceCents: 0, openingDate: '2025-01-01' });
    const res = await outsider.c.post(`/api/households/${mine}/transactions`, expense(acct.body.account.id, ctx.cat('Groceries')));
    expect(res.status).toBe(400);
  });
});

describe('role enforcement', () => {
  it('viewers can read and comment but not write', async () => {
    expect((await viewer.c.get(`${ctx.base}/transactions`)).status).toBe(200);
    expect((await viewer.c.post(`${ctx.base}/transactions`, expense(ctx.checkingId, ctx.cat('Groceries')))).status).toBe(403);
    expect((await viewer.c.patch(`${ctx.base}/transactions/${ownerTxnId}`, { expectedVersion: 1, description: 'x' })).status).toBe(403);
    expect((await viewer.c.delete(`${ctx.base}/transactions/${ownerTxnId}`)).status).toBe(403);
    expect((await viewer.c.put(`${ctx.base}/budgets`, { month: '2026-03', items: [] })).status).toBe(403);
    expect((await viewer.c.post(`${ctx.base}/transactions/${ownerTxnId}/comments`, { body: 'What was this for?' })).status).toBe(201);
  });

  it('category-scoped contributors can only write in their categories', async () => {
    const ok = await contributor.c.post(`${ctx.base}/transactions`, expense(ctx.checkingId, ctx.cat('Groceries')));
    expect(ok.status).toBe(201);
    expect((await contributor.c.post(`${ctx.base}/transactions`, expense(ctx.checkingId, ctx.cat('Travel')))).status).toBe(403);
    expect((await contributor.c.post(`${ctx.base}/transactions`, expense(ctx.checkingId, null))).status).toBe(403);
    // …and cannot move an allowed entry into a forbidden category.
    const moved = await contributor.c.patch(`${ctx.base}/transactions/${ok.body.transaction.id}`, { expectedVersion: 1, categoryId: ctx.cat('Travel') });
    expect(moved.status).toBe(403);
    // The UI is told which entries are editable.
    const travel = await ctx.owner.c.post(`${ctx.base}/transactions`, expense(ctx.checkingId, ctx.cat('Travel')));
    const asSeen = await contributor.c.get(`${ctx.base}/transactions/${travel.body.transaction.id}`);
    expect(asSeen.body.transaction.canEdit).toBe(false);
  });

  it('contributors cannot manage members, accounts, budgets or rules', async () => {
    expect((await contributor.c.post(`${ctx.base}/invitations`, { role: 'viewer' })).status).toBe(403);
    expect((await contributor.c.post(`${ctx.base}/accounts`, { name: 'X', type: 'checking', openingDate: '2025-01-01' })).status).toBe(403);
    expect((await contributor.c.patch(`${ctx.base}/members/${viewer.id}`, { role: 'admin' })).status).toBe(403);
  });
});

describe('privilege escalation', () => {
  it('admins cannot promote anyone (or themselves) to admin/owner, nor touch the owner', async () => {
    expect((await admin.c.patch(`${ctx.base}/members/${viewer.id}`, { role: 'admin' })).status).toBe(403);
    expect((await admin.c.patch(`${ctx.base}/members/${admin.id}`, { role: 'contributor' })).status).toBe(403);
    expect((await admin.c.patch(`${ctx.base}/members/${ctx.owner.id}`, { role: 'viewer' })).status).toBe(403);
    expect((await admin.c.delete(`${ctx.base}/members/${ctx.owner.id}`)).status).toBe(403);
    expect((await admin.c.post(`${ctx.base}/transfer-ownership`, { userId: admin.id })).status).toBe(403);
    expect((await admin.c.post(`${ctx.base}/invitations`, { role: 'admin' })).status).toBe(403);
    // the zod schema itself never accepts "owner"
    expect((await ctx.owner.c.patch(`${ctx.base}/members/${viewer.id}`, { role: 'owner' })).status).toBe(400);
  });

  it('admins can change lower roles; the member is notified', async () => {
    const res = await admin.c.patch(`${ctx.base}/members/${viewer.id}`, { role: 'contributor' });
    expect(res.status).toBe(200);
    const inbox = (await viewer.c.get('/api/notifications')).body.items;
    expect(inbox.some((n: { type: string }) => n.type === 'role_changed')).toBe(true);
    await admin.c.patch(`${ctx.base}/members/${viewer.id}`, { role: 'viewer' });
  });

  it('only the owner can delete the household, and must confirm by name', async () => {
    expect((await admin.c.delete(ctx.base, { confirmName: 'Test Household' })).status).toBe(403);
    expect((await ctx.owner.c.delete(ctx.base, { confirmName: 'wrong' })).status).toBe(400);
  });
});

describe('private accounts', () => {
  it('are invisible to every other member — including the owner — and to totals', async () => {
    const p = await admin.c.post(`${ctx.base}/accounts`, { name: 'My allowance', type: 'checking', visibility: 'private', openingBalanceCents: 10_000, openingDate: '2025-01-01' });
    expect(p.status).toBe(201);
    const pid = p.body.account.id;
    const t = await admin.c.post(`${ctx.base}/transactions`, expense(pid, ctx.cat('Travel'), { description: 'Secret gift' }));
    expect(t.status).toBe(201);
    const ownerAccounts = (await ctx.owner.c.get(`${ctx.base}/accounts`)).body.accounts;
    expect(ownerAccounts.some((a: { id: string }) => a.id === pid)).toBe(false);
    expect((await ctx.owner.c.get(`${ctx.base}/transactions/${t.body.transaction.id}`)).status).toBe(404);
    const search = (await ctx.owner.c.get(`${ctx.base}/transactions?q=Secret`)).body;
    expect(search.total).toBe(0);
    const feed = (await ctx.owner.c.get(`${ctx.base}/activity`)).body.items;
    expect(feed.some((e: { summary: string }) => e.summary.includes('Secret'))).toBe(false);
    // owner cannot even post into it
    expect((await ctx.owner.c.post(`${ctx.base}/transactions`, expense(pid, ctx.cat('Travel')))).status).toBe(404);
    // the admin sees it in personal scope only
    const personal = (await admin.c.get(`${ctx.base}/transactions?scope=personal`)).body;
    expect(personal.items.map((x: { id: string }) => x.id)).toContain(t.body.transaction.id);
    const household = (await admin.c.get(`${ctx.base}/transactions?scope=household&q=Secret`)).body;
    expect(household.total).toBe(0);
  });
});

describe('invitations', () => {
  it('are single-use, expire, and can be email-restricted', async () => {
    const inv = await ctx.owner.c.post(`${ctx.base}/invitations`, { role: 'viewer', email: 'only-me@example.test' });
    const token = inv.body.invitation.url.split('/invite/')[1];
    const wrong = await registerUser(env.app);
    expect((await wrong.c.post(`/api/invitations/${token}/accept`)).status).toBe(403);
    const preview = await wrong.c.get(`/api/invitations/${token}`);
    expect(preview.body.invitation).toMatchObject({ householdName: 'Test Household', status: 'pending', emailRestricted: true });
    const open = await ctx.owner.c.post(`${ctx.base}/invitations`, { role: 'viewer' });
    const t2 = open.body.invitation.url.split('/invite/')[1];
    const a = await registerUser(env.app);
    const b = await registerUser(env.app);
    expect((await a.c.post(`/api/invitations/${t2}/accept`)).status).toBe(200);
    expect((await b.c.post(`/api/invitations/${t2}/accept`)).status).toBe(410);
    expect((await a.c.get('/api/invitations/garbage-token-that-is-long-enough')).status).toBe(404);
  });

  it('can be revoked', async () => {
    const inv = await ctx.owner.c.post(`${ctx.base}/invitations`, { role: 'viewer' });
    await ctx.owner.c.delete(`${ctx.base}/invitations/${inv.body.invitation.id}`);
    const token = inv.body.invitation.url.split('/invite/')[1];
    const u = await registerUser(env.app);
    expect((await u.c.post(`/api/invitations/${token}/accept`)).status).toBe(410);
  });
});

describe('ownership transfer & leaving', () => {
  it('owner cannot leave without transferring; transfer demotes the old owner to admin', async () => {
    expect((await ctx.owner.c.delete(`${ctx.base}/members/${ctx.owner.id}`)).status).toBe(403);
    const res = await ctx.owner.c.post(`${ctx.base}/transfer-ownership`, { userId: admin.id });
    expect(res.status).toBe(200);
    const roles = Object.fromEntries(res.body.members.map((m: { userId: string; role: string }) => [m.userId, m.role]));
    expect(roles[admin.id]).toBe('owner');
    expect(roles[ctx.owner.id]).toBe('admin');
    // the new owner can now transfer back
    expect((await admin.c.post(`${ctx.base}/transfer-ownership`, { userId: ctx.owner.id })).status).toBe(200);
  });

  it('a removed member immediately loses access', async () => {
    const temp = await addMember(env.app, ctx.owner.c, ctx.hid, 'viewer');
    expect((await temp.c.get(ctx.base)).status).toBe(200);
    expect((await ctx.owner.c.delete(`${ctx.base}/members/${temp.id}`)).status).toBe(204);
    expect((await temp.c.get(ctx.base)).status).toBe(404);
  });
});
