/**
 * Asking the Chief to cancel: once the event has begun the warehouse cannot cancel on its own. It
 * confirms what is back and why, the Chief approves or declines. So the person who sees the gear
 * confirms it, and the decision is the Chief's.
 */
import type { IsoDate } from '../dates';
import { can } from '../lifecycle/permissions';
import { chiefIds, notify, postEvent } from '../notifications';
import { cancelGuard, cancelLocked, cancelPacking, packingBackItems } from '../packing';
import { canCancelShipment, cancelShipment, shipmentBackItems } from '../shipping';
import type { AppState, Booking, CancelRequest, Id, User } from '../types';
import { err, nextId, ok, produce, type Result } from '../util';

/** What a request wants to cancel, for texts: the delivery's label, or '' for packing. */
export function requestLabel(
  state: Pick<AppState, 'shipments'>,
  r: Pick<CancelRequest, 'shipmentId'>,
): string {
  return state.shipments.find((x) => x.id === r.shipmentId)?.label ?? '';
}

/** Requests waiting for the Chief; one whose target can no longer be cancelled is gone. */
export function openCancelRequests(state: AppState, b: Booking): CancelRequest[] {
  if (!['packing', 'packed', 'shipped'].includes(b.status)) return [];
  return (b.cancelRequests ?? []).filter(
    (r) => !r.shipmentId || canCancelShipment(state, r.shipmentId),
  );
}

export interface CancelRequestInput {
  /** The delivery to cancel; without it, the packing. */
  shipmentId?: Id;
  confirmed: readonly Id[];
  reason: string;
}

/** The warehouse confirms what is back and asks the Chief to cancel. */
export function requestCancel(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  input: CancelRequestInput,
): Result<AppState> {
  const b = state.bookings.find((x) => x.id === bookingId);
  if (!b) return err('not_found', `Booking ${bookingId} not found`);
  if (!can(user, 'cancel_delivery', b)) return err('forbidden', 'Not allowed to ask for this');
  if (!cancelLocked(b, today) || can(user, 'cancel_after_start', b))
    return err('invalid_state', 'It can be cancelled directly');
  if (!input.reason.trim()) return err('validation', 'A reason is required', { field: 'reason' });
  const { shipmentId } = input;
  if (shipmentId) {
    const s = state.shipments.find((x) => x.id === shipmentId);
    if (s?.bookingId !== bookingId) return err('not_found', `Shipment ${shipmentId} not found`);
    if (!canCancelShipment(state, shipmentId))
      return err('invalid_state', 'The delivery can no longer be cancelled');
  }
  if (openCancelRequests(state, b).some((r) => r.shipmentId === shipmentId))
    return err('invalid_state', 'The Chief has already been asked');
  const items = shipmentId ? shipmentBackItems(state, shipmentId) : packingBackItems(state, b);
  // the same rules as for cancelling, as if the Chief did it
  const g = cancelGuard(state, { ...user, role: 'chief' }, today, bookingId, items, {
    confirmed: input.confirmed,
    reason: input.reason,
  });
  if (!g.ok) return g;
  return ok(
    produce(state, (d) => {
      const booking = d.bookings.find((x) => x.id === bookingId) as Booking;
      const r: CancelRequest = {
        id: nextId(d, 'cnr'),
        by: user.id,
        on: today,
        reason: input.reason.trim(),
        confirmed: [...input.confirmed],
      };
      if (shipmentId) r.shipmentId = shipmentId;
      booking.cancelRequests = [...openCancelRequests(d, booking), r];
      const label = requestLabel(d, r);
      postEvent(d, bookingId, user.id, today, 'cancel_requested', { label, reason: r.reason });
      notify(
        d,
        chiefIds(d),
        {
          type: 'cancel_requested',
          text: `${booking.eventName}: ${user.name} asks to cancel ${label || 'packing'}`,
          params: { event: booking.eventName, label, reason: r.reason, who: user.name },
          bookingId,
        },
        today,
      );
    }).state,
  );
}

function find(state: AppState, bookingId: Id, requestId: Id): Result<[Booking, CancelRequest]> {
  const b = state.bookings.find((x) => x.id === bookingId);
  const r = b && openCancelRequests(state, b).find((x) => x.id === requestId);
  return b && r ? ok([b, r]) : err('not_found', 'The request is no longer open');
}

function decided(
  d: AppState,
  b: Booking,
  r: CancelRequest,
  today: IsoDate,
  label: string,
  approved: boolean,
  reason: string,
): void {
  notify(
    d,
    [r.by],
    {
      type: 'cancel_decided',
      text: `${b.eventName}: cancelling was ${approved ? 'approved' : 'declined'}`,
      params: { event: b.eventName, label, approved: approved ? 1 : 0, reason },
      bookingId: b.id,
    },
    today,
  );
}

/** The Chief approves: cancelled with what the warehouse confirmed and its reason. */
export function approveCancel(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  requestId: Id,
): Result<AppState> {
  const f = find(state, bookingId, requestId);
  if (!f.ok) return f;
  const [b, r] = f.value;
  if (!can(user, 'cancel_after_start', b)) return err('forbidden', 'Only the Chief decides');
  const label = requestLabel(state, r);
  const input = { confirmed: r.confirmed, reason: r.reason };
  const done = r.shipmentId
    ? cancelShipment(state, user, today, r.shipmentId, input)
    : cancelPacking(state, user, today, bookingId, input);
  if (!done.ok) return done;
  return ok(produce(done.value, (d) => decided(d, b, r, today, label, true, '')).state);
}

/** The Chief declines with a reason; the gear comes back through the vratka. */
export function declineCancel(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  requestId: Id,
  reason: string,
): Result<AppState> {
  const f = find(state, bookingId, requestId);
  if (!f.ok) return f;
  const [b, r] = f.value;
  if (!can(user, 'cancel_after_start', b)) return err('forbidden', 'Only the Chief decides');
  const why = reason.trim();
  if (!why) return err('validation', 'A reason is required', { field: 'reason' });
  return ok(
    produce(state, (d) => {
      const booking = d.bookings.find((x) => x.id === bookingId) as Booking;
      booking.cancelRequests = (booking.cancelRequests ?? []).filter((x) => x.id !== requestId);
      const label = requestLabel(d, r);
      postEvent(d, bookingId, user.id, today, 'cancel_declined', { label, reason: why });
      decided(d, b, r, today, label, false, why);
    }).state,
  );
}

/** Whoever asked takes the request back. */
export function withdrawCancel(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  requestId: Id,
): Result<AppState> {
  const f = find(state, bookingId, requestId);
  if (!f.ok) return f;
  const [, r] = f.value;
  if (r.by !== user.id) return err('forbidden', 'Only who asked takes the request back');
  return ok(
    produce(state, (d) => {
      const booking = d.bookings.find((x) => x.id === bookingId) as Booking;
      booking.cancelRequests = (booking.cancelRequests ?? []).filter((x) => x.id !== requestId);
      postEvent(d, bookingId, user.id, today, 'cancel_withdrawn', { label: requestLabel(d, r) });
    }).state,
  );
}
