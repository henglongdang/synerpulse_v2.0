import request from 'supertest';
import type { Express } from 'express';
import { loadConfig } from '../src/config';
import { openDatabase, type Database } from '../src/db/client';
import { setDeps } from '../src/lib/deps';
import { createMemoryEmail } from '../src/services/email';
import { createMemoryStorage } from '../src/services/storage';
import { createApp } from '../src/app';

export const ORIGIN = 'http://localhost:5173';

export interface TestEnv {
  app: Express;
  database: Database;
  email: ReturnType<typeof createMemoryEmail>;
  close(): Promise<void>;
}

/**
 * Opens a fresh database for one test file.
 *  - default: embedded PGlite driver (fast).
 *  - TEST_DRIVER=pg: the production node-postgres driver, talking the real Postgres wire protocol to
 *    PGlite via pglite-socket — catches driver differences (type parsing, pooling) without a
 *    Postgres install. Run with `npm run test:pg -w @familypulse/api`.
 */
export async function openTestDatabase(): Promise<Database> {
  if (process.env.TEST_DRIVER !== 'pg') return openDatabase({ pgliteDir: 'memory://' });
  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const pglite = await PGlite.create();
  const server = new PGLiteSocketServer({ db: pglite, port: 0, host: '127.0.0.1' });
  await server.start();
  // PGlite is single-connection; one pooled client mirrors that faithfully (and would deadlock on any
  // code path that wrongly uses a second connection inside a transaction).
  const database = await openDatabase({ databaseUrl: `postgres://postgres:postgres@${server.getServerConn()}/postgres`, poolMax: 1 });
  return {
    ...database,
    close: async () => {
      await database.close();
      await server.stop();
      await pglite.close();
    },
  };
}

export async function createTestEnv(): Promise<TestEnv> {
  const config = loadConfig({ NODE_ENV: 'test', PGLITE_DIR: 'memory://', APP_ORIGIN: ORIGIN } as NodeJS.ProcessEnv);
  const database = await openTestDatabase();
  await database.migrate();
  const email = createMemoryEmail();
  setDeps({ db: database.db, config, email, storage: createMemoryStorage() });
  const app = createApp();
  return { app, database, email, close: () => database.close() };
}

/** A cookie-persisting client that sends the CSRF header like the real web app does. */
export function client(app: Express) {
  const agent = request.agent(app);
  const h = (r: request.Test) => r.set('X-Requested-With', 'familypulse').set('Origin', ORIGIN);
  return {
    agent,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => h(agent.post(url)).send(body ?? {}),
    patch: (url: string, body?: object) => h(agent.patch(url)).send(body ?? {}),
    put: (url: string, body?: object) => h(agent.put(url)).send(body ?? {}),
    delete: (url: string, body?: object) => h(agent.delete(url)).send(body ?? {}),
    upload: (url: string, file: Buffer, filename: string, contentType: string) =>
      h(agent.post(url)).attach('file', file, { filename, contentType }),
  };
}
export type Client = ReturnType<typeof client>;

let counter = 0;
export async function registerUser(app: Express, name = 'Test User'): Promise<{ c: Client; id: string; email: string }> {
  const c = client(app);
  const email = `user${++counter}-${Date.now()}@example.test`;
  const res = await c.post('/api/auth/register', { name, email, password: 'correct horse battery' });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { c, id: res.body.user.id, email };
}

export async function setupHousehold(app: Express) {
  const owner = await registerUser(app, 'Olivia Owner');
  const hRes = await owner.c.post('/api/households', { name: 'Test Household', currency: 'USD' });
  const hid: string = hRes.body.household.id;
  const cats = (await owner.c.get(`/api/households/${hid}/categories`)).body.categories as { id: string; name: string; group: string }[];
  const cat = (name: string) => cats.find((c) => c.name === name)!.id;
  const acct = await owner.c.post(`/api/households/${hid}/accounts`, {
    name: 'Joint Checking',
    type: 'checking',
    visibility: 'shared',
    openingBalanceCents: 500_000,
    openingDate: '2025-01-01',
  });
  return { owner, hid, cat, checkingId: acct.body.account.id as string, base: `/api/households/${hid}` };
}

/** Invite + accept, returning a client for the new member. */
export async function addMember(app: Express, owner: Client, hid: string, role: 'admin' | 'contributor' | 'viewer', categoryScope?: string[], name = `New ${role}`) {
  const inv = await owner.post(`/api/households/${hid}/invitations`, { role, categoryScope });
  if (inv.status !== 201) throw new Error(`invite failed ${inv.status} ${JSON.stringify(inv.body)}`);
  const token = (inv.body.invitation.url as string).split('/invite/')[1];
  const member = await registerUser(app, name);
  const acc = await member.c.post(`/api/invitations/${token}/accept`);
  if (acc.status !== 200) throw new Error(`accept failed ${acc.status} ${JSON.stringify(acc.body)}`);
  return member;
}
