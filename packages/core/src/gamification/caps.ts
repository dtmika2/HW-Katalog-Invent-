/**
 * Limits from `RuleDef.caps` and the weekly `POOLS`, applied in date order so the first entries
 * of a day (or week) are the ones that count. An entry dropped by a limit takes the entries under
 * it (its bonuses) with it.
 */
import { addDays, weekday } from '../dates';
import { POOLS, RULES, rulePoints } from './rules';
import type { Draft, RuleDef } from './types';

export function applyCaps<D extends Draft>(sorted: readonly D[]): D[] {
  const used = new Map<string, number>();
  const dropped = new Set<string>();
  const within = (key: string, max: number | undefined): boolean =>
    max === undefined || (used.get(key) ?? 0) < max;

  const pass = (d: D): boolean => {
    if (d.parentId && dropped.has(d.parentId)) return false;
    const caps = (RULES[d.ruleId] as RuleDef).caps ?? {};
    const keys: [string, number | undefined][] = [
      [`day|${d.ruleId}|${d.userId}|${d.on}`, caps.perDay],
      [`bookingDay|${d.ruleId}|${d.userId}|${d.bookingId ?? ''}|${d.on}`, caps.perBookingDay],
      [`subject|${d.ruleId}|${d.userId}|${d.subject ?? ''}`, caps.perSubject],
    ];
    if (!keys.every(([k, max]) => within(k, max))) return false;
    const pool = (RULES[d.ruleId] as RuleDef).pool;
    const poolKey = pool && `pool|${pool}|${d.userId}|${addDays(d.on, -weekday(d.on))}`;
    const points = rulePoints(d.ruleId, d.units);
    if (pool && poolKey && (used.get(poolKey) ?? 0) + points > POOLS[pool].perWeek) return false;
    for (const [k, max] of keys) if (max !== undefined) used.set(k, (used.get(k) ?? 0) + 1);
    if (poolKey) used.set(poolKey, (used.get(poolKey) ?? 0) + points);
    return true;
  };

  // One pass in date order (a bonus sorts after its base entry, so a reply competes for the week's
  // budget right after its message); then bonuses whose base entry was dropped go too.
  const kept = sorted.filter((d) => {
    const ok = pass(d);
    if (!ok) dropped.add(d.id);
    return ok;
  });
  return kept.filter((d) => !d.parentId || !dropped.has(d.parentId));
}
