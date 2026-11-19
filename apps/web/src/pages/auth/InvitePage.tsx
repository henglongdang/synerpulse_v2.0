import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from '@familypulse/shared';
import { api } from '../../lib/api';
import { meKey, useMe } from '../../lib/session';
import { Button, ErrorState, FormError, PageLoading } from '../../components/ui';
import { AuthLayout } from './AuthPages';

interface InvitePreview {
  householdName: string;
  inviterName: string | null;
  role: Role;
  emailRestricted: boolean;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
}

export function InvitePage() {
  const { token = '' } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const inv = useQuery({ queryKey: ['invite', token], queryFn: () => api.get<{ invitation: InvitePreview }>(`/invitations/${token}`).then((r) => r.invitation), retry: false });

  if (inv.isLoading) return <PageLoading />;
  if (inv.isError)
    return (
      <AuthLayout>
        <div className="auth-form">
          <ErrorState error={inv.error} />
          <Link to="/">Go to FamilyPulse</Link>
        </div>
      </AuthLayout>
    );
  const i = inv.data!;
  const pending = i.status === 'pending';

  async function accept() {
    setLoading(true);
    setError(null);
    try {
      await api.post(`/invitations/${token}/accept`);
      await qc.invalidateQueries({ queryKey: meKey });
      navigate('/');
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <div className="auth-form">
        <img className="auth-mobile-logo" src="/brand/familypulse-logo.svg" alt="FamilyPulse" />
        <div>
          <p className="eyebrow">Household invitation</p>
          <h2 style={{ marginTop: 4 }}>Join {i.householdName}</h2>
          <p className="muted small" style={{ marginTop: 6 }}>
            {i.inviterName ?? 'A member'} invited you as <strong>{ROLE_LABELS[i.role]}</strong>. {ROLE_DESCRIPTIONS[i.role]}
          </p>
        </div>
        {!pending && <div className="form-banner warn">This invitation is {i.status}. Ask for a new link.</div>}
        <FormError error={error} />
        {pending &&
          (me.data ? (
            <>
              <p className="small">
                Signed in as <strong>{me.data.user.email}</strong>.
              </p>
              <Button variant="primary" block loading={loading} onClick={accept}>
                Accept and join
              </Button>
            </>
          ) : (
            <>
              {i.emailRestricted && <p className="small muted">This invitation is tied to a specific email address.</p>}
              <Button variant="primary" block onClick={() => navigate('/register', { state: { from: `/invite/${token}` } })}>
                Create an account to join
              </Button>
              <Button block onClick={() => navigate('/login', { state: { from: `/invite/${token}` } })}>
                I already have an account
              </Button>
            </>
          ))}
      </div>
    </AuthLayout>
  );
}
