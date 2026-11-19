import type { Executor } from '../db/client';
import { activityEvents } from '../db/schema';
import { newId } from './crypto';

export interface ActivityInput {
  householdId: string;
  actorId: string | null;
  entityType: 'transaction' | 'account' | 'budget' | 'goal' | 'recurring' | 'member' | 'household' | 'rule' | 'scenario' | 'category' | 'import' | 'comment';
  entityId?: string | null;
  action: string;
  summary: string;
  metadata?: Record<string, unknown>;
  /** Restrict visibility (events about private accounts). */
  visibleToUserId?: string | null;
}

/** Append-only audit trail backing the household Activity Feed (paper §2.6). */
export async function logActivity(exec: Executor, a: ActivityInput): Promise<void> {
  await exec.insert(activityEvents).values({
    id: newId(),
    householdId: a.householdId,
    actorId: a.actorId,
    entityType: a.entityType,
    entityId: a.entityId ?? null,
    action: a.action,
    summary: a.summary,
    metadata: a.metadata ?? {},
    visibleToUserId: a.visibleToUserId ?? null,
  });
}
