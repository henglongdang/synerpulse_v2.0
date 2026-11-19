import { loadConfig } from '../config';
import { openDatabase } from './client';

const config = loadConfig();
const database = await openDatabase({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
await database.migrate();
console.log(`Migrations applied (${database.driver}).`);
await database.close();
