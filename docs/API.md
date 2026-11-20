# API Reference

Base path `/api`. JSON in and out. All money values are **integer cents**. Percentages are **basis points** (1 bp = 0.01%). Dates are `YYYY-MM-DD` and timestamps are ISO-8601. Request schemas live in `packages/shared/src/schemas.ts` and response types in `packages/shared/src/types.ts`; this page lists the routes and the rules that apply to them.

## Conventions

| Topic | Rule |
|---|---|
| Authentication | Session cookie (`fp_session`, or `__Host-fp_session` when secure). It is set by register and login, httpOnly, SameSite=Lax, and the expiry slides forward hourly (30 days by default). |
| CSRF | Every non-GET request must send `X-Requested-With: synerpulse`. If an `Origin` header is present it must match `APP_ORIGIN` or the request host. Otherwise the response is `403 csrf`. |
| Errors | `{ "error": { "code", "message", "details?": { field: [messages] }, "current?" } }`. Codes include `bad_request` (400), `invalid_credentials`/`unauthorized` (401), `forbidden`/`csrf`/`demo_locked` (403), `not_found` (404), `conflict` (409), `invitation_unavailable` (410), `payload_too_large` (413), `rate_limited` (429), `internal` (500, never with internals). |
| Household isolation | Household routes are `/api/households/:householdId/...`. Non-members get **404** for the household and everything in it, and foreign ids anywhere also return 404. |
| Capabilities | Role checks use the matrix in `packages/shared/src/permissions.ts`. Below, **cap** = the required capability: viewer < contributor < admin < owner. "Private" means the caller must own the private account involved. |
| Concurrency | Transaction edits require `expectedVersion`. A mismatch returns 409 with `current` (the server copy). |
| Idempotency | Creating a transaction or transfer accepts `clientRequestId` (UUID). A retry returns the original with **200** instead of 201. |
| Caching | All API responses send `Cache-Control: no-store`. |
| Rate limits | Login 10 per 15 min (per IP and email), register 10/h, password reset 5/h, uploads 60/h, everything 300/min. |
| Size limits | JSON bodies ≤ 1.2 MB; uploads ≤ `MAX_UPLOAD_MB` (5 MB). |

## Auth & profile: `/api/auth`, `/api/me`

| Method & path | Auth | Purpose |
|---|---|---|
| POST `/auth/register` `{name,email,password}` | – | Create an account and sign in (201). 409 if the email exists. |
| POST `/auth/login` `{email,password}` | – | Sign in. One generic 401 for any bad credentials. |
| POST `/auth/logout` | – | End this session (204). |
| GET `/auth/session` | – | `{ me: MeDTO \| null }`. The web app's session probe. |
| GET `/auth/me` | ✔ | `MeDTO`: user, households (most recent first), notification prefs, unread count. 401 when signed out. |
| PATCH `/auth/me` `{name}` | ✔ | Update profile. |
| PUT `/auth/me/notification-prefs` | ✔ | Replace alert preferences (threshold %, reminder days, toggles, safety buffer). |
| POST `/auth/me/last-household` `{householdId}` | ✔ | Remember the selected household. |
| POST `/auth/password/change` `{currentPassword,newPassword}` | ✔ | Change password; other sessions are revoked. |
| POST `/auth/password/forgot` `{email}` | – | Email a single-use reset link (30 min). Same response whether or not the account exists. |
| POST `/auth/password/reset` `{token,password}` | – | Set a new password; all sessions are revoked. |
| GET `/auth/sessions` · DELETE `/auth/sessions/:id` | ✔ | List and revoke your own sessions. |
| GET `/me/export` | ✔ | JSON download of all data you can see. |
| DELETE `/me` `{password}` | ✔ | Delete the account. 409 if you own a household that has other members. |
| GET `/notifications?unread&limit` | ✔ | Your inbox plus unread count. |
| POST `/notifications/:id/read` · POST `/notifications/read-all` · DELETE `/notifications/:id` | ✔ | Manage the inbox. |
| GET `/integrations` | ✔ | Data-source status (manual, CSV, aggregator not configured). |
| GET `/health` | – | `{ ok: true }` |
| GET `/demo` | – | `{ enabled:false }`, or with `DEMO_MODE` on: the public demo login and its reset interval |

## Households, members, invitations

| Method & path | cap | Purpose |
|---|---|---|
| POST `/households` `{name,currency,timezone?}` | signed in | Create a household (caller becomes owner; default categories are created). |
| GET `/invitations/:token` | – | Preview an invitation: household, inviter, role, status. |
| POST `/invitations/:token/accept` | signed in | Join. Email-locked invites require the matching email; used, expired or revoked invites return 410. |
| GET `/households/:hid` | member | Household (your role and category scope) plus members. |
| PATCH `/households/:hid` `{name?,currency?,timezone?}` | household.update | Rename, change the currency label, or change the time zone (IANA; it sets the household's "today"). |
| DELETE `/households/:hid` `{confirmName}` | household.delete (owner) | Delete everything. |
| POST `/households/:hid/onboarded` | household.update | Mark setup complete. |
| GET `/households/:hid/members` | member | List members with roles and scopes. |
| PATCH `/households/:hid/members/:userId` `{role?,categoryScope?}` | members.manage | Only roles strictly below your own; never your own role; never the owner. |
| DELETE `/households/:hid/members/:userId` | members.manage, or self | Remove a member, or leave. The owner cannot leave. The person's private accounts are deleted; their shared accounts pass to the owner. |
| POST `/households/:hid/transfer-ownership` `{userId}` | owner | The old owner becomes admin. |
| GET / POST `/households/:hid/invitations` · DELETE `.../:inviteId` | members.manage | Create (returns `url` once; 7-day expiry, optional `email` lock, `categoryScope` for contributors), list or revoke. |

## Accounts & categories (prefix `/households/:hid`)

| Method & path | cap | Purpose |
|---|---|---|
| GET `/accounts?scope&includeArchived` | member | Visible accounts with computed `balanceCents`. Scope `household` = shared, `personal` = your private ones. |
| POST `/accounts` | accounts.manage (shared) / any non-viewer (private) | Debts are entered with a negative opening balance. |
| PATCH `/accounts/:id` | manage, or owner of a private account | Rename, institution, last4, credit limit, `archived`. |
| POST `/accounts/:id/balance` `{balanceCents,date,note?}` | same | Records the difference as an `adjustment` ledger entry. |
| DELETE `/accounts/:id` `{confirm:true}` | same | Permanent; prefer archiving. |
| GET `/categories` · POST · PATCH `/:id` | categories.manage for writes | Groups are `living`, `entertainment`, `unexpected`, `income`. Names are unique per household (409); categories are archived, not deleted. |

## Ledger (prefix `/households/:hid/transactions`)

| Method & path | cap | Purpose |
|---|---|---|
| GET `/?page&pageSize≤100&q&accountId&categoryId(\|uncategorized)&type&from&to&tag&memberId&scope&sort(date\|amount\|created)&dir` | member | `Paginated<TransactionDTO>` with `canEdit` per row. |
| GET `/export.csv?…same filters` | member | CSV export with spreadsheet-formula neutralisation. |
| GET `/:id` | member | One entry. |
| POST `/` `{accountId,type(expense\|income),amountCents>0,date,description,merchant?,categoryId?,notes?,tags[],clientRequestId?}` | transactions.create | Validates the account, its opening date, and that the category matches the type. Contributor scope is enforced. Automation rules run. Returns `appliedRules`. |
| POST `/transfers` `{fromAccountId,toAccountId,amountCents,date,description,clientRequestId?}` | transactions.create | Two linked legs, excluded from income and spending totals. |
| PATCH `/:id` `{expectedVersion,…fields}` | can edit the entry | Optimistic concurrency. Transfers and adjustments allow only description, notes and tags. |
| DELETE `/:id` · POST `/:id/restore` | can edit | Soft delete and restore (both legs of a transfer). |
| GET `/:id/history` | member | Revisions newest first, with field-level changes. |
| POST `/:id/revert` `{version,expectedVersion}` | can edit | Restore a past version (recorded as a new revision). |
| GET / POST `/:id/comments` `{body,mentions[]}` · DELETE `/:id/comments/:cid` | comments.create; author or admin to delete | Mentions are filtered to members; notifications follow each user's preferences. Entries on private accounts cannot mention anyone. |
| GET / POST `/:id/attachments` (multipart `file`) · GET / DELETE `/:id/attachments/:aid` | can edit for writes | JPEG, PNG, WebP or PDF, verified by magic bytes; at most 10 per entry; downloads are `private, no-store`. |

## Planning (prefix `/households/:hid`)

| Method & path | cap | Purpose |
|---|---|---|
| GET `/budgets/:month` | member | `BudgetMonthDTO`: groups, then lines with spent, remaining, `usedBp`, `status` and `billCovered`. |
| GET `/budgets/overview?months≤24` | member | Monthly income against spending. |
| PUT `/budgets` `{month,expectedIncomeCents,items[]}` | budgets.manage | Plan applies from `month` onward. Spending categories only. |
| DELETE `/budgets/:month` | budgets.manage | Remove that month's plan; the previous one applies again. |
| GET / POST `/goals` · PATCH `/goals/:id` | goals.manage for writes | Returns `progressBp`, `requiredMonthlyCents`, `projectedCompletion` and `onTrack`. |
| GET / POST `/goals/:id/contributions` · DELETE `.../:cid` | goals.contribute / goals.manage | A withdrawal cannot exceed the amount saved. |
| GET / POST `/recurring` · PATCH / DELETE `/recurring/:id` | recurring.manage (shared) / owner (private) | Bills and income; `minAmountCents` sets the floor for variable income. |
| POST `/recurring/:id/pay` `{date?,amountCents?,accountId?}` · POST `/recurring/:id/skip` | recurring.markPaid | Posts a linked ledger entry and advances the schedule (skip only advances). |
| POST `/forecast` `{horizonMonths(3\|6\|12\|24),granularity(week\|month),scope,incomeMode(expected\|conservative),adjustments[]}` | member | `ForecastResultDTO`: baseline, optional scenario, assumptions and upcoming events. Adjustment kinds: `income_change`, `expense_change`, `one_time`, `delay_bill`, `new_recurring`. |
| GET / POST `/scenarios` · PUT / DELETE `/scenarios/:id` | scenarios.manage for writes | Saved what-ifs, shared with the household. |
| GET `/dashboard?scope&range(1M\|6M\|1Y\|ALL)` | member | `DashboardDTO`. Also triggers a throttled alert sweep. |
| GET `/insights` | member | Smart tips, with at most two per kind. |
| GET `/spending?month&scope` | member | Spending by category for a month. |
| GET / POST `/rules` · PATCH / DELETE `/rules/:id` | rules.manage for writes | Conditions: type, description/merchant contains, tag, category, account, amount range. Actions: set category, add tags, allocate a percentage to a goal. |
| GET `/activity?before&limit&entityType&entityId` | activity.view | Audit feed (cursor pagination). Private-account events are visible only to their owner. |
| POST `/imports/preview` · POST `/imports/commit` | imports.run | `{accountId,csv,mapping,dateFormat,invertAmounts,skipDuplicates}`. Preview flags errors and duplicates; commit imports the valid rows. |
