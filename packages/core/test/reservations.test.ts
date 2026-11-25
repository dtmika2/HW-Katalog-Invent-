/** Reservations before an order: noting a date, who sees it, who hears about it. */
import { describe, expect, it } from 'vitest';
import {
  canSeeBooking,
  confirmBooking,
  createBooking,
  runDailyJobs,
  saveBooking,
  setReservationStage,
  submitPrebooking,
  unwrap,
  visibleState,
  type AppState,
  type BookingStatus,
} from '../src';
import { baseState, bk, item, ln, order, P, U, withBookings } from './helpers';

const T = '2027-04-10';
const get = (s: AppState, id: string) => s.bookings.find((b) => b.id === id)!;
const one = (status: BookingStatus, lines = [ln('l1', item('hazer'), 1)]) =>
  withBookings(baseState(), bk({ id: 'p1', status, lines }));

describe('reservations', () => {
  it('a date is noted with a name and days only, without gear', () => {
    const r = unwrap(
      createBooking(baseState(), U.petr, T, {
        eventName: 'Možná svatba',
        periods: [P('2027-06-01', '2027-06-02')],
        stage: 'tentative',
      }),
    );
    expect(get(r.state, r.bookingId)).toMatchObject({
      status: 'tentative',
      type: 'prebooking',
      lines: [],
    });
    expect(r.state.notifications).toEqual([]);
  });

  it('PM and Chief move freely between the three stages; gear stays; it is recorded', () => {
    let s = one('tentative');
    for (const to of ['planned', 'draft', 'tentative', 'draft', 'planned'] as const) {
      s = unwrap(setReservationStage(s, U.petr, T, 'p1', to));
      expect(get(s, 'p1')).toMatchObject({ status: to, lines: [{ id: 'l1' }] });
    }
    expect(s.messages.at(-1)!.event).toEqual({
      type: 'stage_changed',
      params: { from: 'draft', to: 'planned' },
    });
    expect(s.notifications).toEqual([]);
    expect(setReservationStage(s, U.tomas, T, 'p1', 'draft').ok).toBe(true);
    for (const u of [U.lucie, U.martin])
      expect(setReservationStage(s, u, T, 'p1', 'draft')).toMatchObject({
        error: { code: 'forbidden' },
      });
    for (const st of ['submitted', 'expired', 'cancelled'] as const)
      expect(setReservationStage(one(st), U.petr, T, 'p1', 'draft')).toMatchObject({
        error: { code: 'invalid_state' },
      });
  });

  it('gear can be listed in a reservation without changing its stage', () => {
    const s = one('tentative', []);
    const b = { ...get(s, 'p1'), lines: [ln('l1', item('hazer'), 1)] };
    const r = unwrap(saveBooking(s, U.petr, T, b));
    expect(get(r, 'p1')).toMatchObject({ status: 'tentative', lines: [{ id: 'l1' }] });
  });

  it('the Chief is told first when it is confirmed for approval, never from "Nepotvrzená"', () => {
    expect(submitPrebooking(one('tentative'), U.petr, T, 'p1')).toMatchObject({
      error: { code: 'invalid_state' },
    });
    expect(submitPrebooking(one('planned', []), U.petr, T, 'p1')).toMatchObject({
      error: { code: 'validation' },
    });
    for (const st of ['planned', 'draft'] as const) {
      const s = unwrap(submitPrebooking(one(st), U.petr, T, 'p1'));
      expect(get(s, 'p1').status).toBe('submitted');
      expect(s.notifications.map((n) => [n.type, n.userId])).toEqual([
        ['prebooking_submitted', U.tomas.id],
      ]);
    }
    expect(confirmBooking(one('tentative'), U.tomas, T, 'p1').ok).toBe(false);
  });

  it('visible to PMs, the Chief and the Admin, not to the warehouse', () => {
    const s = withBookings(
      baseState(),
      bk({ id: 'a', status: 'tentative' }),
      bk({ id: 'b', status: 'planned' }),
      bk({ id: 'c', status: 'draft' }),
      order({ id: 'd' }),
    );
    for (const u of [U.petr, U.lucie, U.tomas, U.admin]) expect(visibleState(s, u)).toBe(s);
    expect(visibleState(s, U.martin).bookings.map((b) => b.id)).toEqual(['c', 'd']);
    expect(canSeeBooking(U.martin, get(s, 'a'))).toBe(false);
    expect(s.bookings).toHaveLength(4);
  });

  it('reminders before approval go to the PM only; all stages expire on the event day', () => {
    for (const st of ['tentative', 'planned', 'draft', 'submitted'] as const) {
      const warned = runDailyJobs(one(st), '2027-04-20').notifications.filter(
        (n) => n.type === 'prebooking_expiring',
      );
      expect(warned.map((n) => n.userId).sort()).toEqual(
        st === 'submitted' ? [U.petr.id, U.tomas.id].sort() : [U.petr.id],
      );
      const done = runDailyJobs(one(st), '2027-04-23');
      expect(get(done.state, 'p1').status).toBe('expired');
    }
  });
});
