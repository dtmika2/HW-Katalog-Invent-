import { describe, expect, it } from 'vitest';
import {
  buildHoldIndex,
  evaluateBooking,
  itemCalendar,
  itemDay,
  itemDayTotal,
  lineWindows,
  minFreeInWarehouse,
  type AppState,
} from '../src';
import { baseState, bk, item, ln, order, P, U, W, withBookings } from './helpers';

const day = (s: AppState, itemId: string, d: string, w = W.brod) =>
  itemDay(s, buildHoldIndex(s), itemId, w, d);

describe('availability — items', () => {
  it('buffer days are included in the booked period', () => {
    const s = withBookings(
      baseState(),
      order({ id: 'o1', lines: [ln('l1', item('ledbeam'), 10)] }),
    );
    expect(day(s, 'ledbeam', '2027-04-21').free).toBe(12);
    expect(day(s, 'ledbeam', '2027-04-22').free).toBe(2); // buffer before
    expect(day(s, 'ledbeam', '2027-04-25').free).toBe(2); // buffer after
    expect(day(s, 'ledbeam', '2027-04-26').free).toBe(12);
  });

  it('a booking never counts against itself', () => {
    const o = order({ id: 'o1', lines: [ln('l1', item('ledbeam'), 12)] });
    const s = withBookings(baseState(), o);
    expect(evaluateBooking(s, o).get('l1')?.badge).toBe('green');
  });

  it('multi-period booking holds only its periods', () => {
    const o = order({
      id: 'o1',
      periods: [
        P('2027-04-02', '2027-04-03', '2027-04-01', '2027-04-04'),
        P('2027-04-10', '2027-04-11', '2027-04-09', '2027-04-12'),
      ],
      lines: [ln('l1', item('ledbeam'), 10)],
    });
    const s = withBookings(baseState(), o);
    expect(day(s, 'ledbeam', '2027-04-02').free).toBe(2);
    expect(day(s, 'ledbeam', '2027-04-06').free).toBe(12);
    expect(day(s, 'ledbeam', '2027-04-10').free).toBe(2);
  });

  it('a submitted pre-booking is a soft hold only (amber)', () => {
    const pre = bk({ id: 'p1', status: 'submitted', lines: [ln('l1', item('ledbeam'), 10)] });
    const draft = bk({ id: 'd1', lines: [ln('l1', item('ledbeam'), 4)] });
    const s = withBookings(baseState(), pre, draft);
    expect(day(s, 'ledbeam', '2027-04-23')).toMatchObject({ free: 12, softHeld: 10, hardHeld: 0 });
    const a = evaluateBooking(s, draft).get('l1');
    expect(a?.badge).toBe('amber');
    expect(a?.likely?.bookingIds).toEqual(['p1']);
  });

  it('draft pre-bookings do not hold anything', () => {
    const s = withBookings(
      baseState(),
      bk({ id: 'p1', status: 'draft', lines: [ln('l1', item('ledbeam'), 10)] }),
    );
    expect(day(s, 'ledbeam', '2027-04-23')).toMatchObject({ free: 12, softHeld: 0 });
  });

  it('an expired pre-booking is ignored', () => {
    const s = withBookings(
      baseState(),
      bk({ id: 'p1', status: 'expired', lines: [ln('l1', item('ledbeam'), 10)] }),
    );
    expect(day(s, 'ledbeam', '2027-04-23').softHeld).toBe(0);
  });

  it('a service case blocks and is not auto-released after its expected date', () => {
    const s = baseState();
    s.serviceCases.push({
      id: 'svc-1',
      itemId: 'ledbeam',
      warehouseId: W.brod,
      qty: 3,
      reason: 'broken',
      internal: true,
      responsibleUserId: U.karel.id,
      status: 'in_progress',
      openedOn: '2027-04-01',
      expectedBack: '2027-04-10',
      events: [],
    });
    expect(day(s, 'ledbeam', '2027-03-31').outOfService).toBe(0);
    expect(day(s, 'ledbeam', '2027-04-05').free).toBe(9);
    expect(day(s, 'ledbeam', '2027-05-30').free).toBe(9);
    s.serviceCases[0]!.status = 'fixed';
    expect(day(s, 'ledbeam', '2027-05-30').free).toBe(12);
  });

  it('mixed warehouses are computed separately and in total', () => {
    const o = order({
      id: 'o1',
      lines: [
        ln('l1', item('ledbeam'), 10),
        ln('l2', item('ledbeam'), 3, { sourceWarehouseId: W.karlak }),
      ],
    });
    const s = withBookings(baseState(), o);
    expect(day(s, 'ledbeam', '2027-04-23', W.brod).free).toBe(2);
    expect(day(s, 'ledbeam', '2027-04-23', W.karlak).free).toBe(1);
    expect(itemDayTotal(s, buildHoldIndex(s), 'ledbeam', '2027-04-23')).toMatchObject({
      total: 16,
      free: 3,
    });
  });

  it('"returned with issues" holds only the missing quantity, until resolved', () => {
    const o = order({
      id: 'o1',
      status: 'returned_with_issues',
      lines: [ln('l1', item('ledbeam'), 10)],
    });
    const s = withBookings(baseState(), o);
    s.shipments.push({
      id: 'sh1',
      bookingId: 'o1',
      label: 'Van 1',
      shippedOn: '2027-04-22',
      userId: U.martin.id,
      lines: [{ lineId: 'l1', qty: 10 }],
    });
    s.returnSessions.push({
      id: 'r1',
      bookingId: 'o1',
      userId: U.martin.id,
      on: '2027-04-25',
      unexpected: [],
      lines: [{ lineId: 'l1', returnedQty: 8, condition: 'ok', locationId: 'loc-b-a1', note: 'x' }],
    });
    s.issues.push({
      id: 'i1',
      type: 'missing',
      itemId: 'ledbeam',
      qty: 2,
      bookingId: 'o1',
      lineId: 'l1',
      warehouseId: W.brod,
      reportedBy: U.martin.id,
      reportedOn: '2027-04-25',
    });
    expect(day(s, 'ledbeam', '2027-04-23').hardHeld).toBe(2);
    expect(day(s, 'ledbeam', '2027-06-01').hardHeld).toBe(2); // until resolved, not only during the period
    s.issues[0]!.archivedOn = '2027-04-30';
    expect(day(s, 'ledbeam', '2027-06-01').hardHeld).toBe(0);
  });

  it('transfer A → B holds without a gap', () => {
    const a = order({ id: 'A', lines: [ln('l1', item('ledbeam'), 10)] }, 1); // booked 22–25
    const b = order(
      {
        id: 'B',
        periods: [P('2027-04-29', '2027-04-30', '2027-04-28', '2027-05-01')],
        lines: [ln('l1', item('ledbeam'), 10, { fromBookingId: 'A' })],
      },
      2,
    );
    const s = withBookings(baseState(), a, b);
    expect(lineWindows(s, b, b.lines[0]!)).toEqual([{ from: '2027-04-26', to: '2027-05-01' }]);
    for (const d of ['2027-04-24', '2027-04-25', '2027-04-26', '2027-04-27', '2027-04-28']) {
      expect(day(s, 'ledbeam', d).hardHeld).toBe(10);
    }
    expect(day(s, 'ledbeam', '2027-05-02').hardHeld).toBe(0);
  });

  it('external lines are not counted', () => {
    const o = order({
      id: 'o1',
      lines: [
        ln(
          'e1',
          {
            external: {
              name: 'LEDBeam',
              itemId: 'ledbeam',
              supplier: 'Rent',
              pickup: '2027-04-22',
              returnDate: '2027-04-25',
            },
          },
          10,
        ),
      ],
    });
    const s = withBookings(baseState(), o);
    expect(day(s, 'ledbeam', '2027-04-23').hardHeld).toBe(0);
    expect(evaluateBooking(s, o).get('e1')?.badge).toBe('none');
  });

  it('badge is the worst day across the whole period', () => {
    const other = order({
      id: 'o1',
      eventName: 'One day',
      periods: [P('2027-04-24', '2027-04-24')],
      lines: [ln('l1', item('ledbeam'), 10)],
    });
    const draft = bk({ id: 'd1', lines: [ln('l1', item('ledbeam'), 4)] });
    const s = withBookings(baseState(), other, draft);
    const a = evaluateBooking(s, draft).get('l1');
    expect(a).toMatchObject({
      badge: 'red',
      short: 2,
      worstDay: '2027-04-24',
      shortDays: ['2027-04-24'],
      collidingBookingIds: ['o1'],
    });
  });

  it('a confirmed order only sees orders confirmed before it (priority)', () => {
    const first = order({ id: 'o1', lines: [ln('l1', item('ledbeam'), 10)] }, 1);
    const second = order({ id: 'o2', lines: [ln('l1', item('ledbeam'), 10)] }, 2);
    const s = withBookings(baseState(), first, second);
    expect(evaluateBooking(s, first).get('l1')?.badge).toBe('green');
    expect(evaluateBooking(s, second).get('l1')).toMatchObject({ badge: 'red', short: 8 });
  });

  it('the booking’s own demand for an item is summed across its lines', () => {
    const draft = bk({
      id: 'd1',
      lines: [ln('l1', item('ledbeam'), 8), ln('l2', item('ledbeam'), 6)],
    });
    const s = withBookings(baseState(), draft);
    expect(evaluateBooking(s, draft).get('l2')).toMatchObject({ badge: 'red', short: 2 });
  });

  it('min free in another warehouse helps split a short line', () => {
    const draft = bk({ id: 'd1', lines: [ln('l1', item('ledbeam'), 14)] });
    const s = withBookings(baseState(), draft);
    expect(minFreeInWarehouse(s, draft, { itemId: 'ledbeam' }, W.karlak)).toBe(4);
  });

  it('item calendar lists holders and service cases per day', () => {
    const o = order({ id: 'o1', lines: [ln('l1', item('ledbeam'), 10)] });
    const pre = bk({ id: 'p1', status: 'submitted', lines: [ln('l1', item('ledbeam'), 1)] });
    const s = withBookings(baseState(), o, pre);
    s.serviceCases.push({
      id: 'svc-1',
      itemId: 'ledbeam',
      warehouseId: W.karlak,
      qty: 1,
      reason: 'x',
      internal: true,
      responsibleUserId: U.karel.id,
      status: 'reported',
      openedOn: '2027-04-01',
      events: [],
    });
    const cal = itemCalendar(s, 'ledbeam', '2027-04-21', '2027-04-23', 'all');
    expect(cal.map((c) => c.free)).toEqual([15, 5, 5]);
    expect(cal[2]).toMatchObject({
      total: 16,
      softHeld: 1,
      outOfService: 1,
      serviceCaseIds: ['svc-1'],
    });
    expect(cal[2]?.holders.map((h) => h.bookingId).sort()).toEqual(['o1', 'p1']);
    expect(itemCalendar(s, 'ledbeam', '2027-04-23', '2027-04-23', W.karlak)[0]?.free).toBe(3);
  });
});
