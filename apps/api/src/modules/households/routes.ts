import { Router } from 'express';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import {
  canAssignRole,
  canManageMember,
  createHouseholdSchema,
  inviteSchema,
  ROLE_LABELS,
  transferOwnershipSchema,
  updateHouseholdSchema,
  updateMemberSchema,
  type InviteDTO,
  type Role,
} from '@familypulse/shared';
import { z } from 'zod';
import { accounts, householdMembers, households, invitations, users } from '../../db/schema';
import { db, deps } from '../../lib/deps';
import { hashToken, newId, newToken } from '../../lib/crypto';
import { AppError, badRequest, conflict, forbidden, notFound, parse } from '../../lib/errors';
import { currentHousehold, currentUser, forbidDemo, idParam, requireAuth, requireCap } from '../../lib/http';
import { logActivity } from '../../lib/activity';
import { createHousehold, getMemberRole, listMembers, setCategoryScope } from './service';
import { notify } from '../notifications/service';

const INVITE_TTL_MS = 7 * 86_400_000;

/** Routes not tied to a household the caller already belongs to. */
export const householdsRootRouter = Router();
/** Routes mounted under /api/households/:householdId (membership already verified). */
export const householdRouter = Router({ mergeParams: true });

householdsRootRouter.post('/households', requireAuth, forbidDemo, async (req, res) => {
  const input = parse(createHouseholdSchema, req.body);
  const user = currentUser(req);
  const id = await db().transaction((tx) => createHousehold(tx, { name: input.name, currency: input.currency, timezone: input.timezone, ownerId: user.id }));
  await db().update(users).set({ lastHouseholdId: id }).where(eq(users.id, user.id));
  res.status(201).json({ household: { id, name: input.name, currency: input.currency, timezone: input.timezone, role: 'owner', isSample: false, memberCount: 1, onboardedAt: null } });
});

// ---------- invitation acceptance (token-based) ----------
async function findInvite(token: string) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const [row] = await db()
    .select({
      id: invitations.id,
      householdId: invitations.householdId,
      householdName: households.name,
      email: invitations.email,
      role: invitations.role,
      categoryScope: invitations.categoryScope,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      revokedAt: invitations.revokedAt,
      inviterName: users.name,
    })
    .from(invitations)
    .innerJoin(households, eq(households.id, invitations.householdId))
    .leftJoin(users, eq(users.id, invitations.createdBy))
    .where(eq(invitations.tokenHash, hashToken(token)))
    .limit(1);
  return row ?? null;
}

householdsRootRouter.get('/invitations/:token', async (req, res) => {
  const inv = await findInvite(String(req.params.token));
  if (!inv) throw notFound('Invitation');
  const status = inv.revokedAt ? 'revoked' : inv.acceptedAt ? 'accepted' : inv.expiresAt < new Date() ? 'expired' : 'pending';
  res.json({
    invitation: {
      householdName: inv.householdName,
      inviterName: inv.inviterName,
      role: inv.role,
      emailRestricted: Boolean(inv.email),
      status,
    },
  });
});

householdsRootRouter.post('/invitations/:token/accept', requireAuth, forbidDemo, async (req, res) => {
  const user = currentUser(req);
  const inv = await findInvite(String(req.params.token));
  if (!inv) throw notFound('Invitation');
  if (inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date()) {
    throw new AppError(410, 'invitation_unavailable', 'This invitation has expired or was already used. Ask for a new link.');
  }
  if (inv.email && inv.email.toLowerCase() !== user.email.toLowerCase()) {
    throw forbidden('This invitation was sent to a different email address. Sign in with that account to accept it.');
  }
  const existing = await getMemberRole(db(), inv.householdId, user.id);
  if (existing) throw conflict('You are already a member of this household.');
  await db().transaction(async (tx) => {
    await tx.insert(householdMembers).values({ householdId: inv.householdId, userId: user.id, role: inv.role });
    if (inv.role === 'contributor' && inv.categoryScope.length) {
      try {
        await setCategoryScope(tx, inv.householdId, user.id, inv.categoryScope);
      } catch {
        /* categories deleted since invite — fall back to unrestricted */
      }
    }
    await tx.update(invitations).set({ acceptedAt: new Date(), acceptedBy: user.id }).where(eq(invitations.id, inv.id));
    await tx.update(users).set({ lastHouseholdId: inv.householdId }).where(eq(users.id, user.id));
    await logActivity(tx, {
      householdId: inv.householdId,
      actorId: user.id,
      entityType: 'member',
      entityId: user.id,
      action: 'joined',
      summary: `joined the household as ${ROLE_LABELS[inv.role as Role]}`,
    });
    const admins = await tx
      .select({ userId: householdMembers.userId, role: householdMembers.role })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, inv.householdId), ne(householdMembers.userId, user.id)));
    for (const a of admins.filter((m) => m.role === 'owner' || m.role === 'admin')) {
      await notify(tx, {
        userId: a.userId,
        householdId: inv.householdId,
        type: 'member_joined',
        title: `${user.name} joined ${inv.householdName}`,
        body: `They joined as ${ROLE_LABELS[inv.role as Role]}. You can adjust their access in Household settings.`,
        link: '/household',
      });
    }
  });
  res.json({ householdId: inv.householdId });
});

// ---------- household-scoped (membership resolved by the parent router via loadHousehold) ----------
householdRouter.get('/', async (req, res) => {
  const h = currentHousehold(req);
  res.json({ household: h, members: await listMembers(h.id) });
});

householdRouter.patch('/', forbidDemo, requireCap('household.update'), async (req, res) => {
  const h = currentHousehold(req);
  const input = parse(updateHouseholdSchema, req.body);
  await db()
    .update(households)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(households.id, h.id));
  await logActivity(db(), {
    householdId: h.id,
    actorId: currentUser(req).id,
    entityType: 'household',
    entityId: h.id,
    action: 'updated',
    summary: input.name && input.name !== h.name ? `renamed the household to “${input.name}”` : 'updated household settings',
  });
  res.json({ household: { ...h, ...input } });
});

householdRouter.post('/onboarded', requireCap('household.update'), async (req, res) => {
  const h = currentHousehold(req);
  await db().update(households).set({ onboardedAt: new Date() }).where(eq(households.id, h.id));
  res.status(204).end();
});

householdRouter.delete('/', forbidDemo, requireCap('household.delete'), async (req, res) => {
  const h = currentHousehold(req);
  const confirm = parse(z.object({ confirmName: z.string() }), req.body);
  if (confirm.confirmName.trim() !== h.name) throw badRequest('Type the household name exactly to confirm deletion');
  // Accounts restrict user deletion, so remove them explicitly before the cascading household delete.
  await db().transaction(async (tx) => {
    await tx.delete(accounts).where(eq(accounts.householdId, h.id));
    await tx.delete(households).where(eq(households.id, h.id));
  });
  res.status(204).end();
});

householdRouter.get('/members', async (req, res) => {
  res.json({ members: await listMembers(currentHousehold(req).id) });
});

householdRouter.patch('/members/:userId', forbidDemo, requireCap('members.manage'), async (req, res) => {
  const h = currentHousehold(req);
  const actor = currentUser(req);
  const targetId = idParam(req, 'userId', 'Member');
  const input = parse(updateMemberSchema, req.body);
  const targetRole = await getMemberRole(db(), h.id, targetId);
  if (!targetRole) throw notFound('Member');
  if (targetId === actor.id) throw forbidden('You cannot change your own role');
  if (!canManageMember(h.role, targetRole)) throw forbidden('You cannot change this member’s access');
  if (input.role && !canAssignRole(h.role, input.role)) throw forbidden(`You cannot assign the ${input.role} role`);

  await db().transaction(async (tx) => {
    const newRole = input.role ?? targetRole;
    if (input.role && input.role !== targetRole) {
      await tx
        .update(householdMembers)
        .set({ role: input.role })
        .where(and(eq(householdMembers.householdId, h.id), eq(householdMembers.userId, targetId)));
    }
    if (newRole !== 'contributor') {
      await setCategoryScope(tx, h.id, targetId, []);
    } else if (input.categoryScope) {
      try {
        await setCategoryScope(tx, h.id, targetId, input.categoryScope);
      } catch {
        throw badRequest('One or more categories do not belong to this household');
      }
    }
    const [target] = await tx.select({ name: users.name }).from(users).where(eq(users.id, targetId));
    await logActivity(tx, {
      householdId: h.id,
      actorId: actor.id,
      entityType: 'member',
      entityId: targetId,
      action: 'access_changed',
      summary:
        input.role && input.role !== targetRole
          ? `changed ${target?.name ?? 'a member'}’s role from ${ROLE_LABELS[targetRole]} to ${ROLE_LABELS[input.role]}`
          : `updated ${target?.name ?? 'a member'}’s category access`,
    });
    await notify(tx, {
      userId: targetId,
      householdId: h.id,
      type: 'role_changed',
      title: `Your access in ${h.name} changed`,
      body:
        input.role && input.role !== targetRole
          ? `${actor.name} changed your role to ${ROLE_LABELS[input.role]}.`
          : `${actor.name} updated which categories you can edit.`,
      link: '/household',
    });
  });
  res.json({ members: await listMembers(h.id) });
});

/** Remove a member, or leave the household when targeting yourself. */
householdRouter.delete('/members/:userId', forbidDemo, async (req, res) => {
  const h = currentHousehold(req);
  const actor = currentUser(req);
  const targetId = idParam(req, 'userId', 'Member');
  const targetRole = await getMemberRole(db(), h.id, targetId);
  if (!targetRole) throw notFound('Member');
  const leaving = targetId === actor.id;
  if (leaving && targetRole === 'owner') {
    throw forbidden('Transfer ownership to another member before leaving, or delete the household.');
  }
  if (!leaving && !canManageMember(h.role, targetRole)) throw forbidden('You cannot remove this member');

  const [owner] = await db()
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, h.id), eq(householdMembers.role, 'owner')));
  await db().transaction(async (tx) => {
    // Personal (private) accounts leave with the person; shared accounts stay with the household.
    await tx
      .delete(accounts)
      .where(and(eq(accounts.householdId, h.id), eq(accounts.ownerUserId, targetId), eq(accounts.visibility, 'private')));
    await tx
      .update(accounts)
      .set({ ownerUserId: owner.userId })
      .where(and(eq(accounts.householdId, h.id), eq(accounts.ownerUserId, targetId)));
    await tx
      .delete(householdMembers)
      .where(and(eq(householdMembers.householdId, h.id), eq(householdMembers.userId, targetId)));
    const [target] = await tx.select({ name: users.name }).from(users).where(eq(users.id, targetId));
    await logActivity(tx, {
      householdId: h.id,
      actorId: actor.id,
      entityType: 'member',
      entityId: targetId,
      action: leaving ? 'left' : 'removed',
      summary: leaving ? 'left the household' : `removed ${target?.name ?? 'a member'} from the household`,
    });
  });
  res.status(204).end();
});

householdRouter.post('/transfer-ownership', forbidDemo, requireCap('household.transferOwnership'), async (req, res) => {
  const h = currentHousehold(req);
  const actor = currentUser(req);
  const { userId } = parse(transferOwnershipSchema, req.body);
  if (userId === actor.id) throw badRequest('You already own this household');
  const targetRole = await getMemberRole(db(), h.id, userId);
  if (!targetRole) throw notFound('Member');
  await db().transaction(async (tx) => {
    await tx
      .update(householdMembers)
      .set({ role: 'admin' })
      .where(and(eq(householdMembers.householdId, h.id), eq(householdMembers.userId, actor.id)));
    await tx
      .update(householdMembers)
      .set({ role: 'owner' })
      .where(and(eq(householdMembers.householdId, h.id), eq(householdMembers.userId, userId)));
    await setCategoryScope(tx, h.id, userId, []);
    const [target] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
    await logActivity(tx, {
      householdId: h.id,
      actorId: actor.id,
      entityType: 'member',
      entityId: userId,
      action: 'ownership_transferred',
      summary: `transferred ownership to ${target?.name ?? 'another member'}`,
    });
    await notify(tx, {
      userId,
      householdId: h.id,
      type: 'role_changed',
      title: `You now own ${h.name}`,
      body: `${actor.name} transferred household ownership to you.`,
      link: '/household',
    });
  });
  res.json({ members: await listMembers(h.id) });
});

// ---------- invitations management ----------
householdRouter.get('/invitations', requireCap('members.manage'), async (req, res) => {
  const h = currentHousehold(req);
  const rows = await db()
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      categoryScope: invitations.categoryScope,
      expiresAt: invitations.expiresAt,
      createdBy: users.name,
    })
    .from(invitations)
    .leftJoin(users, eq(users.id, invitations.createdBy))
    .where(
      and(
        eq(invitations.householdId, h.id),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(invitations.createdAt));
  const out: InviteDTO[] = rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    categoryScope: r.categoryScope,
    expiresAt: r.expiresAt.toISOString(),
    createdBy: r.createdBy ?? 'Former member',
  }));
  res.json({ invitations: out });
});

householdRouter.post('/invitations', forbidDemo, requireCap('members.manage'), async (req, res) => {
  const h = currentHousehold(req);
  const actor = currentUser(req);
  const input = parse(inviteSchema, req.body);
  if (!canAssignRole(h.role, input.role)) throw forbidden(`You cannot invite someone as ${input.role}`);
  const token = newToken();
  const id = newId();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await db()
    .insert(invitations)
    .values({
      id,
      householdId: h.id,
      email: input.email ?? null,
      role: input.role,
      categoryScope: input.role === 'contributor' ? (input.categoryScope ?? []) : [],
      tokenHash: hashToken(token),
      createdBy: actor.id,
      expiresAt,
    });
  const url = `${deps().config.appOrigin}/invite/${token}`;
  if (input.email) {
    await deps().email.send({
      to: input.email,
      subject: `${actor.name} invited you to ${h.name} on FamilyPulse`,
      text: `${actor.name} invited you to join the household “${h.name}” on FamilyPulse as ${ROLE_LABELS[input.role]}.\n\nAccept the invitation (valid for 7 days):\n${url}\n`,
    });
  }
  await logActivity(db(), {
    householdId: h.id,
    actorId: actor.id,
    entityType: 'member',
    action: 'invited',
    summary: `created an invitation for a new ${ROLE_LABELS[input.role]}`,
  });
  const dto: InviteDTO = {
    id,
    email: input.email ?? null,
    role: input.role,
    categoryScope: input.categoryScope ?? [],
    expiresAt: expiresAt.toISOString(),
    createdBy: actor.name,
    url,
  };
  res.status(201).json({ invitation: dto });
});

householdRouter.delete('/invitations/:inviteId', requireCap('members.manage'), async (req, res) => {
  const h = currentHousehold(req);
  const inviteId = idParam(req, 'inviteId', 'Invitation');
  const rows = await db()
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.id, inviteId), eq(invitations.householdId, h.id), isNull(invitations.acceptedAt)))
    .returning({ id: invitations.id });
  if (!rows.length) throw notFound('Invitation');
  res.status(204).end();
});
