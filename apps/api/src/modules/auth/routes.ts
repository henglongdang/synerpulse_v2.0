import { Router } from 'express';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import {
  changePasswordSchema,
  DEFAULT_NOTIFICATION_PREFS,
  forgotPasswordSchema,
  isDemoEmail,
  loginSchema,
  notificationPrefsSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  type MeDTO,
  type NotificationPrefs,
  type SessionDTO,
} from '@synerpulse/shared';
import { db, deps } from '../../lib/deps';
import { burnPasswordCheck, hashPassword, hashToken, newId, newToken, verifyPassword } from '../../lib/crypto';
import { AppError, conflict, notFound, parse, unauthorized } from '../../lib/errors';
import { currentUser, forbidDemo, idParam, requireAuth } from '../../lib/http';
import { loginLimiter, passwordResetLimiter, registerLimiter } from '../../lib/rateLimit';
import { notifications, passwordResetTokens, sessions, users } from '../../db/schema';
import { clearSessionCookie, createSession } from './session';
import { listHouseholdsForUser } from '../households/service';

export const authRouter = Router();

const RESET_TTL_MS = 30 * 60_000;

function prefsFor(stored: Partial<NotificationPrefs> | null | undefined): NotificationPrefs {
  return { ...DEFAULT_NOTIFICATION_PREFS, ...(stored ?? {}) };
}

authRouter.post('/register', registerLimiter, async (req, res) => {
  const input = parse(registerSchema, req.body);
  const existing = await db()
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${input.email}`)
    .limit(1);
  if (existing.length) throw conflict('An account with this email already exists. Try signing in instead.');
  const id = newId();
  await db()
    .insert(users)
    .values({ id, email: input.email, name: input.name, passwordHash: await hashPassword(input.password) });
  await createSession(req, res, id);
  res.status(201).json({ user: { id, name: input.name, email: input.email } });
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const input = parse(loginSchema, req.body);
  const rows = await db()
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${input.email}`)
    .limit(1);
  const user = rows[0];
  if (!user) {
    await burnPasswordCheck(input.password);
    throw new AppError(401, 'invalid_credentials', 'Email or password is incorrect');
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw new AppError(401, 'invalid_credentials', 'Email or password is incorrect');
  }
  await createSession(req, res, user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

authRouter.post('/logout', async (req, res) => {
  if (req.sessionId) await db().delete(sessions).where(eq(sessions.id, req.sessionId));
  clearSessionCookie(res);
  res.status(204).end();
});

async function buildMe(userId: string): Promise<MeDTO | null> {
  const [row] = await db().select().from(users).where(eq(users.id, userId));
  if (!row) return null;
  const [{ count }] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return {
    user: { id: row.id, name: row.name, email: row.email, createdAt: row.createdAt.toISOString() },
    households: await listHouseholdsForUser(userId, row.lastHouseholdId),
    notificationPrefs: prefsFor(row.notificationPrefs),
    unreadNotifications: count,
  };
}

authRouter.get('/me', requireAuth, async (req, res) => {
  const me = await buildMe(currentUser(req).id);
  if (!me) throw unauthorized();
  res.json(me);
});

/** Session probe for the web app: 200 with `me: null` when signed out (no noisy 401 on first load). */
authRouter.get('/session', async (req, res) => {
  res.json({ me: req.user ? await buildMe(req.user.id) : null });
});

authRouter.patch('/me', requireAuth, forbidDemo, async (req, res) => {
  const input = parse(updateProfileSchema, req.body);
  const user = currentUser(req);
  await db().update(users).set({ name: input.name, updatedAt: new Date() }).where(eq(users.id, user.id));
  res.json({ user: { ...user, name: input.name } });
});

authRouter.put('/me/notification-prefs', requireAuth, async (req, res) => {
  const input = parse(notificationPrefsSchema, req.body);
  await db().update(users).set({ notificationPrefs: input, updatedAt: new Date() }).where(eq(users.id, currentUser(req).id));
  res.json({ notificationPrefs: input });
});

authRouter.post('/me/last-household', requireAuth, async (req, res) => {
  const householdId = typeof req.body?.householdId === 'string' ? req.body.householdId : null;
  const user = currentUser(req);
  const list = await listHouseholdsForUser(user.id, null);
  if (!householdId || !list.some((h) => h.id === householdId)) throw notFound('Household');
  await db().update(users).set({ lastHouseholdId: householdId }).where(eq(users.id, user.id));
  res.status(204).end();
});

authRouter.post('/password/change', requireAuth, forbidDemo, async (req, res) => {
  const input = parse(changePasswordSchema, req.body);
  const user = currentUser(req);
  const [row] = await db().select().from(users).where(eq(users.id, user.id));
  if (!row || !(await verifyPassword(row.passwordHash, input.currentPassword))) {
    throw new AppError(400, 'invalid_credentials', 'Your current password is incorrect', {
      currentPassword: ['Your current password is incorrect'],
    });
  }
  await db()
    .update(users)
    .set({ passwordHash: await hashPassword(input.newPassword), updatedAt: new Date() })
    .where(eq(users.id, user.id));
  // Sign out every other device.
  await db()
    .delete(sessions)
    .where(and(eq(sessions.userId, user.id), ne(sessions.id, req.sessionId!)));
  res.status(204).end();
});

authRouter.post('/password/forgot', passwordResetLimiter, async (req, res) => {
  const input = parse(forgotPasswordSchema, req.body);
  const [user] = await db()
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${input.email}`)
    .limit(1);
  // Demo accounts are shared and never get reset links.
  if (user && !isDemoEmail(user.email)) {
    const token = newToken();
    await db()
      .insert(passwordResetTokens)
      .values({ id: newId(), userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) });
    const link = `${deps().config.appOrigin}/reset-password?token=${encodeURIComponent(token)}`;
    await deps().email.send({
      to: user.email,
      subject: 'Reset your SynerPulse password',
      text: `Hi ${user.name},\n\nSomeone (hopefully you) asked to reset your SynerPulse password.\nThis link works once and expires in 30 minutes:\n\n${link}\n\nIf you did not ask for this, you can ignore this email — your password has not changed.`,
    });
  }
  // Same response either way, so the endpoint cannot be used to discover registered emails.
  res.json({ ok: true, message: 'If an account exists for that email, a reset link is on its way.' });
});

authRouter.post('/password/reset', passwordResetLimiter, async (req, res) => {
  const input = parse(resetPasswordSchema, req.body);
  const now = new Date();
  const [row] = await db()
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hashToken(input.token)),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now),
      ),
    )
    .limit(1);
  if (!row) throw new AppError(400, 'invalid_token', 'This reset link is invalid or has expired. Request a new one.');
  await db().transaction(async (tx) => {
    await tx.update(passwordResetTokens).set({ usedAt: now }).where(eq(passwordResetTokens.userId, row.userId));
    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(input.password), updatedAt: now })
      .where(eq(users.id, row.userId));
    await tx.delete(sessions).where(eq(sessions.userId, row.userId));
  });
  res.json({ ok: true });
});

authRouter.get('/sessions', requireAuth, async (req, res) => {
  const rows = await db()
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, currentUser(req).id), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt));
  const out: SessionDTO[] = rows.map((s) => ({
    id: s.id,
    current: s.id === req.sessionId,
    userAgent: s.userAgent,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
  }));
  res.json({ sessions: out });
});

authRouter.delete('/sessions/:sessionId', requireAuth, forbidDemo, async (req, res) => {
  const sessionId = idParam(req, 'sessionId', 'Session');
  const result = await db()
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, currentUser(req).id)))
    .returning({ id: sessions.id });
  if (!result.length) throw notFound('Session');
  if (sessionId === req.sessionId) clearSessionCookie(res);
  res.status(204).end();
});
