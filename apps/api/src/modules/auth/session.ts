import type { Request, RequestHandler, Response } from 'express';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db, deps } from '../../lib/deps';
import { hashToken, newId, newToken } from '../../lib/crypto';
import { sessions, users } from '../../db/schema';

export const sessionCookieName = () => (deps().config.cookieSecure ? '__Host-fp_session' : 'fp_session');

const SLIDE_AFTER_MS = 60 * 60 * 1000; // refresh expiry at most hourly

export async function createSession(req: Request, res: Response, userId: string): Promise<void> {
  const token = newToken();
  const now = Date.now();
  const ttl = deps().config.sessionTtlMs;
  await db()
    .insert(sessions)
    .values({
      id: newId(),
      userId,
      tokenHash: hashToken(token),
      userAgent: (req.get('user-agent') ?? '').slice(0, 200) || null,
      expiresAt: new Date(now + ttl),
    });
  setSessionCookie(res, token);
}

function setSessionCookie(res: Response, token: string) {
  const { cookieSecure, sessionTtlMs } = deps().config;
  res.cookie(sessionCookieName(), token, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: sessionTtlMs,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(sessionCookieName(), { path: '/', httpOnly: true, secure: deps().config.cookieSecure, sameSite: 'lax' });
}

/** Attaches req.user when a valid session cookie is present. Never rejects — see requireAuth. */
export const loadSession: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.[sessionCookieName()];
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return next();
  const now = new Date();
  const rows = await db()
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      name: users.name,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    clearSessionCookie(res);
    return next();
  }
  req.user = { id: row.userId, name: row.name, email: row.email };
  req.sessionId = row.sessionId;
  if (now.getTime() - row.lastSeenAt.getTime() > SLIDE_AFTER_MS) {
    await db()
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + deps().config.sessionTtlMs) })
      .where(eq(sessions.id, row.sessionId));
    setSessionCookie(res, token);
  }
  next();
};

export async function purgeExpiredSessions(): Promise<void> {
  await db().delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
