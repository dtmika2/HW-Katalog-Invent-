/**
 * Cancelling a whole booking. Until packing starts its PM does it alone; while its gear is packed
 * the Chief decides and the warehouse unpacks; once anything has left, it comes back first
 * (cancelled delivery or vratka).
 */
import type { IsoDate } from '../dates';
import { firstEventDay } from '../availability';
import { guard } from '../lifecycle';
import { can } from '../lifecycle/permissions';
import { chiefIds, notify, postEvent, warehouseIds } from '../notifications';
import { packingBackItems } from '../packing';
import {
  ARCHIVED_STATUSES,
  FREE_STAGES,
  type AppState,
  type Booking,
  type BookingStatus,
  type CancelRequest,
  type Id,
  type User,
} from '../types';
import { err, nextId, ok, produce, type Result } from '../util';
import { cancelNow } from './apply';

const PACKED_STAGES: readonly BookingStatus[] = ['packing', 'packed'];

/** True when some gear of the booking is out (or came straight from another event). */
export function hasLeft(state: Pick<AppState, 'shipments'>, bookingId: Id): boolean {
  return state.shipments.some((s) => s.bookingId === bookingId);
}

/**
 * How `user` can cancel the booking now: 'direct', 'unpack' (the warehouse confirms first),
 * 'ask' (the Chief decides) or undefined.
 */
export function cancelWay(
  state: AppState,
  user: User,
  b: Booking,
): 'direct' | 'unpack' | 'ask' | undefined {
  if (!guard(state, user, 'cancel', b.id).ok || hasLeft(state, b.id)) return undefined;
  if (!PACKED_STAGES.includes(b.status)) return 'direct';
  if (!can(user, 'cancel_after_start', b)) return 'ask';
  return packingBackItems(state, b).length > 0 ? 'unpack' : 'direct';
}

/** Cancel a booking with a reason, or (when something is packed) have the warehouse unpack it. */
export function cancelBooking(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  reason: string,
): Result<AppState> {
  const g = guard(state, user, 'cancel', bookingId);
  if (!g.ok) return g;
  const b = g.value;
  if (hasLeft(state, bookingId))
    return err('invalid_state', 'Some gear has left, it has to come back first', { field: 'left' });
  const way = cancelWay(state, user, b);
  if (way === 'ask')
    return err('forbidden', 'It is being packed, the Chief decides', { field: 'ask' });
  const why = reason.trim();
  if (!why) return err('validation', 'A reason is required', { field: 'reason' });
  if (way === 'direct') return ok(cancelNow(state, user.id, today, bookingId, user.id, why));
  return ok(
    produce(state, (d) => {
      const x = d.bookings.find((y) => y.id === bookingId) as Booking;
      x.cancelPending = { by: user.id, on: today, reason: why };
      delete x.cancelRequests;
      postEvent(d, bookingId, user.id, today, 'cancel_started', { reason: why });
      notify(
        d,
        warehouseIds(d),
        {
          type: 'cancel_unpack',
          text: `${x.eventName} is cancelled, unpack it: ${why}`,
          params: { event: x.eventName, reason: why },
          bookingId,
          highPriority: true,
        },
        today,
      );
    }).state,
  );
}

/** The PM of an order being packed asks the Chief to cancel it. */
export function requestBookingCancel(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  reason: string,
): Result<AppState> {
  const g = guard(state, user, 'cancel', bookingId);
  if (!g.ok) return g;
  const b = g.value;
  if (cancelWay(state, user, b) !== 'ask')
    return err('invalid_state', 'Nothing to ask the Chief for');
  const why = reason.trim();
  if (!why) return err('validation', 'A reason is required', { field: 'reason' });
  if (b.cancelRequests?.some((r) => r.booking))
    return err('invalid_state', 'The Chief has already been asked');
  return ok(
    produce(state, (d) => {
      const x = d.bookings.find((y) => y.id === bookingId) as Booking;
      const r: CancelRequest = {
        id: nextId(d, 'cnr'),
        booking: true,
        by: user.id,
        on: today,
        reason: why,
        confirmed: [],
      };
      x.cancelRequests = [...(x.cancelRequests ?? []), r];
      const params = { label: '', booking: 1, reason: why };
      postEvent(d, bookingId, user.id, today, 'cancel_requested', params);
      notify(
        d,
        chiefIds(d),
        {
          type: 'cancel_requested',
          text: `${x.eventName}: ${user.name} asks to cancel the event`,
          params: { ...params, event: x.eventName, who: user.name },
          bookingId,
        },
        today,
      );
    }).state,
  );
}

/** Where a cancelled booking goes when it is taken back; what was approved is approved again. */
export function reopenStage(b: Booking): BookingStatus | undefined {
  if (!b.cancelled) return undefined;
  return FREE_STAGES.find((f) => f === b.cancelled?.from) ?? 'submitted';
}

/** Take a cancelled booking back, before its event. */
export function reopenBooking(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
): Result<AppState> {
  const g = guard(state, user, 'reopen', bookingId);
  if (!g.ok) return g;
  const b = g.value;
  const to = reopenStage(b);
  if (!to) return err('invalid_state', 'Nothing to take back');
  if (to === 'submitted' && user.role !== 'chief')
    return err('forbidden', 'Only the Chief takes back what was confirmed for approval');
  if (today >= firstEventDay(b)) return err('invalid_state', 'The event has begun');
  return ok(
    produce(state, (d) => {
      const x = d.bookings.find((y) => y.id === bookingId) as Booking;
      x.status = to;
      x.type = 'prebooking';
      delete x.cancelled;
      delete x.confirmedBy;
      delete x.confirmedOn;
      delete x.confirmSeq;
      if (to === 'submitted') x.submittedAt = today;
      for (const l of x.lines) {
        // the gear may be gone: whatever is short now has to be seen and decided again
        l.conflictAck = false;
        delete l.overrideReason;
        const src = d.bookings.find((y) => y.id === l.fromBookingId);
        if (src && ARCHIVED_STATUSES.includes(src.status)) delete l.fromBookingId;
      }
      postEvent(d, bookingId, user.id, today, 'reopened', { to });
      if (x.pmId !== user.id)
        notify(
          d,
          [x.pmId],
          {
            type: 'booking_reopened',
            text: `${x.eventName} was taken back`,
            params: { event: x.eventName, to },
            bookingId,
          },
          today,
        );
    }).state,
  );
}
