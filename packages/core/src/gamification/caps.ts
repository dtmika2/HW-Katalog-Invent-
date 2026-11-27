/**
 * Limits from `RuleDef.caps`, applied in date order so the first entries of a day are the ones
 * that count. An entry dropped by a limit takes the entries under it (its bonuses) with it.
 */
import { RULES } from './rules';
import type { Draft, RuleDef } from './types';

export function applyCaps<D extends Draft>(sorted: readonly D[]): D[] {
  const used = new Map<string, number>();
  const dropped = new Set<string>();
  const within = (key: string, max: number | undefined): boolean =>
    max === undefined || (used.get(key) ?? 0) < max;

  const pass = (d: D): boolean => {
    if (d.parentId && dropped.has(d.parentId)) return false;
    const caps = (RULES[d.ruleId] as RuleDef).caps;
    if (!caps) return true;
    const keys: [string, number | undefined][] = [
      [`day|${d.ruleId}|${d.userId}|${d.on}`, caps.perDay],
      [`bookingDay|${d.ruleId}|${d.userId}|${d.bookingId ?? ''}|${d.on}`, caps.perBookingDay],
      [`subject|${d.ruleId}|${d.userId}|${d.subject ?? ''}`, caps.perSubject],
    ];
    if (!keys.every(([k, max]) => within(k, max))) return false;
    for (const [k, max] of keys) if (max !== undefined) used.set(k, (used.get(k) ?? 0) + 1);
    return true;
  };

  // Entries without a parent first, so a bonus never decides before its base entry.
  const kept = new Set<D>();
  for (const d of sorted.filter((x) => !x.parentId)) {
    if (pass(d)) kept.add(d);
    else dropped.add(d.id);
  }
  for (const d of sorted.filter((x) => x.parentId)) {
    if (pass(d)) kept.add(d);
    else dropped.add(d.id);
  }
  return sorted.filter((d) => kept.has(d));
}
