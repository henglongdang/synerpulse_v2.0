# Project Understanding — SynerPulse v2.0

*Written before implementation began (Phase 1 audit). Later changes are recorded in [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md).*

## 1. Source materials inspected

| Material | Location | What it contains |
|---|---|---|
| Camera-ready paper | `HCII 2025 International Paper/ID_5200_…_CameraReady_Submission.pdf` | Full text of *Revolutionizing Household Finance: A User-Centered Platform for Holistic Financial Management* (Dang & Ding, HCII 2025) |
| Published version | `…Springer Nature Link….pdf` | Springer page print of the same paper |
| Presentation | `FINAL - HCII 2025 Presentation.pptx` | 22 slides, plus two user-flow diagrams (current-app flow and prototype flow) and two extra high-fi screens (Spend / Smart Tips, transaction report export) |
| High-fidelity prototype | `high fi-1.png` | Six Figma screens: Dashboard, AI purchase, Set Daily Expenses, Budget overview, Smart budget, Spending |
| Low-fidelity prototype | `low fi-1.png` | Five annotated wireframes with numbered interaction notes |
| Publishing licence | `…License_to_Publish_Form.pdf` | Legal form. Not product material, and excluded from git |

*The paper PDFs and the license form are kept local and are **not** in the public repository (publisher copyright). The paper is available at https://doi.org/10.1007/978-3-032-13164-5_2.*

**There is no existing source code.** The "prototype" is a Figma design that was evaluated by usability testing; the paper notes that banking data was "simulated using mock datasets". Every behaviour in this repository is therefore new software that implements the prototype's design intent.

## 2. Research paper summary

**Problem: functional fragmentation.** Households spread budgeting, expense tracking, forecasting and collaboration across disconnected tools (Mint, YNAB, Robinhood, Prism…). The result is manual reconciliation, context switching and cognitive fatigue.

**Evidence (as reported by the paper. This software does not re-validate it):**
- Survey N=342 (331 complete), interviews N=35, three formative usability rounds with 12 participants each, and a final evaluation with N=16.
- 64.3% use two or more finance apps; mean satisfaction is 2.7/5. Satisfaction is lowest among freelancers (2.3) and co-managing couples (2.4).
- Most valued features: simulating future financial states (M=4.64), role-based permissions for shared finances (4.42), and a consolidated dashboard (4.37).
- Tool count correlates with cognitive fatigue (r=0.58).
- Exploratory factor analysis yields three pain factors: **integration friction, forecasting insufficiency, collaboration difficulty.**
- 82.4% want to simulate the impact of a decision. Users describe a "financial GPS" or a "weather forecast".
- Only 18.6% have role-based permissions today. Couples fall back on verbal syncs and shared Google Docs.
- The prototype scored SUS 84.2 (SD 7.9), with 94% task completion, 3.4 min mean time-on-task and 0.47 errors per task. Most errors were permission misconfigurations.

**Target users.** Multi-member households (couples, co-parents, roommates, families), freelancers and gig workers with irregular income, and people who manage money on behalf of others.

**Design constructs.** Forecasting literacy, collaborative awareness and contextual simplification (progressive disclosure).

### 2.1 The five modules the paper proposes

1. **Consolidated Dashboard.** Account balances, budget status, future cash-flow projection, upcoming bills, savings trajectories, and contextual alerts for overspending or upcoming obligations.
2. **Dynamic Scenario Planner.** Simulates income or expense trajectories with sliders, dropdowns and time-range selectors, and recalculates projected cash flow. It must support the evaluation tasks: *simulate a 30% income reduction and identify the first deficit month* and *visualise delaying a major payment by two weeks*. Users asked for weekly as well as monthly granularity.
3. **Collaborative Ledger.** Co-edited transactions, category labels, tags, note threads, receipts, and inline comments that tag household members. Edits are **version-controlled and time-stamped, with a change log**.
4. **Permissions & Role Management.** Roles are viewer, contributor and admin. Settings are granular, such as "read-only access to monthly reports" or "edit access limited to grocery and utility categories". Restricted or personal discretionary funds sit inside a joint budget.
5. **Notification & Alerts Engine plus Activity Feed.** Behavioural triggers (income drop, overspending, approaching goal, upcoming bill-pay gap) and pre-commitment nudges. Every event is logged in an auditable activity feed.

Cross-cutting design decisions from the paper:
- **Customisable tagging and rule-based automation.** For example, *"any deposit tagged 'freelance' triggers a savings reallocation of 20%"*.
- **Clear visual separation between individual and shared financial zones.**
- Error recovery: reversing incorrect entries and restoring deleted budgets.
- Asynchronous coordination is preferred over real-time co-editing.
- Progressive disclosure: guided presets before full configurability in forecasting.

### 2.2 Limitations stated by the paper (these shape the implementation)
- Banking integrations (Plaid/Yodlee) were simulated, so live syncing never worked.
- There is no machine learning for personalised modelling or anomaly detection.
- Mobile-first deployment and concurrent-usage scalability were untested.
- Participants skewed digitally literate, which makes accessibility a priority.
- The authors list as future work: a fully operational system, live API integrations, advanced forecasting, adaptive onboarding, and a longitudinal field study.

## 3. Prototype assessment (Figma)

| Prototype element | Source | Status before v2 | Decision for v2 |
|---|---|---|---|
| Dashboard: net worth, income/savings/loans/invest tiles with 7-day deltas, period switch (1M/6M/1Y/All) | hi-fi, lo-fi | Visual only | **Build.** Computed from real account and ledger data |
| Header: avatar → settings, logo → home, search, notification bell with badge | lo-fi notes 1–3 | Visual only | **Build** |
| Expandable rows (Accounts, Credit cards…) | hi-fi | Visual only | **Build** as account groups |
| Budget overview: Income vs Spend bars with 1M/6M/1Y | hi-fi | Visual only | **Build** |
| Income preview / Spend forecast | hi-fi | Visual only | **Build.** Powered by the forecast engine |
| Financial goals rings (Education 93%, Mortgage 78%) | hi-fi | Visual only | **Build.** Goals with contributions |
| Set Budget wizard (Income → Spend → Goals → Confirm), Reset, success feedback | hi-fi, lo-fi | Visual only | **Build** as the onboarding and budget wizard |
| Smart budget: category groups Living / Entertainment / Unexpected with adjustable bars and breakdown | hi-fi, lo-fi | Visual only | **Build.** Group → category breakdown with editable limits |
| Upcoming bills calendar strip | lo-fi | Visual only | **Build** as recurring bills with "mark paid" |
| Spending donut by group, month switcher, tap segment for detail | hi-fi | Visual only | **Build** |
| Smart Tips ("close to your limit", "dining out higher than usual", "recurring charges for Fortnite") | hi-fi | Visual only | **Build** as a transparent *rule-based* insight engine. It is not labelled "AI" |
| Transaction history, report export (PDF/Excel/Email/Cloud) | hi-fi (pptx) | Visual only | **Build** history plus CSV export. PDF, email and cloud export are future work |
| Scan receipt | hi-fi | Visual only | **Partial.** Receipt image/PDF attachment. OCR is future work |
| Personal ↔ joint account switch | user-flow diagrams | Visual only | **Build** as Household / Personal scope |
| Invite family members on sign-up | user-flow diagram | Visual only | **Build** as invitation links with roles |
| "AI purchase": card switching, merchant coupons, cash-back optimisation | hi-fi | Visual only, needs merchant/issuer data | **Not built.** Needs card-issuer offer data. Documented as future work |
| Credit score, Transfer money, Smart pocket | hi-fi / flow | Visual only, needs bureau or payment rails | **Not built.** Needs regulated integrations. Documented |
| Calculator (tuition savings) | flow | Visual only | **Covered** by the goal calculator (required monthly contribution) |

Branding is described in §5.

## 4. Technical limitations identified
- No codebase, backend, database, authentication or tests existed.
- No vector logo exists. The wordmark appears only as raster artwork inside the Figma exports, about 260×110 px.
- No real financial data source is available. No Plaid or other provider credentials were supplied.

## 5. Existing design and branding system (extracted)

**Logo.** A geometric, segmented wordmark that reads "PULSE", with an **F** fused to the **P** (SynerPulse). The letterforms are built from flat colour segments with 45° chamfers. The logo is reused as-is: it is extracted from the highest-resolution source and vectorised by automated tracing, with no redrawing.

| Token (sampled from artwork) | Hex | Used in prototype for |
|---|---|---|
| Pulse Green | `#26E526` | Logo segments, active states, "positive" accents |
| Leaf (light green) | `#8BE79A` | Logo segments, selected tiles |
| Signal Blue | `#384DFD` | Logo segments, section rules, links |
| Forest | `#0C3E28` / `#16492C` | Logo segments, income bars, headings |
| Mint paper | `#EFFBF1` | Screen background |
| Spend orange | `#FD8207` | "Spend" bars, Living segment |
| Alert red | `#E0401C`-ish | "Unexpected" segment, over-budget |
| Violet | `#8E1E9E`-ish | "Entertainment" segment |

**Recognisable layout traits to preserve:** a mint background; thick coloured rules separating sections (a green rule under net worth, a blue rule under the summary tiles); the bottom tab bar (Spend · Budget · Dashboard · Insight); a centred logo with avatar on the left and search plus bell on the right; and category groups Living / Entertainment / Unexpected.

**Typography.** The prototype uses a geometric sans similar to Montserrat. v2 uses Montserrat for display, which keeps brand continuity, and IBM Plex Sans with tabular figures for UI and numbers, which is more legible for financial data. Both are self-hosted so that no third-party font requests leak usage.

## 6. Proposed architecture

Because there was no stack to retain, the choice is driven by the requirements:

- **Monorepo (npm workspaces):** `apps/api`, `apps/web`, `packages/shared`.
- **Backend:** Node.js + Express 5 + TypeScript. Modular feature folders of routes, services and validation. Zod validates every request.
- **Database:** PostgreSQL via Drizzle ORM with SQL migrations. Local development and tests use **PGlite** (Postgres compiled to WASM), so the project runs with zero installation while using the same SQL dialect and migrations as production Postgres.
- **Auth:** server-side sessions with random tokens. Only a SHA-256 hash is stored, and the token travels in an httpOnly, SameSite cookie. Passwords are hashed with Argon2id (`@node-rs/argon2`). Password reset uses single-use hashed tokens. Login is rate-limited.
- **Authorisation:** every household-scoped route resolves the caller's membership and role server-side. Every query is filtered by `household_id`. Role capabilities are defined in one tested module.
- **Money:** integer cents everywhere. Percentages are stored as basis points. No floats in stored values or the calculation core.
- **Frontend:** React 19 + Vite + React Router + TanStack Query. A hand-built design system (CSS custom properties). Charts are written with D3 scales and shapes rendered as React SVG, matching the paper's D3.js note.
- **PWA:** web manifest plus a Workbox service worker that precaches only the app shell. API responses are never cached by the service worker. An offline outbox holds new ledger entries until they sync.

## 7. Feature priorities
1. Accounts, auth, households, roles: the foundation for everything.
2. Collaborative ledger: transactions, categories, tags, comments, version history, revert.
3. Dashboard calculations: net worth, period summaries, budget status, upcoming bills.
4. Scenario planner and forecast engine.
5. Budgets, goals, recurring bills and income, and the budget wizard.
6. Notifications engine, activity feed, smart tips, automation rules.
7. CSV import/export, data export, account deletion.
8. Mobile and PWA polish, offline outbox.

## 8. Assumptions and unresolved questions
- **Single currency per household.** The household chooses an ISO currency and there is no FX conversion. The survey mentions multi-currency needs; this is recorded as future work.
- **Private accounts.** A member can mark an account *Private*. Its balance and transactions are visible only to that member, even to admins. Household totals, budgets and the forecast use shared accounts. The Personal view uses the member's private accounts. This is our reading of the paper's "restricted categories / personal discretionary funds within a joint budget".
- **Edit approvals.** The paper says roles can dictate who may "approve edits". v2 implements role and category-scoped edit rights plus full revision history with revert. A propose-and-approve queue is future work.
- **Email delivery.** No email provider credentials were supplied. Emails (password reset, invitations) go through a transport interface. In development they print to the server console, and in production an SMTP provider must be configured.
- **"AI" wording.** The prototype labels suggestions "AI". v2 uses deterministic, explainable rules and labels them that way, because the paper itself notes there is no ML. The labelling keeps the product honest.
- **Investments.** Market values are not fetched. Users record balance updates, which become ledger adjustments.
