# Implementation Roadmap

Status key: ✅ done · 🟡 partial · ⏳ planned (future) — see [FEATURE_IMPLEMENTATION.md](FEATURE_IMPLEMENTATION.md) for the per-feature matrix.

## Status at end of session 1 (2026-11-19)
E1–E12 ✅ done and tested. E13 🟡: README, `.env.example`, PROJECT_UNDERSTANDING, FEATURE_IMPLEMENTATION and DEVELOPMENT_LOG are written. ARCHITECTURE, DATABASE_SCHEMA, API, SECURITY_AND_PRIVACY, USER_GUIDE, DESIGN_SYSTEM, the API `tsup` build and Docker remain. The ordered next steps are in [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md#next-session-start-here).

## Essential (must ship for v2.0)

| # | Milestone | Contents |
|---|---|---|
| E1 | Foundation | Monorepo, TypeScript config, env validation, logger with redaction, error model, Express app factory, security headers, rate limiting, CSRF guard |
| E2 | Database | Drizzle schema, SQL migrations, PGlite (dev/test) + Postgres (prod) drivers, seed script with clearly labelled fictional household |
| E3 | Auth | Register, login, logout, session cookie, password change/reset, session list & revoke, profile |
| E4 | Households & roles | Create household, invitations by link, roles (owner/admin/contributor/viewer), category-scoped edit rights, remove member, transfer ownership |
| E5 | Ledger | Accounts (shared/private), categories, transactions CRUD with validation, transfers, tags, search/filter/sort/pagination, comments with @mentions, revision history + revert, optimistic concurrency (409 on stale edits), idempotent create |
| E6 | Calculations | Balances, net worth & history, period summaries, budget vs actual, goal progress, required contribution |
| E7 | Recurring & forecast | Recurring income/bills, mark-paid, forecast engine (daily simulation → weekly/monthly series), scenario adjustments, first-deficit detection, saved scenarios, presets |
| E8 | Alerts & activity | Notification engine (budget thresholds, bills due, forecast deficit, goal reached, mentions, invites), preferences, activity feed |
| E9 | Rules & insights | Automation rules (categorise, tag, allocate % to goal), rule-based smart tips |
| E10 | Web app | Design system, auth screens, onboarding + budget wizard, Dashboard, Ledger, Budget, Planner, Household, Activity, Notifications, Settings |
| E11 | Mobile & PWA | Bottom navigation, sheet dialogs, card lists for tables, manifest/icons, service worker (shell only), offline banner, offline outbox |
| E12 | QA | Unit + integration tests (API), component tests, Playwright E2E across desktop/tablet/phone viewports, lint, production build |
| E13 | Docs & deploy | README, ARCHITECTURE, DATABASE_SCHEMA, API, SECURITY_AND_PRIVACY, USER_GUIDE, DEVELOPMENT_LOG, Dockerfile + compose |

## Enhancements (after essentials, if time permits)
- CSV import with column mapping and duplicate detection *(promoted to essential — it is the only honest substitute for bank sync)*
- Receipt attachments (image/PDF) on transactions
- Data export (JSON) and account deletion
- Weekly forecast granularity *(user-requested in paper; included in E7)*

## Future (documented, intentionally not built)
- Live bank/P2P aggregation (Plaid/MX/Teller, Venmo/Zelle) — needs provider contract & credentials; an integration interface exists.
- Card-offer optimisation ("AI purchase") — needs issuer/merchant offer data.
- Credit score, money transfer — need bureau/payment-rail partners and licensing.
- Receipt OCR, PDF/Excel report export, push & email notification delivery providers.
- Edit-approval workflow (propose → approve) for contributors.
- Multi-currency households with FX.
- ML-based forecasting / anomaly detection (paper's own future work).
- Postgres row-level security policies as defence-in-depth.
- Multilingual UI.
