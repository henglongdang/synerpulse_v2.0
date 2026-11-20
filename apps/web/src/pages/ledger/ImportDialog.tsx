import { useState } from 'react';
import { CheckCircle2, FileUp } from 'lucide-react';
import type { ImportResultDTO } from '@familypulse/shared/client';
import { api, ApiError } from '../../lib/api';
import { useHousehold } from '../../lib/session';
import { useAccounts, useInvalidate } from '../../lib/queries';
import { useToast } from '../../lib/toast';
import { money, shortDate } from '../../lib/format';
import { Button, Dialog, Field, FormError, Select } from '../../components/ui';

type DateFormat = 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY';

function guess(headers: string[], ...names: string[]) {
  return headers.find((h) => names.some((n) => h.toLowerCase().includes(n))) ?? '';
}

function sniffDateFormat(sample: string): DateFormat {
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(sample)) return 'YYYY-MM-DD';
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}$/.exec(sample);
  if (m && Number(m[1]) > 12) return 'DD/MM/YYYY';
  return 'MM/DD/YYYY';
}

/** Minimal header/first-row reader for mapping hints; the server does the real parsing. */
function peek(csv: string): { headers: string[]; first: Record<string, string> } {
  const lines = (csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv).split(/\r?\n/).filter(Boolean);
  const split = (l: string) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim()) ?? [];
  const headers = split(lines[0] ?? '').filter(Boolean);
  const row = split(lines[1] ?? '');
  return { headers, first: Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])) };
}

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { base, currency, me } = useHousehold();
  const accounts = useAccounts();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [accountId, setAccountId] = useState('');
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState({ date: '', description: '', amount: '', debit: '', credit: '', category: '' });
  const [mode, setMode] = useState<'amount' | 'split'>('amount');
  const [dateFormat, setDateFormat] = useState<DateFormat>('YYYY-MM-DD');
  const [invert, setInvert] = useState(false);
  const [preview, setPreview] = useState<ImportResultDTO | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const usable = (accounts.data ?? []).filter((a) => !a.archived && (a.visibility === 'shared' || a.ownerUserId === me.user.id));
  const acct = accountId || usable[0]?.id || '';

  function reset() {
    setCsv('');
    setFileName('');
    setHeaders([]);
    setPreview(null);
    setError(null);
  }

  async function onFile(f: File) {
    if (f.size > 1_000_000) {
      setError(new ApiError(400, 'bad_request', 'CSV files must be under 1 MB. Split larger exports by date.'));
      return;
    }
    const text = await f.text();
    const { headers: h, first } = peek(text);
    setCsv(text);
    setFileName(f.name);
    setHeaders(h);
    setPreview(null);
    setError(null);
    const date = guess(h, 'date', 'posted');
    const amount = guess(h, 'amount', 'value');
    const debit = guess(h, 'debit', 'withdrawal', 'out');
    const credit = guess(h, 'credit', 'deposit', 'in');
    setMapping({ date, description: guess(h, 'description', 'payee', 'memo', 'details', 'name'), amount, debit, credit, category: guess(h, 'category') });
    setMode(!amount && (debit || credit) ? 'split' : 'amount');
    if (date && first[date]) setDateFormat(sniffDateFormat(first[date]));
  }

  const body = () => ({
    accountId: acct,
    csv,
    mapping: {
      date: mapping.date,
      description: mapping.description,
      ...(mode === 'amount' ? { amount: mapping.amount } : { debit: mapping.debit || undefined, credit: mapping.credit || undefined }),
      ...(mapping.category ? { category: mapping.category } : {}),
    },
    dateFormat,
    invertAmounts: invert,
    skipDuplicates: true,
  });

  async function run(step: 'preview' | 'commit') {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<ImportResultDTO>(`${base}/imports/${step}`, body());
      if (step === 'preview') setPreview(r);
      else {
        toast.success(`Imported ${r.importedCount} entr${r.importedCount === 1 ? 'y' : 'ies'}${r.duplicateCount ? ` · skipped ${r.duplicateCount} duplicates` : ''}`);
        invalidate();
        reset();
        onClose();
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const col = (key: keyof typeof mapping, label: string, optional = false) => (
    <Field label={label} optional={optional}>
      <Select value={mapping[key]} onChange={(e) => { setMapping((m) => ({ ...m, [key]: e.target.value })); setPreview(null); }}>
        <option value="">{optional ? 'None' : 'Choose a column…'}</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Import a bank statement (CSV)"
      wide
      footer={
        <div className="form-actions">
          <Button onClick={() => { reset(); onClose(); }}>Cancel</Button>
          {preview && preview.validCount > 0 ? (
            <Button variant="primary" loading={busy} onClick={() => run('commit')}>
              Import {preview.validCount} entr{preview.validCount === 1 ? 'y' : 'ies'}
            </Button>
          ) : (
            <Button variant="primary" loading={busy} disabled={!csv || !mapping.date || !mapping.description} onClick={() => run('preview')}>
              Preview
            </Button>
          )}
        </div>
      }
    >
      <div className="form-grid">
        <p className="small muted">
          Download a CSV from your bank’s website and import it here. Nothing is written until you confirm, and entries already in the account are detected and skipped.
        </p>
        <FormError error={error} />
        <div className="form-row">
          <Field label="Into account">
            <Select value={acct} onChange={(e) => { setAccountId(e.target.value); setPreview(null); }}>
              {usable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.visibility === 'private' ? ' (private)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="File">
            <label className="btn" style={{ justifyContent: 'flex-start' }}>
              <FileUp size={16} /> <span className="truncate">{fileName || 'Choose CSV…'}</span>
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
            </label>
          </Field>
        </div>
        {headers.length > 0 && (
          <>
            <div className="form-row">
              {col('date', 'Date column')}
              <Field label="Date format">
                <Select value={dateFormat} onChange={(e) => { setDateFormat(e.target.value as DateFormat); setPreview(null); }}>
                  <option>YYYY-MM-DD</option>
                  <option>MM/DD/YYYY</option>
                  <option>DD/MM/YYYY</option>
                </Select>
              </Field>
            </div>
            <div className="form-row">
              {col('description', 'Description column')}
              {col('category', 'Category column', true)}
            </div>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field-label">Amounts are in</legend>
              <div className="cluster">
                <label className="check">
                  <input type="radio" checked={mode === 'amount'} onChange={() => { setMode('amount'); setPreview(null); }} /> One signed column
                </label>
                <label className="check">
                  <input type="radio" checked={mode === 'split'} onChange={() => { setMode('split'); setPreview(null); }} /> Separate debit / credit columns
                </label>
              </div>
            </fieldset>
            <div className="form-row">
              {mode === 'amount' ? (
                col('amount', 'Amount column')
              ) : (
                <>
                  {col('debit', 'Money out (debit)')}
                  {col('credit', 'Money in (credit)')}
                </>
              )}
            </div>
            {mode === 'amount' && (
              <label className="check">
                <input type="checkbox" checked={invert} onChange={(e) => { setInvert(e.target.checked); setPreview(null); }} />
                <span>
                  My bank shows spending as <em>positive</em> numbers (common for credit cards)
                </span>
              </label>
            )}
          </>
        )}
        {preview && (
          <div className="stack-sm">
            <div className="cluster">
              <span className="badge badge-good">
                <CheckCircle2 /> {preview.validCount} ready
              </span>
              {preview.duplicateCount > 0 && <span className="badge">{preview.duplicateCount} already in ledger</span>}
              {preview.errorCount > 0 && <span className="badge badge-crit">{preview.errorCount} with problems</span>}
            </div>
            <div className="table-wrap" style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Date</th>
                    <th>Description</th>
                    <th className="r">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 100).map((r) => (
                    <tr key={r.line} style={r.error ? { background: 'var(--crit-100)' } : r.duplicate ? { color: 'var(--ink-400)' } : undefined}>
                      <td className="num">{r.line}</td>
                      <td>{r.date ? shortDate(r.date, true) : '—'}</td>
                      <td className="truncate" style={{ maxWidth: 220 }}>
                        {r.description}
                      </td>
                      <td className="r">{r.amountCents != null ? money(r.amountCents, currency, { signed: true }) : '—'}</td>
                      <td className="xs">{r.error ?? (r.duplicate ? 'Duplicate — skipped' : 'Ready')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > 100 && <p className="xs muted">Showing the first 100 rows.</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}
