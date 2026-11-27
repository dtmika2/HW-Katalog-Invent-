/**
 * Gamification in the app: the ledger (derived from the state, cached per state object) and what
 * each person has already been shown. Kept in its own localStorage key, apart from the prototype
 * state, so gamification never changes the catalogue's data.
 */
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import {
  badgeProgress,
  computeLedger,
  levelFor,
  totalPoints,
  type AppState,
  type BadgeProgress,
  type LedgerEntry,
  type LevelInfo,
} from '@quix/core';
import { useAppState, useUser } from './index';
import { STORAGE_SUFFIX } from '../lib/storage';

export const GAMIFICATION_KEY = `quix-gamification${STORAGE_SUFFIX}`;

/** What one person has been shown. */
export interface SeenRecord {
  /** Entries already announced next to the meter. */
  announced: string[];
  /** Entries already seen on the profile. */
  viewed: string[];
  /** Badge steps already announced ("completeCases:2"). */
  badges: string[];
  /** Highest level already announced. */
  level: number;
}

interface Prefs {
  v: 1;
  users: Record<string, SeenRecord>;
  /** People who switched levels and points off ("Zobrazovat úrovně a body"). Survives new demo data. */
  off?: Record<string, boolean>;
  /** Grammatical form of each person's title ("Rytíř" / "Rytířka"). Survives new demo data. */
  form?: Record<string, 'm' | 'f'>;
}

const EMPTY: Prefs = { v: 1, users: {} };

function read(): Prefs {
  try {
    const raw = globalThis.localStorage?.getItem(GAMIFICATION_KEY);
    const p = raw ? (JSON.parse(raw) as Prefs) : undefined;
    return p?.v === 1 && p.users ? p : EMPTY;
  } catch {
    return EMPTY;
  }
}

function write(p: Prefs): void {
  try {
    globalThis.localStorage?.setItem(GAMIFICATION_KEY, JSON.stringify(p));
  } catch {
    /* storage full or blocked: gamification works without it, only announces again */
  }
}

interface GamificationStore {
  prefs: Prefs;
  /** Replace one person's record. */
  put: (userId: string, rec: SeenRecord) => void;
  /** Forget what was shown (new demo data: nothing of it is "new"); the off switches stay. */
  clear: () => void;
  /** Switch levels and points off or on for one person; on again starts fresh (no flood). */
  setOff: (userId: string, off: boolean) => void;
  setForm: (userId: string, form: 'm' | 'f') => void;
}

export const useGamificationStore = create<GamificationStore>()((set, get) => ({
  prefs: read(),
  put: (userId, rec) => {
    const prefs: Prefs = { ...get().prefs, users: { ...get().prefs.users, [userId]: rec } };
    write(prefs);
    set({ prefs });
  },
  clear: () => {
    const { off, form } = get().prefs;
    const prefs: Prefs = { v: 1, users: {}, ...(off ? { off } : {}), ...(form ? { form } : {}) };
    write(prefs);
    set({ prefs });
  },
  setOff: (userId, isOff) => {
    const users = { ...get().prefs.users };
    if (!isOff) delete users[userId];
    const prefs: Prefs = { ...get().prefs, users, off: { ...get().prefs.off, [userId]: isOff } };
    write(prefs);
    set({ prefs });
  },
  setForm: (userId, form) => {
    const prefs: Prefs = { ...get().prefs, form: { ...get().prefs.form, [userId]: form } };
    write(prefs);
    set({ prefs });
  },
}));

/** Called when demo data is (re)loaded. */
export function clearGamification(): void {
  useGamificationStore.getState().clear();
}

const ledgers = new WeakMap<AppState, LedgerEntry[]>();

/** The ledger of a state, computed once per state object. */
export function ledgerOf(state: AppState): LedgerEntry[] {
  let l = ledgers.get(state);
  if (!l) {
    l = computeLedger(state);
    ledgers.set(state, l);
  }
  return l;
}

export function useLedger(): LedgerEntry[] {
  return ledgerOf(useAppState());
}

export const badgeKeys = (badges: readonly BadgeProgress[]): string[] =>
  badges.flatMap((b) => b.steps.flatMap((s, i) => (s.earnedOn ? [`${b.id}:${i + 1}`] : [])));

export interface MyProgress {
  userId: string;
  mine: LedgerEntry[];
  total: number;
  level: LevelInfo;
  badges: BadgeProgress[];
  /** What this person has been shown (undefined until the first view). */
  seen: SeenRecord | undefined;
}

/** A person's chosen form of their title (masculine until chosen). */
export function useTitleForm(userId: string): 'm' | 'f' {
  return useGamificationStore((p) => p.prefs.form?.[userId] ?? 'm');
}

/** Whether a person switched levels and points off. */
export function useDisplayOff(userId: string): boolean {
  return useGamificationStore((p) => !!p.prefs.off?.[userId]);
}

/**
 * A person's points, level and badges, and what they have been shown. `track` is false when
 * somebody else looks at the profile: their own "seen" record must not be started or changed.
 */
export function useMyProgress(userId?: string, track = true): MyProgress {
  const state = useAppState();
  const me = useUser();
  const id = userId ?? me.id;
  const ledger = ledgerOf(state);
  const seen = useGamificationStore((p) => p.prefs.users[id]);
  const put = useGamificationStore((p) => p.put);
  const derived = useMemo(() => {
    const mine = ledger.filter((e) => e.userId === id);
    const total = totalPoints(mine, id);
    return { mine, total, level: levelFor(total), badges: badgeProgress(state, ledger, id) };
  }, [state, ledger, id]);

  // The first time a person is shown, everything so far counts as seen: no flood of "new" points.
  useEffect(() => {
    if (seen || !track) return;
    const ids = derived.mine.map((e) => e.id);
    put(id, {
      announced: ids,
      viewed: ids,
      badges: badgeKeys(derived.badges),
      level: derived.level.level,
    });
  }, [seen, id, derived, put, track]);

  return { userId: id, ...derived, seen };
}
