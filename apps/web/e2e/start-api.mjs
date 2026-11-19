// Starts an isolated API for end-to-end tests: fresh embedded database, sample data, no rate limits.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../api');
const dataDir = path.join(apiDir, 'data', 'e2e');
fs.rmSync(dataDir, { recursive: true, force: true });
const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: '4100',
  PGLITE_DIR: dataDir,
  APP_ORIGIN: 'http://localhost:5174',
  RATE_LIMIT_ENABLED: 'false',
  ALERT_SWEEP_MINUTES: '0',
  LOG_LEVEL: 'warn',
  UPLOAD_DIR: path.join(apiDir, 'data', 'e2e-uploads'),
};
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const seed = spawnSync(npx, ['tsx', 'src/db/seed-cli.ts'], { cwd: apiDir, env, stdio: 'inherit', shell: process.platform === 'win32' });
if (seed.status !== 0) process.exit(seed.status ?? 1);
const server = spawn(npx, ['tsx', 'src/index.ts'], { cwd: apiDir, env, stdio: 'inherit', shell: process.platform === 'win32' });
const stop = () => server.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
