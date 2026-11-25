/**
 * Roles are presets of permissions; per-user flags add to them. Every state-changing action
 * checks `can()` first.
 */
import type { Booking, User } from '../types';

export type Action =
  | 'create_booking'
  | 'edit_booking'
  | 'submit'
  | 'return_to_pm'
  | 'confirm'
  | 'start_packing'
  | 'ship'
  | 'add_lines_after_shipping'
  | 'record_return'
  | 'resolve_issue'
  | 'close'
  | 'remove_auto_line'
  | 'dismiss_check'
  | 'override_conflict'
  | 'edit_catalogue'
  | 'open_service'
  | 'manage_service'
  | 'manage_conflicts'
  | 'refill_case'
  | 'create_client'
  | 'manage_clients'
  | 'admin';

const isChief = (u: User) => u.role === 'chief';

/** True when `user` may perform `action` (on `booking`, when given). */
export function can(user: User, action: Action, booking?: Booking): boolean {
  if (!user.active) return false;
  const own = !!booking && booking.pmId === user.id;
  switch (action) {
    case 'create_booking':
      return user.role === 'pm' || isChief(user);
    case 'edit_booking':
      if (isChief(user)) return true;
      return user.role === 'pm' && own && booking?.type === 'prebooking';
    case 'submit':
      return (user.role === 'pm' && own) || isChief(user);
    case 'return_to_pm':
      return isChief(user);
    case 'confirm':
      return isChief(user) || (user.role === 'pm' && own && user.perms.canConfirmOwnOrders);
    case 'override_conflict':
      return isChief(user) || (user.role === 'pm' && own && user.perms.canConfirmOwnOrders);
    case 'start_packing':
    case 'ship':
    case 'record_return':
    case 'refill_case':
      return user.role === 'warehouse';
    case 'add_lines_after_shipping':
    case 'resolve_issue':
    case 'remove_auto_line':
    case 'dismiss_check':
    case 'manage_conflicts':
      return isChief(user);
    case 'close':
      return isChief(user) || user.role === 'warehouse';
    case 'edit_catalogue':
      return isChief(user) || user.role === 'admin' || user.perms.canEditCatalogue;
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
