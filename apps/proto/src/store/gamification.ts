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

export const GAMIFICATION_KEY = 'quix-gamification';

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
  /** Forget everything (new demo data: nothing of it is "new"). */
  clear: () => void;
}

export const useGamificationStore = create<GamificationStore>()((set, get) => ({
  prefs: read(),
  put: (userId, rec) => {
    const prefs: Prefs = { v: 1, users: { ...get().prefs.users, [userId]: rec } };
    write(prefs);
    set({ prefs });
  },
  clear: () => {
    try {
      globalThis.localStorage?.removeItem(GAMIFICATION_KEY);
    } catch {
      /* ignore */
    }
    set({ prefs: EMPTY });
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

/** The current person's points, level and badges, and what they have been shown. */
export function useMyProgress(userId?: string): MyProgress {
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
    if (seen) return;
    const ids = derived.mine.map((e) => e.id);
    put(id, {
      announced: ids,
      viewed: ids,
      badges: badgeKeys(derived.badges),
      level: derived.level.level,
    });
  }, [seen, id, derived, put]);

  return { userId: id, ...derived, seen };
}
