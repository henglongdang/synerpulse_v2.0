# Development Log

## Next session: start here

**State at the end of session 2 (2026-11-19):** feature-complete for v2.0 and deployment-ready on paper.

- Production build: the API bundle plus the web build, served from one origin, were verified in a browser under the production CSP.
- Docker and compose files exist but are **unbuilt locally** (no Docker here). The CI workflow builds and smoke-tests the image once the repo is pushed to GitHub.
- All documents the brief requires are written.
- Every suite is green; see *Session 2 → Verification*.

What remains, in priority order:

1. **Push to GitHub so CI runs.** `.github/workflows/ci.yml` runs lint, types, tests (both DB drivers), E2E on four device profiles, and a Docker build with a smoke test. Treat the first green `docker` job as the verification of the Dockerfile. If it fails, fix it and record the fix here.
2. **Product decision: future-dated entries.** Current balances and net worth include entries dated after "today", while the net-worth history up to today does not. Decide whether "current" should exclude them (show them as *scheduled*), then change the balance queries (`accounts/service.ts`, `finance/service.ts`) and the dashboard together.
3. **Hardening, from SECURITY_AND_PRIVACY.md:** Postgres row-level security as defence in depth, email verification, optional 2FA, and a shared rate-limit store before running several instances.
4. **Features recorded as future work** (FEATURE_IMPLEMENTATION.md ⏳): edit-approval workflow, email and push delivery, receipt OCR, PDF/Excel export, a bank aggregator behind `FinancialDataProvider`, multi-currency, dark mode.
5. **Accessibility follow-up:** on narrow screens the dashboard is reordered with CSS `order` (tips before goals), so visual order differs from DOM and focus order for those cards. Consider restructuring the DOM if an audit flags it.

Housekeeping the user should know about:
- During screenshotting, a stray folder was created at `C:\c\Users\dangh\AppData\Local\Temp\claude\…\scratchpad\shots` (2 PNGs, caused by a Git Bash path conversion). Removing it was blocked by a safety check, so the user can delete `C:\c` manually.
- `npm audit` reports moderate advisories only in dev/build tooling: drizzle-kit's bundled esbuild, and glob/minimatch via workbox-build. These are not shipped to the runtime.

---

## Session 2 — 2026-11-19 (evening)

### Done
| Item | Result |
|---|---|
| API production bundle | `tsup.config.ts` with entries `index`, `migrate` and `seed`; `npm start` migrates, then serves. Smoke-tested: the SPA, service worker and manifest are served; JSON 404s; login; security headers. The built app ran in Chromium under the production CSP with **no console errors**, and the service worker registered. |
| Production-only install | A simulated Docker runtime stage (`npm ci --omit=dev --workspace=@familypulse/api`: 129 packages, 65 MB) booted and handled registration (native Argon2 + DB). |
| Docker | Multi-stage `Dockerfile` (non-root user, healthcheck, migrate-then-start), `docker-compose.yml` (app + postgres:17), `.dockerignore`. **Not built here**; the CI `docker` job does it. |
| Postgres driver verification | `npm run test:pg` runs the whole API suite through **node-postgres over the real wire protocol** (PGlite via `pglite-socket`, pool of 1). 80/80 pass. Raw `min(date)` aggregates were cast to `::text` for driver-independent typing. |
| Docs | API, ARCHITECTURE, DATABASE_SCHEMA, SECURITY_AND_PRIVACY, DESIGN_SYSTEM, DEPLOYMENT, USER_GUIDE (+ the README update). |
| Bundle | `@familypulse/shared/client` (no Zod in the browser) plus vendor chunks: app code 96 kB / 31 kB gzip (was one 531 kB chunk). |
| Polish | On small screens the dashboard shows tips and bills before goals and accounts; seeded activity and comments are back-dated to their entries. |
| CI | `.github/workflows/ci.yml`: checks, then E2E and Docker. |

### Bugs found and fixed
- **Household "today" was UTC.** After ~4 pm Pacific the server already treated it as tomorrow: budget month, "due in N days", alerts, forecast start, and date validation (east of UTC, today's date was rejected as "future"). Fixed with `households.timezone` (migration `0001`), auto-detected from the creator's browser and editable in Household → Settings, plus `householdToday(h)` / `todayInZone()`. The seed uses the machine's local zone.
- **Zod 4 `.partial()` keeps `.default()`s** (confirmed with a probe). Partial PATCHes silently reset fields:
  - renaming a household reset **currency → USD**;
  - archiving or unarchiving a goal reset its **icon and planned monthly amount → 0**;
  - pausing a bill reset **autopay → false**.

  All update schemas are now written out explicitly, with regression tests in the shared and API suites.
- **Orphaned dev servers on Windows.** Stopping a background shell left the child `node` processes running. They held the Argon2 `.node` file (blocking `npm ci`) and stale ports (one E2E failure). They are now cleaned up by command line (see CLAUDE.md).
- **jest-dom matchers missing when tests run via `npm run -w`.** On Windows, a drive-letter casing difference loaded a second Vitest copy. The setup file now calls `expect.extend(matchers)` itself. *Correction:* commit `17615ac` blamed `sideEffects:false`; that was wrong, and `1bf2a92` records the real cause.
- An aborted `npm install` left `node_modules` inconsistent (`npm ls` crashed). Recovered with `npm ci`.

### Verification (end of session 2)
| Suite | Result |
|---|---|
| `packages/shared` | 41 passed |
| `apps/api` (PGlite driver) | 80 passed |
| `apps/api` (`test:pg`, node-postgres driver) | 80 passed |
| `apps/web` unit | 8 passed |
| Playwright (desktop, iPhone 13, Pixel 7, iPad Mini) | 11 passed |
| ESLint, `tsc` (all packages), web build, API build | clean / success |
| Docker image | not built locally (CI job added) |

---

## Session 1 — 2026-11-19

### Discovery
- There is **no code prototype**. The "prototype" is the Figma design, available as `high fi-1.png`, `low fi-1.png` and the user-flow diagrams in the PPTX. Everything was built from scratch, in the prototype's visual language.
- The paper's five modules are the product's spine: Consolidated Dashboard, Scenario Planner, Collaborative Ledger, Permissions & Roles, and Notifications plus the Activity Feed. Its evaluation tasks became acceptance tests: the 30% income drop with first-deficit month, delaying a payment two weeks, a shared budget with roles, @mention comments, and resolving a conflicting edit through history.
- Logo: the segmented "F·PULSE" wordmark exists only as ~242×84 px raster art in the Figma exports.

### Decisions (with reasons)
| Decision | Why |
|---|---|
| npm workspaces monorepo (`shared`, `api`, `web`) | One source of truth for validation, money math and permissions on both sides |
| Express 5 + Drizzle + PostgreSQL; **PGlite** for dev and test | Real Postgres semantics and migrations with zero local install; the same SQL runs in production on Postgres |
| Server sessions (random token, SHA-256 at rest, httpOnly SameSite=Lax cookie) + Argon2id | Established primitives, revocable sessions, no JWT pitfalls |
| CSRF: required `X-Requested-With` header + Origin check + SameSite | Simple and robust for a same-origin SPA |
| Integer cents and basis points; one rounding step (half away from zero) | Exact, auditable arithmetic |
| Day-by-day forecast simulation, aggregated to week or month | Catches intra-month dips (a bill before payday) that month-end views miss. The unit test confirms the first deficit is Apr 24, matching a hand trace |
| Rule-based "Smart Tips", each with a `basis` explanation, labelled rule-based rather than "AI" | Honest: the paper itself notes there is no ML |
| Private accounts invisible to everyone else, including owners and admins | The paper's "restricted personal discretionary funds"; household totals use shared accounts only |
| Logo vectorised by colour-layer tracing (quantise to 6 sampled colours → morphological clean-up → potrace) | Keeps the user's actual mark crisp; **not redrawn**. The app icon is the wordmark's own F·P lead glyph, cropped |
| Prototype donut replaced with a tall segmented bar + ranked bars | Data-viz guidance; same content ("We spent $X", group shares) |
| Chart palettes validated with the dataviz CVD validator | Groups: Living `#D9700D`, Entertainment `#8E3AA6`, Unexpected `#0A8FA8` (teal, because red is reserved for status). Series: income `#167A47`, spend `#D9700D`, projection `#3048FD` |
| Fonts self-hosted (Montserrat for brand headings, IBM Plex Sans for UI and figures) | Brand continuity with the prototype, no third-party font requests |
| Service worker precaches the app shell only, never API responses | Financial data is not cached on devices. The offline outbox stores only entries typed offline and is cleared on sign-out |

### Bugs found and fixed during the session (worth remembering)
- **Correlated subquery binding.** `gc.goal_id = ${goals.id}` rendered as `"id"` and bound to the inner table, so goal totals were 0. Fixed with literal `"goals"."id"` (also in accounts, households and transactions).
- **Budget false alarms.** Rent and daycare at 100% were flagged "close to limit". Added `billCovered`: categories paid by scheduled bills are on plan unless over budget (affects tips and alerts).
- **Tip crowding.** Five warnings of one kind hid everything else. Fixed with `rankTips`, which allows at most two per kind.
- **Rate limiter.** It was created inside the request handler, which v8 rejects. Limiters are now created at load with `skip`, and a test covers it.
- **Onboarding route race.** After creating a household, the router's `/register` redirect beat `navigate('/onboarding')`. Now we navigate before refreshing the session.
- **"Finish later" closed onboarding forever.** It now only returns to the dashboard; the "Finish setting up" banner remains.
- **Add-entry raced the account list.** Save is disabled while accounts load.
- Smaller fixes: a true minus sign on percentage sliders; consistent axis tick style; x-label collisions; a `/auth/session` probe so a fresh visit logs no console 401.

### Commits
1. `ef92a6c` Baseline: research materials preserved
2. `cdbe288` Backend API, schema, tests
3. `ad2e73a` Web app, design system, all pages
4. (this commit) QA: Playwright E2E, component tests, rate-limit test, fixes, handoff docs

### Verification (end of session 1)
| Suite | Result |
|---|---|
| `packages/shared` (vitest) | 39 passed |
| `apps/api` (vitest, in-memory Postgres per file) | 79 passed: auth, CSRF, headers, isolation/ID manipulation, privilege escalation, private accounts, invitations, ledger, history/revert, conflicts, idempotency, transfers, attachments (magic bytes), CSV export injection, budgets and alerts dedupe, recurring, forecast, goals and rules, CSV import, seed and dashboard reconciliation, export and delete account, rate limiting |
| `apps/web` (vitest + Testing Library) | 8 passed |
| Playwright `desktop` | 5 passed: full journey (register → onboarding → entry → dashboard updates → refresh → sign out/in → planner 30% scenario), validation, invite + edit + @mention + notification + history, viewer restrictions, offline outbox sync |
| Playwright `iphone` / `android` / `tablet` | 6 passed: 10 pages each without horizontal overflow; add-entry sheet fits; touch-sized controls |
| ESLint (repo) | clean |
| `tsc --noEmit` (shared, api, web) | clean |
| `vite build` (web) | succeeds; PWA service worker generated; 531 kB main-chunk warning |
| API production build | **not yet done** (see step 1 above) |

### Security implemented (for SECURITY_AND_PRIVACY.md)
- Argon2id (OWASP parameters); timing-equalised login for unknown emails; one generic credential error.
- Session tokens are 256-bit random values stored only as hashes. Sessions slide hourly and can be listed and revoked. Changing or resetting a password revokes other sessions.
- Password reset tokens: single use, 30 minutes, hashed, and the same response whether or not the account exists.
- CSRF guard, Helmet CSP (`frame-ancestors 'none'`, self-only scripts), HSTS in production, `Cache-Control: no-store` on all API responses, `x-powered-by` off.
- Rate limits: login (per IP + email), register, password reset, uploads, and a global API limit.
- Zod validation on every input. Body size cap of 1.2 MB. Upload size cap with magic-byte type checks. Storage keys are random, never user filenames.
- Server-side membership resolution per request (404 for non-members); a capability matrix; category-scoped contributors; role-assignment rules that prevent escalation; owner-only destructive actions.
- Private-account isolation in queries, the activity feed, mentions and rule allocations.
- Logging covers method, path, status and timing only; bodies and queries are never logged; sensitive keys are redacted.
- CSV export neutralises formula injection. JSON data export and account deletion are available.
- **Not done:** Postgres row-level security, email verification, 2FA, encryption at rest beyond the database's own, and any compliance review (no GLBA/GDPR claims).
