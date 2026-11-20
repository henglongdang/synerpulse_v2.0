import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { can, isDemoEmail, todayInZone, type Capability, type Role } from '@synerpulse/shared';
import { db, deps } from './deps';
import { AppError, forbidden, notFound, unauthorized } from './errors';
import { householdMembers, households, memberCategoryScopes } from '../db/schema';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export interface HouseholdCtx {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  isSample: boolean;
  role: Role;
  /** Category ids a scoped contributor may edit (empty = unrestricted). */
  categoryScope: string[];
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    sessionId?: string;
    household?: HouseholdCtx;
  }
}

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function currentHousehold(req: Request): HouseholdCtx {
  if (!req.household) throw new Error('household context missing');
  return req.household;
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  next();
};

/**
 * Resolves `:householdId` to the caller's membership. Non-members get 404 (not 403), so a user
 * cannot even probe whether another household exists by manipulating the URL.
 */
export async function loadHousehold(req: Request, _res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) return next(unauthorized());
  const raw = req.params.householdId;
  const householdId = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(householdId)) return next(notFound('Household'));
  const rows = await db()
    .select({
      id: households.id,
      name: households.name,
      currency: households.currency,
      timezone: households.timezone,
      isSample: households.isSample,
      role: householdMembers.role,
    })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, user.id)))
    .limit(1);
  const row = rows[0];
  if (!row) return next(notFound('Household'));
  let categoryScope: string[] = [];
  if (row.role === 'contributor') {
    const scopes = await db()
      .select({ categoryId: memberCategoryScopes.categoryId })
      .from(memberCategoryScopes)
      .where(and(eq(memberCategoryScopes.householdId, householdId), eq(memberCategoryScopes.userId, user.id)));
    categoryScope = scopes.map((s) => s.categoryId);
  }
  req.household = { ...row, categoryScope };
  next();
}

/** The household's calendar date (its own time zone), used for budgets, due dates and validation. */
export function householdToday(h: Pick<HouseholdCtx, 'timezone'>): string {
  return todayInZone(h.timezone);
}

/**
 * The shared demo accounts are used by many visitors at once. Account- and household-level changes
 * (passwords, deleting, membership, invitations) are refused so nobody can lock others out; the
 * financial data inside the demo stays fully editable and is reset on a schedule.
 */
export const forbidDemo: RequestHandler = (req, _res, next) => {
  if (req.user && isDemoEmail(req.user.email)) {
    return next(new AppError(403, 'demo_locked', 'This is the shared demo account, so this setting is locked. Create your own free account to use it.'));
  }
  next();
};

export function requireCap(capability: Capability): RequestHandler {
  return (req, _res, next) => {
    const h = req.household;
    if (!h) return next(new AppError(500, 'internal', 'household context missing'));
    if (!can(h.role, capability)) return next(forbidden(`Your role (${h.role}) cannot do that`));
    next();
  };
}

export function assertCap(h: HouseholdCtx, capability: Capability): void {
  if (!can(h.role, capability)) throw forbidden(`Your role (${h.role}) cannot do that`);
}

/**
 * CSRF defence for cookie-authenticated, state-changing requests:
 *  1. Session cookies are SameSite=Lax (blocks cross-site POSTs in modern browsers).
 *  2. A custom header is required — browsers cannot attach it cross-origin without a CORS
 *     preflight, which this API never grants.
 *  3. If an Origin header is present it must match the app origin.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'synerpulse') {
    return next(new AppError(403, 'csrf', 'Missing request header'));
  }
  const origin = req.get('origin');
  if (origin) {
    const allowed = new Set([deps().config.appOrigin]);
    const host = req.get('host');
    if (host) {
      allowed.add(`http://${host}`);
      allowed.add(`https://${host}`);
    }
    if (!allowed.has(origin)) return next(new AppError(403, 'csrf', 'Cross-origin request rejected'));
  }
  next();
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read a UUID route parameter; malformed ids are treated as "not found". */
export function idParam(req: Request, name: string, what = 'Resource'): string {
  const v = req.params[name];
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw notFound(what);
  return v.toLowerCase();
}

export function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}
