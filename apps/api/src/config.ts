import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .optional();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** postgres://… for PostgreSQL. When unset, an embedded PGlite database is used (development). */
  DATABASE_URL: z.string().optional(),
  /** Directory for the embedded PGlite database, or "memory://" for an ephemeral one. */
  PGLITE_DIR: z.string().default('./data/pglite'),
  /** Public origin of the web app (CSRF origin check, links in emails). Defaults to the URL Render assigns (RENDER_EXTERNAL_URL), then to the local dev server. */
  APP_ORIGIN: z.string().url().optional(),
  RENDER_EXTERNAL_URL: z.string().url().optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  COOKIE_SECURE: bool,
  TRUST_PROXY: bool,
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(20).default(5),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** When set, the API also serves the built web app from this directory (single-origin deploy). */
  WEB_DIST_DIR: z.string().optional(),
  EMAIL_TRANSPORT: z.enum(['console', 'smtp', 'disabled']).default('console'),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default('FamilyPulse <no-reply@familypulse.local>'),
  RATE_LIMIT_ENABLED: bool,
  /** Background alert sweep interval (minutes). 0 disables the scheduler. */
  ALERT_SWEEP_MINUTES: z.coerce.number().int().min(0).max(1440).default(60),
  /** Public demo: load the fictional sample household at startup, lock its accounts, reset it on a schedule. */
  DEMO_MODE: bool,
  DEMO_RESET_HOURS: z.coerce.number().min(0).max(720).default(24),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === 'production';
  if (isProd && e.EMAIL_TRANSPORT === 'smtp' && !e.SMTP_URL) {
    throw new Error('EMAIL_TRANSPORT=smtp requires SMTP_URL');
  }
  return {
    env: e.NODE_ENV,
    isProd,
    isTest: e.NODE_ENV === 'test',
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    pgliteDir: e.PGLITE_DIR,
    appOrigin: (e.APP_ORIGIN ?? e.RENDER_EXTERNAL_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
    sessionTtlMs: e.SESSION_TTL_DAYS * 86_400_000,
    cookieSecure: e.COOKIE_SECURE ?? isProd,
    trustProxy: e.TRUST_PROXY ?? false,
    uploadDir: path.resolve(e.UPLOAD_DIR),
    maxUploadBytes: Math.round(e.MAX_UPLOAD_MB * 1024 * 1024),
    logLevel: e.NODE_ENV === 'test' ? 'silent' : e.LOG_LEVEL,
    webDistDir: e.WEB_DIST_DIR ? path.resolve(e.WEB_DIST_DIR) : undefined,
    emailTransport: e.EMAIL_TRANSPORT,
    smtpUrl: e.SMTP_URL,
    emailFrom: e.EMAIL_FROM,
    rateLimitEnabled: e.RATE_LIMIT_ENABLED ?? e.NODE_ENV !== 'test',
    alertSweepMinutes: e.NODE_ENV === 'test' ? 0 : e.ALERT_SWEEP_MINUTES,
    demoMode: e.DEMO_MODE ?? false,
    demoResetHours: e.DEMO_RESET_HOURS,
  };
}
