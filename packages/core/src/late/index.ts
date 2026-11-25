/**
 * Last-minute items: gear taken to an event without having been approved (a spare light). It is
 * recorded as already gone with a delivery of its own, so the vratka expects it back. It brings no
 * accessories and changes nothing else on the order.
 */
import type { IsoDate } from '../dates';
import { lastBookedUntil } from '../availability';
import { getItem } from '../catalog';
import { newShortages, recomputeConflictRecords, type ShortageHit } from '../conflicts';
import { guard } from '../lifecycle';
import { newLine, nextLineId } from '../lifecycle/edit';
import { casesHere, looseHere, usesItem } from '../loans';
import { chiefIds, notify, postEvent, warehouseIds } from '../notifications';
import { takeOutOfCase } from '../packing';
import type { AppState, Booking, BookingLine, Id, User } from '../types';
import { err, nextId, ok, produce, type Result } from '../util';

export interface LateItemInput {
  itemId: Id;
  warehouseId: Id;
  qty: number;
  /** The pieces are taken out of this case. */
  fromCaseId?: Id;
  /** Name of the delivery it is recorded as. */
  label: string;
  note?: string;
  /** Required when an approved order gets short. */
  reason?: string;
  /** Counts into the price. */
  charged?: boolean;
}

/** How many pieces can be taken now from where the input says. */
export function lateAvailable(
  state: AppState,
  today: IsoDate,
  input: Pick<LateItemInput, 'itemId' | 'warehouseId' | 'fromCaseId'>,
): number {
  return input.fromCaseId
    ? (casesHere(state, input.itemId, input.warehouseId).find((c) => c.caseId === input.fromCaseId)
        ?.qty ?? 0)
    : looseHere(state, input.itemId, input.warehouseId, today);
}

function take(
  d: AppState,
  userId: Id,
  today: IsoDate,
  bookingId: Id,
  input: LateItemInput,
): BookingLine {
  const b = d.bookings.find((x) => x.id === bookingId) as Booking;
  const line: BookingLine = {
    ...newLine({ itemId: input.itemId }, input.qty, nextLineId(b)),
    sourceWarehouseId: input.warehouseId,
    expectedReturnWarehouseId: input.warehouseId,
    late: { by: userId, on: today },
  };
  const late = line.late as NonNullable<BookingLine['late']>;
  if (input.note?.trim()) late.note = input.note.trim();
  if (input.reason?.trim()) late.reason = input.reason.trim();
  if (input.charged) late.charged = true;
  b.lines.push(line);
  const entry = {
    lineId: line.id,
    qty: input.qty,
    ...(input.fromCaseId ? { fromCaseId: input.fromCaseId } : {}),
  };
  takeOutOfCase(d, line, entry, today);
  d.packings.push({
    id: nextId(d, 'pck'),
    bookingId,
    on: today,
    userId,
    lines: [{ ...entry }],
  });
  d.shipments.push({
    id: nextId(d, 'shp'),
    bookingId,
    label: input.label.trim(),
    shippedOn: today,
    userId,
    lines: [{ ...entry }],
  });
  if (getItem(d, input.itemId)?.returnable === false) {
    const st = d.stock.find(
      (s) => s.itemId === input.itemId && s.warehouseId === input.warehouseId,
    );
    if (st) st.qty = Math.max(0, st.qty - input.qty);
  }
  return line;
}

/** Who gets short when the item is taken now. */
export function latePreview(
  state: AppState,
  today: IsoDate,
  bookingId: Id,
  input: LateItemInput,
): ShortageHit[] {
  const b = state.bookings.find((x) => x.id === bookingId);
  if (!b) return [];
  const after = produce(state, (d) => {
    take(d, '', today, bookingId, input);
  }).state;
  const end = lastBookedUntil(b);
  return newShortages(
    state,
    after,
    today,
    end > today ? end : today,
    (o) => o.id !== bookingId && usesItem(after, o, input.itemId),
  );
}

/** Record an item taken to the event at the last minute. */
export function addLateItem(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  input: LateItemInput,
): Result<AppState> {
  const g = guard(state, user, 'addLateItem', bookingId);
  if (!g.ok) return g;
  const item = getItem(state, input.itemId);
  if (!item || item.archived) return err('not_found', `Item ${input.itemId} not found`);
  if (!input.label.trim()) return err('validation', 'A label is required', { field: 'label' });
  const here = lateAvailable(state, today, input);
  if (!Number.isInteger(input.qty) || input.qty <= 0 || input.qty > here)
    return err('validation', 'Not enough pieces in the house', { field: 'qty', here });
  const hits = latePreview(state, today, bookingId, input).filter((h) => h.level === 'order');
  if (hits.length > 0 && !input.reason?.trim())
    return err('validation', 'A reason is required, an order needs the item', {
      field: 'reason',
      bookingIds: hits.map((h) => h.bookingId),
    });
  const next = produce(state, (d) => {
    take(d, user.id, today, bookingId, input);
    const b = d.bookings.find((x) => x.id === bookingId) as Booking;
    const params = {
      qty: input.qty,
      item: item.name,
      note: input.note?.trim() ?? '',
      reason: input.reason?.trim() ?? '',
    };
    postEvent(d, bookingId, user.id, today, 'late_item', params);
    notify(
      d,
      [b.pmId, ...chiefIds(d), ...warehouseIds(d)].filter((id) => id !== user.id),
      {
        type: 'late_item',
        text: `${b.eventName}: ${input.qty}× ${item.name} taken at the last minute`,
        params: { ...params, event: b.eventName, who: user.name },
        bookingId,
      },
      today,
    );
  }).state;
  return ok(recomputeConflictRecords(next, today));
}
