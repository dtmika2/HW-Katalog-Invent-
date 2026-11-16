import { describe, expect, it } from 'vitest';
import {
  buildHoldIndex,
  caseCalendar,
  caseDay,
  caseMissing,
  evaluateBooking,
  isCaseComplete,
  itemDay,
  looseStock,
  refillCase,
  refillTasks,
  refillTasksWithAge,
  unwrap,
} from '../src';
import { baseState, bk, caseT, item, ln, order, U, W, withBookings } from './helpers';

describe('cases — completeness and stock', () => {
  it('complete / incomplete detection', () => {
    const s = baseState();
    expect(isCaseComplete(s, s.cases[0]!)).toBe(true);
    s.cases[0]!.contents[0]!.qty = 7;
    expect(isCaseComplete(s, s.cases[0]!)).toBe(false);
    expect(caseMissing(s, s.cases[0]!)).toEqual([{ itemId: 'ax9', qty: 1 }]);
  });

  it('loose stock excludes in-case pieces', () => {
    const s = baseState();
    expect(looseStock(s, 'ax9', W.brod)).toBe(4);
    expect(looseStock(s, 'ax9', W.karlak)).toBe(0);
  });

  it('a case line reserves the case and its contents', () => {
    const s = withBookings(baseState(), order({ id: 'o1', lines: [ln('l1', caseT('ct-ax9'), 1)] }));
    const idx = buildHoldIndex(s);
    expect(itemDay(s, idx, 'ax9', W.brod, '2027-04-23')).toMatchObject({
      hardHeld: 8,
      looseHardHeld: 0,
      free: 12,
    });
    expect(caseDay(s, idx, 'ct-ax9', W.brod, '2027-04-23')).toMatchObject({
      completeCases: 2,
      caseHeld: 1,
      free: 1,
    });
  });

  it('broken = max over contents of ceil(overflow / per case)', () => {
    const s = withBookings(baseState(), order({ id: 'o1', lines: [ln('l1', item('ax9'), 10)] }));
    // loose stock 4, loose demand 10 → overflow 6 → ceil(6/8) = 1 broken
    expect(caseDay(s, buildHoldIndex(s), 'ct-ax9', W.brod, '2027-04-23')).toMatchObject({
      broken: 1,
      free: 1,
    });
  });

  it('a case with an out-of-service piece is not complete', () => {
    const s = baseState();
    s.serviceCases.push({
      id: 'svc',
      itemId: 'ax9',
      warehouseId: W.brod,
      qty: 1,
      reason: 'x',
      internal: true,
      responsibleUserId: U.karel.id,
      status: 'reported',
      openedOn: '2027-04-01',
      caseId: 'case-1',
      events: [],
    });
    expect(isCaseComplete(s, s.cases[0]!)).toBe(false);
    expect(caseDay(s, buildHoldIndex(s), 'ct-ax9', W.brod, '2027-04-23').completeCases).toBe(1);
  });

  it('a case line is short when no complete case is free (red, colliding order named)', () => {
    const other = order({
      id: 'o1',
      eventName: 'Firemní den',
      pmId: U.jana.id,
      lines: [ln('l1', caseT('ct-ax9'), 1)],
    });
    const draft = bk({ id: 'd1', lines: [ln('l1', caseT('ct-ax9'), 2)] });
    const s = withBookings(baseState(), other, draft);
    expect(evaluateBooking(s, draft).get('l1')).toMatchObject({
      badge: 'red',
      short: 1,
      collidingBookingIds: ['o1'],
    });
  });

  it('"rozbije case": loose demand that forces open cases booked whole shows amber', () => {
    const s0 = baseState();
    // case-2 is incomplete (one charger missing) → only case-1 is complete; another order books it whole.
    s0.cases[1]!.contents[1]!.qty = 7;
    const other = order({
      id: 'o1',
      eventName: 'Cases whole',
      lines: [ln('l1', caseT('ct-ax9'), 1)],
    });
    const draft = bk({ id: 'd1', lines: [ln('l1', item('ax9'), 10)] });
    const s = withBookings(s0, other, draft);
    const a = evaluateBooking(s, draft).get('l1');
    expect(a?.badge).toBe('amber');
    expect(a?.breaksCase).toEqual({ caseTypeId: 'ct-ax9', bookingIds: ['o1'] });
    // without the case order there is nothing to break
    const s2 = withBookings(s0, draft);
    expect(evaluateBooking(s2, draft).get('l1')?.badge).toBe('green');
  });

  it('case calendar shows complete cases free per day', () => {
    const s = withBookings(baseState(), order({ id: 'o1', lines: [ln('l1', caseT('ct-ax9'), 2)] }));
    const cal = caseCalendar(s, 'ct-ax9', '2027-04-21', '2027-04-22', 'all');
    expect(cal.map((d) => d.free)).toEqual([3, 1]);
    expect(cal[1]).toMatchObject({ totalCases: 3, completeCases: 3, caseHeld: 2 });
  });
});

describe('cases — refill tasks', () => {
  it('incomplete cases produce refill tasks with age', () => {
    const s = baseState();
    s.cases[0]!.contents[0]!.qty = 6;
    s.cases[0]!.incompleteSince = '2027-04-15';
    expect(refillTasks(s)).toEqual([
      { caseId: 'case-1', missing: [{ itemId: 'ax9', qty: 2 }], since: '2027-04-15' },
    ]);
    expect(refillTasksWithAge(s, '2027-04-20')[0]?.ageDays).toBe(5);
  });

  it('refill moves pieces from loose stock into the case', () => {
    const s = baseState();
    s.cases[0]!.contents[0]!.qty = 6;
    s.cases[0]!.incompleteSince = '2027-04-15';
    expect(looseStock(s, 'ax9', W.brod)).toBe(6);
    const s2 = unwrap(refillCase(s, U.martin, '2027-04-20', 'case-1'));
    expect(isCaseComplete(s2, s2.cases[0]!)).toBe(true);
    expect(s2.cases[0]!.incompleteSince).toBeUndefined();
    expect(looseStock(s2, 'ax9', W.brod)).toBe(4);
    expect(refillTasks(s2)).toHaveLength(0);
  });

  it('refill fails without loose stock and for PMs', () => {
    const s = baseState();
    s.cases[2]!.contents[0]!.qty = 6;
    s.stock.find((x) => x.itemId === 'ax9' && x.warehouseId === W.karlak)!.qty = 6; // pieces gone, no loose AX9
    expect(refillCase(s, U.martin, '2027-04-20', 'case-3')).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(refillCase(s, U.petr, '2027-04-20', 'case-3')).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });
});
