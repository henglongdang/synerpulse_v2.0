import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { loadConfig } from '../src/config';
import { openDatabase, type Database } from '../src/db/client';
import { setDeps } from '../src/lib/deps';
import { createMemoryEmail } from '../src/services/email';
import { createMemoryStorage } from '../src/services/storage';
import { createApp } from '../src/app';
import { ORIGIN } from './helpers';

// Rate limiting is disabled in the other suites; this one runs the app with it switched on.
let app: Express;
let database: Database;
beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: ORIGIN, RATE_LIMIT_ENABLED: 'true' } as NodeJS.ProcessEnv);
  database = await openDatabase({ pgliteDir: 'memory://' });
  await database.migrate();
  setDeps({ db: database.db, config, email: createMemoryEmail(), storage: createMemoryStorage() });
  app = createApp();
});
afterAll(() => database.close());

describe('rate limiting', () => {
  it('locks out repeated failed sign-ins for one account with 429', async () => {
    const attempt = () =>
      request(app).post('/api/auth/login').set('X-Requested-With', 'familypulse').set('Origin', ORIGIN).send({ email: 'victim@example.test', password: 'wrong-password' });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await attempt()).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    const res = await attempt();
    expect(res.body.error.code).toBe('rate_limited');
    expect(res.headers['ratelimit-policy'] ?? res.headers['ratelimit']).toBeDefined();
  });

  it('keys credential limits per target email, so other accounts still work', async () => {
    const res = await request(app).post('/api/auth/login').set('X-Requested-With', 'familypulse').set('Origin', ORIGIN).send({ email: 'someone-else@example.test', password: 'x' });
    expect(res.status).toBe(401);
  });
});
