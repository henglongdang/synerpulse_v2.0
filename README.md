# FamilyPulse

A collaborative, forward-looking household finance app: one shared place for accounts, budgets, bills, goals and the conversation around every entry, plus a cash-flow planner for testing a decision before you make it.

FamilyPulse is the software implementation of *Revolutionizing Household Finance: A User-Centered Platform for Holistic Financial Management* (Dang & Ding, HCI International 2025). The research materials are in `HCII 2025 International Paper/`, and the mapping from paper to software is in `docs/PROJECT_UNDERSTANDING.md`.

> **Status:** feature-complete v2.0 with a verified production build. The Docker image is built and tested by CI (not locally). It is not deployed anywhere. See `docs/DEVELOPMENT_LOG.md`.

## Tech stack
- **Web:** React 19, Vite 7, React Router 7, TanStack Query, D3 (scales and shapes), hand-built CSS design system, PWA (Workbox)
- **API:** Node.js 20+, Express 5, Zod, Drizzle ORM, Argon2id, Pino
- **Database:** PostgreSQL. Development and tests use **PGlite**, an embedded Postgres, so nothing needs installing.
- **Tests:** Vitest (unit and integration), Testing Library, Playwright (E2E on desktop, iPhone, Android and iPad profiles)

## Quick start
Prerequisite: Node.js 20.19 or newer (developed on Node 26).

```bash
npm install
npm run db:seed        # creates the embedded database and a FICTIONAL sample household
npm run dev            # API on http://localhost:4000, web on http://localhost:5173
```

Open http://localhost:5173 and sign in with the sample data (fictional names and figures):

| Role | Email | Password |
|---|---|---|
| Owner | mary@sample.familypulse.test | familypulse-demo |
| Admin | power@sample.familypulse.test | familypulse-demo |
| Contributor (Groceries & Dining out only) | luna@sample.familypulse.test | familypulse-demo |
| Viewer | liam@sample.familypulse.test | familypulse-demo |

Or register a new account to go through onboarding. In development, password-reset and invitation emails are printed to the API console.

## Scripts (from the repo root)
| Command | What it does |
|---|---|
| `npm run dev` | API (watch) + web dev server |
| `npm run db:migrate` / `db:seed` / `db:reset` | Apply migrations, load sample data, wipe the dev database |
| `npm test` | Shared, API and web unit/integration tests |
| `npm run test:pg` | API suite through the production node-postgres driver (no Postgres install needed) |
| `npm run test:e2e` | Playwright; starts its own isolated API and web servers. First run `npx playwright install chromium` in `apps/web` |
| `npm run lint` / `npm run typecheck` | ESLint, TypeScript |
| `npm run build` | Production build of web and API; then `cd apps/api && npm start` (migrates, then serves both) |

## Configuration
See `.env.example`. With no configuration the API uses the embedded database at `apps/api/data/pglite`. Set `DATABASE_URL=postgres://…` to use PostgreSQL; the same migrations apply.

## Deployment (recommended shape)
A single Node service serves the API and the built web app (`WEB_DIST_DIR`) from one origin, behind TLS, with managed PostgreSQL and SMTP for email. `docker compose up --build` runs the app with PostgreSQL locally. Full guidance and a pre-launch checklist are in `docs/DEPLOYMENT.md`.

## Known limitations
- No live bank connections: data comes from manual entry and CSV import, and FamilyPulse never asks for banking passwords.
- Notifications are in-app only (no email or push delivery yet). There is no receipt OCR. Export is CSV and JSON (no PDF or Excel).
- One currency per household. No edit-approval workflow, 2FA or email verification yet.
- Smart Tips and forecasts are transparent rules and simulations, not machine learning, and not financial advice.
- The Docker image is built and smoke-tested in CI only (Docker was unavailable on the development machine).
- Current balances include entries dated in the future (see the development log).

## Documentation
- `docs/PROJECT_UNDERSTANDING.md`: research summary, prototype assessment, architecture rationale
- `docs/IMPLEMENTATION_ROADMAP.md`, `docs/FEATURE_IMPLEMENTATION.md`: plan and status
- `docs/DEVELOPMENT_LOG.md`: decisions, fixes, test results, next steps
- `docs/ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md`, `docs/API.md`: engineering reference
- `docs/SECURITY_AND_PRIVACY.md`, `docs/DEPLOYMENT.md`: operations
- `docs/DESIGN_SYSTEM.md`: tokens, components, chart rules
- `docs/USER_GUIDE.md`: for end users
