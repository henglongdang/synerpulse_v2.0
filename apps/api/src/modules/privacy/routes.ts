/**
 * Data-subject controls: full data export (JSON) and account deletion.
 * The export contains only what the user can already see in the app.
 */
import { Router } from 'express';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { deleteAccountSchema } from '@familypulse/shared';
import {
  accounts,
  activityEvents,
  budgetItems,
  budgetPlans,
  categories,
  goalContributions,
  goals,
  householdMembers,
  households,
  notifications,
  recurringItems,
  rules,
  scenarios,
  transactionComments,
  transactions,
  transactionTags,
  users,
} from '../../db/schema';
import { db } from '../../lib/deps';
import { verifyPassword } from '../../lib/crypto';
import { AppError, conflict, parse } from '../../lib/errors';
import { currentUser, requireAuth } from '../../lib/http';
import { clearSessionCookie } from '../auth/session';
import { accountVisibility } from '../accounts/service';

export const privacyRouter = Router();
privacyRouter.use(requireAuth);

privacyRouter.get('/export', async (req, res) => {
  const user = currentUser(req);
  const [profile] = await db()
    .select({ id: users.id, name: users.name, email: users.email, createdAt: users.createdAt, notificationPrefs: users.notificationPrefs })
    .from(users)
    .where(eq(users.id, user.id));
  const memberships = await db()
    .select({ householdId: householdMembers.householdId, role: householdMembers.role, joinedAt: householdMembers.joinedAt, name: households.name, currency: households.currency })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(eq(householdMembers.userId, user.id));

  const householdsOut = [];
  for (const m of memberships) {
    const accts = await db().select().from(accounts).where(accountVisibility(m.householdId, user.id));
    const accountIds = accts.map((a) => a.id);
    const txns = accountIds.length
      ? await db()
          .select()
          .from(transactions)
          .where(and(inArray(transactions.accountId, accountIds), isNull(transactions.deletedAt)))
          .orderBy(asc(transactions.date))
      : [];
    const tags = txns.length
      ? await db()
          .select()
          .from(transactionTags)
          .where(inArray(transactionTags.transactionId, txns.map((t) => t.id)))
      : [];
    const plans = await db().select().from(budgetPlans).where(eq(budgetPlans.householdId, m.householdId));
    householdsOut.push({
      household: { id: m.householdId, name: m.name, currency: m.currency, yourRole: m.role, joinedAt: m.joinedAt },
      categories: await db().select().from(categories).where(eq(categories.householdId, m.householdId)),
      accounts: accts,
      transactions: txns.map((t) => ({ ...t, tags: tags.filter((x) => x.transactionId === t.id).map((x) => x.tag) })),
      budgets: plans.length
        ? {
            plans,
            items: await db()
              .select()
              .from(budgetItems)
              .where(inArray(budgetItems.planId, plans.map((p) => p.id))),
          }
        : { plans: [], items: [] },
      goals: await db().select().from(goals).where(eq(goals.householdId, m.householdId)),
      goalContributions: await db().select().from(goalContributions).where(eq(goalContributions.householdId, m.householdId)),
      recurring: (await db().select().from(recurringItems).where(eq(recurringItems.householdId, m.householdId))).filter(
        (r) => !r.accountId || accountIds.includes(r.accountId),
      ),
      rules: await db().select().from(rules).where(eq(rules.householdId, m.householdId)),
      scenarios: await db().select().from(scenarios).where(eq(scenarios.householdId, m.householdId)),
      yourComments: await db()
        .select()
        .from(transactionComments)
        .where(and(eq(transactionComments.householdId, m.householdId), eq(transactionComments.authorId, user.id))),
      yourActivity: await db()
        .select()
        .from(activityEvents)
        .where(and(eq(activityEvents.householdId, m.householdId), eq(activityEvents.actorId, user.id))),
    });
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    format: 'familypulse-export/v1',
    note: 'Monetary values are integer cents. Signed amounts: negative = money out of the account.',
    profile,
    notifications: await db().select().from(notifications).where(eq(notifications.userId, user.id)),
    households: householdsOut,
  };
  res.setHeader('Content-Disposition', `attachment; filename="familypulse-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.setHeader('Cache-Control', 'no-store');
  res.json(payload);
});

/**
 * Permanently delete the account. Households the user owns alone are deleted; owning a household
 * that has other members requires transferring ownership first. In shared households, the user's
 * private accounts are deleted and their shared accounts are handed to the household owner.
 */
privacyRouter.delete('/', async (req, res) => {
  const user = currentUser(req);
  const input = parse(deleteAccountSchema, req.body);
  const [row] = await db().select().from(users).where(eq(users.id, user.id));
  if (!row || !(await verifyPassword(row.passwordHash, input.password))) {
    throw new AppError(400, 'invalid_credentials', 'Password is incorrect', { password: ['Password is incorrect'] });
  }
  const memberships = await db().select().from(householdMembers).where(eq(householdMembers.userId, user.id));
  for (const m of memberships.filter((x) => x.role === 'owner')) {
    const others = await db()
      .select({ userId: householdMembers.userId })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, m.householdId), ne(householdMembers.userId, user.id)));
    if (others.length) {
      const [hh] = await db().select({ name: households.name }).from(households).where(eq(households.id, m.householdId));
      throw conflict(`You own “${hh?.name}”, which has other members. Transfer ownership before deleting your account.`);
    }
  }
  await db().transaction(async (tx) => {
    for (const m of memberships) {
      if (m.role === 'owner') {
        await tx.delete(accounts).where(eq(accounts.householdId, m.householdId));
        await tx.delete(households).where(eq(households.id, m.householdId));
        continue;
      }
      const [owner] = await tx
        .select({ userId: householdMembers.userId })
        .from(householdMembers)
        .where(and(eq(householdMembers.householdId, m.householdId), eq(householdMembers.role, 'owner')));
      await tx
        .delete(accounts)
        .where(and(eq(accounts.householdId, m.householdId), eq(accounts.ownerUserId, user.id), eq(accounts.visibility, 'private')));
      if (owner) {
        await tx
          .update(accounts)
          .set({ ownerUserId: owner.userId })
          .where(and(eq(accounts.householdId, m.householdId), eq(accounts.ownerUserId, user.id)));
      }
    }
    await tx.delete(users).where(eq(users.id, user.id));
  });
  clearSessionCookie(res);
  res.status(204).end();
});
