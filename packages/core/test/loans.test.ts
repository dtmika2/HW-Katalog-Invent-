/** Quick loans outside reservations. */
import { describe, expect, it } from 'vitest';
import {
  buildHoldIndex,
  can,
  cancelLoan,
  caseDay,
  casesHere,
  conflictOverview,
  createLoan,
  detectConflicts,
  extendLoan,
  isCaseComplete,
  isLoanOverdue,
  itemCalendar,
  itemDay,
  loanPreview,
  looseHere,
  openLoans,
  openServiceCase,
  refillCase,
  returnLoan,
  runDailyJobs,
  packAndShip,
  standardCaseChecks,
  unwrap,
  type AppState,
  type LoanInput,
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

// Brod has 12 LEDBeams. The order holds 10 on 22–25 April.
const busy = (...extra: Parameters<typeof withBookings>[1][]) =>
  withBookings(
    baseState(),
    order({ id: 'o1', pmId: U.jana.id, lines: [ln('l1', item('ledbeam'), 10)] }),
    ...extra,
  );
const lb = (extra: Partial<LoanInput> = {}): LoanInput => ({
  itemId: 'ledbeam',
  warehouseId: W.brod,
  qty: 1,
  ...extra,
});
const take = (s: AppState, input: LoanInput, user = U.petr as Parameters<typeof createLoan>[1]) =>
  createLoan(s, user, T, input);
const taken = (s: AppState, input: LoanInput) => unwrap(take(s, input)).state;
const free = (s: AppState, d: string, itemId = 'ledbeam') =>
  itemDay(s, buildHoldIndex(s), itemId, W.brod, d).free;
const invalid = (field: string) => ({ error: { code: 'validation', details: { field } } });

describe('who may borrow', () => {
  it('every active user borrows; only Sklad and the Chief record it for others', () => {
    const others = [U.petr, U.tomas, U.martin, U.admin].map((u) => [
      can(u, 'borrow'),
      can(u, 'borrow_for_other'),
    ]);
    expect(others).toEqual([
      [true, false],
      [true, true],
      [true, true],
      [true, false],
    ]);
    const s = baseState();
    expect(take(s, lb(), { ...U.petr, active: false })).toMatchObject({
      error: { code: 'forbidden' },
    });
    expect(take(s, lb({ borrowerId: U.jana.id }))).toMatchObject({ error: { code: 'forbidden' } });
    expect(take(s, lb({ borrowerName: 'Škola' }))).toMatchObject({ error: { code: 'forbidden' } });
    const r = unwrap(take(s, lb({ borrowerName: ' Škola ' }), U.martin));
    expect(r.state.loans[0]).toMatchObject({ borrowerName: 'Škola', recordedBy: U.martin.id });
    expect(r.state.loans[0]).not.toHaveProperty('borrowerId');
    expect(take(s, lb({ borrowerId: 'nobody' }), U.martin)).toMatchObject({
      error: { code: 'not_found' },
    });
  });

  it('anyone may mark it returned', () => {
    const s = taken(baseState(), lb());
    const r = unwrap(returnLoan(s, U.lucie, T, s.loans[0]!.id));
    expect(r.loans[0]).toMatchObject({ returnedOn: T, returnedBy: U.lucie.id });
    expect(openLoans(r)).toEqual([]);
    expect(returnLoan(r, U.lucie, T, r.loans[0]!.id)).toMatchObject({
      error: { code: 'invalid_state' },
    });
  });
});

describe('dates and availability', () => {
  it('without a date the pieces are out for the next 7 days; with a date until that day', () => {
    const s = taken(baseState(), lb({ qty: 3 }));
    expect(['2027-04-20', '2027-04-27', '2027-04-28'].map((d) => free(s, d))).toEqual([9, 9, 12]);
    const u = taken(baseState(), lb({ qty: 3, until: '2027-05-10' }));
    expect(['2027-05-10', '2027-05-11'].map((d) => free(u, d))).toEqual([9, 12]);
    const day = itemCalendar(u, 'ledbeam', '2027-05-01', '2027-05-01', W.brod)[0];
    expect(day).toMatchObject({ free: 9, loaned: 3, loanIds: [u.loans[0]!.id] });
  });

  it('a planned loan blocks only its days, can be cancelled, not returned', () => {
    const s = taken(baseState(), lb({ from: '2027-05-01', until: '2027-05-02' }));
    expect([free(s, T), free(s, '2027-05-01')]).toEqual([12, 11]);
    const id = s.loans[0]!.id;
    expect(returnLoan(s, U.petr, T, id)).toMatchObject({ error: { code: 'invalid_state' } });
    const c = unwrap(cancelLoan(s, U.petr, T, id));
    expect(free(c, '2027-05-01')).toBe(12);
    const started = taken(baseState(), lb());
    expect(cancelLoan(started, U.petr, T, started.loans[0]!.id)).toMatchObject({
      error: { code: 'invalid_state' },
    });
  });

  it('refuses past dates, a return before the start, wrong counts and consumables', () => {
    const s = baseState();
    expect(take(s, lb({ from: '2027-04-19' }))).toMatchObject(invalid('from'));
    expect(take(s, lb({ from: '2027-05-02', until: '2027-05-01' }))).toMatchObject(
      invalid('until'),
    );
    for (const qty of [0, -1, 1.5]) expect(take(s, lb({ qty }))).toMatchObject(invalid('qty'));
    expect(take(s, lb({ itemId: 'tape' }))).toMatchObject(invalid('itemId'));
    expect(take(s, lb({ itemId: 'nope' }))).toMatchObject({ error: { code: 'not_found' } });
  });

  it('an overdue or undated loan never frees itself; overdue reminds borrower and Chief', () => {
    const s = taken(baseState(), lb({ until: '2027-04-21' }));
    expect(isLoanOverdue(s.loans[0]!, '2027-04-22')).toBe(true);
    const j = runDailyJobs(s, '2027-04-22');
    expect(j.state.loans[0]?.heldUntil).toBe('2027-04-29');
    expect(free(j.state, '2027-04-29')).toBe(11);
    const told = j.notifications.filter((n) => n.type === 'loan_overdue').map((n) => n.userId);
    expect(told.sort()).toEqual([U.petr.id, U.tomas.id].sort());
    expect(runDailyJobs(j.state, '2027-04-22').notifications).toEqual([]);
    const undated = runDailyJobs(taken(baseState(), lb()), '2027-04-25');
    expect(undated.state.loans[0]?.heldUntil).toBe('2027-05-02');
    expect(undated.notifications.some((n) => n.type === 'loan_overdue')).toBe(false);
  });
});

describe('warning before taking', () => {
  it('no warning while enough stays free', () => {
    const p = loanPreview(busy(), T, lb({ qty: 2 }));
    expect(p).toMatchObject({ from: T, to: '2027-04-27', hits: [], minFree: 0 });
    expect(take(busy(), lb({ qty: 2 })).ok).toBe(true);
  });

  it('a confirmed order in the next 7 days: listed with days, reason required, conflict tracked', () => {
    const s = busy();
    const p = loanPreview(s, T, lb({ qty: 3 }));
    expect(p.hits).toEqual([
      expect.objectContaining({
        bookingId: 'o1',
        level: 'order',
        short: 1,
        days: ['2027-04-22', '2027-04-23', '2027-04-24', '2027-04-25'],
      }),
    ]);
    expect(take(s, lb({ qty: 3 }))).toMatchObject(invalid('reason'));
    const before = structuredClone(s);
    const next = taken(s, lb({ qty: 3, reason: 'Nutně na zkoušku' }));
    expect(s).toEqual(before);
    expect(next.loans[0]).toMatchObject({ reason: 'Nutně na zkoušku' });
    expect(next.conflicts).toEqual([
      expect.objectContaining({ bookingId: 'o1', status: 'new', source: 'detected', shortQty: 1 }),
    ]);
    const told = next.notifications
      .filter((n) => n.type === 'conflict_detected')
      .map((n) => n.userId);
    expect(told.sort()).toEqual([U.jana.id, U.tomas.id].sort());
    const c = detectConflicts(next, next.bookings[0]!)[0]!;
    expect(c.loanIds).toEqual([next.loans[0]!.id]);
    expect(conflictOverview(next, T)).toHaveLength(1);
    // returning the item resolves the conflict
    const back = unwrap(returnLoan(next, U.martin, T, next.loans[0]!.id));
    expect(back.conflicts[0]).toMatchObject({ status: 'resolved', resolution: 'auto' });
  });

  it('checks the chosen days only, also far ahead', () => {
    const s = busy();
    expect(loanPreview(s, T, lb({ qty: 3, until: '2027-04-21' })).hits).toEqual([]);
    expect(take(s, lb({ qty: 3, until: '2027-04-21' })).ok).toBe(true);
    const later = { qty: 3, from: '2027-04-25', until: '2027-04-26' };
    expect(loanPreview(s, T, lb(later)).hits[0]?.days).toEqual(['2027-04-25']);
    expect(take(s, lb(later))).toMatchObject(invalid('reason'));
    const june = busy(
      order(
        {
          id: 'o2',
          periods: [P('2027-06-10', '2027-06-10')],
          lines: [ln('l1', item('ledbeam'), 12)],
        },
        2,
      ),
    );
    expect(loanPreview(june, T, lb()).hits).toEqual([]);
    expect(
      loanPreview(june, T, lb({ until: '2027-06-10' })).hits.map((h) => h.bookingId),
    ).toContain('o2');
  });

  it('a submitted pre-booking only informs, a draft not even that', () => {
    const pre = (status: 'submitted' | 'draft') =>
      withBookings(baseState(), bk({ id: 'p1', status, lines: [ln('l1', item('ledbeam'), 12)] }));
    const s = pre('submitted');
    expect(loanPreview(s, T, lb()).hits).toEqual([
      expect.objectContaining({ bookingId: 'p1', level: 'prebooking' }),
    ]);
    expect(take(s, lb()).ok).toBe(true);
    expect(loanPreview(pre('draft'), T, lb()).hits).toEqual([]);
  });

  it('another warehouse does not collide', () => {
    expect(loanPreview(busy(), T, lb({ warehouseId: W.karlak, qty: 4 })).hits).toEqual([]);
  });

  it('moving the return date warns and needs a reason too', () => {
    const s = taken(busy(), lb({ qty: 3, until: '2027-04-21' }));
    const id = s.loans[0]!.id;
    expect(extendLoan(s, U.petr, T, id, '2027-04-19')).toMatchObject(invalid('until'));
    expect(extendLoan(s, U.petr, T, id, '2027-04-23')).toMatchObject(invalid('reason'));
    const x = unwrap(extendLoan(s, U.petr, T, id, '2027-04-23', 'Zkouška se protáhla'));
    expect(x.loans[0]).toMatchObject({ until: '2027-04-23', heldUntil: '2027-04-23' });
    expect(x.conflicts).toHaveLength(1);
    expect(unwrap(extendLoan(x, U.petr, T, id, '2027-04-21')).conflicts[0]?.status).toBe(
      'resolved',
    );
  });
});

describe('only what is really in the house', () => {
  it('service, missing, loaned and shipped pieces cannot be taken', () => {
    let s = baseState();
    expect(looseHere(s, 'ledbeam', W.brod, T)).toBe(12);
    s = unwrap(
      openServiceCase(s, U.martin, T, {
        itemId: 'ledbeam',
        warehouseId: W.brod,
        qty: 2,
        reason: 'x',
      }),
    ).state;
    s = taken(s, lb({ qty: 1 }));
    s = withBookings(
      s,
      order({
        id: 'o1',
        status: 'packing',
        periods: [P('2027-04-20', '2027-04-21')],
        lines: [ln('l1', item('ledbeam'), 5)],
      }),
    );
    s = unwrap(
      packAndShip(s, U.martin, T, 'o1', { label: 'a', lines: [{ lineId: 'l1', qty: 5 }] }),
    );
    expect(looseHere(s, 'ledbeam', W.brod, T)).toBe(4);
    expect(take(s, lb({ qty: 5 }))).toMatchObject(invalid('qty'));
    expect(take(s, lb({ qty: 4 })).ok).toBe(true);
  });

  it('pieces in cases are taken from a named case and go back into it', () => {
    const s = baseState();
    const charger = lb({ itemId: 'charger' });
    // all 16 chargers sit in cases
    expect(take(s, charger)).toMatchObject(invalid('qty'));
    expect(casesHere(s, 'charger', W.brod)).toEqual([
      { caseId: 'case-1', qty: 8 },
      { caseId: 'case-2', qty: 8 },
    ]);
    expect(take(s, { ...charger, qty: 9, fromCaseId: 'case-1' })).toMatchObject(
      invalid('fromCaseId'),
    );
    expect(take(s, { ...charger, fromCaseId: 'case-3' })).toMatchObject(invalid('fromCaseId'));
    expect(take(s, { ...charger, fromCaseId: 'case-1', from: '2027-05-01' })).toMatchObject(
      invalid('fromCaseId'),
    );
    const next = taken(s, { ...charger, qty: 2, fromCaseId: 'case-1', until: '2027-04-21' });
    expect(isCaseComplete(next, next.cases[0]!)).toBe(false);
    expect(looseHere(next, 'charger', W.brod, T)).toBe(0);
    // the two pieces are not lying around to refill the case with
    expect(refillCase(next, U.martin, T, 'case-1')).toMatchObject({
      error: { code: 'validation' },
    });
    const cases = (d: string) => caseDay(next, buildHoldIndex(next), 'ct-ax9', W.brod, d).free;
    expect([cases(T), cases('2027-04-21'), cases('2027-04-22')]).toEqual([1, 1, 2]);
    const back = unwrap(returnLoan(next, U.petr, T, next.loans[0]!.id));
    expect(isCaseComplete(back, back.cases[0]!)).toBe(true);
    expect(back.cases[0]).not.toHaveProperty('incompleteSince');
  });

  it('a case taken apart by a loan makes an order for whole cases short', () => {
    const s = withBookings(
      baseState(),
      order({ id: 'o1', lines: [ln('l1', caseT('ct-ax9'), 2)] }),
      order(
        {
          id: 'o2',
          periods: [P('2027-06-10', '2027-06-10')],
          lines: [ln('l1', caseT('ct-ax9'), 2)],
        },
        2,
      ),
    );
    const input = lb({ itemId: 'charger', fromCaseId: 'case-1' });
    expect(loanPreview(s, T, input).hits.map((h) => h.bookingId)).toEqual(['o1']);
    const next = taken(s, { ...input, reason: 'Nutně' });
    // the June order is not disturbed by a loan of a few days
    expect(next.conflicts.map((c) => c.bookingId)).toEqual(['o1']);
  });

  it('a case that is away cannot be opened; a piece returned meanwhile stays loose', () => {
    const s = withBookings(
      baseState(),
      order({ id: 'o1', status: 'packing', lines: [ln('l1', caseT('ct-ax9'), 2)] }),
    );
    const lent = taken(s, {
      ...lb({ itemId: 'charger', fromCaseId: 'case-1' }),
      reason: 'Nutně',
    });
    const check = {
      ...standardCaseChecks(lent, ['case-1'])[0]!,
      counts: [
        { itemId: 'ax9', qty: 8 },
        { itemId: 'charger', qty: 7 },
        { itemId: 'psu', qty: 1 },
      ],
      reason: 'Půjčený kus',
    };
    const out = unwrap(
      packAndShip(lent, U.martin, T, 'o1', {
        label: 'a',
        lines: [{ lineId: 'l1', qty: 1, caseIds: ['case-1'], caseChecks: [check] }],
      }),
    );
    // known to be lent, so nothing is reported missing
    expect(out.issues).toEqual([]);
    expect(casesHere(out, 'charger', W.brod).map((c) => c.caseId)).toEqual(['case-2']);
    const back = unwrap(returnLoan(out, U.petr, T, out.loans[0]!.id));
    expect(isCaseComplete(back, back.cases[0]!)).toBe(false);
    expect(looseHere(back, 'charger', W.brod, T)).toBe(1);
  });
});
