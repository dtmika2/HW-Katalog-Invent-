/**
 * Solving a conflict on an approved order without touching the rest of it: the missing pieces are
 * rented, or come from the other warehouse. Its PM may do that, everything else stays the Chief's.
 */
import type { IsoDate } from '../dates';
import { buildHoldIndex, minFreeInWarehouse } from '../availability';
import { detectConflicts, recomputeConflictRecords, type LineConflict } from '../conflicts';
import { chiefIds, notify, postEvent, warehouseIds } from '../notifications';
import { statusAfter } from '../packing';
import type { AppState, Booking, BookingLine, BookingStatus, Id, User } from '../types';
import { effectiveQty, err, isExternal, isItemTarget, ok, produce, type Result } from '../util';
import { coverWithExternal, splitLine } from './edit';
import { can } from './permissions';

export type ShortageFix =
  | { kind: 'external'; qty: number; supplier: string; pickup: IsoDate; returnDate: IsoDate }
  | { kind: 'warehouse'; qty: number; warehouseId: Id };

const SOLVABLE: readonly BookingStatus[] = ['confirmed', 'packing', 'packed'];

/** Short lines of an approved order that `user` may solve now (nothing of them has left). */
export function solvableShortages(state: AppState, user: User, b: Booking): LineConflict[] {
  if (b.type !== 'order' || !SOLVABLE.includes(b.status) || b.cancelPending) return [];
  if (!can(user, 'cover_external', b)) return [];
  return detectConflicts(state, b).filter(
    (c) =>
      !state.shipments.some(
        (s) => s.bookingId === b.id && s.lines.some((l) => l.lineId === c.lineId),
      ),
  );
}

/**
 * Pieces to get elsewhere: what is missing, but never more than the line asks for (other bookings
 * may have overbooked the item even without it).
 */
export function missingOf(c: Pick<LineConflict, 'short'>, line: BookingLine): number {
  return Math.min(c.short, effectiveQty(line));
}

/** Pieces of a line the other warehouse can give for all its days. */
export function freeElsewhere(
  state: AppState,
  b: Booking,
  line: BookingLine,
  warehouseId: Id,
): number {
  if (line.origin === 'auto' || line.fromBookingId || !isItemTarget(line.target)) return 0;
  // also what orders approved later hold: they must not lose it
  const all = buildHoldIndex(state, { excludeBookingId: b.id });
  return Math.max(0, minFreeInWarehouse(state, b, line.target, warehouseId, all));
}

/** Solve one short line of an approved order. */
export function resolveShortage(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  lineId: Id,
  fix: ShortageFix,
): Result<AppState> {
  const b = state.bookings.find((x) => x.id === bookingId);
  if (!b) return err('not_found', `Booking ${bookingId} not found`);
  if (!can(user, 'cover_external', b)) return err('forbidden', 'Not allowed to solve this');
  const c = solvableShortages(state, user, b).find((x) => x.lineId === lineId);
  const line = b.lines.find((l) => l.id === lineId);
  if (!c || !line || isExternal(line.target))
    return err('invalid_state', 'The line is not short, or part of it has left');
  const missing = missingOf(c, line);
  if (!Number.isInteger(fix.qty) || fix.qty <= 0 || fix.qty > missing)
    return err('validation', 'Only what is missing', { field: 'qty', short: missing });

  let changed: Booking;
  let from: string;
  if (fix.kind === 'external') {
    const supplier = fix.supplier.trim();
    if (!supplier) return err('validation', 'A supplier is required', { field: 'supplier' });
    if (fix.returnDate < fix.pickup)
      return err('validation', 'Return is before the pickup', { field: 'returnDate' });
    changed = coverWithExternal(state, b, lineId, fix.qty, {
      supplier,
      pickup: fix.pickup,
      returnDate: fix.returnDate,
    });
    from = supplier;
  } else {
    const w = state.warehouses.find((x) => x.id === fix.warehouseId);
    if (!w || w.id === c.warehouseId || fix.qty > freeElsewhere(state, b, line, w.id))
      return err('validation', 'Not free in that warehouse', { field: 'warehouseId' });
    changed = splitLine(state, b, lineId, fix.qty, w.id);
    from = w.name;
  }
  // solving one line must not make another one short
  const was = new Map(detectConflicts(state, b).map((x) => [x.lineId, x.short]));
  const worse = detectConflicts(state, changed).filter((x) => x.short > (was.get(x.lineId) ?? 0));
  if (worse.length > 0)
    return err('blocking_conflicts', 'Some lines would be short', {
      lineIds: worse.map((x) => x.lineId),
    });

  const t = line.target;
  const what = isItemTarget(t)
    ? (state.items.find((i) => i.id === t.itemId)?.name ?? '')
    : (state.caseTypes.find((x) => x.id === (t as { caseTypeId: Id }).caseTypeId)?.name ?? '');
  const params = { event: b.eventName, qty: fix.qty, what, from, kind: fix.kind };
  const packing = b.status !== 'confirmed';
  const next = produce(state, (d) => {
    const i = d.bookings.findIndex((x) => x.id === bookingId);
    const booking: Booking = { ...changed };
    if (packing && d.packings.some((p) => p.bookingId === bookingId))
      booking.status = statusAfter(d, booking);
    d.bookings[i] = booking;
    postEvent(d, bookingId, user.id, today, 'shortage_solved', params);
    const input = {
      type: 'shortage_solved' as const,
      text: `${b.eventName}: ${fix.qty}× ${what} from ${from}`,
      params: { ...params, who: user.name },
      bookingId,
    };
    const others = (ids: Id[]) => ids.filter((id) => id !== user.id);
    notify(d, others([b.pmId, ...chiefIds(d)]), input, today);
    // the packer may already have the list in hand
    notify(d, others(warehouseIds(d)), packing ? { ...input, highPriority: true } : input, today);
  }).state;
  return ok(recomputeConflictRecords(next, today));
}
