/**
 * Roles are presets of permissions; per-user flags add to them. Every state-changing action
 * checks `can()` first.
 */
import { RESERVATION_STATUSES, type AppState, type Booking, type User } from '../types';

export type Action =
  | 'create_booking'
  | 'see_reservations'
  | 'edit_booking'
  | 'submit'
  | 'return_to_pm'
  | 'confirm'
  | 'start_packing'
  | 'pack'
  | 'ship'
  | 'cancel_delivery'
  | 'cancel_after_start'
  | 'cancel_booking'
  | 'mark_line'
  | 'add_lines_after_shipping'
  | 'record_return'
  | 'resolve_issue'
  | 'close'
  | 'remove_auto_line'
  | 'dismiss_check'
  | 'override_conflict'
  | 'propose_override'
  | 'cover_external'
  | 'add_late_item'
  | 'edit_catalogue'
  | 'open_service'
  | 'manage_service'
  | 'manage_conflicts'
  | 'refill_case'
  | 'create_client'
  | 'borrow'
  | 'borrow_for_other'
  | 'manage_clients'
  | 'admin';

const isChief = (u: User) => u.role === 'chief';

/** Reservations without an order behind them are no concern of the warehouse. */
export function canSeeBooking(
  user: User,
  b: Pick<Booking, 'status' | 'cancelled' | 'expiredFrom'>,
): boolean {
  const stage = b.cancelled?.from ?? b.expiredFrom ?? b.status;
  return !RESERVATION_STATUSES.includes(stage) || can(user, 'see_reservations');
}

/** The state as `user` may see it, for lists, calendars and conflicts. */
export function visibleState<S extends Pick<AppState, 'bookings'>>(state: S, user: User): S {
  if (can(user, 'see_reservations')) return state;
  return { ...state, bookings: state.bookings.filter((b) => canSeeBooking(user, b)) };
}

/** True when `user` may perform `action` (on `booking`, when given). */
export function can(user: User, action: Action, booking?: Booking): boolean {
  if (!user.active) return false;
  const own = !!booking && booking.pmId === user.id;
  switch (action) {
    case 'create_booking':
      return user.role === 'pm' || isChief(user);
    case 'see_reservations':
      return user.role !== 'warehouse';
    case 'edit_booking':
      if (isChief(user)) return true;
      return user.role === 'pm' && own && booking?.type === 'prebooking';
    case 'cancel_booking':
    case 'propose_override':
    case 'cover_external':
    case 'submit':
      return (user.role === 'pm' && own) || isChief(user);
    case 'return_to_pm':
      return isChief(user);
    case 'confirm':
      return isChief(user) || (user.role === 'pm' && own && user.perms.canConfirmOwnOrders);
    case 'override_conflict':
      return isChief(user) || (user.role === 'pm' && own && user.perms.canConfirmOwnOrders);
    case 'start_packing':
    case 'pack':
    case 'ship':
    case 'record_return':
    case 'refill_case':
      return user.role === 'warehouse';
    case 'add_lines_after_shipping':
    case 'resolve_issue':
    case 'cancel_delivery':
      return isChief(user) || user.role === 'warehouse';
    case 'add_late_item':
      return user.role === 'warehouse' || isChief(user) || (user.role === 'pm' && own);
    case 'cancel_after_start':
    case 'mark_line':
    case 'remove_auto_line':
    case 'dismiss_check':
    case 'manage_conflicts':
      return isChief(user);
    case 'close':
      return isChief(user) || user.role === 'warehouse';
    case 'edit_catalogue':
      return isChief(user) || user.role === 'admin' || user.perms.canEditCatalogue;
    case 'borrow_for_other':
      return isChief(user) || user.role === 'warehouse';
    case 'borrow':
    case 'open_service':
      return true;
    case 'manage_service':
      return isChief(user) || user.perms.canManageService;
    case 'create_client':
      return user.role === 'pm' || isChief(user) || user.role === 'admin';
    case 'manage_clients':
    case 'admin':
      return isChief(user) || user.role === 'admin';
  }
}
