/** What a PM may do about a conflict: rent, propose going over it, solve it on an approved order. */
import { describe, expect, it } from 'vitest';
import {
  acceptOverride,
  can,
  cancelBooking,
  confirmBooking,
  coverWithExternal,
  detectConflicts,
  isOverridden,
  isProposedOverride,
  packLines,
  recomputeConflictRecords,
  resolveShortage,
  saveBooking,
  setOverrideReason,
  shipBatch,
  solvableShortages,
  submitPrebooking,
  ackConflict,
  unwrap,
  type AppState,
  type Booking,
  type ShortageFix,
  type User,
} from '../src';
import { baseState, bk, item, ln, order, P, TODAY as T, U, W, withBookings } from './helpers';

const get = (s: AppState, id = 'me') => s.bookings.find((b) => b.id === id)!;
const put = (s: AppState, b: Booking): AppState => ({
  ...s,
  bookings: s.bookings.map((x) => (x.id === b.id ? b : x)),
});
const told = (s: AppState, type: string) =>
  s.notifications
    .filter((n) => n.type === type)
    .map((n) => n.userId)
    .sort();
const events = (s: AppState) =>
  s.messages.filter((m) => m.bookingId === 'me' && m.event).map((m) => m.event!.type);

/** Petr asks for 2 hazers, an approved order holds one of the two. */
const pre = () =>
  withBookings(
    baseState(),
    bk({ id: 'me', status: 'submitted', lines: [ln('l1', item('hazer'), 2)] }),
    order({ id: 'o', pmId: U.jana.id, lines: [ln('l1', item('hazer'), 1)] }),
  );
const propose = (s: AppState, reason = 'Druhý půjčí kolega', user: User = U.petr) =>
  unwrap(saveBooking(s, user, T, setOverrideReason(get(s), 'l1', reason, user)));
const line = (s: AppState) => get(s).lines.find((l) => l.id === 'l1')!;

describe('before approval', () => {
  it('rights: the Chief and the PM of the booking, nobody else', () => {
    const b = get(pre());
    for (const a of ['cover_external', 'propose_override'] as const) {
      expect([U.tomas, U.petr].map((u) => can(u, a, b))).toEqual([true, true]);
      expect([U.lucie, U.martin, U.admin].map((u) => can(u, a, b))).toEqual([false, false, false]);
    }
  });

  it('a PM without permission covers the shortage with a rental', () => {
    const s = pre();
    const b = coverWithExternal(s, get(s), 'l1', 1, {
      supplier: 'Kamarádi AV',
      pickup: T,
      returnDate: T,
    });
    const saved = unwrap(saveBooking(s, U.petr, T, b));
    expect(detectConflicts(saved, get(saved))).toEqual([]);
    expect(confirmBooking(saved, U.tomas, T, 'me').ok).toBe(true);
  });

  it('a PM without permission proposes; it does not let the order through', () => {
    const s = propose(pre());
    expect(line(s)).toMatchObject({
      overrideReason: 'Druhý půjčí kolega',
      overrideProposedBy: U.petr.id,
    });
    expect([isProposedOverride(line(s)), isOverridden(line(s))]).toEqual([true, false]);
    expect(confirmBooking(s, U.tomas, T, 'me')).toMatchObject({
      error: { code: 'blocking_conflicts', details: { lineIds: ['l1'] } },
    });
  });

  it('the Chief accepts it; the conflict record names both', () => {
    const s = propose(pre());
    const accepted = unwrap(saveBooking(s, U.tomas, T, acceptOverride(get(s), 'l1', U.tomas)));
    expect(line(accepted).overrideAcceptedBy).toBe(U.tomas.id);
    const done = unwrap(confirmBooking(accepted, U.tomas, T, 'me'));
    expect(done.conflicts[0]).toMatchObject({
      overrideReason: 'Druhý půjčí kolega',
      proposedBy: U.petr.id,
      acceptedBy: U.tomas.id,
    });
  });

  it('the Chief may rewrite it instead; that is a decision of their own', () => {
    const s = propose(pre());
    const own = unwrap(
      saveBooking(s, U.tomas, T, setOverrideReason(get(s), 'l1', 'Domluveno', U.tomas)),
    );
    expect(line(own)).not.toHaveProperty('overrideProposedBy');
    const done = unwrap(confirmBooking(own, U.tomas, T, 'me'));
    expect(done.conflicts[0]).not.toHaveProperty('proposedBy');
  });

  it('a changed reason has to be accepted again, an unchanged one stays accepted', () => {
    const s = propose(pre());
    const ok = unwrap(saveBooking(s, U.tomas, T, acceptOverride(get(s), 'l1', U.tomas)));
    const same = unwrap(saveBooking(ok, U.petr, T, { ...get(ok), eventName: 'Nový název' }));
    expect(isOverridden(line(same))).toBe(true);
    expect(isProposedOverride(line(propose(ok, 'Jinak')))).toBe(true);
    const back = unwrap(saveBooking(ok, U.tomas, T, acceptOverride(get(ok), 'l1', U.tomas, false)));
    expect(isOverridden(line(back))).toBe(false);
  });

  it('a PM cannot accept their own proposal, nor pass it off as a decision', () => {
    const s = propose(pre());
    const forged = { ...line(s), overrideAcceptedBy: U.tomas.id };
    expect(
      isOverridden(line(unwrap(saveBooking(s, U.petr, T, { ...get(s), lines: [forged] })))),
    ).toBe(false);
    const plain = setOverrideReason(get(pre()), 'l1', 'Bez návrhu');
    const saved = unwrap(saveBooking(pre(), U.petr, T, plain));
    expect(line(saved).overrideProposedBy).toBe(U.petr.id);
  });

  it('a PM who may approve decides directly, as before', () => {
    const s = put(pre(), { ...get(pre()), pmId: U.jana.id });
    const own = propose(s, 'Domluveno', U.jana);
    expect(isOverridden(line(own))).toBe(true);
    expect(confirmBooking(own, U.jana, T, 'me').ok).toBe(true);
  });

  it('reasons saved before proposals existed stay valid', () => {
    const s = put(pre(), {
      ...get(pre()),
      lines: [ln('l1', item('hazer'), 2, { overrideReason: 'Starý důvod' })],
    });
    expect(confirmBooking(s, U.tomas, T, 'me').ok).toBe(true);
  });

  it('sending for approval works with a proposal, the conflict still has to be seen', () => {
    const s0 = put(pre(), { ...get(pre()), status: 'draft' });
    const s = propose(s0);
    expect(submitPrebooking(s, U.petr, T, 'me')).toMatchObject({
      error: { code: 'conflict_unacknowledged' },
    });
    const seen = unwrap(saveBooking(s, U.petr, T, ackConflict(get(s), 'l1')));
    expect(submitPrebooking(seen, U.petr, T, 'me').ok).toBe(true);
  });
});

describe('on an approved order', () => {
  const ext = (qty = 1, extra = {}): ShortageFix => ({
    kind: 'external',
    qty,
    supplier: 'Kamarádi AV',
    pickup: '2027-04-22',
    returnDate: '2027-04-25',
    ...extra,
  });
  /** Petr's order for 10 LEDBeams (12 in Brod, 4 in Karlák) confirmed after one for 5. */
  const short = (extra: Partial<Booking> = {}) =>
    recomputeConflictRecords(
      withBookings(
        baseState(),
        order({ id: 'o', pmId: U.jana.id, lines: [ln('l1', item('ledbeam'), 5)] }, 1),
        order({ id: 'me', pmId: U.petr.id, lines: [ln('l1', item('ledbeam'), 10)], ...extra }, 2),
      ),
      T,
    );
  const fix = (s: AppState, f: ShortageFix, u: User = U.petr, id = 'l1') =>
    resolveShortage(s, u, T, 'me', id, f);

  it('its PM rents what is missing; the record closes, Chief and warehouse are told', () => {
    const s = short();
    expect(s.conflicts).toMatchObject([{ bookingId: 'me', status: 'new', shortQty: 3 }]);
    expect(solvableShortages(s, U.petr, get(s)).map((c) => c.lineId)).toEqual(['l1']);
    const r = unwrap(fix(s, ext(3)));
    expect(line(r).qty).toBe(7);
    expect(get(r).lines.find((l) => 'external' in l.target)).toMatchObject({ qty: 3 });
    expect(get(r)).toMatchObject({ status: 'confirmed', type: 'order' });
    expect(r.conflicts[0]).toMatchObject({ status: 'resolved', resolution: 'auto' });
    expect(told(r, 'shortage_solved')).toEqual([U.tomas.id, U.martin.id, U.karel.id].sort());
    expect(events(r)).toContain('shortage_solved');
    expect(fix(r, ext(1))).toMatchObject({ error: { code: 'invalid_state' } });
  });

  it('or takes it from the other warehouse, when no order (also a later one) holds it there', () => {
    const r = unwrap(fix(short(), { kind: 'warehouse', qty: 3, warehouseId: W.karlak }));
    expect(get(r).lines.find((l) => l.sourceWarehouseId === W.karlak)).toMatchObject({ qty: 3 });
    expect(detectConflicts(r, get(r))).toEqual([]);
    const busy = withBookings(
      short(),
      order({ id: 'k', lines: [ln('l1', item('ledbeam'), 3, { sourceWarehouseId: W.karlak })] }, 3),
    );
    expect(fix(busy, { kind: 'warehouse', qty: 3, warehouseId: W.karlak })).toMatchObject({
      error: { code: 'validation', details: { field: 'warehouseId' } },
    });
  });

  it('only what is missing, with a supplier and sensible dates, only on a short line', () => {
    const s = short();
    expect(fix(s, ext(4))).toMatchObject({ error: { details: { field: 'qty', short: 3 } } });
    expect(fix(s, ext(0))).toMatchObject({ error: { details: { field: 'qty' } } });
    expect(fix(s, ext(1, { supplier: ' ' }))).toMatchObject({
      error: { details: { field: 'supplier' } },
    });
    expect(fix(s, ext(1, { returnDate: '2027-04-01' }))).toMatchObject({
      error: { details: { field: 'returnDate' } },
    });
    expect(fix(s, ext(1), U.petr, 'nope')).toMatchObject({ error: { code: 'invalid_state' } });
  });

  it('never more than the line asks for, however overbooked the item is', () => {
    const s = recomputeConflictRecords(
      withBookings(
        baseState(),
        order({ id: 'o', lines: [ln('l1', item('ledbeam'), 10)] }, 1),
        order({ id: 'o2', lines: [ln('l1', item('ledbeam'), 10)] }, 2),
        order({ id: 'me', pmId: U.petr.id, lines: [ln('l1', item('ledbeam'), 3)] }, 3),
      ),
      T,
    );
    expect(solvableShortages(s, U.petr, get(s))[0]!.short).toBe(11);
    expect(fix(s, ext(4))).toMatchObject({ error: { details: { field: 'qty', short: 3 } } });
    const r = unwrap(fix(s, ext(3)));
    expect(get(r).lines).toMatchObject([{ qty: 3, target: { external: {} } }]);
  });

  it('the rest of the approved order stays locked for its PM', () => {
    const s = short();
    expect(saveBooking(s, U.petr, T, get(s))).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('the Chief may too; other PMs, warehouse and admin may not', () => {
    const s = short();
    expect(fix(s, ext(3), U.tomas).ok).toBe(true);
    for (const u of [U.lucie, U.jana, U.martin, U.admin]) {
      expect(fix(s, ext(3), u)).toMatchObject({ error: { code: 'forbidden' } });
      expect(solvableShortages(s, u, get(s))).toEqual([]);
    }
  });

  it('while packing the warehouse hears it with high priority; the status follows the list', () => {
    const s = short({ status: 'packing' });
    const packed = unwrap(packLines(s, U.martin, '2027-04-22', 'me', [{ lineId: 'l1', qty: 7 }]));
    expect(get(packed).status).toBe('packing');
    const r = unwrap(fix(packed, ext(3)));
    // the rental still has to be packed or promised
    expect(get(r).status).toBe('packing');
    const toWarehouse = r.notifications.filter(
      (n) => n.type === 'shortage_solved' && n.userId === U.martin.id,
    );
    expect(toWarehouse).toMatchObject([{ highPriority: true }]);
    expect(
      r.notifications.find((n) => n.type === 'shortage_solved' && n.userId === U.tomas.id),
    ).not.toHaveProperty('highPriority');
  });

  it('not once anything of the line has left, nor when the event is cancelled', () => {
    const s = short({ status: 'packing' });
    const packed = unwrap(packLines(s, U.martin, '2027-04-22', 'me', [{ lineId: 'l1', qty: 7 }]));
    const left = unwrap(
      shipBatch(packed, U.martin, '2027-04-22', 'me', {
        label: 'D1',
        lines: [{ lineId: 'l1', qty: 2 }],
      }),
    );
    expect(solvableShortages(left, U.petr, get(left))).toEqual([]);
    expect(fix(left, ext(1))).toMatchObject({ error: { code: 'invalid_state' } });
    const pending = unwrap(cancelBooking(packed, U.tomas, T, 'me', 'x'));
    expect(fix(pending, ext(1))).toMatchObject({ error: { code: 'invalid_state' } });
  });

  it('a conflict that appears later on several periods is solved the same way', () => {
    const s = short({ periods: [P('2027-04-23', '2027-04-24'), P('2027-05-23', '2027-05-24')] });
    expect(fix(s, ext(3)).ok).toBe(true);
  });
});
