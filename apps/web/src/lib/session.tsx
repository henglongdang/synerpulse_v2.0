import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { can, type Capability, type HouseholdSummaryDTO, type MeDTO, type Scope } from '@familypulse/shared/client';
import { api } from './api';
import { clearOutbox } from './outbox';

export const meKey = ['me'] as const;

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: () => api.get<{ me: MeDTO | null }>('/auth/session').then((r) => r.me),
    staleTime: 30_000,
    refetchInterval: 60_000, // keeps the notification badge fresh
  });
}

interface HouseholdCtx {
  me: MeDTO;
  household: HouseholdSummaryDTO;
  hid: string;
  base: string;
  currency: string;
  can(cap: Capability): boolean;
  scope: Scope;
  setScope(s: Scope): void;
  switchHousehold(id: string): Promise<void>;
}

const Ctx = createContext<HouseholdCtx | null>(null);

function readScope(): Scope {
  try {
    return localStorage.getItem('fp.scope') === 'personal' ? 'personal' : 'household';
  } catch {
    return 'household';
  }
}

export function HouseholdProvider({ me, children }: { me: MeDTO; children: ReactNode }) {
  const qc = useQueryClient();
  const [scope, setScopeState] = useState<Scope>(readScope);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const household = me.households.find((h) => h.id === selectedId) ?? me.households[0];

  useEffect(() => {
    if (selectedId && !me.households.some((h) => h.id === selectedId)) setSelectedId(null);
  }, [me.households, selectedId]);

  const setScope = useCallback((s: Scope) => {
    setScopeState(s);
    try {
      localStorage.setItem('fp.scope', s);
    } catch {
      /* storage unavailable — keep in memory */
    }
  }, []);

  const switchHousehold = useCallback(
    async (id: string) => {
      setSelectedId(id);
      await api.post('/auth/me/last-household', { householdId: id }).catch(() => undefined);
      await qc.invalidateQueries();
    },
    [qc],
  );

  const value = useMemo<HouseholdCtx>(
    () => ({
      me,
      household,
      hid: household.id,
      base: `/households/${household.id}`,
      currency: household.currency,
      can: (cap) => can(household.role, cap),
      scope,
      setScope,
      switchHousehold,
    }),
    [me, household, scope, setScope, switchHousehold],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHousehold(): HouseholdCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('HouseholdProvider missing');
  return c;
}

export async function signOut(qc: ReturnType<typeof useQueryClient>) {
  await api.post('/auth/logout').catch(() => undefined);
  await clearOutbox(); // pending offline entries never outlive the session
  qc.clear();
  qc.setQueryData(meKey, null);
}
