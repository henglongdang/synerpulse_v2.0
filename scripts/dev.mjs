#!/usr/bin/env node
/**
 * Local launcher with two separate embedded databases:
 *
 *   npm run dev          → blank install (apps/api/data/pglite): register and start fresh
 *   npm run demo         → demo install  (apps/api/data/demo):   fictional sample household pre-loaded
 *   npm run demo:reset   → wipe the demo database and load the sample household again
 *
 * The two never mix, so trying the demo cannot touch your own household's data.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'apps', 'api');
const mode = process.argv[2] ?? 'blank';
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const npx = isWin ? 'npx.cmd' : 'npx';

const env = { ...process.env };
if (mode === 'demo' || mode === 'demo-reset') {
  const demoDir = path.join(apiDir, 'data', 'demo');
  env.PGLITE_DIR = demoDir;
  if (mode === 'demo-reset') {
    fs.rmSync(demoDir, { recursive: true, force: true });
    console.log('Removed the demo database.');
  }
  // Idempotent: loads the fictional household only if it is not there yet.
  const seed = spawnSync(npx, ['tsx', 'src/db/seed-cli.ts'], { cwd: apiDir, env, stdio: 'inherit', shell: isWin });
  if (seed.status !== 0) process.exit(seed.status ?? 1);
  console.log('Demo mode: sign in as mary@sample.familypulse.test / familypulse-demo at http://localhost:5173\n');
} else if (mode !== 'blank') {
  console.error(`Unknown mode "${mode}". Use: blank | demo | demo-reset`);
  process.exit(1);
} else {
  console.log('Blank mode: open http://localhost:5173 and create an account.\n');
}

const dev = spawn(npm, ['run', 'dev:servers'], { cwd: root, env, stdio: 'inherit', shell: isWin });
const stop = () => dev.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
dev.on('exit', (code) => process.exit(code ?? 0));
