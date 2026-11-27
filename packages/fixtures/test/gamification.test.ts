import { describe, expect, it } from 'vitest';
import { badgeProgress, computeLedger, RULES, SYSTEM_USER_ID, totalPoints } from '@quix/core';
import { calibrate, DEMO_TODAY, SCENARIOS } from '../src';

describe('gamification over the demo scenarios', () => {
  for (const sc of SCENARIOS) {
    it(`${sc.id}: a consistent ledger (unique ids, known people, bonuses with their base, > 0 points)`, () => {
      const s = sc.build();
      const before = JSON.stringify(s);
      const l = computeLedger(s);
      expect(JSON.stringify(s)).toBe(before);
      expect(l.length).toBeGreaterThan(0);

      const ids = new Set(l.map((e) => e.id));
      expect(ids.size).toBe(l.length);
      const users = new Set(s.users.map((u) => u.id));
      for (const e of l) {
        expect(e.points).toBeGreaterThan(0);
        expect(e.userId).not.toBe(SYSTEM_USER_ID);
        expect(users.has(e.userId)).toBe(true);
        expect(e.category).toBe(RULES[e.ruleId].category);
        if (e.parentId) expect(ids.has(e.parentId)).toBe(true);
      }
      expect(computeLedger(s)).toEqual(l);
    });
  }
});

describe('gamification calibration (G3)', () => {
  const base = SCENARIOS.find((s) => s.id === 'base')!.build();
  const cal = calibrate(base, DEMO_TODAY);

  it('meets every balance target: roles, single rules, communication of a talkative team', () => {
    expect(cal.checks.filter((c) => !c.ok)).toEqual([]);
  });

  it('per-role and per-person figures stay where they were calibrated (review any change)', () => {
    const round = (x: number) => Math.round(x);
    expect({
      roles: cal.demo.roles.map((r) => ({ ...r, perPersonMonth: round(r.perPersonMonth) })),
      people: Object.fromEntries(cal.demo.people.map((p) => [p.userId, p.total])),
      talkative: Object.fromEntries(
        cal.talkative.people.map((p) => [p.userId, round(p.talkShare * 100)]),
      ),
    }).toMatchSnapshot();
  });
});

describe('gamification: badges on the demo data', () => {
  it('everyone with real activity (100+ XP) has at least one badge on the first load', () => {
    const s = SCENARIOS.find((x) => x.id === 'base')!.build();
    const l = computeLedger(s);
    const active = s.users.filter((u) => totalPoints(l, u.id) >= 100);
    expect(active.length).toBeGreaterThanOrEqual(4);
    for (const u of active) {
      const earned = badgeProgress(s, l, u.id).filter((b) => b.earned > 0);
      expect(earned.length, u.name).toBeGreaterThan(0);
    }
  });
});
