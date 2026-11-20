import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Check, Copy, Crown, Link2, Lock, Pencil, Plus, Scale, Trash2, UserMinus, UserPlus, Zap } from 'lucide-react';
import {
  ACCOUNT_TYPE_LABELS,
  canAssignRole,
  canManageMember,
  CATEGORY_GROUP_LABELS,
  CATEGORY_GROUPS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  SUPPORTED_CURRENCIES,
  type AccountDTO,
  type CategoryGroup,
  type InviteDTO,
  type MemberDTO,
  type Role,
  type RuleDTO,
} from '@familypulse/shared/client';
import { api, ApiError } from '../../lib/api';
import { meKey, useHousehold } from '../../lib/session';
import { useAccounts, useCategories, useGoals, useInvalidate, useMembers } from '../../lib/queries';
import { useToast } from '../../lib/toast';
import { localToday, money, relativeTime, shortDate } from '../../lib/format';
import { Avatar, Button, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, FormError, Input, MoneyInput, Select, Skeleton, Tabs, VisibilityBadge } from '../../components/ui';
import { AccountIcon, CategoryIcon } from '../../components/icons';
import { AccountForm } from '../../features/forms';

type Tab = 'members' | 'accounts' | 'categories' | 'rules' | 'settings';

export default function HouseholdPage() {
  const { household } = useHousehold();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'members';
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{household.name}</h1>
          <p>Who’s in the household, what they can do, and the accounts and rules you share.</p>
        </div>
      </div>
      <Tabs<Tab>
        label="Household sections"
        value={tab}
        onChange={(t) => setParams(t === 'members' ? {} : { tab: t }, { replace: true })}
        options={[
          { value: 'members', label: 'Members' },
          { value: 'accounts', label: 'Accounts' },
          { value: 'categories', label: 'Categories' },
          { value: 'rules', label: 'Automation' },
          { value: 'settings', label: 'Settings' },
        ]}
      />
      <div style={{ marginTop: 20 }}>
        {tab === 'members' && <Members />}
        {tab === 'accounts' && <Accounts />}
        {tab === 'categories' && <Categories />}
        {tab === 'rules' && <Rules />}
        {tab === 'settings' && <HouseholdSettings />}
      </div>
    </div>
  );
}

// ============================================================ members
function Members() {
  const { base, hid, household, me, can } = useHousehold();
  const members = useMembers();
  const categories = useCategories();
  const invalidate = useInvalidate();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(false);
  const [edit, setEdit] = useState<MemberDTO | null>(null);
  const [remove, setRemove] = useState<MemberDTO | null>(null);
  const [transfer, setTransfer] = useState<MemberDTO | null>(null);
  const invites = useQuery({ queryKey: ['invites', hid], queryFn: () => api.get<{ invitations: InviteDTO[] }>(`${base}/invitations`).then((r) => r.invitations), enabled: can('members.manage') });
  const catName = (id: string) => categories.data?.find((c) => c.id === id)?.name ?? '—';
  const leaving = remove?.userId === me.user.id;

  return (
    <div className="grid-main-side">
      <section className="card" aria-labelledby="mem-title">
        <div className="card-head">
          <h2 id="mem-title">Members</h2>
          {can('members.manage') && (
            <Button size="sm" variant="primary" icon={<UserPlus size={16} />} onClick={() => setInvite(true)}>
              Invite
            </Button>
          )}
        </div>
        {members.isLoading ? (
          <div className="card-body">
            <Skeleton h={120} />
          </div>
        ) : members.isError ? (
          <ErrorState error={members.error} />
        ) : (
          <ul className="list" style={{ marginTop: 8 }}>
            {members.data!.map((m) => {
              const self = m.userId === me.user.id;
              const manageable = !self && canManageMember(household.role, m.role);
              return (
                <li key={m.userId} className="row" style={{ alignItems: 'flex-start' }}>
                  <Avatar id={m.userId} name={m.name} size="lg" />
                  <div className="row-main stack-sm" style={{ gap: 2 }}>
                    <div className="cluster" style={{ gap: 6 }}>
                      <strong>{m.name}</strong>
                      {self && <span className="xs muted">(you)</span>}
                      <span className={`badge ${m.role === 'owner' ? 'badge-shared' : 'badge-outline'}`}>
                        {m.role === 'owner' && <Crown />}
                        {ROLE_LABELS[m.role]}
                      </span>
                    </div>
                    <div className="xs muted truncate">{m.email}</div>
                    {m.role === 'contributor' && (
                      <div className="xs">
                        {m.categoryScope.length ? (
                          <span>
                            <Lock size={11} style={{ display: 'inline', verticalAlign: '-1px' }} /> Can edit: {m.categoryScope.map(catName).join(', ')}
                          </span>
                        ) : (
                          <span className="muted">Can edit any category</span>
                        )}
                      </div>
                    )}
                    <div className="xs muted">Joined {shortDate(m.joinedAt.slice(0, 10), true)}</div>
                  </div>
                  <div className="cluster">
                    {manageable && can('members.manage') && (
                      <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => setEdit(m)}>
                        Access
                      </Button>
                    )}
                    {household.role === 'owner' && !self && (
                      <Button size="sm" variant="ghost" icon={<Crown size={14} />} onClick={() => setTransfer(m)} aria-label={`Make ${m.name} the owner`} />
                    )}
                    {(manageable || (self && m.role !== 'owner')) && (
                      <Button size="sm" variant="ghost" icon={<UserMinus size={14} />} onClick={() => setRemove(m)} aria-label={self ? 'Leave household' : `Remove ${m.name}`} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {can('members.manage') && (invites.data ?? []).length > 0 && (
          <>
            <hr className="divider" />
            <div className="card-head">
              <h3 style={{ fontSize: 'var(--text-sm)' }}>Pending invitations</h3>
            </div>
            <ul className="list">
              {invites.data!.map((i) => (
                <li key={i.id} className="row">
                  <span className="cat-icon">
                    <Link2 size={16} />
                  </span>
                  <div className="row-main">
                    <div className="row-title">{i.email ?? 'Anyone with the link'}</div>
                    <div className="row-meta">
                      {ROLE_LABELS[i.role]} · expires {relativeTime(i.expiresAt).replace(' ago', '')} · by {i.createdBy}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await api.delete(`${base}/invitations/${i.id}`);
                      invalidate();
                      void invites.refetch();
                      toast.success('Invitation revoked');
                    }}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card card-pad stack-sm" aria-labelledby="roles-title">
        <h2 id="roles-title" style={{ fontSize: 'var(--text-base)' }}>
          What each role can do
        </h2>
        {(['owner', 'admin', 'contributor', 'viewer'] as Role[]).map((r) => (
          <div key={r} className="small">
            <strong>{ROLE_LABELS[r]}</strong>
            <div className="muted">{ROLE_DESCRIPTIONS[r]}</div>
          </div>
        ))}
        <div className="callout small">
          <Lock size={16} />
          <span>Private accounts stay private: nobody else — including owners and admins — can see their balances or entries.</span>
        </div>
      </section>

      <InviteDialog open={invite} onClose={() => { setInvite(false); void invites.refetch(); }} />
      {edit && <AccessDialog member={edit} onClose={() => setEdit(null)} />}
      <ConfirmDialog
        open={remove !== null}
        title={leaving ? `Leave ${household.name}?` : `Remove ${remove?.name}?`}
        body={
          leaving
            ? 'You’ll lose access immediately. Your private accounts in this household are deleted; shared accounts you created stay with the household.'
            : `${remove?.name} loses access immediately. Their private accounts in this household are deleted; shared entries they logged stay in the ledger.`
        }
        confirmLabel={leaving ? 'Leave household' : 'Remove member'}
        danger
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          try {
            await api.delete(`${base}/members/${remove!.userId}`);
            if (leaving) {
              await qc.invalidateQueries({ queryKey: meKey });
              navigate('/');
            } else {
              invalidate();
              toast.success(`${remove!.name} removed`);
            }
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed');
          }
          setRemove(null);
        }}
      />
      <ConfirmDialog
        open={transfer !== null}
        title={`Make ${transfer?.name} the owner?`}
        body="They’ll gain full control, including deleting the household. You’ll become an admin."
        confirmLabel="Transfer ownership"
        onClose={() => setTransfer(null)}
        onConfirm={async () => {
          try {
            await api.post(`${base}/transfer-ownership`, { userId: transfer!.userId });
            await qc.invalidateQueries({ queryKey: meKey });
            invalidate();
            toast.success('Ownership transferred');
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed');
          }
          setTransfer(null);
        }}
      />
    </div>
  );
}

function CategoryScopePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const categories = useCategories();
  const list = (categories.data ?? []).filter((c) => !c.archived);
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="field-label">Limit editing to these categories</legend>
      <p className="field-hint" style={{ marginBottom: 6 }}>
        Leave all unchecked to allow every category. Useful for, say, a teenager who logs groceries.
      </p>
      <div className="scope-grid">
        {list.map((c) => (
          <label key={c.id} className="check small">
            <input type="checkbox" checked={value.includes(c.id)} onChange={(e) => onChange(e.target.checked ? [...value, c.id] : value.filter((x) => x !== c.id))} />
            {c.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { base, household } = useHousehold();
  const [role, setRole] = useState<'admin' | 'contributor' | 'viewer'>('contributor');
  const [email, setEmail] = useState('');
  const [scope, setScope] = useState<string[]>([]);
  const [created, setCreated] = useState<InviteDTO | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const close = () => {
    setCreated(null);
    setEmail('');
    setScope([]);
    setError(null);
    onClose();
  };
  const roles = (['admin', 'contributor', 'viewer'] as const).filter((r) => canAssignRole(household.role, r));
  return (
    <Dialog
      open={open}
      onClose={close}
      title={created ? 'Invitation ready' : `Invite someone to ${household.name}`}
      footer={
        created ? (
          <div className="form-actions">
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </div>
        ) : (
          <div className="form-actions">
            <Button onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const r = await api.post<{ invitation: InviteDTO }>(`${base}/invitations`, { role, email: email || undefined, categoryScope: role === 'contributor' ? scope : undefined });
                  setCreated(r.invitation);
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Create invitation
            </Button>
          </div>
        )
      }
    >
      {created ? (
        <div className="stack">
          <p className="small">
            Share this link with them{created.email ? ` (it only works for ${created.email})` : ''}. It works once and expires in 7 days.
            {created.email ? ' If email is configured on the server, they’ve been sent it too.' : ''}
          </p>
          <div className="cluster" style={{ flexWrap: 'nowrap' }}>
            <Input readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link" />
            <Button
              icon={copied ? <Check size={16} /> : <Copy size={16} />}
              onClick={async () => {
                await navigator.clipboard?.writeText(created.url!).catch(() => undefined);
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="form-grid">
          <FormError error={error} />
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label" style={{ marginBottom: 6 }}>
              Role
            </legend>
            {roles.map((r) => (
              <label key={r} className="check" style={{ marginBottom: 8 }}>
                <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} />
                <span>
                  <strong>{ROLE_LABELS[r]}</strong>
                  <span className="muted small"> — {ROLE_DESCRIPTIONS[r]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {role === 'contributor' && <CategoryScopePicker value={scope} onChange={setScope} />}
          <Field label="Their email" optional hint="Restricts the link to this address.">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
      )}
    </Dialog>
  );
}

function AccessDialog({ member, onClose }: { member: MemberDTO; onClose: () => void }) {
  const { base, household } = useHousehold();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [role, setRole] = useState<Role>(member.role);
  const [scope, setScope] = useState<string[]>(member.categoryScope);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const roles = (['admin', 'contributor', 'viewer'] as const).filter((r) => canAssignRole(household.role, r) || r === member.role);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${member.name}’s access`}
      footer={
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api.patch(`${base}/members/${member.userId}`, { ...(role !== member.role ? { role } : {}), ...(role === 'contributor' ? { categoryScope: scope } : {}) });
                toast.success('Access updated — they’ve been notified');
                invalidate();
                onClose();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="form-grid">
        <FormError error={error} />
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <p className="small muted">{ROLE_DESCRIPTIONS[role]}</p>
        {role === 'contributor' && <CategoryScopePicker value={scope} onChange={setScope} />}
      </div>
    </Dialog>
  );
}

// ============================================================ accounts
function Accounts() {
  const { base, currency, can, me } = useHousehold();
  const [showArchived, setShowArchived] = useState(false);
  const accounts = useAccounts(showArchived);
  const invalidate = useInvalidate();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [balanceFor, setBalanceFor] = useState<AccountDTO | null>(null);
  const [deleting, setDeleting] = useState<AccountDTO | null>(null);
  const canManage = (a: AccountDTO) => (a.visibility === 'private' ? a.ownerUserId === me.user.id : can('accounts.manage'));
  return (
    <section className="card" aria-labelledby="acc-title">
      <div className="card-head">
        <h2 id="acc-title">Accounts</h2>
        <div className="cluster">
          <label className="check small">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
          {can('transactions.create') && (
            <Button size="sm" variant="primary" icon={<Plus size={16} />} onClick={() => setAdding(true)}>
              Add account
            </Button>
          )}
        </div>
      </div>
      {accounts.isLoading ? (
        <div className="card-body">
          <Skeleton h={120} />
        </div>
      ) : (accounts.data ?? []).length === 0 ? (
        <EmptyState icon={<Scale size={22} />} title="No accounts yet">
          Add the checking, savings, card and loan accounts you want to track. Balances are entered by you or imported from CSV — never pulled with your bank password.
        </EmptyState>
      ) : (
        <ul className="list" style={{ marginTop: 8 }}>
          {accounts.data!.map((a) => (
            <li key={a.id} className="row" style={{ opacity: a.archived ? 0.6 : 1, flexWrap: 'wrap' }}>
              <span className="cat-icon">
                <AccountIcon type={a.type} />
              </span>
              <div className="row-main">
                <div className="row-title">
                  {a.name} {a.archived && <span className="badge">Archived</span>}
                </div>
                <div className="row-meta">
                  {ACCOUNT_TYPE_LABELS[a.type]}
                  {a.institution ? ` · ${a.institution}` : ''}
                  {a.last4 ? ` · •••• ${a.last4}` : ''} · {a.provider === 'csv' ? 'CSV import' : 'Manual'} · added by {a.ownerName.split(' ')[0]}
                </div>
              </div>
              <VisibilityBadge visibility={a.visibility} />
              <span className="row-amount" style={{ minWidth: 110 }}>
                {money(a.balanceCents, currency)}
              </span>
              {canManage(a) && (
                <div className="cluster">
                  <Button size="sm" variant="ghost" onClick={() => setBalanceFor(a)}>
                    Update balance
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={a.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                    aria-label={a.archived ? `Restore ${a.name}` : `Archive ${a.name}`}
                    onClick={async () => {
                      await api.patch(`${base}/accounts/${a.id}`, { archived: !a.archived });
                      invalidate();
                      toast.success(a.archived ? 'Account restored' : 'Account archived — its history is kept');
                    }}
                  />
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`Delete ${a.name}`} onClick={() => setDeleting(a)} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={adding} onClose={() => setAdding(false)} title="Add account">
        <AccountForm onDone={() => setAdding(false)} />
      </Dialog>
      {balanceFor && <BalanceDialog account={balanceFor} onClose={() => setBalanceFor(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name}?`}
        body="This permanently deletes the account and every entry in it, for everyone. To keep the history, archive it instead."
        confirmLabel="Delete permanently"
        danger
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          try {
            await api.delete(`${base}/accounts/${deleting!.id}`, { confirm: true });
            invalidate();
            toast.success('Account deleted');
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed');
          }
          setDeleting(null);
        }}
      />
    </section>
  );
}

function BalanceDialog({ account, onClose }: { account: AccountDTO; onClose: () => void }) {
  const { base, currency } = useHousehold();
  const invalidate = useInvalidate();
  const toast = useToast();
  const debt = account.type === 'credit_card' || account.type === 'loan';
  const [value, setValue] = useState<number | null>(Math.abs(account.balanceCents));
  const [date, setDate] = useState(localToday());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Update ${account.name}`}
      footer={
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={value == null}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await api.post<{ adjusted: boolean }>(`${base}/accounts/${account.id}/balance`, { balanceCents: debt ? -(value ?? 0) : value, date, note: 'Balance update' });
                toast.success(r.adjusted ? 'Balance updated — recorded as an adjustment in the ledger' : 'Balance already matches');
                invalidate();
                onClose();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="form-grid">
        <FormError error={error} />
        <p className="small muted">
          Currently {money(account.balanceCents, currency)}. The difference is recorded as a “balance update” entry so the history stays complete — useful for investment statements or correcting drift.
        </p>
        <div className="form-row">
          <Field label={debt ? 'Amount owed' : 'Balance'}>
            <MoneyInput value={value} onChange={setValue} allowNegative={!debt} data-autofocus />
          </Field>
          <Field label="As of">
            <Input type="date" value={date} max={localToday()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

// ============================================================ categories
function Categories() {
  const { base, can } = useHousehold();
  const categories = useCategories();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [group, setGroup] = useState<CategoryGroup>('living');
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const manage = can('categories.manage');
  return (
    <div className="grid-main-side">
      <section className="card" aria-labelledby="cat-title">
        <div className="card-head">
          <h2 id="cat-title">Categories</h2>
        </div>
        {categories.isLoading ? (
          <div className="card-body">
            <Skeleton h={200} />
          </div>
        ) : (
          CATEGORY_GROUPS.map((g) => (
            <div key={g}>
              <div className="day-head">{CATEGORY_GROUP_LABELS[g]}</div>
              <ul className="list">
                {(categories.data ?? [])
                  .filter((c) => c.group === g)
                  .map((c) => (
                    <li key={c.id} className="row" style={{ opacity: c.archived ? 0.55 : 1, minHeight: 48 }}>
                      <span className="cat-icon">
                        <CategoryIcon name={c.name} />
                      </span>
                      {editing?.id === c.id ? (
                        <form
                          className="row-main cluster"
                          style={{ flexWrap: 'nowrap' }}
                          onSubmit={async (e) => {
                            e.preventDefault();
                            try {
                              await api.patch(`${base}/categories/${c.id}`, { name: editing.name });
                              invalidate();
                              setEditing(null);
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : 'Failed');
                            }
                          }}
                        >
                          <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus aria-label="Category name" />
                          <Button size="sm" type="submit" variant="primary">
                            Save
                          </Button>
                        </form>
                      ) : (
                        <div className="row-main row-title">
                          {c.name} {c.archived && <span className="badge">Archived</span>}
                        </div>
                      )}
                      {manage && editing?.id !== c.id && (
                        <div className="cluster">
                          <Button size="sm" variant="ghost" icon={<Pencil size={14} />} aria-label={`Rename ${c.name}`} onClick={() => setEditing({ id: c.id, name: c.name })} />
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={c.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                            aria-label={c.archived ? `Restore ${c.name}` : `Archive ${c.name}`}
                            onClick={async () => {
                              await api.patch(`${base}/categories/${c.id}`, { archived: !c.archived });
                              invalidate();
                            }}
                          />
                        </div>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          ))
        )}
      </section>
      {manage && (
        <section className="card card-pad" aria-labelledby="newcat-title">
          <h2 id="newcat-title" style={{ fontSize: 'var(--text-base)', marginBottom: 12 }}>
            New category
          </h2>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                await api.post(`${base}/categories`, { name, group });
                setName('');
                invalidate();
                toast.success('Category added');
              } catch (err) {
                setError(err);
              }
            }}
          >
            <FormError error={error instanceof ApiError && !error.details ? error : null} />
            <Field label="Name" error={error instanceof ApiError ? error.field('name') : undefined}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            </Field>
            <Field label="Group">
              <Select value={group} onChange={(e) => setGroup(e.target.value as CategoryGroup)}>
                {CATEGORY_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {CATEGORY_GROUP_LABELS[g]}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="primary">
              Add category
            </Button>
            <p className="xs muted">Archived categories keep their history but disappear from pickers.</p>
          </form>
        </section>
      )}
    </div>
  );
}

// ============================================================ rules
function describeRule(r: RuleDTO, names: { cat: (id: string) => string; goal: (id: string) => string }, currency: string) {
  const c = r.conditions as Record<string, unknown>;
  const a = r.actions as Record<string, unknown>;
  const when: string[] = [];
  if (c.type) when.push(c.type === 'income' ? 'income' : 'spending');
  if (c.descriptionContains) when.push(`description contains “${c.descriptionContains}”`);
  if (c.merchantContains) when.push(`merchant contains “${c.merchantContains}”`);
  if (c.tag) when.push(`tagged “${c.tag}”`);
  if (c.categoryId) when.push(`in ${names.cat(c.categoryId as string)}`);
  if (c.minAmountCents != null) when.push(`at least ${money(c.minAmountCents as number, currency)}`);
  if (c.maxAmountCents != null) when.push(`at most ${money(c.maxAmountCents as number, currency)}`);
  const then: string[] = [];
  if (a.setCategoryId) then.push(`categorise as ${names.cat(a.setCategoryId as string)}`);
  if (Array.isArray(a.addTags) && a.addTags.length) then.push(`tag ${a.addTags.map((t) => `“${t}”`).join(', ')}`);
  const g = a.allocateToGoal as { goalId: string; basisPoints: number } | undefined;
  if (g) then.push(`put ${g.basisPoints / 100}% toward ${names.goal(g.goalId)}`);
  return { when: when.join(', '), then: then.join(' and ') };
}

function Rules() {
  const { base, hid, can, currency } = useHousehold();
  const categories = useCategories();
  const goals = useGoals();
  const invalidate = useInvalidate();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['rules', hid], queryFn: () => api.get<{ rules: RuleDTO[] }>(`${base}/rules`).then((r) => r.rules) });
  const names = {
    cat: (id: string) => categories.data?.find((c) => c.id === id)?.name ?? 'a category',
    goal: (id: string) => goals.data?.find((g) => g.id === id)?.name ?? 'a goal',
  };
  return (
    <div className="grid-main-side">
      <section className="card" aria-labelledby="rules-title">
        <div className="card-head">
          <h2 id="rules-title">Automation rules</h2>
          {can('rules.manage') && (
            <Button size="sm" variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              New rule
            </Button>
          )}
        </div>
        {q.isLoading ? (
          <div className="card-body">
            <Skeleton h={100} />
          </div>
        ) : (q.data ?? []).length === 0 ? (
          <EmptyState icon={<Zap size={22} />} title="No rules yet">
            Rules categorise, tag and set money aside automatically when entries are added — for example, put 20% of every freelance payment toward a goal.
          </EmptyState>
        ) : (
          <ul className="list" style={{ marginTop: 8 }}>
            {q.data!.map((r) => {
              const d = describeRule(r, names, currency);
              return (
                <li key={r.id} className="row" style={{ alignItems: 'flex-start', opacity: r.enabled ? 1 : 0.6 }}>
                  <span className="cat-icon">
                    <Zap size={16} />
                  </span>
                  <div className="row-main stack-sm" style={{ gap: 2 }}>
                    <strong>{r.name}</strong>
                    <div className="small">
                      <span className="muted">When</span> {d.when || 'any entry'} <span className="muted">→</span> {d.then}
                    </div>
                    <div className="xs muted">
                      Applied {r.timesApplied} time{r.timesApplied === 1 ? '' : 's'}
                      {r.lastAppliedAt ? ` · last ${relativeTime(r.lastAppliedAt)}` : ''}
                    </div>
                  </div>
                  {can('rules.manage') && (
                    <div className="cluster">
                      <label className="check small">
                        <input
                          type="checkbox"
                          checked={r.enabled}
                          onChange={async (e) => {
                            await api.patch(`${base}/rules/${r.id}`, { enabled: e.target.checked });
                            invalidate();
                          }}
                        />
                        On
                      </label>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 size={14} />}
                        aria-label={`Delete rule ${r.name}`}
                        onClick={async () => {
                          await api.delete(`${base}/rules/${r.id}`);
                          invalidate();
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="card card-pad small stack-sm">
        <h2 style={{ fontSize: 'var(--text-base)' }}>How rules work</h2>
        <p className="muted">Rules run in order whenever an entry is added — by hand, from a bill, or by CSV import. A tag added by one rule can trigger the next.</p>
        <p className="muted">Rules never override a category someone chose themselves. Goal allocations only run for shared accounts.</p>
      </section>
      {creating && <RuleDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function RuleDialog({ onClose }: { onClose: () => void }) {
  const { base, currency } = useHousehold();
  const categories = useCategories();
  const goals = useGoals();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState<'' | 'income' | 'expense'>('income');
  const [desc, setDesc] = useState('');
  const [merchant, setMerchant] = useState('');
  const [tag, setTag] = useState('');
  const [minAmount, setMinAmount] = useState<number | null>(null);
  const [setCat, setSetCat] = useState('');
  const [addTag, setAddTag] = useState('');
  const [goalId, setGoalId] = useState('');
  const [percent, setPercent] = useState('20');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  void currency;
  return (
    <Dialog
      open
      onClose={onClose}
      title="New automation rule"
      footer={
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const conditions = Object.fromEntries(
                Object.entries({ type: type || undefined, descriptionContains: desc || undefined, merchantContains: merchant || undefined, tag: tag || undefined, minAmountCents: minAmount ?? undefined }).filter(([, v]) => v !== undefined),
              );
              const pctNum = Math.round(Number(percent) * 100);
              const actions = Object.fromEntries(
                Object.entries({
                  setCategoryId: setCat || undefined,
                  addTags: addTag ? addTag.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
                  allocateToGoal: goalId && pctNum > 0 ? { goalId, basisPoints: pctNum } : undefined,
                }).filter(([, v]) => v !== undefined),
              );
              try {
                await api.post(`${base}/rules`, { name, conditions, actions });
                toast.success('Rule created — it applies to new entries from now on');
                invalidate();
                onClose();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create rule
          </Button>
        </div>
      }
    >
      <div className="form-grid">
        <FormError error={error instanceof ApiError ? new ApiError(400, '', Object.values(error.details ?? {})[0]?.[0] ?? error.message) : error} />
        <Field label="Rule name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Freelance → 20% to savings" data-autofocus maxLength={60} />
        </Field>
        <h3 className="eyebrow">When an entry…</h3>
        <div className="form-row">
          <Field label="Is">
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="">Income or spending</option>
              <option value="income">Income</option>
              <option value="expense">Spending</option>
            </Select>
          </Field>
          <Field label="Is tagged" optional>
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. freelance" />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Description contains" optional>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
          <Field label="Merchant contains" optional>
            <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} />
          </Field>
        </div>
        <Field label="Amount at least" optional>
          <MoneyInput value={minAmount} onChange={setMinAmount} />
        </Field>
        <h3 className="eyebrow">Then…</h3>
        <div className="form-row">
          <Field label="Set category" optional>
            <Select value={setCat} onChange={(e) => setSetCat(e.target.value)}>
              <option value="">Don’t change</option>
              {(categories.data ?? [])
                .filter((c) => !c.archived && (!type || (type === 'income') === (c.group === 'income')))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Add tags" optional>
            <Input value={addTag} onChange={(e) => setAddTag(e.target.value)} placeholder="comma-separated" />
          </Field>
        </div>
        <div className="form-row">
          <Field label="Set aside toward goal" optional>
            <Select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">None</option>
              {(goals.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Percent of the amount">
            <Input type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} disabled={!goalId} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

// ============================================================ settings
function HouseholdSettings() {
  const { base, household, can } = useHousehold();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(household.name);
  const [currency, setCurrency] = useState(household.currency);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!can('household.update'))
    return (
      <div className="card card-pad small muted">
        Only owners and admins can change household settings.
      </div>
    );
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <section className="card card-pad stack">
        <h2 style={{ fontSize: 'var(--text-base)' }}>Household details</h2>
        <FormError error={error} />
        <div className="form-row">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Currency" hint="Changing it relabels amounts; it does not convert them.">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="form-actions">
          <Button
            variant="primary"
            onClick={async () => {
              setError(null);
              try {
                await api.patch(base, { name, currency });
                await qc.invalidateQueries();
                toast.success('Household updated');
              } catch (e) {
                setError(e);
              }
            }}
          >
            Save
          </Button>
        </div>
      </section>
      {can('household.delete') && (
        <section className="card card-pad stack danger-zone">
          <h2 style={{ fontSize: 'var(--text-base)', color: 'var(--crit-600)' }}>Delete household</h2>
          <p className="small muted">Permanently deletes every account, entry, budget, goal and comment in {household.name} for all members. This cannot be undone — export your data first from Settings.</p>
          <Field label={`Type “${household.name}” to confirm`}>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button
            variant="danger-solid"
            disabled={confirm !== household.name}
            loading={deleting}
            onClick={async () => {
              setDeleting(true);
              try {
                await api.delete(base, { confirmName: confirm });
                await qc.invalidateQueries({ queryKey: meKey });
                navigate('/');
              } catch (e) {
                setError(e);
              } finally {
                setDeleting(false);
              }
            }}
          >
            Delete household
          </Button>
        </section>
      )}
    </div>
  );
}
