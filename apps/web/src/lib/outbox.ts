/**
 * Offline outbox for new ledger entries.
 *
 * When the network is unavailable, a new entry is stored locally (IndexedDB) with a client-generated
 * idempotency key and shown in the ledger as "Waiting to sync" — never mixed with confirmed data.
 * When connectivity returns the queue is replayed; the server de-duplicates on the key, so a retry
 * after a lost response can never create a duplicate. Entries the server rejects (e.g. the account
 * was archived meanwhile) are kept as "Needs attention" for the user to fix or discard.
 *
 * Only entries the user typed while offline are stored, and the queue is wiped on sign-out.
 */
import { createStore, del, entries, set, clear } from 'idb-keyval';
import { useEffect, useState } from 'react';
import { api, ApiError } from './api';

export interface PendingEntry {
  id: string; // = clientRequestId
  householdId: string;
  payload: Record<string, unknown>;
  display: { description: string; amountCents: number; date: string; accountName: string; categoryName: string | null };
  createdAt: string;
  status: 'pending' | 'failed';
  error?: string;
}

let store: ReturnType<typeof createStore> | null = null;
const getStore = () => (store ??= createStore('synerpulse', 'outbox'));
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function listOutbox(householdId?: string): Promise<PendingEntry[]> {
  try {
    const all = (await entries<string, PendingEntry>(getStore())).map(([, v]) => v);
    return all.filter((e) => !householdId || e.householdId === householdId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return []; // IndexedDB unavailable (private mode) — outbox simply stays empty
  }
}

export async function enqueue(entry: Omit<PendingEntry, 'createdAt' | 'status'>): Promise<void> {
  await set(entry.id, { ...entry, createdAt: new Date().toISOString(), status: 'pending' } satisfies PendingEntry, getStore());
  emit();
}

export async function discard(id: string): Promise<void> {
  await del(id, getStore());
  emit();
}

export async function clearOutbox(): Promise<void> {
  try {
    await clear(getStore());
  } catch {
    /* ignore */
  }
  emit();
}

let flushing = false;
/** Replay queued entries. Returns the number synced. */
export async function flushOutbox(): Promise<number> {
  if (flushing || (typeof navigator !== 'undefined' && !navigator.onLine)) return 0;
  flushing = true;
  let synced = 0;
  try {
    for (const e of await listOutbox()) {
      if (e.status === 'failed') continue;
      try {
        await api.post(`/households/${e.householdId}/transactions`, e.payload);
        await del(e.id, getStore());
        synced++;
      } catch (err) {
        if (err instanceof ApiError && err.isNetwork) break; // still offline — try again later
        await set(e.id, { ...e, status: 'failed', error: err instanceof Error ? err.message : 'Could not sync' } satisfies PendingEntry, getStore());
      }
    }
  } finally {
    flushing = false;
    emit();
  }
  return synced;
}

export async function retry(id: string): Promise<void> {
  const all = await listOutbox();
  const e = all.find((x) => x.id === id);
  if (!e) return;
  await set(id, { ...e, status: 'pending', error: undefined }, getStore());
  emit();
  await flushOutbox();
}

export function useOutbox(householdId: string): PendingEntry[] {
  const [items, setItems] = useState<PendingEntry[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => void listOutbox(householdId).then((x) => alive && setItems(x));
    load();
    listeners.add(load);
    return () => {
      alive = false;
      listeners.delete(load);
    };
  }, [householdId]);
  return items;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
