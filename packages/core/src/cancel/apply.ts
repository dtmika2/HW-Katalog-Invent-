/** What cancelling a booking does to everything around it. Who may do it is decided elsewhere. */
import type { IsoDate } from '../dates';
import { lastBookedUntil } from '../availability';
import { newShortages, recomputeConflictRecords } from '../conflicts';
import { chiefIds, notify, postEvent, warehouseIds } from '../notifications';
import { promisedText, statusAfter } from '../packing';
import {
  ARCHIVED_STATUSES,
  FREE_STAGES,
  PRE_STATUSES,
  type AppState,
  type Booking,
  type Id,
} from '../types';
import { effectiveQty, isActiveLine, isCaseTarget, isExternal, produce, uniq } from '../util';

/** Rented gear of a booking, to be cancelled at the suppliers. */
function rentals(b: Booking): string {
  return promisedText(
    b.lines.flatMap((l) =>
      isActiveLine(l) && isExternal(l.target)
        ? [{ qty: effectiveQty(l), name: l.target.external.name, from: l.target.external.supplier }]
        : [],
    ),
  );
}

/** Lines that were to come from a cancelled event come from the warehouse again. */
function releaseTransfers(d: AppState, b: Booking, today: IsoDate): void {
  for (const other of d.bookings) {
    if (other.id === b.id || ARCHIVED_STATUSES.includes(other.status)) continue;
    const lines = other.lines.filter((l) => l.fromBookingId === b.id && !l.transferredOn);
    if (lines.length === 0) continue;
    const what = promisedText(
      lines.map((l) => ({
        qty: effectiveQty(l),
        name: isExternal(l.target)
          ? l.target.external.name
          : isCaseTarget(l.target)
            ? (d.caseTypes.find((t) => t.id === (l.target as { caseTypeId: Id }).caseTypeId)
                ?.name ?? '')
            : (d.items.find((i) => i.id === (l.target as { itemId: Id }).itemId)?.name ?? ''),
        from: '',
      })),
    );
    for (const l of lines) delete l.fromBookingId;
    // it has to be packed here now
    if (
      ['packing', 'packed', 'shipped'].includes(other.status) &&
      d.packings.some((p) => p.bookingId === other.id)
    )
      other.status = statusAfter(d, other);
    notify(
      d,
      [other.pmId],
      {
        type: 'transfer_lost',
        text: `${other.eventName}: ${what} does not come from ${b.eventName}, it was cancelled`,
        params: { event: other.eventName, other: b.eventName, what },
        bookingId: other.id,
      },
      today,
    );
  }
}

/**
 * Cancel a booking whose gear is all in its place. It keeps its list and conversation, holds
 * nothing, and everybody who counted with it is told. `actor` is not told what they just did.
 */
export function cancelNow(
  state: AppState,
  actor: Id,
  today: IsoDate,
  bookingId: Id,
  by: Id,
  reason: string,
): AppState {
  const b = state.bookings.find((x) => x.id === bookingId) as Booking;
  const from = b.status;
  const wasOrder = b.type === 'order';
  const rented = wasOrder ? rentals(b) : '';
  const { state: next } = produce(state, (d) => {
    const x = d.bookings.find((y) => y.id === bookingId) as Booking;
    x.status = 'cancelled';
    x.cancelled = { by, on: today, reason, from };
    delete x.cancelPending;
    delete x.cancelRequests;
    delete x.earlyPacking;
    d.packings = d.packings.filter((p) => p.bookingId !== bookingId);
    postEvent(d, bookingId, by, today, 'cancelled', { reason, ...(rented ? { rented } : {}) });
    releaseTransfers(d, x, today);
    const asked = !FREE_STAGES.some((f) => f === from);
    notify(
      d,
      [x.pmId, ...(asked ? chiefIds(d) : []), ...(wasOrder ? warehouseIds(d) : [])].filter(
        (id) => id !== actor,
      ),
      {
        type: 'booking_cancelled',
        text: `${x.eventName} was cancelled: ${reason}`,
        params: { event: x.eventName, reason, rented },
        bookingId,
      },
      today,
    );
  });
  // who was short because of it and is not (or less) any more
  const released = wasOrder
    ? uniq(
        newShortages(
          next,
          state,
          today,
          lastBookedUntil(b),
          (o) => o.id !== bookingId && o.pmId !== actor,
          PRE_STATUSES,
        ).map((h) => h.bookingId),
      )
    : [];
  const { state: told } = produce(next, (d) => {
    for (const id of released) {
      const o = d.bookings.find((y) => y.id === id) as Booking;
      notify(
        d,
        [o.pmId],
        {
          type: 'gear_released',
          text: `${o.eventName}: gear is free again, ${b.eventName} was cancelled`,
          params: { event: o.eventName, other: b.eventName },
          bookingId: id,
        },
        today,
      );
    }
  });
  return recomputeConflictRecords(told, today);
}
