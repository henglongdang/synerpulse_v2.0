import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { SUPPORTED_CURRENCIES } from '@familypulse/shared/client';
import { api, ApiError } from '../../lib/api';
import { meKey, signOut } from '../../lib/session';
import { browserTimeZone } from '../../lib/format';
import { Button, Field, FormError, Input, Select } from '../../components/ui';
import { AuthLayout } from '../auth/AuthPages';

export function WelcomePage({ allowCancel }: { allowCancel?: boolean }) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/households', { name, currency, timezone: browserTimeZone() });
      // Navigate before refreshing the session: once the household exists the router swaps route
      // tables, and the old URL (e.g. /register) would otherwise redirect to the dashboard first.
      navigate('/onboarding', { replace: true });
      await qc.invalidateQueries({ queryKey: meKey });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }
  const fe = error instanceof ApiError ? error : null;
  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={submit} noValidate>
        <img className="auth-mobile-logo" src="/brand/familypulse-logo.svg" alt="FamilyPulse" />
        <div>
          <p className="eyebrow">Step 1 of 6</p>
          <h2 style={{ marginTop: 4 }}>Name your household</h2>
          <p className="muted small" style={{ marginTop: 6 }}>
            A household is the shared space for your accounts, budget and plans. You can invite partners, family or roommates afterwards — each with
            their own level of access.
          </p>
        </div>
        <FormError error={fe && !fe.details ? fe : null} />
        <Field label="Household name" error={fe?.field('name')} hint="For example “The Rivera family” or “Elm Street flat”.">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
        </Field>
        <Field label="Currency" hint="Amounts in this household are tracked in one currency.">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="primary" block loading={loading}>
          Continue
        </Button>
        <div className="form-banner info">Joining someone else’s household? Open the invitation link they sent you.</div>
        {allowCancel ? (
          <Button variant="ghost" onClick={() => navigate('/')}>
            Cancel
          </Button>
        ) : (
          <Button
            variant="ghost"
            onClick={async () => {
              await signOut(qc);
              navigate('/login');
            }}
          >
            Sign out
          </Button>
        )}
      </form>
    </AuthLayout>
  );
}
