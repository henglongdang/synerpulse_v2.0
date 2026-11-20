import { eq, inArray, like } from 'drizzle-orm';
import { DEMO_EMAIL_DOMAIN } from '@familypulse/shared';
import type { DB } from '../../db/client';
import { accounts, households, users } from '../../db/schema';
import { seed } from '../../db/seed';
import { deps } from '../../lib/deps';
import { logger } from '../../lib/logger';

/**
 * Public demo lifecycle: the fictional sample household is (re)created from the seed script.
 * Resetting deletes the sample household(s) and the demo users (their sessions go with them),
 * then seeds a fresh copy, so whatever visitors changed is undone.
 */
export async function resetDemo(db: DB): Promise<void> {
  const sampleHouseholds = (await db.select({ id: households.id }).from(households).where(eq(households.isSample, true))).map((h) => h.id);
  await db.transaction(async (tx) => {
    if (sampleHouseholds.length) {
      await tx.delete(accounts).where(inArray(accounts.householdId, sampleHouseholds));
      await tx.delete(households).where(inArray(households.id, sampleHouseholds));
    }
    await tx.delete(users).where(like(users.email, `%@${DEMO_EMAIL_DOMAIN}`));
  });
  await seed(db);
}

/**
 * Seeds the demo if missing, and resets it once it is older than `maxAgeHours`.
 * Age-based (not a fixed timer) so it stays correct on hosts that sleep idle services.
 * Returns what it did.
 */
export async function ensureDemo(db: DB, maxAgeHours: number, now = new Date()): Promise<'created' | 'reset' | 'fresh'> {
  const [existing] = await db.select({ createdAt: households.createdAt }).from(households).where(eq(households.isSample, true)).limit(1);
  if (!existing) {
    await resetDemo(db);
    return 'created';
  }
  if (maxAgeHours > 0 && now.getTime() - existing.createdAt.getTime() >= maxAgeHours * 3_600_000) {
    await resetDemo(db);
    return 'reset';
  }
  return 'fresh';
}

export function startDemoScheduler(): () => void {
  const { config, db } = deps();
  if (!config.demoMode) return () => {};
  const check = () =>
    ensureDemo(db, config.demoResetHours)
      .then((r) => r !== 'fresh' && logger.info(`Demo household ${r}`))
      .catch((e) => logger.error({ err: e.message }, 'demo check failed'));
  void check();
  const timer = setInterval(() => void check(), 3_600_000);
  timer.unref();
  return () => clearInterval(timer);
}
