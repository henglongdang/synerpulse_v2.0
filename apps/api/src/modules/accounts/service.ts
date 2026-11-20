import { and, asc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { AccountDTO, AccountType, Scope } from '@synerpulse/shared';
import type { Executor } from '../../db/client';
import { accounts, transactions, users } from '../../db/schema';
import { notFound } from '../../lib/errors';

/**
 * Visibility rule for accounts (and, transitively, their transactions):
 *  - "household" scope → shared accounts only (what every member sees);
 *  - "personal" scope  → the caller's private accounts only;
 *  - undefined         → everything the caller may see (shared + own private).
 * Private accounts are never visible to anyone but their owner — including admins.
 */
export function accountVisibility(householdId: string, userId: string, scope?: Scope): SQL {
  const base = eq(accounts.householdId, householdId);
  if (scope === 'household') return and(base, eq(accounts.visibility, 'shared'))!;
  if (scope === 'personal') return and(base, eq(accounts.visibility, 'private'), eq(accounts.ownerUserId, userId))!;
  return and(base, or(eq(accounts.visibility, 'shared'), eq(accounts.ownerUserId, userId)))!;
}

// Correlated subqueries reference the outer row by explicit table name: Drizzle renders columns
// unqualified in single-table selects, which would silently bind to the inner table instead.
const balanceExpr = sql<number>`("accounts"."opening_balance_cents" + coalesce((
  select sum(t.amount_cents) from transactions t
  where t.account_id = "accounts"."id" and t.deleted_at is null
), 0))::bigint`;

export async function listAccounts(
  exec: Executor,
  householdId: string,
  userId: string,
  opts: { scope?: Scope; includeArchived?: boolean } = {},
): Promise<AccountDTO[]> {
  const where = [accountVisibility(householdId, userId, opts.scope)];
  if (!opts.includeArchived) where.push(isNull(accounts.archivedAt));
  const rows = await exec
    .select({ a: accounts, ownerName: users.name, balance: balanceExpr })
    .from(accounts)
    .innerJoin(users, eq(users.id, accounts.ownerUserId))
    .where(and(...where))
    .orderBy(asc(accounts.type), asc(accounts.name));
  return rows.map(({ a, ownerName, balance }) => toAccountDTO(a, ownerName, Number(balance)));
}

export function toAccountDTO(a: typeof accounts.$inferSelect, ownerName: string, balanceCents: number): AccountDTO {
  return {
    id: a.id,
    name: a.name,
    type: a.type as AccountType,
    visibility: a.visibility,
    ownerUserId: a.ownerUserId,
    ownerName,
    institution: a.institution,
    last4: a.last4,
    openingBalanceCents: a.openingBalanceCents,
    openingDate: a.openingDate,
    balanceCents,
    creditLimitCents: a.creditLimitCents,
    archived: Boolean(a.archivedAt),
    provider: a.provider,
  };
}

/** Load an account the caller may see, or 404 (also for other households' accounts). */
export async function getVisibleAccount(exec: Executor, householdId: string, userId: string, accountId: string) {
  const [row] = await exec
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), accountVisibility(householdId, userId)))
    .limit(1);
  if (!row) throw notFound('Account');
  return row;
}

export async function accountBalance(exec: Executor, accountId: string): Promise<number> {
  const [row] = await exec
    .select({ opening: accounts.openingBalanceCents, sum: sql<number>`coalesce(sum(${transactions.amountCents}), 0)::bigint` })
    .from(accounts)
    .leftJoin(transactions, and(eq(transactions.accountId, accounts.id), isNull(transactions.deletedAt)))
    .where(eq(accounts.id, accountId))
    .groupBy(accounts.id);
  return row ? Number(row.opening) + Number(row.sum) : 0;
}
