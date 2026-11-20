import { useInfiniteQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import type { ActivityDTO } from '@synerpulse/shared/client';
import { api, qs } from '../../lib/api';
import { useHousehold } from '../../lib/session';
import { relativeTime } from '../../lib/format';
import { Avatar, Button, EmptyState, ErrorState, Skeleton } from '../../components/ui';

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function ActivityPage() {
  const { base, hid, household } = useHousehold();
  const q = useInfiniteQuery({
    queryKey: ['activity', hid],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<{ items: ActivityDTO[]; nextBefore: string | null }>(`${base}/activity${qs({ before: pageParam, limit: 40 })}`),
    getNextPageParam: (last) => last.nextBefore,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  let lastDay = '';
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p>Everything that changed in {household.name}, and who changed it. Events about private accounts are shown only to their owner.</p>
        </div>
      </div>
      <section className="card" style={{ maxWidth: 820 }}>
        {q.isLoading ? (
          <div className="card-body stack-sm">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} h={40} />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon={<Activity size={22} />} title="No activity yet">
            Entries, edits, comments, budget changes and member updates will appear here.
          </EmptyState>
        ) : (
          <ul className="list">
            {items.map((a) => {
              const day = dayKey(a.createdAt);
              const head = day !== lastDay;
              lastDay = day;
              return (
                <li key={a.id}>
                  {head && <div className="day-head">{day}</div>}
                  <div className="row" style={{ alignItems: 'flex-start' }}>
                    {a.actor ? <Avatar id={a.actor.id} name={a.actor.name} /> : <span className="avatar">·</span>}
                    <div className="row-main small" style={{ whiteSpace: 'normal' }}>
                      <strong>{a.actor?.name ?? 'A former member'}</strong> {a.summary}
                      <div className="xs muted">
                        {relativeTime(a.createdAt)} · {new Date(a.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {q.hasNextPage && (
          <div className="card-foot" style={{ justifyContent: 'center' }}>
            <Button size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
              Load older activity
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
