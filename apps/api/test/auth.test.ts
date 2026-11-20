import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { client, createTestEnv, ORIGIN, registerUser, type TestEnv } from './helpers';
import { sessions, users } from '../src/db/schema';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.close());

describe('registration & login', () => {
  it('registers, sets an httpOnly SameSite session cookie and stores only an Argon2id hash', async () => {
    const c = client(env.app);
    const res = await c.post('/api/auth/register', { name: 'Ada', email: 'Ada@Example.test', password: 'a long enough password' });
    expect(res.status).toBe(201);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/fp_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const [row] = await env.database.db.select().from(users).where(eq(users.id, res.body.user.id));
    expect(row.email).toBe('ada@example.test');
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain('a long enough password');
    const [s] = await env.database.db.select().from(sessions).where(eq(sessions.userId, row.id));
    expect(cookie).not.toContain(s.tokenHash); // DB holds a hash, not the token
    expect((await c.get('/api/auth/me')).body.user.email).toBe('ada@example.test');
  });

  it('rejects weak passwords and invalid emails with field details', async () => {
    const res = await client(env.app).post('/api/auth/register', { name: 'X', email: 'nope', password: 'short' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details)).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('rejects duplicate emails case-insensitively', async () => {
    await client(env.app).post('/api/auth/register', { name: 'A', email: 'dup@example.test', password: 'password-123456' });
    const res = await client(env.app).post('/api/auth/register', { name: 'B', email: 'DUP@example.test', password: 'password-123456' });
    expect(res.status).toBe(409);
  });

  it('uses one generic message for unknown email and wrong password', async () => {
    const { email } = await registerUser(env.app);
    const a = await client(env.app).post('/api/auth/login', { email, password: 'wrong password!!' });
    const b = await client(env.app).post('/api/auth/login', { email: 'nobody@example.test', password: 'wrong password!!' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('logs out and invalidates the session server-side', async () => {
    const { c } = await registerUser(env.app);
    expect((await c.get('/api/auth/me')).status).toBe(200);
    expect((await c.post('/api/auth/logout')).status).toBe(204);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('requires authentication for protected routes', async () => {
    expect((await request(env.app).get('/api/auth/me')).status).toBe(401);
    expect((await request(env.app).get('/api/notifications')).status).toBe(401);
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without the custom header', async () => {
    const res = await request(env.app).post('/api/auth/login').send({ email: 'a@b.test', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf');
  });
  it('rejects requests from a foreign Origin', async () => {
    const res = await request(env.app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'synerpulse')
      .set('Origin', 'https://evil.example')
      .send({ email: 'a@b.test', password: 'x' });
    expect(res.status).toBe(403);
  });
  it('accepts same-origin requests', async () => {
    const res = await request(env.app).post('/api/auth/login').set('X-Requested-With', 'synerpulse').set('Origin', ORIGIN).send({ email: 'a@b.test', password: 'xxxxxxxxxxxx' });
    expect(res.status).toBe(401);
  });
});

describe('password reset & change', () => {
  it('resets via a single-use emailed token and signs out other sessions', async () => {
    const { c, email } = await registerUser(env.app);
    const anon = client(env.app);
    const r1 = await anon.post('/api/auth/password/forgot', { email });
    expect(r1.status).toBe(200);
    // Same response for unknown emails (no account enumeration).
    const r2 = await anon.post('/api/auth/password/forgot', { email: 'ghost@example.test' });
    expect(r2.body).toEqual(r1.body);
    const msg = env.email.outbox.find((m) => m.to === email)!;
    const token = /token=([\w-]+)/.exec(msg.text)![1];
    expect((await anon.post('/api/auth/password/reset', { token, password: 'brand new password' })).status).toBe(200);
    expect((await anon.post('/api/auth/password/reset', { token, password: 'another new password' })).status).toBe(400);
    expect((await c.get('/api/auth/me')).status).toBe(401); // old session revoked
    expect((await anon.post('/api/auth/login', { email, password: 'brand new password' })).status).toBe(200);
  });

  it('changes password only with the current password', async () => {
    const { c } = await registerUser(env.app);
    expect((await c.post('/api/auth/password/change', { currentPassword: 'nope', newPassword: 'another password!' })).status).toBe(400);
    expect((await c.post('/api/auth/password/change', { currentPassword: 'correct horse battery', newPassword: 'another password!' })).status).toBe(204);
    expect((await c.get('/api/auth/me')).status).toBe(200); // current session kept
  });

  it('lists sessions and revokes one, but never another user’s', async () => {
    const a = await registerUser(env.app);
    const b = await registerUser(env.app);
    const list = (await a.c.get('/api/auth/sessions')).body.sessions;
    expect(list).toHaveLength(1);
    expect(list[0].current).toBe(true);
    expect((await b.c.delete(`/api/auth/sessions/${list[0].id}`)).status).toBe(404);
    expect((await b.c.delete('/api/auth/sessions/not-a-uuid')).status).toBe(404);
    expect((await a.c.delete(`/api/auth/sessions/${list[0].id}`)).status).toBe(204);
    expect((await a.c.get('/api/auth/me')).status).toBe(401);
  });
});

describe('hardening', () => {
  it('sets security headers and disables caching of API responses', async () => {
    const res = await request(env.app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
  it('rejects malformed and oversized JSON bodies cleanly', async () => {
    const bad = await request(env.app).post('/api/auth/login').set('X-Requested-With', 'synerpulse').set('Content-Type', 'application/json').send('{"email":');
    expect(bad.status).toBe(400);
    const big = await request(env.app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'synerpulse')
      .send({ email: 'a@b.test', password: 'x'.repeat(2_000_000) });
    expect(big.status).toBe(413);
  });
  it('returns JSON 404s for unknown endpoints without leaking internals', async () => {
    const res = await request(env.app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
