import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Archive, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus, SkipForward, Target, Trash2 } from 'lucide-react';
import {
  addMonths,
  CATEGORY_GROUP_LABELS,
  EXPENSE_GROUPS,
  FREQUENCY_LABELS,
  monthLabel,
  type BudgetMonthDTO,
  type GoalDTO,
  type RecurringDTO,
} from '@familypulse/shared';
import { api } from '../../lib/api';
import { useHousehold } from '../../lib/session';
import { useCategories, useGoals, useInvalidate, useRecurring } from '../../lib/queries';
import { useToast } from '../../lib/toast';
import { localToday, money, pct, shortDate } from '../../lib/format';
import { Button, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, FormError, Meter, MoneyInput, Segmented, Skeleton, StatusBadge, Tabs } from '../../components/ui';
import { ColumnChart, Legend, ProgressRing, TableView } from '../../components/charts';
import { CategoryIcon, GoalIcon } from '../../components/icons';
import { GoalForm, RecurringForm } from '../../features/forms';

export default function BudgetPage() {
  const { can } = useHousehold();
  const [month, setMonth] = useState(localToday().slice(0, 7));
  const [editing, setEditing] = useState(false);
  const thisMonth = localToday().slice(0, 7);
  const location = useLocation();
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash]);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Budget</h1>
          <p>Shared spending limits, savings goals and the bills that keep coming.</p>
        </div>
        <div className="cluster">
          <div className="month-switch">
            <button className="icon-btn icon-btn-sm" aria-label="Previous month" onClick={() => setMonth(addMonths(`${month}-01`, -1).slice(0, 7))}>
              <ChevronLeft size={18} />
            </button>
            <span className="num" style={{ minWidth: 92, textAlign: 'center', fontWeight: 600 }}>
              {monthLabel(month)}
            </span>
            <button className="icon-btn icon-btn-sm" aria-label="Next month" disabled={month >= addMonths(`${thisMonth}-01`, 1).slice(0, 7)} onClick={() => setMonth(addMonths(`${month}-01`, 1).slice(0, 7))}>
              <ChevronRight size={18} />
            </button>
          </div>
          {can('budgets.manage') && (
            <Button variant="primary" icon={<Pencil size={16} />} onClick={() => setEditing(true)}>
              Set budget
            </Button>
          )}
        </div>
      </div>
      <div className="grid-main-side">
        <div className="stack" style={{ gap: 20 }}>
          <BudgetMonth month={month} onEdit={() => setEditing(true)} />
          <Overview />
        </div>
        <div className="stack" style={{ gap: 20 }}>
          <Goals />
          <Bills />
        </div>
      </div>
      {editing && <BudgetEditor month={month} onClose={() => setEditing(false)} />}
    </div>
  );
}

const GROUP_COLOR: Record<string, string> = { living: 'var(--viz-living)', entertainment: 'var(--viz-entertainment)', unexpected: 'var(--viz-unexpected)' };

function BudgetMonth({ month, onEdit }: { month: string; onEdit: () => void }) {
  const { base, hid, currency, can } = useHousehold();
  const [open, setOpen] = useState<Record<string, boolean>>({ living: true });
  const q = useQuery({ queryKey: ['budget', hid, month], queryFn: () => api.get<{ budget: BudgetMonthDTO }>(`${base}/budgets/${month}`).then((r) => r.budget), placeholderData: (p) => p });
  if (q.isLoading) return <div className="card card-pad"><Skeleton h={220} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const b = q.data!;
  const isCurrent = month === localToday().slice(0, 7);
  if (!b.planMonth)
    return (
      <div className="card">
        <EmptyState icon={<Target size={22} />} title="No budget set yet" action={can('budgets.manage') ? <Button variant="primary" onClick={onEdit}>Set a monthly budget</Button> : undefined}>
          Pick limits for the categories you want to watch. They carry forward each month until you change them.
        </EmptyState>
      </div>
    );
  const left = b.totalBudgetCents - b.totalSpentCents;
  return (
    <section className={`card ${q.isFetching ? 'refetching' : ''}`} aria-labelledby="bm-title">
      <div className="card-body stack" style={{ gap: 14 }}>
        <div className="spread" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <h2 id="bm-title" className="eyebrow">
              {monthLabel(month, 'long')} · spent of budget
            </h2>
            <div className="hero-figure" style={{ fontSize: '2rem', marginTop: 4 }}>
              {money(b.totalSpentCents, currency, { noCents: true })}
              <span className="muted" style={{ fontSize: '1rem', fontWeight: 500 }}>
                {' '}
                / {money(b.totalBudgetCents, currency, { noCents: true })}
              </span>
            </div>
          </div>
          <div className="small muted" style={{ textAlign: 'right' }}>
            <div>
              <span className="num" style={{ color: left < 0 ? 'var(--crit-600)' : 'var(--ink-900)', fontWeight: 600 }}>
                {money(Math.abs(left), currency, { noCents: true })}
              </span>{' '}
              {left < 0 ? 'over' : 'left'}
            </div>
            <div>
              Income {money(b.actualIncomeCents, currency, { noCents: true })} of {money(b.expectedIncomeCents, currency, { noCents: true })} expected
            </div>
          </div>
        </div>
        <Meter valueBp={b.totalBudgetCents ? Math.round((b.totalSpentCents / b.totalBudgetCents) * 10_000) : 0} paceBp={isCurrent ? b.monthElapsedBp : undefined} status={left < 0 ? 'over' : 'ok'} label="Total budget used" />
        {b.planMonth !== month && <p className="xs muted">Using the plan set in {monthLabel(b.planMonth, 'long')} — plans carry forward until changed.</p>}
      </div>
      <hr className="rule rule-green" />
      <ul className="list">
        {b.groups.map((g) => {
          const isOpen = open[g.group];
          return (
            <li key={g.group}>
              <button className="row row-button" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [g.group]: !o[g.group] }))}>
                <span className="swatch" style={{ background: GROUP_COLOR[g.group], width: 12, height: 12 }} aria-hidden />
                <div className="row-main stack-sm" style={{ gap: 6 }}>
                  <div className="spread">
                    <span style={{ fontWeight: 600 }}>{CATEGORY_GROUP_LABELS[g.group]}</span>
                    <span className="small num">
                      {money(g.spentCents, currency, { noCents: true })} <span className="muted">/ {money(g.budgetCents, currency, { noCents: true })}</span>
                    </span>
                  </div>
                  <Meter valueBp={g.usedBp} paceBp={isCurrent ? b.monthElapsedBp : undefined} status={g.usedBp > 10_000 ? 'over' : 'ok'} label={`${CATEGORY_GROUP_LABELS[g.group]} budget used`} />
                </div>
                <ChevronDown size={18} className="muted" style={{ transform: isOpen ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }} />
              </button>
              {isOpen && (
                <ul className="list budget-lines">
                  {g.lines
                    .filter((l) => l.budgetCents > 0 || l.spentCents > 0)
                    .map((l) => (
                      <li key={l.categoryId} className="row" style={{ alignItems: 'flex-start' }}>
                        <span className="cat-icon">
                          <CategoryIcon name={l.categoryName} />
                        </span>
                        <div className="row-main stack-sm" style={{ gap: 6 }}>
                          <div className="spread" style={{ flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 500 }}>
                              {l.categoryName} {l.billCovered && <span className="badge" title="Paid by a scheduled bill">Bill</span>}
                            </span>
                            <span className="small num">
                              {money(l.spentCents, currency)}
                              {l.budgetCents > 0 && <span className="muted"> of {money(l.budgetCents, currency, { noCents: true })}</span>}
                            </span>
                          </div>
                          {l.budgetCents > 0 && <Meter valueBp={l.usedBp} status={l.status} paceBp={isCurrent && !l.billCovered ? b.monthElapsedBp : undefined} label={`${l.categoryName} budget used`} />}
                          <div className="spread xs">
                            <StatusBadge status={l.status} />
                            {l.budgetCents > 0 && (
                              <span className="muted num">{l.remainingCents >= 0 ? `${money(l.remainingCents, currency)} left` : `${money(-l.remainingCents, currency)} over`}</span>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  {g.lines.every((l) => l.budgetCents === 0 && l.spentCents === 0) && <li className="row small muted">Nothing budgeted or spent here.</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Overview() {
  const { base, hid, currency } = useHousehold();
  const [months, setMonths] = useState<'6' | '12'>('6');
  const q = useQuery({
    queryKey: ['overview', hid, months],
    queryFn: () => api.get<{ series: { month: string; label: string; incomeCents: number; spendCents: number }[] }>(`${base}/budgets/overview?months=${months}`).then((r) => r.series),
    placeholderData: (p) => p,
  });
  return (
    <section className="card" aria-labelledby="ov-title">
      <div className="card-head">
        <h2 id="ov-title">Income vs. spending</h2>
        <Segmented
          label="Overview period"
          value={months}
          onChange={setMonths}
          options={[
            { value: '6', label: '6M' },
            { value: '12', label: '1Y' },
          ]}
        />
      </div>
      <div className="card-body stack-sm">
        {q.isLoading ? (
          <Skeleton h={220} />
        ) : q.isError ? (
          <ErrorState error={q.error} />
        ) : (
          <>
            <Legend
              items={[
                { label: 'Income', color: 'var(--viz-income)', kind: 'swatch' },
                { label: 'Spending', color: 'var(--viz-spend)', kind: 'swatch' },
              ]}
            />
            <div className={q.isFetching ? 'refetching' : ''}>
              <ColumnChart
                labels={q.data!.map((s) => s.label.split(' ')[0])}
                currency={currency}
                ariaLabel="Monthly income and spending, shared accounts"
                series={[
                  { key: 'in', label: 'Income', color: 'var(--viz-income)', values: q.data!.map((s) => s.incomeCents) },
                  { key: 'out', label: 'Spending', color: 'var(--viz-spend)', values: q.data!.map((s) => s.spendCents) },
                ]}
              />
            </div>
            <TableView caption="Monthly income and spending" columns={['Month', 'Income', 'Spending', 'Net']} rows={q.data!.map((s) => [s.label, money(s.incomeCents, currency), money(s.spendCents, currency), money(s.incomeCents - s.spendCents, currency, { signed: true })])} />
          </>
        )}
      </div>
    </section>
  );
}

function Goals() {
  const { base, currency, can } = useHousehold();
  const goals = useGoals();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [form, setForm] = useState<GoalDTO | 'new' | null>(null);
  const [contrib, setContrib] = useState<GoalDTO | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [withdraw, setWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <section className="card" id="goals" aria-labelledby="goals-h">
      <div className="card-head">
        <h2 id="goals-h">Saving goals</h2>
        {can('goals.manage') && (
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setForm('new')}>
            Add goal
          </Button>
        )}
      </div>
      {goals.isLoading ? (
        <div className="card-body">
          <Skeleton h={80} />
        </div>
      ) : (goals.data ?? []).length === 0 ? (
        <EmptyState icon={<Target size={22} />} title="No goals yet">
          A down payment, a college fund, an emergency cushion — FamilyPulse shows the monthly amount needed to get there.
        </EmptyState>
      ) : (
        <ul className="list" style={{ marginTop: 6 }}>
          {goals.data!.map((g) => (
            <li key={g.id} className="row" style={{ alignItems: 'flex-start' }}>
              <ProgressRing bp={g.progressBp} size={64} label={g.name} />
              <div className="row-main stack-sm" style={{ gap: 2 }}>
                <div className="cluster" style={{ gap: 6 }}>
                  <GoalIcon icon={g.icon} size={16} />
                  <strong className="truncate">{g.name}</strong>
                </div>
                <div className="small num">
                  {money(g.savedCents, currency, { noCents: true })} <span className="muted">of {money(g.targetCents, currency, { noCents: true })}</span>
                </div>
                <div className="xs muted">
                  {g.progressBp >= 10_000
                    ? 'Reached — well done.'
                    : g.targetDate
                      ? `By ${shortDate(g.targetDate, true)} · needs ${money(g.requiredMonthlyCents ?? 0, currency, { noCents: true })}/mo, planning ${money(g.plannedMonthlyCents, currency, { noCents: true })}`
                      : g.projectedCompletion
                        ? `At ${money(g.plannedMonthlyCents, currency, { noCents: true })}/mo you’ll get there around ${shortDate(g.projectedCompletion, true)}`
                        : 'Add a monthly amount to see when you’ll get there'}
                </div>
                {g.onTrack !== null && g.progressBp < 10_000 && (
                  <span className={`badge ${g.onTrack ? 'badge-good' : 'badge-warn'}`} style={{ justifySelf: 'start' }}>
                    {g.onTrack ? 'On track' : 'Behind schedule'}
                  </span>
                )}
                <div className="cluster" style={{ marginTop: 4 }}>
                  {can('goals.contribute') && (
                    <Button size="sm" onClick={() => { setContrib(g); setAmount(null); setWithdraw(false); setError(null); }}>
                      Add money
                    </Button>
                  )}
                  {can('goals.manage') && (
                    <>
                      <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => setForm(g)} aria-label={`Edit ${g.name}`} />
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Archive size={14} />}
                        aria-label={`Archive ${g.name}`}
                        onClick={async () => {
                          await api.patch(`${base}/goals/${g.id}`, { archived: true });
                          invalidate();
                          toast.success(`${g.name} archived`, {
                            label: 'Undo',
                            onClick: async () => {
                              await api.patch(`${base}/goals/${g.id}`, { archived: false });
                              invalidate();
                            },
                          });
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={form !== null} onClose={() => setForm(null)} title={form === 'new' ? 'New saving goal' : 'Edit goal'}>
        {form !== null && <GoalForm goal={form === 'new' ? undefined : form} onDone={() => setForm(null)} />}
      </Dialog>
      <Dialog
        open={contrib !== null}
        onClose={() => setContrib(null)}
        title={contrib ? `${withdraw ? 'Withdraw from' : 'Add to'} ${contrib.name}` : ''}
        footer={
          <div className="form-actions">
            <Button onClick={() => setContrib(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!amount}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await api.post(`${base}/goals/${contrib!.id}/contributions`, { amountCents: withdraw ? -amount! : amount, date: localToday() });
                  toast.success(withdraw ? 'Withdrawal recorded' : 'Contribution recorded');
                  invalidate();
                  setContrib(null);
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
          <Segmented
            label="Direction"
            value={withdraw ? 'out' : 'in'}
            onChange={(v) => setWithdraw(v === 'out')}
            options={[
              { value: 'in', label: 'Add money' },
              { value: 'out', label: 'Withdraw' },
            ]}
          />
          <Field label="Amount" hint="Goals are earmarks — move the money between accounts with a transfer if needed.">
            <MoneyInput value={amount} onChange={setAmount} data-autofocus />
          </Field>
        </div>
      </Dialog>
    </section>
  );
}

function Bills() {
  const { base, currency, can } = useHousehold();
  const items = useRecurring();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [tab, setTab] = useState<'bill' | 'income'>('bill');
  const [form, setForm] = useState<{ kind: 'bill' | 'income'; item?: RecurringDTO } | null>(null);
  const [del, setDel] = useState<RecurringDTO | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const list = (items.data ?? []).filter((r) => r.kind === tab && r.active);
  const total = list.reduce((s, r) => s + r.monthlyEquivalentCents, 0);
  const today = localToday();
  const act = async (r: RecurringDTO, action: 'pay' | 'skip') => {
    setBusy(r.id + action);
    try {
      await api.post(`${base}/recurring/${r.id}/${action}`, {});
      toast.success(action === 'pay' ? `${r.label} ${r.kind === 'income' ? 'received' : 'paid'} — added to the ledger` : `Skipped ${shortDate(r.nextDate)}`);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="card" id="bills" aria-labelledby="bills-h">
      <div className="card-head">
        <h2 id="bills-h" className="cluster" style={{ gap: 6 }}>
          <CalendarClock size={16} /> Recurring
        </h2>
        {can('recurring.manage') && (
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setForm({ kind: tab })}>
            Add {tab === 'bill' ? 'bill' : 'income'}
          </Button>
        )}
      </div>
      <div style={{ padding: '0 20px' }}>
        <Tabs
          label="Recurring type"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'bill', label: 'Bills' },
            { value: 'income', label: 'Income' },
          ]}
        />
      </div>
      {items.isLoading ? (
        <div className="card-body">
          <Skeleton h={80} />
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={<CalendarClock size={22} />} title={tab === 'bill' ? 'No bills yet' : 'No income streams yet'}>
          {tab === 'bill' ? 'Rent, utilities, insurance, subscriptions — add them once and get reminders before they’re due.' : 'Paychecks and other income make the forecast work.'}
        </EmptyState>
      ) : (
        <>
          <ul className="list">
            {list.map((r) => {
              const overdue = r.nextDate < today;
              return (
                <li key={r.id} className="row" style={{ alignItems: 'flex-start' }}>
                  <span className="cat-icon">
                    <CategoryIcon name={r.categoryName ?? (r.kind === 'income' ? 'salary' : null)} />
                  </span>
                  <div className="row-main stack-sm" style={{ gap: 2 }}>
                    <div className="spread">
                      <span className="row-title">{r.label}</span>
                      <span className="row-amount">{money(r.amountCents, currency)}</span>
                    </div>
                    <div className="row-meta" style={overdue ? { color: 'var(--crit-600)' } : undefined}>
                      {FREQUENCY_LABELS[r.frequency]} · {overdue ? 'was due' : 'next'} {shortDate(r.nextDate)}
                      {r.autopay ? ' · autopay' : ''}
                      {r.minAmountCents != null ? ` · at least ${money(r.minAmountCents, currency, { noCents: true })}` : ''}
                    </div>
                    <div className="cluster" style={{ marginTop: 4 }}>
                      {can('recurring.markPaid') && r.nextDate <= addMonths(today, 1) && (
                        <Button size="sm" loading={busy === r.id + 'pay'} onClick={() => act(r, 'pay')} disabled={!r.accountId} title={r.accountId ? undefined : 'Set an account on this item first'}>
                          {r.kind === 'income' ? 'Received' : 'Mark paid'}
                        </Button>
                      )}
                      {can('recurring.markPaid') && (
                        <Button size="sm" variant="ghost" icon={<SkipForward size={14} />} loading={busy === r.id + 'skip'} onClick={() => act(r, 'skip')}>
                          Skip
                        </Button>
                      )}
                      {can('recurring.manage') && (
                        <>
                          <Button size="sm" variant="ghost" icon={<Pencil size={14} />} aria-label={`Edit ${r.label}`} onClick={() => setForm({ kind: r.kind, item: r })} />
                          <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`Delete ${r.label}`} onClick={() => setDel(r)} />
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="card-foot">
            <span className="muted">≈ per month</span>
            <strong className="num">{money(total, currency)}</strong>
          </div>
        </>
      )}
      <Dialog open={form !== null} onClose={() => setForm(null)} title={form?.item ? `Edit ${form.item.label}` : form?.kind === 'income' ? 'Add income' : 'Add a bill'}>
        {form && <RecurringForm kind={form.kind} item={form.item} onDone={() => setForm(null)} />}
      </Dialog>
      <ConfirmDialog
        open={del !== null}
        title={`Remove ${del?.label}?`}
        body="Past ledger entries stay. Future reminders and forecast amounts for this item stop."
        confirmLabel="Remove"
        danger
        onClose={() => setDel(null)}
        onConfirm={async () => {
          await api.delete(`${base}/recurring/${del!.id}`);
          invalidate();
          setDel(null);
        }}
      />
    </section>
  );
}

function BudgetEditor({ month, onClose }: { month: string; onClose: () => void }) {
  const { base, hid, currency } = useHousehold();
  const categories = useCategories();
  const invalidate = useInvalidate();
  const toast = useToast();
  const current = useQuery({ queryKey: ['budget', hid, month], queryFn: () => api.get<{ budget: BudgetMonthDTO }>(`${base}/budgets/${month}`).then((r) => r.budget) });
  const [amounts, setAmounts] = useState<Record<string, number | null> | null>(null);
  const [income, setIncome] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (current.data && amounts === null) {
      const init: Record<string, number | null> = {};
      for (const g of current.data.groups) for (const l of g.lines) init[l.categoryId] = l.budgetCents || null;
      setAmounts(init);
      setIncome(current.data.expectedIncomeCents || null);
    }
  }, [current.data, amounts]);
  const total = Object.values(amounts ?? {}).reduce<number>((s, v) => s + (v ?? 0), 0);
  const ownPlan = current.data?.planMonth === month;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.put(`${base}/budgets`, {
        month,
        expectedIncomeCents: income ?? 0,
        items: Object.entries(amounts ?? {})
          .filter(([, v]) => v && v > 0)
          .map(([categoryId, amountCents]) => ({ categoryId, amountCents })),
      });
      toast.success(`Budget saved from ${monthLabel(month, 'long')} onward`);
      invalidate();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={`Budget from ${monthLabel(month, 'long')}`}
      footer={
        <div className="spread" style={{ flexWrap: 'wrap' }}>
          {ownPlan ? (
            <Button variant="danger" onClick={() => setConfirmReset(true)}>
              Reset this month
            </Button>
          ) : (
            <span />
          )}
          <div className="form-actions">
            <span className="small muted num" style={{ alignSelf: 'center' }}>
              {money(total, currency, { noCents: true })} / month{income ? ` · ${pct(Math.round((total / income) * 10_000))} of income` : ''}
            </span>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Confirm
            </Button>
          </div>
        </div>
      }
    >
      {!amounts || categories.isLoading ? (
        <Skeleton h={300} />
      ) : (
        <div className="stack">
          <FormError error={error} />
          <p className="small muted">The plan applies to {monthLabel(month, 'long')} and every later month until you set a new one. Leave a category empty for no limit.</p>
          <Field label="Expected monthly income">
            <MoneyInput value={income} onChange={setIncome} />
          </Field>
          {EXPENSE_GROUPS.map((g) => (
            <div key={g} className="stack-sm">
              <h3 className="eyebrow">{CATEGORY_GROUP_LABELS[g]}</h3>
              <div className="budget-edit-grid">
                {(categories.data ?? [])
                  .filter((c) => c.group === g && !c.archived)
                  .map((c) => (
                    <label key={c.id} className="budget-edit-row">
                      <CategoryIcon name={c.name} />
                      <span className="grow truncate">{c.name}</span>
                      <span style={{ width: 130 }}>
                        <MoneyInput value={amounts[c.id] ?? null} onChange={(v) => setAmounts((a) => ({ ...a!, [c.id]: v }))} aria-label={`${c.name} monthly limit`} placeholder="—" />
                      </span>
                    </label>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={confirmReset}
        title={`Reset the ${monthLabel(month, 'long')} budget?`}
        body="This month’s plan is removed and the previous plan (if any) applies again. Your ledger is not affected."
        confirmLabel="Reset"
        danger
        onClose={() => setConfirmReset(false)}
        onConfirm={async () => {
          await api.delete(`${base}/budgets/${month}`);
          toast.success('Budget reset');
          invalidate();
          setConfirmReset(false);
          onClose();
        }}
      />
    </Dialog>
  );
}
