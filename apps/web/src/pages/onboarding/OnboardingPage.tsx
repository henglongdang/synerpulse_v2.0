/**
 * Guided setup — the prototype's "Set Daily Expenses" flow (Income → Spend → Goals → Confirm),
 * preceded by Accounts so every later number is grounded in real balances. Each step writes to the
 * backend immediately, so a refresh never loses progress; the final step saves the budget plan.
 */
import { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, PartyPopper, Plus } from 'lucide-react';
import { CATEGORY_GROUP_LABELS, EXPENSE_GROUPS, FREQUENCY_LABELS, monthKey, type CategoryGroup } from '@familypulse/shared/client';
import { api } from '../../lib/api';
import { meKey, useHousehold } from '../../lib/session';
import { useAccounts, useCategories, useGoals, useInvalidate, useRecurring } from '../../lib/queries';
import { useToast } from '../../lib/toast';
import { localToday, money } from '../../lib/format';
import { Button, Dialog, FormError, MoneyInput } from '../../components/ui';
import { AccountIcon, CategoryIcon, GoalIcon } from '../../components/icons';
import { AccountForm, GoalForm, RecurringForm } from '../../features/forms';

const STEPS = ['Household', 'Accounts', 'Income', 'Spend', 'Goals', 'Confirm'] as const;

export default function OnboardingPage() {
  const { household, base, currency, can } = useHousehold();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const invalidate = useInvalidate();
  const accounts = useAccounts();
  const recurring = useRecurring();
  const categories = useCategories();
  const goals = useGoals();
  const [step, setStep] = useState(1);
  const [dialog, setDialog] = useState<null | 'account' | 'income' | 'goal'>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, number | null>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const incomes = (recurring.data ?? []).filter((r) => r.kind === 'income');
  const incomeMonthly = incomes.reduce((s, r) => s + r.monthlyEquivalentCents, 0);
  const expenseCats = useMemo(() => (categories.data ?? []).filter((c) => c.group !== 'income' && !c.archived), [categories.data]);
  const budgetTotal = [...selected].reduce((s, id) => s + (amounts[id] ?? 0), 0);

  if (!can('household.update')) return <Navigate to="/" replace />;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      const items = [...selected].filter((id) => (amounts[id] ?? 0) > 0).map((id) => ({ categoryId: id, amountCents: amounts[id]! }));
      await api.put(`${base}/budgets`, { month: monthKey(localToday()), expectedIncomeCents: incomeMonthly, items });
      await api.post(`${base}/onboarded`);
      await qc.invalidateQueries({ queryKey: meKey });
      invalidate();
      setDone(true);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  // "Finish later" keeps setup open: the dashboard shows a banner to continue where you left off.
  function skip() {
    invalidate();
    navigate('/');
  }

  const header = (
    <header className="onboard-head">
      <img src="/brand/familypulse-logo.svg" alt="FamilyPulse" />
      <Button variant="ghost" size="sm" onClick={skip}>
        Finish later
      </Button>
    </header>
  );

  if (done)
    return (
      <div className="onboard">
        {header}
        <div className="onboard-body">
          <div className="card success-panel">
            <div className="empty-icon" style={{ width: 64, height: 64 }}>
              <PartyPopper size={30} />
            </div>
            <h1>Great! Your budget is all set.</h1>
            <p className="muted">Keep it up. Invite the rest of your household so everyone works from the same numbers.</p>
            <div className="cluster" style={{ justifyContent: 'center', marginTop: 8 }}>
              <Button variant="primary" onClick={() => navigate('/')}>
                Go to dashboard
              </Button>
              <Button onClick={() => navigate('/household')}>Invite members</Button>
            </div>
          </div>
        </div>
      </div>
    );

  return (
    <div className="onboard">
      {header}
      <div className="onboard-body">
        <div className="steps" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <div key={s} className={`step ${i < step ? 'done' : i === step ? 'current' : ''}`} aria-current={i === step ? 'step' : undefined}>
              <div className="step-bar" />
              <span className="desktop-steps">{s}</span>
            </div>
          ))}
        </div>

        {step === 1 && (
          <section className="stack">
            <div>
              <h1>Add the accounts you share</h1>
              <p className="muted" style={{ marginTop: 4 }}>
                Checking, savings, cards and loans for <strong>{household.name}</strong>. Today’s balance is enough — you can import history from CSV later.
              </p>
            </div>
            <div className="card">
              {(accounts.data ?? []).length === 0 ? (
                <p className="card-pad muted small">No accounts yet.</p>
              ) : (
                <ul className="list">
                  {accounts.data!.map((a) => (
                    <li key={a.id} className="row">
                      <span className="cat-icon">
                        <AccountIcon type={a.type} />
                      </span>
                      <div className="row-main">
                        <div className="row-title">{a.name}</div>
                        <div className="row-meta">{a.visibility === 'private' ? 'Private' : 'Shared'}</div>
                      </div>
                      <span className="row-amount">{money(a.balanceCents, currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="card-foot">
                <Button size="sm" icon={<Plus size={16} />} onClick={() => setDialog('account')}>
                  Add account
                </Button>
              </div>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="stack">
            <div>
              <h1>Where does money come in?</h1>
              <p className="muted" style={{ marginTop: 4 }}>
                Add each paycheck or income stream. Freelance or variable income? Give a typical amount and a “slow month” floor — the planner uses both.
              </p>
            </div>
            <div className="card">
              {incomes.length === 0 ? (
                <p className="card-pad muted small">No income added yet.</p>
              ) : (
                <ul className="list">
                  {incomes.map((r) => (
                    <li key={r.id} className="row">
                      <span className="cat-icon">
                        <CategoryIcon name={r.categoryName ?? 'salary'} />
                      </span>
                      <div className="row-main">
                        <div className="row-title">{r.label}</div>
                        <div className="row-meta">
                          {FREQUENCY_LABELS[r.frequency]}
                          {r.minAmountCents != null ? ` · at least ${money(r.minAmountCents, currency, { noCents: true })}` : ''}
                        </div>
                      </div>
                      <span className="row-amount">{money(r.amountCents, currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="card-foot">
                <Button size="sm" icon={<Plus size={16} />} onClick={() => setDialog('income')}>
                  Add income
                </Button>
                {incomeMonthly > 0 && (
                  <span className="muted">
                    ≈ <strong className="num" style={{ color: 'var(--ink-900)' }}>{money(incomeMonthly, currency, { noCents: true })}</strong> / month
                  </span>
                )}
              </div>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="stack">
            <div>
              <h1>Track your daily spend</h1>
              <p className="muted" style={{ marginTop: 4 }}>
                Pick the categories you want a monthly limit for, then set each limit. You can change them any time.
              </p>
            </div>
            {EXPENSE_GROUPS.map((g: CategoryGroup) => (
              <div key={g} className="stack-sm">
                <h3 className="eyebrow">{CATEGORY_GROUP_LABELS[g]}</h3>
                <div className="tile-grid">
                  {expenseCats
                    .filter((c) => c.group === g)
                    .map((c) => (
                      <button key={c.id} type="button" className="tile" aria-pressed={selected.has(c.id)} onClick={() => toggle(c.id)}>
                        <span className="tile-check" aria-hidden>
                          {selected.has(c.id) && <Check size={14} />}
                        </span>
                        <CategoryIcon name={c.name} size={22} />
                        <span style={{ fontWeight: 500 }}>{c.name}</span>
                      </button>
                    ))}
                </div>
              </div>
            ))}
            {selected.size > 0 && (
              <div className="card">
                <div className="card-head">
                  <h2>Monthly limits</h2>
                  <span className="small muted num">
                    {money(budgetTotal, currency, { noCents: true })} of {money(incomeMonthly, currency, { noCents: true })} income
                  </span>
                </div>
                <ul className="list">
                  {expenseCats
                    .filter((c) => selected.has(c.id))
                    .map((c) => (
                      <li key={c.id} className="row">
                        <span className="cat-icon">
                          <CategoryIcon name={c.name} />
                        </span>
                        <label className="row-main row-title" htmlFor={`amt-${c.id}`}>
                          {c.name}
                        </label>
                        <div style={{ width: 140 }}>
                          <MoneyInput id={`amt-${c.id}`} value={amounts[c.id] ?? null} onChange={(v) => setAmounts((a) => ({ ...a, [c.id]: v }))} placeholder="0" />
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {step === 4 && (
          <section className="stack">
            <div>
              <h1>What are you saving for?</h1>
              <p className="muted" style={{ marginTop: 4 }}>
                Goals keep everyone pointed the same way. FamilyPulse works out the monthly amount needed to hit each date.
              </p>
            </div>
            <div className="card">
              {(goals.data ?? []).length === 0 ? (
                <p className="card-pad muted small">No goals yet — optional, but motivating.</p>
              ) : (
                <ul className="list">
                  {goals.data!.map((g) => (
                    <li key={g.id} className="row">
                      <span className="cat-icon">
                        <GoalIcon icon={g.icon} />
                      </span>
                      <div className="row-main">
                        <div className="row-title">{g.name}</div>
                        <div className="row-meta">{g.requiredMonthlyCents ? `Needs ${money(g.requiredMonthlyCents, currency, { noCents: true })}/month` : 'No target date'}</div>
                      </div>
                      <span className="row-amount">{money(g.targetCents, currency, { noCents: true })}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="card-foot">
                <Button size="sm" icon={<Plus size={16} />} onClick={() => setDialog('goal')}>
                  Add goal
                </Button>
              </div>
            </div>
          </section>
        )}

        {step === 5 && (
          <section className="stack">
            <div>
              <h1>Wow! That’s your plan</h1>
              <p className="muted" style={{ marginTop: 4 }}>
                Review it, then confirm. You can reset any time from the Budget page.
              </p>
            </div>
            <FormError error={error} />
            <div className="card">
              <ul className="list">
                <li className="row">
                  <div className="row-main">Accounts</div>
                  <span className="row-amount">{accounts.data?.length ?? 0}</span>
                </li>
                <li className="row">
                  <div className="row-main">Expected income</div>
                  <span className="row-amount">{money(incomeMonthly, currency, { noCents: true })} / mo</span>
                </li>
                <li className="row">
                  <div className="row-main">Monthly spending limits ({selected.size} categories)</div>
                  <span className="row-amount">{money(budgetTotal, currency, { noCents: true })} / mo</span>
                </li>
                <li className="row">
                  <div className="row-main">
                    <strong>Left to save or cover bills</strong>
                  </div>
                  <span className="row-amount" style={{ color: incomeMonthly - budgetTotal < 0 ? 'var(--crit-600)' : 'var(--good-600)' }}>
                    {money(incomeMonthly - budgetTotal, currency, { noCents: true })} / mo
                  </span>
                </li>
                <li className="row">
                  <div className="row-main">Savings goals</div>
                  <span className="row-amount">{goals.data?.length ?? 0}</span>
                </li>
              </ul>
            </div>
            {incomeMonthly - budgetTotal < 0 && <div className="callout warn">Your limits add up to more than your expected income. That’s allowed, but the forecast will show the gap.</div>}
          </section>
        )}

        <div className="spread">
          <Button variant="ghost" icon={<ArrowLeft size={16} />} disabled={step <= 1} onClick={() => setStep((s) => s - 1)}>
            Back
          </Button>
          <div className="cluster">
            {step === 3 && selected.size > 0 && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSelected(new Set());
                  setAmounts({});
                  toast.info('Selections reset');
                }}
              >
                Reset
              </Button>
            )}
            {step < 5 ? (
              <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
                {step === 4 && (goals.data ?? []).length === 0 ? 'Skip for now' : 'Next'}
              </Button>
            ) : (
              <Button variant="primary" loading={saving} onClick={finish}>
                Confirm
              </Button>
            )}
          </div>
        </div>
      </div>

      <Dialog open={dialog === 'account'} onClose={() => setDialog(null)} title="Add account">
        <AccountForm compact onDone={() => setDialog(null)} />
      </Dialog>
      <Dialog open={dialog === 'income'} onClose={() => setDialog(null)} title="Add income">
        <RecurringForm kind="income" onDone={() => setDialog(null)} />
      </Dialog>
      <Dialog open={dialog === 'goal'} onClose={() => setDialog(null)} title="Add a savings goal">
        <GoalForm onDone={() => setDialog(null)} />
      </Dialog>
    </div>
  );
}
