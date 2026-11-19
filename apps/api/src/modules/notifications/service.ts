import { inArray } from 'drizzle-orm';
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs, type NotificationType } from '@familypulse/shared';
import type { Executor } from '../../db/client';
import { notifications, users } from '../../db/schema';
import { newId } from '../../lib/crypto';

export interface NotifyInput {
  userId: string;
  householdId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  /** If set, the same (user, key) pair is only ever notified once. */
  dedupeKey?: string | null;
}

/** Insert an in-app notification. Returns true if a new notification was created. */
export async function notify(exec: Executor, n: NotifyInput): Promise<boolean> {
  const rows = await exec
    .insert(notifications)
    .values({
      id: newId(),
      userId: n.userId,
      householdId: n.householdId,
      type: n.type,
      title: n.title.slice(0, 140),
      body: n.body.slice(0, 500),
      link: n.link ?? null,
      dedupeKey: n.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return rows.length > 0;
}

export async function prefsForUsers(exec: Executor, userIds: string[]): Promise<Map<string, NotificationPrefs>> {
  const out = new Map<string, NotificationPrefs>();
  if (!userIds.length) return out;
  const rows = await exec
    .select({ id: users.id, prefs: users.notificationPrefs })
    .from(users)
    .where(inArray(users.id, userIds));
  for (const r of rows) out.set(r.id, { ...DEFAULT_NOTIFICATION_PREFS, ...(r.prefs ?? {}) });
  return out;
}
