import { describe, expect, it } from 'vitest';
import {
  highestUnreadLevel,
  NOTIFICATION_LEVELS,
  notificationLevel,
  type Notification,
  type NotificationType,
} from '../src';
import { baseState } from './helpers';

const n = (type: NotificationType, extra: Partial<Notification> = {}): Notification => ({
  id: `n-${type}`,
  userId: 'u1',
  type,
  params: {},
  text: type,
  on: '2027-04-20',
  read: false,
  ...extra,
});

describe('notification importance', () => {
  it('conflicts, overdue returns and changes after packing are urgent; routine news is info', () => {
    const level = (t: NotificationType) => notificationLevel(n(t));
    for (const t of [
      'conflict_detected',
      'conflict_overridden',
      'conflict_unresolved',
      'order_edited_after_packing',
      'overdue_return',
      'service_affects_order',
      'external_not_returned',
    ] as const)
      expect(level(t)).toBe('urgent');
    for (const t of [
      'returned_with_issues',
      'prebooking_returned',
      'prebooking_expiring',
      'prebooking_expired',
      'validation_waiting',
      'upcoming_loading',
      'service_overdue',
    ] as const)
      expect(level(t)).toBe('attention');
    for (const t of [
      'order_confirmed',
      'batch_shipped',
      'prebooking_submitted',
      'service_opened',
      'service_fixed',
    ] as const)
      expect(level(t)).toBe('info');
  });

  it('high priority is always urgent', () => {
    expect(notificationLevel(n('batch_shipped', { highPriority: true }))).toBe('urgent');
  });

  it('an incomplete case is info at first and attention after a week', () => {
    expect(notificationLevel(n('case_incomplete'))).toBe('info');
    expect(notificationLevel(n('case_incomplete', { params: { escalated: 1 } }))).toBe('attention');
  });

  it('the bell level is the most important unread one of that user', () => {
    expect(NOTIFICATION_LEVELS).toEqual(['urgent', 'attention', 'info']);
    const s = {
      ...baseState(),
      notifications: [
        n('batch_shipped'),
        n('service_overdue'),
        n('overdue_return', { read: true }),
        n('conflict_detected', { userId: 'u2' }),
      ],
    };
    expect(highestUnreadLevel(s, 'u1')).toBe('attention');
    expect(highestUnreadLevel(s, 'u2')).toBe('urgent');
    expect(highestUnreadLevel(s, 'u3')).toBeUndefined();
  });
});
