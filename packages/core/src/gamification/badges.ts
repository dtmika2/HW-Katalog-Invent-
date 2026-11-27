/**
 * Badges: earned from the ledger and the state, never awarded by hand. Each badge lists the dated
 * occurrences of one person; a step is earned on the day of its N-th occurrence. Definitions are
 * data, so a new badge needs no UI change (only its Czech name in the app).
 */
import type { AppState, Id, IsoDate } from '../types';
import type { RuleId } from './rules';
import { isPerson, textLength } from './sources/common';
import { TEXT_MIN } from './sources/talk';
import type { LedgerEntry } from './types';

export type BadgeId =
  | 'first.packing'
  | 'first.vratka'
  | 'first.request'
  | 'first.report'
  | 'first.decision'
  | 'carefulVratka'
  | 'completeCases'
  | 'fullCase'
  | 'ahead'
  | 'firstTime'
  | 'sharpEye'
  | 'workshop'
  | 'solver'
  | 'chronicle'
  | 'bridge'
  | 'loansOnTime'
  | 'bigEvent'
  | 'bothWarehouses';

export type BadgeStepTier = 'bronze' | 'silver' | 'gold' | 'single';

interface BadgeContext {
  state: AppState;
  /** The person's own entries, sorted by day. */
  mine: readonly LedgerEntry[];
  userId: Id;
}

export interface BadgeDef {
  id: BadgeId;
  /** Occurrences needed for each step: one step (one-off) or bronze / silver / gold. */
  steps: readonly number[];
  occurrences: (ctx: BadgeContext) => IsoDate[];
}

export interface BadgeProgress {
  id: BadgeId;
  count: number;
  steps: { threshold: number; tier: BadgeStepTier; earnedOn?: IsoDate }[];
  /** Steps earned so far (0 = none). */
  earned: number;
  /** Occurrences needed for the next step, if any. */
  next?: number;
}

/** Vratka bonuses that are voluntary care (on time alone is not enough for "Pečlivá vratka"). */
const CARE: readonly RuleId[] = [
  'vratka.damageDescribed',
  'vratka.extraNote',
  'vratka.unexpected',
  'vratka.photo',
];
const THREE = (a: number, b: number, c: number) => [a, b, c] as const;

const days = (mine: readonly LedgerEntry[], ...rules: RuleId[]) =>
  mine.filter((e) => rules.includes(e.ruleId)).map((e) => e.on);

export const BADGES: readonly BadgeDef[] = [
  { id: 'first.packing', steps: [1], occurrences: ({ mine }) => days(mine, 'pack.packed') },
  { id: 'first.vratka', steps: [1], occurrences: ({ mine }) => days(mine, 'vratka.session') },
  { id: 'first.request', steps: [1], occurrences: ({ mine }) => days(mine, 'booking.submitted') },
  { id: 'first.report', steps: [1], occurrences: ({ mine }) => days(mine, 'report.fault') },
  {
    id: 'first.decision',
    steps: [1],
    occurrences: ({ mine }) => days(mine, 'chief.approved', 'chief.returned'),
  },
  {
    id: 'carefulVratka',
    steps: THREE(10, 50, 200),
    occurrences: ({ mine }) => {
      const children = new Map<string, RuleId[]>();
      for (const e of mine)
        if (e.parentId) children.set(e.parentId, [...(children.get(e.parentId) ?? []), e.ruleId]);
      return mine
        .filter((e) => e.ruleId === 'vratka.session')
        .filter((e) => {
          const c = children.get(e.id) ?? [];
          return c.includes('vratka.onTime') && c.some((r) => CARE.includes(r));
        })
        .map((e) => e.on);
    },
  },
  {
    id: 'completeCases',
    steps: THREE(25, 150, 500),
    occurrences: ({ mine }) => days(mine, 'pack.caseChecked'),
  },
  {
    id: 'fullCase',
    steps: THREE(5, 25, 100),
    occurrences: ({ mine }) => days(mine, 'pack.refilled'),
  },
  {
    id: 'ahead',
    steps: THREE(5, 25, 100),
    occurrences: ({ mine }) => days(mine, 'booking.early', 'booking.veryEarly'),
  },
  {
    id: 'firstTime',
    steps: THREE(5, 25, 100),
    occurrences: ({ mine }) => days(mine, 'booking.firstTime'),
  },
  {
    id: 'sharpEye',
    steps: THREE(3, 15, 50),
    occurrences: ({ mine }) => days(mine, 'report.confirmed'),
  },
  {
    id: 'workshop',
    steps: THREE(5, 25, 100),
    occurrences: ({ mine }) => days(mine, 'service.fixed'),
  },
  {
    id: 'solver',
    steps: THREE(5, 25, 100),
    occurrences: ({ mine }) => days(mine, 'chief.conflictResolved', 'booking.shortageSolved'),
  },
  {
    // Bookings with a note, a file or a message of one's own. Read from the state, because the
    // weekly budget leaves most communication out of the ledger.
    id: 'chronicle',
    steps: THREE(10, 50, 200),
    occurrences: ({ state, userId }) => {
      const first = new Map<Id, IsoDate>();
      const seen = (bookingId: Id, on: IsoDate) => {
        const d = first.get(bookingId);
        if (!d || on < d) first.set(bookingId, on);
      };
      for (const m of state.messages)
        if (!m.event && m.authorId === userId && textLength(m.text) >= TEXT_MIN)
          seen(m.bookingId, m.on);
      for (const a of state.attachments)
        if (a.by === userId && (a.file || textLength(a.text) >= TEXT_MIN)) seen(a.bookingId, a.on);
      return [...first.values()].sort();
    },
  },
  { id: 'bridge', steps: THREE(3, 15, 50), occurrences: ({ mine }) => days(mine, 'ship.transfer') },
  {
    id: 'loansOnTime',
    steps: THREE(5, 25, 100),
    occurrences: ({ mine }) => days(mine, 'loan.returnedOnTime'),
  },
  {
    // One vratka session of 100+ lines that brought everything back.
    id: 'bigEvent',
    steps: [1],
    occurrences: ({ mine }) => {
      const settled = new Set(
        mine.filter((e) => e.ruleId === 'vratka.settled').map((e) => e.parentId),
      );
      return mine
        .filter((e) => e.ruleId === 'vratka.session' && Number(e.params.lines) >= 100)
        .filter((e) => settled.has(e.id))
        .map((e) => e.on);
    },
  },
  {
    // Packed or received lines sourced from both warehouses.
    id: 'bothWarehouses',
    steps: [1],
    occurrences: ({ state, userId }) => {
      const bookings = new Map(state.bookings.map((b) => [b.id, b]));
      const touched: { on: IsoDate; warehouseId: Id }[] = [];
      const add = (bookingId: Id, lineIds: Id[], on: IsoDate) => {
        const b = bookings.get(bookingId);
        if (!b) return;
        for (const id of lineIds) {
          const line = b.lines.find((l) => l.id === id);
          if (line && !('external' in line.target))
            touched.push({ on, warehouseId: line.sourceWarehouseId ?? b.defaultWarehouseId });
        }
      };
      for (const p of state.packings)
        if (p.userId === userId)
          add(
            p.bookingId,
            p.lines.map((l) => l.lineId),
            p.on,
          );
      for (const s of state.returnSessions)
        if (s.userId === userId)
          add(
            s.bookingId,
            s.lines.map((l) => l.lineId),
            s.on,
          );
      touched.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
      const seen = new Set<Id>();
      for (const t of touched) {
        seen.add(t.warehouseId);
        if (seen.size >= 2) return [t.on];
      }
      return [];
    },
  },
];

const TIERS_OF: Record<number, readonly BadgeStepTier[]> = {
  1: ['single'],
  3: ['bronze', 'silver', 'gold'],
};

/** Every badge with its progress for one person. */
export function badgeProgress(
  state: AppState,
  ledger: readonly LedgerEntry[],
  userId: Id,
): BadgeProgress[] {
  if (!isPerson(userId)) return [];
  const mine = ledger.filter((e) => e.userId === userId);
  return BADGES.map((def) => {
    const occ = def.occurrences({ state, mine, userId }).sort();
    const tiers = TIERS_OF[def.steps.length] ?? def.steps.map(() => 'single' as const);
    const steps = def.steps.map((threshold, i) => {
      const s: BadgeProgress['steps'][number] = { threshold, tier: tiers[i] ?? 'single' };
      const on = occ[threshold - 1];
      if (on) s.earnedOn = on;
      return s;
    });
    const earned = steps.filter((s) => s.earnedOn).length;
    const p: BadgeProgress = { id: def.id, count: occ.length, steps, earned };
    const next = def.steps[earned];
    if (next !== undefined) p.next = next;
    return p;
  });
}
