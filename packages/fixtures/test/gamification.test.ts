import { describe, expect, it } from 'vitest';
import { computeLedger, RULES, SYSTEM_USER_ID } from '@quix/core';
import { SCENARIOS } from '../src';

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
