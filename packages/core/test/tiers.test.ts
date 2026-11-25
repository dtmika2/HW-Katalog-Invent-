/** Conflict tiers: how real a conflict is, by the state of the other booking. */
import { describe, expect, it } from 'vitest';
import {
  ackConflict,
  availabilityOracle,
  confirmBooking,
  conflictDays,
  conflictOverview,
  conflictTiers,
  evaluateBooking,
  itemCalendar,
  sameDayUnknown,
  submitPrebooking,
  tierOf,
  unwrap,
  type AppState,
  type Booking,
  type BookingStatus,
} from '../src';
import { baseState, bk, caseT, item, ln, order, P, U, withBookings } from './helpers';

const T = '2027-04-10';
const D = '2027-04-23';
const get = (s: AppState, id: string) => s.bookings.find((b) => b.id === id)!;
/** 8 rogues and 2 hazers in Brod; no required extras on the hazer. */
const mine = (extra: Partial<Booking> = {}) =>
  bk({ id: 'me', lines: [ln('l1', item('hazer'), 1)], ...extra });
const other = (id: string, status: BookingStatus, qty: number, extra: Partial<Booking> = {}) =>
  bk({ id, status, pmId: U.lucie.id, lines: [ln('l1', item('hazer'), qty)], ...extra });
const tiers = (s: AppState, id = 'me') => conflictTiers(s, get(s, id));
const ids = (l: ReturnType<typeof tiers>['real']) => l.map((c) => c.colliding.map((x) => x.id));
const badge = (s: AppState) => evaluateBooking(s, get(s, 'me')).get('l1')!.badge;

describe('conflict tiers', () => {
  it('the tier is given by the state of the other booking', () => {
    expect(tierOf('tentative')).toBe('possible');
    for (const st of ['planned', 'draft', 'submitted'] as const) expect(tierOf(st)).toBe('likely');
    for (const st of ['confirmed', 'packed', 'shipped'] as const) expect(tierOf(st)).toBe('real');
    for (const st of ['closed', 'expired', 'cancelled'] as const)
      expect(tierOf(st)).toBeUndefined();
  });

  it('with an unconfirmed reservation: possible', () => {
    const s = withBookings(baseState(), mine(), other('o', 'tentative', 2));
    expect(badge(s)).toBe('possible');
    const t = tiers(s);
    expect([t.real, t.likely, ids(t.possible)]).toEqual([[], [], [['o']]]);
    expect(t.possible[0]).toMatchObject({
      lineId: 'l1',
      short: 1,
      days: expect.arrayContaining([D]),
    });
  });

  it('with a confirmed reservation, a draft or one waiting for approval: likely', () => {
    for (const st of ['planned', 'draft', 'submitted'] as const) {
      const s = withBookings(baseState(), mine(), other('o', st, 2));
      expect(badge(s)).toBe('amber');
      const t = tiers(s);
      expect([t.real, ids(t.likely), t.possible]).toEqual([[], [['o']], []]);
    }
  });

  it('with an approved order: real', () => {
    const o = order({ id: 'o', lines: [ln('l1', item('hazer'), 2)] });
    const s2 = withBookings(baseState(), mine(), o);
    expect(badge(s2)).toBe('red');
    const t = tiers(s2);
    expect([ids(t.real), t.likely, t.possible]).toEqual([[['o']], [], []]);
  });

  it('mixed: each tier lists its own bookings and what they add', () => {
    const s = withBookings(
      baseState(),
      mine(),
      order({ id: 'o', lines: [ln('l1', item('hazer'), 2)] }),
      other('p', 'planned', 1),
      other('t', 'tentative', 1),
    );
    expect(badge(s)).toBe('red');
    const t = tiers(s);
    expect([ids(t.real), ids(t.likely), ids(t.possible)]).toEqual([[['o']], [['p']], [['t']]]);
    expect([t.real[0]!.short, t.likely[0]!.short, t.possible[0]!.short]).toEqual([1, 2, 3]);
  });

  it('enough for all: no conflict, whatever the stage', () => {
    const s = withBookings(baseState(), mine(), other('p', 'planned', 1));
    expect(badge(s)).toBe('green');
    expect(tiers(s)).toEqual({ real: [], likely: [], possible: [], sameDay: [] });
  });

  it('different days do not collide', () => {
    const s = withBookings(
      baseState(),
      mine(),
      other('p', 'planned', 2, { periods: [P('2027-05-01', '2027-05-02')] }),
    );
    expect(badge(s)).toBe('green');
  });

  it('cases and the loose pieces in them collide by tier too', () => {
    const me = mine({ lines: [ln('l1', caseT('ct-ax9'), 1)] });
    const cases = withBookings(
      baseState(),
      me,
      bk({ id: 'c', status: 'tentative', lines: [ln('l1', caseT('ct-ax9'), 2)] }),
    );
    expect(badge(cases)).toBe('possible');
    expect(ids(tiers(cases).possible)).toEqual([['c']]);
    // 4 loose in Brod, the rest has to come out of both cases
    const loose = withBookings(
      baseState(),
      me,
      bk({ id: 'c', status: 'planned', lines: [ln('l1', item('ax9'), 16)] }),
    );
    expect(badge(loose)).toBe('amber');
    expect(ids(tiers(loose).likely)).toEqual([['c']]);
  });

  it('an approved order has real conflicts only', () => {
    const s = withBookings(
      baseState(),
      order({ id: 'me', lines: [ln('l1', item('hazer'), 1)] }),
      other('p', 'planned', 2),
      other('s', 'submitted', 2),
      other('t', 'tentative', 2),
      other('e', 'tentative', 0, { lines: [] }),
    );
    expect(badge(s)).toBe('green');
    expect(tiers(s)).toEqual({ real: [], likely: [], possible: [], sameDay: [] });
  });

  it('only real conflicts have to be acknowledged or overridden', () => {
    const s = withBookings(
      baseState(),
      mine(),
      other('p', 'planned', 2),
      other('t', 'tentative', 2),
    );
    expect(submitPrebooking(s, U.petr, T, 'me').ok).toBe(true);
    expect(confirmBooking(s, U.tomas, T, 'me').ok).toBe(true);
  });

  it('reservations take no gear: nobody is blocked by them', () => {
    const s = withBookings(baseState(), other('p', 'planned', 2), other('t', 'tentative', 2));
    const day = itemCalendar(s, 'hazer', D, D, 'all')[0]!;
    expect(day).toMatchObject({ free: 2, hardHeld: 0, softHeld: 0 });
    expect(day.holders.map((h) => [h.bookingId, h.kind])).toEqual([
      ['p', 'planned'],
      ['t', 'maybe'],
    ]);
  });

  it('the automatic choice counts approved and requested gear only, as before', () => {
    const check = (o: Booking) => {
      const s = withBookings(baseState(), mine(), o);
      return availabilityOracle(s, get(s, 'me'))({ itemId: 'hazer' }, 1);
    };
    expect(check(other('o', 'planned', 2))).toBe(true);
    expect(check(other('o', 'tentative', 2))).toBe(true);
    expect(check(other('o', 'submitted', 2))).toBe(false);
  });
});

describe('same days, gear not known yet', () => {
  it('is listed on both bookings with its tier, worst first', () => {
    const s = withBookings(
      baseState(),
      mine(),
      bk({ id: 'e', status: 'tentative' }),
      order({ id: 'o', lines: [ln('l1', item('lamp'), 1)] }),
    );
    expect(sameDayUnknown(s, get(s, 'me')).map((x) => [x.booking.id, x.tier])).toEqual([
      ['e', 'possible'],
    ]);
    expect(sameDayUnknown(s, get(s, 'e')).map((x) => [x.booking.id, x.tier])).toEqual([
      ['o', 'real'],
      ['me', 'likely'],
    ]);
    expect(sameDayUnknown(s, get(s, 'o'))).toEqual([]);
  });

  it('two empty reservations see each other; archived and other days do not count', () => {
    const s = withBookings(
      baseState(),
      bk({ id: 'a', status: 'tentative' }),
      bk({ id: 'b', status: 'planned' }),
      bk({ id: 'x', status: 'expired' }),
      bk({ id: 'c', status: 'cancelled' }),
      bk({ id: 'far', status: 'planned', periods: [P('2027-07-01', '2027-07-01')] }),
    );
    expect(sameDayUnknown(s, get(s, 'a')).map((x) => x.booking.id)).toEqual(['b']);
    expect(sameDayUnknown(s, get(s, 'b')).map((x) => x.booking.id)).toEqual(['a']);
  });
});

describe('when an order is approved', () => {
  const setup = (extra: Booking[] = []) =>
    withBookings(
      baseState(),
      bk({ id: 'me', status: 'submitted', lines: [ln('l1', item('hazer'), 2)] }),
      other('t', 'tentative', 1),
      other('p', 'planned', 1),
      ...extra,
    );
  const hit = (s: AppState) =>
    s.notifications.filter((n) => n.type === 'reservation_affected').map((n) => n.bookingId);

  it('PMs whose reservations are really short now are told', () => {
    const s = unwrap(confirmBooking(setup(), U.tomas, T, 'me'));
    expect(hit(s).sort()).toEqual(['p', 't']);
    expect(s.notifications.find((n) => n.type === 'reservation_affected')).toMatchObject({
      userId: U.lucie.id,
      params: { other: 'me' },
    });
    expect(tiers(s, 'p').real).toHaveLength(1);
  });

  it('not those with enough left, nor other days, nor again for what was short before', () => {
    const s = unwrap(
      confirmBooking(
        setup([
          other('far', 'planned', 2, { periods: [P('2027-06-01', '2027-06-02')] }),
          bk({ id: 'lamps', status: 'planned', lines: [ln('l1', item('lamp'), 1)] }),
        ]),
        U.tomas,
        T,
        'me',
      ),
    );
    expect(hit(s).sort()).toEqual(['p', 't']);
    const already = withBookings(
      baseState(),
      order({ id: 'o', lines: [ln('l1', item('hazer'), 2)] }),
      bk({ id: 'me', status: 'submitted', lines: [ln('l1', item('lamp'), 1)] }),
      other('p', 'planned', 1),
    );
    expect(hit(unwrap(confirmBooking(already, U.tomas, T, 'me')))).toEqual([]);
  });

  it('hypothetical conflicts never notify', () => {
    const s = withBookings(
      baseState(),
      mine(),
      other('p', 'planned', 2),
      other('t', 'tentative', 2),
    );
    const acked = {
      ...s,
      bookings: s.bookings.map((b) => (b.id === 'me' ? ackConflict(b, 'l1', true) : b)),
    };
    const r = unwrap(submitPrebooking(acked, U.petr, T, 'me'));
    expect(r.notifications.map((n) => n.type)).toEqual(['prebooking_submitted']);
  });
});

describe('calendar of conflicts', () => {
  it('marks likely and possible days on the pre-booking; a real one wins', () => {
    const s = withBookings(baseState(), mine(), other('t', 'tentative', 2));
    const days = conflictDays(s, conflictOverview(s, T));
    expect(days.get('me')?.get(D)?.role).toBe('possible');
    expect(days.get('t')?.get(D)?.role).toBe('likely');
    const withOrder = withBookings(
      baseState(),
      mine(),
      other('t', 'tentative', 2),
      order({ id: 'o', lines: [ln('l1', item('hazer'), 2)] }),
    );
    const marks = conflictDays(withOrder, conflictOverview(withOrder, T));
    expect(marks.get('me')?.get(D)?.role).toBe('request');
    expect(marks.has('o')).toBe(false);
  });
});
