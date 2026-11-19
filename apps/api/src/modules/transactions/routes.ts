import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  centsToDecimalString,
  createCommentSchema,
  createTransactionSchema,
  createTransferSchema,
  listTransactionsQuery,
  revertTransactionSchema,
  updateTransactionSchema,
  type AttachmentDTO,
  type CommentDTO,
  type RevisionDTO,
} from '@familypulse/shared';
import {
  attachments,
  commentMentions,
  householdMembers,
  transactionComments,
  transactionRevisions,
  users,
} from '../../db/schema';
import { db, deps } from '../../lib/deps';
import { newId } from '../../lib/crypto';
import { badRequest, forbidden, notFound, parse } from '../../lib/errors';
import { currentHousehold, currentUser, idParam, requireCap } from '../../lib/http';
import { uploadLimiter } from '../../lib/rateLimit';
import { logActivity } from '../../lib/activity';
import { notify, prefsForUsers } from '../notifications/service';
import { afterLedgerChange } from '../alerts/service';
import {
  canEditTxn,
  createTransaction,
  createTransfer,
  deleteTransaction,
  getVisibleTransaction,
  listTransactions,
  toTransactionDTO,
  updateTransaction,
} from './service';

export const transactionsRouter = Router({ mergeParams: true });

transactionsRouter.get('/', async (req, res) => {
  const h = currentHousehold(req);
  const f = parse(listTransactionsQuery, req.query);
  res.json(await listTransactions(db(), h, currentUser(req), f));
});

/** CSV export of the filtered ledger (all pages). */
transactionsRouter.get('/export.csv', async (req, res) => {
  const h = currentHousehold(req);
  const f = parse(listTransactionsQuery, req.query);
  const rows: string[] = ['date,description,merchant,account,category,type,amount,currency,tags,notes,created_by'];
  const esc = (v: unknown) => {
    let s = v == null ? '' : String(v);
    // Neutralise spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  for (let page = 1; page <= 200; page++) {
    const result = await listTransactions(db(), h, currentUser(req), { ...f, page, pageSize: 100 });
    for (const t of result.items) {
      rows.push(
        [t.date, t.description, t.merchant, t.accountName, t.categoryName, t.type, centsToDecimalString(t.amountCents), h.currency, t.tags.join(' '), t.notes, t.createdBy?.name]
          .map(esc)
          .join(','),
      );
    }
    if (page * 100 >= result.total) break;
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="familypulse-ledger-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(rows.join('\r\n'));
});

transactionsRouter.get('/:txnId', async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const row = await getVisibleTransaction(db(), h, user, idParam(req, 'txnId', 'Transaction'));
  res.json({ transaction: toTransactionDTO(row, h, user) });
});

transactionsRouter.post('/', requireCap('transactions.create'), async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const input = parse(createTransactionSchema, req.body);
  const result = await db().transaction((tx) => createTransaction(tx, h, user, input));
  if (result.created) await afterLedgerChange(h.id);
  const row = await getVisibleTransaction(db(), h, user, result.id);
  res.status(result.created ? 201 : 200).json({ transaction: toTransactionDTO(row, h, user), appliedRules: result.appliedRules });
});

transactionsRouter.post('/transfers', requireCap('transactions.create'), async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const input = parse(createTransferSchema, req.body);
  const result = await db().transaction((tx) => createTransfer(tx, h, user, input));
  const row = await getVisibleTransaction(db(), h, user, result.id);
  res.status(result.created ? 201 : 200).json({ transaction: toTransactionDTO(row, h, user) });
});

transactionsRouter.patch('/:txnId', async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const id = idParam(req, 'txnId', 'Transaction');
  const input = parse(updateTransactionSchema, req.body);
  await db().transaction((tx) => updateTransaction(tx, h, user, id, input));
  await afterLedgerChange(h.id);
  res.json({ transaction: toTransactionDTO(await getVisibleTransaction(db(), h, user, id), h, user) });
});

transactionsRouter.delete('/:txnId', async (req, res) => {
  const h = currentHousehold(req);
  const id = idParam(req, 'txnId', 'Transaction');
  await db().transaction((tx) => deleteTransaction(tx, h, currentUser(req), id));
  await afterLedgerChange(h.id);
  res.status(204).end();
});

transactionsRouter.post('/:txnId/restore', async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const id = idParam(req, 'txnId', 'Transaction');
  await db().transaction((tx) => deleteTransaction(tx, h, user, id, true));
  await afterLedgerChange(h.id);
  res.json({ transaction: toTransactionDTO(await getVisibleTransaction(db(), h, user, id), h, user) });
});

// ---------- history (version-controlled edits) ----------
transactionsRouter.get('/:txnId/history', async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const id = idParam(req, 'txnId', 'Transaction');
  await getVisibleTransaction(db(), h, user, id, { includeDeleted: true });
  const rows = await db()
    .select({ r: transactionRevisions, editorName: users.name })
    .from(transactionRevisions)
    .leftJoin(users, eq(users.id, transactionRevisions.editorId))
    .where(eq(transactionRevisions.transactionId, id))
    .orderBy(desc(transactionRevisions.version));
  const out: RevisionDTO[] = rows.map(({ r, editorName }) => ({
    version: r.version,
    action: r.action,
    changes: r.changes,
    editor: r.editorId ? { id: r.editorId, name: editorName ?? 'Former member' } : null,
    createdAt: r.createdAt.toISOString(),
  }));
  res.json({ revisions: out });
});

transactionsRouter.post('/:txnId/revert', async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const id = idParam(req, 'txnId', 'Transaction');
  const input = parse(revertTransactionSchema, req.body);
  const [rev] = await db()
    .select()
    .from(transactionRevisions)
    .where(and(eq(transactionRevisions.transactionId, id), eq(transactionRevisions.version, input.version)));
  if (!rev) throw notFound('Version');
  if (rev.snapshot.deleted) throw badRequest('Choose a version where the entry existed');
  const s = rev.snapshot;
  const isStructural = s.type === 'transfer' || s.type === 'adjustment';
  await db().transaction((tx) =>
    updateTransaction(
      tx,
      h,
      user,
      id,
      isStructural
        ? { expectedVersion: input.expectedVersion, description: s.description, notes: s.notes, tags: s.tags }
        : {
            expectedVersion: input.expectedVersion,
            type: s.type as 'expense' | 'income',
            accountId: s.accountId,
            amountCents: Math.abs(s.amountCents),
            date: s.date,
            description: s.description,
            merchant: s.merchant,
            categoryId: s.categoryId,
            notes: s.notes,
            tags: s.tags,
          },
      'reverted',
    ),
  );
  await afterLedgerChange(h.id);
  res.json({ transaction: toTransactionDTO(await getVisibleTransaction(db(), h, user, id), h, user) });
});

// ---------- comments (asynchronous coordination) ----------
async function listComments(transactionId: string): Promise<CommentDTO[]> {
  const rows = await db()
    .select({ c: transactionComments, authorName: users.name })
    .from(transactionComments)
    .leftJoin(users, eq(users.id, transactionComments.authorId))
    .where(eq(transactionComments.transactionId, transactionId))
    .orderBy(asc(transactionComments.createdAt));
  const ids = rows.map((r) => r.c.id);
  const mentions = ids.length
    ? await db()
        .select({ commentId: commentMentions.commentId, id: users.id, name: users.name })
        .from(commentMentions)
        .innerJoin(users, eq(users.id, commentMentions.userId))
        .where(inArray(commentMentions.commentId, ids))
    : [];
  return rows.map(({ c, authorName }) => ({
    id: c.id,
    body: c.body,
    author: c.authorId ? { id: c.authorId, name: authorName ?? 'Former member' } : null,
    mentions: mentions.filter((m) => m.commentId === c.id).map((m) => ({ id: m.id, name: m.name })),
    createdAt: c.createdAt.toISOString(),
  }));
}

transactionsRouter.get('/:txnId/comments', async (req, res) => {
  const h = currentHousehold(req);
  const id = idParam(req, 'txnId', 'Transaction');
  await getVisibleTransaction(db(), h, currentUser(req), id);
  res.json({ comments: await listComments(id) });
});

transactionsRouter.post('/:txnId/comments', requireCap('comments.create'), async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const id = idParam(req, 'txnId', 'Transaction');
  const row = await getVisibleTransaction(db(), h, user, id);
  const input = parse(createCommentSchema, req.body);
  // Only members who can see the entry may be mentioned (private entries: nobody else).
  const members = await db()
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, h.id));
  const memberIds = new Set(members.map((m) => m.userId));
  const mentionIds = row.accountVisibility === 'private' ? [] : [...new Set(input.mentions)].filter((m) => memberIds.has(m) && m !== user.id);
  const commentId = newId();
  await db().transaction(async (tx) => {
    await tx.insert(transactionComments).values({ id: commentId, transactionId: id, householdId: h.id, authorId: user.id, body: input.body });
    if (mentionIds.length) await tx.insert(commentMentions).values(mentionIds.map((userId) => ({ commentId, userId })));
    await logActivity(tx, {
      householdId: h.id,
      actorId: user.id,
      entityType: 'comment',
      entityId: id,
      action: 'commented',
      summary: `commented on “${row.t.description}”`,
      visibleToUserId: row.accountVisibility === 'private' ? user.id : null,
    });
    const recipients = new Set<string>(mentionIds);
    const creatorId = row.t.createdBy;
    if (creatorId && creatorId !== user.id && memberIds.has(creatorId) && row.accountVisibility === 'shared') recipients.add(creatorId);
    const prefs = await prefsForUsers(tx, [...recipients]);
    const link = `/ledger?txn=${id}`;
    const snippet = input.body.length > 120 ? `${input.body.slice(0, 117)}…` : input.body;
    for (const uid of recipients) {
      const p = prefs.get(uid);
      const mentioned = mentionIds.includes(uid);
      if (mentioned ? p?.mentions === false : p?.comments === false) continue;
      await notify(tx, {
        userId: uid,
        householdId: h.id,
        type: mentioned ? 'mention' : 'comment',
        title: mentioned ? `${user.name} mentioned you on “${row.t.description}”` : `${user.name} commented on your entry “${row.t.description}”`,
        body: snippet,
        link,
      });
    }
  });
  res.status(201).json({ comments: await listComments(id) });
});

transactionsRouter.delete('/:txnId/comments/:commentId', async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const id = idParam(req, 'txnId', 'Transaction');
  await getVisibleTransaction(db(), h, user, id);
  const commentId = idParam(req, 'commentId', 'Comment');
  const [c] = await db()
    .select()
    .from(transactionComments)
    .where(and(eq(transactionComments.id, commentId), eq(transactionComments.transactionId, id)));
  if (!c) throw notFound('Comment');
  if (c.authorId !== user.id && h.role !== 'owner' && h.role !== 'admin') throw forbidden('You can only delete your own comments');
  await db().delete(transactionComments).where(eq(transactionComments.id, commentId));
  res.status(204).end();
});

// ---------- receipt attachments ----------
const ALLOWED_MIME: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
};

/** Multipart parser bounded by MAX_UPLOAD_MB; oversize uploads are rejected while streaming (413). */
const upload: RequestHandler = (req, res, next) =>
  multer({ storage: multer.memoryStorage(), limits: { fileSize: deps().config.maxUploadBytes, files: 1, fields: 5 } }).single('file')(
    req,
    res,
    next,
  );

transactionsRouter.get('/:txnId/attachments', async (req, res) => {
  const h = currentHousehold(req);
  const id = idParam(req, 'txnId', 'Transaction');
  await getVisibleTransaction(db(), h, currentUser(req), id);
  const rows = await db()
    .select({ a: attachments, uploader: users.name })
    .from(attachments)
    .leftJoin(users, eq(users.id, attachments.uploadedBy))
    .where(eq(attachments.transactionId, id))
    .orderBy(asc(attachments.createdAt));
  const out: AttachmentDTO[] = rows.map(({ a, uploader }) => ({
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    uploadedBy: a.uploadedBy ? { id: a.uploadedBy, name: uploader ?? 'Former member' } : null,
    createdAt: a.createdAt.toISOString(),
  }));
  res.json({ attachments: out });
});

transactionsRouter.post('/:txnId/attachments', uploadLimiter, upload, async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const id = idParam(req, 'txnId', 'Transaction');
  const row = await getVisibleTransaction(db(), h, user, id);
  if (!canEditTxn(h, user, { type: row.t.type, categoryId: row.t.categoryId, accountVisibility: row.accountVisibility, accountOwner: row.accountOwner, createdBy: row.t.createdBy })) {
    throw forbidden('You do not have permission to attach files to this entry');
  }
  const file = req.file;
  if (!file) throw badRequest('Choose a file to upload');
  const check = ALLOWED_MIME[file.mimetype];
  if (!check || !check(file.buffer)) throw badRequest('Upload a JPEG, PNG, WebP image or a PDF');
  const [{ count }] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(attachments)
    .where(eq(attachments.transactionId, id));
  if (count >= 10) throw badRequest('An entry can have at most 10 attachments');
  const key = await deps().storage.put(file.buffer);
  const filename = file.originalname.replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 120) || 'receipt';
  await db().insert(attachments).values({
    id: newId(),
    transactionId: id,
    householdId: h.id,
    filename,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    storageKey: key,
    uploadedBy: user.id,
  });
  await logActivity(db(), {
    householdId: h.id,
    actorId: user.id,
    entityType: 'transaction',
    entityId: id,
    action: 'attachment_added',
    summary: `attached a receipt to “${row.t.description}”`,
    visibleToUserId: row.accountVisibility === 'private' ? user.id : null,
  });
  res.status(201).json({ ok: true });
});

transactionsRouter.get('/:txnId/attachments/:attachmentId', async (req, res) => {
  const h = currentHousehold(req);
  const id = idParam(req, 'txnId', 'Transaction');
  await getVisibleTransaction(db(), h, currentUser(req), id);
  const [a] = await db()
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, idParam(req, 'attachmentId', 'Attachment')), eq(attachments.transactionId, id), eq(attachments.householdId, h.id)));
  if (!a) throw notFound('Attachment');
  const data = await deps().storage.get(a.storageKey);
  res.setHeader('Content-Type', a.mimeType);
  res.setHeader('Content-Length', String(data.length));
  res.setHeader('Content-Disposition', `${a.mimeType === 'application/pdf' ? 'attachment' : 'inline'}; filename="${encodeURIComponent(a.filename)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(data);
});

transactionsRouter.delete('/:txnId/attachments/:attachmentId', async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const id = idParam(req, 'txnId', 'Transaction');
  const row = await getVisibleTransaction(db(), h, user, id);
  if (!canEditTxn(h, user, { type: row.t.type, categoryId: row.t.categoryId, accountVisibility: row.accountVisibility, accountOwner: row.accountOwner, createdBy: row.t.createdBy })) {
    throw forbidden('You do not have permission to remove attachments from this entry');
  }
  const [a] = await db()
    .delete(attachments)
    .where(and(eq(attachments.id, idParam(req, 'attachmentId', 'Attachment')), eq(attachments.transactionId, id)))
    .returning();
  if (!a) throw notFound('Attachment');
  await deps().storage.remove(a.storageKey);
  res.status(204).end();
});
