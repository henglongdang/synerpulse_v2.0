import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, AtSign, Bell, CalendarClock, CheckCheck, Gauge, MessageSquare, PartyPopper, TrendingDown, Trash2, UserPlus, Users, Zap } from 'lucide-react';
import type { NotificationDTO, NotificationType } from '@familypulse/shared';
import { api } from '../../lib/api';
import { useHousehold } from '../../lib/session';
import { relativeTime } from '../../lib/format';
import { Button, EmptyState, ErrorState, Skeleton } from '../../components/ui';

const ICONS: Record<NotificationType, typeof Bell> = {
  budget_threshold: Gauge,
  budget_exceeded: AlertOctagon,
  bill_due: CalendarClock,
  forecast_deficit: TrendingDown,
  goal_reached: PartyPopper,
  goal_milestone: PartyPopper,
  mention: AtSign,
  comment: MessageSquare,
  member_joined: UserPlus,
  role_changed: Users,
  rule_applied: Zap,
  system: Bell,
};

export default function NotificationsPage() {
  const { me, switchHousehold, household } = useHousehold();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<{ items: NotificationDTO[]; unread: number }>('/notifications?limit=100') });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    void qc.invalidateQueries({ queryKey: ['me'] });
  };
  async function open(n: NotificationDTO) {
    if (!n.readAt) await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
    refresh();
    if (n.householdId && n.householdId !== household.id && me.households.some((h) => h.id === n.householdId)) await switchHousehold(n.householdId);
    if (n.link) navigate(n.link);
  }
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>
            Alerts about budgets, bills and the forecast, plus mentions and changes to your access. Adjust them in <Link to="/settings#alerts">Settings</Link>.
          </p>
        </div>
        {(q.data?.unread ?? 0) > 0 && (
          <Button
            icon={<CheckCheck size={16} />}
            onClick={async () => {
              await api.post('/notifications/read-all');
              refresh();
            }}
          >
            Mark all read
          </Button>
        )}
      </div>
      <section className="card" style={{ maxWidth: 820 }}>
        {q.isLoading ? (
          <div className="card-body stack-sm">
            <Skeleton h={48} />
            <Skeleton h={48} />
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.data!.items.length === 0 ? (
          <EmptyState icon={<Bell size={22} />} title="You’re all caught up">
            We’ll let you know when a budget is close to its limit, a bill is due, cash may run short, or someone mentions you.
          </EmptyState>
        ) : (
          <ul className="list">
            {q.data!.items.map((n) => {
              const Icon = ICONS[n.type] ?? Bell;
              return (
                <li key={n.id} className={`notif ${n.readAt ? '' : 'unread'}`}>
                  <button className="row row-button" onClick={() => open(n)} style={{ alignItems: 'flex-start' }}>
                    <span className="cat-icon" style={n.type === 'budget_exceeded' || n.type === 'forecast_deficit' ? { color: 'var(--crit-600)' } : undefined}>
                      <Icon size={18} />
                    </span>
                    <div className="row-main" style={{ whiteSpace: 'normal' }}>
                      <div style={{ fontWeight: n.readAt ? 500 : 600 }}>{n.title}</div>
                      <div className="small muted">{n.body}</div>
                      <div className="xs muted" style={{ marginTop: 2 }}>
                        {relativeTime(n.createdAt)}
                        {n.householdId && me.households.length > 1 ? ` · ${me.households.find((h) => h.id === n.householdId)?.name ?? ''}` : ''}
                      </div>
                    </div>
                    {!n.readAt && <span className="unread-dot" aria-label="Unread" />}
                  </button>
                  <button
                    className="icon-btn icon-btn-sm notif-del"
                    aria-label="Dismiss notification"
                    onClick={async () => {
                      await api.delete(`/notifications/${n.id}`);
                      refresh();
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
