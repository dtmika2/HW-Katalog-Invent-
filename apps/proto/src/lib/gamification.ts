/** Display helpers for gamification (no UI strings of their own; text comes from `cs`). */
import {
  RULES,
  type AppState,
  type BadgeProgress,
  type LedgerEntry,
  type LevelInfo,
  type RuleDef,
} from '@quix/core';
import { cs } from '../i18n/cs';

const ROMAN: [number, string][] = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function roman(n: number): string {
  let out = '';
  let rest = n;
  for (const [v, s] of ROMAN)
    while (rest >= v) {
      out += s;
      rest -= v;
    }
  return out;
}

/** Grammatical form of a title, chosen by the person (masculine until chosen). */
export type TitleForm = 'm' | 'f';

/**
 * "Tovaryš II – Tovaryš stativů" / "Tovaryška II – Tovaryška stativů": the rank with its step (so it
 * is clear which one is higher), then the level's name from the warehouse; past the named steps
 * just "Legenda XI".
 */
export function titleOf(level: Pick<LevelInfo, 'tier' | 'step'>, form: TitleForm = 'm'): string {
  const t = cs.gamification.titles[level.tier];
  const rank = t[form];
  const name = t.steps[level.step - 1];
  return `${rank} ${roman(level.step)}${name ? ` – ${rank} ${name}` : ''}`;
}

/** A base entry with the bonuses earned the same day. */
export interface EntryGroup {
  root: LedgerEntry;
  bonuses: LedgerEntry[];
  points: number;
}

/**
 * Groups entries for display: a bonus goes under its base entry when both are in the list and on
 * the same day; otherwise it stands on its own (a bonus earned later, e.g. "approved the first
 * time", would be lost under an old entry). Keeps the order of the roots.
 */
export function groupEntries(entries: readonly LedgerEntry[]): EntryGroup[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const groups = new Map<string, EntryGroup>();
  const out: EntryGroup[] = [];
  for (const e of entries) {
    const parent = e.parentId ? byId.get(e.parentId) : undefined;
    if (parent && parent.on === e.on) continue;
    const g: EntryGroup = { root: e, bonuses: [], points: e.points };
    groups.set(e.id, g);
    out.push(g);
  }
  for (const e of entries) {
    const g = e.parentId ? groups.get(e.parentId) : undefined;
    if (g && g.root.on === e.on && e !== g.root) {
      g.bonuses.push(e);
      g.points += e.points;
    }
  }
  return out;
}

/** A history row: identical entries of one day and event (five cases checked) shown once. */
export interface HistoryRow {
  groups: EntryGroup[];
  points: number;
}

/** Merges neighbouring groups of the same rule, day and event that have no bonuses. */
export function historyRows(groups: readonly EntryGroup[]): HistoryRow[] {
  const out: HistoryRow[] = [];
  for (const gr of groups) {
    const last = out.at(-1);
    const first = last?.groups[0];
    const same =
      first &&
      gr.bonuses.length === 0 &&
      first.bonuses.length === 0 &&
      first.root.ruleId === gr.root.ruleId &&
      first.root.on === gr.root.on &&
      first.root.bookingId === gr.root.bookingId;
    if (last && same) {
      last.groups.push(gr);
      last.points += gr.points;
    } else out.push({ groups: [gr], points: gr.points });
  }
  return out;
}

export const isBonus = (e: LedgerEntry): boolean => !!(RULES[e.ruleId] as RuleDef).bonus;

const eventName = (s: AppState, bookingId: string | undefined) =>
  bookingId ? s.bookings.find((b) => b.id === bookingId)?.eventName : undefined;

/** "Vratka – Gala Dinner (pečlivě)". */
export function groupText(s: AppState, g: EntryGroup): string {
  const name = eventName(s, g.root.bookingId);
  const careful = g.bonuses.some(isBonus) ? ` (${cs.gamification.careful})` : '';
  return `${cs.gamification.rules[g.root.ruleId].label}${name ? ` – ${name}` : ''}${careful}`;
}

/** The line next to the meter for new entries: one record in words, several as a count. */
export function pointsLine(s: AppState, fresh: readonly LedgerEntry[]): string | undefined {
  if (fresh.length === 0) return undefined;
  const groups = groupEntries(fresh);
  const sum = fresh.reduce((n, e) => n + e.points, 0);
  const what =
    groups.length === 1 && groups[0]
      ? groupText(s, groups[0])
      : cs.gamification.records(groups.length);
  return `${cs.gamification.plusXp(sum)} · ${what}`;
}

/** "Nový odznak: Kompletní casy – stříbro" for badge step keys ("completeCases:2"). */
export function badgeLines(badges: readonly BadgeProgress[], keys: readonly string[]): string[] {
  return keys.flatMap((k) => {
    const [id, step] = k.split(':');
    const b = badges.find((x) => x.id === id);
    const s = b?.steps[Number(step) - 1];
    if (!b || !s) return [];
    return [
      cs.gamification.newBadge(cs.gamification.badges[b.id].name, cs.gamification.steps[s.tier]),
    ];
  });
}

/** How a rule is counted, from its definition: "5 b. + 1 b. za každých 5 ks, nejvýš 15 b.". */
export function rulePointsText(r: RuleDef, unit: string | undefined): string {
  const g = cs.gamification;
  const parts: string[] = [];
  if (r.points > 0) parts.push(g.points(r.points));
  if (r.perUnit) {
    const per = g.perUnit(r.perUnit.points, r.perUnit.every ?? 1, unit ?? '');
    parts.push(
      parts.length ? `+ ${per}${r.perUnit.max ? `, ${g.perUnitMax(r.perUnit.max)}` : ''}` : per,
    );
    if (r.points === 0 && r.perUnit.max) parts.push(`(${g.perUnitMax(r.perUnit.max)})`);
  }
  return parts.join(' ');
}
