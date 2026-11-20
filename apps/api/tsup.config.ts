import { defineConfig } from 'tsup';

/**
 * Production bundle of the API. The shared workspace package is TypeScript source, so it is
 * bundled in; runtime dependencies (including native/WASM ones) stay external and are installed
 * with `npm ci --omit=dev`. Migrations are read from ../drizzle relative to dist/.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    migrate: 'src/db/migrate-cli.ts',
    seed: 'src/db/seed-cli.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  noExternal: ['@synerpulse/shared'],
});
