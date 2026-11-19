# Development Log

## Next session: start here

**State at the end of session 1 (2026-11-19):** the product is functional end to end. Backend, database, auth, all five research modules, the web app, mobile layouts, the PWA shell and offline entry are done. All automated tests pass (see *Verification* below). The remaining work is mostly **documentation, deployment packaging and polish**.

Do these in order:

1. **API production build.** `apps/api/package.json` has `"build": "tsup"`, but `tsup.config.ts` does not exist yet.
   - Create it: entry `src/index.ts`, format `esm`, target `node20`, `noExternal: ['@familypulse/shared']`. Keep `@electric-sql/pglite`, `pg` and `@node-rs/argon2` external.
   - Copy `drizzle/` next to `dist/`; `db/client.ts` already looks in `../drizzle`.
   - Verify with `npm run build && WEB_DIST_DIR=../web/dist npm start`.
   - Also add CLI entries for migrate and seed in production, or document `node dist/...`.
2. **Docker.** Add a `Dockerfile` (multi-stage: install, then build web and API, then a slim runtime that serves the web dist via `WEB_DIST_DIR`) and a `docker-compose.yml` (app + postgres:17). Docker is **not installed on this machine**, so say in the docs that it is untested.
3. **Remaining documents the brief requires:**
   - `docs/ARCHITECTURE.md`
   - `docs/DATABASE_SCHEMA.md`
   - `docs/API.md`: every route is in `apps/api/src/modules/*/routes.ts` and the route mounting is in `src/app.ts`
   - `docs/SECURITY_AND_PRIVACY.md`: controls are listed below under *Security implemented*
   - `docs/USER_GUIDE.md`
   - `docs/DESIGN_SYSTEM.md`: tokens are in `apps/web/src/styles/tokens.css`; chart palettes were validated, see *Decisions*
   - `brand/README.md`: logo provenance
4. **Web bundle size.** The main chunk is 531 kB (166 kB gzip), likely because zod comes in through `@familypulse/shared/schemas`. Option: give web its own entry that skips the schemas, add a `shared/client` export, or use `manualChunks` for react, d3 and query.
5. **Polish backlog** (none blocking):
   - On phones the dashboard Smart Tips sit below accounts; consider moving them above Goals.
   - The seed's activity feed is dominated by "moved … to …" transfer events, all timestamped now. Consider backdating `created_at` or skipping activity for seeded transfers.
   - Optional: add dark mode.
6. **Final report to the user**, built from this log, `FEATURE_IMPLEMENTATION.md` and `README.md`.

Housekeeping the user should know about:
- During screenshotting, a stray folder was created at `C:\c\Users\dangh\AppData\Local\Temp\claude\…\scratchpad\shots` (2 PNGs, caused by a Git Bash path conversion). Removing it was blocked by a safety check, so the user can delete `C:\c` manually.
- `npm audit` reports moderate advisories only in dev/build tooling: drizzle-kit's bundled esbuild, and glob/minimatch via workbox-build. These are not shipped to the runtime.

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
