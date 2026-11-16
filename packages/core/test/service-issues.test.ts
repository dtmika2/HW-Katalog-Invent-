import { describe, expect, it } from 'vitest';
import {
  buildHoldIndex,
  isServiceOverdue,
  itemDay,
  markRead,
  openIssues,
  archivedIssues,
  openServiceCase,
  openServiceCases,
  postMessage,
  resolveIssue,
  setServiceStatus,
  stockQty,
  thread,
  unreadCount,
  unwrap,
  type AppState,
} from '../src';
import { baseState, bk, caseT, item, ln, order, U, W, withBookings } from './helpers';

const T = '2027-04-20';
const free = (s: AppState, itemId: string, d = '2027-05-10') =>
  itemDay(s, buildHoldIndex(s), itemId, W.brod, d).free;

function withService(qty = 2) {
  const r = unwrap(
    openServiceCase(baseState(), U.martin, T, {
      itemId: 'ledbeam',
      warehouseId: W.brod,
      qty,
      reason: 'Nesvítí',
      expectedBack: '2027-05-04',
    }),
  );
  return { s: r.state, id: r.serviceCaseId };
}

describe('service', () => {
  it('opening blocks pieces immediately; default responsible person is the service manager', () => {
    const { s } = withService();
    expect(s.serviceCases[0]).toMatchObject({
      status: 'reported',
      responsibleUserId: U.karel.id,
      openedOn: T,
    });
    expect(free(s, 'ledbeam', T)).toBe(10);
    expect(
      s.notifications
        .filter((n) => n.type === 'service_opened')
        .map((n) => n.userId)
        .sort(),
    ).toEqual([U.karel.id, U.tomas.id].sort());
  });

  it('validates quantity and reason', () => {
    const s = baseState();
    expect(
      openServiceCase(s, U.petr, T, {
        itemId: 'ledbeam',
        warehouseId: W.brod,
        qty: 13,
        reason: 'x',
      }),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(
      openServiceCase(s, U.petr, T, {
        itemId: 'ledbeam',
        warehouseId: W.brod,
        qty: 1,
        reason: ' ',
      }),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(
      openServiceCase(s, U.petr, T, { itemId: 'ledbeam', warehouseId: W.brod, qty: 1, reason: 'x' })
        .ok,
    ).toBe(true);
  });

  it('status flow records who and when; only managers or the responsible person change it', () => {
    const { s, id } = withService();
    expect(setServiceStatus(s, U.petr, T, id, 'in_progress')).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    let s2 = unwrap(setServiceStatus(s, U.karel, T, id, 'in_progress', { comment: 'Rozebráno' }));
    s2 = unwrap(
      setServiceStatus(s2, U.karel, '2027-04-22', id, 'external', { repairShop: 'Servis Praha' }),
    );
    s2 = unwrap(setServiceStatus(s2, U.tomas, '2027-04-25', id, 'waiting_parts', { cost: 1200 }));
    s2 = unwrap(setServiceStatus(s2, U.karel, '2027-05-01', id, 'back_to_check'));
    expect(s2.serviceCases[0]).toMatchObject({
      internal: false,
      repairShop: 'Servis Praha',
      cost: 1200,
    });
    expect(s2.serviceCases[0]!.events.map((e) => e.status)).toEqual([
      'reported',
      'in_progress',
      'external',
      'waiting_parts',
      'back_to_check',
    ]);
    expect(free(s2, 'ledbeam')).toBe(10); // still out until fixed
  });

  it('fixed releases the pieces', () => {
    const { s, id } = withService();
    const s2 = unwrap(
      setServiceStatus(s, U.karel, '2027-05-01', id, 'fixed', { comment: 'Funguje' }),
    );
    expect(free(s2, 'ledbeam')).toBe(12);
    expect(openServiceCases(s2)).toHaveLength(0);
    expect(s2.notifications.some((n) => n.type === 'service_fixed')).toBe(true);
    expect(setServiceStatus(s2, U.karel, T, id, 'in_progress')).toMatchObject({
      ok: false,
      error: { code: 'invalid_state' },
    });
  });

  it('written_off permanently lowers stock', () => {
    const { s, id } = withService();
    const s2 = unwrap(setServiceStatus(s, U.tomas, T, id, 'written_off'));
    expect(stockQty(s2, 'ledbeam', W.brod)).toBe(10);
    expect(free(s2, 'ledbeam')).toBe(10);
  });

  it('written_off of a piece inside a case makes the case incomplete', () => {
    const r = unwrap(
      openServiceCase(baseState(), U.martin, T, {
        itemId: 'ax9',
        warehouseId: W.brod,
        qty: 1,
        reason: 'x',
        caseId: 'case-1',
      }),
    );
    const s2 = unwrap(setServiceStatus(r.state, U.tomas, T, r.serviceCaseId, 'written_off'));
    expect(s2.cases[0]!.contents.find((c) => c.itemId === 'ax9')?.qty).toBe(7);
    expect(s2.cases[0]!.incompleteSince).toBe(T);
  });

  it('overdue only warns, never releases', () => {
    const { s } = withService();
    const sc = s.serviceCases[0]!;
    expect(isServiceOverdue(sc, '2027-05-04')).toBe(false);
    expect(isServiceOverdue(sc, '2027-05-05')).toBe(true);
    expect(free(s, 'ledbeam', '2027-06-01')).toBe(10);
  });

  it('a service case affecting a future order notifies its PM and records a conflict', () => {
    const s0 = withBookings(
      baseState(),
      order({
        id: 'o1',
        eventName: 'Květen',
        pmId: U.lucie.id,
        lines: [ln('l1', item('ledbeam'), 12)],
      }),
    );
    const r = unwrap(
      openServiceCase(s0, U.martin, T, {
        itemId: 'ledbeam',
        warehouseId: W.brod,
        qty: 1,
        reason: 'Nesvítí',
      }),
    );
    expect(
      r.state.notifications.some(
        (n) => n.type === 'service_affects_order' && n.userId === U.lucie.id,
      ),
    ).toBe(true);
    expect(r.state.conflicts).toEqual([
      expect.objectContaining({ bookingId: 'o1', source: 'detected', shortQty: 1, status: 'new' }),
    ]);
    // fixing it resolves the conflict automatically
    const s2 = unwrap(setServiceStatus(r.state, U.karel, T, r.serviceCaseId, 'fixed'));
    expect(s2.conflicts[0]?.status).toBe('resolved');
  });
});

describe('issues', () => {
  function rwi() {
    const s = withBookings(
      baseState(),
      order({ id: 'o1', status: 'returned_with_issues', lines: [ln('l1', item('ledbeam'), 10)] }),
    );
    s.issues.push({
      id: 'iss-1',
      type: 'missing',
      itemId: 'ledbeam',
      qty: 2,
      bookingId: 'o1',
      lineId: 'l1',
      warehouseId: W.brod,
      reportedBy: U.martin.id,
      reportedOn: T,
    });
    s.issues.push({
      id: 'iss-2',
      type: 'unexpected',
      itemId: 'clamp',
      qty: 1,
      bookingId: 'o1',
      reportedBy: U.martin.id,
      reportedOn: T,
      note: 'x',
    });
    return s;
  }

  it('only the Chief resolves, with a written resolution', () => {
    expect(resolveIssue(rwi(), U.petr, T, 'iss-1', 'found', 'x')).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(resolveIssue(rwi(), U.tomas, T, 'iss-1', 'found', ' ')).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(resolveIssue(rwi(), U.tomas, T, 'nope', 'found', 'x')).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('found: stock unchanged, hold released, booking becomes returned', () => {
    const s = unwrap(resolveIssue(rwi(), U.tomas, T, 'iss-1', 'found', 'Našlo se v dodávce'));
    expect(stockQty(s, 'ledbeam', W.brod)).toBe(12);
    expect(free(s, 'ledbeam')).toBe(12);
    expect(s.bookings[0]!.status).toBe('returned');
    expect(openIssues(s).map((i) => i.id)).toEqual(['iss-2']);
    expect(archivedIssues(s)[0]).toMatchObject({
      resolution: 'Našlo se v dodávce',
      resolvedBy: U.tomas.id,
      archivedOn: T,
    });
    expect(resolveIssue(s, U.tomas, T, 'iss-1', 'found', 'x')).toMatchObject({
      ok: false,
      error: { code: 'invalid_state' },
    });
  });

  it('written off / charged to client lowers stock', () => {
    const s = unwrap(
      resolveIssue(rwi(), U.tomas, T, 'iss-1', 'charged_to_client', 'Fakturováno klientovi'),
    );
    expect(stockQty(s, 'ledbeam', W.brod)).toBe(10);
    expect(free(s, 'ledbeam')).toBe(10);
  });

  it('a whole missing case written off lowers stock of its contents and archives the case', () => {
    const s0 = withBookings(
      baseState(),
      order({ id: 'o1', status: 'returned_with_issues', lines: [ln('l1', caseT('ct-ax9'), 1)] }),
    );
    s0.issues.push({
      id: 'iss-1',
      type: 'missing',
      caseId: 'case-1',
      qty: 1,
      bookingId: 'o1',
      lineId: 'l1',
      reportedBy: U.martin.id,
      reportedOn: T,
    });
    const s = unwrap(resolveIssue(s0, U.tomas, T, 'iss-1', 'written_off', 'Ztraceno'));
    expect(stockQty(s, 'ax9', W.brod)).toBe(12);
    expect(s.cases[0]!.archived).toBe(true);
  });
});

describe('notifications and thread', () => {
  it('messages, unread count and mark read', () => {
    let s = withBookings(baseState(), bk({ id: 'd1' }));
    s = postMessage(s, U.petr, 'd1', 'Venkovní stage, 200 lidí', T);
    expect(postMessage(s, U.petr, 'd1', '  ', T)).toBe(s);
    expect(thread(s, 'd1').map((m) => m.text)).toEqual(['Venkovní stage, 200 lidí']);
    s = unwrap(
      openServiceCase(s, U.martin, T, {
        itemId: 'hazer',
        warehouseId: W.brod,
        qty: 1,
        reason: 'x',
      }),
    ).state;
    expect(unreadCount(s, U.tomas.id)).toBe(1);
    s = markRead(s, U.tomas.id);
    expect(unreadCount(s, U.tomas.id)).toBe(0);
    expect(unreadCount(s, U.karel.id)).toBe(1);
    const id = s.notifications.find((n) => n.userId === U.karel.id)!.id;
    expect(unreadCount(markRead(s, U.karel.id, [id]), U.karel.id)).toBe(0);
  });
});
