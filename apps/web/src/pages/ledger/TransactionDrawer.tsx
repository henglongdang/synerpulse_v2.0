import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, History, Lock, MessageSquare, Paperclip, Pencil, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { AttachmentDTO, CommentDTO, RevisionDTO, TransactionDTO } from '@familypulse/shared';
import { api, ApiError } from '../../lib/api';
import { useHousehold } from '../../lib/session';
import { useInvalidate, useMembers } from '../../lib/queries';
import { useToast } from '../../lib/toast';
import { money, relativeTime, shortDate } from '../../lib/format';
import { Avatar, Button, ConfirmDialog, Dialog, EmptyState, ErrorState, Skeleton, Tabs, Textarea, VisibilityBadge } from '../../components/ui';
import { CategoryIcon } from '../../components/icons';
import { useEntryDialog } from '../../features/entry/EntryDialog';

type Tab = 'comments' | 'history' | 'receipts';

function describeValue(field: string, v: unknown, currency: string, names: Record<string, string>): string {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'amount' && typeof v === 'number') return money(v, currency);
  if (field === 'tags' && Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if ((field === 'category' || field === 'account') && typeof v === 'string') return names[v] ?? 'another value';
  if (field === 'date' && typeof v === 'string') return shortDate(v, true);
  return String(v);
}

export function TransactionDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { base, hid, currency, can } = useHousehold();
  const invalidate = useInvalidate();
  const toast = useToast();
  const entry = useEntryDialog();
  const [tab, setTab] = useState<Tab>('comments');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const t = useQuery({ queryKey: ['txn', hid, id], queryFn: () => api.get<{ transaction: TransactionDTO }>(`${base}/transactions/${id}`).then((r) => r.transaction) });
  const txn = t.data;

  async function remove() {
    setBusy(true);
    try {
      await api.delete(`${base}/transactions/${id}`);
      invalidate();
      onClose();
      toast.success('Entry deleted', {
        label: 'Undo',
        onClick: async () => {
          await api.post(`${base}/transactions/${id}/restore`);
          invalidate();
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete');
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <Dialog open drawer onClose={onClose} title={txn ? txn.description : 'Entry'}>
      {t.isLoading && <Skeleton h={120} />}
      {t.isError && <ErrorState error={t.error} />}
      {txn && (
        <div className="stack">
          <div className="spread" style={{ alignItems: 'flex-start' }}>
            <div className="cluster" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <span className="cat-icon">
                <CategoryIcon name={txn.categoryName} />
              </span>
              <div>
                <div className="hero-figure" style={{ fontSize: '1.75rem', color: txn.amountCents > 0 ? 'var(--good-600)' : undefined }}>
                  {money(txn.amountCents, currency, { signed: true })}
                </div>
                <div className="small muted">
                  {shortDate(txn.date, true)} · {txn.type === 'transfer' ? 'Transfer' : txn.type === 'adjustment' ? 'Balance update' : txn.categoryName ?? 'Uncategorised'}
                </div>
              </div>
            </div>
            <VisibilityBadge visibility={txn.accountVisibility} />
          </div>

          <dl className="detail-list">
            <div>
              <dt>Account</dt>
              <dd>{txn.accountName}</dd>
            </div>
            {txn.merchant && (
              <div>
                <dt>Merchant</dt>
                <dd>{txn.merchant}</dd>
              </div>
            )}
            {txn.tags.length > 0 && (
              <div>
                <dt>Tags</dt>
                <dd className="cluster" style={{ gap: 4 }}>
                  {txn.tags.map((g) => (
                    <span key={g} className="tag">
                      {g}
                    </span>
                  ))}
                </dd>
              </div>
            )}
            {txn.notes && (
              <div>
                <dt>Notes</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{txn.notes}</dd>
              </div>
            )}
            <div>
              <dt>Logged by</dt>
              <dd>
                {txn.createdBy?.name ?? 'Former member'} · {relativeTime(txn.createdAt)}
                {txn.source !== 'manual' && <span className="badge" style={{ marginLeft: 6 }}>{txn.source === 'recurring' ? 'From a bill' : txn.source === 'import' ? 'Imported' : txn.source}</span>}
              </dd>
            </div>
            {txn.version > 1 && (
              <div>
                <dt>Last edit</dt>
                <dd>
                  {txn.updatedBy?.name ?? 'Former member'} · {relativeTime(txn.updatedAt)} · version {txn.version}
                </dd>
              </div>
            )}
          </dl>

          {txn.canEdit ? (
            <div className="cluster">
              <Button icon={<Pencil size={16} />} onClick={() => entry.open({ txn })}>
                Edit
              </Button>
              <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            </div>
          ) : (
            <div className="xs muted cluster">
              <Lock size={12} /> {can('transactions.create') ? 'Your access doesn’t include this category.' : 'Viewers can read and comment.'}
            </div>
          )}

          <Tabs<Tab>
            label="Entry details"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'comments', label: <span className="cluster" style={{ gap: 6 }}><MessageSquare size={15} /> Comments{txn.commentCount ? ` (${txn.commentCount})` : ''}</span> },
              { value: 'history', label: <span className="cluster" style={{ gap: 6 }}><History size={15} /> History</span> },
              { value: 'receipts', label: <span className="cluster" style={{ gap: 6 }}><Paperclip size={15} /> Receipts{txn.attachmentCount ? ` (${txn.attachmentCount})` : ''}</span> },
            ]}
          />
          {tab === 'comments' && <Comments txn={txn} />}
          {tab === 'history' && <HistoryPanel txn={txn} />}
          {tab === 'receipts' && <Receipts txn={txn} />}
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this entry?"
        body={
          <>
            It will disappear from the ledger and totals for everyone. You can undo straight away, and the deletion is kept in the entry’s history.
            {txn?.transferGroupId ? ' Both sides of the transfer will be removed.' : ''}
          </>
        }
        confirmLabel="Delete entry"
        danger
        loading={busy}
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </Dialog>
  );
}

function Comments({ txn }: { txn: TransactionDTO }) {
  const { base, hid, can, me } = useHousehold();
  const members = useMembers();
  const invalidate = useInvalidate();
  const [body, setBody] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const q = useQuery({ queryKey: ['comments', hid, txn.id], queryFn: () => api.get<{ comments: CommentDTO[] }>(`${base}/transactions/${txn.id}/comments`).then((r) => r.comments) });
  const others = (members.data ?? []).filter((m) => m.userId !== me.user.id);
  const mentionable = txn.accountVisibility === 'shared' ? others : [];

  async function send() {
    if (!body.trim()) return;
    setSending(true);
    setError(null);
    const mentions = mentionable.filter((m) => body.includes(`@${m.name.split(' ')[0]}`)).map((m) => m.userId);
    try {
      await api.post(`${base}/transactions/${txn.id}/comments`, { body, mentions });
      setBody('');
      await q.refetch();
      invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="stack">
      {q.isLoading ? (
        <Skeleton h={60} />
      ) : (q.data ?? []).length === 0 ? (
        <p className="small muted">No comments yet. Ask a question or add context — members you @mention get a notification.</p>
      ) : (
        <ul className="list stack-sm">
          {q.data!.map((c) => (
            <li key={c.id} className="comment">
              {c.author ? <Avatar id={c.author.id} name={c.author.name} /> : <span className="avatar">?</span>}
              <div className="comment-bubble">
                <div className="xs muted">
                  <strong style={{ color: 'var(--ink-900)' }}>{c.author?.name ?? 'Former member'}</strong> · {relativeTime(c.createdAt)}
                </div>
                <div className="small" style={{ whiteSpace: 'pre-wrap' }}>
                  {c.body}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {can('comments.create') && (
        <div className="stack-sm">
          <Textarea aria-label="Write a comment" placeholder="Add a comment…" value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={2000} />
          {error instanceof ApiError && <div className="field-error">{error.message}</div>}
          <div className="spread">
            <div className="cluster" style={{ gap: 4 }}>
              {mentionable.map((m) => (
                <button key={m.userId} type="button" className="badge badge-outline" style={{ cursor: 'pointer' }} onClick={() => setBody((b) => `${b}${b && !b.endsWith(' ') ? ' ' : ''}@${m.name.split(' ')[0]} `)}>
                  @{m.name.split(' ')[0]}
                </button>
              ))}
            </div>
            <Button size="sm" variant="primary" loading={sending} disabled={!body.trim()} onClick={send}>
              Comment
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryPanel({ txn }: { txn: TransactionDTO }) {
  const { base, hid, currency } = useHousehold();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [reverting, setReverting] = useState<number | null>(null);
  const q = useQuery({ queryKey: ['history', hid, txn.id, txn.version], queryFn: () => api.get<{ revisions: RevisionDTO[] }>(`${base}/transactions/${txn.id}/history`).then((r) => r.revisions) });
  const names: Record<string, string> = {};
  if (txn.categoryId && txn.categoryName) names[txn.categoryId] = txn.categoryName;
  names[txn.accountId] = txn.accountName;

  async function revert(version: number) {
    setReverting(version);
    try {
      await api.post(`${base}/transactions/${txn.id}/revert`, { version, expectedVersion: txn.version });
      toast.success(`Restored version ${version}`);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not restore');
    } finally {
      setReverting(null);
    }
  }
  if (q.isLoading) return <Skeleton h={80} />;
  if (q.isError) return <ErrorState error={q.error} />;
  return (
    <ol className="timeline">
      {q.data!.map((r, i) => (
        <li key={r.version}>
          <div className="spread">
            <div className="small">
              <strong>{r.editor?.name ?? 'Former member'}</strong>{' '}
              {r.action === 'created' ? 'created this entry' : r.action === 'reverted' ? 'restored an earlier version' : r.action === 'deleted' ? 'deleted it' : r.action === 'restored' ? 'restored it' : 'edited it'}
              <div className="xs muted">
                v{r.version} · {new Date(r.createdAt).toLocaleString()}
              </div>
            </div>
            {txn.canEdit && i > 0 && r.action !== 'deleted' && (
              <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} loading={reverting === r.version} onClick={() => revert(r.version)}>
                Restore
              </Button>
            )}
          </div>
          {r.changes.length > 0 && (
            <ul className="change-list">
              {r.changes.map((c) => (
                <li key={c.field} className="xs">
                  <span className="muted">{c.field}:</span> <s>{describeValue(c.field, c.from, currency, names)}</s> → <strong>{describeValue(c.field, c.to, currency, names)}</strong>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

function Receipts({ txn }: { txn: TransactionDTO }) {
  const { base, hid } = useHousehold();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<AttachmentDTO | null>(null);
  const q = useQuery({ queryKey: ['attachments', hid, txn.id], queryFn: () => api.get<{ attachments: AttachmentDTO[] }>(`${base}/transactions/${txn.id}/attachments`).then((r) => r.attachments) });
  const url = (a: AttachmentDTO) => `/api${base}/transactions/${txn.id}/attachments/${a.id}`;

  async function upload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Files must be under 5 MB');
      return;
    }
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      await api.upload(`${base}/transactions/${txn.id}/attachments`, form);
      toast.success('Receipt attached');
      await q.refetch();
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="stack">
      {q.isLoading ? (
        <Skeleton h={48} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={<FileText size={22} />} title="No receipts attached">
          Photos or PDFs help with returns, warranties and tax time.
        </EmptyState>
      ) : (
        <ul className="list">
          {q.data!.map((a) => (
            <li key={a.id} className="row" style={{ paddingLeft: 0, paddingRight: 0 }}>
              <span className="cat-icon">
                <FileText size={18} />
              </span>
              <div className="row-main">
                <div className="row-title">{a.filename}</div>
                <div className="row-meta">
                  {(a.sizeBytes / 1024).toFixed(0)} KB · {a.uploadedBy?.name ?? 'Former member'}
                </div>
              </div>
              {a.mimeType.startsWith('image/') ? (
                <Button size="sm" onClick={() => setPreview(a)}>
                  View
                </Button>
              ) : (
                <a className="btn btn-sm" href={url(a)}>
                  Download
                </a>
              )}
              {txn.canEdit && (
                <button
                  className="icon-btn icon-btn-sm"
                  aria-label={`Remove ${a.filename}`}
                  onClick={async () => {
                    await api.delete(`${base}/transactions/${txn.id}/attachments/${a.id}`);
                    await q.refetch();
                    invalidate();
                  }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {txn.canEdit && (
        <label className={`btn ${uploading ? '' : 'btn-accent'}`} style={{ justifySelf: 'start' }}>
          {uploading ? <span className="spinner" /> : <Upload size={16} />} {uploading ? 'Uploading…' : 'Attach receipt'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = '';
            }}
          />
        </label>
      )}
      <p className="xs muted">JPEG, PNG, WebP or PDF up to 5 MB. Receipts are private to this household and never cached on shared devices.</p>
      <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.filename ?? ''} wide>
        {preview && <img src={url(preview)} alt={`Receipt: ${preview.filename}`} style={{ maxWidth: '100%', margin: '0 auto' }} />}
      </Dialog>
    </div>
  );
}
