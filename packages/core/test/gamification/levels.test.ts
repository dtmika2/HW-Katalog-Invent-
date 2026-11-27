import { describe, expect, it } from 'vitest';
import { levelFor, levelHistory, levelTier, LEVEL_TIERS, xpFor, type LedgerEntry } from '../../src';

const entry = (on: string, points: number, userId = 'u-a'): LedgerEntry => ({
  id: `e-${on}-${points}-${userId}`,
  userId,
  on,
  ruleId: 'ship.delivery',
  points,
  category: 'shipping',
  params: {},
});

describe('gamification: levels', () => {
  it('the curve: level 2 on the first day, level 10 in a few months, level 20 in about a year (150 XP/month)', () => {
    expect(xpFor(1)).toBe(0);
    expect(xpFor(2)).toBe(15);
    expect(xpFor(5)).toBe(140);
    expect(xpFor(10)).toBe(525);
    expect(xpFor(20)).toBe(1805);
    expect(xpFor(20) / 150).toBeCloseTo(12, 0);
  });

  it('the curve only goes up, and each level needs more than the one before', () => {
    for (let l = 2; l < 60; l++) {
      expect(xpFor(l + 1)).toBeGreaterThan(xpFor(l));
      expect(xpFor(l + 1) - xpFor(l)).toBeGreaterThanOrEqual(xpFor(l) - xpFor(l - 1));
    }
  });

  it('levelFor: a level starts exactly at its threshold', () => {
    expect(levelFor(0)).toMatchObject({ level: 1, tier: 'junior', step: 1, progress: 0 });
    expect(levelFor(14).level).toBe(1);
    expect(levelFor(15).level).toBe(2);
    expect(levelFor(524).level).toBe(9);
    expect(levelFor(525)).toMatchObject({ level: 10, tier: 'senior', step: 1, levelStart: 525 });
  });

  it('levelFor: progress within the level, from 0 up to (not including) 1', () => {
    const info = levelFor(xpFor(7) + Math.floor((xpFor(8) - xpFor(7)) / 2));
    expect(info.level).toBe(7);
    expect(info.nextAt).toBe(xpFor(8));
    expect(info.progress).toBeGreaterThan(0.4);
    expect(info.progress).toBeLessThan(0.6);
  });

  it('titles change at levels 5, 10, 15, 20, 25, 30 and 40; the step counts within the title', () => {
    expect(levelTier(4)).toEqual({ tier: 'junior', step: 4 });
    expect(levelTier(5)).toEqual({ tier: 'medior', step: 1 });
    expect(levelTier(12)).toEqual({ tier: 'senior', step: 3 });
    expect(levelTier(29)).toEqual({ tier: 'guarantor', step: 5 });
    expect(levelTier(39)).toEqual({ tier: 'pillar', step: 10 });
    expect(levelTier(40)).toEqual({ tier: 'legend', step: 1 });
    expect(levelTier(47)).toEqual({ tier: 'legend', step: 8 });
    expect(LEVEL_TIERS.map((t) => t.from)).toEqual([1, 5, 10, 15, 20, 25, 30, 40]);
  });

  it('levelHistory: the day each level was reached, only for that person', () => {
    const ledger = [
      entry('2027-04-01', 20),
      entry('2027-04-01', 500, 'u-b'),
      entry('2027-04-02', 30),
      entry('2027-04-05', 100),
    ];
    // 20 → level 2; 50 → level 3 (45); 150 → levels 4 (85) and 5 (140).
    expect(levelHistory(ledger, 'u-a')).toEqual([
      { level: 2, on: '2027-04-01' },
      { level: 3, on: '2027-04-02' },
      { level: 4, on: '2027-04-05' },
      { level: 5, on: '2027-04-05' },
    ]);
  });
});
