import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownUp, ChevronLeft, ChevronRight, CloudOff, Download, FileUp, Lock, MessageSquare, Paperclip, ReceiptText, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { addMonths, CATEGORY_GROUP_LABELS, EXPENSE_GROUPS, monthLabel, type Paginated, type SmartTipDTO, type TransactionDTO } from '@familypulse/shared/client';
import { api, qs } from '../../lib/api';
import { useHousehold } from '../../lib/session';
import { useAccounts, useCategories, useMembers } from '../../lib/queries';
import { discard, retry, useOutbox } from '../../lib/outbox';
import { dayLabel, localToday, money, shortDate } from '../../lib/format';
import { Avatar, Button, EmptyState, ErrorState, Input, Select, Skeleton, Tabs } from '../../components/ui';
import { CategoryIcon } from '../../components/icons';
import { Legend, RankedBars, SegmentedBar, TableView } from '../../components/charts';
import { ScopeToggle, TipList } from '../dashboard/DashboardPage';
import { TransactionDrawer } from './TransactionDrawer';
import { ImportDialog } from './ImportDialog';

const FILTER_KEYS = ['q', 'accountId', 'categoryId', 'type', 'from', 'to', 'tag', 'memberId'] as const;
const SORTS = {
  newest: { sort: 'date', dir: 'desc', label: 'Newest first' },
  oldest: { sort: 'date', dir: 'asc', label: 'Oldest first' },
  largest: { sort: 'amount', dir: 'desc', label: 'Largest amount' },
  smallest: { sort: 'amount', dir: 'asc', label: 'Smallest amount' },
} as const;
type SortKey = keyof typeof SORTS;
const PAGE_SIZE = 25;

export default function LedgerPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('view') === 'breakdown' ? 'breakdown' : 'ledger';
  const { can } = useHousehold();
  const [importOpen, setImportOpen] = useState(false);
  const setTab = (v: string) => {
    const p = new URLSearchParams(params);
    if (v === 'breakdown') p.set('view', 'breakdown');
    else p.delete('view');
    setParams(p, { replace: true });
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Spend</h1>
          <p>Every entry, who logged it, and the conversation around it.</p>
        </div>
        <div className="cluster">
          <ScopeToggle />
          {can('imports.run') && (
            <Button icon={<FileUp size={16} />} onClick={() => setImportOpen(true)}>
              Import CSV
            </Button>
          )}
        </div>
      </div>
      <Tabs
        label="Spend views"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'ledger', label: 'Ledger' },
          { value: 'breakdown', label: 'Breakdown' },
        ]}
      />
      <div style={{ marginTop: 16 }}>{tab === 'ledger' ? <Ledger /> : <Breakdown />}</div>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

function Ledger() {
  const { base, hid, scope, currency } = useHousehold();
  const [params, setParams] = useSearchParams();
  const accounts = useAccounts(true);
  const categories = useCategories();
  const members = useMembers();
  const pending = useOutbox(hid);
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(params.get('q') ?? '');
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const sortKey = (params.get('sort') as SortKey) in SORTS ? (params.get('sort') as SortKey) : 'newest';
  const openId = params.get('txn');
  const today = localToday();

  const filters = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? undefined])), [params]);
  const activeFilters = FILTER_KEYS.filter((k) => k !== 'q' && params.get(k));

  const update = (patch: Record<string, string | null>, keepPage = false) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (!keepPage) p.delete('page');
    setParams(p, { replace: true });
  };

  // Debounced search → URL
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== q) update({ q: q || null });
    }, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (params.get('focus') === 'search') {
      searchRef.current?.focus();
      update({ focus: null }, true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const query = useQuery({
    queryKey: ['transactions', hid, scope, filters, page, sortKey],
    queryFn: () =>
      api.get<Paginated<TransactionDTO>>(`${base}/transactions${qs({ ...filters, scope, page, pageSize: PAGE_SIZE, sort: SORTS[sortKey].sort, dir: SORTS[sortKey].dir })}`),
    placeholderData: (prev) => prev,
  });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const exportHref = `/api${base}/transactions/export.csv${qs({ ...filters, scope, sort: SORTS[sortKey].sort, dir: SORTS[sortKey].dir })}`;

  const grouped = useMemo(() => {
    const out: { date: string; items: TransactionDTO[] }[] = [];
    for (const t of data?.items ?? []) {
      const last = out[out.length - 1];
      if (sortKey.startsWith('n') || sortKey.startsWith('o')) {
        if (last && last.date === t.date) last.items.push(t);
        else out.push({ date: t.date, items: [t] });
      } else out.push({ date: '', items: [t] });
    }
    return out;
  }, [data, sortKey]);

  const nameOf = (k: string, v: string) => {
    if (k === 'accountId') return accounts.data?.find((a) => a.id === v)?.name ?? 'Account';
    if (k === 'categoryId') return v === 'uncategorized' ? 'Uncategorised' : (categories.data?.find((c) => c.id === v)?.name ?? 'Category');
    if (k === 'memberId') return `By ${members.data?.find((m) => m.userId === v)?.name.split(' ')[0] ?? 'member'}`;
    if (k === 'type') return { expense: 'Spending', income: 'Income', transfer: 'Transfers', adjustment: 'Balance updates' }[v] ?? v;
    if (k === 'from') return `From ${shortDate(v)}`;
    if (k === 'to') return `To ${shortDate(v)}`;
    if (k === 'tag') return `#${v}`;
    return v;
  };

  return (
    <div className="stack">
      <div className="filter-bar" role="search">
        <div className="search-field">
          <Search size={16} aria-hidden />
          <Input ref={searchRef} type="search" aria-label="Search description, merchant or notes" placeholder="Search entries" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select aria-label="Account" value={params.get('accountId') ?? ''} onChange={(e) => update({ accountId: e.target.value || null })}>
          <option value="">All accounts</option>
          {(accounts.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.archived ? ' (archived)' : ''}
            </option>
          ))}
        </Select>
        <Select aria-label="Category" value={params.get('categoryId') ?? ''} onChange={(e) => update({ categoryId: e.target.value || null })}>
          <option value="">All categories</option>
          <option value="uncategorized">Uncategorised</option>
          {[...EXPENSE_GROUPS, 'income' as const].map((g) => (
            <optgroup key={g} label={CATEGORY_GROUP_LABELS[g]}>
              {(categories.data ?? [])
                .filter((c) => c.group === g)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>
        <Select aria-label="Type" value={params.get('type') ?? ''} onChange={(e) => update({ type: e.target.value || null })}>
          <option value="">All types</option>
          <option value="expense">Spending</option>
          <option value="income">Income</option>
          <option value="transfer">Transfers</option>
          <option value="adjustment">Balance updates</option>
        </Select>
        <label className="date-filter">
          <span>From</span>
          <Input type="date" value={params.get('from') ?? ''} onChange={(e) => update({ from: e.target.value || null })} />
        </label>
        <label className="date-filter">
          <span>To</span>
          <Input type="date" value={params.get('to') ?? ''} onChange={(e) => update({ to: e.target.value || null })} />
        </label>
        <Select aria-label="Sort" value={sortKey} onChange={(e) => update({ sort: e.target.value === 'newest' ? null : e.target.value })}>
          {Object.entries(SORTS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
      </div>
      {activeFilters.length > 0 && (
        <div className="cluster">
          {activeFilters.map((k) => (
            <button key={k} className="badge badge-outline" style={{ cursor: 'pointer', height: 28 }} onClick={() => update({ [k]: null })} aria-label={`Remove filter ${nameOf(k, params.get(k)!)}`}>
              {nameOf(k, params.get(k)!)} <X size={12} />
            </button>
          ))}
          <button className="link-btn small" onClick={() => update(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))}>
            Clear all
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <section className="card pending-card" aria-labelledby="pending-title">
          <div className="card-head">
            <h2 id="pending-title" className="cluster" style={{ gap: 6 }}>
              <CloudOff size={16} /> Saved on this device
            </h2>
            <span className="xs muted">Not yet in the shared ledger</span>
          </div>
          <ul className="list" style={{ marginTop: 6 }}>
            {pending.map((p) => (
              <li key={p.id} className="row">
                <div className="row-main">
                  <div className="row-title">{p.display.description}</div>
                  <div className="row-meta" style={p.status === 'failed' ? { color: 'var(--crit-600)' } : undefined}>
                    {p.status === 'failed' ? `Needs attention: ${p.error}` : `Waiting to sync · ${p.display.accountName} · ${shortDate(p.display.date)}`}
                  </div>
                </div>
                <span className="row-amount">{money(p.display.amountCents, currency, { signed: true })}</span>
                {p.status === 'failed' && (
                  <button className="icon-btn icon-btn-sm" aria-label="Retry sync" onClick={() => void retry(p.id)}>
                    <RotateCcw size={16} />
                  </button>
                )}
                <button className="icon-btn icon-btn-sm" aria-label="Discard this offline entry" onClick={() => void discard(p.id)}>
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-label="Ledger entries">
        <div className="card-head">
          <span className="small muted num" aria-live="polite">
            {data ? (data.total === 0 ? 'No entries' : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, data.total)} of ${data.total}`) : ' '}
          </span>
          <a className="btn btn-sm btn-ghost" href={exportHref} download>
            <Download size={16} /> Export CSV
          </a>
        </div>
        {query.isLoading ? (
          <div className="card-body stack-sm">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} h={44} />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : data && data.items.length === 0 ? (
          activeFilters.length || params.get('q') ? (
            <EmptyState icon={<Search size={22} />} title="No entries match">
              Try a different search or remove a filter.
            </EmptyState>
          ) : (
            <EmptyState icon={<ReceiptText size={22} />} title={scope === 'personal' ? 'No private entries yet' : 'The ledger is empty'}>
              Add spending or income as it happens, import a bank CSV, or mark a bill as paid.
            </EmptyState>
          )
        ) : (
          <div className={query.isFetching && !query.isLoading ? 'refetching' : ''}>
            {/* Desktop/tablet table */}
            <div className="table-wrap ledger-table">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th>Account</th>
                    <th>By</th>
                    <th className="r">
                      <button className="th-sort" onClick={() => update({ sort: sortKey === 'largest' ? 'smallest' : 'largest' })}>
                        Amount <ArrowDownUp size={12} />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data!.items.map((t) => (
                    <tr key={t.id} className="clickable" onClick={() => update({ txn: t.id }, true)}>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>
                        {shortDate(t.date)}
                      </td>
                      <td style={{ maxWidth: 320 }}>
                        <button className="link-row" onClick={(e) => { e.stopPropagation(); update({ txn: t.id }, true); }}>
                          <span className="truncate" style={{ fontWeight: 500, color: 'var(--ink-900)' }}>
                            {t.description}
                          </span>
                        </button>
                        <div className="cluster xs muted" style={{ gap: 6 }}>
                          {t.merchant && <span className="truncate">{t.merchant}</span>}
                          {t.tags.map((g) => (
                            <span key={g} className="tag">
                              {g}
                            </span>
                          ))}
                          {t.commentCount > 0 && (
                            <span className="cluster" style={{ gap: 2 }} aria-label={`${t.commentCount} comments`}>
                              <MessageSquare size={12} /> {t.commentCount}
                            </span>
                          )}
                          {t.attachmentCount > 0 && <Paperclip size={12} aria-label="Has receipt" />}
                          {t.version > 1 && <span title={`Edited · version ${t.version}`}>edited</span>}
                        </div>
                      </td>
                      <td>{t.type === 'transfer' ? <span className="muted">Transfer</span> : t.type === 'adjustment' ? <span className="muted">Balance update</span> : (t.categoryName ?? <span className="badge badge-warn">Uncategorised</span>)}</td>
                      <td>
                        <span className="cluster" style={{ gap: 4, flexWrap: 'nowrap' }}>
                          {t.accountVisibility === 'private' && <Lock size={12} aria-label="Private" />}
                          <span className="truncate">{t.accountName}</span>
                        </span>
                      </td>
                      <td>{t.createdBy && <Avatar id={t.createdBy.id} name={t.createdBy.name} />}</td>
                      <td className={`r ${t.amountCents > 0 ? 'amount-in' : ''}`} style={{ fontWeight: 500 }}>
                        {money(t.amountCents, currency, { signed: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Phone card list grouped by day */}
            <div className="ledger-cards">
              {grouped.map((g, gi) => (
                <div key={`${g.date}-${gi}`}>
                  {g.date && <div className="day-head">{dayLabel(g.date, today)}</div>}
                  <ul className="list">
                    {g.items.map((t) => (
                      <li key={t.id}>
                        <button className="row row-button" onClick={() => update({ txn: t.id }, true)}>
                          <span className="cat-icon">
                            <CategoryIcon name={t.categoryName} />
                          </span>
                          <div className="row-main">
                            <div className="row-title">{t.description}</div>
                            <div className="row-meta">
                              {t.type === 'transfer' ? 'Transfer' : (t.categoryName ?? 'Uncategorised')} · {t.accountVisibility === 'private' ? 'Private · ' : ''}
                              {t.accountName}
                              {!g.date ? ` · ${shortDate(t.date)}` : ''}
                              {t.commentCount ? ` · ${t.commentCount} comment${t.commentCount > 1 ? 's' : ''}` : ''}
                            </div>
                          </div>
                          <span className={`row-amount ${t.amountCents > 0 ? 'amount-in' : ''}`}>{money(t.amountCents, currency, { signed: true })}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
        {data && pages > 1 && (
          <div className="card-foot">
            <Button size="sm" icon={<ChevronLeft size={16} />} disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, true)}>
              Previous
            </Button>
            <span className="small muted num">
              Page {page} of {pages}
            </span>
            <Button size="sm" disabled={page >= pages} onClick={() => update({ page: String(page + 1) }, true)}>
              Next <ChevronRight size={16} />
            </Button>
          </div>
        )}
      </section>
      {openId && <TransactionDrawer id={openId} onClose={() => update({ txn: null }, true)} />}
    </div>
  );
}

const GROUP_COLORS: Record<string, string> = { living: 'var(--viz-living)', entertainment: 'var(--viz-entertainment)', unexpected: 'var(--viz-unexpected)' };

function Breakdown() {
  const { base, hid, scope, currency } = useHousehold();
  const [, setParams] = useSearchParams();
  const [month, setMonth] = useState(localToday().slice(0, 7));
  const thisMonth = localToday().slice(0, 7);
  const q = useQuery({
    queryKey: ['spending', hid, scope, month],
    queryFn: () => api.get<{ month: string; totalCents: number; categories: { categoryId: string | null; name: string; group: string; color: string; totalCents: number; count: number }[] }>(`${base}/spending${qs({ month, scope })}`),
    placeholderData: (p) => p,
  });
  const tips = useQuery({ queryKey: ['insights', hid], queryFn: () => api.get<{ tips: SmartTipDTO[] }>(`${base}/insights`).then((r) => r.tips), enabled: scope === 'household' });
  const groups = ['living', 'entertainment', 'unexpected'].map((g) => ({
    key: g,
    label: CATEGORY_GROUP_LABELS[g as 'living'],
    color: GROUP_COLORS[g],
    value: (q.data?.categories ?? []).filter((c) => c.group === g || (g === 'unexpected' && !c.categoryId)).reduce((s, c) => s + c.totalCents, 0),
  }));
  const shift = (n: number) => setMonth(addMonths(`${month}-01`, n).slice(0, 7));

  return (
    <div className="grid-main-side">
      <section className="card" aria-labelledby="spent-title">
        <div className="card-body stack">
          <div className="spread">
            <button className="icon-btn icon-btn-sm" aria-label="Previous month" onClick={() => shift(-1)}>
              <ChevronLeft size={18} />
            </button>
            <h2 id="spent-title" style={{ fontSize: 'var(--text-md)' }}>
              {monthLabel(month, 'long')}
            </h2>
            <button className="icon-btn icon-btn-sm" aria-label="Next month" disabled={month >= thisMonth} onClick={() => shift(1)}>
              <ChevronRight size={18} />
            </button>
          </div>
          {q.isLoading ? (
            <Skeleton h={160} />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : q.data!.totalCents === 0 ? (
            <EmptyState icon={<ReceiptText size={22} />} title="No spending recorded">
              Nothing was spent in {monthLabel(month, 'long')} {scope === 'personal' ? 'from your private accounts' : 'from shared accounts'}.
            </EmptyState>
          ) : (
            <div className={`stack ${q.isFetching ? 'refetching' : ''}`}>
              <div>
                <div className="stat-label">We spent</div>
                <div className="hero-figure">{money(q.data!.totalCents, currency)}</div>
              </div>
              <SegmentedBar parts={groups} currency={currency} ariaLabel={`Spending by group in ${monthLabel(month, 'long')}`} />
              <Legend items={groups.map((g) => ({ label: `${g.label} · ${money(g.value, currency, { noCents: true })}`, color: g.color, kind: 'swatch' }))} />
              <hr className="divider" />
              <h3 className="eyebrow">By category</h3>
              <RankedBars
                currency={currency}
                rows={q.data!.categories.map((c) => ({ key: c.categoryId ?? 'uncategorized', label: c.name, value: c.totalCents, meta: `${c.count} entr${c.count === 1 ? 'y' : 'ies'}` }))}
                onSelect={(key) => {
                  const from = `${month}-01`;
                  const to = addMonths(from, 1);
                  const end = new Date(Date.parse(`${to}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
                  setParams({ categoryId: key, from, to: end, type: 'expense' });
                }}
              />
              <TableView caption="Spending by category" columns={['Category', 'Group', 'Entries', 'Amount']} rows={q.data!.categories.map((c) => [c.name, CATEGORY_GROUP_LABELS[c.group as 'living'] ?? '—', c.count, money(c.totalCents, currency)])} />
            </div>
          )}
        </div>
      </section>
      <section className="card" aria-labelledby="st-title">
        <div className="card-head">
          <h2 id="st-title">Smart tips</h2>
          <span className="xs muted">Rule-based</span>
        </div>
        {scope === 'personal' ? <p className="card-body small muted">Tips cover the shared household budget.</p> : tips.isLoading ? <div className="card-body"><Skeleton h={60} /></div> : <TipList tips={tips.data ?? []} />}
      </section>
    </div>
  );
}
