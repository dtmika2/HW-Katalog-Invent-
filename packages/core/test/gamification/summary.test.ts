import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_CATEGORIES,
  activitySummary,
  RULES,
  type LedgerEntry,
  type RuleId,
} from '../../src';

let n = 0;
const e = (
  ruleId: RuleId,
  on: string,
  points: number,
  extra: Partial<LedgerEntry> = {},
): LedgerEntry => ({
  id: `${ruleId}:${++n}`,
  userId: 'u-a',
  on,
  ruleId,
  points,
  category: RULES[ruleId].category,
  params: {},
  ...extra,
});

const s1 = e('vratka.session', '2027-03-10', 20);
const ledger: LedgerEntry[] = [
  s1,
  e('vratka.onTime', '2027-03-10', 5, { parentId: s1.id }),
  e('ship.delivery', '2027-03-28', 10),
  e('ship.delivery', '2027-05-02', 10),
  e('ship.delivery', '2027-05-03', 10, { userId: 'u-b' }),
];

describe('gamification: activity summary', () => {
  it('adds up XP and counts activity: a bonus adds XP but is not another activity', () => {
    const s = activitySummary(ledger, 'u-a');
    expect(s.xp).toBe(45);
    expect(s.count).toBe(3);
    expect(s.byCategory.vratka).toEqual({ xp: 25, count: 1 });
    expect(s.byCategory.shipping).toEqual({ xp: 20, count: 2 });
    expect(s.byRule['vratka.onTime']).toEqual({ xp: 5, count: 1 });
  });

  it('lists every category, also the empty ones, in profile order', () => {
    const s = activitySummary(ledger, 'u-a');
    expect(Object.keys(s.byCategory)).toEqual([...ACTIVITY_CATEGORIES]);
    expect(s.byCategory.talk).toEqual({ xp: 0, count: 0 });
  });

  it('lists every month of the period, also months without activity', () => {
    const s = activitySummary(ledger, 'u-a');
    expect(s.months.map((m) => [m.month, m.xp])).toEqual([
      ['2027-03', 35],
      ['2027-04', 0],
      ['2027-05', 10],
    ]);
    expect(s.months[0]?.byCategory.vratka).toEqual({ xp: 25, count: 1 });
  });

  it('a period (both days inclusive) limits the entries and the months', () => {
    const s = activitySummary(ledger, 'u-a', '2027-03-28', '2027-04-30');
    expect(s.xp).toBe(10);
    expect(s.months.map((m) => m.month)).toEqual(['2027-03', '2027-04']);
  });

  it('a person without entries has an empty summary', () => {
    const s = activitySummary(ledger, 'u-nobody');
    expect(s).toMatchObject({ xp: 0, count: 0, months: [] });
    expect(activitySummary(ledger, 'u-nobody', '2027-01-01', '2027-02-15').months).toHaveLength(2);
  });
});
