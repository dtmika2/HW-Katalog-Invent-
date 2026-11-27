/**
 * Gamification types. Points are derived from records the system already keeps; nothing here is
 * stored in `AppState`.
 */
import type { Id, IsoDate, Params } from '../types';
import type { RuleId } from './rules';

/** Profile groups of activity (Czech labels live in the app). */
export type ActivityCategory =
  | 'packing'
  | 'shipping'
  | 'vratka'
  | 'reports'
  | 'service'
  | 'bookings'
  | 'decisions'
  | 'talk'
  | 'loans';

export interface RuleDef {
  category: ActivityCategory;
  /** Points for one occurrence. */
  points: number;
  /** Extra points per counted unit (pieces, lines, cases): `points` per `every` units, at most `max`. */
  perUnit?: { points: number; every?: number; max?: number };
  /** A quality bonus: something done on top of what the system requires. */
  bonus?: true;
  /** At most this many entries of the rule per person and day, per person, booking and day, or per subject. */
  caps?: { perDay?: number; perBookingDay?: number; perSubject?: number };
}

/** One reason for points. */
export interface LedgerEntry {
  /** Stable, built from the source record: the same state always gives the same ids. */
  id: string;
  userId: Id;
  on: IsoDate;
  ruleId: RuleId;
  /** Always more than zero. */
  points: number;
  category: ActivityCategory;
  /** The entry this one belongs to (a bonus under its base entry). */
  parentId?: string;
  bookingId?: Id;
  /** Values for the Czech text: counts, labels. */
  params: Params;
}

/** What a source produces before points, caps and sorting. */
export interface Draft {
  id: string;
  userId: Id;
  on: IsoDate;
  ruleId: RuleId;
  parentId?: string;
  bookingId?: Id;
  /** Counted units for `perUnit` rules. */
  units?: number;
  /** What `caps.perSubject` counts per (a service case, …). */
  subject?: string;
  params?: Params;
}

export interface LedgerOptions {
  /** Entries before this day are left out (a real launch starts everybody at zero). */
  countFrom?: IsoDate;
}
