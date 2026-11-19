import fs from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { deps } from './lib/deps';
import { logger } from './lib/logger';
import { errorHandler, notFoundHandler } from './lib/errors';
import { csrfGuard, loadHousehold, requireAuth } from './lib/http';
import { apiLimiter } from './lib/rateLimit';
import { loadSession } from './modules/auth/session';
import { authRouter } from './modules/auth/routes';
import { householdRouter, householdsRootRouter } from './modules/households/routes';
import { accountsRouter } from './modules/accounts/routes';
import { categoriesRouter } from './modules/categories/routes';
import { transactionsRouter } from './modules/transactions/routes';
import { planningRouter } from './modules/planning/routes';
import { dashboardRouter } from './modules/dashboard/routes';
import { rulesRouter } from './modules/rules/routes';
import { activityRouter, notificationsRouter } from './modules/activity/routes';
import { importsRouter } from './modules/imports/routes';
import { privacyRouter } from './modules/privacy/routes';
import { providerStatuses } from './services/providers';

export function createApp() {
  const { config } = deps();
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"], // inline style attributes used for chart geometry
          'img-src': ["'self'", 'data:', 'blob:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'manifest-src': ["'self'"],
          'worker-src': ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'same-origin' },
      hsts: config.isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  // Minimal access log — method, path and status only (never bodies or query strings).
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api')) logger.info({ m: req.method, p: req.path.replace(/[0-9a-f-]{36}/gi, ':id'), s: res.statusCode, ms: Date.now() - start }, 'request');
    });
    next();
  });

  const api = Router();
  api.use(express.json({ limit: '1.2mb' })); // CSV imports are the largest JSON payload (≤1 MB)
  api.use(cookieParser());
  api.use(apiLimiter);
  api.use(csrfGuard);
  api.use(loadSession);
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); // financial data must not be cached by browsers or proxies
    next();
  });

  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.get('/integrations', requireAuth, (_req, res) => res.json({ providers: providerStatuses() }));
  api.use('/auth', authRouter);
  api.use('/me', privacyRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/', householdsRootRouter);

  const hh = Router({ mergeParams: true });
  hh.use(loadHousehold);
  hh.use('/accounts', accountsRouter);
  hh.use('/categories', categoriesRouter);
  hh.use('/transactions', transactionsRouter);
  hh.use('/rules', rulesRouter);
  hh.use('/activity', activityRouter);
  hh.use('/imports', importsRouter);
  hh.use('/', planningRouter);
  hh.use('/', dashboardRouter);
  hh.use('/', householdRouter);
  api.use('/households/:householdId', requireAuth, hh);

  api.use(notFoundHandler);
  app.use('/api', api);

  // Single-origin production deploy: serve the built web app with SPA fallback.
  if (config.webDistDir && fs.existsSync(path.join(config.webDistDir, 'index.html'))) {
    const dist = config.webDistDir;
    app.use(
      express.static(dist, {
        index: false,
        setHeaders(res, file) {
          if (/[\\/]assets[\\/]/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          else res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
