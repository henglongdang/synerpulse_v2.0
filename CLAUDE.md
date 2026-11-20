# FamilyPulse v2.0 — working notes for Claude Code

Full-stack implementation of the HCII 2025 paper *Revolutionizing Household Finance* (Dang & Ding). The original brief is in `Prompt.md`.
**Start every session by reading `docs/DEVELOPMENT_LOG.md` → "Next session: start here".**

## Layout
- `packages/shared`: money (integer cents, basis points), ISO-date helpers, role/permission matrix, Zod request schemas, DTO types. Both apps import it as TS source.
- `apps/api`: Express 5 + Drizzle ORM on PostgreSQL. PGlite (embedded Postgres, `./data/pglite`) is used when `DATABASE_URL` is unset.
  - `src/modules/<feature>/{routes,service}.ts`
  - Pure engines: `forecast/engine.ts`, `rules/engine.ts`, `finance/{recurrence,goals}.ts`
  - Migrations live in `apps/api/drizzle/` (generate with `npm run db:generate -w @familypulse/api`)
- `apps/web`: React 19 + Vite 7 + React Router 7 + TanStack Query. Hand-written CSS design system in `src/styles/`, D3-based charts in `src/components/charts.tsx`, PWA via vite-plugin-pwa.
- `brand/`: logo vectorised from the prototype art. Do not redraw it; see `brand/README.md`.
- `HCII 2025 International Paper/`: research source material. Read-only. The license form is git-ignored on purpose.

## Commands (run from the repo root)
- `npm run db:seed`, then `npm run dev` → API :4000 plus web :5173. Demo login: `mary@sample.familypulse.test` / `familypulse-demo`
- Tests: `npm test` (shared + api + web unit), `npm run test:pg` (API suite through the production node-postgres driver), `npm run test:e2e` (Playwright starts its own isolated API :4100 and web :5174)
- `npm run lint`, `npm run typecheck`, `npm run db:reset` (dev only)
- Production: `npm run build`, then from `apps/api` run `npm start` (migrates, then serves the API + `WEB_DIST_DIR`). Docker: `docker compose up --build` (verified only by CI; see `docs/DEPLOYMENT.md`)

## Conventions and gotchas (learned the hard way)
- **Money is integer cents** end to end; percentages are basis points. Never add floats to money.
- **Every household query filters by `household_id`**, and account visibility goes through `accountVisibility()`. Foreign IDs return **404, not 403**.
- **Correlated subqueries must reference the outer table by literal name** (`"accounts"."id"`). Drizzle renders single-table columns unqualified, so they silently bind to the inner table.
- Transactions use optimistic concurrency (`expectedVersion` → 409 with `current`). Every write appends to `transaction_revisions` and `activity_events`.
- express-rate-limit limiters must be created at module load; they're toggled with `skip`.
- **A household's "today" is `householdToday(h)` / `todayInZone(tz)`**, never `todayISO()`, which is UTC. At 8 pm in Los Angeles, UTC is already tomorrow.
- **Never build update schemas with `.partial()` over schemas that have `.default()`s.** Zod 4 keeps the defaults, so partial PATCHes silently reset fields. Write update schemas explicitly; the shared tests assert "no injected defaults".
- Web imports `@familypulse/shared/client` (no Zod in the browser); the API imports `@familypulse/shared`.
- Use the shared `ui.tsx` components, not new variants. Charts follow the dataviz rules: legend for ≥ 2 series, a table view, a true minus sign, one tick style per axis.
- Windows/Git Bash: pass Windows paths to Node scripts (`cygpath -w`), set `MSYS_NO_PATHCONV=1` for `/`-style args, and avoid heredocs that contain typographic quotes (use the Write tool). Editors may turn `﻿` into a raw BOM, so use `charCodeAt(0) === 0xfeff`.
- **Background servers on Windows.** Stopping the shell (TaskStop) leaves child `node` processes running, which lock `node_modules` and ports. Afterwards, stop leftovers in PowerShell: `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ? CommandLine -match 'FamilyPulse' | % { Stop-Process -Id $_.ProcessId -Force }`.
- If `npm ls` crashes or packages vanish after an aborted install, run `npm ci` (after stopping servers).
- In bash, don't chain `git commit` after a `grep` of test output: `grep` succeeds even when tests fail. Check the suites first.
- Commit messages end with the Co-Authored-By line given in the session; commit at milestones.
