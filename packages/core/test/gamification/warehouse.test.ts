import { describe, expect, it } from 'vitest';
import {
  cancelPacking,
  computeLedger,
  packAndShip,
  packingBackItems,
  packLines,
  recordReturnSession,
  standardCaseChecks,
  SYSTEM_USER_ID,
  unwrap,
  type AppState,
  type Booking,
  type ReturnLine,
  type ReturnLineInput,
  type ReturnSession,
} from '../../src';
import { baseState, caseT, item, L, ln, order, U, withBookings } from '../helpers';
import { ev, of, pts, withMessages } from './helpers';

const T = '2027-04-22';
const get = (s: AppState, id: string) => s.bookings.find((b) => b.id === id) as Booking;

function packing(lines = [ln('l1', item('ledbeam'), 10), ln('l2', item('hazer'), 1)]) {
  return withBookings(baseState(), order({ id: 'o1', status: 'packing', lines }));
}

const ship = (s: AppState, lines: { lineId: string; qty: number; caseIds?: string[] }[]) =>
  unwrap(
    packAndShip(s, U.martin, T, 'o1', {
      label: 'Dodávka 1',
      lines: lines.map((l) =>
        l.caseIds ? { ...l, caseChecks: standardCaseChecks(s, l.caseIds) } : l,
      ),
    }),
  );

describe('gamification: packing and shipping', () => {
  it('pack.packed gives 5 points plus 1 per 5 pieces', () => {
    const s = unwrap(packLines(packing(), U.martin, T, 'o1', [{ lineId: 'l1', qty: 10 }]));
    const e = of(computeLedger(s), 'pack.packed');
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ userId: U.martin.id, on: T, points: 7, bookingId: 'o1' });
  });

  it('pack.packed adds at most +15 for pieces', () => {
    const s0 = packing([ln('l1', item('clamp'), 40), ln('l2', item('rope'), 40)]);
    const s = unwrap(
      packLines(s0, U.martin, T, 'o1', [
        { lineId: 'l1', qty: 40 },
        { lineId: 'l2', qty: 40 },
      ]),
    );
    expect(pts(computeLedger(s), 'pack.packed')).toBe(20);
  });

  it('pack.packed counts once per booking, person and day, adding up the pieces', () => {
    const s1 = unwrap(packLines(packing(), U.martin, T, 'o1', [{ lineId: 'l1', qty: 6 }]));
    const s2 = unwrap(packLines(s1, U.martin, T, 'o1', [{ lineId: 'l1', qty: 4 }]));
    const e = of(computeLedger(s2), 'pack.packed');
    expect(e).toHaveLength(1);
    expect(e[0]?.params.count).toBe(10);
  });

  it('pack.packed counts "Zabalit a rovnou odvézt", which packs without a thread event', () => {
    const s = ship(packing(), [{ lineId: 'l1', qty: 10 }]);
    expect(s.messages.some((m) => m.event?.type === 'packed')).toBe(false);
    expect(pts(computeLedger(s), 'pack.packed')).toBe(7);
  });

  it('pack.packed stays when the packing is cancelled afterwards', () => {
    const s1 = unwrap(packLines(packing(), U.martin, T, 'o1', [{ lineId: 'l1', qty: 10 }]));
    const confirmed = packingBackItems(s1, get(s1, 'o1')).map((i) => i.key);
    const s2 = unwrap(cancelPacking(s1, U.martin, T, 'o1', { confirmed }));
    expect(s2.packings.filter((p) => p.bookingId === 'o1')).toHaveLength(0);
    expect(pts(computeLedger(s2), 'pack.packed')).toBe(7);
  });

  it('pack.caseChecked gives 2 points per case, once although packing and shipment both hold it', () => {
    const s = ship(packing([ln('l1', caseT('ct-ax9'), 1)]), [
      { lineId: 'l1', qty: 1, caseIds: ['case-1'] },
    ]);
    const e = of(computeLedger(s), 'pack.caseChecked');
    expect(e).toHaveLength(1);
    expect(e[0]?.points).toBe(2);
  });

  it('pack.refilled gives +3 when a case was refilled instead of leaving short', () => {
    const s: AppState = {
      ...packing([ln('l1', caseT('ct-ax9'), 1)]),
      packings: [
        {
          id: 'pk-1',
          bookingId: 'o1',
          on: T,
          userId: U.martin.id,
          lines: [
            {
              lineId: 'l1',
              qty: 1,
              caseIds: ['case-1'],
              caseChecks: [{ caseId: 'case-1', counts: [], refilled: [{ itemId: 'psu', qty: 1 }] }],
            },
          ],
        },
      ],
    };
    const e = of(computeLedger(s), 'pack.refilled');
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ points: 3, parentId: 'pack.caseChecked:o1:case-1' });
  });

  it('ship.delivery gives 10 points per delivery', () => {
    const s = ship(packing(), [{ lineId: 'l1', qty: 10 }]);
    const e = of(computeLedger(s), 'ship.delivery');
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ points: 10, userId: U.martin.id, params: { label: 'Dodávka 1' } });
  });

  it('ship.transfer gives 8 points once per pair of events and day', () => {
    const s = withMessages(
      packing(),
      ev('o1', U.martin.id, T, 'transfer_out', { qty: 2, itemId: 'ledbeam', to: 'Ples' }),
      ev('o1', U.martin.id, T, 'transfer_out', { qty: 1, itemId: 'hazer', to: 'Ples' }),
    );
    expect(pts(computeLedger(s), 'ship.transfer')).toBe(8);
  });

  it('ship.lateRecorded gives 3 points for a last-minute item recorded', () => {
    const s = withMessages(packing(), ev('o1', U.martin.id, T, 'late_item', {}));
    expect(pts(computeLedger(s), 'ship.lateRecorded')).toBe(3);
  });

  it('the nightly job (SYSTEM_USER_ID) earns nothing', () => {
    const s = withMessages(packing(), ev('o1', SYSTEM_USER_ID, T, 'batch_shipped', {}));
    expect(computeLedger(s)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

const R = '2027-04-25';

/** o1 shipped: 10 LEDBeams (l1) and 1 hazer (l2). */
function shipped(): AppState {
  return {
    ...withBookings(
      baseState(),
      order({
        id: 'o1',
        status: 'shipped',
        lines: [ln('l1', item('ledbeam'), 10), ln('l2', item('hazer'), 1)],
      }),
    ),
    shipments: [
      {
        id: 'sh-1',
        bookingId: 'o1',
        label: 'D1',
        shippedOn: T,
        userId: U.martin.id,
        lines: [
          { lineId: 'l1', qty: 10 },
          { lineId: 'l2', qty: 1 },
        ],
      },
    ],
  };
}

const rl = (lineId: string, returnedQty: number, extra: Partial<ReturnLine> = {}): ReturnLine => ({
  lineId,
  returnedQty,
  condition: 'ok',
  locationId: L.brodA,
  ...extra,
});

const session = (lines: ReturnLine[], extra: Partial<ReturnSession> = {}): ReturnSession => ({
  id: 'ret-1',
  bookingId: 'o1',
  userId: U.karel.id,
  on: R,
  lines,
  unexpected: [],
  ...extra,
});

const withSessions = (s: AppState, ...sessions: ReturnSession[]): AppState => ({
  ...s,
  returnSessions: [...s.returnSessions, ...sessions],
});

const LONG = 'Prasklý kryt čočky, nesvítí jeden segment';
const NOTE = 'Kabely smotané zvlášť';

describe('gamification: vratka', () => {
  it('vratka.session gives 10 points plus 1 per line, at most +25', () => {
    const s = withSessions(shipped(), session([rl('l1', 4)], { on: '2027-04-27' }));
    expect(pts(computeLedger(s), 'vratka.session')).toBe(11);
    const many = Array.from({ length: 30 }, (_, i) => rl('l1', i === 0 ? 1 : 0));
    const s2 = withSessions(shipped(), session(many, { on: '2027-04-27' }));
    expect(pts(computeLedger(s2), 'vratka.session')).toBe(35);
  });

  it('vratka.settled gives 10 points for the session that brought everything back', () => {
    const input: ReturnLineInput[] = [
      { lineId: 'l1', returnedQty: 10, confirmed: true, condition: 'ok', locationId: L.brodA },
      { lineId: 'l2', returnedQty: 1, confirmed: true, condition: 'ok', locationId: L.brodA },
    ];
    const s = unwrap(recordReturnSession(shipped(), U.karel, R, 'o1', { lines: input }));
    const e = of(computeLedger(s), 'vratka.settled');
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ points: 10, userId: U.karel.id });
    expect(e[0]?.parentId).toMatch(/^vratka\.session:/);
  });

  it('vratka.settled is not given for a partial vratka', () => {
    const input: ReturnLineInput[] = [
      { lineId: 'l2', returnedQty: 1, confirmed: true, condition: 'ok', locationId: L.brodA },
    ];
    const s = unwrap(recordReturnSession(shipped(), U.karel, R, 'o1', { lines: input }));
    expect(of(computeLedger(s), 'vratka.settled')).toHaveLength(0);
    expect(of(computeLedger(s), 'vratka.session')).toHaveLength(1);
  });

  it('vratka.caseCounted gives 2 points per case counted line by line (base work)', () => {
    const lines = [
      rl('l1', 1, { caseId: 'case-1', caseContents: [{ itemId: 'ax9', qty: 8 }] }),
      rl('l1', 1, { caseId: 'case-2', caseContents: [{ itemId: 'ax9', qty: 8 }] }),
      rl('l1', 0, { caseId: 'case-3', caseContents: [], note: 'Case chybí' }),
    ];
    const e = of(computeLedger(withSessions(shipped(), session(lines))), 'vratka.caseCounted');
    expect(e[0]).toMatchObject({ points: 4, parentId: 'vratka.session:ret-1' });
  });

  it('vratka.damageDescribed gives +2 per damaged line with a description of 25+ characters', () => {
    const lines = [
      rl('l1', 9, { note: 'Jeden chybí' }),
      rl('l2', 1, { condition: 'damaged', note: LONG }),
    ];
    const e = of(computeLedger(withSessions(shipped(), session(lines))), 'vratka.damageDescribed');
    expect(e[0]?.points).toBe(2);
  });

  it('vratka.damageDescribed is not given for a one-word note (the required minimum)', () => {
    const lines = [rl('l2', 1, { condition: 'damaged', note: 'rozbité' })];
    const s = withSessions(shipped(), session(lines));
    expect(of(computeLedger(s), 'vratka.damageDescribed')).toHaveLength(0);
  });

  it('vratka.damageDescribed adds at most +10', () => {
    const lines = Array.from({ length: 7 }, () =>
      rl('l1', 1, { condition: 'damaged', note: LONG }),
    );
    expect(
      pts(computeLedger(withSessions(shipped(), session(lines))), 'vratka.damageDescribed'),
    ).toBe(10);
  });

  it('vratka.extraNote gives +1 for a note on a complete OK line, where none is required', () => {
    const lines = [rl('l1', 10, { note: NOTE }), rl('l2', 1)];
    const e = of(computeLedger(withSessions(shipped(), session(lines))), 'vratka.extraNote');
    expect(e[0]?.points).toBe(1);
  });

  it('vratka.extraNote is not given for the note a short line requires', () => {
    const lines = [rl('l1', 8, { note: 'Dva kusy zůstaly na místě akce' })];
    const s = withSessions(shipped(), session(lines));
    expect(of(computeLedger(s), 'vratka.extraNote')).toHaveLength(0);
  });

  it('vratka.extraNote counts a line completed over two sessions only when it is complete', () => {
    const s = withSessions(
      shipped(),
      session([rl('l1', 6, { note: 'Zbytek přiveze Petr zítra' })], { id: 'ret-1', on: R }),
      session([rl('l1', 4, { note: NOTE })], { id: 'ret-2', on: '2027-04-26' }),
    );
    const e = of(computeLedger(s), 'vratka.extraNote');
    expect(e.map((x) => x.parentId)).toEqual(['vratka.session:ret-2']);
  });

  it('vratka.unexpected gives +3 per unexpected item recorded', () => {
    const s = withSessions(
      shipped(),
      session([rl('l2', 1)], {
        unexpected: [
          { name: 'Cizí stativ', qty: 1, note: 'Nebyl na seznamu' },
          { itemId: 'clamp', qty: 2, note: 'Navíc' },
        ],
      }),
    );
    expect(pts(computeLedger(s), 'vratka.unexpected')).toBe(6);
  });

  it('vratka.photo gives +3 for a file added by the same person on the day of the vratka', () => {
    const file = { name: 'poskozeni.jpg', size: 1000, key: 'k1' };
    const s: AppState = {
      ...withSessions(shipped(), session([rl('l2', 1)])),
      attachments: [
        { id: 'att-1', bookingId: 'o1', by: U.karel.id, on: R, file },
        { id: 'att-2', bookingId: 'o1', by: U.karel.id, on: R, file },
      ],
    };
    expect(pts(computeLedger(s), 'vratka.photo')).toBe(3);
    const other = {
      ...s,
      attachments: [{ id: 'att-3', bookingId: 'o1', by: U.martin.id, on: R, file }],
    };
    expect(of(computeLedger(other), 'vratka.photo')).toHaveLength(0);
  });

  it('vratka.onTime gives +5 when the vratka is on or before the last booked day', () => {
    const onTime = withSessions(shipped(), session([rl('l2', 1)], { on: R }));
    expect(pts(computeLedger(onTime), 'vratka.onTime')).toBe(5);
    const late = withSessions(shipped(), session([rl('l2', 1)], { on: '2027-04-26' }));
    expect(of(computeLedger(late), 'vratka.onTime')).toHaveLength(0);
  });
});
