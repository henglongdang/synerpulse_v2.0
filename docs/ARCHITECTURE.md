# Architecture

## System overview

```
 Browser (React SPA + service worker)                 Node.js process (Express 5)                 PostgreSQL
 ┌──────────────────────────────────┐  same-origin   ┌──────────────────────────────────┐         ┌───────────┐
 │ pages → TanStack Query → api.ts  │ ─── /api/* ───▶│ security middleware               │  SQL    │ 24 tables │
 │ IndexedDB outbox (offline only)  │   cookie +     │ session → membership → capability │ ──────▶ │ (Drizzle  │
 │ Workbox: app shell cache only    │   CSRF header  │ routes → services → pure engines  │         │ migrations)│
 └──────────────────────────────────┘                │ static web dist (production)       │         └───────────┘
                                                      └──────────────────────────────────┘
                                                         ▲ email transport (console | SMTP)
                                                         ▲ storage (local disk | S3 via interface)
```

In development, Vite serves the web app on :5173 and proxies `/api` to the API on :4000. In production, one process serves both (`WEB_DIST_DIR`), so cookies, CSP and CSRF all work in a single origin.

## Repository layout

| Path | Responsibility |
|---|---|
| `packages/shared` | Contract shared by both sides: Zod request schemas, DTO types, the role and capability matrix, exact money helpers (cents, basis points, rounding), UTC calendar-date helpers. The web app uses it to validate early and hide controls; the API uses it to **enforce**. |
| `apps/api/src/app.ts` | Middleware order: helmet (CSP, HSTS in production) → access log (method, path, status only) → JSON limit → cookies → rate limit → CSRF guard → session → `no-store` → routers → JSON 404 → error handler. |
| `apps/api/src/lib` | Cross-cutting concerns: `http.ts` (auth, household membership loader, capability guard, CSRF, UUID params), `errors.ts` (safe error model, Zod → 400 details), `crypto.ts` (Argon2id, token hashing), `activity.ts` (audit log), `rateLimit.ts`, `deps.ts` (database, config and adapter container). |
| `apps/api/src/modules/*` | Feature modules: `routes.ts` handles HTTP, validation and authorisation; `service.ts` holds business logic and queries. |
| Pure engines | `forecast/engine.ts` (cash-flow simulation), `rules/engine.ts` (automation), `finance/recurrence.ts` (schedules), `finance/goals.ts` (goal maths). No I/O, fully unit-tested. |
| `apps/api/src/services` | Adapters for external systems: email, storage, financial-data providers (interface only). |
| `apps/web/src/lib` | `api.ts` (fetch wrapper, typed errors), `session.tsx` (signed-in user, current household, scope), `queries.ts`, `outbox.ts` (offline queue), `toast.tsx`, `format.ts`. |
| `apps/web/src/components` | Design-system components (`ui.tsx`), charts (`charts.tsx`), icons, app shell. |
| `apps/web/src/pages`, `features` | Screens and shared flows (the entry dialog, forms). |

## Request lifecycle (example: an edit to a shared ledger entry)
1. The web app sends `PATCH /api/households/:hid/transactions/:id` with the session cookie, `X-Requested-With`, and `expectedVersion`.
2. `csrfGuard` checks the header and Origin. `loadSession` hashes the cookie token and loads the user. `loadHousehold` resolves the caller's membership and role (404 if not a member) and, for contributors, their category scope.
3. The route validates the body with Zod. Then, in one DB transaction, the service:
   - loads the row through `accountVisibility` (private accounts are visible only to their owner);
   - checks the version, edit permission and category scope;
   - diffs the fields;
   - updates with `WHERE version = expected` (atomic);
   - appends a revision and an activity event.
4. After commit, the alerts engine re-evaluates budget thresholds (idempotent, deduplicated notifications).
5. The web app invalidates every query for the household, so the dashboard, budget and ledger re-render with server numbers.

## Key design decisions
- **The server owns calculations.** Balances, budget usage, goal maths, tips and the forecast are computed by the API from ledger rows; the client displays them.
- **Integer cents and basis points** everywhere, with one rounding step (half away from zero).
- **The forecast is a day-by-day simulation** (income on paydays, bills on due dates, everyday spending spread evenly), aggregated to weeks or months. This reveals dips that happen within a month. Its inputs are returned as `assumptions` so the UI can explain the result.
- **Everyday-spending baseline:** the average of the last three complete months, excluding bill-linked entries and bill categories. It falls back to the budget, then to zero, and the basis is stated to the user.
- **Collaboration is asynchronous**, as the paper's evaluation favoured: comments, mentions, revision history and an activity feed instead of real-time co-editing; optimistic concurrency resolves overlaps.
- **Privacy by construction:** private accounts are excluded in the query layer (`accountVisibility`), which also covers activity, mentions and rule allocations.
- **PGlite in development and tests, PostgreSQL in production:** the same SQL and migrations. `npm run test:pg` runs the suite through the production `pg` driver over the wire protocol.

## Workflows
| Workflow | Path through the system |
|---|---|
| Onboarding | Register → create household (default categories) → wizard: accounts, income streams (recurring), category limits (budget plan), goals → `onboarded` |
| Logging spending | Entry dialog → POST transaction (rules applied; goal allocations; revision 1; activity) → budget alerts |
| Offline entry | Network error → IndexedDB outbox ("Saved on this device") → `online` event → replay with `clientRequestId` (server deduplicates) → synced or "Needs attention" |
| Paying a bill | "Mark paid" → POST recurring/:id/pay → ledger entry linked to the schedule → `nextDate` advanced |
| What-if | Planner presets or adjustments → POST forecast (debounced) → baseline vs scenario, first deficit, assumptions → optionally saved as a scenario |
| Inviting | Admin creates an invite (hashed token, 7 days) → link → invitee registers or signs in → accepts → membership (+ category scope) → admins notified |
| Alerts | On ledger or budget change: budget thresholds and goals. Hourly sweep and on dashboard load (throttled): bills due, forecast deficit. All deduplicated per user. |

## Extensibility points
- **Bank aggregation:** implement `FinancialDataProvider` (`services/providers.ts`) and map synced items through `createTransaction(..., { source: 'import', importHash })`.
- **Storage:** implement `StorageService` for S3 or GCS.
- **Email and push:** add delivery channels next to `notify()` (`modules/notifications/service.ts`) and honour the existing per-user preferences.
- **Approval workflow:** add a `pending` revision state checked in `updateTransaction`.
