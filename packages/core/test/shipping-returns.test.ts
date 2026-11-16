import { describe, expect, it } from 'vitest';
import {
  addLinesAfterShipping,
  buildHoldIndex,
  completeAsStandard,
  isCaseComplete,
  itemDay,
  looseStock,
  packingList,
  recordReturnSession,
  refillTasks,
  remainingToShip,
  returnSheet,
  shipBatch,
  stockQty,
  unwrap,
  type AppState,
  type Booking,
  type ReturnLineInput,
} from '../src';
import { baseState, caseT, item, L, ln, order, P, U, W, withBookings } from './helpers';

const T = '2027-04-22';
const R = '2027-04-26';
const get = (s: AppState, id: string) => s.bookings.find((b) => b.id === id) as Booking;
const ret = (
  lineId: string,
  returnedQty: number,
  extra: Partial<ReturnLineInput> = {},
): ReturnLineInput => ({
  lineId,
  returnedQty,
  confirmed: true,
  condition: 'ok',
  locationId: L.brodA,
  ...extra,
});

function packing(lines = [ln('l1', item('ledbeam'), 10), ln('l2', item('hazer'), 1)]) {
  return withBookings(baseState(), order({ id: 'o1', status: 'packing', lines }));
}

function shippedAll(
  s: AppState,
  lines: { lineId: string; qty: number; caseIds?: string[]; fromCaseId?: string }[],
) {
  return unwrap(shipBatch(s, U.martin, T, 'o1', { label: 'Dodávka 1', lines }));
}

describe('packing and shipping', () => {
  it('packing list is flat per warehouse, grouped by location, cases with contents', () => {
    const s = packing([
      ln('l1', item('ledbeam'), 2),
      ln('l2', caseT('ct-ax9'), 1),
      ln('l3', item('ledbeam'), 1, { sourceWarehouseId: W.karlak }),
    ]);
    const pl = packingList(s, 'o1')!;
    expect(pl.byWarehouse.map((w) => w.warehouseId).sort()).toEqual([W.brod, W.karlak].sort());
    const brod = pl.byWarehouse.find((w) => w.warehouseId === W.brod)!;
    const caseLine = brod.groups.flatMap((g) => g.lines).find((l) => l.kind === 'case')!;
    expect(caseLine.contents).toHaveLength(3);
    expect(caseLine.candidateCases?.map((c) => c.number)).toEqual(['AX9-01', 'AX9-02']);
    expect(brod.groups.map((g) => g.locationId)).toEqual([L.brodA, L.brodB]);
  });

  it('a partly shipped order still has pieces to ship (stays on the packing list)', () => {
    const s0 = packing();
    expect(remainingToShip(s0, 'o1')).toBe(11);
    const s1 = shippedAll(s0, [{ lineId: 'l1', qty: 6 }]);
    expect(remainingToShip(s1, 'o1')).toBe(5);
    const s2 = unwrap(
      shipBatch(s1, U.martin, T, 'o1', {
        label: 'Dodávka 2',
        lines: [
          { lineId: 'l1', qty: 4 },
          { lineId: 'l2', qty: 1 },
        ],
      }),
    );
    expect(remainingToShip(s2, 'o1')).toBe(0);
  });

  it('ships in two batches and notifies PM and Chief with what is missing', () => {
    const s1 = shippedAll(packing(), [{ lineId: 'l1', qty: 6 }]);
    expect(get(s1, 'o1').status).toBe('shipped');
    expect(
      s1.notifications
        .filter((n) => n.type === 'batch_shipped')
        .map((n) => [n.userId, n.params.remaining]),
    ).toEqual([
      [U.petr.id, 5],
      [U.tomas.id, 5],
    ]);
    const s2 = unwrap(
      shipBatch(s1, U.martin, '2027-04-23', 'o1', {
        label: 'Dodávka 2',
        lines: [
          { lineId: 'l1', qty: 4 },
          { lineId: 'l2', qty: 1 },
        ],
      }),
    );
    expect(s2.shipments.map((x) => x.label)).toEqual(['Dodávka 1', 'Dodávka 2']);
    expect(
      packingList(s2, 'o1')!
        .byWarehouse[0]!.groups.flatMap((g) => g.lines)
        .every((l) => l.remaining === 0),
    ).toBe(true);
  });

  it('rejects over-shipping, missing case numbers and wrong roles', () => {
    const s = packing([ln('l1', item('ledbeam'), 2), ln('l2', caseT('ct-ax9'), 1)]);
    expect(
      shipBatch(s, U.martin, T, 'o1', { label: 'x', lines: [{ lineId: 'l1', qty: 3 }] }),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(
      shipBatch(s, U.martin, T, 'o1', { label: 'x', lines: [{ lineId: 'l2', qty: 1 }] }),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(
      shipBatch(s, U.tomas, T, 'o1', { label: 'x', lines: [{ lineId: 'l1', qty: 1 }] }),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(
      shipBatch(s, U.martin, T, 'o1', { label: ' ', lines: [{ lineId: 'l1', qty: 1 }] }),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('a case already out on another order cannot be shipped', () => {
    let s = withBookings(
      baseState(),
      order({ id: 'o0', status: 'packing', lines: [ln('l1', caseT('ct-ax9'), 1)] }),
      order({ id: 'o1', status: 'packing', lines: [ln('l1', caseT('ct-ax9'), 1)] }, 2),
    );
    s = unwrap(
      shipBatch(s, U.martin, T, 'o0', {
        label: 'a',
        lines: [{ lineId: 'l1', qty: 1, caseIds: ['case-1'] }],
      }),
    );
    expect(
      shipBatch(s, U.martin, T, 'o1', {
        label: 'b',
        lines: [{ lineId: 'l1', qty: 1, caseIds: ['case-1'] }],
      }),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(
      packingList(s, 'o1')!.byWarehouse[0]!.groups[0]!.lines[0]!.candidateCases?.find(
        (c) => c.caseId === 'case-1',
      )?.busy,
    ).toBe(true);
  });

  it('lines added after shipping go back to packing with a high-priority notification', () => {
    const s1 = shippedAll(packing([ln('l1', item('hazer'), 2), ln('l2', item('lamp'), 1)]), [
      { lineId: 'l1', qty: 2 },
      { lineId: 'l2', qty: 1 },
    ]);
    expect(
      addLinesAfterShipping(s1, U.petr, T, 'o1', [ln('l9', item('powercon'), 2)]),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const s2 = unwrap(addLinesAfterShipping(s1, U.tomas, T, 'o1', [ln('l9', item('powercon'), 2)]));
    const b = get(s2, 'o1');
    expect(b).toMatchObject({ status: 'packing', editedAfterShipping: true });
    expect(b.lines.find((l) => l.id === 'l9')?.addedAfterShipping).toBe(true);
    const n = s2.notifications.filter((x) => x.type === 'order_edited_after_packing');
    expect(n.length).toBe(2);
    expect(n.every((x) => x.highPriority)).toBe(true);
    const pl = packingList(s2, 'o1')!.byWarehouse[0]!.groups.flatMap((g) => g.lines);
    expect(pl.filter((l) => l.remaining > 0).map((l) => l.lineId)).toEqual(['l9']);
  });

  it('consumables reduce stock on shipping and are skipped in vratka', () => {
    const s1 = shippedAll(packing([ln('l1', item('tape'), 5)]), [{ lineId: 'l1', qty: 5 }]);
    expect(stockQty(s1, 'tape', W.brod)).toBe(15);
    expect(returnSheet(s1, 'o1')[0]?.outcome).toBe('consumable');
    expect(recordReturnSession(s1, U.martin, R, 'o1', { lines: [ret('l1', 0)] })).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(itemDay(s1, buildHoldIndex(s1), 'tape', W.brod, '2027-04-23').hardHeld).toBe(0);
  });
});

describe('vratka', () => {
  const shipped = () =>
    shippedAll(packing(), [
      { lineId: 'l1', qty: 8 },
      { lineId: 'l2', qty: 1 },
    ]);

  it('the return sheet lists shipped quantities, not ordered ones', () => {
    const sheet = returnSheet(shipped(), 'o1');
    expect(sheet.find((l) => l.lineId === 'l1')).toMatchObject({
      shipped: 8,
      outstanding: 8,
      outcome: 'pending',
      suggestedLocationId: L.brodA,
    });
  });

  it('every line needs confirmation; a note is required when short or damaged', () => {
    const s = shipped();
    expect(
      recordReturnSession(s, U.martin, R, 'o1', { lines: [ret('l1', 8, { confirmed: false })] }),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(recordReturnSession(s, U.martin, R, 'o1', { lines: [ret('l1', 6)] })).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(
      recordReturnSession(s, U.martin, R, 'o1', {
        lines: [ret('l1', 8, { condition: 'damaged' })],
      }),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(
      recordReturnSession(s, U.martin, R, 'o1', { lines: [ret('l1', 9, { note: 'x' })] }),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(
      recordReturnSession(s, U.martin, R, 'o1', {
        lines: [ret('l1', 8, { locationId: undefined })],
      }),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(recordReturnSession(s, U.tomas, R, 'o1', { lines: [ret('l1', 8)] })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('complete return → returned; stock is free again', () => {
    const s = unwrap(
      recordReturnSession(shipped(), U.martin, R, 'o1', { lines: [ret('l1', 8), ret('l2', 1)] }),
    );
    expect(get(s, 'o1').status).toBe('returned');
    expect(returnSheet(s, 'o1').map((l) => l.outcome)).toEqual(['complete', 'complete']);
    expect(itemDay(s, buildHoldIndex(s), 'ledbeam', W.brod, '2027-04-23').hardHeld).toBe(0);
  });

  it('short → Issue and returned_with_issues; Chief and PM notified', () => {
    const s = unwrap(
      recordReturnSession(shipped(), U.martin, R, 'o1', {
        lines: [ret('l1', 6, { note: 'Chybí 2 kusy' }), ret('l2', 1)],
      }),
    );
    expect(get(s, 'o1').status).toBe('returned_with_issues');
    expect(s.issues).toEqual([
      expect.objectContaining({
        type: 'missing',
        itemId: 'ledbeam',
        qty: 2,
        lineId: 'l1',
        warehouseId: W.brod,
      }),
    ]);
    expect(
      s.notifications
        .filter((n) => n.type === 'returned_with_issues')
        .map((n) => n.userId)
        .sort(),
    ).toEqual([U.petr.id, U.tomas.id].sort());
    expect(itemDay(s, buildHoldIndex(s), 'ledbeam', W.brod, '2027-05-10').hardHeld).toBe(2);
  });

  it('damaged → service case (reported); pieces out of service', () => {
    const s = unwrap(
      recordReturnSession(shipped(), U.martin, R, 'o1', {
        lines: [
          ret('l1', 8, { condition: 'damaged', damagedQty: 1, note: 'Nesvítí' }),
          ret('l2', 1),
        ],
      }),
    );
    expect(s.serviceCases).toEqual([
      expect.objectContaining({
        itemId: 'ledbeam',
        qty: 1,
        status: 'reported',
        reason: 'Nesvítí',
        openedFromBookingId: 'o1',
        responsibleUserId: U.karel.id,
      }),
    ]);
    expect(get(s, 'o1').status).toBe('returned');
    expect(itemDay(s, buildHoldIndex(s), 'ledbeam', W.brod, '2027-05-10').free).toBe(11);
  });

  it('partial transfer 6 of 10 to booking B without touching the warehouse', () => {
    const b = order(
      {
        id: 'B',
        eventName: 'Event B',
        periods: [P('2027-04-28', '2027-04-29', '2027-04-27', '2027-04-30')],
      },
      5,
    );
    let s = withBookings(packing([ln('l1', item('ledbeam'), 10)]), b);
    s = shippedAll(s, [{ lineId: 'l1', qty: 10 }]);
    s = unwrap(
      recordReturnSession(s, U.martin, R, 'o1', {
        lines: [ret('l1', 4, { transferredToBookingId: 'B', transferredQty: 6 })],
      }),
    );
    expect(returnSheet(s, 'o1')[0]).toMatchObject({
      returned: 4,
      transferred: 6,
      outcome: 'complete',
    });
    expect(get(s, 'o1').status).toBe('returned');
    const bl = get(s, 'B').lines[0]!;
    expect(bl).toMatchObject({
      fromBookingId: 'o1',
      qty: 6,
      transferredOn: R,
      target: { itemId: 'ledbeam' },
    });
    expect(s.shipments.at(-1)).toMatchObject({
      bookingId: 'B',
      transferFromBookingId: 'o1',
      lines: [{ lineId: bl.id, qty: 6 }],
    });
    // held by B from the transfer day, without a gap until B ends
    for (const d of [R, '2027-04-27', '2027-04-30'])
      expect(itemDay(s, buildHoldIndex(s), 'ledbeam', W.brod, d).hardHeld).toBe(6);
    expect(
      s.messages.filter((m) => m.event?.type === 'transfer_out' || m.event?.type === 'transfer_in'),
    ).toHaveLength(2);
  });

  it('transfer target must be another active order', () => {
    const s = shipped();
    expect(
      recordReturnSession(s, U.martin, R, 'o1', {
        lines: [ret('l1', 0, { transferredToBookingId: 'o1', transferredQty: 8 })],
      }),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('a planned transfer line on B is shipped when the handover happens', () => {
    const b = order(
      {
        id: 'B',
        periods: [P('2027-04-28', '2027-04-29', '2027-04-27', '2027-04-30')],
        lines: [ln('b1', item('ledbeam'), 8, { fromBookingId: 'o1' })],
      },
      5,
    );
    let s = withBookings(packing([ln('l1', item('ledbeam'), 8)]), b);
    s = shippedAll(s, [{ lineId: 'l1', qty: 8 }]);
    s = unwrap(
      recordReturnSession(s, U.martin, R, 'o1', {
        lines: [ret('l1', 0, { transferredToBookingId: 'B', transferredQty: 8 })],
      }),
    );
    expect(get(s, 'B').lines).toHaveLength(1);
    expect(get(s, 'B').lines[0]).toMatchObject({ id: 'b1', qty: 8, transferredOn: R });
    expect(returnSheet(s, 'o1')[0]?.outcome).toBe('transferred');
  });

  it('return to the other warehouse moves the stock there', () => {
    const s = unwrap(
      recordReturnSession(shipped(), U.martin, R, 'o1', {
        lines: [ret('l1', 8, { locationId: L.karlakA }), ret('l2', 1)],
      }),
    );
    expect(stockQty(s, 'ledbeam', W.brod)).toBe(4);
    expect(stockQty(s, 'ledbeam', W.karlak)).toBe(12);
    expect(s.transfers).toEqual([
      expect.objectContaining({
        itemId: 'ledbeam',
        qty: 8,
        fromWarehouseId: W.brod,
        toWarehouseId: W.karlak,
        bookingId: 'o1',
      }),
    ]);
  });

  it('an unexpected item is logged as an issue', () => {
    const s = unwrap(
      recordReturnSession(shipped(), U.martin, R, 'o1', {
        lines: [],
        unexpected: [{ itemId: 'clamp', qty: 3, note: 'Z jiné akce' }],
      }),
    );
    expect(s.issues).toEqual([
      expect.objectContaining({ type: 'unexpected', itemId: 'clamp', qty: 3, bookingId: 'o1' }),
    ]);
    expect(get(s, 'o1').status).toBe('returning');
  });

  it('multiple return sessions: missing pieces returned later archive the issue', () => {
    let s = unwrap(recordReturnSession(shipped(), U.martin, R, 'o1', { lines: [ret('l2', 1)] }));
    expect(get(s, 'o1').status).toBe('returning');
    s = unwrap(
      recordReturnSession(s, U.martin, R, 'o1', {
        lines: [ret('l1', 5, { note: 'zbytek zítra' })],
      }),
    );
    expect(get(s, 'o1').status).toBe('returned_with_issues');
    s = unwrap(recordReturnSession(s, U.karel, '2027-04-27', 'o1', { lines: [ret('l1', 3)] }));
    expect(get(s, 'o1').status).toBe('returned');
    expect(s.issues[0]).toMatchObject({ archivedOn: '2027-04-27', resolutionKind: 'found' });
    expect(s.returnSessions).toHaveLength(3);
  });

  it('a piece taken out of a case is suggested back into it', () => {
    let s = packing([ln('l1', item('ax9'), 2)]);
    s = shippedAll(s, [{ lineId: 'l1', qty: 2, fromCaseId: 'case-1' }]);
    expect(isCaseComplete(s, s.cases[0]!)).toBe(false);
    expect(s.cases[0]!.incompleteSince).toBe(T);
    expect(returnSheet(s, 'o1')[0]?.suggestedIntoCaseId).toBe('case-1');
    s = unwrap(
      recordReturnSession(s, U.martin, R, 'o1', {
        lines: [ret('l1', 2, { locationId: L.brodB, intoCaseId: 'case-1' })],
      }),
    );
    expect(isCaseComplete(s, s.cases[0]!)).toBe(true);
    expect(refillTasks(s)).toHaveLength(0);
  });

  it('a case not refilled from vratka gets a refill task starting on the return day', () => {
    let s = packing([ln('l1', item('ax9'), 2)]);
    s = shippedAll(s, [{ lineId: 'l1', qty: 2, fromCaseId: 'case-1' }]);
    s = unwrap(recordReturnSession(s, U.martin, R, 'o1', { lines: [ret('l1', 2)] }));
    expect(refillTasks(s)).toEqual([
      { caseId: 'case-1', missing: [{ itemId: 'ax9', qty: 2 }], since: R },
    ]);
    expect(looseStock(s, 'ax9', W.brod)).toBe(6);
  });

  it('a case card is confirmed "complete as standard", one case at a time', () => {
    let s = packing([ln('l1', caseT('ct-ax9'), 2)]);
    s = shippedAll(s, [{ lineId: 'l1', qty: 2, caseIds: ['case-1', 'case-2'] }]);
    expect(returnSheet(s, 'o1')[0]).toMatchObject({
      kind: 'case',
      pendingCaseIds: ['case-1', 'case-2'],
      outstanding: 2,
    });
    s = unwrap(
      recordReturnSession(s, U.martin, R, 'o1', {
        lines: [completeAsStandard(s, 'l1', 'case-1', L.brodB)],
      }),
    );
    expect(get(s, 'o1').status).toBe('returning');
    // the second case is still held, the first one is free again
    expect(itemDay(s, buildHoldIndex(s), 'ax9', W.brod, '2027-04-23').hardHeld).toBe(8);
    s = unwrap(
      recordReturnSession(s, U.martin, R, 'o1', {
        lines: [completeAsStandard(s, 'l1', 'case-2', L.brodB)],
      }),
    );
    expect(get(s, 'o1').status).toBe('returned');
  });

  it('a case returned short stays incomplete and creates an issue', () => {
    let s = packing([ln('l1', caseT('ct-ax9'), 1)]);
    s = shippedAll(s, [{ lineId: 'l1', qty: 1, caseIds: ['case-1'] }]);
    const entry = completeAsStandard(s, 'l1', 'case-1', L.brodB);
    entry.caseContents = entry.caseContents!.map((c) =>
      c.itemId === 'charger' ? { ...c, qty: 7 } : c,
    );
    expect(recordReturnSession(s, U.martin, R, 'o1', { lines: [entry] })).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    s = unwrap(
      recordReturnSession(s, U.martin, R, 'o1', { lines: [{ ...entry, note: 'Chybí nabíječka' }] }),
    );
    expect(isCaseComplete(s, s.cases[0]!)).toBe(false);
    expect(s.issues).toEqual([
      expect.objectContaining({ type: 'missing', itemId: 'charger', qty: 1, caseId: 'case-1' }),
    ]);
    expect(get(s, 'o1').status).toBe('returned_with_issues');
  });

  it('damaged piece in a case opens a service case tied to the case', () => {
    let s = packing([ln('l1', caseT('ct-ax9'), 1)]);
    s = shippedAll(s, [{ lineId: 'l1', qty: 1, caseIds: ['case-1'] }]);
    const entry = completeAsStandard(s, 'l1', 'case-1', L.brodB);
    entry.caseContents = entry.caseContents!.map((c) =>
      c.itemId === 'ax9' ? { ...c, damagedQty: 1 } : c,
    );
    s = unwrap(
      recordReturnSession(s, U.martin, R, 'o1', { lines: [{ ...entry, note: 'AX9 nesvítí' }] }),
    );
    expect(s.serviceCases[0]).toMatchObject({ itemId: 'ax9', qty: 1, caseId: 'case-1' });
    expect(isCaseComplete(s, s.cases[0]!)).toBe(false);
  });

  it('a whole case missing is an issue that holds the case', () => {
    let s = packing([ln('l1', caseT('ct-ax9'), 1)]);
    s = shippedAll(s, [{ lineId: 'l1', qty: 1, caseIds: ['case-1'] }]);
    s = unwrap(
      recordReturnSession(s, U.martin, R, 'o1', {
        lines: [
          {
            lineId: 'l1',
            caseId: 'case-1',
            returnedQty: 0,
            confirmed: true,
            condition: 'ok',
            note: 'Zůstal na místě',
          },
        ],
      }),
    );
    expect(s.issues[0]).toMatchObject({ type: 'missing', caseId: 'case-1', qty: 1 });
    expect(returnSheet(s, 'o1')[0]?.outcome).toBe('missing');
    expect(itemDay(s, buildHoldIndex(s), 'ax9', W.brod, '2027-05-10').hardHeld).toBe(8);
  });

  it('external lines close as returned to supplier', () => {
    const ext = ln(
      'e1',
      {
        external: {
          name: 'AX9',
          itemId: 'ax9',
          supplier: 'Rent',
          pickup: '2027-04-21',
          returnDate: '2027-04-26',
        },
      },
      8,
    );
    let s = packing([ext]);
    s = shippedAll(s, [{ lineId: 'e1', qty: 8 }]);
    expect(
      recordReturnSession(s, U.martin, R, 'o1', {
        lines: [ret('e1', 8, { locationId: undefined })],
      }),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
    s = unwrap(
      recordReturnSession(s, U.martin, R, 'o1', {
        lines: [ret('e1', 8, { locationId: undefined, returnedToSupplier: true })],
      }),
    );
    expect(returnSheet(s, 'o1')[0]?.outcome).toBe('supplier');
    expect(get(s, 'o1').status).toBe('returned');
    expect(stockQty(s, 'ax9', W.brod)).toBe(20);
  });
});
