/**
 * The ledger: every reason for points, derived from the state. Nothing is stored, so the same
 * state always gives the same ledger, and every point can be traced to a record.
 */
import type { AppState } from '../types';
import { applyCaps } from './caps';
import { RULES, rulePoints } from './rules';
import { isPerson } from './sources/common';
import { packingDrafts } from './sources/packing';
import { vratkaDrafts } from './sources/vratka';
import type { Draft, LedgerEntry, LedgerOptions } from './types';

const SOURCES: ((state: AppState) => Draft[])[] = [packingDrafts, vratkaDrafts];

/** All ledger entries, sorted by day (then by the order the facts were recorded). */
export function computeLedger(state: AppState, options: LedgerOptions = {}): LedgerEntry[] {
  const drafts = SOURCES.flatMap((source) => source(state))
    .map((d, seq) => ({ ...d, seq }))
    .filter((d) => isPerson(d.userId))
    .filter((d) => !options.countFrom || d.on >= options.countFrom)
    .sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : a.seq - b.seq));

  // The same fact found in two records (a case check in the packing and in the shipment) counts once.
  const seen = new Set<string>();
  const unique = drafts.filter((d) => !seen.has(d.id) && !!seen.add(d.id));

  return applyCaps(unique)
    .map((d): LedgerEntry => {
      const e: LedgerEntry = {
        id: d.id,
        userId: d.userId,
        on: d.on,
        ruleId: d.ruleId,
        points: rulePoints(d.ruleId, d.units),
        category: RULES[d.ruleId].category,
        params: d.params ?? {},
      };
      if (d.parentId) e.parentId = d.parentId;
      if (d.bookingId) e.bookingId = d.bookingId;
      return e;
    })
    .filter((e) => e.points > 0);
}

/** Total points of one person. */
export function totalPoints(ledger: readonly LedgerEntry[], userId: string): number {
  return ledger.reduce((n, e) => (e.userId === userId ? n + e.points : n), 0);
}
