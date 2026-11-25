/**
 * In-app notifications and the booking thread (messages + system events).
 */
import type { IsoDate } from '../dates';
import type {
  AppState,
  Id,
  Message,
  Notification,
  NotificationType,
  Params,
  Role,
  SystemEventType,
  User,
} from '../types';
import { nextId, produce, uniq } from '../util';

export interface NotifyInput {
  type: NotificationType;
  params?: Params;
  text: string;
  bookingId?: Id;
  highPriority?: boolean;
}

/** Active users with a role. */
export function usersWithRole(state: Pick<AppState, 'users'>, role: Role): User[] {
  return state.users.filter((u) => u.active && u.role === role);
}

export const chiefIds = (s: Pick<AppState, 'users'>): Id[] =>
  usersWithRole(s, 'chief').map((u) => u.id);
export const warehouseIds = (s: Pick<AppState, 'users'>): Id[] =>
  usersWithRole(s, 'warehouse').map((u) => u.id);

/** Push one notification per distinct recipient into a draft state. */
export function notify(
  draft: AppState,
  userIds: (Id | undefined)[],
  input: NotifyInput,
  on: IsoDate,
): void {
  for (const userId of uniq(userIds.filter((u): u is Id => !!u))) {
    const n: AppState['notifications'][number] = {
      id: nextId(draft, 'ntf'),
      userId,
      type: input.type,
      params: input.params ?? {},
      text: input.text,
      on,
      read: false,
    };
    if (input.bookingId) n.bookingId = input.bookingId;
    if (input.highPriority) n.highPriority = true;
    draft.notifications.push(n);
  }
}

/** Append a system event to a booking thread (draft state). */
export function postEvent(
  draft: AppState,
  bookingId: Id,
  authorId: Id,
  on: IsoDate,
  type: SystemEventType,
  params: Params = {},
): void {
  draft.messages.push({
    id: nextId(draft, 'msg'),
    bookingId,
    authorId,
    on,
    event: { type, params },
  });
}

/** Post a free-text message in a booking thread. */
export function postMessage(
  state: AppState,
  user: User,
  bookingId: Id,
  text: string,
  on: IsoDate,
): AppState {
  if (!text.trim()) return state;
  return produce(state, (d) => {
    d.messages.push({ id: nextId(d, 'msg'), bookingId, authorId: user.id, on, text: text.trim() });
  }).state;
}

/** Thread of a booking in insertion order. */
export function thread(state: Pick<AppState, 'messages'>, bookingId: Id): Message[] {
  return state.messages.filter((m) => m.bookingId === bookingId);
}

/** How important a notification is, most important first. */
export const NOTIFICATION_LEVELS = ['urgent', 'attention', 'info'] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

/** Importance per type. A Record, so a new notification type cannot be left without a level. */
const LEVEL_OF_TYPE: Record<NotificationType, NotificationLevel> = {
  conflict_detected: 'urgent',
  conflict_overridden: 'urgent',
  conflict_unresolved: 'urgent',
  order_edited_after_packing: 'urgent',
  overdue_return: 'urgent',
  service_affects_order: 'urgent',
  external_not_returned: 'urgent',
  returned_with_issues: 'attention',
  case_shipped_short: 'attention',
  loan_overdue: 'attention',
  promised_missing: 'attention',
  shipping_cancelled: 'attention',
  cancel_requested: 'attention',
  cancel_decided: 'attention',
  reservation_affected: 'attention',
  booking_cancelled: 'attention',
  booking_reopened: 'info',
  cancel_unpack: 'urgent',
  gear_released: 'info',
  transfer_lost: 'attention',
  order_packed: 'info',
  prebooking_returned: 'attention',
  prebooking_expiring: 'attention',
  prebooking_expired: 'attention',
  validation_waiting: 'attention',
  upcoming_loading: 'attention',
  service_overdue: 'attention',
  case_incomplete: 'info',
  order_confirmed: 'info',
  batch_shipped: 'info',
  prebooking_submitted: 'info',
  service_opened: 'info',
  service_fixed: 'info',
};

/**
 * Importance of a notification. Derived from its type, never stored: high priority is always
 * urgent, and a case that stays incomplete for a week is raised from info to attention.
 */
export function notificationLevel(
  n: Pick<Notification, 'type' | 'params' | 'highPriority'>,
): NotificationLevel {
  if (n.highPriority) return 'urgent';
  if (n.type === 'case_incomplete' && n.params.escalated) return 'attention';
  return LEVEL_OF_TYPE[n.type];
}

/** The most important level among a user's unread notifications. */
export function highestUnreadLevel(
  state: Pick<AppState, 'notifications'>,
  userId: Id,
): NotificationLevel | undefined {
  const unread = new Set(
    state.notifications.filter((n) => n.userId === userId && !n.read).map(notificationLevel),
  );
  return NOTIFICATION_LEVELS.find((l) => unread.has(l));
}

export function unreadCount(state: Pick<AppState, 'notifications'>, userId: Id): number {
  return state.notifications.filter((n) => n.userId === userId && !n.read).length;
}

/** Mark notifications of a user read (all, or the listed ids). */
export function markRead(state: AppState, userId: Id, ids?: Id[]): AppState {
  return produce(state, (d) => {
    for (const n of d.notifications) {
      if (n.userId === userId && (!ids || ids.includes(n.id))) n.read = true;
    }
  }).state;
}
