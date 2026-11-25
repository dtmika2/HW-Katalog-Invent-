/** Items taken to an event at the last minute: recorded as gone, expected on the vratka. */
import { describe, expect, it } from 'vitest';
import {
  addLateItem,
  addLine,
  bookingPriceTotal,
  can,
  cancelBooking,
  cancelShipment,
  caseContentQty,
  conflictOverview,
  itemCalendar,
  lateAvailable,
  latePreview,
  looseHere,
  packAndShip,
  recalcBooking,
  recordReturnSession,
  returnSheet,
  saveBooking,
  shipmentBackItems,
  unwrap,
  type AppState,
  type Booking,
  type LateItemInput,
  type User,
} from '../src';
import { baseState, bk, item, ln, order, P, U, W, withBookings } from './helpers';

const DAY = '2027-04-22';
const get = (s: AppState, id = 'me') => s.bookings.find((b) => b.id === id)!;
const late = (s: AppState) => get(s).lines.find((l) => l.late)!;
const input = (extra: Partial<LateItemInput> = {}): LateItemInput => ({
  itemId: 'hazer',
  warehouseId: W.brod,
  qty: 1,
  label: 'Na poslední chvíli',
  ...extra,
});
const add = (s: AppState, extra: Partial<LateItemInput> = {}, u: User = U.martin, day = DAY) =>
  addLateItem(s, u, day, 'me', input(extra));
const base = (extra: Partial<Booking> = {}, ...others: Booking[]) =>
  withBookings(
    baseState(),
    order(
      {
        id: 'me',
        pmId: U.petr.id,
        status: 'packing',
        lines: [ln('l1', item('lamp'), 2)],
        ...extra,
      },
      2,
    ),
    ...others,
  );
const shipped = () =>
  unwrap(
    packAndShip(base(), U.martin, DAY, 'me', { label: 'D1', lines: [{ lineId: 'l1', qty: 2 }] }),
  );
const free = (s: AppState, id: string, d: string) => itemCalendar(s, id, d, d, W.brod)[0]!.free;

describe('last-minute items', () => {
  it('warehouse, Chief and the PM of the event; nobody else', () => {
    for (const u of [U.martin, U.tomas, U.petr]) expect(add(base(), {}, u).ok).toBe(true);
    for (const u of [U.lucie, U.admin]) {
      expect(can(u, 'add_late_item', get(base()))).toBe(false);
      expect(add(base(), {}, u)).toMatchObject({ error: { code: 'forbidden' } });
    }
  });

  it('from packing until the vratka is finished, not while the event is cancelled', () => {
    for (const status of ['packing', 'packed', 'shipped', 'returning'] as const)
      expect(add(base({ status })).ok).toBe(true);
    for (const status of ['confirmed', 'returned', 'returned_with_issues', 'closed'] as const)
      expect(add(base({ status }))).toMatchObject({ error: { code: 'invalid_state' } });
    expect(add(withBookings(baseState(), bk({ id: 'me', status: 'submitted' })))).toMatchObject({
      error: { code: 'invalid_state' },
    });
    const pending = base({ cancelPending: { by: U.tomas.id, on: DAY, reason: 'x' } });
    expect(add(pending)).toMatchObject({ error: { details: { field: 'cancelPending' } } });
  });

  it('is gone right away as its own delivery; the status stays; everybody is told', () => {
    const s = unwrap(add(shipped(), { note: 'Náhradní' }));
    expect(get(s).status).toBe('shipped');
    expect(late(s)).toMatchObject({
      target: { itemId: 'hazer' },
      qty: 1,
      late: { by: U.martin.id, on: DAY, note: 'Náhradní' },
    });
    expect(s.shipments.at(-1)).toMatchObject({
      label: 'Na poslední chvíli',
      lines: [{ lineId: late(s).id, qty: 1 }],
    });
    expect(looseHere(s, 'hazer', W.brod, DAY)).toBe(1);
    expect(s.messages.at(-1)!.event).toMatchObject({
      type: 'late_item',
      params: { qty: 1, item: 'Hazer', note: 'Náhradní' },
    });
    expect(
      s.notifications
        .filter((n) => n.type === 'late_item')
        .map((n) => n.userId)
        .sort(),
    ).toEqual([U.karel.id, U.petr.id, U.tomas.id].sort());
    expect(get(unwrap(add(base()))).status).toBe('packing');
  });

  it('is held for the booked days, and from the day it was taken', () => {
    const s = unwrap(add(base(), {}, U.martin, '2027-04-20'));
    expect(['2027-04-20', '2027-04-21', '2027-04-25'].map((d) => free(s, 'hazer', d))).toEqual([
      1, 1, 1,
    ]);
    expect(free(s, 'hazer', '2027-04-26')).toBe(2);
  });

  it('only what is really here', () => {
    expect(lateAvailable(base(), DAY, input())).toBe(2);
    expect(add(base(), { qty: 3 })).toMatchObject({
      error: { details: { field: 'qty', here: 2 } },
    });
    expect(add(base(), { qty: 0 }).ok).toBe(false);
    expect(add(base(), { qty: 1.5 }).ok).toBe(false);
    const one = unwrap(add(base(), { qty: 2 }));
    expect(add(one)).toMatchObject({ error: { details: { here: 0 } } });
    expect(add(base(), { itemId: 'nope' })).toMatchObject({ error: { code: 'not_found' } });
    expect(add(base(), { warehouseId: W.karlak }).ok).toBe(false);
  });

  it('out of a case: the case is short, and the vratka suggests it back there', () => {
    const s = unwrap(add(base(), { itemId: 'ax9', qty: 2, fromCaseId: 'case-1' }));
    const c = s.cases.find((x) => x.id === 'case-1')!;
    expect(caseContentQty(c, 'ax9')).toBe(6);
    expect(c.incompleteSince).toBe(DAY);
    expect(returnSheet(s, 'me').find((l) => l.late)).toMatchObject({
      itemId: 'ax9',
      outstanding: 2,
      suggestedIntoCaseId: 'case-1',
    });
    expect(add(base(), { itemId: 'ax9', qty: 9, fromCaseId: 'case-1' }).ok).toBe(false);
  });

  it('a consumable leaves the stock and is not expected back', () => {
    const s = unwrap(add(base(), { itemId: 'tape', qty: 3 }));
    expect(s.stock.find((x) => x.itemId === 'tape')!.qty).toBe(17);
    expect(returnSheet(s, 'me').find((l) => l.late)).toMatchObject({ outcome: 'consumable' });
  });

  it('brings no accessories, checks or recommendations, and stays when the list is edited', () => {
    const s = unwrap(add(base(), { itemId: 'ledbeam', qty: 1 }));
    const r = recalcBooking(s, get(s));
    expect(r.booking.lines.map((l) => l.id)).toEqual(['l1', late(s).id]);
    expect([r.expansion.checkWarnings, r.expansion.recommendations]).toEqual([[], []]);
    const without = { ...get(s), lines: get(s).lines.filter((l) => !l.late) };
    const edited = unwrap(
      saveBooking(s, U.tomas, DAY, addLine(s, without, { itemId: 'hazer' }, 1)),
    );
    expect(get(edited).lines.filter((l) => l.late)).toHaveLength(1);
    const changed = {
      ...get(s),
      lines: get(s).lines.map((l) => (l.late ? { ...l, qty: 9 } : l)),
    };
    expect(late(unwrap(saveBooking(s, U.tomas, DAY, changed))).qty).toBe(1);
  });

  it('the price counts it only when ticked', () => {
    const before = bookingPriceTotal(base(), get(base()));
    const s = unwrap(add(base()));
    expect(bookingPriceTotal(s, get(s))).toBe(before);
    const c = unwrap(add(base(), { charged: true }));
    expect(bookingPriceTotal(c, get(c))).toBe(before + 800 * 2);
  });
});

describe('when an order needs it', () => {
  const other = (seq: number) =>
    order({ id: 'o', pmId: U.jana.id, lines: [ln('l1', item('hazer'), 2)] }, seq);

  it('a reason is required, whoever was approved first; the conflict is tracked', () => {
    for (const seq of [1, 3]) {
      const s = base({}, other(seq));
      expect(latePreview(s, DAY, 'me', input())).toMatchObject([{ bookingId: 'o', short: 1 }]);
      expect(add(s)).toMatchObject({
        error: { code: 'validation', details: { field: 'reason', bookingIds: ['o'] } },
      });
      const r = unwrap(add(s, { reason: 'Hazer na místě nejede' }));
      expect(late(r).late?.reason).toBe('Hazer na místě nejede');
      expect(r.conflicts).toMatchObject([{ bookingId: 'o', status: 'new', shortQty: 1 }]);
      expect(
        r.notifications.some((n) => n.type === 'conflict_detected' && n.userId === U.jana.id),
      ).toBe(true);
      // the event that has it is not short of it
      expect(conflictOverview(r, DAY).map((c) => c.bookingId)).toEqual(['o']);
    }
  });

  it('a pre-booking is only named; other days do not matter', () => {
    const wish = bk({ id: 'p', status: 'submitted', lines: [ln('l1', item('hazer'), 2)] });
    expect(add(base({}, wish)).ok).toBe(true);
    const later = order(
      { id: 'o', periods: [P('2027-06-01', '2027-06-02')], lines: [ln('l1', item('hazer'), 2)] },
      1,
    );
    expect(latePreview(base({}, later), DAY, 'me', input())).toEqual([]);
  });
});

describe('back again', () => {
  const back = (s: AppState, qty: number, note?: string) =>
    recordReturnSession(s, U.martin, '2027-04-25', 'me', {
      lines: returnSheet(s, 'me')
        .filter((l) => l.outstanding > 0)
        .map((l) => ({
          lineId: l.lineId,
          returnedQty: l.late ? qty : l.outstanding,
          condition: 'ok' as const,
          confirmed: true,
          locationId: 'loc-b-a1',
          ...(note ? { note } : {}),
        })),
    });

  it('the vratka expects it; returned it is free again', () => {
    const s = unwrap(add(shipped()));
    expect(returnSheet(s, 'me').map((l) => [l.late, l.outstanding])).toEqual([
      [false, 2],
      [true, 1],
    ]);
    const done = unwrap(back(s, 1));
    expect(get(done).status).toBe('returned');
    expect(free(done, 'hazer', '2027-04-24')).toBe(2);
  });

  it('missing, it becomes an issue like any other gear', () => {
    const done = unwrap(back(unwrap(add(shipped())), 0, 'Zůstalo na místě'));
    expect(get(done).status).toBe('returned_with_issues');
    expect(done.issues).toMatchObject([{ type: 'missing', itemId: 'hazer', qty: 1 }]);
  });

  it('taken while the vratka already runs, it is expected too', () => {
    const two = base({ lines: [ln('l1', item('lamp'), 2), ln('l2', item('rope'), 1)] });
    const out = unwrap(
      packAndShip(two, U.martin, DAY, 'me', {
        label: 'D1',
        lines: [
          { lineId: 'l1', qty: 2 },
          { lineId: 'l2', qty: 1 },
        ],
      }),
    );
    const s = unwrap(
      recordReturnSession(out, U.martin, '2027-04-25', 'me', {
        lines: [
          {
            lineId: 'l1',
            returnedQty: 2,
            condition: 'ok',
            confirmed: true,
            locationId: 'loc-b-a1',
          },
        ],
      }),
    );
    expect(get(s).status).toBe('returning');
    const r = unwrap(add(s, {}, U.martin, '2027-04-25'));
    expect(get(r).status).toBe('returning');
    expect(
      returnSheet(r, 'me')
        .filter((l) => l.outstanding > 0)
        .map((l) => l.late),
    ).toEqual([false, true]);
  });

  it('recorded by mistake: cancelling its delivery removes it, pieces go back into the case', () => {
    const s = unwrap(add(shipped(), { itemId: 'ax9', qty: 2, fromCaseId: 'case-1' }));
    const id = s.shipments.at(-1)!.id;
    const r = unwrap(
      cancelShipment(s, U.martin, DAY, id, {
        confirmed: shipmentBackItems(s, id).map((i) => i.key),
      }),
    );
    expect(get(r).lines.map((l) => l.id)).toEqual(['l1']);
    expect(get(r).status).toBe('shipped');
    expect(
      caseContentQty(
        r.cases.find((c) => c.id === 'case-1')!,
        'ax9',
      ),
    ).toBe(8);
    expect(r.packings.flatMap((p) => p.lines).map((l) => l.lineId)).toEqual(['l1']);
    const tape = unwrap(add(shipped(), { itemId: 'tape', qty: 3 }));
    const t = unwrap(
      cancelShipment(tape, U.martin, DAY, tape.shipments.at(-1)!.id, {
        confirmed: shipmentBackItems(tape, tape.shipments.at(-1)!.id).map((i) => i.key),
      }),
    );
    expect(t.stock.find((x) => x.itemId === 'tape')!.qty).toBe(20);
  });

  it('once it has gone, the event cannot simply be cancelled', () => {
    expect(cancelBooking(unwrap(add(base())), U.tomas, DAY, 'me', 'x')).toMatchObject({
      error: { details: { field: 'left' } },
    });
  });
});
