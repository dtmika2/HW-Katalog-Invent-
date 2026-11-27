/**
 * Vratka. Return sessions are never deleted. What the system requires (confirming every line,
 * counting cases, a note on damaged or short lines) is base work; bonuses are only for what is
 * done on top of it.
 */
import { lastBookedUntil } from '../../availability';
import type { AppState, Id, ReturnSession } from '../../types';
import type { Draft } from '../types';
import { events, isPerson, textLength } from './common';

/** A damage note this long describes the damage instead of just satisfying the required field. */
export const DAMAGE_NOTE_MIN = 25;
/** A voluntary note this long says something. */
export const NOTE_MIN = 15;

export function vratkaDrafts(state: AppState): Draft[] {
  const out: Draft[] = [];
  const bookings = new Map(state.bookings.map((b) => [b.id, b]));
  /** Pieces shipped per booking line (all deliveries, also ones arriving from another event). */
  const shipped = new Map<string, number>();
  for (const s of state.shipments)
    for (const l of s.lines) {
      const k = `${s.bookingId}:${l.lineId}`;
      shipped.set(k, (shipped.get(k) ?? 0) + l.qty);
    }
  /** Pieces accounted for so far per booking line, while walking sessions in order. */
  const accounted = new Map<string, number>();

  for (const s of state.returnSessions) {
    if (!isPerson(s.userId)) continue;
    const id = `vratka.session:${s.id}`;
    const base = { userId: s.userId, on: s.on, bookingId: s.bookingId, parentId: id };
    out.push({
      id,
      userId: s.userId,
      on: s.on,
      ruleId: 'vratka.session',
      bookingId: s.bookingId,
      units: s.lines.length,
      params: { lines: s.lines.length },
    });

    const cases = s.lines.filter((l) => l.caseId && (l.caseContents?.length ?? 0) > 0).length;
    if (cases > 0)
      out.push({
        ...base,
        id: `vratka.caseCounted:${s.id}`,
        ruleId: 'vratka.caseCounted',
        units: cases,
        params: { cases },
      });

    const described = s.lines.filter(
      (l) => l.condition !== 'ok' && textLength(l.note) >= DAMAGE_NOTE_MIN,
    ).length;
    if (described > 0)
      out.push({
        ...base,
        id: `vratka.damageDescribed:${s.id}`,
        ruleId: 'vratka.damageDescribed',
        units: described,
        params: { lines: described },
      });

    const extra = voluntaryNotes(s, shipped, accounted);
    if (extra > 0)
      out.push({
        ...base,
        id: `vratka.extraNote:${s.id}`,
        ruleId: 'vratka.extraNote',
        units: extra,
        params: { lines: extra },
      });

    if (s.unexpected.length > 0)
      out.push({
        ...base,
        id: `vratka.unexpected:${s.id}`,
        ruleId: 'vratka.unexpected',
        units: s.unexpected.length,
        params: { items: s.unexpected.length },
      });

    const photo = state.attachments.some(
      (a) => a.file && a.bookingId === s.bookingId && a.by === s.userId && a.on === s.on,
    );
    if (photo)
      out.push({ ...base, id: `vratka.photo:${s.id}`, ruleId: 'vratka.photo', params: {} });

    const b = bookings.get(s.bookingId);
    if (b && b.periods.length > 0 && s.on <= lastBookedUntil(b))
      out.push({ ...base, id: `vratka.onTime:${s.id}`, ruleId: 'vratka.onTime', params: {} });
  }

  // vratka.settled — the session after which everything was back (its thread event says so).
  for (const m of events(state, 'return_session')) {
    const status = m.event.params.status;
    if (status !== 'returned' && status !== 'returned_with_issues') continue;
    const session = [...state.returnSessions]
      .reverse()
      .find((x) => x.bookingId === m.bookingId && x.userId === m.authorId && x.on === m.on);
    out.push({
      id: `vratka.settled:${session?.id ?? m.id}`,
      userId: m.authorId,
      on: m.on,
      ruleId: 'vratka.settled',
      bookingId: m.bookingId,
      ...(session ? { parentId: `vratka.session:${session.id}` } : {}),
      params: {},
    });
  }
  return out;
}

/**
 * Lines of loose gear that came back OK and complete, with a note: the system did not ask for one
 * (it requires a note only on damaged or short lines). Updates `accounted` with this session.
 */
function voluntaryNotes(
  s: ReturnSession,
  shipped: ReadonlyMap<string, number>,
  accounted: Map<string, number>,
): number {
  const byLine = new Map<Id, ReturnSession['lines']>();
  for (const l of s.lines) {
    if (l.caseId) continue;
    byLine.set(l.lineId, [...(byLine.get(l.lineId) ?? []), l]);
  }
  let n = 0;
  for (const [lineId, entries] of byLine) {
    const k = `${s.bookingId}:${lineId}`;
    const before = accounted.get(k) ?? 0;
    const used = entries.reduce((t, e) => t + e.returnedQty + (e.transferredQty ?? 0), 0);
    accounted.set(k, before + used);
    const short = before + used < (shipped.get(k) ?? 0);
    const allOk = entries.every((e) => e.condition === 'ok');
    if (!short && allOk && entries.some((e) => textLength(e.note) >= NOTE_MIN)) n += 1;
  }
  return n;
}
