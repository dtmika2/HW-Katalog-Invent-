import { describe, expect, it } from 'vitest';
import {
  addLine,
  availableActions,
  bookingPriceTotal,
  clearOverride,
  dismissCheck,
  dismissRecommendation,
  evaluateBooking,
  eventDays,
  linePriceDay,
  markLine,
  resolveSourceWarehouse,
  restoreAutoLine,
  setExpectedReturn,
  setLineQty,
  setLineSource,
  splitLine,
  totalStock,
  type Booking,
} from '../src';
import { baseState, bk, caseT, item, ln, order, P, U, W, withBookings } from './helpers';

const s = baseState();
const draft = (lines = [ln('l1', item('ledbeam'), 4)]) => bk({ id: 'd1', lines });

describe('booking edits', () => {
  it('addLine merges into an existing manual line', () => {
    const b = addLine(s, addLine(s, draft([]), { itemId: 'hazer' }, 1), { itemId: 'hazer' }, 2);
    expect(b.lines.filter((l) => l.origin === 'manual')).toEqual([
      expect.objectContaining({ qty: 3, target: { itemId: 'hazer' } }),
    ]);
  });

  it('setLineQty overrides auto lines and clearOverride restores the computed value', () => {
    const b1 = addLine(s, draft([]), { itemId: 'ledbeam' }, 10);
    const b2 = setLineQty(s, b1, 'auto:item:rope', 12);
    expect(b2.lines.find((l) => l.id === 'auto:item:rope')).toMatchObject({
      qty: 10,
      overriddenQty: 12,
    });
    const b3 = clearOverride(s, b2, 'auto:item:rope');
    expect(b3.lines.find((l) => l.id === 'auto:item:rope')?.overriddenQty).toBeUndefined();
  });

  it('restores a suppressed auto line', () => {
    let b: Booking = addLine(s, draft([]), { itemId: 'ledbeam' }, 2);
    b = { ...b, suppressedAuto: { 'auto:item:desk': 'own' } };
    b = restoreAutoLine(s, b, 'auto:item:desk');
    expect(b.lines.some((l) => l.id === 'auto:item:desk')).toBe(true);
  });

  it('dismisses recommendations and checks once', () => {
    const b = dismissRecommendation(dismissRecommendation(draft(), 'item:hazer'), 'item:hazer');
    expect(b.dismissedRecommendations).toEqual(['item:hazer']);
    const c = dismissCheck(dismissCheck(draft(), 'ledbeam:power'), 'ledbeam:power');
    expect(c.dismissedChecks).toEqual(['ledbeam:power']);
  });

  it('a line marked missing stops holding and drops its accessories', () => {
    const b1 = addLine(s, draft([]), { itemId: 'ledbeam' }, 4);
    const id = b1.lines.find((l) => l.origin === 'manual')!.id;
    const b2 = markLine(s, b1, id, 'missing', 'Nemáme');
    expect(b2.lines.find((l) => l.id === id)).toMatchObject({ status: 'missing', note: 'Nemáme' });
    expect(b2.lines.filter((l) => l.origin === 'auto')).toHaveLength(0);
    expect(evaluateBooking(s, b2).get(id)?.badge).toBe('none');
  });

  it('source warehouse, transfer source and expected return', () => {
    let b = setLineSource(s, draft(), 'l1', { warehouseId: W.karlak });
    expect(b.lines[0]).toMatchObject({
      sourceWarehouseId: W.karlak,
      expectedReturnWarehouseId: W.karlak,
    });
    b = setExpectedReturn(b, 'l1', W.brod);
    expect(b.lines[0]?.expectedReturnWarehouseId).toBe(W.brod);
    b = setLineSource(s, b, 'l1', { fromBookingId: 'o1' });
    expect(b.lines[0]).toMatchObject({ fromBookingId: 'o1' });
    expect(b.lines[0]?.sourceWarehouseId).toBeUndefined();
  });

  it('splits a short line into two warehouses', () => {
    const b = splitLine(s, draft([ln('l1', item('ledbeam'), 14)]), 'l1', 2, W.karlak);
    const manual = b.lines.filter((l) => l.origin === 'manual');
    expect(manual.map((l) => [l.qty, l.sourceWarehouseId])).toEqual([
      [12, undefined],
      [2, W.karlak],
    ]);
    expect([...evaluateBooking(s, b).values()].filter((a) => a.badge === 'red')).toHaveLength(0);
  });

  it('resolves the source warehouse from stock when the default has none', () => {
    const b = bk({ id: 'x', defaultWarehouseId: W.karlak });
    expect(resolveSourceWarehouse(s, b, ln('a', item('rogue'), 1))).toBe(W.brod);
    expect(resolveSourceWarehouse(s, b, ln('a', item('ledbeam'), 1))).toBe(W.karlak);
    expect(resolveSourceWarehouse(s, b, ln('a', caseT('ct-ax9'), 1))).toBe(W.karlak);
  });
});

describe('catalogue helpers', () => {
  it('indicative price: lines × event days (case types priced by contents)', () => {
    const b = draft([
      ln('l1', item('ledbeam'), 2),
      ln('l2', caseT('ct-ax9'), 1),
      ln(
        'e',
        { external: { name: 'x', supplier: 'y', pickup: '2027-04-22', returnDate: '2027-04-25' } },
        5,
      ),
    ]);
    expect(linePriceDay(s, b.lines[0]!)).toBe(900);
    expect(linePriceDay(s, b.lines[1]!)).toBe(8 * 600 + 8 * 50 + 100);
    expect(linePriceDay(s, b.lines[2]!)).toBe(0);
    expect(eventDays(b)).toBe(2);
    expect(bookingPriceTotal(s, b)).toBe((900 + 5300) * 2);
    expect(
      eventDays({ periods: [P('2027-04-01', '2027-04-01'), P('2027-04-10', '2027-04-12')] }),
    ).toBe(4);
  });

  it('total stock sums warehouses', () => {
    expect(totalStock(s, 'ledbeam')).toBe(16);
  });

  it('available actions follow role and state', () => {
    const st = withBookings(
      baseState(),
      bk({ id: 'd1', pmId: U.jana.id, lines: [ln('l1', item('hazer'), 1)] }),
      order({ id: 'o1' }),
    );
    expect(availableActions(st, U.jana, 'd1').sort()).toEqual(['confirm', 'submit']);
    expect(availableActions(st, U.martin, 'o1')).toEqual(['startPacking']);
  });
});
