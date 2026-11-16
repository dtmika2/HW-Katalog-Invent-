/**
 * The concept's model scenario "Gala Dinner, 24 Apr 2027", run end to end through the public API.
 * (The fixtures package has the full-size version used by the prototype.)
 */
import { describe, expect, it } from 'vitest';
import {
  ackConflict,
  addLine,
  buildHoldIndex,
  caseDay,
  completeAsStandard,
  confirmBooking,
  coverWithExternal,
  createBooking,
  detectConflicts,
  evaluateBooking,
  openServiceCase,
  packingList,
  periodWithBuffer,
  recalcBooking,
  recordReturnSession,
  returnSheet,
  runDailyJobs,
  saveBooking,
  setServiceStatus,
  shipBatch,
  startPacking,
  submitPrebooking,
  unwrap,
  type AppState,
  type Booking,
  type Connection,
} from '../src';
import { baseState, caseT, ln, L, order, P, U, W, withBookings } from './helpers';

const get = (s: AppState, id: string) => s.bookings.find((b) => b.id === id) as Booking;
const put = (s: AppState, b: Booking): AppState => ({
  ...s,
  bookings: s.bookings.map((x) => (x.id === b.id ? b : x)),
});

function galaCatalog(): AppState {
  const s = baseState();
  const it = (id: string, name: string, priceDay: number) => ({
    id,
    name,
    manufacturer: 'X',
    model: name,
    categoryId: 'cat',
    priceDay,
    returnable: true,
    archived: false,
  });
  s.items.push(
    it('dlive', 'Allen & Heath dLive S5000', 6000),
    it('dlivepower', 'dLive power cable', 50),
    it('cat', 'CAT6 cable 50 m', 80),
    it('router', 'Router', 200),
    it('dx168', 'DX168 stagebox', 1500),
    it('multicore', 'Multicore 30 m', 300),
  );
  for (const [itemId, qty] of [
    ['dlive', 2],
    ['dlivepower', 3],
    ['cat', 10],
    ['router', 3],
    ['dx168', 2],
    ['multicore', 2],
  ] as const) {
    s.stock.push({ itemId, warehouseId: W.brod, qty, homeLocationId: L.brodA });
  }
  s.caseTypes.push({
    id: 'ct-stagebox',
    name: 'Stagebox case',
    contents: [
      { itemId: 'dx168', qty: 1 },
      { itemId: 'multicore', qty: 1 },
    ],
  });
  s.cases.push({
    id: 'case-sb1',
    caseTypeId: 'ct-stagebox',
    number: 'SB-01',
    warehouseId: W.brod,
    locationId: L.brodB,
    contents: [
      { itemId: 'dx168', qty: 1 },
      { itemId: 'multicore', qty: 1 },
    ],
  });
  const req = (id: string, from: string, to: string): Connection => ({
    id,
    fromItemId: from,
    target: { itemId: to },
    kind: 'required',
    rule: 'once_per_order',
    qty: 1,
  });
  s.connections.push(
    req('g1', 'dlive', 'dlivepower'),
    req('g2', 'dlive', 'cat'),
    req('g3', 'dlive', 'router'),
  );
  // Firemní den (Jana) holds one AX9 case on 23–25 Apr; Lucie's May order uses both Brod cases.
  return withBookings(
    s,
    order(
      {
        id: 'firemni',
        eventName: 'Firemní den',
        pmId: U.jana.id,
        periods: [P('2027-04-24', '2027-04-24', '2027-04-23', '2027-04-25')],
        lines: [ln('l1', caseT('ct-ax9'), 1)],
      },
      1,
    ),
    order(
      {
        id: 'may',
        eventName: 'Květnový festival',
        pmId: U.lucie.id,
        periods: [P('2027-05-15', '2027-05-16', '2027-05-14', '2027-05-17')],
        lines: [ln('l1', caseT('ct-ax9'), 2)],
      },
      2,
    ),
  );
}

describe('scenario: Gala Dinner, 24 Apr 2027', () => {
  it('runs end to end as described in the concept', () => {
    let s = galaCatalog();
    // Karlák's case is incomplete, so only the Brod cases count.
    s.cases.find((c) => c.id === 'case-3')!.contents[2]!.qty = 0;

    // 1. Petr creates a pre-booking for client X with event, loading and return dates.
    const created = unwrap(
      createBooking(s, U.petr, '2027-04-10', {
        id: 'gala',
        eventName: 'Gala Dinner',
        clientId: 'cl-1',
        purposeMessage: 'Gala, 200 hostů',
        periods: [periodWithBuffer('2027-04-24', '2027-04-24', s.settings)],
      }),
    );
    s = created.state;
    expect(get(s, 'gala').periods[0]).toMatchObject({
      bookedFrom: '2027-04-23',
      bookedUntil: '2027-04-25',
    });

    // 2. He adds 2× AX9 case, a digital desk and a stagebox case.
    let gala = get(s, 'gala');
    gala = addLine(s, gala, { caseTypeId: 'ct-ax9' }, 2);
    gala = addLine(s, gala, { itemId: 'dlive' }, 1);
    gala = addLine(s, gala, { caseTypeId: 'ct-stagebox' }, 1);
    s = unwrap(saveBooking(s, U.petr, '2027-04-10', gala));
    gala = get(s, 'gala');

    // 3. The engine adds desk power, CAT cable and router, and shows the check for PowerCON cables.
    const auto = gala.lines
      .filter((l) => l.origin === 'auto')
      .map((l) => ('itemId' in l.target ? l.target.itemId : ''));
    expect(auto.sort()).toEqual(['cat', 'dlivepower', 'router']);
    const { expansion } = recalcBooking(s, gala);
    expect(expansion.checkWarnings.map((w) => w.fromItemId)).toEqual(['ax9']);

    // 4. One AX9 case is held by another order: the line is red, short 1 case, held by Firemní den (Jana).
    const conflicts = detectConflicts(s, gala);
    expect(conflicts).toHaveLength(1);
    const ax9Line = gala.lines.find(
      (l) => 'caseTypeId' in l.target && l.target.caseTypeId === 'ct-ax9',
    )!;
    expect(conflicts[0]).toMatchObject({ lineId: ax9Line.id, short: 1 });
    expect(conflicts[0]!.colliding).toEqual([
      expect.objectContaining({
        eventName: 'Firemní den',
        pmId: U.jana.id,
        from: '2027-04-23',
        to: '2027-04-25',
      }),
    ]);

    // 5. Petr acknowledges and submits; the Chief covers 8× AX9 externally and confirms.
    expect(submitPrebooking(s, U.petr, '2027-04-11', 'gala')).toMatchObject({
      ok: false,
      error: { code: 'conflict_unacknowledged' },
    });
    s = put(s, ackConflict(gala, ax9Line.id));
    s = unwrap(submitPrebooking(s, U.petr, '2027-04-11', 'gala'));
    gala = coverWithExternal(s, get(s, 'gala'), ax9Line.id, 1, {
      supplier: 'Rent AV',
      pickup: '2027-04-23',
      returnDate: '2027-04-25',
    });
    const extLine = gala.lines.find((l) => 'external' in l.target)!;
    expect(extLine.qty).toBe(8);
    s = unwrap(saveBooking(s, U.tomas, '2027-04-12', gala));
    s = unwrap(confirmBooking(s, U.tomas, '2027-04-12', 'gala'));
    expect(get(s, 'gala')).toMatchObject({ type: 'order', status: 'confirmed' });
    expect(s.conflicts).toHaveLength(0);
    expect(caseDay(s, buildHoldIndex(s), 'ct-ax9', W.brod, '2027-04-24').free).toBe(0);

    // 6. Warehouse packs: cases as whole cases, loose items by shelf, externals separately.
    s = unwrap(startPacking(s, U.martin, '2027-04-22', 'gala'));
    const pl = packingList(s, 'gala')!;
    expect(pl.external.map((l) => l.qty)).toEqual([8]);
    gala = get(s, 'gala');
    const lineOf = (pred: (t: Booking['lines'][number]['target']) => boolean) =>
      gala.lines.find((l) => pred(l.target))!;
    const sbLine = lineOf((t) => 'caseTypeId' in t && t.caseTypeId === 'ct-stagebox');
    // Van 1 the day before: the AX9 case and the stagebox case.
    s = unwrap(
      shipBatch(s, U.martin, '2027-04-23', 'gala', {
        label: 'Dodávka 1',
        lines: [
          { lineId: ax9Line.id, qty: 1, caseIds: ['case-2'] },
          { lineId: sbLine.id, qty: 1, caseIds: ['case-sb1'] },
        ],
      }),
    );
    // 7. The PM is notified after each batch, with what went and what is missing.
    const n1 = s.notifications.filter((n) => n.type === 'batch_shipped' && n.userId === U.petr.id);
    expect(n1.at(-1)?.params).toMatchObject({ label: 'Dodávka 1', shipped: 2, remaining: 12 });
    // Van 2 on the morning of the event: everything else.
    const rest = get(s, 'gala').lines.filter((l) => l.id !== ax9Line.id && l.id !== sbLine.id);
    s = unwrap(
      shipBatch(s, U.martin, '2027-04-24', 'gala', {
        label: 'Dodávka 2',
        lines: rest.map((l) => ({ lineId: l.id, qty: l.qty })),
      }),
    );
    expect(
      s.notifications.filter((n) => n.type === 'batch_shipped' && n.userId === U.petr.id).at(-1)
        ?.params,
    ).toMatchObject({ remaining: 0 });

    // 8. Vratka: AX9 case complete as standard, externals back to the supplier, one desk power cable short.
    const sheet = returnSheet(s, 'gala');
    const powerLine = gala.lines.find(
      (l) => 'itemId' in l.target && l.target.itemId === 'dlivepower',
    )!;
    s = unwrap(
      recordReturnSession(s, U.martin, '2027-04-25', 'gala', {
        lines: sheet.map((l) => {
          if (l.kind === 'case')
            return completeAsStandard(s, l.lineId, l.pendingCaseIds[0]!, L.brodB);
          if (l.kind === 'external')
            return {
              lineId: l.lineId,
              returnedQty: l.shipped,
              confirmed: true,
              condition: 'ok' as const,
              returnedToSupplier: true,
            };
          if (l.lineId === powerLine.id)
            return {
              lineId: l.lineId,
              returnedQty: 0,
              confirmed: true,
              condition: 'ok' as const,
              note: 'Zůstal v sále',
            };
          return {
            lineId: l.lineId,
            returnedQty: l.shipped,
            confirmed: true,
            condition: 'ok' as const,
            locationId: L.brodA,
          };
        }),
      }),
    );
    expect(get(s, 'gala').status).toBe('returned_with_issues');
    expect(s.issues).toEqual([
      expect.objectContaining({ type: 'missing', itemId: 'dlivepower', qty: 1, bookingId: 'gala' }),
    ]);
    expect(returnSheet(s, 'gala').find((l) => l.kind === 'external')?.outcome).toBe('supplier');

    // 9. One AX9 doesn't work → service case (internal, Karel, back in 14 days). Unavailable immediately;
    //    Lucie's May order is short now and she is notified.
    const svc = unwrap(
      openServiceCase(s, U.martin, '2027-04-26', {
        itemId: 'ax9',
        warehouseId: W.brod,
        qty: 1,
        reason: 'Nesvítí',
        internal: true,
        responsibleUserId: U.karel.id,
        expectedBack: '2027-05-10',
        caseId: 'case-2',
      }),
    );
    s = svc.state;
    expect(caseDay(s, buildHoldIndex(s), 'ct-ax9', W.brod, '2027-05-15').completeCases).toBe(1);
    expect(evaluateBooking(s, get(s, 'may')).get('l1')).toMatchObject({ badge: 'red', short: 1 });
    expect(
      s.notifications.some((n) => n.type === 'service_affects_order' && n.userId === U.lucie.id),
    ).toBe(true);
    expect(s.conflicts).toEqual([
      expect.objectContaining({ bookingId: 'may', source: 'detected', status: 'new' }),
    ]);

    // 10. After 14 days it is not released automatically; Karel sets "Opraveno" and it returns to stock.
    s = runDailyJobs(s, '2027-05-11').state;
    expect(
      s.notifications.some((n) => n.type === 'service_overdue' && n.userId === U.karel.id),
    ).toBe(true);
    expect(s.serviceCases[0]!.status).toBe('reported');
    expect(caseDay(s, buildHoldIndex(s), 'ct-ax9', W.brod, '2027-05-15').completeCases).toBe(1);
    s = unwrap(
      setServiceStatus(s, U.karel, '2027-05-11', svc.serviceCaseId, 'fixed', {
        comment: 'Otestováno',
      }),
    );
    expect(caseDay(s, buildHoldIndex(s), 'ct-ax9', W.brod, '2027-05-15').completeCases).toBe(2);
    expect(evaluateBooking(s, get(s, 'may')).get('l1')?.badge).toBe('green');
    expect(s.conflicts[0]?.status).toBe('resolved');
  });
});
