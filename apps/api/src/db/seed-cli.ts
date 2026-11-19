import { loadConfig } from '../config';
import { openDatabase } from './client';
import { sampleExists, seed, SAMPLE_PASSWORD, SAMPLE_USERS } from './seed';
import { setDeps } from '../lib/deps';
import { createConsoleEmail } from '../services/email';
import { createMemoryStorage } from '../services/storage';
import { sweepHousehold } from '../modules/alerts/service';

const config = loadConfig();
if (config.isProd && !process.argv.includes('--allow-production')) {
  console.error('Refusing to seed sample data into a production database (pass --allow-production to override).');
  process.exit(1);
}
const database = await openDatabase({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
await database.migrate();
setDeps({ db: database.db, config, email: createConsoleEmail(), storage: createMemoryStorage() });
if (await sampleExists(database.db)) {
  console.log('Sample household already present — nothing to do. Run `npm run db:reset` first to start over.');
} else {
  const started = Date.now();
  const { householdId } = await seed(database.db);
  await sweepHousehold(householdId, true);
  console.log(`\nSeeded the fictional "Okafor-Lin Household" in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  console.log('Sample sign-ins (development only — all data is fictional):');
  for (const u of SAMPLE_USERS) console.log(`  ${u.role.padEnd(11)} ${u.email}`);
  console.log(`  password    ${SAMPLE_PASSWORD}\n`);
}
await database.close();
