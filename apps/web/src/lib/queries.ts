import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { AccountDTO, CategoryDTO, GoalDTO, MemberDTO, RecurringDTO } from '@familypulse/shared';
import { api } from './api';
import { useHousehold } from './session';

/** Invalidate every query belonging to the current household (+ the notification badge). */
export function useInvalidate() {
  const qc = useQueryClient();
  const { hid } = useHousehold();
  return useCallback(() => {
    void qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(hid) });
    void qc.invalidateQueries({ queryKey: ['me'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  }, [qc, hid]);
}

export function useAccounts(includeArchived = false) {
  const { hid, base } = useHousehold();
  return useQuery({
    queryKey: ['accounts', hid, includeArchived],
    queryFn: () => api.get<{ accounts: AccountDTO[] }>(`${base}/accounts${includeArchived ? '?includeArchived=true' : ''}`).then((r) => r.accounts),
  });
}

export function useHouseholdDetail() {
  const { hid, base } = useHousehold();
  return useQuery({
    queryKey: ['household', hid],
    queryFn: () => api.get<{ household: { id: string; name: string; currency: string; role: string; categoryScope: string[] }; members: MemberDTO[] }>(base),
    staleTime: 60_000,
  });
}

export function useCategories() {
  const { hid, base } = useHousehold();
  return useQuery({
    queryKey: ['categories', hid],
    queryFn: () => api.get<{ categories: CategoryDTO[] }>(`${base}/categories`).then((r) => r.categories),
    staleTime: 5 * 60_000,
  });
}

export function useMembers() {
  const { hid, base } = useHousehold();
  return useQuery({
    queryKey: ['members', hid],
    queryFn: () => api.get<{ members: MemberDTO[] }>(`${base}/members`).then((r) => r.members),
    staleTime: 60_000,
  });
}

export function useGoals() {
  const { hid, base } = useHousehold();
  return useQuery({ queryKey: ['goals', hid], queryFn: () => api.get<{ goals: GoalDTO[] }>(`${base}/goals`).then((r) => r.goals) });
}

export function useRecurring() {
  const { hid, base } = useHousehold();
  return useQuery({ queryKey: ['recurring', hid], queryFn: () => api.get<{ items: RecurringDTO[] }>(`${base}/recurring`).then((r) => r.items) });
}
