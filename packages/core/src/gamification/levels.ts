/**
 * Levels and titles. Total XP needed for level L: `LEVEL_CURVE.a · (L − 1)^LEVEL_CURVE.b`, rounded
 * to 5. Set from the pace measured in G3 (about 150 XP per active person per month on the demo):
 * level 2 on the first day, level 5 in about a month, level 10 in 3–4 months, level 20 in about a
 * year. A busier real team simply levels up faster; the curve is one constant to adjust.
 */
import type { IsoDate } from '../types';
import type { LedgerEntry } from './types';

export const LEVEL_CURVE = { a: 14, b: 1.65 } as const;

/** Work grades; Czech titles live in the app (gender-neutral in Czech workplace use). */
export type LevelTier =
  'junior' | 'medior' | 'senior' | 'specialist' | 'expert' | 'guarantor' | 'pillar' | 'legend';

/** First level of each tier, in order. */
export const LEVEL_TIERS: readonly { tier: LevelTier; from: number }[] = [
  { tier: 'junior', from: 1 },
  { tier: 'medior', from: 5 },
  { tier: 'senior', from: 10 },
  { tier: 'specialist', from: 15 },
  { tier: 'expert', from: 20 },
  { tier: 'guarantor', from: 25 },
  { tier: 'pillar', from: 30 },
  { tier: 'legend', from: 40 },
];

export interface LevelInfo {
  level: number;
  tier: LevelTier;
  /** Level within the tier, from 1 ("Senior II" is step 2). */
  step: number;
  xp: number;
  /** Total XP where this level starts and where the next one starts. */
  levelStart: number;
  nextAt: number;
  /** 0 ≤ progress < 1 within the level. */
  progress: number;
}

/** Total XP needed to reach `level` (level 1 needs nothing). */
export function xpFor(level: number): number {
  if (level <= 1) return 0;
  return Math.round((LEVEL_CURVE.a * Math.pow(level - 1, LEVEL_CURVE.b)) / 5) * 5;
}

export function levelTier(level: number): { tier: LevelTier; step: number } {
  let t = LEVEL_TIERS[0]!;
  for (const x of LEVEL_TIERS) if (level >= x.from) t = x;
  return { tier: t.tier, step: level - t.from + 1 };
}

export function levelFor(xp: number): LevelInfo {
  let level = 1;
  while (xpFor(level + 1) <= xp) level += 1;
  const levelStart = xpFor(level);
  const nextAt = xpFor(level + 1);
  return {
    level,
    ...levelTier(level),
    xp,
    levelStart,
    nextAt,
    progress: (xp - levelStart) / (nextAt - levelStart),
  };
}

/** The days a person reached each level above 1 (several levels may share a day). */
export function levelHistory(
  ledger: readonly LedgerEntry[],
  userId: string,
): { level: number; on: IsoDate }[] {
  const out: { level: number; on: IsoDate }[] = [];
  let xp = 0;
  let level = 1;
  for (const e of ledger) {
    if (e.userId !== userId) continue;
    xp += e.points;
    while (xpFor(level + 1) <= xp) {
      level += 1;
      out.push({ level, on: e.on });
    }
  }
  return out;
}
