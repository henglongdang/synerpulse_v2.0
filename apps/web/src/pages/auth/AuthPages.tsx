import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Compass, MessagesSquare, PanelsTopLeft } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { meKey } from '../../lib/session';
import { Button, Field, FormError, Input } from '../../components/ui';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-brand">
        <img className="logo" src="/brand/synerpulse-logo.svg" alt="SynerPulse" />
        <h1>Your household’s money, in one shared place.</h1>
        <div className="auth-points">
          <div className="auth-point">
            <span className="cat-icon">
              <PanelsTopLeft size={18} />
            </span>
            <div>
              <strong>One picture, not five apps</strong>
              Accounts, budgets, bills and goals together — no more reconciling spreadsheets at month-end.
            </div>
          </div>
          <div className="auth-point">
            <span className="cat-icon">
              <CalendarClock size={18} />
            </span>
            <div>
              <strong>See what’s coming</strong>
              A day-by-day cash forecast, and “what if?” scenarios before you commit to a decision.
            </div>
          </div>
          <div className="auth-point">
            <span className="cat-icon">
              <MessagesSquare size={18} />
            </span>
            <div>
              <strong>Decide together, asynchronously</strong>
              Roles for every member, comments on any entry, and a full edit history.
            </div>
          </div>
        </div>
        <p className="auth-foot">
          SynerPulse builds on the design research in <em>Revolutionizing Household Finance: A User-Centered Platform for Holistic Financial Management</em>{' '}
          (Dang & Ding, HCI International 2025).
        </p>
      </aside>
      <div className="auth-form-wrap">{children}</div>
    </div>
  );
}

function useAfterAuth() {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: meKey });
  };
}

interface DemoInfo {
  enabled: boolean;
  email?: string;
  password?: string;
  resetHours?: number;
}

/** Public deployments run a shared, fictional demo household; this offers a one-click way in. */
function DemoCard() {
  const after = useAfterAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const demo = useQuery({ queryKey: ['demo-info'], queryFn: () => api.get<DemoInfo>('/demo'), staleTime: Infinity, retry: false });
  if (!demo.data?.enabled) return null;
  return (
    <div className="demo-card">
      <div className="cluster" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <Compass size={18} style={{ flex: 'none', marginTop: 2, color: 'var(--forest-700)' }} aria-hidden />
        <div>
          <strong>Just looking?</strong>
          <div className="small muted">
            Explore a fictional family’s finances: budgets, a shared ledger and the planner. It’s shared with other visitors and resets every{' '}
            {demo.data.resetHours && demo.data.resetHours !== 24 ? `${demo.data.resetHours} hours` : 'day'}.
          </div>
        </div>
      </div>
      <FormError error={error} />
      <Button
        variant="accent"
        block
        loading={loading}
        onClick={async () => {
          setLoading(true);
          setError(null);
          try {
            await api.post('/auth/login', { email: demo.data!.email, password: demo.data!.password });
            await after();
          } catch (e) {
            setError(e);
          } finally {
            setLoading(false);
          }
        }}
      >
        Explore the demo household
      </Button>
    </div>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const after = useAfterAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/login', { email, password });
      await after();
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
        <img className="auth-mobile-logo" src="/brand/synerpulse-logo.svg" alt="SynerPulse" />
        <div>
          <h2>Sign in</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            {from?.startsWith('/invite/') ? 'Sign in to accept your household invitation.' : 'Welcome back.'}
          </p>
        </div>
        <FormError error={fe && !fe.details ? fe : null} />
        <Field label="Email" error={fe?.field('email')}>
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password" error={fe?.field('password')}>
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <div className="spread small">
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <Button type="submit" variant="primary" block loading={loading}>
          Sign in
        </Button>
        <p className="small muted" style={{ textAlign: 'center' }}>
          New to SynerPulse?{' '}
          <Link to="/register" state={{ from }}>
            Create an account
          </Link>
        </p>
        {!from && <DemoCard />}
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const after = useAfterAuth();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/register', { name, email, password });
      await after();
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }
  const fe = error instanceof ApiError ? error : null;
  const strength = password.length === 0 ? null : password.length < 10 ? 'Too short' : password.length < 14 ? 'OK' : 'Strong';
  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={submit} noValidate>
        <img className="auth-mobile-logo" src="/brand/synerpulse-logo.svg" alt="SynerPulse" />
        <div>
          <h2>Create your account</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            You’ll set up your household next. It takes about three minutes.
          </p>
        </div>
        <FormError error={fe && !fe.details ? fe : null} />
        <Field label="Your name" error={fe?.field('name')}>
          <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus maxLength={80} />
        </Field>
        <Field label="Email" error={fe?.field('email')}>
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" error={fe?.field('password')} hint={strength ? `At least 10 characters · ${strength}` : 'At least 10 characters. A short phrase works well.'}>
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />
        </Field>
        <Button type="submit" variant="primary" block loading={loading}>
          Create account
        </Button>
        <p className="xs muted" style={{ textAlign: 'center' }}>
          We store only what the app needs. You can export or delete your data at any time from Settings.
        </p>
        <p className="small muted" style={{ textAlign: 'center' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api.post<{ message: string }>('/auth/password/forgot', { email });
      setSent(r.message);
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
        <img className="auth-mobile-logo" src="/brand/synerpulse-logo.svg" alt="SynerPulse" />
        <div>
          <h2>Reset your password</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            We’ll email you a link that works once and expires in 30 minutes.
          </p>
        </div>
        {sent ? (
          <div className="form-banner success" role="status">
            {sent}
          </div>
        ) : (
          <>
            <FormError error={fe && !fe.details ? fe : null} />
            <Field label="Email" error={fe?.field('email')}>
              <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </Field>
            <Button type="submit" variant="primary" block loading={loading}>
              Send reset link
            </Button>
          </>
        )}
        <p className="small muted" style={{ textAlign: 'center' }}>
          <Link to="/login">Back to sign in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/password/reset', { token, password });
      setDone(true);
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
        <img className="auth-mobile-logo" src="/brand/synerpulse-logo.svg" alt="SynerPulse" />
        <h2>Choose a new password</h2>
        {done ? (
          <>
            <div className="form-banner success" role="status">
              Your password was changed and every other device was signed out.
            </div>
            <Button variant="primary" block onClick={() => navigate('/login')}>
              Sign in
            </Button>
          </>
        ) : !token ? (
          <div className="form-banner error">This link is incomplete. Request a new reset email.</div>
        ) : (
          <>
            <FormError error={fe && !fe.details ? fe : null} />
            <Field label="New password" error={fe?.field('password')} hint="At least 10 characters.">
              <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </Field>
            <Button type="submit" variant="primary" block loading={loading}>
              Save new password
            </Button>
          </>
        )}
        <p className="small muted" style={{ textAlign: 'center' }}>
          <Link to="/forgot-password">Request a new link</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
