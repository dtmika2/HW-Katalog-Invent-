import { describe, expect, it } from 'vitest';
import {
  closeBooking,
  computeLedger,
  confirmBooking,
  createBooking,
  createClient,
  resolveConflict,
  returnToPm,
  submitPrebooking,
  unwrap,
  type AppState,
  type Booking,
  type NewBookingInput,
  type User,
} from '../../src';
import { baseState, item, ln, order, P, U, withBookings } from '../helpers';
import { ev, of, pts, withMessages } from './helpers';

const T = '2027-04-20';
const EVENT = P('2027-05-20', '2027-05-21', '2027-05-19', '2027-05-22');
const PURPOSE = 'Firemní večírek pro 200 hostů, jedno pódium a ozvučení sálu';

/** A pre-booking with one line, created by `pm` on `on`. */
function created(
  input: Partial<NewBookingInput> = {},
  pm: User = U.petr,
  on = T,
): { s: AppState; id: string } {
  const r = unwrap(
    createBooking(baseState(), pm, on, { eventName: 'Gala', periods: [EVENT], ...input }),
  );
  const s: AppState = {
    ...r.state,
    bookings: r.state.bookings.map((b) =>
      b.id === r.bookingId ? { ...b, lines: [ln('l1', item('hazer'), 1)] } : b,
    ),
  };
  return { s, id: r.bookingId };
}

const submit = (s: AppState, id: string, on = T, pm: User = U.petr) =>
  unwrap(submitPrebooking(s, pm, on, id));
const approve = (s: AppState, id: string, on = T, by: User = U.tomas) =>
  unwrap(confirmBooking(s, by, on, id));
const get = (s: AppState, id: string) => s.bookings.find((b) => b.id === id) as Booking;

describe('gamification: project managers', () => {
  it('booking.created gives 3 points for a new reservation or pre-booking', () => {
    const { s } = created({ stage: 'tentative' });
    expect(of(computeLedger(s), 'booking.created')[0]).toMatchObject({
      userId: U.petr.id,
      points: 3,
    });
  });

  it('booking.submitted gives 10 points, once although it is submitted again', () => {
    const { s, id } = created();
    const s1 = submit(s, id, '2027-05-10');
    const s2 = unwrap(returnToPm(s1, U.tomas, '2027-05-11', id, 'Chybí pult'));
    const s3 = submit(s2, id, '2027-05-12');
    const e = of(computeLedger(s3), 'booking.submitted');
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ userId: U.petr.id, on: '2027-05-10', points: 10 });
  });

  it('booking.veryEarly gives +15 when submitted 30+ days before the event', () => {
    const { s, id } = created();
    const l = computeLedger(submit(s, id, '2027-04-20'));
    expect(pts(l, 'booking.veryEarly')).toBe(15);
    expect(of(l, 'booking.early')).toHaveLength(0);
  });

  it('booking.early gives +10 when submitted 14–29 days before the event', () => {
    const { s, id } = created();
    const l = computeLedger(submit(s, id, '2027-05-06'));
    expect(pts(l, 'booking.early')).toBe(10);
    expect(of(l, 'booking.veryEarly')).toHaveLength(0);
    expect(of(computeLedger(submit(s, id, '2027-05-07')), 'booking.early')).toHaveLength(0);
  });

  it('booking.purpose gives +3 for a purpose message of 40+ characters', () => {
    const { s, id } = created({ purposeMessage: PURPOSE });
    expect(pts(computeLedger(submit(s, id)), 'booking.purpose')).toBe(3);
    const short = created({ purposeMessage: 'Večírek' });
    expect(of(computeLedger(submit(short.s, short.id)), 'booking.purpose')).toHaveLength(0);
  });

  it('booking.client gives +2 when a client is set', () => {
    const { s, id } = created({ clientId: 'cl-1' });
    const e = of(computeLedger(submit(s, id)), 'booking.client');
    expect(e[0]).toMatchObject({ points: 2, parentId: `booking.submitted:${id}` });
  });

  it('booking.firstTime gives +5 when approved without being returned', () => {
    const { s, id } = created();
    const ok = approve(submit(s, id), id, '2027-04-21');
    expect(of(computeLedger(ok), 'booking.firstTime')[0]).toMatchObject({
      userId: U.petr.id,
      on: '2027-04-21',
      points: 5,
    });
    const back = unwrap(returnToPm(submit(s, id), U.tomas, '2027-04-21', id, 'Chybí pult'));
    const later = approve(submit(back, id, '2027-04-22'), id, '2027-04-23');
    expect(of(computeLedger(later), 'booking.firstTime')).toHaveLength(0);
  });

  it('booking.submitted is given for a PM confirming their own pre-booking (no submission)', () => {
    const { s, id } = created({}, U.jana);
    const l = computeLedger(approve(s, id, T, U.jana));
    expect(of(l, 'booking.submitted')[0]).toMatchObject({ userId: U.jana.id, points: 10 });
    expect(of(l, 'chief.approved')).toHaveLength(0);
    expect(of(l, 'booking.firstTime')).toHaveLength(0);
  });

  it('booking.organised gives +3 for an approved order with the PM own groups', () => {
    const { s, id } = created();
    const s1 = approve(submit(s, id), id);
    const s2: AppState = {
      ...s1,
      bookings: s1.bookings.map((b) =>
        b.id === id ? { ...b, groups: [{ id: 'g1', name: 'Pódium' }] } : b,
      ),
    };
    expect(pts(computeLedger(s2), 'booking.organised')).toBe(3);
    expect(of(computeLedger(s1), 'booking.organised')).toHaveLength(0);
  });

  it('booking.shortageSolved gives 8 points', () => {
    const s = withMessages(
      withBookings(baseState(), order({ id: 'o1' })),
      ev('o1', U.petr.id, T, 'shortage_solved', {}),
    );
    expect(of(computeLedger(s), 'booking.shortageSolved')[0]).toMatchObject({
      userId: U.petr.id,
      points: 8,
    });
  });

  it('booking.completed gives the PM 10 points and booking.closedBy the closer 3', () => {
    const s0 = withBookings(baseState(), order({ id: 'o1', status: 'returned' }));
    const s = unwrap(closeBooking(s0, U.martin, '2027-04-27', 'o1'));
    const l = computeLedger(s);
    expect(of(l, 'booking.completed')[0]).toMatchObject({ userId: U.petr.id, points: 10 });
    expect(of(l, 'booking.closedBy')[0]).toMatchObject({ userId: U.martin.id, points: 3 });
  });

  it('booking.completed is not given when a pre-booking expires (the nightly job closes it)', () => {
    const s = withMessages(
      withBookings(baseState(), { ...order({ id: 'o1' }), status: 'closed' }),
      ev('o1', 'system', T, 'expired', {}),
    );
    expect(computeLedger(s)).toEqual([]);
  });
});

describe('gamification: the Chief', () => {
  it('chief.approved gives 10 points for approving someone else’s booking', () => {
    const { s, id } = created();
    const e = of(computeLedger(approve(submit(s, id), id, '2027-04-25')), 'chief.approved');
    expect(e[0]).toMatchObject({ userId: U.tomas.id, points: 10 });
  });

  it('chief.quick gives +5 when approved within 2 days of the submission', () => {
    const { s, id } = created();
    const quick = approve(submit(s, id, T), id, '2027-04-22');
    expect(pts(computeLedger(quick), 'chief.quick')).toBe(5);
    const slow = approve(submit(s, id, T), id, '2027-04-23');
    expect(of(computeLedger(slow), 'chief.quick')).toHaveLength(0);
  });

  it('chief.returned gives 5 points for sending a pre-booking back with a reason', () => {
    const { s, id } = created();
    const back = unwrap(returnToPm(submit(s, id), U.tomas, T, id, 'Chybí pult'));
    expect(of(computeLedger(back), 'chief.returned')[0]).toMatchObject({
      userId: U.tomas.id,
      points: 5,
    });
  });

  it('chief.conflictResolved gives 10 points for a conflict closed with a written resolution', () => {
    const s0: AppState = {
      ...withBookings(baseState(), order({ id: 'o1' })),
      conflicts: [
        {
          id: 'cf-1',
          bookingId: 'o1',
          lineId: 'l1',
          target: { itemId: 'hazer' },
          warehouseId: 'wh-brod',
          shortQty: 1,
          days: ['2027-04-23'],
          collidingBookingIds: [],
          status: 'new',
          source: 'detected',
          overrideReason: '',
          createdOn: T,
        },
      ],
    };
    const s = unwrap(resolveConflict(s0, U.tomas, '2027-04-21', 'cf-1', 'Půjčeno od Lightparku'));
    expect(of(computeLedger(s), 'chief.conflictResolved')[0]).toMatchObject({
      userId: U.tomas.id,
      on: '2027-04-21',
      points: 10,
    });
  });

  it('client.created gives 3 points; clients without a date are skipped', () => {
    const r = unwrap(createClient(baseState(), U.petr, T, { name: 'Nový klient s.r.o.' }));
    expect(of(computeLedger(r.state), 'client.created')[0]).toMatchObject({
      userId: U.petr.id,
      points: 3,
    });
    const old = { ...baseState(), clients: [{ id: 'cl-x', name: 'X', createdBy: U.petr.id }] };
    expect(computeLedger(old)).toEqual([]);
  });

  it('a cancelled booking keeps the points of the work done on it', () => {
    const { s, id } = created();
    const s1 = approve(submit(s, id), id);
    const cancelled: AppState = {
      ...s1,
      bookings: s1.bookings.map((b) => (b.id === id ? { ...get(s1, id), status: 'cancelled' } : b)),
    };
    expect(of(computeLedger(cancelled), 'chief.approved')).toHaveLength(1);
    expect(of(computeLedger(cancelled), 'booking.submitted')).toHaveLength(1);
  });
});
