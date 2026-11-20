import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { client, createTestEnv, registerUser, type Client, type TestEnv } from './helpers';
import { ensureDemo, resetDemo } from '../src/modules/demo/service';
import { SAMPLE_PASSWORD, SAMPLE_USERS } from '../src/db/seed';

let env: TestEnv;
let mary: Client;
let hid: string;

async function signInMary() {
  const c = client(env.app);
  const r = await c.post('/api/auth/login', { email: SAMPLE_USERS[0].email, password: SAMPLE_PASSWORD });
  expect(r.status).toBe(200);
  return c;
}

beforeAll(async () => {
  env = await createTestEnv();
  await resetDemo(env.database.db);
  mary = await signInMary();
  hid = (await mary.get('/api/auth/me')).body.households[0].id;
});
afterAll(() => env.close());

describe('public demo accounts', () => {
  it('can explore and edit the demo household’s finances', async () => {
    const accounts = (await mary.get(`/api/households/${hid}/accounts`)).body.accounts;
    const res = await mary.post(`/api/households/${hid}/transactions`, {
      accountId: accounts[0].id,
      type: 'expense',
      amountCents: 1234,
      date: accounts[0].openingDate,
      description: 'Visitor test entry',
    });
    expect(res.status).toBe(201);
  });

  it.each([
    ['change the password', (c: Client) => c.post('/api/auth/password/change', { currentPassword: SAMPLE_PASSWORD, newPassword: 'hijacked-password' })],
    ['rename the profile', (c: Client) => c.patch('/api/auth/me', { name: 'Hijacked' })],
    ['delete the account', (c: Client) => c.delete('/api/me', { password: SAMPLE_PASSWORD })],
    ['delete the household', (c: Client) => c.delete(`/api/households/${hid}`, { confirmName: 'Okafor-Lin Household' })],
    ['rename the household', (c: Client) => c.patch(`/api/households/${hid}`, { name: 'Hijacked' })],
    ['invite outsiders', (c: Client) => c.post(`/api/households/${hid}/invitations`, { role: 'viewer' })],
    ['create another household', (c: Client) => c.post('/api/households', { name: 'Elsewhere' })],
  ])('cannot %s (403 demo_locked)', async (_what, act) => {
    const res = await act(mary);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('demo_locked');
  });

  it('cannot sign other visitors out or remove members', async () => {
    const sessions = (await mary.get('/api/auth/sessions')).body.sessions;
    expect((await mary.delete(`/api/auth/sessions/${sessions[0].id}`)).status).toBe(403);
    const members = (await mary.get(`/api/households/${hid}/members`)).body.members;
    const power = members.find((m: { email: string }) => m.email === SAMPLE_USERS[1].email);
    expect((await mary.delete(`/api/households/${hid}/members/${power.userId}`)).status).toBe(403);
  });

  it('never emails password-reset links for demo accounts', async () => {
    const before = env.email.outbox.length;
    const res = await client(env.app).post('/api/auth/password/forgot', { email: SAMPLE_USERS[0].email });
    expect(res.status).toBe(200);
    expect(env.email.outbox.length).toBe(before);
  });

  it('does not restrict ordinary accounts', async () => {
    const u = await registerUser(env.app);
    expect((await u.c.post('/api/households', { name: 'Mine' })).status).toBe(201);
    expect((await u.c.patch('/api/auth/me', { name: 'Renamed' })).status).toBe(200);
  });

  it('reset restores the original sample and signs visitors out', async () => {
    expect((await mary.get(`/api/households/${hid}/transactions?q=Visitor`)).body.total).toBe(1);
    await resetDemo(env.database.db);
    expect((await mary.get('/api/auth/me')).status).toBe(401);
    const fresh = await signInMary();
    const newHid = (await fresh.get('/api/auth/me')).body.households[0].id;
    expect((await fresh.get(`/api/households/${newHid}/transactions?q=Visitor`)).body.total).toBe(0);
    expect((await fresh.get(`/api/households/${newHid}/members`)).body.members).toHaveLength(4);
  });

  it('resets by age, so it stays correct on hosts that sleep idle servers', async () => {
    expect(await ensureDemo(env.database.db, 24)).toBe('fresh');
    expect(await ensureDemo(env.database.db, 24, new Date(Date.now() + 25 * 3_600_000))).toBe('reset');
    expect(await ensureDemo(env.database.db, 0, new Date(Date.now() + 999 * 3_600_000))).toBe('fresh'); // 0 = never reset
  });

  it('exposes the demo login only when demo mode is on', async () => {
    const res = await request(env.app).get('/api/demo');
    expect(res.body).toEqual({ enabled: false });
  });
});
