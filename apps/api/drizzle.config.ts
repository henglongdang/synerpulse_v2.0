import { defineConfig } from 'drizzle-kit';

// Used only to *generate* SQL migrations from src/db/schema.ts (`npm run db:generate`).
// Migrations are applied at runtime by src/db/client.ts for both PGlite and PostgreSQL.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
