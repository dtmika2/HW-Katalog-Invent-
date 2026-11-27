/**
 * Packing and shipping. Base points come from thread events (`packed`, `batch_shipped`,
 * `transfer_out`, `late_item`), which are never deleted; case checks are read from packing records
 * and shipments while they exist.
 */
import type { AppState, Id, IsoDate, ShipmentLine } from '../../types';
import type { Draft } from '../types';
import { events, isPerson, num } from './common';

export function packingDrafts(state: AppState): Draft[] {
  const out: Draft[] = [];

  // pack.packed — once per booking, person and day. Two sources of the same pieces: the thread
  // event `packed` (never deleted, but "Zabalit a rovnou odvézt" packs silently without one) and
  // the packing records (always written, but removed by cancelling). The larger count wins, so
  // either may be missing and nothing is counted twice.
  const fromEvents = new Map<string, number>();
  const fromRecords = new Map<string, number>();
  const firstSeen = new Map<string, { bookingId: Id; userId: Id; on: IsoDate }>();
  const note = (to: Map<string, number>, bookingId: Id, userId: Id, on: IsoDate, n: number) => {
    const key = `${bookingId}:${userId}:${on}`;
    to.set(key, (to.get(key) ?? 0) + n);
    if (!firstSeen.has(key)) firstSeen.set(key, { bookingId, userId, on });
  };
  for (const m of events(state, 'packed'))
    note(fromEvents, m.bookingId, m.authorId, m.on, num(m.event.params.count));
  for (const p of state.packings) {
    if (!isPerson(p.userId)) continue;
    const pieces = p.lines.filter((l) => !l.deferred).reduce((n, l) => n + l.qty, 0);
    if (pieces > 0) note(fromRecords, p.bookingId, p.userId, p.on, pieces);
  }
  for (const [key, at] of firstSeen) {
    const count = Math.max(fromEvents.get(key) ?? 0, fromRecords.get(key) ?? 0);
    out.push({
      id: `pack.packed:${key}`,
      ...at,
      ruleId: 'pack.packed',
      units: count,
      params: { count },
    });
  }

  // pack.caseChecked (+ pack.refilled) — one per booking and case, from whichever record has it.
  const checked = (bookingId: Id, userId: Id, on: IsoDate, lines: readonly ShipmentLine[]) => {
    if (!isPerson(userId)) return;
    for (const l of lines) {
      for (const check of l.caseChecks ?? []) {
        const id = `pack.caseChecked:${bookingId}:${check.caseId}`;
        out.push({ id, userId, on, ruleId: 'pack.caseChecked', bookingId, params: {} });
        if ((check.refilled ?? []).some((r) => r.qty > 0))
          out.push({
            id: `pack.refilled:${bookingId}:${check.caseId}`,
            userId,
            on,
            ruleId: 'pack.refilled',
            parentId: id,
            bookingId,
            params: {},
          });
      }
    }
  };
  for (const p of state.packings) checked(p.bookingId, p.userId, p.on, p.lines);
  for (const s of state.shipments) checked(s.bookingId, s.userId, s.shippedOn, s.lines);

  // ship.delivery
  for (const m of events(state, 'batch_shipped'))
    out.push({
      id: `ship.delivery:${m.id}`,
      userId: m.authorId,
      on: m.on,
      ruleId: 'ship.delivery',
      bookingId: m.bookingId,
      params: { label: m.event.params.label ?? '' },
    });

  // ship.transfer — once per pair of events and day (one handover may move several items).
  for (const m of events(state, 'transfer_out'))
    out.push({
      id: `ship.transfer:${m.bookingId}:${m.event.params.to ?? ''}:${m.on}`,
      userId: m.authorId,
      on: m.on,
      ruleId: 'ship.transfer',
      bookingId: m.bookingId,
      params: { to: m.event.params.to ?? '' },
    });

  // ship.lateRecorded
  for (const m of events(state, 'late_item'))
    out.push({
      id: `ship.lateRecorded:${m.id}`,
      userId: m.authorId,
      on: m.on,
      ruleId: 'ship.lateRecorded',
      bookingId: m.bookingId,
      params: {},
    });

  return out;
}
