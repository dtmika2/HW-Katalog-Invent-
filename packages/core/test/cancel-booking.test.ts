/** Cancelling a whole booking: who, when, and what happens around it. */
import { describe, expect, it } from 'vitest';
import {
  approveCancel,
  bookingHolds,
  canSeeBooking,
  cancelBooking,
  cancelPacking,
  cancelWay,
  conflictOverview,
  confirmBooking,
  declineCancel,
  itemCalendar,
  openCancelRequests,
  packAndShip,
  packingBackItems,
  packLines,
  recomputeConflictRecords,
  reopenBooking,
  requestBookingCancel,
  runDailyJobs,
  saveBooking,
  startPacking,
  unwrap,
  type AppState,
  type Booking,
  type BookingStatus,
  type User,
} from '../src';
import { baseState, bk, item, ln, order, P, U, withBookings } from './helpers';

const T = '2027-04-10';
const EVENT = '2027-04-23';
const get = (s: AppState, id = 'o1') => s.bookings.find((b) => b.id === id)!;
const events = (s: AppState, id = 'o1') =>
  s.messages.filter((m) => m.bookingId === id && m.event).map((m) => m.event!.type);
const told = (s: AppState, type: string) =>
  s.notifications
    .filter((n) => n.type === type)
    .map((n) => n.userId)
    .sort();
const pre = (status: BookingStatus, extra: Partial<Booking> = {}) =>
  withBookings(
    baseState(),
    bk({ id: 'o1', status, lines: [ln('l1', item('hazer'), 1)], ...extra }),
  );
const ordered = (extra: Partial<Booking> = {}, ...others: Booking[]) =>
  withBookings(
    baseState(),
    order({ id: 'o1', pmId: U.petr.id, lines: [ln('l1', item('hazer'), 2)], ...extra }),
    ...others,
  );
const packedState = (day = T) => {
  const s = ordered({ status: 'packing' });
  return unwrap(packLines(s, U.martin, day, 'o1', [{ lineId: 'l1', qty: 2 }]));
};
const cancel = (s: AppState, u: User = U.petr, today = T, reason = 'Klient akci zrušil') =>
  cancelBooking(s, u, today, 'o1', reason);
const unpack = (s: AppState, today = T, u: User = U.martin) =>
  cancelPacking(s, u, today, 'o1', {
    confirmed: packingBackItems(s, get(s)).map((i) => i.key),
  });

describe('cancelling before packing', () => {
  it('its PM or the Chief, with a reason, at once; nobody else', () => {
    for (const st of ['tentative', 'planned', 'draft', 'submitted'] as const) {
      for (const u of [U.petr, U.tomas]) {
        const s = unwrap(cancel(pre(st), u));
        expect(get(s)).toMatchObject({
          status: 'cancelled',
          cancelled: { by: u.id, on: T, reason: 'Klient akci zrušil', from: st },
        });
        expect(events(s)).toEqual(['cancelled']);
      }
      for (const u of [U.lucie, U.martin, U.admin])
        expect(cancel(pre(st), u)).toMatchObject({ error: { code: 'forbidden' } });
      expect(cancel(pre(st), U.petr, T, '  ')).toMatchObject({
        error: { code: 'validation', details: { field: 'reason' } },
      });
    }
  });

  it('who is told: PM and, once it was confirmed for approval, the Chief', () => {
    expect(unwrap(cancel(pre('planned'))).notifications).toEqual([]);
    expect(told(unwrap(cancel(pre('planned'), U.tomas)), 'booking_cancelled')).toEqual([U.petr.id]);
    expect(told(unwrap(cancel(pre('submitted'))), 'booking_cancelled')).toEqual([U.tomas.id]);
  });

  it('an approved order frees its gear at once; warehouse and Chief are told, rentals listed', () => {
    const s = ordered({
      lines: [
        ln('l1', item('hazer'), 2),
        ln('e1', { external: { name: 'LED', supplier: 'Rent', pickup: T, returnDate: T } }, 3),
      ],
    });
    expect(cancelWay(s, U.petr, get(s))).toBe('direct');
    const r = unwrap(cancel(s));
    expect(itemCalendar(r, 'hazer', EVENT, EVENT, 'all')[0]).toMatchObject({
      free: 2,
      holders: [],
    });
    expect(bookingHolds(r, get(r))).toEqual([]);
    expect(told(r, 'booking_cancelled')).toEqual([U.tomas.id, U.martin.id, U.karel.id].sort());
    expect(r.notifications.find((n) => n.type === 'booking_cancelled')?.params).toMatchObject({
      reason: 'Klient akci zrušil',
      rented: '3× LED (Rent)',
    });
  });

  it('not what is finished, and not twice', () => {
    for (const st of ['expired', 'cancelled'] as const)
      expect(cancel(pre(st))).toMatchObject({ error: { code: 'invalid_state' } });
    for (const st of ['shipped', 'returning', 'returned', 'closed'] as const)
      expect(cancel(ordered({ status: st }), U.tomas)).toMatchObject({
        error: { code: 'invalid_state' },
      });
  });
});

describe('cancelling while it is packed', () => {
  it('a PM asks, the Chief approves, the warehouse unpacks, then it is cancelled', () => {
    const s = packedState();
    expect(cancelWay(s, U.petr, get(s))).toBe('ask');
    expect(cancel(s)).toMatchObject({ error: { code: 'forbidden', details: { field: 'ask' } } });
    const asked = unwrap(requestBookingCancel(s, U.petr, T, 'o1', 'Klient akci zrušil'));
    expect(get(asked).status).toBe('packed');
    expect(told(asked, 'cancel_requested')).toEqual([U.tomas.id]);
    expect(requestBookingCancel(asked, U.petr, T, 'o1', 'x')).toMatchObject({
      error: { code: 'invalid_state' },
    });
    const r = openCancelRequests(asked, get(asked))[0]!;
    const pending = unwrap(approveCancel(asked, U.tomas, T, 'o1', r.id));
    expect(get(pending)).toMatchObject({
      status: 'packed',
      cancelPending: { by: U.tomas.id, reason: 'Klient akci zrušil' },
    });
    expect(told(pending, 'cancel_decided')).toEqual([U.petr.id]);
    expect(told(pending, 'cancel_unpack')).toEqual([U.karel.id, U.martin.id].sort());
    // still standing packed, so still taken
    expect(itemCalendar(pending, 'hazer', EVENT, EVENT, 'all')[0]?.free).toBe(0);
    const done = unwrap(unpack(pending));
    expect(get(done)).toMatchObject({ status: 'cancelled', cancelled: { by: U.tomas.id } });
    expect(get(done).cancelPending).toBeUndefined();
    expect(done.packings).toEqual([]);
    expect(itemCalendar(done, 'hazer', EVENT, EVENT, 'all')[0]?.free).toBe(2);
    expect(told(done, 'booking_cancelled')).toEqual([U.karel.id, U.petr.id, U.tomas.id].sort());
  });

  it('declined: nothing changes; the Chief cancels directly', () => {
    const asked = unwrap(requestBookingCancel(packedState(), U.petr, T, 'o1', 'x'));
    const r = openCancelRequests(asked, get(asked))[0]!;
    const no = unwrap(declineCancel(asked, U.tomas, T, 'o1', r.id, 'Klient se vrátil'));
    expect(get(no)).toMatchObject({ status: 'packed', cancelRequests: [] });
    expect(cancelWay(no, U.tomas, get(no))).toBe('unpack');
    expect(get(unwrap(cancel(no, U.tomas))).cancelPending).toBeDefined();
  });

  it('nothing packed yet: the Chief cancels at once', () => {
    const s = unwrap(startPacking(ordered(), U.martin, '2027-04-20', 'o1'));
    expect(cancelWay(s, U.petr, get(s))).toBe('ask');
    expect(cancelWay(s, U.tomas, get(s))).toBe('direct');
    expect(get(unwrap(cancel(s, U.tomas))).status).toBe('cancelled');
  });

  it('the warehouse still confirms every piece, also after the event began', () => {
    const pending = unwrap(cancel(packedState('2027-04-22'), U.tomas, EVENT));
    expect(cancelPacking(pending, U.martin, EVENT, 'o1', { confirmed: [] })).toMatchObject({
      error: { code: 'validation', details: { field: 'confirmed' } },
    });
    expect(get(unwrap(unpack(pending, EVENT))).status).toBe('cancelled');
  });

  it('until then it can be neither packed, shipped nor edited', () => {
    const pending = unwrap(cancel(packedState(), U.tomas));
    const shipped = packAndShip(pending, U.martin, T, 'o1', {
      label: 'x',
      lines: [{ lineId: 'l1', qty: 1 }],
    });
    for (const r of [
      shipped,
      packLines(pending, U.martin, T, 'o1', [{ lineId: 'l1', qty: 1 }]),
      saveBooking(pending, U.tomas, T, get(pending)),
      cancel(pending, U.tomas),
    ])
      expect(r).toMatchObject({
        error: { code: 'invalid_state', details: { field: 'cancelPending' } },
      });
    expect(
      runDailyJobs(pending, '2027-04-21').notifications.filter(
        (n) => n.type === 'upcoming_loading',
      ),
    ).toEqual([]);
  });

  it('once anything has left nobody cancels it', () => {
    const s = unwrap(
      packAndShip(ordered({ status: 'packing' }), U.martin, '2027-04-22', 'o1', {
        label: 'D1',
        lines: [{ lineId: 'l1', qty: 1 }],
      }),
    );
    expect(get(s).status).toBe('packing');
    for (const u of [U.petr, U.tomas]) {
      expect(cancelWay(s, u, get(s))).toBeUndefined();
      expect(cancel(s, u)).toMatchObject({
        error: { code: 'invalid_state', details: { field: 'left' } },
      });
    }
    expect(requestBookingCancel(s, U.petr, T, 'o1', 'x').ok).toBe(false);
  });

  it('a request is pointless once something leaves', () => {
    const asked = unwrap(requestBookingCancel(packedState(), U.petr, T, 'o1', 'x'));
    const left = {
      ...asked,
      shipments: [
        {
          id: 's',
          bookingId: 'o1',
          label: 'D',
          shippedOn: T,
          userId: U.martin.id,
          lines: [{ lineId: 'l1', qty: 1 }],
        },
      ],
    } as AppState;
    expect(openCancelRequests(left, get(left))).toEqual([]);
  });
});

describe('what it does to others', () => {
  it('conflicts it caused close by themselves and the waiting PMs are told', () => {
    const later = order(
      { id: 'o2', pmId: U.jana.id, lines: [ln('l1', item('hazer'), 1, { overrideReason: 'x' })] },
      2,
    );
    const wish = bk({
      id: 'p',
      pmId: U.lucie.id,
      status: 'planned',
      lines: [ln('l1', item('hazer'), 1)],
    });
    const s = recomputeConflictRecords(ordered({}, later, wish), T);
    expect(s.conflicts.map((c) => [c.bookingId, c.status])).toEqual([['o2', 'new']]);
    const r = unwrap(cancel(s));
    expect(r.conflicts[0]).toMatchObject({ status: 'resolved', resolution: 'auto' });
    expect(told(r, 'gear_released')).toEqual([U.jana.id, U.lucie.id].sort());
    expect(conflictOverview(r, T).filter((c) => c.tier === 'real')).toEqual([]);
  });

  it('nobody is told when a reservation, which held nothing, is cancelled', () => {
    const s = withBookings(
      baseState(),
      bk({ id: 'o1', status: 'planned', lines: [ln('l1', item('hazer'), 2)] }),
      bk({ id: 'p', pmId: U.lucie.id, lines: [ln('l1', item('hazer'), 1)] }),
    );
    expect(unwrap(cancel(s)).notifications).toEqual([]);
  });

  it('gear that was to come from it comes from the warehouse again, its PM is told', () => {
    const next = order(
      {
        id: 'o2',
        pmId: U.jana.id,
        periods: [P('2027-04-27', '2027-04-28')],
        lines: [ln('l1', item('hazer'), 1, { fromBookingId: 'o1' })],
      },
      2,
    );
    const r = unwrap(cancel(ordered({}, next)));
    expect(get(r, 'o2').lines[0]).not.toHaveProperty('fromBookingId');
    expect(r.notifications.find((n) => n.type === 'transfer_lost')).toMatchObject({
      userId: U.jana.id,
      params: { other: 'o1', what: '1× Hazer' },
    });
  });

  it('a packed order that loses a transfer has something to pack again', () => {
    const s = ordered(
      {},
      order(
        {
          id: 'o2',
          status: 'packing',
          periods: [P('2027-04-27', '2027-04-28')],
          lines: [ln('l1', item('lamp'), 1), ln('l2', item('hazer'), 1, { fromBookingId: 'o1' })],
        },
        2,
      ),
    );
    const packed = unwrap(packLines(s, U.martin, T, 'o2', [{ lineId: 'l1', qty: 1 }]));
    expect(get(packed, 'o2').status).toBe('packed');
    expect(get(unwrap(cancel(packed)), 'o2').status).toBe('packing');
  });
});

describe('taking it back', () => {
  it('a reservation or draft returns to its stage, by its PM or the Chief', () => {
    for (const st of ['tentative', 'planned', 'draft'] as const)
      for (const u of [U.petr, U.tomas]) {
        const s = unwrap(reopenBooking(unwrap(cancel(pre(st))), u, T, 'o1'));
        expect(get(s).status).toBe(st);
        expect(get(s).cancelled).toBeUndefined();
        expect(events(s)).toEqual(['cancelled', 'reopened']);
        expect(told(s, 'booking_reopened')).toEqual(u === U.tomas ? [U.petr.id] : []);
      }
    const gone = unwrap(cancel(pre('draft')));
    expect(reopenBooking(gone, U.lucie, T, 'o1')).toMatchObject({ error: { code: 'forbidden' } });
    expect(reopenBooking(gone, U.petr, EVENT, 'o1')).toMatchObject({
      error: { code: 'invalid_state' },
    });
  });

  it('an approved order has to be approved again, what is short is decided again', () => {
    const s = unwrap(
      cancel(
        ordered({
          lines: [ln('l1', item('hazer'), 2, { overrideReason: 'ok', conflictAck: true })],
        }),
      ),
    );
    expect(reopenBooking(s, U.petr, T, 'o1')).toMatchObject({ error: { code: 'forbidden' } });
    const back = unwrap(reopenBooking(s, U.tomas, T, 'o1'));
    expect(get(back)).toMatchObject({ status: 'submitted', type: 'prebooking', submittedAt: T });
    expect(get(back)).not.toHaveProperty('confirmSeq');
    expect(get(back).lines[0]).toMatchObject({ conflictAck: false });
    expect(get(back).lines[0]).not.toHaveProperty('overrideReason');
    expect(get(unwrap(confirmBooking(back, U.tomas, T, 'o1'))).status).toBe('confirmed');
  });
});

describe('archive', () => {
  it('a cancelled or expired reservation stays hidden from the warehouse', () => {
    const c = get(unwrap(cancel(pre('tentative'))));
    const e = get(runDailyJobs(pre('planned'), EVENT).state);
    expect(e.status).toBe('expired');
    for (const b of [c, e]) {
      expect(canSeeBooking(U.martin, b)).toBe(false);
      expect(canSeeBooking(U.lucie, b)).toBe(true);
    }
    expect(canSeeBooking(U.martin, get(unwrap(cancel(pre('draft')))))).toBe(true);
  });

  it('a cancelled booking never expires, reminds or collides', () => {
    const s = unwrap(cancel(ordered()));
    const r = runDailyJobs(s, EVENT);
    expect(get(r.state).status).toBe('cancelled');
    expect(r.notifications).toEqual([]);
    expect(conflictOverview(s, T)).toEqual([]);
  });
});
