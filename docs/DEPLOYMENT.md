# Deployment

This page describes the supported production shape, what has been verified, and how to put the site online. **Deploying needs your own hosting account**; nothing is deployed automatically.

## Recommended architecture
- **One Node.js service** (Node 20+) runs the API and serves the built web app from the same origin (`WEB_DIST_DIR`).
- **Managed PostgreSQL** (version 14 or later; tested against PostgreSQL 18 semantics via PGlite and the `pg` wire protocol) with automated backups.
- **TLS termination** at the platform or a reverse proxy; set `TRUST_PROXY=true`.
- **SMTP provider** for password-reset and invitation emails.
- **Persistent storage** for receipts: a mounted volume, or implement `StorageService` for S3/GCS.
- Suitable hosts: any container platform (Fly.io, Render, Railway, Cloud Run with a volume or S3 adapter, ECS) or a single VM with Docker Compose.

Start with **one instance**. Sessions live in the database, so more instances work behind any load balancer, with two caveats. Rate limits are kept in memory per instance, so move them to a shared store such as Redis. The hourly alert sweep runs in-process, so enable it on one instance only (`ALERT_SWEEP_MINUTES=0` on the rest).

## Render (one-click, recommended)
1. Open the **Deploy to Render** button in the README, or go to Render dashboard → **New → Blueprint** and pick this repository.
2. Render reads `render.yaml` and creates:
   - **`familypulse`**, a web service built from the `Dockerfile`, with health check `/api/health` and auto-deploy on every push to `main`;
   - **`familypulse-db`**, a PostgreSQL database wired in through `DATABASE_URL`.
3. When the deploy finishes, the site is at `https://familypulse-XXXX.onrender.com` (shown in the dashboard). `APP_ORIGIN` comes from Render's `RENDER_EXTERNAL_URL` automatically.

Preconfigured settings:
- `DEMO_MODE=true`: on first start the API loads the fictional sample household and offers "Explore the demo household" on the sign-in page. Demo accounts (`*@sample.familypulse.test`) are locked against password, profile, session, account, household, membership and invitation changes. The demo is reset whenever it is older than `DEMO_RESET_HOURS` (24), checked at startup and hourly, so it stays correct even when the service sleeps.
- `TRUST_PROXY=true`, so client IPs are correct for rate limiting behind Render's proxy.
- `EMAIL_TRANSPORT=console`: until you add SMTP (`EMAIL_TRANSPORT=smtp`, `SMTP_URL`), password-reset and invitation emails appear in the service log, not in inboxes. Invitations still work, because the inviter copies the link from the app.

**Free-tier caveats** (check Render's current terms):
- Free web services **sleep when idle**; the first visit afterwards takes a little while.
- Free PostgreSQL databases are **time-limited**; upgrade the database plan to keep data.
- The free plan has **no persistent disk**, so uploaded receipts are lost on redeploy or restart. Use a paid plan with a disk (`UPLOAD_DIR`) or add S3 storage before relying on receipts.

To turn the demo off, set `DEMO_MODE=false` (the sample household stays until deleted).

## Build & run without Docker

```bash
npm ci
npm run build                       # web → apps/web/dist, API → apps/api/dist (tsup)
cd apps/api
export NODE_ENV=production DATABASE_URL=postgres://… APP_ORIGIN=https://app.example.com \
       WEB_DIST_DIR=../web/dist TRUST_PROXY=true EMAIL_TRANSPORT=smtp SMTP_URL=smtps://…
npm start                           # = node dist/migrate.js && node dist/index.js
```

**Verified on the development machine:**
- The production bundle served the SPA, service worker and manifest.
- The app ran under the production CSP with no console errors.
- Login worked.
- A **production-only** install (`npm ci --omit=dev --workspace=@familypulse/api`, 129 packages) booted and handled registration (native Argon2 + database).

## Docker

```bash
docker compose up --build           # app on http://localhost:8080 with postgres:17
docker compose run --rm app node dist/seed.js --allow-production   # optional fictional demo data
```

`Dockerfile` is multi-stage: it builds everything, then a slim runtime with production dependencies only. It runs as the non-root `node` user, has a health check on `/api/health`, and applies migrations before starting.

> ✅ **Verified in CI.** The GitHub Actions `docker` job builds this image and smoke-tests `/api/health` and the web app on every push. The first run passed. (Docker isn't installed on the development machine.)

## Database
- Migrations are applied automatically at start (`dist/migrate.js`) and are safe to re-run.
- Schema changes: edit `src/db/schema.ts`, run `npm run db:generate -w @familypulse/api`, commit the new SQL in `apps/api/drizzle/`.
- Back up before deploying migrations. There are no destructive migrations yet.

## Environment
See `.env.example` for every variable. In production you must set `DATABASE_URL`, `APP_ORIGIN`, the SMTP settings, `TRUST_PROXY` (behind a proxy), and a durable upload location. Never set `COOKIE_SECURE=false` outside local HTTP testing.

## Pre-launch checklist
- [ ] Docker image built and smoke-tested in CI (`/api/health`, sign-in, a page load)
- [ ] TLS, a custom domain, and `APP_ORIGIN` matching it
- [ ] Database backups and point-in-time recovery enabled; connection over TLS
- [ ] SMTP verified with a real password reset
- [ ] Receipts on durable, private storage
- [ ] Logs shipped to a log store (they are JSON in production and contain no request bodies)
- [ ] Uptime check on `/api/health`
- [ ] Security review and, if serving real users, a legal and privacy review (see SECURITY_AND_PRIVACY.md)
