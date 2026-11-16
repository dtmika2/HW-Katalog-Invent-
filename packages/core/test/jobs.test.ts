import { describe, expect, it } from 'vitest';
import { runDailyJobs, type AppState, type NotificationType } from '../src';
import { baseState, bk, item, ln, order, U, W, withBookings } from './helpers';

/** Run the job on each day in order; collect (day, type, recipients). */
function runDays(s0: AppState, days: string[]) {
  let s = s0;
  const fired: { day: string; type: NotificationType; users: string[] }[] = [];
  for (const d of days) {
    const r = runDailyJobs(s, d);
    s = r.state;
    const byType = new Map<NotificationType, string[]>();
    for (const n of r.notifications) byType.set(n.type, [...(byType.get(n.type) ?? []), n.userId]);
    for (const [type, users] of byType) fired.push({ day: d, type, users: users.sort() });
  }
  return { s, fired };
}
const daysOf = (fired: { day: string; type: NotificationType }[], type: NotificationType) =>
  fired.filter((f) => f.type === type).map((f) => f.day);
const range = (from: number, to: number, month = '04') =>
  Array.from(
    { length: to - from + 1 },
    (_, i) => `2027-${month}-${String(from + i).padStart(2, '0')}`,
  );

describe('daily jobs', () => {
  it('is idempotent for the same day', () => {
    const s = withBookings(
      baseState(),
      bk({ id: 'p1', status: 'submitted', submittedAt: '2027-04-10' }),
    );
    const r1 = runDailyJobs(s, '2027-04-12');
    expect(r1.notifications.length).toBeGreaterThan(0);
    expect(runDailyJobs(r1.state, '2027-04-12').notifications).toHaveLength(0);
  });

  it('pre-booking waiting for validation: 2 days after submit, then every 2 days → Chief', () => {
    const s = withBookings(
      baseState(),
      bk({ id: 'p1', status: 'submitted', submittedAt: '2027-04-10' }),
    );
    const { fired } = runDays(s, range(10, 17));
    expect(daysOf(fired, 'validation_waiting')).toEqual(['2027-04-12', '2027-04-14', '2027-04-16']);
    expect(fired.find((f) => f.type === 'validation_waiting')?.users).toEqual([U.tomas.id]);
  });

  it('pre-booking about to expire (3 days before) and expired on the event’s first day', () => {
    const s = withBookings(baseState(), bk({ id: 'p1', status: 'draft' }));
    const { s: after, fired } = runDays(s, range(18, 24));
    expect(daysOf(fired, 'prebooking_expiring')).toEqual(['2027-04-20']);
    expect(fired.find((f) => f.type === 'prebooking_expiring')?.users).toEqual(
      [U.petr.id, U.tomas.id].sort(),
    );
    expect(daysOf(fired, 'prebooking_expired')).toEqual(['2027-04-23']);
    expect(after.bookings[0]!.status).toBe('expired');
  });

  it('upcoming loading: 1 day before booked-from → warehouse', () => {
    const s = withBookings(baseState(), order({ id: 'o1', lines: [ln('l1', item('hazer'), 1)] }));
    const { fired } = runDays(s, range(19, 23));
    expect(daysOf(fired, 'upcoming_loading')).toEqual(['2027-04-21']);
    expect(fired.find((f) => f.type === 'upcoming_loading')?.users).toEqual(
      [U.karel.id, U.martin.id].sort(),
    );
  });

  it('overdue return: day after booked-until, then every 2 days → warehouse and Chief', () => {
    const s = withBookings(
      baseState(),
      order({ id: 'o1', status: 'shipped', lines: [ln('l1', item('hazer'), 1)] }),
    );
    const { fired } = runDays(s, range(24, 30));
    expect(daysOf(fired, 'overdue_return')).toEqual(['2027-04-26', '2027-04-28', '2027-04-30']);
    expect(fired.find((f) => f.type === 'overdue_return')?.users).toEqual(
      [U.karel.id, U.martin.id, U.tomas.id].sort(),
    );
  });

  it('service case overdue: day after expected back, then every 3 days → responsible and Chief', () => {
    const s = baseState();
    s.serviceCases.push({
      id: 'svc',
      itemId: 'hazer',
      warehouseId: W.brod,
      qty: 1,
      reason: 'x',
      internal: true,
      responsibleUserId: U.karel.id,
      status: 'in_progress',
      openedOn: '2027-04-01',
      expectedBack: '2027-04-10',
      events: [],
    });
    const { fired } = runDays(s, range(9, 17));
    expect(daysOf(fired, 'service_overdue')).toEqual(['2027-04-11', '2027-04-14', '2027-04-17']);
    expect(fired.find((f) => f.type === 'service_overdue')?.users).toEqual(
      [U.karel.id, U.tomas.id].sort(),
    );
  });

  it('external rental not returned to supplier: day after return date, then every 2 days → Chief', () => {
    const ext = ln(
      'e1',
      {
        external: { name: 'AX9', supplier: 'Rent', pickup: '2027-04-22', returnDate: '2027-04-25' },
      },
      8,
    );
    const s = withBookings(baseState(), order({ id: 'o1', status: 'shipped', lines: [ext] }));
    s.shipments.push({
      id: 'sh',
      bookingId: 'o1',
      label: 'x',
      shippedOn: '2027-04-22',
      userId: U.martin.id,
      lines: [{ lineId: 'e1', qty: 8 }],
    });
    const { fired } = runDays(s, range(25, 28));
    expect(daysOf(fired, 'external_not_returned')).toEqual(['2027-04-26', '2027-04-28']);
    expect(fired.find((f) => f.type === 'external_not_returned')?.users).toEqual([U.tomas.id]);
  });

  it('incomplete case: after 2 days → warehouse, after 7 days → Chief (not while on an active order)', () => {
    const s = baseState();
    s.cases[0]!.contents[0]!.qty = 7;
    s.cases[0]!.incompleteSince = '2027-04-10';
    const { fired } = runDays(s, range(10, 18));
    expect(fired.filter((f) => f.type === 'case_incomplete').map((f) => [f.day, f.users])).toEqual([
      ['2027-04-12', [U.karel.id, U.martin.id].sort()],
      ['2027-04-17', [U.tomas.id]],
    ]);
    // the same case while its pieces are out on an active order is skipped
    const s2 = withBookings(
      baseState(),
      order({ id: 'o1', status: 'shipped', lines: [ln('l1', item('ax9'), 1)] }),
    );
    s2.cases[0]!.contents[0]!.qty = 7;
    s2.cases[0]!.incompleteSince = '2027-04-10';
    s2.shipments.push({
      id: 'sh',
      bookingId: 'o1',
      label: 'x',
      shippedOn: '2027-04-10',
      userId: U.martin.id,
      lines: [{ lineId: 'l1', qty: 1, fromCaseId: 'case-1' }],
    });
    expect(daysOf(runDays(s2, range(10, 18)).fired, 'case_incomplete')).toEqual([]);
  });

  it('unresolved conflict: 7 days before booked-from, then daily → Chief and PMs of both orders', () => {
    const a = order({ id: 'o1', pmId: U.jana.id, lines: [ln('l1', item('ledbeam'), 10)] }, 1);
    const b = order(
      { id: 'o2', pmId: U.petr.id, lines: [ln('l1', item('ledbeam'), 4, { overrideReason: 'x' })] },
      2,
    );
    const s = withBookings(baseState(), a, b);
    s.conflicts.push({
      id: 'cfl-1',
      bookingId: 'o2',
      lineId: 'l1',
      target: { itemId: 'ledbeam' },
      warehouseId: W.brod,
      shortQty: 2,
      days: [],
      collidingBookingIds: ['o1'],
      status: 'new',
      source: 'override',
      overrideReason: 'x',
      createdOn: '2027-04-01',
    });
    const { fired } = runDays(s, range(13, 17));
    expect(daysOf(fired, 'conflict_unresolved')).toEqual([
      '2027-04-15',
      '2027-04-16',
      '2027-04-17',
    ]);
    expect(fired.find((f) => f.type === 'conflict_unresolved')?.users).toEqual(
      [U.jana.id, U.petr.id, U.tomas.id].sort(),
    );
  });
});
