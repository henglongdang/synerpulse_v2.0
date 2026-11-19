import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { loadConfig } from '../config';
import { openDatabase } from './client';

const config = loadConfig();
if (config.isProd) {
  console.error('db:reset is disabled in production.');
  process.exit(1);
}
if (config.databaseUrl) {
  if (!process.argv.includes('--yes')) {
    console.error('This drops every table in the configured PostgreSQL database. Re-run with --yes to confirm.');
    process.exit(1);
  }
  const database = await openDatabase({ databaseUrl: config.databaseUrl });
  await database.db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await database.close();
  console.log('PostgreSQL schema dropped.');
} else {
  const dir = path.resolve(config.pgliteDir);
  if (!dir.startsWith(path.resolve('.'))) {
    console.error(`Refusing to delete ${dir}: outside the project directory.`);
    process.exit(1);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`Removed embedded database at ${dir}.`);
}
console.log('Run `npm run db:seed` to load the sample household again.');
