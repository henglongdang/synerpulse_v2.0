import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  can,
  categoryAllowed,
  formatCents,
  todayISO,
  addDays,
  type CategoryGroup,
  type Scope,
  type TransactionDTO,
  type TransactionSource,
  type TransactionType,
} from '@familypulse/shared';
import type { Executor } from '../../db/client';
import {
  accounts,
  categories,
  goalContributions,
  goals,
  rules,
  transactionRevisions,
  transactions,
  transactionTags,
  users,
  type TransactionSnapshot,
} from '../../db/schema';
import { newId } from '../../lib/crypto';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import type { AuthUser, HouseholdCtx } from '../../lib/http';
import { logActivity } from '../../lib/activity';
import { accountVisibility, getVisibleAccount } from '../accounts/service';
import { applyRules, type RuleLike } from '../rules/engine';

const creator = alias(users, 'creator');
const updater = alias(users, 'updater');

const tagsExpr = sql<string[]>`coalesce((select array_agg(tt.tag order by tt.tag) from transaction_tags tt where tt.transaction_id = "transactions"."id"), '{}')`;
const commentCountExpr = sql<number>`(select count(*)::int from transaction_comments c where c.transaction_id = "transactions"."id")`;
const attachmentCountExpr = sql<number>`(select count(*)::int from attachments a where a.transaction_id = "transactions"."id")`;

const selection = {
  t: transactions,
  accountName: accounts.name,
  accountVisibility: accounts.visibility,
  accountOwner: accounts.ownerUserId,
  categoryName: categories.name,
  categoryGroup: categories.group,
  creatorId: creator.id,
  creatorName: creator.name,
  updaterId: updater.id,
  updaterName: updater.name,
  tags: tagsExpr,
  commentCount: commentCountExpr,
  attachmentCount: attachmentCountExpr,
};

type Row = {
  t: typeof transactions.$inferSelect;
  accountName: string;
  accountVisibility: 'shared' | 'private';
  accountOwner: string;
  categoryName: string | null;
  categoryGroup: string | null;
  creatorId: string | null;
  creatorName: string | null;
  updaterId: string | null;
  updaterName: string | null;
  tags: string[];
  commentCount: number;
  attachmentCount: number;
};

function baseQuery(exec: Executor) {
  return exec
    .select(selection)
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(creator, eq(creator.id, transactions.createdBy))
    .leftJoin(updater, eq(updater.id, transactions.updatedBy));
}

export function canEditTxn(
  h: HouseholdCtx,
  user: AuthUser,
  t: { type: string; categoryId: string | null; accountVisibility: string; accountOwner: string; createdBy: string | null },
): boolean {
  if (t.accountVisibility === 'private') return t.accountOwner === user.id && h.role !== 'viewer';
  const own = t.createdBy === user.id;
  if (!can(h.role, own ? 'transactions.editOwn' : 'transactions.editAny')) return false;
  // Uncategorised structural entries (transfers, adjustments) are off-limits to category-scoped contributors.
  if (t.type === 'transfer' || t.type === 'adjustment') return categoryAllowed(h.role, h.categoryScope, null);
  return categoryAllowed(h.role, h.categoryScope, t.categoryId);
}

export function toTransactionDTO(r: Row, h: HouseholdCtx, user: AuthUser): TransactionDTO {
  const t = r.t;
  return {
    id: t.id,
    accountId: t.accountId,
    accountName: r.accountName,
    accountVisibility: r.accountVisibility,
    type: t.type as TransactionType,
    amountCents: Number(t.amountCents),
    date: t.date,
    description: t.description,
    merchant: t.merchant,
    categoryId: t.categoryId,
    categoryName: r.categoryName,
    categoryGroup: (r.categoryGroup as CategoryGroup) ?? null,
    notes: t.notes,
    tags: r.tags ?? [],
    transferGroupId: t.transferGroupId,
    source: t.source as TransactionSource,
    version: t.version,
    createdBy: r.creatorId ? { id: r.creatorId, name: r.creatorName! } : null,
    updatedBy: r.updaterId ? { id: r.updaterId, name: r.updaterName! } : null,
    commentCount: r.commentCount,
    attachmentCount: r.attachmentCount,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    canEdit: canEditTxn(h, user, {
      type: t.type,
      categoryId: t.categoryId,
      accountVisibility: r.accountVisibility,
      accountOwner: r.accountOwner,
      createdBy: t.createdBy,
    }),
  };
}

/** Load one transaction the caller can see (including soft-deleted when asked), or 404. */
export async function getVisibleTransaction(
  exec: Executor,
  h: HouseholdCtx,
  user: AuthUser,
  id: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<Row> {
  const where = [eq(transactions.id, id), eq(transactions.householdId, h.id), accountVisibility(h.id, user.id)];
  if (!opts.includeDeleted) where.push(isNull(transactions.deletedAt));
  const [row] = await baseQuery(exec).where(and(...where)).limit(1);
  if (!row) throw notFound('Transaction');
  return row as Row;
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export interface ListFilters {
  page: number;
  pageSize: number;
  q?: string;
  accountId?: string;
  categoryId?: string;
  type?: string;
  from?: string;
  to?: string;
  tag?: string;
  memberId?: string;
  scope: Scope;
  sort: 'date' | 'amount' | 'created';
  dir: 'asc' | 'desc';
}

export async function listTransactions(exec: Executor, h: HouseholdCtx, user: AuthUser, f: ListFilters) {
  const where: SQL[] = [eq(transactions.householdId, h.id), isNull(transactions.deletedAt), accountVisibility(h.id, user.id, f.scope)];
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    where.push(or(ilike(transactions.description, like), ilike(transactions.merchant, like), ilike(transactions.notes, like))!);
  }
  if (f.accountId) where.push(eq(transactions.accountId, f.accountId));
  if (f.categoryId === 'uncategorized') where.push(and(isNull(transactions.categoryId), inArray(transactions.type, ['expense', 'income']))!);
  else if (f.categoryId) where.push(eq(transactions.categoryId, f.categoryId));
  if (f.type) where.push(eq(transactions.type, f.type as TransactionType));
  if (f.from) where.push(sql`${transactions.date} >= ${f.from}`);
  if (f.to) where.push(sql`${transactions.date} <= ${f.to}`);
  if (f.memberId) where.push(eq(transactions.createdBy, f.memberId));
  if (f.tag) where.push(sql`exists (select 1 from transaction_tags tt where tt.transaction_id = "transactions"."id" and tt.tag = ${f.tag})`);
  const cond = and(...where);

  const sortCol = f.sort === 'amount' ? sql`abs(${transactions.amountCents})` : f.sort === 'created' ? transactions.createdAt : transactions.date;
  const order = f.dir === 'asc' ? [asc(sortCol), asc(transactions.createdAt)] : [desc(sortCol), desc(transactions.createdAt)];

  const [rows, [{ total }]] = await Promise.all([
    baseQuery(exec)
      .where(cond)
      .orderBy(...order)
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    exec
      .select({ total: sql<number>`count(*)::int` })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(cond),
  ]);
  return { items: (rows as Row[]).map((r) => toTransactionDTO(r, h, user)), page: f.page, pageSize: f.pageSize, total };
}

export async function recordRevision(
  exec: Executor,
  transactionId: string,
  version: number,
  action: 'created' | 'updated' | 'reverted' | 'deleted' | 'restored',
  snapshot: TransactionSnapshot,
  changes: { field: string; from: unknown; to: unknown }[],
  editorId: string | null,
) {
  await exec.insert(transactionRevisions).values({ id: newId(), transactionId, version, action, snapshot, changes, editorId });
}

function snapshotOf(t: typeof transactions.$inferSelect, tags: string[]): TransactionSnapshot {
  return {
    type: t.type,
    accountId: t.accountId,
    amountCents: Number(t.amountCents),
    date: t.date,
    description: t.description,
    merchant: t.merchant,
    categoryId: t.categoryId,
    notes: t.notes,
    tags: [...tags].sort(),
  };
}

async function validateCategory(exec: Executor, h: HouseholdCtx, categoryId: string | null | undefined, type: 'expense' | 'income') {
  if (!categoryId) return;
  const [cat] = await exec
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.householdId, h.id)));
  if (!cat) throw badRequest('That category does not exist in this household', { categoryId: ['Unknown category'] });
  if (cat.archivedAt) throw badRequest('That category is archived', { categoryId: ['Category is archived'] });
  const isIncomeCat = cat.group === 'income';
  if (isIncomeCat !== (type === 'income')) {
    throw badRequest(
      type === 'income' ? 'Income must use an income category' : 'Spending must use a spending category (not an income one)',
      { categoryId: ['Category does not match the entry type'] },
    );
  }
}

function assertScope(h: HouseholdCtx, categoryId: string | null) {
  if (!categoryAllowed(h.role, h.categoryScope, categoryId)) {
    throw forbidden('Your access is limited to specific categories. Choose one of your permitted categories.');
  }
}

async function loadRules(exec: Executor, householdId: string): Promise<RuleLike[]> {
  const rows = await exec
    .select()
    .from(rules)
    .where(and(eq(rules.householdId, householdId), eq(rules.enabled, true)))
    .orderBy(asc(rules.priority), asc(rules.createdAt));
  return rows.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled, conditions: r.conditions as RuleLike['conditions'], actions: r.actions as RuleLike['actions'] }));
}

async function writeTags(exec: Executor, transactionId: string, tags: string[]) {
  await exec.delete(transactionTags).where(eq(transactionTags.transactionId, transactionId));
  const unique = [...new Set(tags)];
  if (unique.length) await exec.insert(transactionTags).values(unique.map((tag) => ({ transactionId, tag })));
}

export interface CreateTxnInput {
  accountId: string;
  type: 'expense' | 'income';
  amountCents: number;
  date: string;
  description: string;
  merchant?: string | null;
  categoryId?: string | null;
  notes?: string | null;
  tags: string[];
  clientRequestId?: string;
}

/**
 * Create a ledger entry. Enforces account visibility, category/type consistency and
 * contributor category scopes; applies automation rules; writes revision v1 and an activity event.
 * Idempotent on clientRequestId: a retried request returns the original entry.
 */
export async function createTransaction(
  exec: Executor,
  h: HouseholdCtx,
  user: AuthUser,
  input: CreateTxnInput,
  opts: { source?: TransactionSource; recurringId?: string | null; importHash?: string | null; skipActivity?: boolean } = {},
): Promise<{ id: string; created: boolean; appliedRules: string[] }> {
  if (input.clientRequestId) {
    const [existing] = await exec
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.householdId, h.id), eq(transactions.clientRequestId, input.clientRequestId)));
    if (existing) return { id: existing.id, created: false, appliedRules: [] };
  }
  const account = await getVisibleAccount(exec, h.id, user.id, input.accountId);
  if (account.visibility === 'private' && account.ownerUserId !== user.id) throw notFound('Account');
  if (account.archivedAt) throw badRequest('That account is archived', { accountId: ['Account is archived'] });
  if (input.date < account.openingDate) {
    throw badRequest(`Date is before this account was opened (${account.openingDate})`, { date: ['Before account opening date'] });
  }
  if (input.date > addDays(todayISO(), 366)) throw badRequest('Date is too far in the future', { date: ['Too far in the future'] });

  await validateCategory(exec, h, input.categoryId, input.type);

  const ruleOutcome = applyRules(await loadRules(exec, h.id), {
    type: input.type,
    description: input.description,
    merchant: input.merchant ?? null,
    tags: input.tags,
    categoryId: input.categoryId ?? null,
    accountId: input.accountId,
    amountCents: input.amountCents,
  }, { categoryExplicit: Boolean(input.categoryId) });

  let categoryId = ruleOutcome.categoryId;
  if (categoryId !== (input.categoryId ?? null)) {
    // A rule pointing at an archived/mismatched category is ignored rather than failing the entry.
    const ok = await validateCategory(exec, h, categoryId, input.type).then(
      () => true,
      () => false,
    );
    if (!ok) categoryId = input.categoryId ?? null;
  }
  if (account.visibility === 'shared') assertScope(h, categoryId);
  // Goal allocations are household-visible, so they never fire from private accounts.
  if (account.visibility === 'private') ruleOutcome.allocations = [];

  const id = newId();
  const signed = input.type === 'expense' ? -input.amountCents : input.amountCents;
  const row = {
    id,
    householdId: h.id,
    accountId: input.accountId,
    type: input.type,
    amountCents: signed,
    date: input.date,
    description: input.description,
    merchant: input.merchant ?? null,
    categoryId,
    notes: input.notes ?? null,
    source: opts.source ?? 'manual',
    recurringId: opts.recurringId ?? null,
    clientRequestId: input.clientRequestId ?? null,
    importHash: opts.importHash ?? null,
    createdBy: user.id,
    updatedBy: user.id,
  } as const;
  const [inserted] = await exec.insert(transactions).values(row).returning();
  await writeTags(exec, id, ruleOutcome.tags);
  await recordRevision(exec, id, 1, 'created', snapshotOf(inserted, ruleOutcome.tags), [], user.id);

  // Rule-driven goal allocations ("reallocate 20% of freelance income to savings").
  for (const alloc of ruleOutcome.allocations) {
    const [goal] = await exec
      .select({ id: goals.id, name: goals.name })
      .from(goals)
      .where(and(eq(goals.id, alloc.goalId), eq(goals.householdId, h.id), isNull(goals.archivedAt)));
    if (!goal) continue;
    await exec.insert(goalContributions).values({
      id: newId(),
      goalId: goal.id,
      householdId: h.id,
      amountCents: alloc.amountCents,
      date: input.date,
      note: `Automatic allocation from “${input.description}”`,
      transactionId: id,
      ruleId: alloc.ruleId,
      createdBy: user.id,
    });
  }
  if (ruleOutcome.appliedRuleIds.length) {
    await exec
      .update(rules)
      .set({ timesApplied: sql`${rules.timesApplied} + 1`, lastAppliedAt: new Date() })
      .where(inArray(rules.id, ruleOutcome.appliedRuleIds));
  }

  if (!opts.skipActivity) {
    await logActivity(exec, {
      householdId: h.id,
      actorId: user.id,
      entityType: 'transaction',
      entityId: id,
      action: 'created',
      summary: `logged ${input.type === 'income' ? 'income' : 'spending'} “${input.description}” (${formatCents(signed, h.currency, { signed: true })})`,
      visibleToUserId: account.visibility === 'private' ? user.id : null,
    });
  }
  return { id, created: true, appliedRules: ruleOutcome.appliedRuleIds };
}

export interface UpdateTxnInput {
  expectedVersion: number;
  type?: 'expense' | 'income';
  accountId?: string;
  amountCents?: number;
  date?: string;
  description?: string;
  merchant?: string | null;
  categoryId?: string | null;
  notes?: string | null;
  tags?: string[];
}

const LABELS: Record<string, string> = {
  type: 'type',
  accountId: 'account',
  amountCents: 'amount',
  date: 'date',
  description: 'description',
  merchant: 'merchant',
  categoryId: 'category',
  notes: 'notes',
  tags: 'tags',
};

/**
 * Update with optimistic concurrency: if someone else saved first, the caller gets 409 together
 * with the current server copy so the UI can show both versions and let the user resolve it.
 */
export async function updateTransaction(
  exec: Executor,
  h: HouseholdCtx,
  user: AuthUser,
  id: string,
  input: UpdateTxnInput,
  action: 'updated' | 'reverted' = 'updated',
): Promise<void> {
  const row = await getVisibleTransaction(exec, h, user, id);
  const t = row.t;
  if (t.version !== input.expectedVersion) {
    throw conflict('Someone else changed this entry while you were editing. Review their version before saving again.', {
      current: toTransactionDTO(row, h, user),
    });
  }
  if (!canEditTxn(h, user, { type: t.type, categoryId: t.categoryId, accountVisibility: row.accountVisibility, accountOwner: row.accountOwner, createdBy: t.createdBy })) {
    throw forbidden('You do not have permission to edit this entry');
  }
  const structural = t.type === 'transfer' || t.type === 'adjustment';
  if (structural && (input.type || input.accountId || input.amountCents !== undefined || input.categoryId !== undefined || input.date)) {
    throw badRequest('Transfers and balance adjustments can only have their description, notes and tags edited. Delete and re-create to change amounts.');
  }

  const before = snapshotOf(t, row.tags);
  const type = (input.type ?? t.type) as 'expense' | 'income';
  const absAmount = input.amountCents ?? Math.abs(Number(t.amountCents));
  const next: TransactionSnapshot = {
    type,
    accountId: input.accountId ?? t.accountId,
    amountCents: structural ? Number(t.amountCents) : type === 'expense' ? -absAmount : absAmount,
    date: input.date ?? t.date,
    description: input.description ?? t.description,
    merchant: input.merchant !== undefined ? input.merchant : t.merchant,
    categoryId: input.categoryId !== undefined ? input.categoryId : t.categoryId,
    notes: input.notes !== undefined ? input.notes : t.notes,
    tags: [...(input.tags ?? row.tags)].sort(),
  };

  if (!structural) {
    if (next.accountId !== t.accountId) {
      const acct = await getVisibleAccount(exec, h.id, user.id, next.accountId);
      if (acct.visibility !== row.accountVisibility) {
        throw badRequest('Entries cannot be moved between shared and private accounts');
      }
      if (acct.archivedAt) throw badRequest('That account is archived');
    }
    if (input.categoryId !== undefined || input.type) await validateCategory(exec, h, next.categoryId, type);
    if (row.accountVisibility === 'shared') assertScope(h, next.categoryId);
  }

  const changes = (Object.keys(LABELS) as (keyof TransactionSnapshot)[])
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k]))
    .map((k) => ({ field: LABELS[k], from: before[k], to: next[k] }));
  if (!changes.length) return;

  const version = t.version + 1;
  const updated = await exec
    .update(transactions)
    .set({
      type: next.type as TransactionType,
      accountId: next.accountId,
      amountCents: next.amountCents,
      date: next.date,
      description: next.description,
      merchant: next.merchant,
      categoryId: next.categoryId,
      notes: next.notes,
      version,
      updatedBy: user.id,
      updatedAt: new Date(),
    })
    // The version predicate makes the check atomic even under concurrent writers.
    .where(and(eq(transactions.id, id), eq(transactions.version, t.version)))
    .returning({ id: transactions.id });
  if (!updated.length) {
    const fresh = await getVisibleTransaction(exec, h, user, id);
    throw conflict('Someone else changed this entry while you were editing.', { current: toTransactionDTO(fresh, h, user) });
  }
  if (input.tags) await writeTags(exec, id, next.tags);
  await recordRevision(exec, id, version, action, next, changes, user.id);
  await logActivity(exec, {
    householdId: h.id,
    actorId: user.id,
    entityType: 'transaction',
    entityId: id,
    action,
    summary:
      action === 'reverted'
        ? `restored an earlier version of “${next.description}”`
        : `edited “${next.description}” (${changes.map((c) => c.field).join(', ')})`,
    visibleToUserId: row.accountVisibility === 'private' ? user.id : null,
  });
}

/** Soft delete (restorable). Transfers delete both legs together. */
export async function deleteTransaction(exec: Executor, h: HouseholdCtx, user: AuthUser, id: string, restore = false): Promise<void> {
  const row = await getVisibleTransaction(exec, h, user, id, { includeDeleted: true });
  const t = row.t;
  if (restore ? !t.deletedAt : t.deletedAt) throw notFound('Transaction');
  if (!canEditTxn(h, user, { type: t.type, categoryId: t.categoryId, accountVisibility: row.accountVisibility, accountOwner: row.accountOwner, createdBy: t.createdBy })) {
    throw forbidden('You do not have permission to change this entry');
  }
  const legs = t.transferGroupId
    ? await exec
        .select()
        .from(transactions)
        .where(and(eq(transactions.transferGroupId, t.transferGroupId), eq(transactions.householdId, h.id)))
    : [t];
  for (const leg of legs) {
    if (leg.id !== t.id) await getVisibleTransaction(exec, h, user, leg.id, { includeDeleted: true }); // must see both legs
    const tags = (await exec.select().from(transactionTags).where(eq(transactionTags.transactionId, leg.id))).map((x) => x.tag);
    const version = leg.version + 1;
    await exec
      .update(transactions)
      .set({ deletedAt: restore ? null : new Date(), version, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(transactions.id, leg.id));
    await recordRevision(exec, leg.id, version, restore ? 'restored' : 'deleted', { ...snapshotOf(leg, tags), deleted: !restore }, [], user.id);
  }
  await logActivity(exec, {
    householdId: h.id,
    actorId: user.id,
    entityType: 'transaction',
    entityId: id,
    action: restore ? 'restored' : 'deleted',
    summary: `${restore ? 'restored' : 'deleted'} “${t.description}” (${formatCents(Number(t.amountCents), h.currency, { signed: true })})`,
    visibleToUserId: row.accountVisibility === 'private' ? user.id : null,
  });
}

export async function createTransfer(
  exec: Executor,
  h: HouseholdCtx,
  user: AuthUser,
  input: { fromAccountId: string; toAccountId: string; amountCents: number; date: string; description: string; clientRequestId?: string },
): Promise<{ id: string; created: boolean }> {
  if (input.clientRequestId) {
    const [existing] = await exec
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.householdId, h.id), eq(transactions.clientRequestId, input.clientRequestId)));
    if (existing) return { id: existing.id, created: false };
  }
  const from = await getVisibleAccount(exec, h.id, user.id, input.fromAccountId);
  const to = await getVisibleAccount(exec, h.id, user.id, input.toAccountId);
  for (const a of [from, to]) {
    if (a.archivedAt) throw badRequest(`“${a.name}” is archived`);
    if (input.date < a.openingDate) throw badRequest(`Date is before “${a.name}” was opened`);
    if (a.visibility === 'private' && a.ownerUserId !== user.id) throw notFound('Account');
  }
  if ((from.visibility === 'shared' || to.visibility === 'shared') && !can(h.role, 'transactions.create')) {
    throw forbidden('Your role cannot record transfers');
  }
  if (h.role === 'contributor' && h.categoryScope.length && (from.visibility === 'shared' || to.visibility === 'shared')) {
    throw forbidden('Your access is limited to specific categories, so you cannot record transfers between shared accounts');
  }
  const group = newId();
  const legs = [
    { id: newId(), accountId: from.id, amountCents: -input.amountCents, clientRequestId: input.clientRequestId ?? null },
    { id: newId(), accountId: to.id, amountCents: input.amountCents, clientRequestId: null },
  ];
  for (const leg of legs) {
    const [ins] = await exec
      .insert(transactions)
      .values({
        id: leg.id,
        householdId: h.id,
        accountId: leg.accountId,
        type: 'transfer',
        amountCents: leg.amountCents,
        date: input.date,
        description: input.description,
        transferGroupId: group,
        source: 'transfer',
        clientRequestId: leg.clientRequestId,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    await recordRevision(exec, leg.id, 1, 'created', snapshotOf(ins, []), [], user.id);
  }
  const anyPrivate = from.visibility === 'private' || to.visibility === 'private';
  await logActivity(exec, {
    householdId: h.id,
    actorId: user.id,
    entityType: 'transaction',
    entityId: legs[0].id,
    action: 'transfer',
    summary: anyPrivate
      ? `recorded a transfer of ${formatCents(input.amountCents, h.currency)}`
      : `moved ${formatCents(input.amountCents, h.currency)} from “${from.name}” to “${to.name}”`,
    visibleToUserId: from.visibility === 'private' && to.visibility === 'private' ? user.id : null,
  });
  return { id: legs[0].id, created: true };
}
