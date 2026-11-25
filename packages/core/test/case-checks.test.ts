/** Case checklist at packing: every case is counted; a short one leaves only with a reason. */
import { describe, expect, it } from 'vitest';
import {
  buildHoldIndex,
  caseDay,
  casesOut,
  completeAsStandard,
  conflictOverview,
  isCaseComplete,
  itemDay,
  looseInHouse,
  packingList,
  recordReturnSession,
  refillCase,
  resolveIssue,
  returnSheet,
  shipBatch,
  standardCaseChecks,
  unwrap,
  type AppState,
  type CaseCheck,
} from '../src';
import { baseState, caseT, ln, L, order, TODAY as T, U, W, withBookings } from './helpers';

const R = '2027-04-26';
const D = '2027-04-24';
const get = (s: AppState, id: string) => s.bookings.find((b) => b.id === id)!;

const packing = (qty = 1, extra: Parameters<typeof withBookings>[1][] = []) =>
  withBookings(
    baseState(),
    order({ id: 'o1', status: 'packing', lines: [ln('l1', caseT('ct-ax9'), qty)] }),
    ...extra,
  );

const check = (s: AppState, caseId: string, change: Partial<CaseCheck> = {}): CaseCheck => ({
  ...standardCaseChecks(s, [caseId])[0]!,
  ...change,
});
const count = (c: CaseCheck, itemId: string, qty: number): CaseCheck => ({
  ...c,
  counts: c.counts.map((l) => (l.itemId === itemId ? { ...l, qty } : l)),
});
const ship = (s: AppState, checks: CaseCheck[], caseIds = checks.map((c) => c.caseId)) =>
  shipBatch(s, U.martin, T, 'o1', {
    label: 'Dodávka 1',
    lines: [{ lineId: 'l1', qty: caseIds.length, caseIds, caseChecks: checks }],
  });
const invalid = (field?: string) => ({
  ok: false,
  error: { code: 'validation', ...(field ? { details: { field } } : {}) },
});

describe('case checklist at packing', () => {
  it('a case cannot leave unchecked, partly checked or checked twice', () => {
    const s = packing();
    expect(ship(s, [], ['case-1'])).toMatchObject(invalid('caseChecks'));
    expect(ship(s, [check(s, 'case-2')], ['case-1'])).toMatchObject(invalid('caseChecks'));
    const c = check(s, 'case-1');
    expect(ship(s, [{ ...c, counts: c.counts.slice(1) }])).toMatchObject(invalid());
    expect(ship(s, [c, c], ['case-1'])).toMatchObject(invalid('caseChecks'));
  });

  it('counts must be whole, not negative and not above the standard', () => {
    const s = packing();
    for (const n of [9, -1, 1.5])
      expect(ship(s, [count(check(s, 'case-1'), 'ax9', n)])).toMatchObject(invalid());
    const alien = check(s, 'case-1');
    alien.counts = [...alien.counts, { itemId: 'ledbeam', qty: 1 }];
    expect(ship(s, [alien])).toMatchObject(invalid());
  });

  it('a complete case leaves without any issue; the check is kept on the shipment', () => {
    const s = packing();
    const before = structuredClone(s);
    const next = unwrap(ship(s, [check(s, 'case-1')]));
    expect(s).toEqual(before);
    expect(next.issues).toEqual([]);
    expect(next.shipments[0]?.lines[0]?.caseChecks?.[0]?.caseId).toBe('case-1');
    expect(isCaseComplete(next, next.cases[0]!)).toBe(true);
  });

  it('a short case needs a reason, then: real contents, missing issue, PM and Chief notified', () => {
    const s = packing();
    const short = count(check(s, 'case-1'), 'ax9', 7);
    expect(ship(s, [short])).toMatchObject(invalid('reason'));
    const next = unwrap(ship(s, [{ ...short, reason: 'Jeden nikde není' }]));
    expect(next.cases[0]).toMatchObject({ incompleteSince: T });
    expect(next.issues).toEqual([
      expect.objectContaining({
        type: 'missing',
        caseId: 'case-1',
        itemId: 'ax9',
        qty: 1,
        bookingId: 'o1',
        note: 'Jeden nikde není',
      }),
    ]);
    const told = next.notifications.filter((n) => n.type === 'case_shipped_short');
    expect(told.map((n) => n.userId).sort()).toEqual([get(next, 'o1').pmId, U.tomas.id].sort());
    expect(told[0]?.params).toMatchObject({ number: 'AX9-01', reason: 'Jeden nikde není' });
  });

  it('the missing piece is counted once and the other case stays free', () => {
    const s = packing();
    const day = (x: AppState, d: string) => itemDay(x, buildHoldIndex(x), 'ax9', W.brod, d);
    const freeCases = (x: AppState) => caseDay(x, buildHoldIndex(x), 'ct-ax9', W.brod, D).free;
    const full = unwrap(ship(s, [check(s, 'case-1')]));
    const next = unwrap(ship(s, [{ ...count(check(s, 'case-1'), 'ax9', 7), reason: 'chybí kus' }]));
    expect(day(next, D).hardHeld).toBe(day(full, D).hardHeld);
    expect(freeCases(next)).toBe(freeCases(full));
    // after the event only the missing piece stays blocked
    expect(day(next, '2027-06-01').hardHeld).toBe(1);
    expect(conflictOverview(next, T)).toEqual([]);
  });

  it('refilling from loose stock makes the case complete; the lost piece is still an issue', () => {
    const s = packing();
    const loose = looseInHouse(s, 'ax9', W.brod);
    expect(loose).toBeGreaterThan(0);
    const c = {
      ...count(check(s, 'case-1'), 'ax9', 7),
      refilled: [{ itemId: 'ax9', qty: 1 }],
    };
    const next = unwrap(ship(s, [c]));
    expect(isCaseComplete(next, next.cases[0]!)).toBe(true);
    expect(next.issues).toEqual([expect.objectContaining({ itemId: 'ax9', qty: 1 })]);
    expect(next.notifications.some((n) => n.type === 'case_shipped_short')).toBe(false);
    expect(looseInHouse(next, 'ax9', W.brod)).toBe(loose - 1);
    // not more than lies around loose, also over several cases
    expect(looseInHouse(s, 'charger', W.brod)).toBe(0);
    expect(
      ship(s, [
        { ...count(check(s, 'case-1'), 'charger', 7), refilled: [{ itemId: 'charger', qty: 1 }] },
      ]),
    ).toMatchObject(invalid());
  });

  it('a case that left is busy, for this order too, and cannot be refilled while away', () => {
    const s = packing(2);
    const next = unwrap(ship(s, [{ ...count(check(s, 'case-1'), 'ax9', 7), reason: 'x' }]));
    expect(get(next, 'o1').status).toBe('packing');
    expect(casesOut(next).has('case-1')).toBe(true);
    const cand = packingList(next, 'o1')!.byWarehouse[0]!.groups[0]!.lines[0]!.candidateCases!;
    expect(cand.map((c) => [c.caseId, c.busy])).toEqual([
      ['case-1', true],
      ['case-2', false],
    ]);
    expect(ship(next, [check(next, 'case-1')])).toMatchObject(invalid());
    expect(refillCase(next, U.martin, T, 'case-1')).toMatchObject({
      error: { code: 'invalid_state' },
    });
  });
});

describe('vratka of a case that left short', () => {
  const shipped = () => {
    const s = packing();
    return unwrap(ship(s, [{ ...count(check(s, 'case-1'), 'ax9', 7), reason: 'chybí kus' }]));
  };
  const back = (s: AppState, ax9: number, note?: string) =>
    recordReturnSession(s, U.martin, R, 'o1', {
      lines: [
        {
          ...completeAsStandard(s, 'l1', 'case-1', L.brodB),
          caseContents: completeAsStandard(s, 'l1', 'case-1', L.brodB).caseContents!.map((c) =>
            c.itemId === 'ax9' ? { ...c, qty: ax9 } : c,
          ),
          ...(note ? { note } : {}),
        },
      ],
    });

  it('everything that left is back: no second issue and no note needed', () => {
    const s = shipped();
    expect(returnSheet(s, 'o1')[0]?.shippedContents['case-1']).toContainEqual({
      itemId: 'ax9',
      qty: 7,
    });
    const next = unwrap(back(s, 7));
    expect(next.issues.map((i) => [i.qty, i.archivedOn])).toEqual([[1, undefined]]);
    expect(get(next, 'o1').status).toBe('returned_with_issues');
    const done = unwrap(resolveIssue(next, U.tomas, R, next.issues[0]!.id, 'found', 'Byl v autě'));
    expect(get(done, 'o1').status).toBe('returned');
  });

  it('one more piece lost on the event adds up on the same issue', () => {
    const s = shipped();
    expect(back(s, 6)).toMatchObject(invalid());
    const next = unwrap(back(s, 6, 'Další zůstal na místě'));
    expect(next.issues.map((i) => i.qty)).toEqual([2]);
  });

  it('the piece turned up: the issue closes by itself', () => {
    const next = unwrap(back(shipped(), 8));
    expect(next.issues[0]).toMatchObject({ qty: 1, archivedOn: R, resolutionKind: 'found' });
    expect(get(next, 'o1').status).toBe('returned');
    expect(isCaseComplete(next, next.cases[0]!)).toBe(true);
  });

  it('the whole case is lost: only what was in it is held', () => {
    const s = shipped();
    const next = unwrap(
      recordReturnSession(s, U.martin, R, 'o1', {
        lines: [
          {
            lineId: 'l1',
            caseId: 'case-1',
            returnedQty: 0,
            confirmed: true,
            condition: 'ok',
            note: 'Zmizel',
          },
        ],
      }),
    );
    // 7 in the lost case + 1 missing at packing
    expect(itemDay(next, buildHoldIndex(next), 'ax9', W.brod, '2027-06-01').hardHeld).toBe(8);
  });
});
