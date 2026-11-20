import { useState, type FormEvent } from 'react';
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  FREQUENCIES,
  FREQUENCY_LABELS,
  LIABILITY_TYPES,
  type AccountType,
  type GoalDTO,
  type RecurringDTO,
} from '@familypulse/shared/client';
import { api, ApiError } from '../lib/api';
import { useHousehold } from '../lib/session';
import { useAccounts, useCategories, useInvalidate } from '../lib/queries';
import { useToast } from '../lib/toast';
import { localToday } from '../lib/format';
import { Button, Field, FormError, Input, MoneyInput, Select } from '../components/ui';

function topError(e: unknown) {
  return e instanceof ApiError && e.details ? null : e;
}

// ------------------------------------------------------------------ accounts
export function AccountForm({ onDone, compact }: { onDone: () => void; compact?: boolean }) {
  const { base, can } = useHousehold();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('checking');
  const [visibility, setVisibility] = useState<'shared' | 'private'>(can('accounts.manage') ? 'shared' : 'private');
  const [balance, setBalance] = useState<number | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [institution, setInstitution] = useState('');
  const [openingDate, setOpeningDate] = useState(localToday());
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const debt = LIABILITY_TYPES.includes(type);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post(`${base}/accounts`, {
        name,
        type,
        visibility,
        institution: institution || null,
        openingBalanceCents: debt ? -Math.abs(balance ?? 0) : (balance ?? 0),
        openingDate,
        creditLimitCents: type === 'credit_card' ? limit : null,
      });
      toast.success(`Added ${name}`);
      invalidate();
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }
  const fe = error instanceof ApiError ? error : null;
  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <FormError error={topError(error)} />
      <div className="form-row">
        <Field label="Account name" error={fe?.field('name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Joint checking" data-autofocus maxLength={60} />
        </Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="form-row">
        <Field label={debt ? 'Amount owed today' : 'Current balance'} error={fe?.field('openingBalanceCents')} hint={debt ? 'Enter what you owe; it counts against net worth.' : undefined}>
          <MoneyInput value={balance} onChange={setBalance} allowNegative={!debt} placeholder="0.00" />
        </Field>
        <Field label="Balance as of" error={fe?.field('openingDate')}>
          <Input type="date" value={openingDate} max={localToday()} onChange={(e) => setOpeningDate(e.target.value)} />
        </Field>
      </div>
      {type === 'credit_card' && (
        <Field label="Credit limit" optional>
          <MoneyInput value={limit} onChange={setLimit} />
        </Field>
      )}
      {!compact && (
        <Field label="Bank or provider" optional>
          <Input value={institution} onChange={(e) => setInstitution(e.target.value)} maxLength={60} />
        </Field>
      )}
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label" style={{ marginBottom: 6 }}>
          Who can see it
        </legend>
        <label className="check">
          <input type="radio" name="vis" checked={visibility === 'shared'} disabled={!can('accounts.manage')} onChange={() => setVisibility('shared')} />
          <span>
            <strong>Shared</strong> <span className="muted small">— everyone in the household; counts toward household totals and the forecast.</span>
          </span>
        </label>
        <label className="check">
          <input type="radio" name="vis" checked={visibility === 'private'} onChange={() => setVisibility('private')} />
          <span>
            <strong>Private</strong> <span className="muted small">— only you, shown in your Personal view. Not even admins can see it.</span>
          </span>
        </label>
      </fieldset>
      <div className="form-banner info small">FamilyPulse never asks for your online-banking password. Balances come from what you enter or import.</div>
      <div className="form-actions">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>
          Add account
        </Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ recurring items
export function RecurringForm({ kind, item, onDone }: { kind: 'income' | 'bill'; item?: RecurringDTO; onDone: () => void }) {
  const { base, me } = useHousehold();
  const accounts = useAccounts();
  const categories = useCategories();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [label, setLabel] = useState(item?.label ?? '');
  const [amount, setAmount] = useState<number | null>(item?.amountCents ?? null);
  const [variable, setVariable] = useState(item?.minAmountCents != null);
  const [minAmount, setMinAmount] = useState<number | null>(item?.minAmountCents ?? null);
  const [frequency, setFrequency] = useState(item?.frequency ?? (kind === 'income' ? 'biweekly' : 'monthly'));
  const [nextDate, setNextDate] = useState(item?.nextDate ?? localToday());
  const [accountId, setAccountId] = useState(item?.accountId ?? '');
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? '');
  const [autopay, setAutopay] = useState(item?.autopay ?? false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const cats = (categories.data ?? []).filter((c) => !c.archived && (kind === 'income' ? c.group === 'income' : c.group !== 'income'));
  const accts = (accounts.data ?? []).filter((a) => !a.archived && (a.visibility === 'shared' || a.ownerUserId === me.user.id));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      kind,
      label,
      amountCents: amount,
      minAmountCents: kind === 'income' && variable ? minAmount : null,
      frequency,
      nextDate,
      accountId: accountId || null,
      categoryId: categoryId || null,
      autopay,
    };
    try {
      if (item) await api.patch(`${base}/recurring/${item.id}`, body);
      else await api.post(`${base}/recurring`, body);
      toast.success(item ? 'Updated' : kind === 'income' ? 'Income added' : 'Bill added');
      invalidate();
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }
  const fe = error instanceof ApiError ? error : null;
  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <FormError error={topError(error)} />
      <Field label={kind === 'income' ? 'Income source' : 'Bill'} error={fe?.field('label')}>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind === 'income' ? 'e.g. Salary, client work' : 'e.g. Rent, electricity'} data-autofocus maxLength={60} />
      </Field>
      <div className="form-row">
        <Field label={kind === 'income' && variable ? 'Typical amount' : 'Amount'} error={fe?.field('amountCents')}>
          <MoneyInput value={amount} onChange={setAmount} placeholder="0.00" />
        </Field>
        <Field label="How often">
          <Select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {FREQUENCY_LABELS[f]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {kind === 'income' && (
        <label className="check">
          <input type="checkbox" checked={variable} onChange={(e) => setVariable(e.target.checked)} />
          <span>
            This income varies <span className="muted small">(freelance, tips, commission)</span>
          </span>
        </label>
      )}
      {kind === 'income' && variable && (
        <Field label="In a slow period, at least" error={fe?.field('minAmountCents')} hint="The planner’s “conservative” mode uses this figure.">
          <MoneyInput value={minAmount} onChange={setMinAmount} placeholder="0.00" />
        </Field>
      )}
      <div className="form-row">
        <Field label={kind === 'income' ? 'Next payday' : 'Next due date'} error={fe?.field('nextDate')}>
          <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
        </Field>
        <Field label="Category" optional error={fe?.field('categoryId')}>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">None</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={kind === 'income' ? 'Paid into' : 'Paid from'} optional hint="Needed to mark it paid in one tap.">
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Not set</option>
          {accts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.visibility === 'private' ? ' (private)' : ''}
            </option>
          ))}
        </Select>
      </Field>
      {kind === 'bill' && (
        <label className="check">
          <input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} />
          <span>Set to autopay with the provider</span>
        </label>
      )}
      <div className="form-actions">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>
          {item ? 'Save' : 'Add'}
        </Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ goals
export const GOAL_ICON_OPTIONS = [
  ['home', 'Home / mortgage'],
  ['education', 'Education'],
  ['emergency', 'Emergency fund'],
  ['travel', 'Travel'],
  ['car', 'Car'],
  ['retirement', 'Retirement'],
  ['other', 'Other'],
] as const;

export function GoalForm({ goal, onDone }: { goal?: GoalDTO; onDone: () => void }) {
  const { base } = useHousehold();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [name, setName] = useState(goal?.name ?? '');
  const [icon, setIcon] = useState(goal?.icon ?? 'other');
  const [target, setTarget] = useState<number | null>(goal?.targetCents ?? null);
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '');
  const [monthly, setMonthly] = useState<number | null>(goal?.plannedMonthlyCents ?? null);
  const [saved, setSaved] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = { name, icon, targetCents: target, targetDate: targetDate || null, plannedMonthlyCents: monthly ?? 0 };
      if (goal) await api.patch(`${base}/goals/${goal.id}`, body);
      else {
        const r = await api.post<{ goal: GoalDTO }>(`${base}/goals`, body);
        if (saved && saved > 0) await api.post(`${base}/goals/${r.goal.id}/contributions`, { amountCents: saved, date: localToday(), note: 'Starting balance' });
      }
      toast.success(goal ? 'Goal updated' : 'Goal created');
      invalidate();
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }
  const fe = error instanceof ApiError ? error : null;
  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <FormError error={topError(error)} />
      <div className="form-row">
        <Field label="Goal" error={fe?.field('name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. College fund" data-autofocus maxLength={60} />
        </Field>
        <Field label="Kind">
          <Select value={icon} onChange={(e) => setIcon(e.target.value)}>
            {GOAL_ICON_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="form-row">
        <Field label="Target amount" error={fe?.field('targetCents')}>
          <MoneyInput value={target} onChange={setTarget} placeholder="0.00" />
        </Field>
        <Field label="Target date" optional error={fe?.field('targetDate')}>
          <Input type="date" value={targetDate} min={localToday()} onChange={(e) => setTargetDate(e.target.value)} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Planned each month" optional hint="Used to project when you’ll reach it.">
          <MoneyInput value={monthly} onChange={setMonthly} placeholder="0.00" />
        </Field>
        {!goal && (
          <Field label="Already saved" optional>
            <MoneyInput value={saved} onChange={setSaved} placeholder="0.00" />
          </Field>
        )}
      </div>
      <div className="form-actions">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>
          {goal ? 'Save goal' : 'Create goal'}
        </Button>
      </div>
    </form>
  );
}
