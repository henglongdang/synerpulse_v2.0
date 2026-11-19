import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, MessagesSquare, PanelsTopLeft } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { meKey } from '../../lib/session';
import { Button, Field, FormError, Input } from '../../components/ui';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-brand">
        <img className="logo" src="/brand/familypulse-logo.svg" alt="FamilyPulse" />
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
          FamilyPulse builds on the design research in <em>Revolutionizing Household Finance: A User-Centered Platform for Holistic Financial Management</em>{' '}
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
        <img className="auth-mobile-logo" src="/brand/familypulse-logo.svg" alt="FamilyPulse" />
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
          New to FamilyPulse?{' '}
          <Link to="/register" state={{ from }}>
            Create an account
          </Link>
        </p>
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
        <img className="auth-mobile-logo" src="/brand/familypulse-logo.svg" alt="FamilyPulse" />
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
        <img className="auth-mobile-logo" src="/brand/familypulse-logo.svg" alt="FamilyPulse" />
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
        <img className="auth-mobile-logo" src="/brand/familypulse-logo.svg" alt="FamilyPulse" />
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
