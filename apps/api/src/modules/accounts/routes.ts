import { Router } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  balanceUpdateSchema,
  can,
  createAccountSchema,
  LIABILITY_TYPES,
  SCOPES,
  updateAccountSchema,
  formatCents,
} from '@familypulse/shared';
import { accounts, transactions } from '../../db/schema';
import { db } from '../../lib/deps';
import { newId } from '../../lib/crypto';
import { badRequest, forbidden, parse } from '../../lib/errors';
import { currentHousehold, householdToday, currentUser, idParam, type HouseholdCtx, type AuthUser } from '../../lib/http';
import { logActivity } from '../../lib/activity';
import { accountBalance, getVisibleAccount, listAccounts, toAccountDTO } from './service';
import { recordRevision } from '../transactions/service';

export const accountsRouter = Router({ mergeParams: true });

/** Shared accounts need accounts.manage; private accounts may only be managed by their owner. */
function assertCanManage(h: HouseholdCtx, user: AuthUser, account: { visibility: string; ownerUserId: string }) {
  if (account.visibility === 'private') {
    if (account.ownerUserId !== user.id) throw forbidden('Only the owner can manage a private account');
    if (h.role === 'viewer') throw forbidden('Viewers cannot manage accounts');
    return;
  }
  if (!can(h.role, 'accounts.manage')) throw forbidden(`Your role (${h.role}) cannot manage shared accounts`);
}

accountsRouter.get('/', async (req, res) => {
  const h = currentHousehold(req);
  const q = parse(z.object({ scope: z.enum(SCOPES).optional(), includeArchived: z.enum(['true', 'false']).optional() }), req.query);
  const list = await listAccounts(db(), h.id, currentUser(req).id, { scope: q.scope, includeArchived: q.includeArchived === 'true' });
  res.json({ accounts: list });
});

accountsRouter.post('/', async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const input = parse(createAccountSchema, req.body);
  assertCanManage(h, user, { visibility: input.visibility, ownerUserId: user.id });
  if (input.openingDate > householdToday(h)) throw badRequest('Opening date cannot be in the future', { openingDate: ['Cannot be in the future'] });
  const isLiability = LIABILITY_TYPES.includes(input.type);
  if (isLiability && input.openingBalanceCents > 0) {
    throw badRequest('Enter what you owe as a negative balance, e.g. -500.00', {
      openingBalanceCents: ['Debts are entered as a negative balance'],
    });
  }
  if (input.creditLimitCents != null && input.type !== 'credit_card') {
    throw badRequest('Only credit cards have a credit limit', { creditLimitCents: ['Only for credit cards'] });
  }
  const id = newId();
  const [row] = await db()
    .insert(accounts)
    .values({
      id,
      householdId: h.id,
      ownerUserId: user.id,
      name: input.name,
      type: input.type,
      visibility: input.visibility,
      institution: input.institution ?? null,
      last4: input.last4 ?? null,
      openingBalanceCents: input.openingBalanceCents,
      openingDate: input.openingDate,
      creditLimitCents: input.creditLimitCents ?? null,
    })
    .returning();
  await logActivity(db(), {
    householdId: h.id,
    actorId: user.id,
    entityType: 'account',
    entityId: id,
    action: 'created',
    summary: input.visibility === 'private' ? 'added a private account' : `added the account “${input.name}”`,
    visibleToUserId: input.visibility === 'private' ? user.id : null,
  });
  res.status(201).json({ account: toAccountDTO(row, user.name, input.openingBalanceCents) });
});

accountsRouter.patch('/:accountId', async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const account = await getVisibleAccount(db(), h.id, user.id, idParam(req, 'accountId', 'Account'));
  assertCanManage(h, user, account);
  const input = parse(updateAccountSchema, req.body);
  if (input.creditLimitCents != null && account.type !== 'credit_card') throw badRequest('Only credit cards have a credit limit');
  const { archived, ...rest } = input;
  const [row] = await db()
    .update(accounts)
    .set({
      ...rest,
      ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }),
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, account.id))
    .returning();
  await logActivity(db(), {
    householdId: h.id,
    actorId: user.id,
    entityType: 'account',
    entityId: account.id,
    action: archived ? 'archived' : 'updated',
    summary: archived ? `archived the account “${row.name}”` : `updated the account “${row.name}”`,
    visibleToUserId: account.visibility === 'private' ? user.id : null,
  });
  res.json({ account: toAccountDTO(row, user.name, await accountBalance(db(), account.id)) });
});

/**
 * Record a new balance (e.g. an investment statement). The difference is posted as an
 * "adjustment" ledger entry so history stays auditable instead of silently overwriting numbers.
 */
accountsRouter.post('/:accountId/balance', async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const account = await getVisibleAccount(db(), h.id, user.id, idParam(req, 'accountId', 'Account'));
  assertCanManage(h, user, account);
  const input = parse(balanceUpdateSchema, req.body);
  if (input.date < account.openingDate) throw badRequest('Date is before the account was opened');
  if (input.date > householdToday(h)) throw badRequest('Date cannot be in the future');
  const current = await accountBalance(db(), account.id);
  const diff = input.balanceCents - current;
  if (diff === 0) {
    res.json({ adjusted: false, balanceCents: current });
    return;
  }
  await db().transaction(async (tx) => {
    const id = newId();
    const snapshot = {
      type: 'adjustment',
      accountId: account.id,
      amountCents: diff,
      date: input.date,
      description: input.note || 'Balance update',
      merchant: null,
      categoryId: null,
      notes: null,
      tags: [],
    };
    await tx.insert(transactions).values({
      id,
      householdId: h.id,
      accountId: account.id,
      type: 'adjustment',
      amountCents: diff,
      date: input.date,
      description: snapshot.description,
      source: 'adjustment',
      createdBy: user.id,
      updatedBy: user.id,
    });
    await recordRevision(tx, id, 1, 'created', snapshot, [], user.id);
    await logActivity(tx, {
      householdId: h.id,
      actorId: user.id,
      entityType: 'account',
      entityId: account.id,
      action: 'balance_updated',
      summary: `updated the balance of “${account.name}” (${formatCents(diff, h.currency, { signed: true })})`,
      visibleToUserId: account.visibility === 'private' ? user.id : null,
    });
  });
  res.json({ adjusted: true, balanceCents: input.balanceCents });
});

accountsRouter.delete('/:accountId', async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const account = await getVisibleAccount(db(), h.id, user.id, idParam(req, 'accountId', 'Account'));
  assertCanManage(h, user, account);
  const [{ count }] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.accountId, account.id)));
  const confirm = req.body?.confirm === true;
  if (count > 0 && !confirm) {
    throw badRequest(`This account has ${count} ledger entries. Archive it instead, or confirm permanent deletion.`);
  }
  await db().delete(accounts).where(eq(accounts.id, account.id));
  await logActivity(db(), {
    householdId: h.id,
    actorId: user.id,
    entityType: 'account',
    entityId: null,
    action: 'deleted',
    summary: `deleted the account “${account.name}” and its ${count} entries`,
    visibleToUserId: account.visibility === 'private' ? user.id : null,
  });
  res.status(204).end();
});
