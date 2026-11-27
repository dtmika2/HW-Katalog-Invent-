/**
 * The points table, as data. See `docs/gamification-plan.md` ("What earns points") for where each
 * rule's facts come from and why the excluded ones are excluded.
 */
import type { PoolId, RuleDef } from './types';

/**
 * Weekly budgets of points per person (Monday to Sunday). Communication supports the work, so all
 * of it together counts up to this much a week, however much is written.
 */
export const POOLS: Record<PoolId, { perWeek: number }> = {
  talk: { perWeek: 4 },
};

export const RULES = {
  // Warehouse: packing and shipping
  'pack.packed': { category: 'packing', points: 5, perUnit: { points: 1, every: 5, max: 15 } },
  'pack.caseChecked': { category: 'packing', points: 2 },
  'pack.refilled': { category: 'packing', points: 3, bonus: true },
  'ship.delivery': { category: 'shipping', points: 10 },
  'ship.transfer': { category: 'shipping', points: 8 },
  'ship.lateRecorded': { category: 'shipping', points: 3 },

  // Warehouse: vratka
  'vratka.session': { category: 'vratka', points: 10, perUnit: { points: 1, max: 25 } },
  'vratka.caseCounted': { category: 'vratka', points: 0, perUnit: { points: 2 } },
  'vratka.settled': { category: 'vratka', points: 10 },
  'vratka.damageDescribed': {
    category: 'vratka',
    points: 0,
    perUnit: { points: 2, max: 10 },
    bonus: true,
  },
  'vratka.extraNote': {
    category: 'vratka',
    points: 0,
    perUnit: { points: 1, max: 5 },
    bonus: true,
  },
  'vratka.unexpected': {
    category: 'vratka',
    points: 0,
    perUnit: { points: 3, max: 15 },
    bonus: true,
  },
  'vratka.photo': { category: 'vratka', points: 3, bonus: true },
  'vratka.onTime': { category: 'vratka', points: 5, bonus: true },

  // Reporting problems and service
  'report.fault': { category: 'reports', points: 8 },
  'report.confirmed': { category: 'reports', points: 5, bonus: true },
  'service.progress': { category: 'service', points: 3, caps: { perSubject: 5 } },
  'service.fixed': { category: 'service', points: 10 },
  'issue.resolved': { category: 'service', points: 6 },

  // Project managers: bookings
  'booking.created': { category: 'bookings', points: 4 },
  'booking.submitted': { category: 'bookings', points: 8 },
  'booking.early': { category: 'bookings', points: 6, bonus: true },
  'booking.veryEarly': { category: 'bookings', points: 10, bonus: true },
  'booking.purpose': { category: 'bookings', points: 3, bonus: true },
  'booking.client': { category: 'bookings', points: 2, bonus: true },
  'booking.firstTime': { category: 'bookings', points: 5, bonus: true },
  'booking.organised': { category: 'bookings', points: 3, bonus: true },
  'booking.shortageSolved': { category: 'bookings', points: 8 },
  'booking.completed': { category: 'bookings', points: 12 },

  // Chief: decisions, and closing a returned order
  'chief.approved': { category: 'decisions', points: 14 },
  'chief.quick': { category: 'decisions', points: 3, bonus: true },
  'chief.returned': { category: 'decisions', points: 5 },
  'chief.conflictResolved': { category: 'decisions', points: 10 },
  'booking.closedBy': { category: 'vratka', points: 3 },
  'client.created': { category: 'bookings', points: 3 },

  // Communication (one weekly budget for all of it, see POOLS)
  'talk.message': { category: 'talk', points: 1, pool: 'talk' },
  'talk.reply': { category: 'talk', points: 1, pool: 'talk' },
  'talk.note': { category: 'talk', points: 2, pool: 'talk' },
  'talk.file': { category: 'talk', points: 2, pool: 'talk' },

  // Loans
  'loan.recorded': { category: 'loans', points: 2 },
  'loan.returnedOnTime': { category: 'loans', points: 3 },
  'loan.returnedFor': { category: 'loans', points: 2 },
} as const satisfies Record<string, RuleDef>;

export type RuleId = keyof typeof RULES;

export const RULE_IDS = Object.keys(RULES) as RuleId[];

/** Points of one occurrence with `units` counted units. */
export function rulePoints(ruleId: RuleId, units = 0): number {
  const r: RuleDef = RULES[ruleId];
  if (!r.perUnit) return r.points;
  const steps = Math.floor(Math.max(0, units) / (r.perUnit.every ?? 1));
  const extra = steps * r.perUnit.points;
  return r.points + (r.perUnit.max === undefined ? extra : Math.min(r.perUnit.max, extra));
}
