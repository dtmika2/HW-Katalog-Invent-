/** Packing and shipping as two steps; promised gear; what packed gear blocks. */
import { describe, expect, it } from 'vitest';
import {
  acceptedConflicts,
  buildHoldIndex,
  casePlaces,
  casesHere,
  closePromised,
  confirmHandover,
  createLoan,
  deferrableQty,
  emptyState,
  evaluateBooking,
  handoverOf,
  itemDay,
  lineProgress,
  looseHere,
  looseInHouse,
  openPromises,
  packAndShip,
  packingList,
  packingsFromShipments,
  packLines,
  promisedText,
  recordReturnSession,
  refillCase,
  returnSheet,
  runDailyJobs,
  saveBooking,
  setLineQty,
  shipBatch,
  standardCaseChecks,
  statusAfter,
  unpackLine,
  unwrap,
  type AppState,
  type Booking,
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

const D = '2027-04-22';
const ext = (qty = 8) =>
  ln(
    'e1',
    {
      external: {
        name: 'AX9 rental',
        supplier: 'Astera Rent',
        pickup: D,
        returnDate: '2027-04-26',
      },
    },
    qty,
  );
const start = (lines: BookingLine[], extra: Partial<Booking> = {}) =>
  withBookings(
    baseState(),
    order({ id: 'o1', pmId: U.jana.id, status: 'packing', lines, ...extra }),
  );
const get = (s: AppState, id = 'o1') => s.bookings.find((b) => b.id === id)!;
const line = (s: AppState, lineId: string, id = 'o1') =>
  get(s, id).lines.find((l) => l.id === lineId)!;
const prog = (s: AppState, lineId: string, id = 'o1') =>
  lineProgress(s, get(s, id), line(s, lineId, id));
const pack = (s: AppState, ...lines: PackedLine[]) => packLines(s, U.martin, D, 'o1', lines);
const packed = (s: AppState, ...lines: PackedLine[]) => unwrap(pack(s, ...lines));
const ship = (s: AppState, lines: PackedLine[], note?: string) =>
  shipBatch(s, U.martin, D, 'o1', { label: 'Dodávka 1', lines, ...(note ? { note } : {}) });
const shipped = (s: AppState, lines: PackedLine[], note?: string) => unwrap(ship(s, lines, note));
const events = (s: AppState) =>
  s.messages.filter((m) => m.bookingId === 'o1' && m.event).map((m) => m.event!.type);
const invalid = { ok: false, error: { code: 'validation' } };

describe('packing is not shipping', () => {
  it('Balí se → Zabaleno → Odvezeno, with who packed and an entry in the conversation', () => {
    let s = start([ln('l1', item('ledbeam'), 10), ln('l2', item('hazer'), 1)]);
    s = packed(s, { lineId: 'l1', qty: 10 });
    expect(get(s).status).toBe('packing');
    s = packed(s, { lineId: 'l2', qty: 1 });
    expect(get(s).status).toBe('packed');
    expect(s.shipments).toEqual([]);
    expect(returnSheet(s, 'o1')).toEqual([]);
    expect(packingList(s, 'o1')!.byWarehouse[0]!.groups[0]!.lines[0]!.packedBy).toEqual({
      userId: U.martin.id,
      on: D,
    });
    const told = s.notifications.filter((n) => n.type === 'order_packed').map((n) => n.userId);
    expect(told.sort()).toEqual([U.jana.id, U.tomas.id].sort());
    s = shipped(s, [
      { lineId: 'l1', qty: 10 },
      { lineId: 'l2', qty: 1 },
    ]);
    expect(get(s).status).toBe('shipped');
    expect(events(s)).toEqual(['packed', 'packed', 'batch_shipped']);
  });

  it('only what is packed can be shipped; batches work while the rest is being packed', () => {
    let s = start([ln('l1', item('ledbeam'), 10)]);
    expect(ship(s, [{ lineId: 'l1', qty: 1 }])).toMatchObject(invalid);
    s = packed(s, { lineId: 'l1', qty: 6 });
    expect(ship(s, [{ lineId: 'l1', qty: 7 }])).toMatchObject(invalid);
    s = shipped(s, [{ lineId: 'l1', qty: 4 }]);
    expect(prog(s, 'l1')).toEqual({
      qty: 10,
      shipped: 4,
      toPack: 4,
      readyPacked: 2,
      readyDeferred: 0,
      extra: 0,
    });
    expect(get(s).status).toBe('packing');
    s = packed(s, { lineId: 'l1', qty: 4 });
    expect(get(s).status).toBe('packed');
    expect(get(shipped(s, [{ lineId: 'l1', qty: 6 }])).status).toBe('shipped');
    expect(pack(s, { lineId: 'l1', qty: 1 })).toMatchObject(invalid);
  });

  it('pack and ship in one go equals packing and then shipping', () => {
    const s = start([ln('l1', item('ledbeam'), 10), ln('l2', caseT('ct-ax9'), 1)]);
    const lines: PackedLine[] = [
      { lineId: 'l1', qty: 10 },
      { lineId: 'l2', qty: 1, caseIds: ['case-1'], caseChecks: standardCaseChecks(s, ['case-1']) },
    ];
    const one = unwrap(packAndShip(s, U.martin, D, 'o1', { label: 'Dodávka 1', lines }));
    const two = shipped(packed(s, ...lines), [
      { lineId: 'l1', qty: 10 },
      { lineId: 'l2', qty: 1, caseIds: ['case-1'] },
    ]);
    expect(one.shipments).toEqual(two.shipments);
    expect(one.packings).toEqual(two.packings);
    expect(returnSheet(one, 'o1')).toEqual(returnSheet(two, 'o1'));
    expect(events(one)).toEqual(['batch_shipped']);
    expect(one.notifications.some((n) => n.type === 'order_packed')).toBe(false);
  });

  it('only the warehouse packs; permissions and states are checked', () => {
    const s = start([ln('l1', item('ledbeam'), 1)]);
    expect(packLines(s, U.tomas, D, 'o1', [{ lineId: 'l1', qty: 1 }])).toMatchObject({
      error: { code: 'forbidden' },
    });
    const c = withBookings(baseState(), order({ id: 'o1', lines: [ln('l1', item('ledbeam'), 1)] }));
    expect(pack(c, { lineId: 'l1', qty: 1 })).toMatchObject({ error: { code: 'invalid_state' } });
    expect(pack(s)).toMatchObject(invalid);
    expect(pack(s, { lineId: 'l1', qty: 1 }, { lineId: 'l1', qty: 1 })).toMatchObject(invalid);
  });

  it('consumables leave the stock when they are shipped, not when packed', () => {
    const stock = (x: AppState) => x.stock.find((i) => i.itemId === 'tape')!.qty;
    let s = start([ln('l1', item('tape'), 5)]);
    s = packed(s, { lineId: 'l1', qty: 5 });
    expect(stock(s)).toBe(20);
    expect(stock(shipped(s, [{ lineId: 'l1', qty: 5 }]))).toBe(15);
  });

  it('case checks count at packing; vratka later knows what left', () => {
    let s = start([ln('l1', caseT('ct-ax9'), 1)]);
    const check = standardCaseChecks(s, ['case-1'])[0]!;
    s = packed(s, {
      lineId: 'l1',
      qty: 1,
      caseIds: ['case-1'],
      caseChecks: [
        {
          ...check,
          counts: check.counts.map((c) => (c.itemId === 'ax9' ? { ...c, qty: 7 } : c)),
          reason: 'chybí',
        },
      ],
    });
    expect(s.issues).toEqual([
      expect.objectContaining({ itemId: 'ax9', qty: 1, caseId: 'case-1' }),
    ]);
    expect(ship(s, [{ lineId: 'l1', qty: 1, caseIds: ['case-2'] }])).toMatchObject(invalid);
    s = shipped(s, [{ lineId: 'l1', qty: 1, caseIds: ['case-1'] }]);
    expect(returnSheet(s, 'o1')[0]?.shippedContents['case-1']).toContainEqual({
      itemId: 'ax9',
      qty: 7,
    });
  });

  it('loose pieces out of a case keep their case through shipping', () => {
    let s = start([ln('l1', item('ax9'), 4)]);
    s = packed(s, { lineId: 'l1', qty: 1 }, { lineId: 'l1', qty: 3, fromCaseId: 'case-1' });
    s = shipped(s, [{ lineId: 'l1', qty: 4 }]);
    expect(s.shipments[0]?.lines).toEqual([
      { lineId: 'l1', qty: 1 },
      { lineId: 'l1', qty: 3, fromCaseId: 'case-1' },
    ]);
    expect(returnSheet(s, 'o1')[0]?.suggestedIntoCaseId).toBe('case-1');
  });
});

describe('unpacking', () => {
  it('puts pieces and cases back, until they are shipped', () => {
    let s = start([ln('l1', item('ax9'), 4), ln('l2', caseT('ct-ax9'), 1)]);
    s = packed(
      s,
      { lineId: 'l1', qty: 4, fromCaseId: 'case-2' },
      { lineId: 'l2', qty: 1, caseIds: ['case-1'], caseChecks: standardCaseChecks(s, ['case-1']) },
    );
    expect(get(s).status).toBe('packed');
    const before = structuredClone(s);
    let u = unwrap(unpackLine(s, U.martin, D, 'o1', 'l1', { qty: 1 }));
    expect(s).toEqual(before);
    expect(prog(u, 'l1')).toMatchObject({ toPack: 1, readyPacked: 3 });
    expect(get(u).status).toBe('packing');
    u = unwrap(unpackLine(u, U.martin, D, 'o1', 'l1'));
    expect(u.cases[1]?.contents.find((c) => c.itemId === 'ax9')?.qty).toBe(8);
    expect(u.cases[1]).not.toHaveProperty('incompleteSince');
    u = unwrap(unpackLine(u, U.martin, D, 'o1', 'l2', { caseId: 'case-1' }));
    expect(u.packings).toEqual([]);
    expect(casePlaces(u).size).toBe(0);
    expect(events(u)).toContain('unpacked');
    expect(unpackLine(u, U.martin, D, 'o1', 'l2')).toMatchObject(invalid);
    expect(unpackLine(s, U.martin, D, 'o1', 'l2', { caseId: 'case-3' })).toMatchObject(invalid);
    const gone = shipped(s, [{ lineId: 'l1', qty: 4 }]);
    expect(unpackLine(gone, U.martin, D, 'o1', 'l1')).toMatchObject(invalid);
  });

  it('an order lowered later has too much packed; only what is needed ships', () => {
    let s = start([ln('l1', item('hazer'), 2)]);
    s = packed(s, { lineId: 'l1', qty: 2 });
    s = unwrap(saveBooking(s, U.tomas, D, setLineQty(s, get(s), 'l1', 1)));
    expect(prog(s, 'l1')).toMatchObject({ qty: 1, readyPacked: 1, extra: 1, toPack: 0 });
    expect(ship(s, [{ lineId: 'l1', qty: 2 }])).toMatchObject(invalid);
    s = unwrap(unpackLine(s, U.martin, D, 'o1', 'l1', { qty: 1 }));
    expect(prog(s, 'l1')).toMatchObject({ readyPacked: 1, extra: 0 });
  });

  it('an edit that adds work brings Zabaleno back to Balí se and alarms the warehouse', () => {
    let s = start([ln('l1', item('hazer'), 1)]);
    s = packed(s, { lineId: 'l1', qty: 1 });
    expect(get(s).status).toBe('packed');
    s = unwrap(saveBooking(s, U.tomas, D, setLineQty(s, get(s), 'l1', 2)));
    expect(get(s).status).toBe('packing');
    expect(s.notifications.some((n) => n.type === 'order_edited_after_packing')).toBe(true);
  });
});

describe('promised gear', () => {
  const withRental = () => start([ln('l1', item('ledbeam'), 10), ext()]);
  const skipped = () =>
    packed(withRental(), { lineId: 'l1', qty: 10 }, { lineId: 'e1', qty: 8, deferred: true });

  it('rentals may be left for the shipping, our own gear may not', () => {
    const s = withRental();
    expect(deferrableQty(s, get(s), line(s, 'e1'))).toBe(8);
    expect(deferrableQty(s, get(s), line(s, 'l1'))).toBe(0);
    expect(pack(s, { lineId: 'l1', qty: 1, deferred: true })).toMatchObject(invalid);
    expect(pack(s, { lineId: 'e1', qty: 9, deferred: true })).toMatchObject(invalid);
    expect(
      pack(s, { lineId: 'e1', qty: 5 }, { lineId: 'e1', qty: 4, deferred: true }),
    ).toMatchObject(invalid);
    const k = skipped();
    expect(get(k).status).toBe('packed');
    expect(prog(k, 'e1')).toMatchObject({ toPack: 0, readyDeferred: 8 });
    expect(k.notifications.find((n) => n.type === 'order_packed')?.params.promised).toBe(
      '8× AX9 rental (Astera Rent)',
    );
    const back = unwrap(unpackLine(k, U.martin, D, 'o1', 'e1', { deferred: true }));
    expect(prog(back, 'e1')).toMatchObject({ toPack: 8, readyDeferred: 0 });
  });

  it('a rental that is already here is packed like anything else', () => {
    const s = packed(withRental(), { lineId: 'e1', qty: 8 });
    expect(prog(s, 'e1')).toMatchObject({ readyPacked: 8, toPack: 0 });
  });

  it('pieces missing because of an accepted conflict may be left, only as many as are short', () => {
    let s = withBookings(
      baseState(),
      order({ id: 'o0', lines: [ln('l1', item('ledbeam'), 10)] }),
      order({ id: 'o1', status: 'packing', lines: [ln('l1', item('ledbeam'), 4)] }, 2),
    );
    expect(deferrableQty(s, get(s), line(s, 'l1'))).toBe(0);
    s = {
      ...s,
      conflicts: [
        {
          id: 'c1',
          bookingId: 'o1',
          lineId: 'l1',
          target: { itemId: 'ledbeam' },
          warehouseId: W.brod,
          shortQty: 2,
          days: [D],
          collidingBookingIds: ['o0'],
          status: 'new',
          source: 'override',
          overrideReason: 'vrátí 2 dřív',
          createdOn: T,
        },
      ],
    };
    expect(acceptedConflicts(s, 'o1', 'l1')).toHaveLength(1);
    expect(pack(s, { lineId: 'l1', qty: 3, deferred: true })).toMatchObject(invalid);
    s = packed(s, { lineId: 'l1', qty: 2 }, { lineId: 'l1', qty: 2, deferred: true });
    expect(prog(s, 'l1')).toMatchObject({ readyPacked: 2, readyDeferred: 2, toPack: 0 });
    expect(packingList(s, 'o1')!.byWarehouse[0]!.groups[0]!.lines[0]!.conflicts).toEqual([
      { short: 2, reason: 'vrátí 2 dřív', colliding: ['o0'] },
    ]);
    s = shipped(s, [
      { lineId: 'l1', qty: 2 },
      { lineId: 'l1', qty: 2, deferred: true },
    ]);
    expect(get(s).status).toBe('shipped');
    expect(returnSheet(s, 'o1')[0]?.shipped).toBe(4);
  });

  it('a promised case needs its number and check when it is shipped', () => {
    let s = start([ln('l1', caseT('ct-ax9'), 1)]);
    s = {
      ...s,
      conflicts: [
        {
          id: 'c1',
          bookingId: 'o1',
          lineId: 'l1',
          target: caseT('ct-ax9'),
          warehouseId: W.brod,
          shortQty: 1,
          days: [D],
          collidingBookingIds: [],
          status: 'new',
          source: 'override',
          overrideReason: 'x',
          createdOn: T,
        },
      ],
    };
    s = packed(s, { lineId: 'l1', qty: 1, deferred: true });
    const l = { lineId: 'l1', qty: 1, deferred: true, caseIds: ['case-1'] };
    expect(ship(s, [l])).toMatchObject(invalid);
    s = shipped(s, [{ ...l, caseChecks: standardCaseChecks(s, ['case-1']) }]);
    expect(get(s).status).toBe('shipped');
    expect(returnSheet(s, 'o1')[0]?.pendingCaseIds).toEqual(['case-1']);
  });

  it('the van leaves without it: written into the conversation with a note, PM and Chief warned', () => {
    let s = shipped(skipped(), [{ lineId: 'l1', qty: 10 }], 'Astera dorazí rovnou na místo');
    expect(get(s).status).toBe('packed');
    const ev = s.messages.find((m) => m.event?.type === 'shipped_without')!.event!;
    expect(ev.params).toEqual({
      what: '8× AX9 rental (Astera Rent)',
      note: 'Astera dorazí rovnou na místo',
    });
    const warned = s.notifications.filter((n) => n.type === 'promised_missing');
    expect(warned.map((n) => n.userId).sort()).toEqual([U.jana.id, U.tomas.id].sort());
    // part of it comes later, the same gap is not repeated
    s = shipped(s, [{ lineId: 'e1', qty: 5, deferred: true }]);
    expect(events(s).filter((e) => e === 'promised_arrived')).toHaveLength(1);
    expect(promisedText(openPromises(s, get(s)))).toBe('3× AX9 rental (Astera Rent)');
    s = shipped(s, [{ lineId: 'e1', qty: 3, deferred: true }]);
    expect(get(s).status).toBe('shipped');
    expect(openPromises(s, get(s))).toEqual([]);
    expect(events(s).at(-1)).toBe('promised_arrived');
    expect(returnSheet(s, 'o1').find((x) => x.lineId === 'e1')?.shipped).toBe(8);
  });

  it('the same gap is not written again with every van', () => {
    let s = packed(
      withRental(),
      { lineId: 'l1', qty: 10 },
      { lineId: 'e1', qty: 8, deferred: true },
    );
    s = shipped(s, [{ lineId: 'l1', qty: 4 }]);
    s = shipped(s, [{ lineId: 'l1', qty: 6 }]);
    expect(events(s).filter((e) => e === 'shipped_without')).toHaveLength(1);
  });

  it('it will never come: closed with a reason, whole or only the rest', () => {
    const s = shipped(skipped(), [{ lineId: 'l1', qty: 10 }]);
    expect(closePromised(s, U.martin, D, 'o1', 'e1', ' ')).toMatchObject(invalid);
    expect(closePromised(s, U.lucie, D, 'o1', 'e1', 'x')).toMatchObject({
      error: { code: 'forbidden' },
    });
    expect(closePromised(s, U.martin, D, 'o1', 'l1', 'x')).toMatchObject({
      error: { code: 'invalid_state' },
    });
    const whole = unwrap(closePromised(s, U.martin, D, 'o1', 'e1', 'Astera zrušila'));
    expect(line(whole, 'e1')).toMatchObject({ status: 'missing', note: 'Astera zrušila' });
    expect(get(whole).status).toBe('shipped');
    expect(events(whole).at(-1)).toBe('promised_closed');
    const part = shipped(s, [{ lineId: 'e1', qty: 5, deferred: true }]);
    const rest = unwrap(closePromised(part, U.tomas, D, 'o1', 'e1', 'zbytek nemají'));
    expect(line(rest, 'e1')).toMatchObject({ qty: 5, status: 'ok' });
    expect(get(rest).status).toBe('shipped');
  });
});

describe('gear coming straight from another event', () => {
  const planned = (want: number, sent = 8) => {
    let s = withBookings(
      baseState(),
      order({
        id: 'a',
        status: 'packing',
        periods: [P('2027-04-20', '2027-04-21')],
        lines: [ln('l1', item('ledbeam'), sent)],
      }),
      order(
        {
          id: 'o1',
          status: 'packing',
          lines: [
            ln('t1', item('ledbeam'), want, { fromBookingId: 'a' }),
            ln('l2', item('hazer'), 1),
          ],
        },
        2,
      ),
    );
    s = unwrap(
      packAndShip(s, U.martin, T, 'a', { label: 'x', lines: [{ lineId: 'l1', qty: sent }] }),
    );
    return s;
  };

  it('is promised by itself, never packed here, and does not hold the status', () => {
    let s = planned(8);
    expect(openPromises(s, get(s)).map((p) => [p.kind, p.qty, p.from])).toEqual([
      ['transfer', 8, 'a'],
    ]);
    expect(pack(s, { lineId: 't1', qty: 8 })).toMatchObject(invalid);
    s = packed(s, { lineId: 'l2', qty: 1 });
    expect(get(s).status).toBe('packed');
    s = shipped(s, [{ lineId: 'l2', qty: 1 }]);
    expect(get(s).status).toBe('shipped');
    // written down, but a planned handover is no alarm
    expect(events(s)).toContain('shipped_without');
    expect(s.notifications.some((n) => n.type === 'promised_missing')).toBe(false);
  });

  it('a whole handover is confirmed from here, a partial one in the other vratka', () => {
    const s = planned(8);
    expect(handoverOf(s, get(s), line(s, 't1'))).toMatchObject({ outstanding: 8, whole: true });
    const done = unwrap(confirmHandover(s, U.martin, D, 'o1', 't1'));
    expect(openPromises(done, get(done))).toEqual([]);
    expect(returnSheet(done, 'a')[0]).toMatchObject({ transferred: 8, outcome: 'transferred' });
    expect(done.issues).toEqual([]);
    const part = planned(5);
    expect(handoverOf(part, get(part), line(part, 't1'))?.whole).toBe(false);
    expect(confirmHandover(part, U.martin, D, 'o1', 't1')).toMatchObject(invalid);
    expect(confirmHandover(s, U.martin, D, 'o1', 'l2')).toMatchObject({
      error: { code: 'not_found' },
    });
  });
});

describe('packed gear is not accessible', () => {
  it('cannot be borrowed, packed for another order, used to refill or opened', () => {
    let s = withBookings(
      baseState(),
      order({
        id: 'o1',
        status: 'packing',
        lines: [ln('l1', item('ax9'), 3), ln('l2', caseT('ct-ax9'), 1)],
      }),
      order({ id: 'o2', status: 'packing', lines: [ln('l1', caseT('ct-ax9'), 1)] }, 2),
    );
    const before = looseHere(s, 'ax9', W.brod, D);
    s = packed(
      s,
      { lineId: 'l1', qty: 3 },
      { lineId: 'l2', qty: 1, caseIds: ['case-1'], caseChecks: standardCaseChecks(s, ['case-1']) },
    );
    expect(looseHere(s, 'ax9', W.brod, D)).toBe(before - 3);
    expect(looseInHouse(s, 'ax9', W.brod)).toBe(before - 3);
    expect(
      createLoan(s, U.petr, D, { itemId: 'ax9', warehouseId: W.brod, qty: before - 2 }),
    ).toMatchObject(invalid);
    expect(casesHere(s, 'ax9', W.brod).map((c) => c.caseId)).toEqual(['case-2']);
    expect(casePlaces(s).get('case-1')).toEqual({ bookingId: 'o1', place: 'packed' });
    expect(
      packLines(s, U.martin, D, 'o2', [
        {
          lineId: 'l1',
          qty: 1,
          caseIds: ['case-1'],
          caseChecks: standardCaseChecks(s, ['case-1']),
        },
      ]),
    ).toMatchObject(invalid);
    expect(pack(s, { lineId: 'l1', qty: 1, fromCaseId: 'case-1' })).toMatchObject(invalid);
    expect(refillCase(s, U.martin, D, 'case-1')).toMatchObject({
      error: { code: 'invalid_state' },
    });
    s = shipped(s, [{ lineId: 'l2', qty: 1, caseIds: ['case-1'] }]);
    expect(casePlaces(s).get('case-1')?.place).toBe('out');
    expect(looseHere(s, 'ax9', W.brod, D)).toBe(before - 3);
  });

  it('is taken from the day it was packed, also before the booked days', () => {
    let s = start([ln('l1', item('ledbeam'), 10)]);
    const free = (d: string) => itemDay(s, buildHoldIndex(s), 'ledbeam', W.brod, d).free;
    expect([free(T), free('2027-04-21'), free(D)]).toEqual([12, 12, 2]);
    s = unwrap(packLines(s, U.martin, T, 'o1', [{ lineId: 'l1', qty: 10 }]));
    expect([free(T), free('2027-04-21'), free(D)]).toEqual([2, 2, 2]);
    // another order on those days gets short
    const other = bk({ id: 'p', periods: [P(T, T)], lines: [ln('l1', item('ledbeam'), 5)] });
    expect(evaluateBooking(withBookings(s, other), other).get('l1')).toMatchObject({
      badge: 'red',
      short: 3,
      collidingBookingIds: ['o1'],
    });
    s = unwrap(unpackLine(s, U.martin, T, 'o1', 'l1'));
    expect(free(T)).toBe(12);
  });
});

describe('reminders and older data', () => {
  it('loading is announced for a packed order; a partly shipped one is reminded when overdue', () => {
    let s = start([ln('l1', item('hazer'), 1), ext()]);
    s = unwrap(
      packLines(s, U.martin, T, 'o1', [
        { lineId: 'l1', qty: 1 },
        { lineId: 'e1', qty: 8, deferred: true },
      ]),
    );
    expect(runDailyJobs(s, '2027-04-21').notifications.map((n) => n.type)).toContain(
      'upcoming_loading',
    );
    s = shipped(s, [{ lineId: 'l1', qty: 1 }]);
    expect(runDailyJobs(s, '2027-04-27').notifications.map((n) => n.type)).toContain(
      'overdue_return',
    );
  });

  it('orders shipped before packing was recorded count as packed', () => {
    let s: AppState = { ...emptyState(), ...start([ln('l1', item('ledbeam'), 10)]) };
    s = {
      ...s,
      shipments: [
        {
          id: 'x',
          bookingId: 'o1',
          label: 'a',
          shippedOn: D,
          userId: U.martin.id,
          lines: [{ lineId: 'l1', qty: 6 }],
        },
      ],
    };
    s = { ...s, packings: packingsFromShipments(s.shipments) };
    expect(prog(s, 'l1')).toEqual({
      qty: 10,
      shipped: 6,
      toPack: 4,
      readyPacked: 0,
      readyDeferred: 0,
      extra: 0,
    });
    expect(statusAfter(s, get(s))).toBe('packing');
    s = packed(s, { lineId: 'l1', qty: 4 });
    expect(prog(s, 'l1')).toMatchObject({ readyPacked: 4, toPack: 0 });
    s = shipped(s, [{ lineId: 'l1', qty: 4 }]);
    expect(get(s).status).toBe('shipped');
    const r = recordReturnSession(s, U.martin, '2027-04-26', 'o1', {
      lines: [
        { lineId: 'l1', returnedQty: 10, condition: 'ok', confirmed: true, locationId: 'loc-b-a1' },
      ],
    });
    expect(get(unwrap(r)).status).toBe('returned');
  });
});
