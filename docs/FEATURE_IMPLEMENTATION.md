# Feature Implementation Matrix

**Origin:** P = proposed in the paper · F = shown in the Figma prototype · N = new in v2.
**Before v2:** every prototype feature was a *visual placeholder* (Figma only; the paper notes banking data was simulated).
**Status:** ✅ implemented and tested · 🟡 partial · ⏳ future (documented, not built).

## Core modules (paper §2.5–2.6)

| Feature | Origin | v2 status | Backend | Tests |
|---|---|---|---|---|
| Consolidated dashboard: net worth with 1M/6M/1Y/All history, 7-day income/spend deltas, savings, loans | P, F | ✅ | `GET /dashboard` (computed from ledger and accounts) | api `planning.test` (reconciliation), e2e journey |
| Household / Personal scope switch ("joint vs personal account") | F | ✅ | `scope` on dashboard, ledger, forecast; private accounts | api `permissions.test` |
| Scenario planner: income/expense change, one-off, delay bill, new recurring; 3M–2Y; weekly/monthly; expected/conservative income | P | ✅ | `POST /forecast`, `forecast/engine.ts` | api `finance.test` (30% drop → first deficit; 2-week delay), e2e journey |
| Saved scenarios shared with the household | P | ✅ | `/scenarios` CRUD | api `planning.test` |
| Forecast transparency ("How this is calculated") | N | ✅ | `assumptions` in the forecast response | e2e journey |
| Collaborative ledger: CRUD, categories, tags, notes, search, filters, sort, pagination | P, F | ✅ | `/transactions` | api `ledger.test` |
| Version-controlled edits, change log, restore any version | P | ✅ | `transaction_revisions`, `/history`, `/revert` | api `ledger.test`, e2e collaboration |
| Conflicting-edit resolution (optimistic concurrency, 409 + server copy) | P (eval task 5) | ✅ | `expectedVersion` | api `ledger.test` |
| Soft delete + undo/restore | P (error recovery) | ✅ | `DELETE`, `/restore` | api `ledger.test` |
| Comment threads with @mentions → notifications | P | ✅ | `/comments`, `comment_mentions` | api `ledger.test`, e2e collaboration |
| Receipt attachments (image/PDF) | P, F ("scan receipt") | 🟡 | `/attachments` (magic-byte checks, disk storage) | api `ledger.test` · OCR ⏳ |
| Roles: owner / admin / contributor / viewer | P | ✅ | `shared/permissions.ts`, `requireCap` | shared + api `permissions.test` |
| Category-scoped contributors ("edit limited to groceries…") | P | ✅ | `member_category_scopes` | api `permissions.test` |
| Invitations (link, optional email lock, expiry, revoke) | F (flow) | ✅ | `/invitations` | api + e2e |
| Ownership transfer, leave, remove member | N | ✅ | households routes | api `permissions.test` |
| Edit approval queue (propose → approve) | P | ⏳ | — | — |
| Alerts engine: budget threshold/over, bill due, forecast deficit, goal milestones; deduplicated; per-user preferences | P | ✅ | `alerts/service.ts`, hourly scheduler + on-change | api `planning.test` |
| Delivery by email or push | P | ⏳ | email transport interface exists (console/SMTP) for auth emails | — |
| Activity feed (audit log, private events hidden) | P | ✅ | `activity_events` | api `permissions.test` |
| Automation rules (categorise, tag, % to goal; chained) | P | ✅ | `rules/engine.ts`, `/rules` | api `finance.test`, `planning.test` |

## Prototype screens

| Screen (Figma) | v2 | Notes |
|---|---|---|
| Dashboard | ✅ | Plus budget pace, forecast summary, goals, accounts accordion, tips, bills, activity |
| Set Daily Expenses (Income → Spend → Goals → Confirm) | ✅ | Onboarding wizard (+ Accounts step), "Reset", success copy kept |
| Budget overview (income vs spend 1M/6M/1Y, goals rings, upcoming bills) | ✅ | Budget page |
| Smart budget (Living/Entertainment/Unexpected bars, breakdown, Confirm/Reset) | ✅ | Budget groups + editor with "Reset this month" (restores the previous plan) |
| Spending (donut, month switch, Smart Tips, history, scan receipt) | ✅ | Segmented bar replaces the donut; tips are rule-based with explanations |
| Transaction report export (PDF/Excel/email/cloud) | 🟡 | CSV export ✅ and full JSON export ✅; PDF/Excel/email/cloud ⏳ |
| AI purchase (card switch, coupons, cash-back) | ⏳ | Needs issuer and merchant offer data |
| Credit score, Transfer money, Smart pocket | ⏳ | Need bureau and payment-rail partners and licensing |
| Calculator (tuition) | ✅ (as goals) | Goal math: required monthly amount and projected completion |

## Platform

| Capability | Status | Notes |
|---|---|---|
| Auth (register, login, logout, reset, change password, sessions) | ✅ | |
| Account data export / deletion | ✅ | |
| CSV import with mapping, preview, duplicate detection | ✅ | The honest substitute for bank sync |
| Live bank aggregation (Plaid etc.) | ⏳ | `services/providers.ts` interface; UI shows "Not connected" |
| Responsive (phone / tablet / desktop) | ✅ | e2e on iPhone 13, Pixel 7, iPad Mini and 1440 desktop |
| PWA (manifest, icons, shell caching) | ✅ | API never cached |
| Offline entry with idempotent sync and failure handling | ✅ | e2e offline |
| Multi-currency, FX | ⏳ | One currency per household |
| Dark mode | ⏳ | Tokens are ready for it |
| Production build (API bundle + web, single origin) | ✅ | Verified in a browser under the production CSP |
| Docker image + compose | 🟡 | Written; built and smoke-tested by CI only (no Docker locally) |
| Household time zone ("today" for budgets, bills, alerts, forecast) | ✅ | N; auto-detected; `planning.test`, shared date tests |
| CI (lint, types, tests on both DB drivers, E2E, Docker) | ✅ | `.github/workflows/ci.yml` (runs once pushed) |
