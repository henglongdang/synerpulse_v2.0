import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeftRight, Lock } from 'lucide-react';
import { categoryAllowed, type CategoryDTO, type Role, type TransactionDTO } from '@familypulse/shared';
import { api, ApiError } from '../../lib/api';
import { useHousehold } from '../../lib/session';
import { useAccounts, useCategories, useHouseholdDetail, useInvalidate } from '../../lib/queries';
import { enqueue } from '../../lib/outbox';
import { useToast } from '../../lib/toast';
import { localToday, money, shortDate } from '../../lib/format';
import { Button, Dialog, Field, FormError, Input, MoneyInput, Segmented, Select, Textarea } from '../../components/ui';

type Kind = 'expense' | 'income' | 'transfer';
interface OpenArgs {
  txn?: TransactionDTO;
  defaults?: Partial<{ type: Kind; accountId: string; categoryId: string; date: string; description: string }>;
}
interface Ctx {
  open(args: OpenArgs): void;
}
const EntryCtx = createContext<Ctx | null>(null);

export function useEntryDialog(): Ctx {
  const c = useContext(EntryCtx);
  if (!c) throw new Error('EntryDialogProvider missing');
  return c;
}

export function EntryDialogProvider({ children }: { children: ReactNode }) {
  const [args, setArgs] = useState<OpenArgs | null>(null);
  const [nonce, setNonce] = useState(0);
  const value = useMemo<Ctx>(
    () => ({
      open: (a) => {
        setArgs(a);
        setNonce((n) => n + 1);
      },
    }),
    [],
  );
  return (
    <EntryCtx.Provider value={value}>
      {children}
      {args && <EntryForm key={nonce} args={args} onClose={() => setArgs(null)} />}
    </EntryCtx.Provider>
  );
}

function groupLabel(c: CategoryDTO) {
  return { living: 'Living', entertainment: 'Entertainment', unexpected: 'Unexpected', income: 'Income' }[c.group];
}

function EntryForm({ args, onClose }: { args: OpenArgs; onClose: () => void }) {
  const { base, hid, currency, household, me } = useHousehold();
  const accounts = useAccounts();
  const categories = useCategories();
  const invalidate = useInvalidate();
  const toast = useToast();
  const editing = args.txn;
  const structural = editing && (editing.type === 'transfer' || editing.type === 'adjustment');

  const [kind, setKind] = useState<Kind>((editing?.type === 'income' ? 'income' : editing?.type === 'transfer' ? 'transfer' : args.defaults?.type) ?? 'expense');
  const [amount, setAmount] = useState<number | null>(editing ? Math.abs(editing.amountCents) : null);
  const [date, setDate] = useState(editing?.date ?? args.defaults?.date ?? localToday());
  const [description, setDescription] = useState(editing?.description ?? args.defaults?.description ?? '');
  const [merchant, setMerchant] = useState(editing?.merchant ?? '');
  const [accountId, setAccountId] = useState(editing?.accountId ?? args.defaults?.accountId ?? '');
  const [toAccountId, setToAccountId] = useState('');
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? args.defaults?.categoryId ?? '');
  const [tags, setTags] = useState((editing?.tags ?? []).join(', '));
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<TransactionDTO | null>(null);
  const [version, setVersion] = useState(editing?.version ?? 0);

  const openAccounts = (accounts.data ?? []).filter((a) => !a.archived && (a.visibility === 'shared' || a.ownerUserId === me.user.id));
  const effectiveAccount = accountId || openAccounts[0]?.id || '';
  const selectedAccount = openAccounts.find((a) => a.id === effectiveAccount);
  const detail = useHouseholdDetail();
  const myScope = detail.data?.household.categoryScope ?? [];
  // Category-scoped contributors only see the categories they may use on shared accounts.
  const usable = (categories.data ?? []).filter(
    (c) =>
      !c.archived &&
      (kind === 'income' ? c.group === 'income' : c.group !== 'income') &&
      (selectedAccount?.visibility === 'private' || categoryAllowed(household.role as Role, myScope, c.id)),
  );

  const fe = error instanceof ApiError ? error : null;
  const fieldErr = (name: string) => fe?.field(name);

  async function submit(overwrite = false) {
    setError(null);
    if (amount == null || amount <= 0) {
      setError(new ApiError(400, 'bad_request', 'Enter an amount greater than zero', { amountCents: ['Enter an amount greater than zero'] }));
      return;
    }
    if (!effectiveAccount) {
      setError(new ApiError(400, 'bad_request', 'Choose an account', { accountId: ['Choose an account'] }));
      return;
    }
    const tagList = tags
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    setSaving(true);
    try {
      if (editing) {
        const body = structural
          ? { expectedVersion: overwrite && conflict ? conflict.version : version, description, notes: notes || null, tags: tagList }
          : {
              expectedVersion: overwrite && conflict ? conflict.version : version,
              type: kind as 'expense' | 'income',
              accountId: effectiveAccount,
              amountCents: amount,
              date,
              description,
              merchant: merchant || null,
              categoryId: categoryId || null,
              notes: notes || null,
              tags: tagList,
            };
        await api.patch(`${base}/transactions/${editing.id}`, body);
        toast.success('Changes saved — a new version was added to the history');
      } else if (kind === 'transfer') {
        await api.post(`${base}/transactions/transfers`, { fromAccountId: effectiveAccount, toAccountId, amountCents: amount, date, description: description || 'Transfer', clientRequestId: crypto.randomUUID() });
        toast.success('Transfer recorded');
      } else {
        const payload = {
          accountId: effectiveAccount,
          type: kind,
          amountCents: amount,
          date,
          description,
          merchant: merchant || null,
          categoryId: categoryId || null,
          notes: notes || null,
          tags: tagList,
          clientRequestId: crypto.randomUUID(),
        };
        try {
          const res = await api.post<{ appliedRules: string[] }>(`${base}/transactions`, payload);
          toast.success(res.appliedRules.length ? `Saved · ${res.appliedRules.length} automation rule${res.appliedRules.length > 1 ? 's' : ''} applied` : 'Saved to the ledger');
        } catch (e) {
          if (e instanceof ApiError && e.isNetwork) {
            await enqueue({
              id: payload.clientRequestId,
              householdId: hid,
              payload,
              display: {
                description,
                amountCents: kind === 'expense' ? -amount : amount,
                date,
                accountName: selectedAccount?.name ?? 'Account',
                categoryName: usable.find((c) => c.id === categoryId)?.name ?? null,
              },
            });
            toast.info('You’re offline — saved on this device and will sync automatically.');
            onClose();
            return;
          }
          throw e;
        }
      }
      invalidate();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.current) {
        setConflict(e.current as TransactionDTO);
      } else setError(e);
    } finally {
      setSaving(false);
    }
  }

  const title = editing ? (structural ? 'Edit details' : 'Edit entry') : 'Add entry';
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={accounts.isLoading} onClick={() => submit(false)} type="submit" form="entry-form">
            {editing ? 'Save changes' : kind === 'transfer' ? 'Record transfer' : 'Save entry'}
          </Button>
        </div>
      }
    >
      <form
        id="entry-form"
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
        noValidate
      >
        {conflict && (
          <div className="callout warn" role="alert">
            <AlertTriangle size={18} aria-hidden />
            <div className="stack-sm">
              <strong>{conflict.updatedBy?.name ?? 'Someone'} changed this entry while you were editing.</strong>
              <div className="small">
                Their version: <span className="num">{money(conflict.amountCents, currency)}</span> · {conflict.description} · {shortDate(conflict.date)}
                {conflict.categoryName ? ` · ${conflict.categoryName}` : ''}
              </div>
              <div className="cluster">
                <Button size="sm" onClick={() => { invalidate(); onClose(); }}>
                  Keep theirs
                </Button>
                <Button size="sm" variant="primary" loading={saving} onClick={() => { setVersion(conflict.version); void submit(true); }}>
                  Save mine over it
                </Button>
              </div>
              <div className="xs muted">Either way, both versions stay in the entry’s history.</div>
            </div>
          </div>
        )}
        <FormError error={fe && !fe.details ? fe : !fe && error ? error : null} />
        {!editing && (
          <Segmented<Kind>
            label="Entry type"
            value={kind}
            onChange={(k) => {
              setKind(k);
              setCategoryId('');
            }}
            options={[
              { value: 'expense', label: 'Spending' },
              { value: 'income', label: 'Income' },
              { value: 'transfer', label: 'Transfer' },
            ]}
          />
        )}
        {structural && <div className="callout"><ArrowLeftRight size={16} /> Transfers and balance updates keep their amounts; you can change the description, notes and tags.</div>}
        {!structural && (
          <div className="form-row">
            <Field label="Amount" error={fieldErr('amountCents')}>
              <MoneyInput value={amount} onChange={setAmount} data-autofocus placeholder="0.00" />
            </Field>
            <Field label="Date" error={fieldErr('date')}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
          </div>
        )}
        <Field label="Description" error={fieldErr('description')}>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={120} placeholder={kind === 'income' ? 'e.g. Paycheck' : kind === 'transfer' ? 'e.g. Move to savings' : 'e.g. Weekly groceries'} />
        </Field>
        {!structural && (
          <div className="form-row">
            <Field label={kind === 'transfer' ? 'From account' : 'Account'} error={fieldErr('accountId') ?? fieldErr('fromAccountId')}>
              <Select value={effectiveAccount} onChange={(e) => setAccountId(e.target.value)} disabled={accounts.isLoading}>
                {openAccounts.length === 0 && <option value="">No accounts yet</option>}
                {openAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.visibility === 'private' ? ' (private)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            {kind === 'transfer' ? (
              <Field label="To account" error={fieldErr('toAccountId')}>
                <Select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                  <option value="">Choose…</option>
                  {openAccounts
                    .filter((a) => a.id !== effectiveAccount)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.visibility === 'private' ? ' (private)' : ''}
                      </option>
                    ))}
                </Select>
              </Field>
            ) : (
              <Field
                label="Category"
                error={fieldErr('categoryId')}
                hint={
                  household.role === 'contributor' && selectedAccount?.visibility === 'shared' ? 'Your access may be limited to certain categories.' : undefined
                }
              >
                <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Uncategorised</option>
                  {['Living', 'Entertainment', 'Unexpected', 'Income'].map((g) => {
                    const list = usable.filter((c) => groupLabel(c) === g);
                    return list.length ? (
                      <optgroup key={g} label={g}>
                        {list.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null;
                  })}
                </Select>
              </Field>
            )}
          </div>
        )}
        {selectedAccount?.visibility === 'private' && !structural && (
          <div className="xs muted cluster">
            <Lock size={12} /> Private account — only you will see this entry.
          </div>
        )}
        {kind !== 'transfer' && !structural && (
          <Field label="Merchant" optional>
            <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} maxLength={80} />
          </Field>
        )}
        {kind !== 'transfer' && (
          <>
            <Field label="Tags" optional hint="Comma-separated, e.g. freelance, school. Automation rules can react to tags." error={fieldErr('tags') ?? fieldErr('tags.0')}>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} />
            </Field>
            <Field label="Notes" optional error={fieldErr('notes')}>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} />
            </Field>
          </>
        )}
      </form>
    </Dialog>
  );
}
