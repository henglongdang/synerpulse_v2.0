/**
 * Scenario Planner (paper §2.6). Progressive disclosure, per the paper's evaluation lesson:
 * guided presets first, full controls on each adjustment after. The engine runs server-side;
 * requests are debounced so sliders feel live without flooding the API.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, CalendarClock, CheckCircle2, Info, Plus, Save, Trash2, TrendingDown, Wallet, X } from 'lucide-react';
import { addDays, addMonths, FREQUENCIES, FREQUENCY_LABELS, type Adjustment, type ForecastResultDTO, type ScenarioDTO } from '@familypulse/shared';
import { api, ApiError } from '../../lib/api';
import { useHousehold } from '../../lib/session';
import { useCategories, useInvalidate, useRecurring } from '../../lib/queries';
import { useToast } from '../../lib/toast';
import { localToday, money, shortDate } from '../../lib/format';
import { Button, Dialog, EmptyState, ErrorState, Field, FormError, Input, MoneyInput, Segmented, Select, Skeleton } from '../../components/ui';
import { Legend, LineChart, TableView } from '../../components/charts';

type Horizon = 3 | 6 | 12 | 24;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const PRESETS: { id: string; label: string; detail: string; make: (ctx: { firstBill?: string; today: string }) => Adjustment | null }[] = [
  { id: 'income30', label: 'Income drops 30%', detail: 'A slow quarter, fewer shifts, a client leaves', make: () => ({ kind: 'income_change', recurringId: null, basisPoints: -3000 }) },
  { id: 'delay', label: 'Delay a payment 2 weeks', detail: 'Push the next bill back 14 days', make: ({ firstBill }) => (firstBill ? { kind: 'delay_bill', recurringId: firstBill, days: 14 } : null) },
  { id: 'big', label: 'A big one-off expense', detail: 'Car repair, medical bill, travel', make: ({ today }) => ({ kind: 'one_time', label: 'One-off expense', amountCents: -150_000, date: addDays(today, 21) }) },
  { id: 'cut', label: 'Spend 10% less day-to-day', detail: 'Groceries, dining, the small stuff', make: () => ({ kind: 'expense_change', categoryId: null, basisPoints: -1000 }) },
  { id: 'new', label: 'A new monthly cost', detail: 'Daycare, a car payment, a subscription', make: ({ today }) => ({ kind: 'new_recurring', label: 'New monthly cost', amountCents: -40_000, frequency: 'monthly', startDate: addDays(today, 14) }) },
];

export default function PlannerPage() {
  const { base, hid, scope, currency, can } = useHousehold();
  const recurring = useRecurring();
  const toast = useToast();
  const invalidate = useInvalidate();
  const today = localToday();
  const [horizon, setHorizon] = useState<Horizon>(6);
  const [granularity, setGranularity] = useState<'month' | 'week'>('month');
  const [incomeMode, setIncomeMode] = useState<'expected' | 'conservative'>('expected');
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [loaded, setLoaded] = useState<ScenarioDTO | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const request = useMemo(() => ({ horizonMonths: horizon, granularity, incomeMode, scope, adjustments: adjustments.filter(valid) }), [horizon, granularity, incomeMode, scope, adjustments]);
  const debounced = useDebounced(request, 300);
  const fc = useQuery({
    queryKey: ['forecast', hid, debounced],
    queryFn: () => api.post<{ forecast: ForecastResultDTO }>(`${base}/forecast`, debounced).then((r) => r.forecast),
    placeholderData: (p) => p,
  });
  const saved = useQuery({ queryKey: ['scenarios', hid], queryFn: () => api.get<{ scenarios: ScenarioDTO[] }>(`${base}/scenarios`).then((r) => r.scenarios) });
  const bills = (recurring.data ?? []).filter((r) => r.kind === 'bill' && r.active);

  const update = (i: number, a: Adjustment) => setAdjustments((list) => list.map((x, j) => (j === i ? a : x)));
  const remove = (i: number) => setAdjustments((list) => list.filter((_, j) => j !== i));
  const addPreset = (p: (typeof PRESETS)[number]) => {
    const biggest = [...bills].sort((a, b) => b.amountCents - a.amountCents)[0]?.id;
    const a = p.make({ firstBill: biggest, today });
    if (!a) {
      toast.info('Add a recurring bill first (Budget → Recurring) to try delaying one.');
      return;
    }
    setAdjustments((l) => [...l, a]);
  };
  const loadScenario = (s: ScenarioDTO) => {
    setLoaded(s);
    setHorizon(s.horizonMonths);
    setGranularity(s.granularity);
    setIncomeMode(s.incomeMode);
    setAdjustments(s.adjustments);
  };

  const f = fc.data;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Planner</h1>
          <p>See what’s coming, and test a decision before you make it.</p>
        </div>
      </div>

      <div className="filter-bar planner-controls" role="group" aria-label="Forecast settings">
        <Segmented<string> label="Horizon" value={String(horizon)} onChange={(v) => setHorizon(Number(v) as Horizon)} options={[{ value: '3', label: '3M' }, { value: '6', label: '6M' }, { value: '12', label: '1Y' }, { value: '24', label: '2Y' }]} />
        <Segmented label="Granularity" value={granularity} onChange={setGranularity} options={[{ value: 'month', label: 'Monthly' }, { value: 'week', label: 'Weekly' }]} />
        <Segmented label="Income assumption" value={incomeMode} onChange={setIncomeMode} options={[{ value: 'expected', label: 'Expected income' }, { value: 'conservative', label: 'Conservative' }]} />
        <span className="xs muted">{scope === 'household' ? 'Shared accounts' : 'Your private accounts'}</span>
      </div>

      <div className="grid-main-side planner-grid">
        <div className="stack" style={{ gap: 20 }}>
          {fc.isLoading ? (
            <div className="card card-pad">
              <Skeleton h={300} />
            </div>
          ) : fc.isError ? (
            <ErrorState error={fc.error} onRetry={() => fc.refetch()} />
          ) : f ? (
            <Results f={f} currency={currency} refetching={fc.isFetching} hasScenario={adjustments.length > 0} />
          ) : null}
        </div>

        <div className="stack" style={{ gap: 20 }}>
          <section className="card" aria-labelledby="sc-title">
            <div className="card-head">
              <h2 id="sc-title">{loaded ? loaded.name : 'What if…?'}</h2>
              {adjustments.length > 0 && (
                <button className="link-btn small" onClick={() => { setAdjustments([]); setLoaded(null); }}>
                  Clear
                </button>
              )}
            </div>
            <div className="card-body stack">
              {adjustments.length === 0 && <p className="small muted">Pick a starting point. You can fine-tune every number afterwards, and combine several changes.</p>}
              {adjustments.map((a, i) => (
                <AdjustmentEditor key={i} a={a} onChange={(n) => update(i, n)} onRemove={() => remove(i)} />
              ))}
              <div className="preset-grid">
                {PRESETS.map((p) => (
                  <button key={p.id} type="button" className="preset" onClick={() => addPreset(p)}>
                    <Plus size={14} aria-hidden />
                    <span>
                      <strong>{p.label}</strong>
                      <span className="xs muted">{p.detail}</span>
                    </span>
                  </button>
                ))}
              </div>
              {can('scenarios.manage') && adjustments.length > 0 && (
                <Button icon={<Save size={16} />} onClick={() => setSaveOpen(true)}>
                  {loaded ? 'Save changes' : 'Save scenario'}
                </Button>
              )}
            </div>
          </section>

          <section className="card" aria-labelledby="saved-title">
            <div className="card-head">
              <h2 id="saved-title">Saved scenarios</h2>
            </div>
            {saved.isLoading ? (
              <div className="card-body">
                <Skeleton h={40} />
              </div>
            ) : (saved.data ?? []).length === 0 ? (
              <p className="card-body small muted">Scenarios you save are shared with your household so you can discuss them.</p>
            ) : (
              <ul className="list">
                {saved.data!.map((s) => (
                  <li key={s.id} className="row">
                    <button className="row-main row-button" style={{ padding: 0 }} onClick={() => loadScenario(s)}>
                      <div className="row-title">{s.name}</div>
                      <div className="row-meta">
                        {s.adjustments.length} change{s.adjustments.length === 1 ? '' : 's'} · by {s.createdBy?.name.split(' ')[0] ?? 'former member'}
                      </div>
                    </button>
                    {can('scenarios.manage') && (
                      <button
                        className="icon-btn icon-btn-sm"
                        aria-label={`Delete scenario ${s.name}`}
                        onClick={async () => {
                          await api.delete(`${base}/scenarios/${s.id}`);
                          if (loaded?.id === s.id) setLoaded(null);
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
          </section>
        </div>
      </div>
      <SaveDialog open={saveOpen} onClose={() => setSaveOpen(false)} existing={loaded} request={request} onSaved={(s) => { setLoaded(s); invalidate(); }} />
    </div>
  );
}

function valid(a: Adjustment): boolean {
  if (a.kind === 'one_time') return a.amountCents !== 0 && Boolean(a.label) && Boolean(a.date);
  if (a.kind === 'new_recurring') return a.amountCents !== 0 && Boolean(a.label) && Boolean(a.startDate);
  return true;
}

function Results({ f, currency, refetching, hasScenario }: { f: ForecastResultDTO; currency: string; refetching: boolean; hasScenario: boolean }) {
  const s = f.scenario;
  const shown = s ?? f.baseline;
  const labels = f.baseline.periods.map((p) => p.label);
  const deficitIdx = (series: typeof f.baseline) => (series.firstDeficitDate ? series.periods.findIndex((p) => p.start <= series.firstDeficitDate! && p.end >= series.firstDeficitDate!) : -1);
  const scenarioDef = s ? deficitIdx(s) : -1;
  const baseDef = deficitIdx(f.baseline);
  const endDiff = s ? s.endBalanceCents - f.baseline.endBalanceCents : 0;
  const series = [
    { key: 'base', label: hasScenario ? 'As things are' : 'Projected balance', color: 'var(--viz-income)', values: f.baseline.periods.map((p) => p.minBalanceCents), area: !s },
    ...(s ? [{ key: 'scn', label: 'With your changes', color: 'var(--viz-projection)', values: s.periods.map((p) => p.minBalanceCents), dashed: true }] : []),
  ];
  return (
    <>
      <section className={`card ${refetching ? 'refetching' : ''}`} aria-labelledby="res-title">
        <div className="card-body stack">
          <h2 id="res-title" className="sr-only">
            Forecast results
          </h2>
          <div className="result-tiles">
            <div className="stat" style={{ padding: 0 }}>
              <span className="stat-label">
                <Wallet size={14} /> Cash today
              </span>
              <span className="stat-value">{money(f.baseline.startBalanceCents, currency, { noCents: true })}</span>
            </div>
            <div className="stat" style={{ padding: 0 }}>
              <span className="stat-label">
                <TrendingDown size={14} /> Lowest point
              </span>
              <span className="stat-value" style={shown.lowestBalanceCents < 0 ? { color: 'var(--crit-600)' } : undefined}>
                {money(shown.lowestBalanceCents, currency, { noCents: true })}
              </span>
              <span className="xs muted">around {shortDate(shown.lowestBalanceDate)}</span>
            </div>
            <div className="stat" style={{ padding: 0 }}>
              <span className="stat-label">
                <CalendarClock size={14} /> In {f.horizonMonths} months
              </span>
              <span className="stat-value">{money(shown.endBalanceCents, currency, { noCents: true })}</span>
              {s && (
                <span className={`delta ${endDiff >= 0 ? 'up-good' : 'down-bad'}`}>
                  {money(endDiff, currency, { signed: true, noCents: true })} vs. as things are
                </span>
              )}
            </div>
          </div>
          {shown.firstDeficitDate ? (
            <div className="callout crit" role="status">
              <AlertOctagon size={18} />
              <div>
                <strong>
                  {s ? 'With these changes, cash' : 'Cash'} first runs out on {shortDate(shown.firstDeficitDate, true)}
                  {labels[s ? scenarioDef : baseDef] ? ` (${labels[s ? scenarioDef : baseDef]})` : ''}.
                </strong>
                <div className="small">
                  It bottoms out at {money(shown.lowestBalanceCents, currency, { noCents: true })} around {shortDate(shown.lowestBalanceDate)}. Try a smaller change, moving a bill, or a short-term cut to close the gap.
                </div>
              </div>
            </div>
          ) : shown.firstBelowBufferDate && f.safetyBufferCents > 0 ? (
            <div className="callout warn" role="status">
              <Info size={18} />
              <div>
                <strong>Stays positive, but dips below your {money(f.safetyBufferCents, currency, { noCents: true })} safety buffer on {shortDate(shown.firstBelowBufferDate)}.</strong>
              </div>
            </div>
          ) : (
            <div className="callout good" role="status">
              <CheckCircle2 size={18} />
              <div>
                <strong>{s ? 'Even with these changes, cash' : 'Cash'} stays positive for the next {f.horizonMonths} months.</strong>
                {s && f.baseline.firstDeficitDate == null && <div className="small">Lowest point moves by {money(s.lowestBalanceCents - f.baseline.lowestBalanceCents, currency, { signed: true, noCents: true })}.</div>}
              </div>
            </div>
          )}
          <div className="spread" style={{ flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 'var(--text-base)' }}>Lowest balance each {f.granularity}</h3>
            <Legend items={series.map((x) => ({ label: x.label, color: x.color, kind: x.dashed ? 'dashed' : 'line' }))} />
          </div>
          <LineChart
            labels={labels}
            series={series}
            currency={currency}
            height={260}
            ariaLabel={`Projected lowest cash balance per ${f.granularity} over ${f.horizonMonths} months`}
            refLines={[
              { value: 0, label: 'Zero', color: 'var(--crit-500)' },
              ...(f.safetyBufferCents > 0 ? [{ value: f.safetyBufferCents, label: 'Safety buffer', color: 'var(--warn-500)' }] : []),
            ]}
            markers={scenarioDef >= 0 ? [{ index: scenarioDef, seriesKey: 'scn', label: 'First deficit', color: 'var(--crit-600)' }] : baseDef >= 0 ? [{ index: baseDef, seriesKey: 'base', label: 'First deficit', color: 'var(--crit-600)' }] : []}
            tooltipExtra={(i) => (
              <div className="xs muted" style={{ marginTop: 4 }}>
                In {money(shown.periods[i].inflowCents, currency, { noCents: true })} · out {money(shown.periods[i].outflowCents, currency, { noCents: true })} · ends at {money(shown.periods[i].endBalanceCents, currency, { noCents: true })}
              </div>
            )}
          />
          <TableView
            caption="Forecast by period"
            columns={['Period', 'Money in', 'Money out', 'Lowest balance', 'Ending balance', ...(s ? ['Ending (with changes)'] : [])]}
            rows={f.baseline.periods.map((p, i) => [
              p.label,
              money(p.inflowCents, currency, { noCents: true }),
              money(p.outflowCents, currency, { noCents: true }),
              money(p.minBalanceCents, currency, { noCents: true }),
              money(p.endBalanceCents, currency, { noCents: true }),
              ...(s ? [money(s.periods[i]?.endBalanceCents ?? 0, currency, { noCents: true })] : []),
            ])}
          />
        </div>
      </section>

      <section className="card" aria-labelledby="how-title">
        <div className="card-head">
          <h2 id="how-title">How this is calculated</h2>
        </div>
        <div className="card-body stack small">
          <p className="muted">
            A day-by-day simulation of the cash in your {f.assumptions.liquidAccounts.length} checking, savings and cash accounts. Each day adds scheduled income, subtracts bills on their due dates, and spreads typical everyday spending evenly across the month — so a bill that lands before payday shows up as the dip it really is. Credit cards and loans aren’t cash: card spending is counted through your everyday spending, and goal savings stay in your accounts.
          </p>
          <dl className="detail-list">
            <div>
              <dt>Starting cash</dt>
              <dd className="num">
                {money(f.assumptions.startingBalanceCents, currency)} <span className="muted">({f.assumptions.liquidAccounts.map((a) => a.name).join(', ') || 'no cash accounts yet'})</span>
              </dd>
            </div>
            <div>
              <dt>Income</dt>
              <dd>
                {f.assumptions.incomeStreams.length === 0
                  ? 'None scheduled — add income under Budget → Recurring.'
                  : f.assumptions.incomeStreams.map((r) => (
                      <div key={r.id}>
                        {r.label}: <span className="num">{money(r.usedAmountCents, currency)}</span> {FREQUENCY_LABELS[r.frequency].toLowerCase()}
                        {r.usedAmountCents !== r.amountCents ? <span className="muted"> (conservative; typical {money(r.amountCents, currency, { noCents: true })})</span> : null}
                      </div>
                    ))}
              </dd>
            </div>
            <div>
              <dt>Bills</dt>
              <dd>
                {f.assumptions.bills.length === 0
                  ? 'None scheduled.'
                  : f.assumptions.bills.map((r) => (
                      <div key={r.id}>
                        {r.label}: <span className="num">{money(r.amountCents, currency)}</span> {FREQUENCY_LABELS[r.frequency].toLowerCase()}, next {shortDate(r.nextDate)}
                      </div>
                    ))}
              </dd>
            </div>
            <div>
              <dt>Everyday spending</dt>
              <dd>
                <span className="num">{money(f.assumptions.everydaySpendMonthlyCents, currency)}</span> / month
                <div className="xs muted">{f.assumptions.everydaySpendBasis}</div>
              </dd>
            </div>
          </dl>
          <p className="xs muted">A projection, not a guarantee: it assumes your schedule and habits continue. It doesn’t predict market returns or unplanned events you haven’t added.</p>
        </div>
      </section>

      <section className="card" aria-labelledby="ev-title">
        <div className="card-head">
          <h2 id="ev-title">Coming up</h2>
        </div>
        {f.upcomingEvents.length === 0 ? (
          <EmptyState icon={<CalendarClock size={22} />} title="Nothing scheduled">
            Add recurring income and bills to see them here.
          </EmptyState>
        ) : (
          <ul className="list">
            {f.upcomingEvents.slice(0, 12).map((e, i) => (
              <li key={i} className="row">
                <span className="num small muted" style={{ width: 56 }}>
                  {shortDate(e.date)}
                </span>
                <div className="row-main">
                  <div className="row-title">{e.label}</div>
                  {e.source === 'scenario' && <span className="badge badge-shared">What-if</span>}
                </div>
                <span className={`row-amount ${e.amountCents > 0 ? 'amount-in' : ''}`}>{money(e.amountCents, currency, { signed: true })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function AdjustmentEditor({ a, onChange, onRemove }: { a: Adjustment; onChange: (a: Adjustment) => void; onRemove: () => void }) {
  const { currency } = useHousehold();
  const recurring = useRecurring();
  const categories = useCategories();
  const incomes = (recurring.data ?? []).filter((r) => r.kind === 'income' && r.active);
  const bills = (recurring.data ?? []).filter((r) => r.kind === 'bill' && r.active);
  const today = localToday();
  const title = { income_change: 'Income changes', expense_change: 'Spending changes', one_time: 'One-off amount', delay_bill: 'Delay a bill', new_recurring: 'New recurring amount' }[a.kind];
  return (
    <div className="adjust">
      <div className="spread">
        <strong className="small">{title}</strong>
        <button className="icon-btn icon-btn-sm" aria-label={`Remove: ${title}`} onClick={onRemove}>
          <X size={16} />
        </button>
      </div>
      {a.kind === 'income_change' && (
        <>
          <Select aria-label="Which income" value={a.recurringId ?? ''} onChange={(e) => onChange({ ...a, recurringId: e.target.value || null })}>
            <option value="">All income</option>
            {incomes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
          <Slider label="Change" value={a.basisPoints / 100} min={-100} max={50} step={5} format={(v) => `${v > 0 ? '+' : ''}${v}%`} onChange={(v) => onChange({ ...a, basisPoints: v * 100 })} />
          <Input type="date" aria-label="Starting" value={a.startDate ?? ''} min={today} onChange={(e) => onChange({ ...a, startDate: e.target.value || undefined })} />
          <span className="xs muted">{a.startDate ? `From ${shortDate(a.startDate)}` : 'Starting now'} — leave the date empty to apply immediately.</span>
        </>
      )}
      {a.kind === 'expense_change' && (
        <>
          <Select aria-label="Which spending" value={a.categoryId ?? ''} onChange={(e) => onChange({ ...a, categoryId: e.target.value || null })}>
            <option value="">All everyday spending</option>
            {(categories.data ?? [])
              .filter((c) => c.group !== 'income' && !c.archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
          <Slider label="Change" value={a.basisPoints / 100} min={-50} max={100} step={5} format={(v) => `${v > 0 ? '+' : ''}${v}%`} onChange={(v) => onChange({ ...a, basisPoints: v * 100 })} />
        </>
      )}
      {a.kind === 'one_time' && (
        <>
          <Input aria-label="Label" value={a.label} onChange={(e) => onChange({ ...a, label: e.target.value })} maxLength={60} />
          <Segmented label="Direction" value={a.amountCents < 0 ? 'out' : 'in'} onChange={(v) => onChange({ ...a, amountCents: (v === 'out' ? -1 : 1) * Math.abs(a.amountCents) })} options={[{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }]} />
          <div className="form-row">
            <MoneyInput aria-label="Amount" value={Math.abs(a.amountCents)} onChange={(v) => onChange({ ...a, amountCents: (a.amountCents < 0 ? -1 : 1) * (v ?? 0) })} />
            <Input type="date" aria-label="Date" value={a.date} min={today} onChange={(e) => onChange({ ...a, date: e.target.value })} />
          </div>
        </>
      )}
      {a.kind === 'delay_bill' && (
        <>
          <Select aria-label="Which bill" value={a.recurringId} onChange={(e) => onChange({ ...a, recurringId: e.target.value })}>
            {bills.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} — {money(r.amountCents, currency, { noCents: true })}, due {shortDate(r.nextDate)}
              </option>
            ))}
          </Select>
          <Slider label="Delay" value={a.days} min={1} max={60} step={1} format={(v) => `${v} day${v === 1 ? '' : 's'}`} onChange={(v) => onChange({ ...a, days: v })} />
          <span className="xs muted">Only the next payment moves; later ones stay on schedule.</span>
        </>
      )}
      {a.kind === 'new_recurring' && (
        <>
          <Input aria-label="Label" value={a.label} onChange={(e) => onChange({ ...a, label: e.target.value })} maxLength={60} />
          <Segmented label="Direction" value={a.amountCents < 0 ? 'out' : 'in'} onChange={(v) => onChange({ ...a, amountCents: (v === 'out' ? -1 : 1) * Math.abs(a.amountCents) })} options={[{ value: 'out', label: 'Cost' }, { value: 'in', label: 'Income' }]} />
          <div className="form-row">
            <MoneyInput aria-label="Amount" value={Math.abs(a.amountCents)} onChange={(v) => onChange({ ...a, amountCents: (a.amountCents < 0 ? -1 : 1) * (v ?? 0) })} />
            <Select aria-label="How often" value={a.frequency} onChange={(e) => onChange({ ...a, frequency: e.target.value as typeof a.frequency })}>
              {FREQUENCIES.filter((x) => x !== 'once').map((x) => (
                <option key={x} value={x}>
                  {FREQUENCY_LABELS[x]}
                </option>
              ))}
            </Select>
          </div>
          <div className="form-row">
            <Input type="date" aria-label="Starting" value={a.startDate} min={today} onChange={(e) => onChange({ ...a, startDate: e.target.value })} />
            <Input type="date" aria-label="Ending (optional)" value={a.endDate ?? ''} min={a.startDate} max={addMonths(today, 24)} onChange={(e) => onChange({ ...a, endDate: e.target.value || undefined })} />
          </div>
        </>
      )}
    </div>
  );
}

function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span className="spread small">
        <span className="muted">{label}</span>
        <strong className="num">{format(value)}</strong>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={format(value)} />
    </label>
  );
}

function SaveDialog({ open, onClose, existing, request, onSaved }: { open: boolean; onClose: () => void; existing: ScenarioDTO | null; request: { horizonMonths: number; granularity: string; incomeMode: string; adjustments: Adjustment[] }; onSaved: (s: ScenarioDTO) => void }) {
  const { base } = useHousehold();
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => setName(existing?.name ?? ''), [existing, open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={existing ? 'Update scenario' : 'Save scenario'}
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
                const body = { name, horizonMonths: request.horizonMonths, granularity: request.granularity, incomeMode: request.incomeMode, adjustments: request.adjustments };
                const r = existing ? await api.put<{ scenario: ScenarioDTO }>(`${base}/scenarios/${existing.id}`, body) : await api.post<{ scenario: ScenarioDTO }>(`${base}/scenarios`, body);
                toast.success('Scenario saved for your household');
                onSaved(r.scenario);
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
        <FormError error={error instanceof ApiError && !error.details ? error : null} />
        <Field label="Name" error={error instanceof ApiError ? error.field('name') : undefined}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. If daycare starts in March" data-autofocus maxLength={60} />
        </Field>
      </div>
    </Dialog>
  );
}
