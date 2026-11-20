# SynerPulse

A collaborative, forward-looking household finance app: one shared place for accounts, budgets, bills, goals and the conversation around every entry, plus a cash-flow planner for testing a decision before you make it.

SynerPulse is the software implementation of the paper:

> Dang, H., Ding, F. *Revolutionizing Household Finance: A User-Centered Platform for Holistic Financial Management.* HCI International 2025, Springer. https://doi.org/10.1007/978-3-032-13164-5_2

The conference slides and the original Figma wireframes are in `HCII 2025 International Paper/`. The paper itself is not redistributed here; please use the DOI. The mapping from paper to software is in `docs/PROJECT_UNDERSTANDING.md`.

> **Status:** feature-complete v2.0. CI builds and tests everything, including the Docker image, on every push.

## Put it online (public website)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/henglongdang/synerpulse_v2.0)

The button creates the web app and a PostgreSQL database on [Render](https://render.com) from `render.yaml`. You sign in with GitHub and confirm. The site then offers both:
- **Create your own account**: a fresh, blank household for real use.
- **Explore the demo household**: one click into a fictional family's finances. Demo accounts can't change passwords, delete things or invite people, and the demo resets daily, so visitors can't spoil it for each other.

See `docs/DEPLOYMENT.md` for free-tier limits, email setup and a custom domain.

## Tech stack
- **Web:** React 19, Vite 7, React Router 7, TanStack Query, D3 (scales and shapes), hand-built CSS design system, PWA (Workbox)
- **API:** Node.js 20+, Express 5, Zod, Drizzle ORM, Argon2id, Pino
- **Database:** PostgreSQL. Development and tests use **PGlite**, an embedded Postgres, so nothing needs installing.
- **Tests:** Vitest (unit and integration), Testing Library, Playwright (E2E on desktop, iPhone, Android and iPad profiles)

## Quick start
Prerequisite: Node.js 20.19 or newer (developed on Node 26).

```bash
git clone https://github.com/henglongdang/synerpulse_v2.0.git
cd synerpulse_v2.0
npm install
```

Then choose one of two modes. Each has its **own database**, so they never mix:

| Command | What you get |
|---|---|
| `npm run dev` | **Blank install** for real use. Open http://localhost:5173, create an account, and set up your household. |
| `npm run demo` | **Demo with sample data**: a fictional household with six months of history, ready to explore. `npm run demo:reset` restores it to the original sample. |

Both start the API on http://localhost:4000 and the web app on http://localhost:5173. Nothing else needs installing; the database is embedded.

Demo sign-ins (fictional names and figures):

| Role | Email | Password |
|---|---|---|
| Owner | mary@sample.synerpulse.test | synerpulse-demo |
| Admin | power@sample.synerpulse.test | synerpulse-demo |
| Contributor (Groceries & Dining out only) | luna@sample.synerpulse.test | synerpulse-demo |
| Viewer | liam@sample.synerpulse.test | synerpulse-demo |

In development, password-reset and invitation emails are printed to the API console instead of being sent.

## Scripts (from the repo root)
| Command | What it does |
|---|---|
| `npm run dev` / `npm run demo` | Blank install / demo with the sample household (separate databases) |
| `npm run demo:reset` | Restore the demo database to the original sample |
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
- No live bank connections: data comes from manual entry and CSV import, and SynerPulse never asks for banking passwords.
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
