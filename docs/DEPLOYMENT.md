# Deployment

**FamilyPulse is not deployed anywhere yet.** This page describes the supported production shape and what has been verified.

## Recommended architecture
- **One Node.js service** (Node 20+) runs the API and serves the built web app from the same origin (`WEB_DIST_DIR`).
- **Managed PostgreSQL** (version 14 or later; tested against PostgreSQL 18 semantics via PGlite and the `pg` wire protocol) with automated backups.
- **TLS termination** at the platform or a reverse proxy; set `TRUST_PROXY=true`.
- **SMTP provider** for password-reset and invitation emails.
- **Persistent storage** for receipts: a mounted volume, or implement `StorageService` for S3/GCS.
- Suitable hosts: any container platform (Fly.io, Render, Railway, Cloud Run with a volume or S3 adapter, ECS) or a single VM with Docker Compose.

Start with **one instance**. Sessions live in the database, so more instances work behind any load balancer, with two caveats. Rate limits are kept in memory per instance, so move them to a shared store such as Redis. The hourly alert sweep runs in-process, so enable it on one instance only (`ALERT_SWEEP_MINUTES=0` on the rest).

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

> ⚠️ **Not built or run here**, because Docker was not available on the development machine. The image reproduces the runtime layout that *was* verified above. Build it once in CI before relying on it.

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
