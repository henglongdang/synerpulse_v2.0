/**
 * CSV import — the honest, working alternative to live bank aggregation (which needs a provider
 * contract; see services/providers). Stateless two-step flow: /preview parses and flags
 * duplicates/errors without writing; /commit re-parses the same payload and imports valid rows.
 */
import { Router } from 'express';
import Papa from 'papaparse';
import { createHash } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { csvImportSchema, isValidISODate, parseMoneyToCents, type CsvImportRequest, type ImportPreviewRowDTO, type ImportResultDTO } from '@synerpulse/shared';
import { accounts, categories, transactions } from '../../db/schema';
import { db } from '../../lib/deps';
import { badRequest, parse } from '../../lib/errors';
import { currentHousehold, currentUser, requireCap, type AuthUser, type HouseholdCtx } from '../../lib/http';
import { logActivity } from '../../lib/activity';
import { getVisibleAccount } from '../accounts/service';
import { createTransaction } from '../transactions/service';
import { afterLedgerChange } from '../alerts/service';

export const importsRouter = Router({ mergeParams: true });

const MAX_ROWS = 2000;

function parseDate(raw: string, format: CsvImportRequest['dateFormat']): string | null {
  const s = raw.trim();
  let y: string, m: string, d: string;
  if (format === 'YYYY-MM-DD') {
    const r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
    if (!r) return null;
    [y, m, d] = [r[1], r[2], r[3]];
  } else {
    const r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
    if (!r) return null;
    [m, d] = format === 'MM/DD/YYYY' ? [r[1], r[2]] : [r[2], r[1]];
    y = r[3].length === 2 ? `20${r[3]}` : r[3];
  }
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return isValidISODate(iso) ? iso : null;
}

interface ParsedRow extends ImportPreviewRowDTO {
  hash: string | null;
}

async function analyse(h: HouseholdCtx, user: AuthUser, input: CsvImportRequest): Promise<{ rows: ParsedRow[]; account: typeof accounts.$inferSelect }> {
  const account = await getVisibleAccount(db(), h.id, user.id, input.accountId);
  if (account.visibility === 'private' && account.ownerUserId !== user.id) throw badRequest('Unknown account');
  if (account.archivedAt) throw badRequest('That account is archived');
  const parsed = Papa.parse<Record<string, string>>((input.csv.charCodeAt(0) === 0xfeff ? input.csv.slice(1) : input.csv), { header: true, skipEmptyLines: 'greedy', transformHeader: (x) => x.trim() });
  const fields = parsed.meta.fields ?? [];
  for (const col of Object.values(input.mapping).filter(Boolean) as string[]) {
    if (!fields.includes(col)) throw badRequest(`Column “${col}” was not found in the file. Columns found: ${fields.slice(0, 12).join(', ')}`);
  }
  if (parsed.data.length > MAX_ROWS) throw badRequest(`Import at most ${MAX_ROWS} rows at a time (this file has ${parsed.data.length}).`);

  const existing = await db()
    .select({
      hash: transactions.importHash,
      date: transactions.date,
      amount: transactions.amountCents,
      description: sql<string>`lower(${transactions.description})`,
    })
    .from(transactions)
    .where(and(eq(transactions.accountId, account.id), isNull(transactions.deletedAt)));
  const existingHashes = new Set(existing.map((e) => e.hash).filter(Boolean));
  const existingKeys = new Set(existing.map((e) => `${e.date}|${e.amount}|${e.description}`));
  const seen = new Map<string, number>();

  const rows: ParsedRow[] = parsed.data.map((rec, i) => {
    const line = i + 2; // header is line 1
    const description = (rec[input.mapping.description] ?? '').trim().slice(0, 120);
    const date = parseDate(rec[input.mapping.date] ?? '', input.dateFormat);
    let amount: number | null = null;
    let error: string | null = null;
    try {
      if (input.mapping.amount) {
        amount = parseMoneyToCents(rec[input.mapping.amount] ?? '');
      } else {
        const debit = (rec[input.mapping.debit ?? ''] ?? '').trim();
        const credit = (rec[input.mapping.credit ?? ''] ?? '').trim();
        amount = (credit ? Math.abs(parseMoneyToCents(credit)) : 0) - (debit ? Math.abs(parseMoneyToCents(debit)) : 0);
      }
      if (input.invertAmounts && amount !== null) amount = -amount;
    } catch (e) {
      error = (e as Error).message;
    }
    if (!error && !date) error = `Unrecognised date “${rec[input.mapping.date] ?? ''}” (expected ${input.dateFormat})`;
    if (!error && date && date < account.openingDate) error = `Before the account opening date (${account.openingDate})`;
    if (!error && !description) error = 'Missing description';
    if (!error && (amount === null || amount === 0)) error = 'Amount is zero or missing';
    const category = input.mapping.category ? (rec[input.mapping.category] ?? '').trim() || null : null;
    let hash: string | null = null;
    let duplicate = false;
    if (!error && date && amount !== null) {
      const key = `${date}|${amount}|${description.toLowerCase()}`;
      const n = (seen.get(key) ?? 0) + 1; // identical rows within a file are distinct purchases
      seen.set(key, n);
      hash = createHash('sha256').update(`${account.id}|${key}|${n}`).digest('hex');
      duplicate = existingHashes.has(hash) || (n === 1 && existingKeys.has(key));
    }
    return { line, date, description, amountCents: amount, category, duplicate, error, hash };
  });
  return { rows, account };
}

function summary(rows: ParsedRow[]): ImportResultDTO {
  return {
    rows: rows.slice(0, 500).map(({ hash: _hash, ...r }) => r),
    validCount: rows.filter((r) => !r.error && !r.duplicate).length,
    duplicateCount: rows.filter((r) => r.duplicate).length,
    errorCount: rows.filter((r) => r.error).length,
  };
}

importsRouter.post('/preview', requireCap('imports.run'), async (req, res) => {
  const input = parse(csvImportSchema, req.body);
  const { rows } = await analyse(currentHousehold(req), currentUser(req), input);
  res.json(summary(rows));
});

importsRouter.post('/commit', requireCap('imports.run'), async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const input = parse(csvImportSchema, req.body);
  const { rows, account } = await analyse(h, user, input);
  const cats = await db().select().from(categories).where(eq(categories.householdId, h.id));
  let imported = 0;
  await db().transaction(async (tx) => {
    for (const r of rows) {
      if (r.error || (r.duplicate && input.skipDuplicates) || r.date === null || r.amountCents === null) continue;
      const type = r.amountCents < 0 ? 'expense' : 'income';
      const cat = r.category
        ? cats.find((c) => c.name.toLowerCase() === r.category!.toLowerCase() && (c.group === 'income') === (type === 'income') && !c.archivedAt)
        : undefined;
      await createTransaction(
        tx,
        h,
        user,
        { accountId: account.id, type, amountCents: Math.abs(r.amountCents), date: r.date, description: r.description, categoryId: cat?.id ?? null, tags: [] },
        { source: 'import', importHash: r.duplicate ? null : r.hash, skipActivity: true },
      );
      imported++;
    }
    if (imported) {
      await tx.update(accounts).set({ provider: 'csv', updatedAt: new Date() }).where(eq(accounts.id, account.id));
      await logActivity(tx, {
        householdId: h.id,
        actorId: user.id,
        entityType: 'import',
        entityId: account.id,
        action: 'imported',
        summary: `imported ${imported} entries into “${account.name}” from CSV`,
        visibleToUserId: account.visibility === 'private' ? user.id : null,
      });
    }
  });
  if (imported) await afterLedgerChange(h.id);
  res.json({ ...summary(rows), importedCount: imported });
});
