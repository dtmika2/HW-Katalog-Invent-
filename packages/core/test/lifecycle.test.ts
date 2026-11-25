import { describe, expect, it } from 'vitest';
import {
  ackConflict,
  addLine,
  availableActions,
  can,
  chooseOr,
  closeBooking,
  conflictDays,
  conflictOverview,
  confirmBooking,
  coverWithExternal,
  createBooking,
  detectConflicts,
  expireBooking,
  guard,
  periodWithBuffer,
  recalcBooking,
  removeLine,
  resolveConflict,
  returnToPm,
  saveBooking,
  setConflictInProgress,
  setLineQty,
  setOverrideReason,
  startPacking,
  submitPrebooking,
  TRANSITIONS,
  unwrap,
  type AppState,
  type Booking,
  type BookingStatus,
  type LifecycleAction,
} from '../src';
import { baseState, bk, caseT, item, ln, order, U, W, withBookings } from './helpers';

const T = '2027-04-10';
const get = (s: AppState, id: string) => s.bookings.find((b) => b.id === id) as Booking;

/** Petr's pre-booking for 14 LEDBeams while Jana's order holds 10 → short. */
function shortSetup() {
  const other = order({
    id: 'o1',
    eventName: 'Firemní den',
    pmId: U.jana.id,
    lines: [ln('l1', item('ledbeam'), 10)],
  });
  const draft = bk({ id: 'd1', pmId: U.petr.id, lines: [ln('l1', item('ledbeam'), 4)] });
  let s = withBookings(baseState(), other, draft);
  const b = recalcBooking(s, get(s, 'd1')).booking;
  s = { ...s, bookings: s.bookings.map((x) => (x.id === 'd1' ? b : x)) };
  return s;
}

describe('lifecycle — create, submit, return', () => {
  it('creates a draft pre-booking with default buffer', () => {
    const s = baseState();
    const p = periodWithBuffer('2027-04-23', '2027-04-24', s.settings);
    expect(p).toEqual({
      eventFrom: '2027-04-23',
      eventTo: '2027-04-24',
      bookedFrom: '2027-04-22',
      bookedUntil: '2027-04-25',
    });
    const r = unwrap(
      createBooking(s, U.petr, T, { eventName: 'Gala', periods: [p], clientId: 'cl-1' }),
    );
    const b = get(r.state, r.bookingId);
    expect(b).toMatchObject({
      type: 'prebooking',
      status: 'draft',
      pmId: U.petr.id,
      defaultWarehouseId: W.brod,
    });
    expect(r.state.messages.at(-1)?.event?.type).toBe('created');
  });

  it('create validates input and permissions', () => {
    const s = baseState();
    const p = periodWithBuffer('2027-04-23', '2027-04-24', s.settings);
    expect(createBooking(s, U.martin, T, { eventName: 'x', periods: [p] })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(createBooking(s, U.petr, T, { eventName: ' ', periods: [p] })).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(createBooking(s, U.petr, T, { eventName: 'x', periods: [] })).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(
      createBooking(s, U.petr, T, {
        eventName: 'x',
        periods: [{ ...p, bookedFrom: '2027-04-24' }],
      }),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('submit is blocked without acknowledging the conflict', () => {
    const s = shortSetup();
    const r = submitPrebooking(s, U.petr, T, 'd1');
    expect(r).toMatchObject({
      ok: false,
      error: { code: 'conflict_unacknowledged', details: { lineIds: ['l1'] } },
    });
  });

  it('submit succeeds after acknowledgement and notifies the Chief', () => {
    let s = shortSetup();
    s = { ...s, bookings: s.bookings.map((b) => (b.id === 'd1' ? ackConflict(b, 'l1') : b)) };
    const s2 = unwrap(submitPrebooking(s, U.petr, T, 'd1'));
    expect(get(s2, 'd1')).toMatchObject({ status: 'submitted', submittedAt: T });
    expect(
      s2.notifications.filter((n) => n.type === 'prebooking_submitted').map((n) => n.userId),
    ).toEqual([U.tomas.id]);
  });

  it('an empty pre-booking cannot be submitted', () => {
    const s = withBookings(baseState(), bk({ id: 'd1' }));
    expect(submitPrebooking(s, U.petr, T, 'd1')).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });

  it('Chief returns a pre-booking to the PM with a reason', () => {
    const s = withBookings(
      baseState(),
      bk({ id: 'd1', status: 'submitted', lines: [ln('l1', item('hazer'), 1)] }),
    );
    expect(returnToPm(s, U.tomas, T, 'd1', ' ')).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    const s2 = unwrap(returnToPm(s, U.tomas, T, 'd1', 'Kolik lidí?'));
    expect(get(s2, 'd1')).toMatchObject({
      status: 'draft',
      returnedToPm: { reason: 'Kolik lidí?' },
    });
    expect(s2.notifications.at(-1)).toMatchObject({
      userId: U.petr.id,
      type: 'prebooking_returned',
    });
    expect(returnToPm(s, U.petr, T, 'd1', 'x')).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });
});

describe('lifecycle — confirm', () => {
  it('confirm is blocked on a short line', () => {
    const s = shortSetup();
    expect(confirmBooking(s, U.tomas, T, 'd1')).toMatchObject({
      ok: false,
      error: { code: 'blocking_conflicts', details: { lineIds: ['l1'] } },
    });
  });

  it('confirm with an override reason → conflict record + notifications to Chief and colliding PMs', () => {
    let s = shortSetup();
    s = {
      ...s,
      bookings: s.bookings.map((b) =>
        b.id === 'd1' ? setOverrideReason(b, 'l1', 'Půjčíme si od Jany') : b,
      ),
    };
    const s2 = unwrap(confirmBooking(s, U.tomas, T, 'd1'));
    expect(get(s2, 'd1')).toMatchObject({
      type: 'order',
      status: 'confirmed',
      confirmedBy: U.tomas.id,
      confirmSeq: 2,
    });
    expect(s2.conflicts).toHaveLength(1);
    expect(s2.conflicts[0]).toMatchObject({
      bookingId: 'd1',
      lineId: 'l1',
      shortQty: 2,
      status: 'new',
      source: 'override',
      collidingBookingIds: ['o1'],
      overrideReason: 'Půjčíme si od Jany',
    });
    const notified = s2.notifications
      .filter((n) => n.type === 'conflict_overridden')
      .map((n) => n.userId)
      .sort();
    expect(notified).toEqual([U.jana.id, U.petr.id, U.tomas.id].sort());
    expect(
      s2.notifications
        .filter((n) => n.type === 'order_confirmed')
        .map((n) => n.userId)
        .sort(),
    ).toEqual([U.petr.id, U.martin.id, U.karel.id, U.tomas.id].sort());
  });

  it('an external line resolves the shortage', () => {
    let s = shortSetup();
    s = {
      ...s,
      bookings: s.bookings.map((b) =>
        b.id === 'd1'
          ? coverWithExternal(s, b, 'l1', 2, {
              supplier: 'Rent s.r.o.',
              pickup: '2027-04-22',
              returnDate: '2027-04-25',
            })
          : b,
      ),
    };
    const b = get(s, 'd1');
    expect(b.lines.find((l) => l.id === 'l1')?.qty).toBe(2);
    expect(b.lines.find((l) => 'external' in l.target)).toMatchObject({
      qty: 2,
      target: { external: { itemId: 'ledbeam', supplier: 'Rent s.r.o.' } },
    });
    expect(detectConflicts(s, b)).toHaveLength(0);
    const s2 = unwrap(confirmBooking(s, U.tomas, T, 'd1'));
    expect(s2.conflicts).toHaveLength(0);
  });

  it('external rental of a case type uses its primary item × pieces per case', () => {
    const other = order({ id: 'o1', lines: [ln('l1', caseT('ct-ax9'), 1)] });
    const draft = bk({ id: 'd1', lines: [ln('l1', caseT('ct-ax9'), 2)] });
    const s = withBookings(baseState(), other, draft);
    const b = coverWithExternal(s, draft, 'l1', 1, {
      supplier: 'X',
      pickup: '2027-04-22',
      returnDate: '2027-04-25',
    });
    expect(b.lines.find((l) => l.id === 'l1')?.qty).toBe(1);
    expect(b.lines.find((l) => 'external' in l.target)).toMatchObject({
      qty: 8,
      target: { external: { itemId: 'ax9' } },
    });
  });

  it('a PM without permission cannot confirm', () => {
    const s = withBookings(
      baseState(),
      bk({ id: 'd1', pmId: U.lucie.id, lines: [ln('l1', item('hazer'), 1)] }),
    );
    expect(confirmBooking(s, U.lucie, T, 'd1')).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(availableActions(s, U.lucie, 'd1')).not.toContain('confirm');
  });

  it('a PM with permission confirms their own booking but not someone else’s', () => {
    const s = withBookings(
      baseState(),
      bk({ id: 'own', pmId: U.jana.id, lines: [ln('l1', item('hazer'), 1)] }),
      bk({ id: 'foreign', pmId: U.petr.id, lines: [ln('l1', item('hazer'), 1)] }),
    );
    expect(
      unwrap(confirmBooking(s, U.jana, T, 'own')).bookings.find((b) => b.id === 'own')?.status,
    ).toBe('confirmed');
    expect(confirmBooking(s, U.jana, T, 'foreign')).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('a PM confirming with override runs the same checks and creates a tracked conflict', () => {
    const other = order({
      id: 'o1',
      eventName: 'Petr order',
      pmId: U.petr.id,
      lines: [ln('l1', item('ledbeam'), 10)],
    });
    let draft = bk({ id: 'j1', pmId: U.jana.id, lines: [ln('l1', item('ledbeam'), 4)] });
    let s = withBookings(baseState(), other, draft);
    expect(confirmBooking(s, U.jana, T, 'j1')).toMatchObject({
      ok: false,
      error: { code: 'blocking_conflicts' },
    });
    draft = setOverrideReason(get(s, 'j1'), 'l1', 'Klient trvá');
    s = { ...s, bookings: s.bookings.map((b) => (b.id === 'j1' ? draft : b)) };
    const s2 = unwrap(confirmBooking(s, U.jana, T, 'j1'));
    expect(s2.conflicts[0]).toMatchObject({ status: 'new', source: 'override' });
    expect(
      s2.notifications.some((n) => n.userId === U.petr.id && n.type === 'conflict_overridden'),
    ).toBe(true);
  });

  it('an open OR choice blocks confirmation until a person chooses', () => {
    const s0 = baseState();
    s0.stock = s0.stock.map((x) =>
      x.itemId === 'clamp' || x.itemId === 'stand' ? { ...x, qty: 0 } : x,
    );
    s0.stock.push(); // no clamps, no stands → no green option
    const draft = bk({ id: 'd1', lines: [ln('l1', item('ledbeam'), 2)] });
    const s = withBookings(s0, draft);
    expect(confirmBooking(s, U.tomas, T, 'd1')).toMatchObject({
      ok: false,
      error: { code: 'open_or_choices' },
    });
    const chosen = chooseOr(s, get(s, 'd1'), 'l1|ledbeam|lb-mount', 'c-lb-stand');
    const withReason = setOverrideReason(chosen, 'auto:item:stand', 'Dokoupíme');
    const s2 = { ...s, bookings: [withReason, ...s.bookings.filter((b) => b.id !== 'd1')] };
    const r = confirmBooking(s2, U.tomas, T, 'd1');
    expect(r.ok).toBe(true);
  });
});

describe('lifecycle — conflict records', () => {
  function confirmedWithConflict() {
    let s = shortSetup();
    s = {
      ...s,
      bookings: s.bookings.map((b) => (b.id === 'd1' ? setOverrideReason(b, 'l1', 'ok') : b)),
    };
    return unwrap(confirmBooking(s, U.tomas, T, 'd1'));
  }

  it('a conflict auto-resolves when the other order shrinks', () => {
    const s = confirmedWithConflict();
    const shrunk = setLineQty(s, get(s, 'o1'), 'l1', 8);
    const s2 = unwrap(saveBooking(s, U.tomas, T, shrunk));
    expect(s2.conflicts[0]).toMatchObject({ status: 'resolved', resolution: 'auto' });
  });

  it('the Chief can move a conflict to "V řešení" and close it with a written resolution', () => {
    const s = confirmedWithConflict();
    const id = s.conflicts[0]!.id;
    expect(setConflictInProgress(s, U.petr, id)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    const s2 = unwrap(setConflictInProgress(s, U.tomas, id));
    expect(s2.conflicts[0]!.status).toBe('in_progress');
    expect(resolveConflict(s2, U.tomas, T, id, '')).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    const s3 = unwrap(resolveConflict(s2, U.tomas, T, id, 'Domluveno s Janou'));
    expect(s3.conflicts[0]).toMatchObject({
      status: 'resolved',
      resolution: 'Domluveno s Janou',
      resolvedBy: U.tomas.id,
    });
    expect(resolveConflict(s3, U.tomas, T, id, 'again')).toMatchObject({
      ok: false,
      error: { code: 'invalid_state' },
    });
  });

  it('overview: the short order and its partner are marked per day; a written resolution removes it', () => {
    const s = confirmedWithConflict();
    const list = conflictOverview(s, T);
    expect(list.map((c) => [c.bookingId, c.level])).toContainEqual(['d1', 'order']);
    const days = conflictDays(s, list);
    const day = list[0]!.days[0]!;
    expect(days.get('d1')?.get(day)?.role).toBe('short');
    expect(days.get('o1')?.get(day)?.role).toBe('partner');
    const closed = unwrap(resolveConflict(s, U.tomas, T, s.conflicts[0]!.id, 'Domluveno'));
    expect(conflictOverview(closed, T)).toEqual([]);
    expect(conflictOverview(s, '2099-01-01')).toEqual([]);
  });

  it('overview: a short pre-booking is a request and does not mark the order it collides with', () => {
    const s = shortSetup();
    const list = conflictOverview(s, T);
    expect(list.map((c) => [c.bookingId, c.level])).toEqual([['d1', 'prebooking']]);
    const days = conflictDays(s, list);
    expect([...(days.get('d1')?.values() ?? [])][0]?.role).toBe('request');
    expect(days.has('o1')).toBe(false);
  });

  it('a confirmed order that becomes short gets a detected conflict record', () => {
    const a = order({ id: 'o1', lines: [ln('l1', item('ledbeam'), 10)] }, 1);
    let s = withBookings(baseState(), a);
    s = { ...s, counters: { confirm: 1 } };
    // A later order is saved with more than is free: blocked unless overridden.
    const b = order({ id: 'o2', lines: [ln('l1', item('ledbeam'), 1)] }, 2);
    s = withBookings(s, b);
    const bigger = setLineQty(s, get(s, 'o2'), 'l1', 4);
    expect(saveBooking(s, U.tomas, T, bigger)).toMatchObject({
      ok: false,
      error: { code: 'blocking_conflicts' },
    });
    const s2 = unwrap(saveBooking(s, U.tomas, T, setOverrideReason(bigger, 'l1', 'nutné')));
    expect(s2.conflicts).toHaveLength(1);
    expect(s2.conflicts[0]).toMatchObject({ bookingId: 'o2', source: 'override', shortQty: 2 });
  });
});

describe('lifecycle — editing and transitions', () => {
  it('Chief edit during packing notifies the warehouse with high priority', () => {
    const s = withBookings(
      baseState(),
      order({ id: 'o1', status: 'packing', lines: [ln('l1', item('hazer'), 1)] }),
    );
    const edited = addLine(s, get(s, 'o1'), { itemId: 'lamp' }, 2);
    const s2 = unwrap(saveBooking(s, U.tomas, T, edited));
    const n = s2.notifications.filter((x) => x.type === 'order_edited_after_packing');
    expect(n.map((x) => x.userId).sort()).toEqual([U.karel.id, U.martin.id]);
    expect(n[0]?.highPriority).toBe(true);
  });

  it('PMs edit only their own pre-bookings', () => {
    const s = withBookings(
      baseState(),
      bk({ id: 'd1', pmId: U.petr.id }),
      order({ id: 'o1', pmId: U.petr.id }),
    );
    expect(saveBooking(s, U.lucie, T, get(s, 'd1'))).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(saveBooking(s, U.petr, T, get(s, 'o1'))).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(saveBooking(s, U.petr, T, get(s, 'd1')).ok).toBe(true);
  });

  it('auto lines can only be removed with a reason (Chief)', () => {
    const s = withBookings(baseState(), bk({ id: 'd1' }));
    const b = addLine(s, get(s, 'd1'), { itemId: 'ledbeam' }, 2);
    const desk = 'auto:item:desk';
    expect(removeLine(s, b, desk).lines.some((l) => l.id === desk)).toBe(true);
    const removed = removeLine(s, b, desk, 'Máme vlastní pult');
    expect(removed.lines.some((l) => l.id === desk)).toBe(false);
    expect(removed.suppressedAuto[desk]).toBe('Máme vlastní pult');
    expect(can(U.petr, 'remove_auto_line')).toBe(false);
    expect(can(U.tomas, 'remove_auto_line')).toBe(true);
  });

  it('every illegal transition returns a typed error', () => {
    const statuses: BookingStatus[] = [
      'tentative',
      'planned',
      'draft',
      'submitted',
      'confirmed',
      'packing',
      'shipped',
      'returning',
      'returned',
      'returned_with_issues',
      'closed',
      'expired',
      'cancelled',
    ];
    const actorFor: Record<LifecycleAction, (typeof U)[keyof typeof U]> = {
      setStage: U.tomas,
      submit: U.tomas,
      returnToPm: U.tomas,
      confirm: U.tomas,
      startPacking: U.martin,
      pack: U.martin,
      ship: U.martin,
      addLinesAfterShipping: U.tomas,
      recordReturnSession: U.martin,
      resolveIssue: U.tomas,
      close: U.tomas,
      expire: U.admin,
    };
    for (const action of Object.keys(TRANSITIONS) as LifecycleAction[]) {
      for (const status of statuses) {
        const s = withBookings(
          baseState(),
          bk({
            id: 'b',
            status,
            type: ['tentative', 'planned', 'draft', 'submitted', 'expired'].includes(status)
              ? 'prebooking'
              : 'order',
          }),
        );
        const r = guard(s, actorFor[action], action, 'b');
        expect(r.ok).toBe(TRANSITIONS[action].from.includes(status));
        if (!r.ok) expect(r.error.code).toBe('invalid_state');
      }
    }
    expect(guard(baseState(), U.tomas, 'submit', 'missing')).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('startPacking and close are warehouse/Chief actions in the right state', () => {
    const s = withBookings(
      baseState(),
      order({ id: 'o1', lines: [ln('l1', item('hazer'), 1)] }),
      order({ id: 'o2', status: 'returned' }),
    );
    expect(startPacking(s, U.petr, T, 'o1')).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(get(unwrap(startPacking(s, U.martin, T, 'o1')), 'o1').status).toBe('packing');
    expect(get(unwrap(closeBooking(s, U.tomas, T, 'o2')), 'o2')).toMatchObject({
      status: 'closed',
      closedOn: T,
    });
  });

  it('pre-bookings expire only from the event date', () => {
    const s = withBookings(baseState(), bk({ id: 'd1' }));
    expect(expireBooking(s, '2027-04-22', 'd1')).toMatchObject({
      ok: false,
      error: { code: 'invalid_state' },
    });
    const s2 = unwrap(expireBooking(s, '2027-04-23', 'd1'));
    expect(get(s2, 'd1').status).toBe('expired');
    expect(s2.notifications.at(-1)).toMatchObject({
      type: 'prebooking_expired',
      userId: U.petr.id,
    });
  });
});
