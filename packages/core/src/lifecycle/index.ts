/**
 * Booking lifecycle: pre-booking → (validation) → order → packing → shipped → vratka → closed.
 * Each action checks role/permission and the current state and returns a typed error otherwise.
 */
import type { IsoDate } from '../dates';
import { evaluateBooking, firstEventDay } from '../availability';
import { addConflictRecord, detectConflicts, recomputeConflictRecords } from '../conflicts';
import { chiefIds, notify, postEvent, warehouseIds } from '../notifications';
import type { AppState, Booking, BookingPeriod, BookingStatus, Id, User } from '../types';
import { SYSTEM_USER_ID } from '../types';
import { err, isExternal, nextId, ok, produce, type Result } from '../util';
import { recalcBooking } from './edit';
import { can, type Action } from './permissions';

export * from './edit';
export * from './permissions';

export type LifecycleAction =
  | 'submit'
  | 'returnToPm'
  | 'confirm'
  | 'startPacking'
  | 'ship'
  | 'addLinesAfterShipping'
  | 'recordReturnSession'
  | 'resolveIssue'
  | 'close'
  | 'expire';

/** Allowed source statuses per action and the resulting status. */
export const TRANSITIONS: Record<
  LifecycleAction,
  { from: BookingStatus[]; to: BookingStatus | 'computed' }
> = {
  submit: { from: ['draft'], to: 'submitted' },
  returnToPm: { from: ['submitted'], to: 'draft' },
  confirm: { from: ['draft', 'submitted'], to: 'confirmed' },
  startPacking: { from: ['confirmed'], to: 'packing' },
  ship: { from: ['packing', 'shipped'], to: 'shipped' },
  addLinesAfterShipping: { from: ['shipped', 'returning'], to: 'packing' },
  // 'packing' too: part of the order may already be out (batches) and come back
  recordReturnSession: {
    from: ['packing', 'shipped', 'returning', 'returned_with_issues'],
    to: 'computed',
  },
  resolveIssue: {
    from: ['returned_with_issues', 'returning', 'returned', 'closed'],
    to: 'computed',
  },
  close: { from: ['returned'], to: 'closed' },
  expire: { from: ['draft', 'submitted'], to: 'expired' },
};

const PERMISSION_OF: Record<LifecycleAction, Action> = {
  submit: 'submit',
  returnToPm: 'return_to_pm',
  confirm: 'confirm',
  startPacking: 'start_packing',
  ship: 'ship',
  addLinesAfterShipping: 'add_lines_after_shipping',
  recordReturnSession: 'record_return',
  resolveIssue: 'resolve_issue',
  close: 'close',
  expire: 'admin',
};

export function findBooking(state: Pick<AppState, 'bookings'>, id: Id): Booking | undefined {
  return state.bookings.find((b) => b.id === id);
}

/** Check permission and current status for a lifecycle action. */
export function guard(
  state: AppState,
  user: User,
  action: LifecycleAction,
  bookingId: Id,
): Result<Booking> {
  const b = findBooking(state, bookingId);
  if (!b) return err('not_found', `Booking ${bookingId} not found`);
  if (action !== 'expire' && !can(user, PERMISSION_OF[action], b)) {
    return err('forbidden', `${user.name} may not ${action} booking ${b.eventName}`);
  }
  if (!TRANSITIONS[action].from.includes(b.status)) {
    return err('invalid_state', `Cannot ${action} a booking in state ${b.status}`, {
      action,
      status: b.status,
    });
  }
  return ok(b);
}

/** Actions a user can take on a booking right now (for showing buttons). */
export function availableActions(state: AppState, user: User, bookingId: Id): LifecycleAction[] {
  return (Object.keys(TRANSITIONS) as LifecycleAction[]).filter(
    (a) => a !== 'expire' && a !== 'resolveIssue' && guard(state, user, a, bookingId).ok,
  );
}

export interface NewBookingInput {
  eventName: string;
  clientId?: Id;
  purposeMessage?: string;
  periods: BookingPeriod[];
  defaultWarehouseId?: Id;
  /** Chief creating on behalf of a PM. */
  pmId?: Id;
  id?: Id;
}

/** Create an empty pre-booking (draft). */
export function createBooking(
  state: AppState,
  user: User,
  today: IsoDate,
  input: NewBookingInput,
): Result<{ state: AppState; bookingId: Id }> {
  if (!can(user, 'create_booking'))
    return err('forbidden', 'Only PMs and the Chief create bookings');
  if (!input.eventName.trim()) return err('validation', 'Event name is required');
  if (input.periods.length === 0) return err('validation', 'At least one period is required');
  for (const p of input.periods) {
    if (p.bookedFrom > p.eventFrom || p.bookedUntil < p.eventTo || p.eventFrom > p.eventTo) {
      return err('validation', 'Booked period must cover the event');
    }
  }
  const { state: next, result: id } = produce(state, (d) => {
    const id = input.id ?? nextId(d, 'bk');
    const b: Booking = {
      id,
      type: 'prebooking',
      status: 'draft',
      eventName: input.eventName.trim(),
      purposeMessage: input.purposeMessage ?? '',
      pmId: input.pmId ?? user.id,
      createdAt: today,
      periods: input.periods,
      lines: [],
      defaultWarehouseId: input.defaultWarehouseId ?? d.warehouses[0]?.id ?? '',
      orChoices: {},
      dismissedRecommendations: [],
      dismissedChecks: [],
      suppressedAuto: {},
    };
    if (input.clientId) b.clientId = input.clientId;
    d.bookings.push(b);
    postEvent(d, id, user.id, today, 'created', { event: b.eventName });
    return id;
  });
  return ok({ state: next, bookingId: id });
}

const EDITABLE: BookingStatus[] = ['draft', 'submitted', 'confirmed', 'packing'];

/**
 * Store an edited booking (header fields and lines). PMs edit their own pre-bookings; the Chief
 * edits any booking up to packing. Confirmed orders run the same conflict check as confirmation;
 * edits during packing notify the warehouse with high priority.
 */
export function saveBooking(
  state: AppState,
  user: User,
  today: IsoDate,
  edited: Booking,
): Result<AppState> {
  const current = findBooking(state, edited.id);
  if (!current) return err('not_found', `Booking ${edited.id} not found`);
  if (!can(user, 'edit_booking', current))
    return err('forbidden', 'Not allowed to edit this booking');
  if (!EDITABLE.includes(current.status)) {
    return err('invalid_state', `Cannot edit a booking in state ${current.status}`);
  }
  const { booking: recalced, expansion } = recalcBooking(state, {
    ...edited,
    type: current.type,
    status: current.status,
    pmId: current.pmId,
  });

  const isOrder = current.type === 'order';
  let overridden: ReturnType<typeof detectConflicts> = [];
  if (isOrder) {
    if (expansion.openOrChoices.length > 0) {
      return err('open_or_choices', 'Choose an option in every OR group', {
        groups: expansion.openOrChoices.map((o) => o.groupKey),
      });
    }
    const conflicts = detectConflicts(state, recalced);
    const blocking = conflicts.filter(
      (c) => !recalced.lines.find((l) => l.id === c.lineId)?.overrideReason?.trim(),
    );
    const previouslyCovered = new Set(
      state.conflicts
        .filter((r) => r.bookingId === current.id && r.status !== 'resolved')
        .map((r) => r.lineId),
    );
    const newlyBlocking = blocking.filter((c) => !previouslyCovered.has(c.lineId));
    if (newlyBlocking.length > 0) {
      return err('blocking_conflicts', 'Some lines are short', {
        lineIds: newlyBlocking.map((c) => c.lineId),
      });
    }
    overridden = conflicts.filter((c) => !previouslyCovered.has(c.lineId));
  }

  const next = produce(state, (d) => {
    const i = d.bookings.findIndex((b) => b.id === current.id);
    d.bookings[i] = recalced;
    postEvent(d, current.id, user.id, today, 'edited', {});
    for (const c of overridden) {
      const reason = recalced.lines.find((l) => l.id === c.lineId)?.overrideReason ?? '';
      addConflictRecord(d, recalced, c, 'override', reason, today);
      postEvent(d, current.id, user.id, today, 'override', { lineId: c.lineId, reason });
    }
    if (current.status === 'packing') {
      notify(
        d,
        warehouseIds(d),
        {
          type: 'order_edited_after_packing',
          text: `Order ${current.eventName} edited during packing`,
          params: { event: current.eventName },
          bookingId: current.id,
          highPriority: true,
        },
        today,
      );
    }
  }).state;
  return ok(recomputeConflictRecords(next, today));
}

/** PM submits a pre-booking for validation. Red lines must be acknowledged. */
export function submitPrebooking(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
): Result<AppState> {
  const g = guard(state, user, 'submit', bookingId);
  if (!g.ok) return g;
  if (g.value.type !== 'prebooking') return err('invalid_state', 'Only pre-bookings are submitted');
  const { booking } = recalcBooking(state, g.value);
  if (booking.lines.length === 0) return err('validation', 'The pre-booking has no lines');
  const unacked = detectConflicts(state, booking).filter(
    (c) => !booking.lines.find((l) => l.id === c.lineId)?.conflictAck,
  );
  if (unacked.length > 0) {
    return err('conflict_unacknowledged', 'Acknowledge every conflict before submitting', {
      lineIds: unacked.map((c) => c.lineId),
    });
  }
  return ok(
    produce(state, (d) => {
      const b = d.bookings.find((x) => x.id === bookingId) as Booking;
      b.lines = booking.lines;
      b.status = 'submitted';
      b.submittedAt = today;
      delete b.returnedToPm;
      postEvent(d, b.id, user.id, today, 'submitted', {});
      notify(
        d,
        chiefIds(d),
        {
          type: 'prebooking_submitted',
          text: `Pre-booking ${b.eventName} submitted`,
          params: { event: b.eventName },
          bookingId: b.id,
        },
        today,
      );
    }).state,
  );
}

/** Chief sends a pre-booking back to the PM with questions or missing items. */
export function returnToPm(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  reason: string,
): Result<AppState> {
  const g = guard(state, user, 'returnToPm', bookingId);
  if (!g.ok) return g;
  if (!reason.trim()) return err('validation', 'A reason is required');
  return ok(
    produce(state, (d) => {
      const b = d.bookings.find((x) => x.id === bookingId) as Booking;
      b.status = 'draft';
      b.returnedToPm = { by: user.id, on: today, reason: reason.trim() };
      postEvent(d, b.id, user.id, today, 'returned_to_pm', { reason: reason.trim() });
      notify(
        d,
        [b.pmId],
        {
          type: 'prebooking_returned',
          text: `Pre-booking ${b.eventName} returned: ${reason.trim()}`,
          params: { event: b.eventName, reason: reason.trim() },
          bookingId: b.id,
        },
        today,
      );
    }).state,
  );
}

/**
 * Turn a pre-booking into an order. Blocked while an OR choice is open or a line is short,
 * unless the short line is external or carries an override reason (→ conflict record).
 */
export function confirmBooking(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
): Result<AppState> {
  const g = guard(state, user, 'confirm', bookingId);
  if (!g.ok) return g;
  if (g.value.type !== 'prebooking') return err('invalid_state', 'Already an order');
  const { booking, expansion } = recalcBooking(state, g.value);
  if (booking.lines.length === 0) return err('validation', 'The booking has no lines');
  if (expansion.openOrChoices.length > 0) {
    return err('open_or_choices', 'Choose an option in every OR group', {
      groups: expansion.openOrChoices.map((o) => o.groupKey),
    });
  }
  const av = evaluateBooking(state, booking);
  const conflicts = detectConflicts(state, booking, av);
  const blocking = conflicts.filter((c) => {
    const l = booking.lines.find((x) => x.id === c.lineId);
    return !l || (!isExternal(l.target) && !l.overrideReason?.trim());
  });
  if (blocking.length > 0) {
    return err(
      'blocking_conflicts',
      'Some lines are short: cover them externally or override with a reason',
      {
        lineIds: blocking.map((c) => c.lineId),
      },
    );
  }
  const next = produce(state, (d) => {
    const b = d.bookings.find((x) => x.id === bookingId) as Booking;
    b.lines = booking.lines;
    b.type = 'order';
    b.status = 'confirmed';
    b.confirmedBy = user.id;
    b.confirmedOn = today;
    b.confirmSeq = Math.max(0, ...d.bookings.map((x) => x.confirmSeq ?? 0)) + 1;
    delete b.returnedToPm;
    postEvent(d, b.id, user.id, today, 'confirmed', {});
    for (const c of conflicts) {
      const reason = b.lines.find((l) => l.id === c.lineId)?.overrideReason ?? '';
      addConflictRecord(d, b, c, 'override', reason, today);
      postEvent(d, b.id, user.id, today, 'override', { lineId: c.lineId, reason });
    }
    notify(
      d,
      [b.pmId, ...warehouseIds(d), ...chiefIds(d)],
      {
        type: 'order_confirmed',
        text: `Order ${b.eventName} confirmed`,
        params: { event: b.eventName },
        bookingId: b.id,
      },
      today,
    );
  }).state;
  return ok(recomputeConflictRecords(next, today));
}

/** Warehouse starts packing a confirmed order. */
export function startPacking(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
): Result<AppState> {
  const g = guard(state, user, 'startPacking', bookingId);
  if (!g.ok) return g;
  return ok(
    produce(state, (d) => {
      const b = d.bookings.find((x) => x.id === bookingId) as Booking;
      b.status = 'packing';
      postEvent(d, b.id, user.id, today, 'packing_started', {});
    }).state,
  );
}

/** Close a fully returned order; the record becomes read-only. */
export function closeBooking(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
): Result<AppState> {
  const g = guard(state, user, 'close', bookingId);
  if (!g.ok) return g;
  return ok(
    produce(state, (d) => {
      const b = d.bookings.find((x) => x.id === bookingId) as Booking;
      b.status = 'closed';
      b.closedOn = today;
      postEvent(d, b.id, user.id, today, 'closed', {});
    }).state,
  );
}

/** Nightly job: a pre-booking not turned into an order by the event's first day expires. */
export function expireBooking(state: AppState, today: IsoDate, bookingId: Id): Result<AppState> {
  const b = findBooking(state, bookingId);
  if (!b) return err('not_found', `Booking ${bookingId} not found`);
  if (b.type !== 'prebooking' || !TRANSITIONS.expire.from.includes(b.status)) {
    return err('invalid_state', `Cannot expire a booking in state ${b.status}`);
  }
  if (today < firstEventDay(b))
    return err('invalid_state', 'Pre-booking expires on the event date');
  return ok(
    produce(state, (d) => {
      const x = d.bookings.find((y) => y.id === bookingId) as Booking;
      x.status = 'expired';
      postEvent(d, x.id, SYSTEM_USER_ID, today, 'expired', {});
      notify(
        d,
        [x.pmId],
        {
          type: 'prebooking_expired',
          text: `Pre-booking ${x.eventName} expired`,
          params: { event: x.eventName },
          bookingId: x.id,
        },
        today,
      );
    }).state,
  );
}
