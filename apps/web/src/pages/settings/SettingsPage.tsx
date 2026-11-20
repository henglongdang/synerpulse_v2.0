import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleSlash, Download, Laptop, LogOut, Smartphone } from 'lucide-react';
import type { NotificationPrefs, SessionDTO } from '@familypulse/shared/client';
import { api, ApiError } from '../../lib/api';
import { meKey, signOut, useHousehold } from '../../lib/session';
import { useToast } from '../../lib/toast';
import { relativeTime } from '../../lib/format';
import { Button, ConfirmDialog, Field, FormError, Input, MoneyInput, Skeleton } from '../../components/ui';
import { clearOutbox } from '../../lib/outbox';

export default function SettingsPage() {
  const location = useLocation();
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [location.hash]);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Your profile, security, alerts and data.</p>
        </div>
      </div>
      <div className="settings-grid">
        <Profile />
        <Password />
        <Alerts />
        <Sessions />
        <Integrations />
        <Data />
      </div>
    </div>
  );
}

function Section({ id, title, children, sub }: { id: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="card card-pad stack" id={id} aria-labelledby={`${id}-t`}>
      <div>
        <h2 id={`${id}-t`} style={{ fontSize: 'var(--text-base)' }}>
          {title}
        </h2>
        {sub && <p className="small muted" style={{ marginTop: 2 }}>{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Profile() {
  const { me } = useHousehold();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(me.user.name);
  const [error, setError] = useState<unknown>(null);
  return (
    <Section id="profile" title="Profile">
      <FormError error={error} />
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </Field>
      <Field label="Email" hint="Used to sign in. Contact support to change it.">
        <Input value={me.user.email} readOnly />
      </Field>
      <div className="form-actions">
        <Button
          variant="primary"
          disabled={name === me.user.name}
          onClick={async () => {
            setError(null);
            try {
              await api.patch('/auth/me', { name });
              await qc.invalidateQueries({ queryKey: meKey });
              toast.success('Profile saved');
            } catch (e) {
              setError(e);
            }
          }}
        >
          Save
        </Button>
      </div>
    </Section>
  );
}

function Password() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fe = error instanceof ApiError ? error : null;
  return (
    <Section id="password" title="Password" sub="Changing it signs you out everywhere else.">
      <FormError error={fe && !fe.details ? fe : null} />
      <Field label="Current password" error={fe?.field('currentPassword')}>
        <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="New password" error={fe?.field('newPassword')} hint="At least 10 characters.">
        <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <div className="form-actions">
        <Button
          variant="primary"
          loading={busy}
          disabled={!current || !next}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api.post('/auth/password/change', { currentPassword: current, newPassword: next });
              setCurrent('');
              setNext('');
              toast.success('Password changed. Other devices were signed out.');
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Change password
        </Button>
      </div>
    </Section>
  );
}

function Alerts() {
  const { me } = useHousehold();
  const qc = useQueryClient();
  const toast = useToast();
  const [p, setP] = useState<NotificationPrefs>(me.notificationPrefs);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof NotificationPrefs>(k: K, v: NotificationPrefs[K]) => setP((x) => ({ ...x, [k]: v }));
  return (
    <Section id="alerts" title="Alerts & nudges" sub="In-app notifications. Email and push delivery aren’t configured in this deployment.">
      <div className="form-row">
        <Field label="Budget warning at" hint="Percent of a category’s monthly limit.">
          <Input type="number" min={50} max={100} step={5} value={p.budgetThresholdPct} onChange={(e) => set('budgetThresholdPct', Number(e.target.value))} />
        </Field>
        <Field label="Bill reminders (days before)" hint="0 turns them off.">
          <Input type="number" min={0} max={14} value={p.billReminderDays} onChange={(e) => set('billReminderDays', Number(e.target.value))} />
        </Field>
      </div>
      <Field label="Safety buffer" hint="The planner warns when projected cash drops below this.">
        <MoneyInput value={p.safetyBufferCents} onChange={(v) => set('safetyBufferCents', v ?? 0)} />
      </Field>
      <div className="stack-sm">
        {(
          [
            ['forecastDeficit', 'Warn me if the forecast shows cash running short'],
            ['goals', 'Goal milestones'],
            ['mentions', 'When someone @mentions me'],
            ['comments', 'Comments on entries I logged'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={p[k]} onChange={(e) => set(k, e.target.checked)} />
            {label}
          </label>
        ))}
      </div>
      <div className="form-actions">
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.put('/auth/me/notification-prefs', p);
              await qc.invalidateQueries({ queryKey: meKey });
              toast.success('Alert preferences saved');
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Failed');
            } finally {
              setBusy(false);
            }
          }}
        >
          Save preferences
        </Button>
      </div>
    </Section>
  );
}

function Sessions() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<{ sessions: SessionDTO[] }>('/auth/sessions').then((r) => r.sessions) });
  return (
    <Section id="sessions" title="Signed-in devices">
      {q.isLoading ? (
        <Skeleton h={60} />
      ) : (
        <ul className="list">
          {q.data!.map((s) => {
            const mobile = /iphone|android|mobile/i.test(s.userAgent ?? '');
            return (
              <li key={s.id} className="row" style={{ paddingLeft: 0, paddingRight: 0 }}>
                <span className="cat-icon">{mobile ? <Smartphone size={16} /> : <Laptop size={16} />}</span>
                <div className="row-main">
                  <div className="row-title">
                    {browserName(s.userAgent)} {s.current && <span className="badge badge-good">This device</span>}
                  </div>
                  <div className="row-meta">Active {relativeTime(s.lastSeenAt)} · signed in {relativeTime(s.createdAt)}</div>
                </div>
                {!s.current && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<LogOut size={14} />}
                    onClick={async () => {
                      await api.delete(`/auth/sessions/${s.id}`);
                      toast.success('Signed out that device');
                      void q.refetch();
                    }}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function browserName(ua: string | null) {
  if (!ua) return 'Unknown device';
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return `${b}${os ? ` on ${os}` : ''}`;
}

function Integrations() {
  const q = useQuery({ queryKey: ['integrations'], queryFn: () => api.get<{ providers: { id: string; name: string; status: string; description: string }[] }>('/integrations').then((r) => r.providers) });
  return (
    <Section id="integrations" title="Data sources" sub="Where FamilyPulse’s numbers come from.">
      {q.isLoading ? (
        <Skeleton h={60} />
      ) : (
        <ul className="list">
          {q.data!.map((p) => (
            <li key={p.id} className="row" style={{ paddingLeft: 0, paddingRight: 0, alignItems: 'flex-start' }}>
              {p.status === 'available' ? <CheckCircle2 size={18} style={{ color: 'var(--good-600)', marginTop: 2 }} /> : <CircleSlash size={18} className="muted" style={{ marginTop: 2 }} />}
              <div className="row-main" style={{ whiteSpace: 'normal' }}>
                <div className="row-title">
                  {p.name} <span className={`badge ${p.status === 'available' ? 'badge-good' : ''}`}>{p.status === 'available' ? 'Available' : 'Not connected'}</span>
                </div>
                <div className="small muted">{p.description}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Data() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Section id="data" title="Your data" sub="Download everything you can see, or delete your account.">
      <a className="btn" href="/api/me/export" download style={{ justifySelf: 'start' }}>
        <Download size={16} /> Download my data (JSON)
      </a>
      <hr className="divider" />
      <div className="stack-sm">
        <strong className="small" style={{ color: 'var(--crit-600)' }}>
          Delete account
        </strong>
        <p className="small muted">Permanently deletes your login and private accounts. Households you own alone are deleted too; if others share a household you own, transfer ownership first.</p>
        <Button variant="danger" style={{ justifySelf: 'start' }} onClick={() => setConfirm(true)}>
          Delete my account…
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        title="Delete your account permanently?"
        danger
        loading={busy}
        confirmLabel="Delete account"
        onClose={() => {
          setConfirm(false);
          setError(null);
        }}
        onConfirm={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.delete('/me', { password });
            await clearOutbox();
            await signOut(qc);
            navigate('/login');
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
        body={
          <div className="form-grid">
            <span>This cannot be undone. Enter your password to confirm.</span>
            <FormError error={error} />
            <Input type="password" aria-label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        }
      />
    </Section>
  );
}
