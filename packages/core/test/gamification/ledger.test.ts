import { describe, expect, it } from 'vitest';
import {
  computeLedger,
  packLines,
  rulePoints,
  RULE_IDS,
  RULES,
  totalPoints,
  unwrap,
  type AppState,
} from '../../src';
import { baseState, item, ln, order, U, withBookings } from '../helpers';
import { msg, withMessages } from './helpers';

const T = '2027-04-22';

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function busy(): AppState {
  const s0 = withBookings(
    baseState(),
    order({ id: 'o1', status: 'packing', lines: [ln('l1', item('ledbeam'), 10)] }),
  );
  const s1 = unwrap(packLines(s0, U.martin, T, 'o1', [{ lineId: 'l1', qty: 10 }]));
  return withMessages(
    s1,
    msg('o1', U.petr.id, '2027-04-20', 'Prosím o dva kusy navíc do rezervy'),
    msg('o1', U.tomas.id, '2027-04-21', 'Přidáno, sklad o tom ví'),
  );
}

describe('gamification: the ledger', () => {
  it('rulePoints adds per-unit points by steps and stops at the maximum', () => {
    expect(rulePoints('pack.packed', 0)).toBe(5);
    expect(rulePoints('pack.packed', 4)).toBe(5);
    expect(rulePoints('pack.packed', 5)).toBe(6);
    expect(rulePoints('pack.packed', 1000)).toBe(20);
    expect(rulePoints('vratka.caseCounted', 7)).toBe(14);
    expect(rulePoints('ship.delivery', 3)).toBe(10);
  });

  it('every rule has a category and never gives negative points', () => {
    for (const id of RULE_IDS) {
      expect(RULES[id].category).toBeTruthy();
      expect(rulePoints(id, 0)).toBeGreaterThanOrEqual(0);
      expect(rulePoints(id, 3)).toBeGreaterThan(0);
    }
  });

  it('is derived: the same state gives the same ledger, and the state is not changed', () => {
    const s = deepFreeze(busy());
    const a = computeLedger(s);
    expect(a.length).toBeGreaterThan(0);
    expect(computeLedger(s)).toEqual(a);
  });

  it('entries are sorted by day and have unique ids and points above zero', () => {
    const l = computeLedger(busy());
    expect(l.map((e) => e.on)).toEqual([...l.map((e) => e.on)].sort());
    expect(new Set(l.map((e) => e.id)).size).toBe(l.length);
    expect(l.every((e) => e.points > 0)).toBe(true);
  });

  it('countFrom leaves out entries before the launch day', () => {
    const l = computeLedger(busy(), { countFrom: '2027-04-21' });
    expect(l.length).toBeGreaterThan(0);
    expect(l.every((e) => e.on >= '2027-04-21')).toBe(true);
  });

  it('totalPoints adds up one person', () => {
    const l = computeLedger(busy());
    const martin = l.filter((e) => e.userId === U.martin.id).reduce((n, e) => n + e.points, 0);
    expect(totalPoints(l, U.martin.id)).toBe(martin);
    expect(totalPoints(l, 'nobody')).toBe(0);
  });
});
