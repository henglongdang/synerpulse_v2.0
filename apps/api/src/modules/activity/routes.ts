import { Router } from 'express';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ActivityDTO, NotificationDTO } from '@synerpulse/shared';
import { activityEvents, notifications, users } from '../../db/schema';
import { db } from '../../lib/deps';
import { notFound, parse } from '../../lib/errors';
import { currentHousehold, currentUser, idParam, requireAuth, requireCap } from '../../lib/http';

/** Household activity feed (mounted under /households/:householdId). */
export const activityRouter = Router({ mergeParams: true });

activityRouter.get('/', requireCap('activity.view'), async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const q = parse(
    z.object({
      before: z.string().datetime().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
      entityType: z.string().max(20).optional(),
      entityId: z.string().uuid().optional(),
    }),
    req.query,
  );
  const rows = await db()
    .select({ e: activityEvents, actorName: users.name })
    .from(activityEvents)
    .leftJoin(users, eq(users.id, activityEvents.actorId))
    .where(
      and(
        eq(activityEvents.householdId, h.id),
        or(isNull(activityEvents.visibleToUserId), eq(activityEvents.visibleToUserId, user.id)),
        q.before ? lt(activityEvents.createdAt, new Date(q.before)) : undefined,
        q.entityType ? eq(activityEvents.entityType, q.entityType) : undefined,
        q.entityId ? eq(activityEvents.entityId, q.entityId) : undefined,
      ),
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(q.limit + 1);
  const items: ActivityDTO[] = rows.slice(0, q.limit).map(({ e, actorName }) => ({
    id: e.id,
    actor: e.actorId ? { id: e.actorId, name: actorName ?? 'Former member' } : null,
    entityType: e.entityType,
    entityId: e.entityId,
    action: e.action,
    summary: e.summary,
    createdAt: e.createdAt.toISOString(),
  }));
  res.json({ items, nextBefore: rows.length > q.limit ? items[items.length - 1].createdAt : null });
});

/** Per-user notification inbox (mounted under /api/notifications). */
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

function toDTO(n: typeof notifications.$inferSelect): NotificationDTO {
  return {
    id: n.id,
    type: n.type as NotificationDTO['type'],
    title: n.title,
    body: n.body,
    link: n.link,
    householdId: n.householdId,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

notificationsRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const q = parse(z.object({ unread: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }), req.query);
  const rows = await db()
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), q.unread === 'true' ? isNull(notifications.readAt) : undefined))
    .orderBy(desc(notifications.createdAt))
    .limit(q.limit);
  const [{ unread }] = await db()
    .select({ unread: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  res.json({ items: rows.map(toDTO), unread });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await db()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, currentUser(req).id), isNull(notifications.readAt)));
  res.status(204).end();
});

notificationsRouter.post('/:notificationId/read', async (req, res) => {
  const rows = await db()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, idParam(req, 'notificationId', 'Notification')), eq(notifications.userId, currentUser(req).id)))
    .returning({ id: notifications.id });
  if (!rows.length) throw notFound('Notification');
  res.status(204).end();
});

notificationsRouter.delete('/:notificationId', async (req, res) => {
  const rows = await db()
    .delete(notifications)
    .where(and(eq(notifications.id, idParam(req, 'notificationId', 'Notification')), eq(notifications.userId, currentUser(req).id)))
    .returning({ id: notifications.id });
  if (!rows.length) throw notFound('Notification');
  res.status(204).end();
});
