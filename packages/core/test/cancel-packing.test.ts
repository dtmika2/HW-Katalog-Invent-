/** Packing ahead of time, and cancelling packing or a delivery. */
import { describe, expect, it } from 'vitest';
import {
  approveCancel,
  declineCancel,
  openCancelRequests,
  requestCancel,
  withdrawCancel,
  cancelPacking,
  cancelShipment,
  canCancelShipment,
  cancelLocked,
  casePlaces,
  createLoan,
  detectConflicts,
  earlyPackingHits,
  isEarlyPacking,
  lineProgress,
  looseHere,
  openPromises,
  packAndShip,
  packingBackItems,
  packLines,
  recordReturnSession,
  shipBatch,
  shipmentBackItems,
  standardCaseChecks,
  startPacking,
  unpackLine,
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
/** Confirm everything as back, one by one. */
const cancelP = (
  s: AppState,
  user = U.martin as Parameters<typeof cancelPacking>[1],
  reason?: string,
  today = T,
) =>
  cancelPacking(s, user, today, 'o1', {
    confirmed: packingBackItems(s, get(s)).map((i) => i.key),
    ...(reason ? { reason } : {}),
  });
const cancelS = (
  s: AppState,
  id: string,
  user = U.martin as Parameters<typeof cancelPacking>[1],
  reason?: string,
  today = T,
) =>
  cancelShipment(s, user, today, id, {
    confirmed: shipmentBackItems(s, id).map((i) => i.key),
    ...(reason ? { reason } : {}),
  });
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
    const c = unwrap(cancelP(s, U.martin, 'Moc brzy'));
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
    expect(get(unwrap(cancelP(s))).status).toBe('confirmed');
    expect(cancelP(s, U.petr)).toMatchObject({ error: { code: 'forbidden' } });
    const c = withBookings(baseState(), order({ id: 'o1', lines: [] }));
    expect(cancelP(c)).toMatchObject({ error: { code: 'invalid_state' } });
  });

  it('when part has left, only what is still here is unpacked', () => {
    const s = unwrap(
      shipBatch(packed(), U.martin, T, 'o1', { label: 'a', lines: [{ lineId: 'l1', qty: 2 }] }),
    );
    const c = unwrap(cancelP(s));
    expect(get(c).status).toBe('packing');
    expect(lineProgress(c, get(c), get(c).lines[0]!)).toMatchObject({
      shipped: 2,
      toPack: 2,
      readyPacked: 0,
    });
    expect(casePlaces(c).size).toBe(0);
    expect(cancelP(c)).toMatchObject({ error: { code: 'invalid_state' } });
  });

  it('a conflict caused by packing early resolves, and the early reason is forgotten', () => {
    let s = unwrap(startPacking(withBookings(baseState(), may, june()), U.martin, T, 'o1', 'x'));
    s = unwrap(packLines(s, U.martin, T, 'o1', [{ lineId: 'l1', qty: 10 }]));
    expect(s.conflicts[0]?.status).toBe('new');
    const c = unwrap(cancelP(s));
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
    let c = unwrap(cancelS(s, second!.id, U.martin, 'Auto nejelo'));
    expect(get(c).status).toBe('packed');
    expect(openPromises(c, get(c)).map((p) => p.qty)).toEqual([2]);
    c = unwrap(cancelS(c, first!.id));
    expect(c.shipments).toEqual([]);
    expect(lineProgress(c, get(c), get(c).lines[0]!)).toMatchObject({ readyPacked: 4, shipped: 0 });
    expect([tape(s), tape(c)]).toEqual([17, 20]);
    expect(events(c).slice(-2)).toEqual(['shipping_cancelled', 'shipping_cancelled']);
    const told = c.notifications.filter((n) => n.type === 'shipping_cancelled');
    expect([...new Set(told.map((n) => n.userId))].sort()).toEqual([U.jana.id, U.tomas.id].sort());
    expect(told[0]?.params).toMatchObject({ label: 'Dodávka 2', reason: 'Auto nejelo' });
    // then packing too: back to the beginning
    expect(get(unwrap(cancelP(c))).status).toBe('confirmed');
    // shipping it again tells the story again
    const again = unwrap(
      shipBatch(c, U.martin, T, 'o1', { label: 'x', lines: [{ lineId: 'l1', qty: 4 }] }),
    );
    expect(events(again).at(-1)).toBe('shipped_without');
  });

  it('not after a vratka, not a handover, only the warehouse and the Chief', () => {
    const s = shipped();
    const id = s.shipments[0]!.id;
    expect(canCancelShipment(s, id)).toBe(true);
    expect(cancelS(s, id, U.petr)).toMatchObject({ error: { code: 'forbidden' } });
    expect(cancelS(s, 'nope')).toMatchObject({ error: { code: 'not_found' } });
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
    expect(cancelS(back, id)).toMatchObject({
      error: { code: 'invalid_state' },
    });
    const handover = {
      ...s,
      shipments: s.shipments.map((x) => ({ ...x, transferFromBookingId: 'a' })),
    };
    expect(cancelS(handover, id)).toMatchObject({
      error: { code: 'invalid_state' },
    });
  });
});

describe('cancelling cannot replace the vratka', () => {
  const START = '2027-04-23';
  const s0 = () => {
    const s = withBookings(
      baseState(),
      order({
        id: 'o1',
        status: 'packing',
        lines: [ln('l1', item('ax9'), 4), ln('l2', caseT('ct-ax9'), 2), ln('l3', item('hazer'), 1)],
      }),
    );
    return unwrap(
      packLines(s, U.martin, T, 'o1', [
        { lineId: 'l1', qty: 1 },
        { lineId: 'l1', qty: 3, fromCaseId: 'case-2' },
        { lineId: 'l3', qty: 1 },
      ]),
    );
  };
  const withCase = () => {
    const s = unwrap(
      packLines(s0(), U.martin, T, 'o1', [
        {
          lineId: 'l2',
          qty: 1,
          caseIds: ['case-1'],
          caseChecks: standardCaseChecks(baseState(), ['case-1']),
        },
      ]),
    );
    return s;
  };
  const gone = () =>
    unwrap(
      shipBatch(withCase(), U.martin, T, 'o1', {
        label: 'Dodávka 1',
        lines: [
          { lineId: 'l1', qty: 4 },
          { lineId: 'l2', qty: 1, caseIds: ['case-1'] },
        ],
      }),
    );

  it('every case and every loose line has to be confirmed as back', () => {
    const s = gone();
    const id = s.shipments[0]!.id;
    expect(shipmentBackItems(s, id)).toEqual([
      { key: 'l1', qty: 4, name: 'Astera AX9 PowerPAR' },
      { key: 'case-1', qty: 1, name: 'AX9 case', caseId: 'case-1' },
    ]);
    expect(cancelShipment(s, U.martin, T, id, { confirmed: ['l1'] })).toMatchObject({
      error: { code: 'validation', details: { field: 'confirmed', missing: ['case-1'] } },
    });
    expect(cancelShipment(s, U.martin, T, id, { confirmed: ['l1', 'case-1'] }).ok).toBe(true);
    // what is still packed here is confirmed separately
    expect(packingBackItems(s, get(s)).map((i) => i.key)).toEqual(['l3']);
    expect(cancelPacking(s, U.martin, T, 'o1', { confirmed: [] })).toMatchObject({
      error: { code: 'validation', details: { missing: ['l3'] } },
    });
  });

  it('once the event has begun only the Chief cancels, and only with a reason', () => {
    const s = gone();
    const id = s.shipments[0]!.id;
    expect([cancelLocked(get(s), '2027-04-22'), cancelLocked(get(s), START)]).toEqual([
      false,
      true,
    ]);
    const forbidden = { error: { code: 'forbidden', details: { field: 'started' } } };
    expect(cancelS(s, id, U.martin, 'x', '2027-04-22').ok).toBe(true);
    expect(cancelS(s, id, U.martin, 'x', START)).toMatchObject(forbidden);
    expect(cancelP(s, U.martin, 'x', START)).toMatchObject(forbidden);
    expect(cancelS(s, id, U.tomas, undefined, START)).toMatchObject({
      error: { code: 'validation', details: { field: 'reason' } },
    });
    expect(cancelS(s, id, U.tomas, 'Akce zrušena', START).ok).toBe(true);
    expect(cancelP(s, U.tomas, 'Akce zrušena', START).ok).toBe(true);
    // the Chief also before the start, without a reason; a PM never
    expect(cancelS(s, id, U.tomas).ok).toBe(true);
    expect(cancelS(s, id, U.jana)).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('unpacking line by line is no way around it', () => {
    const s = withCase();
    expect(unpackLine(s, U.martin, T, 'o1', 'l3').ok).toBe(true);
    expect(unpackLine(s, U.martin, START, 'o1', 'l3')).toMatchObject({
      error: { code: 'forbidden', details: { field: 'started' } },
    });
    expect(unpackLine(s, U.tomas, START, 'o1', 'l3').ok).toBe(true);
    expect(unpackLine(s, U.petr, T, 'o1', 'l3')).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('a show on several weekends is locked from its first day', () => {
    const b = { periods: [P('2027-05-08', '2027-05-09'), P('2027-05-22', '2027-05-23')] };
    expect([cancelLocked(b, '2027-05-07'), cancelLocked(b, '2027-05-15')]).toEqual([false, true]);
  });
});

describe('the warehouse asks the Chief to cancel', () => {
  const START = '2027-04-23';
  const gone = () => {
    let s = withBookings(
      baseState(),
      order({
        id: 'o1',
        status: 'packing',
        lines: [ln('l1', item('ledbeam'), 4), ln('l3', item('hazer'), 1)],
      }),
    );
    s = unwrap(
      packLines(s, U.martin, T, 'o1', [
        { lineId: 'l1', qty: 4 },
        { lineId: 'l3', qty: 1 },
      ]),
    );
    return unwrap(
      shipBatch(s, U.martin, T, 'o1', { label: 'Dodávka 1', lines: [{ lineId: 'l1', qty: 4 }] }),
    );
  };
  const idOf = (s: AppState) => s.shipments[0]!.id;
  const ask = (
    s: AppState,
    extra: Partial<Parameters<typeof requestCancel>[4]> = {},
    user = U.martin as Parameters<typeof requestCancel>[1],
    today = START,
  ) =>
    requestCancel(s, user, today, 'o1', {
      shipmentId: idOf(s),
      confirmed: ['l1'],
      reason: 'Akce odpadla',
      ...extra,
    });
  const asked = () => unwrap(ask(gone()));
  const req = (s: AppState) => openCancelRequests(s, get(s))[0]!;

  it('confirms what is back and gives a reason; Chief is notified, conversation records it', () => {
    const s = gone();
    expect(ask(s, { reason: ' ' })).toMatchObject({ error: { details: { field: 'reason' } } });
    expect(ask(s, { confirmed: [] })).toMatchObject({ error: { details: { missing: ['l1'] } } });
    expect(ask(s, {}, U.petr)).toMatchObject({ error: { code: 'forbidden' } });
    expect(ask(s, { shipmentId: 'nope' })).toMatchObject({ error: { code: 'not_found' } });
    // before the start, or by the Chief, it is cancelled directly
    expect(ask(s, {}, U.martin, '2027-04-22')).toMatchObject({ error: { code: 'invalid_state' } });
    expect(ask(s, {}, U.tomas)).toMatchObject({ error: { code: 'invalid_state' } });
    const a = asked();
    expect(get(a).status).toBe(get(s).status);
    expect(a.shipments).toEqual(s.shipments);
    expect(req(a)).toMatchObject({ by: U.martin.id, on: START, reason: 'Akce odpadla' });
    expect(events(a).at(-1)).toBe('cancel_requested');
    expect(
      a.notifications.filter((n) => n.type === 'cancel_requested').map((n) => n.userId),
    ).toEqual([U.tomas.id]);
    expect(ask(a)).toMatchObject({ error: { code: 'invalid_state' } });
  });

  it('approved: cancelled with the warehouse confirmation, the requester is told', () => {
    const a = asked();
    expect(approveCancel(a, U.karel, START, 'o1', req(a).id)).toMatchObject({
      error: { code: 'forbidden' },
    });
    const s = unwrap(approveCancel(a, U.tomas, START, 'o1', req(a).id));
    expect(s.shipments).toEqual([]);
    expect(openCancelRequests(s, get(s))).toEqual([]);
    expect(s.messages.at(-1)!.event).toMatchObject({
      type: 'shipping_cancelled',
      params: { reason: 'Akce odpadla' },
    });
    expect(s.notifications.at(-1)).toMatchObject({
      type: 'cancel_decided',
      userId: U.martin.id,
      params: { approved: 1 },
    });
  });

  it('packing can be asked for too; what was packed since then must be confirmed first', () => {
    const s = unwrap(ask(gone(), { shipmentId: undefined as never, confirmed: ['l3'] }));
    const r = req(s);
    expect(r).not.toHaveProperty('shipmentId');
    const more = unwrap(
      cancelShipment(s, U.tomas, START, idOf(s), { confirmed: ['l1'], reason: 'x' }),
    );
    expect(approveCancel(more, U.tomas, START, 'o1', r.id)).toMatchObject({
      error: { details: { field: 'confirmed', missing: ['l1'] } },
    });
    const done = unwrap(approveCancel(s, U.tomas, START, 'o1', r.id));
    expect(packingBackItems(done, get(done))).toEqual([]);
  });

  it('declined with a reason, or taken back by who asked', () => {
    const a = asked();
    expect(declineCancel(a, U.tomas, START, 'o1', req(a).id, '')).toMatchObject({
      error: { code: 'validation' },
    });
    const no = unwrap(declineCancel(a, U.tomas, START, 'o1', req(a).id, 'Zapište vratku'));
    expect(openCancelRequests(no, get(no))).toEqual([]);
    expect(no.shipments).toHaveLength(1);
    expect(events(no).at(-1)).toBe('cancel_declined');
    expect(no.notifications.at(-1)).toMatchObject({
      userId: U.martin.id,
      params: { approved: 0, reason: 'Zapište vratku' },
    });
    expect(ask(no).ok).toBe(true);
    expect(withdrawCancel(a, U.karel, START, 'o1', req(a).id)).toMatchObject({
      error: { code: 'forbidden' },
    });
    const back = unwrap(withdrawCancel(a, U.martin, START, 'o1', req(a).id));
    expect(openCancelRequests(back, get(back))).toEqual([]);
    expect(events(back).at(-1)).toBe('cancel_withdrawn');
  });

  it('a vratka makes the request pointless', () => {
    const a = asked();
    const s = unwrap(
      recordReturnSession(a, U.martin, START, 'o1', {
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
    expect(openCancelRequests(s, get(s))).toEqual([]);
    expect(approveCancel(s, U.tomas, START, 'o1', 'cnr-1')).toMatchObject({
      error: { code: 'not_found' },
    });
  });
});
