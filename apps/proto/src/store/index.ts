/**
 * App store: the whole core `AppState` plus prototype controls (current user, scenario,
 * simulated today). Every change goes through core functions; the store never edits records.
 */
import { create } from 'zustand';
import {
  markRead,
  runDailyJobs,
  type AppState,
  type DomainError,
  type Result,
  type User,
} from '@quix/core';
import { DEMO_TODAY, SCENARIOS, type ScenarioId } from '@quix/fixtures';
import { cs } from '../i18n/cs';

const STORAGE_KEY = 'quix-hw-proto-v1';

export interface Toast {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}

export interface ProtoState {
  state: AppState | null;
  scenarioId: ScenarioId;
  today: string;
  userId: string;
  toasts: Toast[];
  /** Load a scenario from fixtures (synchronous). */
  loadScenario: (id: ScenarioId) => void;
  /** Restore from localStorage or build the default scenario. */
  init: () => void;
  setUser: (id: string) => void;
  setToday: (d: string) => void;
  /** Apply a core action; on error shows a toast and returns the error. */
  run: (action: (s: AppState) => Result<AppState>, okText?: string) => DomainError | undefined;
  /** Replace the state directly (pure helpers that cannot fail). */
  apply: (fn: (s: AppState) => AppState) => void;
  runJobs: () => { created: number; expired: number };
  markAllRead: () => void;
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
}

interface Persisted {
  state: AppState;
  scenarioId: ScenarioId;
  today: string;
  userId: string;
}

function readPersisted(): Persisted | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const p = JSON.parse(raw) as Persisted;
    return p.state && p.scenarioId ? p : undefined;
  } catch {
    return undefined;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist(p: Persisted): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(p));
    } catch {
      /* storage full or blocked: the prototype works without it */
    }
  }, 300);
}

export function clearPersisted(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

let toastSeq = 0;

export const useProto = create<ProtoState>()((set, get) => ({
  state: null,
  scenarioId: 'galaDinner',
  today: DEMO_TODAY,
  userId: 'u-petr',
  toasts: [],

  loadScenario: (id) => {
    const sc = SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
    if (!sc) return;
    const state = sc.build();
    const userId = sc.focus?.userId ?? get().userId;
    set({ state, scenarioId: sc.id, today: DEMO_TODAY, userId });
  },

  init: () => {
    if (get().state) return;
    const p = readPersisted();
    if (p) set({ state: p.state, scenarioId: p.scenarioId, today: p.today, userId: p.userId });
    else get().loadScenario('galaDinner');
  },

  setUser: (userId) => set({ userId }),
  setToday: (today) => set({ today }),

  run: (action, okText) => {
    const s = get().state;
    if (!s) return { code: 'not_found', message: 'No state' };
    const r = action(s);
    if (!r.ok) {
      get().toast('error', cs.errors[r.error.code] ?? r.error.message);
      return r.error;
    }
    set({ state: r.value });
    if (okText) get().toast('ok', okText);
    return undefined;
  },

  apply: (fn) => {
    const s = get().state;
    if (s) set({ state: fn(s) });
  },

  runJobs: () => {
    const s = get().state;
    if (!s) return { created: 0, expired: 0 };
    const r = runDailyJobs(s, get().today);
    set({ state: r.state });
    return { created: r.notifications.length, expired: r.expired.length };
  },

  markAllRead: () => {
    const s = get().state;
    if (s) set({ state: markRead(s, get().userId) });
  },

  toast: (kind, text) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

useProto.subscribe((s) => {
  if (s.state)
    persist({ state: s.state, scenarioId: s.scenarioId, today: s.today, userId: s.userId });
});

/** The loaded state (components below the loader can rely on it). */
export function useAppState(): AppState {
  const s = useProto((p) => p.state);
  if (!s) throw new Error('State not loaded');
  return s;
}

/** The current user. */
export function useUser(): User {
  const s = useAppState();
  const id = useProto((p) => p.userId);
  return s.users.find((u) => u.id === id) ?? (s.users[0] as User);
}

export function useToday(): string {
  return useProto((p) => p.today);
}
