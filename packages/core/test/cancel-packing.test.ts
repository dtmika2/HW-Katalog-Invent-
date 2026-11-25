/** Packing ahead of time, and cancelling packing or a delivery. */
import { describe, expect, it } from 'vitest';
import {
  cancelPacking,
  cancelShipment,
  canCancelShipment,
  casePlaces,
  createLoan,
  detectConflicts,
  earlyPackingHits,
  isEarlyPacking,
  lineProgress,
  looseHere,
  openPromises,
  packAndShip,
  packLines,
  recordReturnSession,
  shipBatch,
  standardCaseChecks,
  startPacking,
  unwrap,
  type AppState,
  type BookingLine,
  type PackedLine,
} from '../src';
import {
  baseState,
  bk,
  caseT,
  item,
  ln,
  order,
  P,
  TODAY as T,
  U,
  W,
  withBookings,
} from './helpers';

const get = (s: AppState, id = 'o1') => s.bookings.find((b) => b.id === id)!;
const events = (s: AppState, id = 'o1') =>
  s.messages.filter((m) => m.bookingId === id && m.event).map((m) => m.event!.type);
const needsReason = { error: { code: 'validation', details: { field: 'earlyReason' } } };

// June order (confirmed second) and an order in May (confirmed first), both want LEDBeams (12).
const june = (extra: Partial<Parameters<typeof order>[0]> = {}) =>
  order(
    {
      id: 'o1',
      periods: [P('2027-06-10', '2027-06-11')],
      lines: [ln('l1', item('ledbeam'), 10)],
      ...extra,
    },
    2,
  );
const may = order({
  id: 'm',
  pmId: U.jana.id,
  periods: [P('2027-05-10', '2027-05-11')],
  lines: [ln('l1', item('ledbeam'), 5)],
});

describe('packing ahead of time', () => {
  it('is early when the booked days are more than a week away', () => {
    const s = baseState();
    const b = (from: string) => ({ periods: [P(from, from)] });
    expect(isEarlyPacking(s, b('2027-04-27'), T)).toBe(false);
    expect(isEarlyPacking(s, b('2027-04-28'), T)).toBe(true);
    expect(isEarlyPacking(s, b('2027-04-10'), T)).toBe(false);
  });

  it('lists who would get short until then; a confirmed order needs a reason', () => {
    const s = withBookings(baseState(), may, june());
    expect(earlyPackingHits(s, T, 'o1')).toEqual([
      expect.objectContaining({
        bookingId: 'm',
        level: 'order',
        short: 3,
        days: ['2027-05-10', '2027-05-11'],
      }),
    ]);
    expect(startPacking(s, U.martin, T, 'o1')).toMatchObject(needsReason);
    const started = unwrap(startPacking(s, U.martin, T, 'o1', 'Stavíme zkušebně'));
    expect(get(started).earlyPacking).toEqual({
      by: U.martin.id,
      on: T,
      reason: 'Stavíme zkušebně',
    });
    // the reason is given once
    const packed = unwrap(packLines(started, U.martin, T, 'o1', [{ lineId: 'l1', qty: 10 }]));
    expect(packed.conflicts).toEqual([
      expect.objectContaining({ bookingId: 'm', shortQty: 3, collidingBookingIds: ['o1'] }),
    ]);
    const told = packed.notifications.filter((n) => n.type === 'conflict_detected');
    expect(told.map((n) => n.userId)).toContain(U.jana.id);
  });

  it('gear packed early counts for an order confirmed earlier too', () => {
    const s = unwrap(startPacking(withBookings(baseState(), may, june()), U.martin, T, 'o1', 'x'));
    expect(detectConflicts(s, get(s, 'm'))).toEqual([]);
    const p = unwrap(packLines(s, U.martin, T, 'o1', [{ lineId: 'l1', qty: 10 }]));
    expect(detectConflicts(p, get(p, 'm'))[0]).toMatchObject({ short: 3 });
  });

  it('nobody in between, or only a pre-booking: no reason needed', () => {
    const free = withBookings(baseState(), june());
    expect(earlyPackingHits(free, T, 'o1')).toEqual([]);
    expect(startPacking(free, U.martin, T, 'o1').ok).toBe(true);
    const pre = withBookings(
      baseState(),
      bk({
        id: 'p',
        status: 'submitted',
        periods: [P('2027-05-10', '2027-05-10')],
        lines: [ln('l1', item('ledbeam'), 5)],
      }),
      june(),
    );
    expect(earlyPackingHits(pre, T, 'o1').map((h) => h.level)).toEqual(['prebooking']);
    expect(startPacking(pre, U.martin, T, 'o1').ok).toBe(true);
    // on the booked days it is simply the order's gear
    expect(earlyPackingHits(withBookings(baseState(), may, june()), '2027-06-10', 'o1')).toEqual(
      [],
    );
  });

  it('a collision that appears after the start is caught when packing, also in one go', () => {
    const started = unwrap(startPacking(withBookings(baseState(), june()), U.martin, T, 'o1'));
    const s = withBookings(started, may);
    const lines: PackedLine[] = [{ lineId: 'l1', qty: 10 }];
    expect(packLines(s, U.martin, T, 'o1', lines)).toMatchObject(needsReason);
    expect(packLines(s, U.martin, T, 'o1', [{ lineId: 'l1', qty: 7 }]).ok).toBe(true);
    expect(packLines(s, U.martin, T, 'o1', lines, { earlyReason: 'nutné' }).ok).toBe(true);
    const go = { label: 'x', lines };
    expect(packAndShip(s, U.martin, T, 'o1', go)).toMatchObject(needsReason);
    expect(packAndShip(s, U.martin, T, 'o1', { ...go, earlyReason: 'nutné' }).ok).toBe(true);
  });
});

describe('cancelling packing', () => {
  const ext = (): BookingLine =>
    ln('e1', { external: { name: 'Rental', supplier: 'X', pickup: T, returnDate: T } }, 2);
  const packed = () => {
    const s = withBookings(
      baseState(),
      order({
        id: 'o1',
        status: 'packing',
        lines: [ln('l1', item('ax9'), 4), ln('l2', caseT('ct-ax9'), 1), ext()],
      }),
    );
    return unwrap(
      packLines(s, U.martin, T, 'o1', [
        { lineId: 'l1', qty: 1 },
        { lineId: 'l1', qty: 3, fromCaseId: 'case-2' },
        {
          lineId: 'l2',
          qty: 1,
          caseIds: ['case-1'],
          caseChecks: standardCaseChecks(s, ['case-1']),
        },
        { lineId: 'e1', qty: 2, deferred: true },
      ]),
    );
  };

  it('the order is confirmed again, its gear is free for others, and it can be packed later', () => {
    const s = packed();
    const before = structuredClone(s);
    expect(looseHere(s, 'ax9', W.brod, T)).toBe(3);
    const c = unwrap(cancelPacking(s, U.martin, T, 'o1', 'Moc brzy'));
    expect(s).toEqual(before);
    expect(get(c).status).toBe('confirmed');
    expect(c.packings).toEqual([]);
    expect(casePlaces(c).size).toBe(0);
    expect(c.cases[1]!.contents.find((x) => x.itemId === 'ax9')?.qty).toBe(8);
    expect(openPromises(c, get(c))).toEqual([]);
    const ev = c.messages.at(-1)!.event!;
    expect(ev).toEqual({ type: 'packing_cancelled', params: { count: 5, reason: 'Moc brzy' } });
    // somebody else takes the gear meanwhile
    expect(
      createLoan(c, U.petr, T, { itemId: 'ax9', warehouseId: W.brod, qty: 4, until: T }).ok,
    ).toBe(true);
    const again = unwrap(startPacking(c, U.martin, T, 'o1'));
    expect(lineProgress(again, get(again), get(again).lines[0]!)).toMatchObject({ toPack: 4 });
    expect(packLines(again, U.martin, T, 'o1', [{ lineId: 'l1', qty: 4 }]).ok).toBe(true);
  });

  it('works before anything is packed; only the warehouse; not on other states', () => {
    const s = withBookings(
      baseState(),
      order({ id: 'o1', status: 'packing', lines: [ln('l1', item('hazer'), 1)] }),
    );
    expect(get(unwrap(cancelPacking(s, U.martin, T, 'o1'))).status).toBe('confirmed');
    expect(cancelPacking(s, U.petr, T, 'o1')).toMatchObject({ error: { code: 'forbidden' } });
    const c = withBookings(baseState(), order({ id: 'o1', lines: [] }));
    expect(cancelPacking(c, U.martin, T, 'o1')).toMatchObject({ error: { code: 'invalid_state' } });
  });

  it('when part has left, only what is still here is unpacked', () => {
    const s = unwrap(
      shipBatch(packed(), U.martin, T, 'o1', { label: 'a', lines: [{ lineId: 'l1', qty: 2 }] }),
    );
    const c = unwrap(cancelPacking(s, U.martin, T, 'o1'));
    expect(get(c).status).toBe('packing');
    expect(lineProgress(c, get(c), get(c).lines[0]!)).toMatchObject({
      shipped: 2,
      toPack: 2,
      readyPacked: 0,
    });
    expect(casePlaces(c).size).toBe(0);
    expect(cancelPacking(c, U.martin, T, 'o1')).toMatchObject({ error: { code: 'invalid_state' } });
  });

  it('a conflict caused by packing early resolves, and the early reason is forgotten', () => {
    let s = unwrap(startPacking(withBookings(baseState(), may, june()), U.martin, T, 'o1', 'x'));
    s = unwrap(packLines(s, U.martin, T, 'o1', [{ lineId: 'l1', qty: 10 }]));
    expect(s.conflicts[0]?.status).toBe('new');
    const c = unwrap(cancelPacking(s, U.martin, T, 'o1'));
    expect(c.conflicts[0]).toMatchObject({ status: 'resolved', resolution: 'auto' });
    expect(get(c)).not.toHaveProperty('earlyPacking');
    expect(startPacking(c, U.martin, T, 'o1')).toMatchObject(needsReason);
  });
});

describe('cancelling a delivery', () => {
  const shipped = () => {
    const s = withBookings(
      baseState(),
      order({
        id: 'o1',
        pmId: U.jana.id,
        status: 'packing',
        lines: [
          ln('l1', item('ledbeam'), 4),
          ln('l2', item('tape'), 3),
          ln('e1', { external: { name: 'Rental', supplier: 'X', pickup: T, returnDate: T } }, 2),
        ],
      }),
    );
    const p = unwrap(
      packLines(s, U.martin, T, 'o1', [
        { lineId: 'l1', qty: 4 },
        { lineId: 'l2', qty: 3 },
        { lineId: 'e1', qty: 2, deferred: true },
      ]),
    );
    const one = unwrap(
      shipBatch(p, U.martin, T, 'o1', {
        label: 'Dodávka 1',
        lines: [
          { lineId: 'l1', qty: 4 },
          { lineId: 'l2', qty: 3 },
        ],
      }),
    );
    return unwrap(
      shipBatch(one, U.martin, T, 'o1', {
        label: 'Dodávka 2',
        lines: [{ lineId: 'e1', qty: 2, deferred: true }],
      }),
    );
  };
  const tape = (s: AppState) => s.stock.find((x) => x.itemId === 'tape')!.qty;

  it('its gear is packed again, promised gear open, consumables back; PM and Chief are told', () => {
    const s = shipped();
    expect(get(s).status).toBe('shipped');
    const [first, second] = s.shipments;
    let c = unwrap(cancelShipment(s, U.martin, T, second!.id, 'Auto nejelo'));
    expect(get(c).status).toBe('packed');
    expect(openPromises(c, get(c)).map((p) => p.qty)).toEqual([2]);
    c = unwrap(cancelShipment(c, U.martin, T, first!.id));
    expect(c.shipments).toEqual([]);
    expect(lineProgress(c, get(c), get(c).lines[0]!)).toMatchObject({ readyPacked: 4, shipped: 0 });
    expect([tape(s), tape(c)]).toEqual([17, 20]);
    expect(events(c).slice(-2)).toEqual(['shipping_cancelled', 'shipping_cancelled']);
    const told = c.notifications.filter((n) => n.type === 'shipping_cancelled');
    expect([...new Set(told.map((n) => n.userId))].sort()).toEqual([U.jana.id, U.tomas.id].sort());
    expect(told[0]?.params).toMatchObject({ label: 'Dodávka 2', reason: 'Auto nejelo' });
    // then packing too: back to the beginning
    expect(get(unwrap(cancelPacking(c, U.martin, T, 'o1'))).status).toBe('confirmed');
    // shipping it again tells the story again
    const again = unwrap(
      shipBatch(c, U.martin, T, 'o1', { label: 'x', lines: [{ lineId: 'l1', qty: 4 }] }),
    );
    expect(events(again).at(-1)).toBe('shipped_without');
  });

  it('not after a vratka, not a handover, only the warehouse', () => {
    const s = shipped();
    const id = s.shipments[0]!.id;
    expect(canCancelShipment(s, id)).toBe(true);
    expect(cancelShipment(s, U.tomas, T, id)).toMatchObject({ error: { code: 'forbidden' } });
    expect(cancelShipment(s, U.martin, T, 'nope')).toMatchObject({ error: { code: 'not_found' } });
    const back = unwrap(
      recordReturnSession(s, U.martin, '2027-04-26', 'o1', {
        lines: [
          {
            lineId: 'l1',
            returnedQty: 4,
            condition: 'ok',
            confirmed: true,
            locationId: 'loc-b-a1',
          },
        ],
      }),
    );
    expect(canCancelShipment(back, id)).toBe(false);
    expect(cancelShipment(back, U.martin, T, id)).toMatchObject({
      error: { code: 'invalid_state' },
    });
    const handover = {
      ...s,
      shipments: s.shipments.map((x) => ({ ...x, transferFromBookingId: 'a' })),
    };
    expect(cancelShipment(handover, U.martin, T, id)).toMatchObject({
      error: { code: 'invalid_state' },
    });
  });
});
