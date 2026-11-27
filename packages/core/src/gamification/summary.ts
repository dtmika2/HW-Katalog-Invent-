/**
 * Activity of one person over a period: XP and counts per category and per rule, and per month.
 * Counts are what management understands ("12 vratek"); a count is the number of base entries
 * (bonuses are counted under their own rule, not as extra activity).
 */
import { addMonths, startOfMonth } from '../dates';
import type { Id, IsoDate } from '../types';
import type { RuleId } from './rules';
import type { ActivityCategory, LedgerEntry } from './types';

/** Categories in the order the profile shows them. */
export const ACTIVITY_CATEGORIES: readonly ActivityCategory[] = [
  'packing',
  'shipping',
  'vratka',
  'reports',
  'service',
  'bookings',
  'decisions',
  'talk',
  'loans',
];

export interface Tally {
  xp: number;
  count: number;
}

export interface MonthActivity {
  /** `YYYY-MM`. */
  month: string;
  xp: number;
  byCategory: Record<ActivityCategory, Tally>;
}

export interface ActivitySummary {
  userId: Id;
  xp: number;
  /** Base entries (activity done), bonuses not counted again. */
  count: number;
  byCategory: Record<ActivityCategory, Tally>;
  byRule: Partial<Record<RuleId, Tally>>;
  /** Every month of the period, also months without activity. */
  months: MonthActivity[];
}

const emptyCategories = (): Record<ActivityCategory, Tally> =>
  Object.fromEntries(ACTIVITY_CATEGORIES.map((c) => [c, { xp: 0, count: 0 }])) as Record<
    ActivityCategory,
    Tally
  >;

/**
 * Summary of one person between `from` and `to` (both inclusive). Without them the period runs
 * from the person's first entry to the last one.
 */
export function activitySummary(
  ledger: readonly LedgerEntry[],
  userId: Id,
  from?: IsoDate,
  to?: IsoDate,
): ActivitySummary {
  const mine = ledger.filter(
    (e) => e.userId === userId && (!from || e.on >= from) && (!to || e.on <= to),
  );
  const out: ActivitySummary = {
    userId,
    xp: 0,
    count: 0,
    byCategory: emptyCategories(),
    byRule: {},
    months: [],
  };
  const start = from ?? mine[0]?.on;
  const end = to ?? mine[mine.length - 1]?.on;
  const months = new Map<string, MonthActivity>();
  if (start && end)
    for (let m = startOfMonth(start); m <= end; m = addMonths(m, 1)) {
      const month = m.slice(0, 7);
      months.set(month, { month, xp: 0, byCategory: emptyCategories() });
    }

  for (const e of mine) {
    const base = e.parentId ? 0 : 1;
    out.xp += e.points;
    out.count += base;
    const cat = out.byCategory[e.category];
    cat.xp += e.points;
    cat.count += base;
    const rule = (out.byRule[e.ruleId] ??= { xp: 0, count: 0 });
    rule.xp += e.points;
    rule.count += 1;
    const month = months.get(e.on.slice(0, 7));
    if (month) {
      month.xp += e.points;
      month.byCategory[e.category].xp += e.points;
      month.byCategory[e.category].count += base;
    }
  }
  out.months = [...months.values()];
  return out;
}
