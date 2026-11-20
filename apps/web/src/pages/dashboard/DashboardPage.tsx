import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Info,
  LineChart as LineIcon,
  Minus,
  Plus,
  Wallet,
} from 'lucide-react';
import type { DashboardDTO, Scope, SmartTipDTO, UpcomingBillDTO } from '@familypulse/shared/client';
import { api, qs } from '../../lib/api';
import { useHousehold } from '../../lib/session';
import { useInvalidate } from '../../lib/queries';
import { useToast } from '../../lib/toast';
import { money, pct, relativeTime, shortDate } from '../../lib/format';
import { Avatar, Button, EmptyState, ErrorState, Meter, Segmented, Skeleton } from '../../components/ui';
import { LineChart, ProgressRing, TableView } from '../../components/charts';
import { AccountIcon, GoalIcon } from '../../components/icons';
import { useEntryDialog } from '../../features/entry/EntryDialog';

type Range = '1M' | '6M' | '1Y' | 'ALL';

export function ScopeToggle() {
  const { scope, setScope } = useHousehold();
  return (
    <Segmented<Scope>
      label="View"
      value={scope}
      onChange={setScope}
      options={[
        { value: 'household', label: 'Household' },
        { value: 'personal', label: 'Personal' },
      ]}
    />
  );
}

function Delta({ now, prev, upIsGood }: { now: number; prev: number; upIsGood: boolean }) {
  if (prev === 0 && now === 0) return <span className="delta flat">No activity</span>;
  if (prev === 0) return <span className="delta flat">none the week before</span>;
  const changeBp = Math.round(((now - prev) / Math.abs(prev)) * 10_000);
  const up = changeBp > 0;
  const cls = changeBp === 0 ? 'flat' : up ? (upIsGood ? 'up-good' : 'up-bad') : upIsGood ? 'down-bad' : 'down-good';
  const Icon = changeBp === 0 ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`delta ${cls}`}>
      <Icon size={14} aria-hidden /> {pct(Math.abs(changeBp))} vs. prior week
    </span>
  );
}

const TIP_ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Info } as const;
const TIP_COLOR = { critical: 'var(--crit-600)', warning: 'var(--warn-600)', info: 'var(--signal-600)' } as const;

export function TipList({ tips }: { tips: SmartTipDTO[] }) {
  if (!tips.length)
    return (
      <p className="small muted" style={{ padding: '0 20px 20px' }}>
        Nothing needs your attention right now.
      </p>
    );
  return (
    <ul className="list">
      {tips.map((t) => {
        const Icon = TIP_ICON[t.severity];
        return (
          <li key={t.id} className="row" style={{ alignItems: 'flex-start' }}>
            <Icon size={18} style={{ color: TIP_COLOR[t.severity], flex: 'none', marginTop: 2 }} aria-label={t.severity} />
            <div className="row-main stack-sm" style={{ gap: 2 }}>
              <div style={{ fontWeight: 500 }}>{t.title}</div>
              <div className="small muted">{t.detail}</div>
              <div className="cluster small">
                {t.link && <Link to={t.link}>Review</Link>}
                <details className="details">
                  <summary>How we worked this out</summary>
                  <div className="xs muted" style={{ marginTop: 4 }}>
                    {t.basis}
                  </div>
                </details>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function BillRow({ b, currency, onPaid }: { b: UpcomingBillDTO; currency: string; onPaid?: () => void }) {
  const { base, can } = useHousehold();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const overdue = b.daysUntil < 0;
  return (
    <li className="row">
      <div
        className="cat-icon num"
        style={{ flexDirection: 'column', width: 44, height: 44, gap: 0, lineHeight: 1.1, background: overdue ? 'var(--crit-100)' : undefined }}
        aria-hidden
      >
        <span className="xs muted">{shortDate(b.dueDate).split(' ')[0]}</span>
        <strong>{shortDate(b.dueDate).split(' ')[1]}</strong>
      </div>
      <div className="row-main">
        <div className="row-title">{b.label}</div>
        <div className="row-meta" style={overdue ? { color: 'var(--crit-600)' } : undefined}>
          {overdue ? `Overdue by ${-b.daysUntil} day${b.daysUntil === -1 ? '' : 's'}` : b.daysUntil === 0 ? 'Due today' : `In ${b.daysUntil} day${b.daysUntil === 1 ? '' : 's'}`}
          {b.autopay ? ' · Autopay' : ''}
        </div>
      </div>
      <span className="row-amount">{money(b.amountCents, currency)}</span>
      {can('recurring.markPaid') && b.daysUntil <= 7 && (
        <Button
          size="sm"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.post(`${base}/recurring/${b.recurringId}/pay`, {});
              toast.success(`${b.label} marked paid and added to the ledger`);
              onPaid?.();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Could not mark paid');
            } finally {
              setBusy(false);
            }
          }}
        >
          Paid
        </Button>
      )}
    </li>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid-main-side">
      <div className="stack">
        <div className="card card-pad stack">
          <Skeleton h={14} w={120} />
          <Skeleton h={40} w={220} />
          <Skeleton h={200} />
        </div>
      </div>
      <div className="card card-pad stack">
        <Skeleton h={14} w={100} />
        <Skeleton h={48} />
        <Skeleton h={48} />
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { base, hid, scope, me, household, can, currency } = useHousehold();
  const [range, setRange] = useState<Range>('6M');
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const invalidate = useInvalidate();
  const entry = useEntryDialog();
  const q = useQuery({
    queryKey: ['dashboard', hid, scope, range],
    queryFn: () => api.get<DashboardDTO>(`${base}/dashboard${qs({ scope, range })}`),
    placeholderData: (prev) => prev,
  });
  const firstName = me.user.name.split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            {greeting}, {firstName}
          </h1>
          <p>{scope === 'household' ? `${household.name} · shared accounts` : 'Your private accounts only'}</p>
        </div>
        <ScopeToggle />
      </div>

      {!household.onboardedAt && can('household.update') && (
        <div className="callout" style={{ marginBottom: 20 }}>
          <Info size={18} />
          <div className="grow">
            <strong>Finish setting up {household.name}.</strong> Add income, spending limits and goals so forecasts and tips work for you.
          </div>
          <Link to="/onboarding" className="btn btn-sm btn-primary">
            Continue setup
          </Link>
        </div>
      )}

      {q.isLoading && <DashboardSkeleton />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && <DashboardBody d={q.data} range={range} setRange={setRange} openGroup={openGroup} setOpenGroup={setOpenGroup} refetching={q.isFetching} onChange={invalidate} onAdd={() => entry.open({})} canAdd={can('transactions.create')} currency={currency} />}
    </div>
  );
}

function DashboardBody({
  d,
  range,
  setRange,
  openGroup,
  setOpenGroup,
  refetching,
  onChange,
  onAdd,
  canAdd,
  currency,
}: {
  d: DashboardDTO;
  range: Range;
  setRange: (r: Range) => void;
  openGroup: string | null;
  setOpenGroup: (g: string | null) => void;
  refetching: boolean;
  onChange: () => void;
  onAdd: () => void;
  canAdd: boolean;
  currency: string;
}) {
  const noAccounts = d.accountGroups.length === 0;
  const historyLabels = d.history.map((p) => shortDate(p.date));
  return (
    <div className={`grid-main-side ${refetching ? '' : ''}`}>
      <div className="stack" style={{ gap: 20 }}>
        {/* Net worth */}
        <section className="card card-chamfer" aria-labelledby="nw-title">
          <div className="card-body stack" style={{ gap: 12 }}>
            <div className="spread" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div>
                <h2 id="nw-title" className="eyebrow">
                  Net worth · {d.scope === 'household' ? 'Household' : 'Personal'}
                </h2>
                <div className="hero-figure" style={{ marginTop: 4 }}>
                  {money(d.netWorth.currentCents, currency)}
                </div>
                <div className="small muted" style={{ marginTop: 2 }}>
                  <span className={`num ${d.netWorth.change30dCents >= 0 ? 'amount-in' : ''}`} style={d.netWorth.change30dCents < 0 ? { color: 'var(--crit-600)' } : undefined}>
                    {money(d.netWorth.change30dCents, currency, { signed: true })}
                  </span>{' '}
                  in the last 30 days · {money(d.netWorth.assetsCents, currency, { noCents: true })} assets, {money(d.netWorth.liabilitiesCents, currency, { noCents: true })} owed
                </div>
              </div>
              <Segmented<Range>
                label="Net worth period"
                value={range}
                onChange={setRange}
                options={[
                  { value: '1M', label: '1M' },
                  { value: '6M', label: '6M' },
                  { value: '1Y', label: '1Y' },
                  { value: 'ALL', label: 'All' },
                ]}
              />
            </div>
            <hr className="rule rule-green" />
            {noAccounts ? (
              <EmptyState icon={<Wallet size={22} />} title="No accounts in this view yet" action={<Link className="btn btn-sm btn-primary" to="/household?tab=accounts">Add an account</Link>}>
                {d.scope === 'personal' ? 'Private accounts you add appear here — only you can see them.' : 'Add the accounts your household shares to see net worth over time.'}
              </EmptyState>
            ) : (
              <div className={refetching ? 'refetching' : ''}>
                <LineChart
                  labels={historyLabels}
                  series={[{ key: 'nw', label: 'Net worth', color: 'var(--viz-income)', values: d.history.map((p) => p.netWorthCents), area: true }]}
                  currency={currency}
                  ariaLabel={`Net worth over ${range}, from ${money(d.history[0]?.netWorthCents ?? 0, currency)} to ${money(d.netWorth.currentCents, currency)}`}
                  tooltipExtra={(i) => (
                    <div className="xs muted" style={{ marginTop: 4 }}>
                      {money(d.history[i].assetsCents, currency, { noCents: true })} assets · {money(d.history[i].liabilitiesCents, currency, { noCents: true })} owed
                    </div>
                  )}
                />
                <TableView
                  caption="Net worth history"
                  columns={['Date', 'Assets', 'Owed', 'Net worth']}
                  rows={d.history.map((p) => [shortDate(p.date, true), money(p.assetsCents, currency), money(p.liabilitiesCents, currency), money(p.netWorthCents, currency)])}
                />
              </div>
            )}
          </div>
          <hr className="rule rule-blue" />
          <div className="grid-4-tiles">
            <div className="stat">
              <span className="stat-label">Income · last 7 days</span>
              <span className="stat-value">{money(d.totals.income.last7, currency, { noCents: true })}</span>
              <Delta now={d.totals.income.last7} prev={d.totals.income.prev7} upIsGood />
            </div>
            <div className="stat">
              <span className="stat-label">Spending · last 7 days</span>
              <span className="stat-value">{money(d.totals.spend.last7, currency, { noCents: true })}</span>
              <Delta now={d.totals.spend.last7} prev={d.totals.spend.prev7} upIsGood={false} />
            </div>
            <div className="stat">
              <span className="stat-label">Savings</span>
              <span className="stat-value">{money(d.totals.savingsCents, currency, { noCents: true })}</span>
              <span className="delta flat">in savings accounts</span>
            </div>
            <div className="stat">
              <span className="stat-label">Loans</span>
              <span className="stat-value">{money(Math.abs(d.totals.loansCents), currency, { noCents: true })}</span>
              <span className="delta flat">owed on loans</span>
            </div>
          </div>
        </section>

        {/* Budget + forecast */}
        <div className="grid-2">
          <section className="card" aria-labelledby="bud-title">
            <div className="card-head">
              <h2 id="bud-title">This month’s budget</h2>
              <Link to="/budget" className="small">
                Details
              </Link>
            </div>
            <div className="card-body stack-sm">
              {d.budget.totalBudgetCents > 0 ? (
                <>
                  <div className="spread">
                    <span className="stat-value">{money(d.budget.totalSpentCents, currency, { noCents: true })}</span>
                    <span className="small muted num">of {money(d.budget.totalBudgetCents, currency, { noCents: true })}</span>
                  </div>
                  <Meter
                    valueBp={d.budget.usedBp}
                    paceBp={d.budget.monthElapsedBp}
                    status={d.budget.usedBp > 10_000 ? 'over' : d.budget.usedBp > d.budget.monthElapsedBp + 1500 ? 'warning' : 'ok'}
                    label="Budget used"
                  />
                  <div className="xs muted">
                    {pct(d.budget.usedBp)} spent with {pct(10_000 - d.budget.monthElapsedBp)} of the month left
                    {d.budget.overCount ? ` · ${d.budget.overCount} categor${d.budget.overCount === 1 ? 'y' : 'ies'} over` : ''}. The tick marks today.
                  </div>
                </>
              ) : (
                <EmptyState icon={<Wallet size={22} />} title="No budget yet" action={<Link className="btn btn-sm" to="/budget">Set a budget</Link>}>
                  Monthly limits by category power the alerts and tips.
                </EmptyState>
              )}
            </div>
          </section>
          <section className="card" aria-labelledby="fc-title">
            <div className="card-head">
              <h2 id="fc-title">Next 3 months</h2>
              <Link to="/planner" className="small">
                Open planner
              </Link>
            </div>
            <div className="card-body stack-sm">
              {d.forecast.firstDeficitDate ? (
                <div className="callout crit">
                  <AlertOctagon size={18} />
                  <div>
                    <strong>Cash may run short around {shortDate(d.forecast.firstDeficitDate)}.</strong>
                    <div className="small">Projected low {money(d.forecast.lowestBalanceCents, currency, { noCents: true })}.</div>
                  </div>
                </div>
              ) : (
                <>
                  <span className="stat-label">Lowest projected cash balance</span>
                  <span className="stat-value">{money(d.forecast.lowestBalanceCents, currency, { noCents: true })}</span>
                  <span className="xs muted">around {shortDate(d.forecast.lowestBalanceDate)}, then {money(d.forecast.endBalanceCents, currency, { noCents: true })} by the end of the period.</span>
                </>
              )}
              <Link to="/planner" className="small cluster" style={{ gap: 4 }}>
                <LineIcon size={14} /> Test a “what if?”
              </Link>
            </div>
          </section>
        </div>

        {/* Goals */}
        <section className="card" aria-labelledby="goals-title">
          <div className="card-head">
            <h2 id="goals-title">Financial goals</h2>
            <Link to="/budget#goals" className="small">
              All goals
            </Link>
          </div>
          <div className="card-body">
            {d.goals.length === 0 ? (
              <p className="small muted">No goals yet. Add one from the Budget page.</p>
            ) : (
              <div className="goal-strip">
                {d.goals.slice(0, 4).map((g) => (
                  <div key={g.id} className="goal-cell">
                    <ProgressRing bp={g.progressBp} label={g.name} />
                    <div className="small" style={{ fontWeight: 500, textAlign: 'center' }}>
                      <GoalIcon icon={g.icon} size={14} /> {g.name}
                    </div>
                    <div className="xs muted num" style={{ textAlign: 'center' }}>
                      {money(g.savedCents, currency, { noCents: true })} of {money(g.targetCents, currency, { noCents: true })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Accounts (prototype's expandable rows) */}
        <section className="card" aria-labelledby="acct-title">
          <div className="card-head">
            <h2 id="acct-title">Accounts</h2>
            <Link to="/household?tab=accounts" className="small">
              Manage
            </Link>
          </div>
          {d.accountGroups.length === 0 ? (
            <p className="card-body small muted">No accounts in this view.</p>
          ) : (
            <ul className="list" style={{ marginTop: 8 }}>
              {d.accountGroups.map((g) => {
                const open = openGroup === g.type;
                return (
                  <li key={g.type}>
                    <button className="row row-button" aria-expanded={open} onClick={() => setOpenGroup(open ? null : g.type)}>
                      <span className="cat-icon">
                        <AccountIcon type={g.type} />
                      </span>
                      <div className="row-main">
                        <div className="row-title">{g.label}</div>
                        <div className="row-meta">
                          {g.accounts.length} account{g.accounts.length === 1 ? '' : 's'}
                          {g.type === 'credit_card' && d.creditCards.utilizationBp != null ? ` · ${pct(d.creditCards.utilizationBp)} of limit used` : ''}
                        </div>
                      </div>
                      <span className="row-amount">{money(g.totalCents, currency)}</span>
                      {open ? <ChevronDown size={18} className="muted" /> : <ChevronRight size={18} className="muted" />}
                    </button>
                    {open && (
                      <ul className="list" style={{ background: 'var(--surface-sunken)' }}>
                        {g.accounts.map((a) => (
                          <li key={a.id} className="row" style={{ paddingLeft: 68 }}>
                            <div className="row-main">
                              <div className="row-title">{a.name}</div>
                              <div className="row-meta">
                                {[a.institution, a.last4 ? `•••• ${a.last4}` : null, a.visibility === 'private' ? 'Private' : null].filter(Boolean).join(' · ') || 'Manual'}
                              </div>
                            </div>
                            <Link className="row-amount" to={`/ledger?accountId=${a.id}`}>
                              {money(a.balanceCents, currency)}
                            </Link>
                          </li>
                        ))}
                        {g.type === 'credit_card' && (
                          <li className="row xs muted" style={{ paddingLeft: 68, minHeight: 40 }}>
                            {money(d.creditCards.spend7Cents, currency)} spent on cards in {d.creditCards.txnCount7} purchases over the last 7 days
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Side column */}
      <div className="stack" style={{ gap: 20 }}>
        <section className="card" aria-labelledby="tips-title">
          <div className="card-head">
            <h2 id="tips-title">Smart tips</h2>
            <span className="xs muted">Rule-based</span>
          </div>
          <div style={{ marginTop: 4 }}>
            <TipList tips={d.tips} />
          </div>
        </section>
        <section className="card" aria-labelledby="bills-title">
          <div className="card-head">
            <h2 id="bills-title">
              <CalendarClock size={16} style={{ display: 'inline', verticalAlign: '-3px', marginRight: 6 }} />
              Upcoming bills
            </h2>
            <Link to="/budget#bills" className="small">
              All bills
            </Link>
          </div>
          {d.upcomingBills.length === 0 ? (
            <p className="small muted" style={{ padding: '8px 20px 20px' }}>
              Nothing due in the next two weeks.
            </p>
          ) : (
            <ul className="list" style={{ marginTop: 4 }}>
              {d.upcomingBills.map((b) => (
                <BillRow key={`${b.recurringId}-${b.dueDate}`} b={b} currency={currency} onPaid={onChange} />
              ))}
            </ul>
          )}
        </section>
        <section className="card" aria-labelledby="act-title">
          <div className="card-head">
            <h2 id="act-title">Household activity</h2>
            <Link to="/activity" className="small">
              All activity
            </Link>
          </div>
          {d.recentActivity.length === 0 ? (
            <div className="card-body">
              {canAdd ? (
                <Button size="sm" icon={<Plus size={14} />} onClick={onAdd}>
                  Log your first entry
                </Button>
              ) : (
                <p className="small muted">No activity yet.</p>
              )}
            </div>
          ) : (
            <ul className="list" style={{ marginTop: 4 }}>
              {d.recentActivity.map((a) => (
                <li key={a.id} className="row" style={{ alignItems: 'flex-start' }}>
                  {a.actor ? <Avatar id={a.actor.id} name={a.actor.name} /> : <span className="avatar">·</span>}
                  <div className="row-main small" style={{ whiteSpace: 'normal' }}>
                    <strong>{a.actor?.name.split(' ')[0] ?? 'Someone'}</strong> {a.summary}
                    <div className="xs muted">{relativeTime(a.createdAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
