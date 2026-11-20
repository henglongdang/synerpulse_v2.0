# Security & Privacy

This page describes the controls that are actually implemented and tested, the known gaps, and what an operator must do when deploying. **SynerPulse has not been assessed against GLBA, GDPR, CCPA, PCI DSS or any other regulatory framework, and makes no compliance claims.**

## Threat model (summary)
The assets are household financial records, personal notes and receipts, and user credentials. The main threats: account takeover, one household reading or changing another's data, a member exceeding their role, private data leaking to other members, injection (SQL, XSS, CSV formulas), CSRF, data persisting on shared devices, and secrets or PII leaking through logs.

## Implemented controls

| Area | Control | Where | Tested in |
|---|---|---|---|
| Passwords | Argon2id (m=19 MiB, t=2, p=1), 10–128 characters; plaintext is never stored or logged | `lib/crypto.ts` | `auth.test` |
| Login | One generic error message; a timing-equalising dummy verify when the email doesn't exist; rate limited per IP+email (10 per 15 min) | `auth/routes.ts`, `lib/rateLimit.ts` | `auth.test`, `ratelimit.test` |
| Sessions | 256-bit random tokens, stored only as SHA-256; httpOnly, SameSite=Lax, Secure in production (`__Host-` prefix); 30-day sliding expiry; list and revoke; password change or reset revokes other sessions | `auth/session.ts` | `auth.test` |
| Password reset | Single-use, hashed, 30-minute tokens; response doesn't reveal whether the account exists | `auth/routes.ts` | `auth.test` |
| CSRF | Custom-header requirement + Origin check + SameSite cookies; no CORS is granted | `lib/http.ts` | `auth.test` |
| Authorisation | Membership resolved server-side on every household request; capability matrix; role-assignment rules prevent escalation; owner-only destructive actions | `lib/http.ts`, `shared/permissions.ts` | `permissions.test` |
| Tenant isolation | Every query filters by `household_id`; foreign or malformed IDs return 404 (existence isn't leaked); cross-household references in rules, transactions and categories are rejected | services | `permissions.test`, `planning.test` |
| Private accounts | Visible only to their owner (not admins or owners), enforced in the query layer, activity feed, mentions, exports and rule allocations | `accounts/service.ts` | `permissions.test` |
| Input validation | Zod schemas on every body and query; UUID params; amounts are bounded integer cents; real calendar dates | `shared/schemas.ts` | all suites |
| SQL injection | Parameterised queries through Drizzle; LIKE wildcards in search are escaped | services | `ledger.test` |
| XSS | React escapes output; no HTML injection from data; CSP `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'` | `app.ts` | `auth.test`; production CSP checked in a browser |
| Uploads | Size cap (5 MB, streaming), JPEG/PNG/WebP/PDF allow-list **verified by magic bytes**, random storage keys, filenames sanitised, `no-store` download | `transactions/routes.ts`, `services/storage.ts` | `ledger.test` |
| CSV | Export neutralises formula injection; import is size and row capped, previewed, and deduplicated | `transactions/routes.ts`, `imports/routes.ts` | `ledger.test`, `planning.test` |
| Transport and headers | Helmet: HSTS (production), nosniff, referrer policy `same-origin`; `x-powered-by` off | `app.ts` | `auth.test` |
| Caching | API responses `Cache-Control: no-store`; the service worker caches the **app shell only**, never API data | `app.ts`, `vite.config.ts` | `auth.test` |
| Offline data | IndexedDB holds only entries typed while offline, until they sync; cleared on sign-out and account deletion | `web/lib/outbox.ts` | e2e `offline` |
| Logging | Method, path (IDs masked), status and duration only; bodies and query strings never logged; redaction of cookies, auth, password, token and email keys | `app.ts`, `lib/logger.ts` | review |
| Public demo | Shared demo accounts (`*@sample.synerpulse.test`, fictional data) cannot change password, profile or sessions, delete the account or household, manage members, invite, create or join households, or receive reset emails. The demo household is wiped and re-seeded when it is older than `DEMO_RESET_HOURS`. | `lib/http.ts › forbidDemo`, `modules/demo` | `demo.test` |
| Errors | Unknown errors return a generic 500; stack traces and SQL stay server-side | `lib/errors.ts` | `auth.test` |
| Secrets | Configuration comes from environment variables only (`.env.example` contains no secrets); nothing secret is shipped to the browser | `config.ts` | review |

## Financial integrations
SynerPulse **never asks for or stores online-banking credentials**. Data comes from manual entry and CSV import. A provider interface exists for future aggregation (`services/providers.ts`). Such an integration must use the provider's token exchange, store only provider access tokens (encrypted at rest), and go through a security review.

## Privacy
- **Data minimisation:** name, email, password hash, and the financial records users enter. No phone number, address, government ID or analytics trackers. Fonts are self-hosted, so the UI makes no third-party requests.
- **User rights:** full JSON export (`Settings → Download my data`) and self-service account deletion. Deletion removes the login, sessions and private accounts, and deletes households the user owns alone. Shared entries a former member logged remain with the household (authorship becomes "Former member").
- **Sample data** is fictional and flagged (`is_sample`, a banner in the UI).
- **Not processed:** financial data isn't sent to external services. Email is the only outbound channel (password resets and invitations), and it is disabled or console-only unless SMTP is configured.

## Known limitations and recommended hardening
- No PostgreSQL row-level security yet; isolation is enforced in the application layer and covered by tests. Adding RLS (with `set_config('app.household_id', …)` per transaction) is recommended defence in depth.
- No two-factor authentication, email verification, or breached-password check.
- No encryption at rest beyond what the database or volume provides. Receipts sit on local disk unless a cloud storage adapter is added.
- The rate limiter is in memory (per process). Use a shared store (for example Redis) when running several instances.
- Dependency advisories (`npm audit`) are moderate and limited to dev and build tooling (drizzle-kit's bundled esbuild; glob and minimatch via workbox-build). They are not in the runtime image.

## Deployment checklist
- Serve over TLS only. Leave `COOKIE_SECURE` at its production default (true); set `TRUST_PROXY=true` behind a proxy.
- Set `APP_ORIGIN` to the public URL exactly.
- Use managed PostgreSQL with backups and encryption at rest; keep `DATABASE_URL` in a secret store.
- Configure SMTP (`EMAIL_TRANSPORT=smtp`, `SMTP_URL`) or password reset won't reach users.
- Put receipts on a persistent, private volume or object store.
- Never run the seed against production data.
