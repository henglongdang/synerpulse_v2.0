import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

/**
 * Both drivers expose the same Drizzle pg-core query builder; we type the handle as the
 * node-postgres flavour so services are written once against standard PostgreSQL.
 */
export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type Executor = DB | Tx;

export interface Database {
  db: DB;
  driver: 'postgres' | 'pglite';
  migrate(): Promise<void>;
  close(): Promise<void>;
}

function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, '../../drizzle'), path.resolve(here, '../drizzle'), path.resolve(process.cwd(), 'drizzle')];
  const found = candidates.find((c) => fs.existsSync(path.join(c, 'meta', '_journal.json')));
  if (!found) throw new Error(`Migrations folder not found (looked in ${candidates.join(', ')})`);
  return found;
}

export async function openDatabase(opts: { databaseUrl?: string; pgliteDir?: string }): Promise<Database> {
  if (opts.databaseUrl && /^postgres(ql)?:\/\//.test(opts.databaseUrl)) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new Pool({ connectionString: opts.databaseUrl, max: 10 });
    const db = drizzle(pool, { schema });
    return {
      db,
      driver: 'postgres',
      migrate: () => migrate(db, { migrationsFolder: migrationsFolder() }),
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const dir = opts.pgliteDir ?? 'memory://';
  if (dir !== 'memory://') fs.mkdirSync(dir, { recursive: true });
  const client = dir === 'memory://' ? new PGlite() : new PGlite(dir);
  const db = drizzle(client, { schema }) as unknown as DB;
  return {
    db,
    driver: 'pglite',
    migrate: () => migrate(db as never, { migrationsFolder: migrationsFolder() }),
    close: () => client.close(),
  };
}
