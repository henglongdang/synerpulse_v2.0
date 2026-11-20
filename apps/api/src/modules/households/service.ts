import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { HouseholdSummaryDTO, MemberDTO, Role } from '@synerpulse/shared';
import type { Executor } from '../../db/client';
import { categories, householdMembers, households, memberCategoryScopes, users } from '../../db/schema';
import { db } from '../../lib/deps';
import { newId } from '../../lib/crypto';
import { DEFAULT_CATEGORIES } from './defaults';
import { logActivity } from '../../lib/activity';

export async function listHouseholdsForUser(userId: string, preferredId: string | null): Promise<HouseholdSummaryDTO[]> {
  const rows = await db()
    .select({
      id: households.id,
      name: households.name,
      currency: households.currency,
      timezone: households.timezone,
      isSample: households.isSample,
      onboardedAt: households.onboardedAt,
      role: householdMembers.role,
      memberCount: sql<number>`(select count(*)::int from household_members m where m.household_id = "households"."id")`,
    })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(eq(householdMembers.userId, userId))
    .orderBy(asc(householdMembers.joinedAt));
  const list = rows.map((r) => ({ ...r, onboardedAt: r.onboardedAt?.toISOString() ?? null }));
  // Most recently used household first, so the client can default to it.
  if (preferredId) list.sort((a, b) => (a.id === preferredId ? -1 : b.id === preferredId ? 1 : 0));
  return list;
}

export async function createHousehold(
  exec: Executor,
  input: { name: string; currency: string; timezone?: string; ownerId: string; isSample?: boolean },
): Promise<string> {
  const id = newId();
  await exec.insert(households).values({ id, name: input.name, currency: input.currency, timezone: input.timezone ?? 'UTC', isSample: input.isSample ?? false });
  await exec.insert(householdMembers).values({ householdId: id, userId: input.ownerId, role: 'owner' });
  await exec.insert(categories).values(DEFAULT_CATEGORIES.map((c) => ({ id: newId(), householdId: id, ...c })));
  await logActivity(exec, {
    householdId: id,
    actorId: input.ownerId,
    entityType: 'household',
    entityId: id,
    action: 'created',
    summary: `created the household “${input.name}”`,
  });
  return id;
}

export async function listMembers(householdId: string): Promise<MemberDTO[]> {
  const rows = await db()
    .select({
      userId: householdMembers.userId,
      role: householdMembers.role,
      joinedAt: householdMembers.joinedAt,
      name: users.name,
      email: users.email,
    })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(asc(householdMembers.joinedAt));
  const scopes = await db()
    .select()
    .from(memberCategoryScopes)
    .where(eq(memberCategoryScopes.householdId, householdId));
  return rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    email: r.email,
    role: r.role as Role,
    joinedAt: r.joinedAt.toISOString(),
    categoryScope: scopes.filter((s) => s.userId === r.userId).map((s) => s.categoryId),
  }));
}

export async function getMemberRole(exec: Executor, householdId: string, userId: string): Promise<Role | null> {
  const [row] = await exec
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)));
  return (row?.role as Role) ?? null;
}

/** Replace a member's category scope after verifying every category belongs to the household. */
export async function setCategoryScope(exec: Executor, householdId: string, userId: string, categoryIds: string[]) {
  const unique = [...new Set(categoryIds)];
  if (unique.length) {
    const valid = await exec
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.householdId, householdId), inArray(categories.id, unique)));
    if (valid.length !== unique.length) throw new Error('scope_invalid');
  }
  await exec
    .delete(memberCategoryScopes)
    .where(and(eq(memberCategoryScopes.householdId, householdId), eq(memberCategoryScopes.userId, userId)));
  if (unique.length) {
    await exec.insert(memberCategoryScopes).values(unique.map((categoryId) => ({ householdId, userId, categoryId })));
  }
}
