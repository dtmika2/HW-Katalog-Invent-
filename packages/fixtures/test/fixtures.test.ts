import { describe, expect, it } from 'vitest';
import {
  buildHoldIndex,
  caseDay,
  caseMissing,
  evaluateBooking,
  expand,
  isServiceOverdue,
  itemCalendar,
  itemDay,
  recordReturnSession,
  unwrap,
  type AppState,
  type Booking,
} from '@quix/core';
import {
  BREAKING,
  caseBreaking,
  CHAIN,
  conflictChain,
  DEMO_TODAY,
  GALA_ID,
  GALA_STEPS,
  galaDinner,
  generateState,
  SCENARIOS,
  TRANSFER,
  transfer,
} from '../src';

const base = generateState();
const get = (s: AppState, id: string) => s.bookings.find((b) => b.id === id) as Booking;

describe('fixtures — consistency', () => {
  it('generator is deterministic', () => {
    expect(JSON.stringify(generateState())).toBe(JSON.stringify(base));
  });

  it('has the planned size', () => {
    expect(base.users).toHaveLength(8);
    expect(base.items.length).toBeGreaterThanOrEqual(140);
    expect(base.caseTypes.length).toBeGreaterThanOrEqual(12);
    expect(base.cases.length).toBeGreaterThanOrEqual(30);
    expect(base.connections.length).toBeGreaterThanOrEqual(80);
    expect(base.clients).toHaveLength(10);
    expect(base.bookings.length).toBeGreaterThanOrEqual(30);
    expect(base.locations.length).toBeGreaterThanOrEqual(40);
    expect(base.serviceCases).toHaveLength(5);
  });

  it('all references resolve', () => {
    const items = new Set(base.items.map((i) => i.id));
    const caseTypes = new Set(base.caseTypes.map((t) => t.id));
    const locs = new Set(base.locations.map((l) => l.id));
    const users = new Set(base.users.map((u) => u.id));
    const clients = new Set(base.clients.map((c) => c.id));
    const cats = new Set(base.categories.map((c) => c.id));
    for (const i of base.items) expect(cats.has(i.categoryId)).toBe(true);
    for (const st of base.stock) {
      expect(items.has(st.itemId)).toBe(true);
      expect(locs.has(st.homeLocationId)).toBe(true);
      const loc = base.locations.find((l) => l.id === st.homeLocationId);
      expect(loc?.warehouseId).toBe(st.warehouseId);
    }
    for (const t of base.caseTypes)
      for (const c of t.contents) expect(items.has(c.itemId)).toBe(true);
    for (const c of base.cases) {
      expect(caseTypes.has(c.caseTypeId)).toBe(true);
      expect(locs.has(c.locationId)).toBe(true);
    }
    for (const c of base.connections) {
      expect(items.has(c.fromItemId)).toBe(true);
      expect(
        'itemId' in c.target ? items.has(c.target.itemId) : caseTypes.has(c.target.caseTypeId),
      ).toBe(true);
    }
    for (const b of base.bookings) {
      expect(users.has(b.pmId)).toBe(true);
      expect(clients.has(b.clientId ?? '')).toBe(true);
      for (const l of b.lines) {
        if ('itemId' in l.target) expect(items.has(l.target.itemId)).toBe(true);
        if ('caseTypeId' in l.target) expect(caseTypes.has(l.target.caseTypeId)).toBe(true);
      }
    }
    for (const sc of base.serviceCases) expect(users.has(sc.responsibleUserId)).toBe(true);
  });

  it('stock covers the contents of the cases in each warehouse', () => {
    for (const st of base.stock) {
      const inCases = base.cases
        .filter((c) => c.warehouseId === st.warehouseId)
        .reduce((n, c) => n + (c.contents.find((x) => x.itemId === st.itemId)?.qty ?? 0), 0);
      expect(st.qty, `${st.itemId}@${st.warehouseId}`).toBeGreaterThanOrEqual(inCases);
    }
  });

  it('no negative availability on today', () => {
    const idx = buildHoldIndex(base);
    for (const st of base.stock) {
      expect(
        itemDay(base, idx, st.itemId, st.warehouseId, DEMO_TODAY).free,
        `${st.itemId}@${st.warehouseId}`,
      ).toBeGreaterThanOrEqual(0);
    }
    for (const t of base.caseTypes) {
      for (const w of base.warehouses) {
        expect(
          caseDay(base, idx, t.id, w.id, DEMO_TODAY).free,
          `${t.id}@${w.id}`,
        ).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('covers every booking state and the special cases', () => {
    const statuses = new Set(base.bookings.map((b) => b.status));
    for (const s of [
      'draft',
      'submitted',
      'expired',
      'confirmed',
      'packing',
      'shipped',
      'returning',
      'returned',
      'returned_with_issues',
      'closed',
    ]) {
      expect(statuses.has(s as Booking['status']), s).toBe(true);
    }
    expect(base.bookings.filter((b) => b.status === 'expired')).toHaveLength(2);
    expect(base.bookings.filter((b) => b.status === 'returned_with_issues')).toHaveLength(1);
    expect(base.bookings.some((b) => b.periods.length > 1)).toBe(true);
    expect(
      base.bookings.some(
        (b) =>
          b.lines.some((l) => l.sourceWarehouseId === 'wh-karlak') &&
          b.defaultWarehouseId === 'wh-brod',
      ),
    ).toBe(true);
    expect(
      base.bookings.filter((b) => b.lines.some((l) => l.fromBookingId)).map((b) => b.id),
    ).toEqual([TRANSFER.to]);
    expect(
      base.bookings.filter((b) => b.lines.some((l) => 'external' in l.target)).length,
    ).toBeGreaterThanOrEqual(2);
    const dates = base.bookings.flatMap((b) => b.periods.map((p) => p.eventFrom)).sort();
    expect(dates[0]! >= '2027-03-01' && dates.at(-1)! <= '2027-06-30').toBe(true);
  });

  it('service cases are in different states, one overdue', () => {
    expect(new Set(base.serviceCases.map((s) => s.status)).size).toBeGreaterThanOrEqual(4);
    expect(base.serviceCases.filter((s) => isServiceOverdue(s, DEMO_TODAY))).toHaveLength(1);
  });

  it('at least two cases start incomplete', () => {
    expect(base.cases.filter((c) => caseMissing(base, c).length > 0).length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('connections cover every kind and rule, including a nested group and a cycle', () => {
    const cs = base.connections;
    expect(new Set(cs.map((c) => c.kind))).toEqual(new Set(['required', 'check', 'recommended']));
    expect(new Set(cs.map((c) => c.rule))).toEqual(
      new Set(['per_piece', 'per_n', 'once_per_order']),
    );
    expect(cs.some((c) => c.groupMode === 'or')).toBe(true);
    expect(cs.some((c) => c.parentGroupId)).toBe(true);
    expect(cs.some((c) => 'caseTypeId' in c.target)).toBe(true);
    const r = expand(
      [
        {
          id: 'm',
          target: { itemId: 'tv-65' },
          qty: 1,
          origin: 'manual',
          parentLineIds: [],
          status: 'ok',
          conflictAck: false,
        },
      ],
      base,
    );
    expect(r.cycleWarnings.length).toBeGreaterThan(0);
    // shared desk: LEDBeam + Rogue → one desk
    const shared = expand(
      [
        {
          id: 'a',
          target: { itemId: 'ledbeam150' },
          qty: 4,
          origin: 'manual',
          parentLineIds: [],
          status: 'ok',
          conflictAck: false,
        },
        {
          id: 'b',
          target: { itemId: 'rogue-r2' },
          qty: 4,
          origin: 'manual',
          parentLineIds: [],
          status: 'ok',
          conflictAck: false,
        },
      ],
      base,
    );
    expect(
      shared.lines
        .filter((l) => 'itemId' in l.target && l.target.itemId === 'grandma3-compact')
        .map((l) => l.qty),
    ).toEqual([1]);
  });

  it('there is something unread for the demo', () => {
    expect(base.notifications.some((n) => !n.read)).toBe(true);
  });

  it('every scenario builds', () => {
    for (const sc of SCENARIOS) expect(sc.build().bookings.length).toBeGreaterThanOrEqual(30);
  });
});

describe('scenario galaDinner (full dataset)', () => {
  it('replays the concept’s model scenario step by step', () => {
    let s = GALA_STEPS.create(galaDinner());
    const gala = get(s, GALA_ID);
    const autos = gala.lines
      .filter((l) => l.origin === 'auto')
      .map((l) => ('itemId' in l.target ? l.target.itemId : ''));
    expect(autos).toEqual(expect.arrayContaining(['desk-power', 'cat6-50', 'router']));
    const ax9Line = gala.lines.find(
      (l) => 'caseTypeId' in l.target && l.target.caseTypeId === 'ct-ax9',
    )!;
    const av = evaluateBooking(s, gala).get(ax9Line.id)!;
    expect(av).toMatchObject({ badge: 'red', short: 1 });
    const colliding = av.collidingBookingIds.map((id) => get(s, id));
    expect(colliding.map((b) => [b.eventName, b.pmId])).toEqual([['Firemní den', 'u-jana']]);
    const checks = expand(gala.lines, s, { previous: gala.lines }).checkWarnings;
    expect(checks.map((c) => c.fromItemId)).toContain('ax9-psu');

    s = GALA_STEPS.submit(s);
    expect(get(s, GALA_ID).status).toBe('submitted');
    s = GALA_STEPS.confirm(s);
    expect(get(s, GALA_ID)).toMatchObject({ type: 'order', status: 'confirmed' });
    expect(get(s, GALA_ID).lines.find((l) => 'external' in l.target)?.qty).toBe(8);
    expect(s.conflicts.filter((c) => c.bookingId === GALA_ID)).toHaveLength(0);

    s = GALA_STEPS.ship(s);
    expect(s.shipments.filter((x) => x.bookingId === GALA_ID).map((x) => x.label)).toEqual([
      'Dodávka 1',
      'Dodávka 2',
    ]);
    expect(
      s.notifications.filter(
        (n) => n.type === 'batch_shipped' && n.userId === 'u-petr' && n.bookingId === GALA_ID,
      ),
    ).toHaveLength(2);

    s = GALA_STEPS.vratka(s);
    expect(get(s, GALA_ID).status).toBe('returned_with_issues');
    expect(s.issues.filter((i) => i.bookingId === GALA_ID && !i.archivedOn)).toEqual([
      expect.objectContaining({ itemId: 'desk-power', qty: 1 }),
    ]);

    const svc = GALA_STEPS.service(s);
    s = svc.state;
    expect(
      evaluateBooking(s, get(s, 'bk-kveten')).get(
        get(s, 'bk-kveten').lines.find(
          (l) => 'caseTypeId' in l.target && l.target.caseTypeId === 'ct-ax9',
        )!.id,
      )?.badge,
    ).toBe('red');
    expect(
      s.notifications.some(
        (n) => n.type === 'service_affects_order' && n.bookingId === 'bk-kveten',
      ),
    ).toBe(true);
    expect(s.conflicts.some((c) => c.bookingId === 'bk-kveten' && c.status === 'new')).toBe(true);

    s = GALA_STEPS.fix(s, svc.serviceCaseId);
    expect(s.conflicts.find((c) => c.bookingId === 'bk-kveten')?.status).toBe('resolved');
  });
});

describe('scenario conflictChain', () => {
  const s = conflictChain();

  it('LEDBeam calendar (Brod) shows exact free counts and soft holds', () => {
    const cal = itemCalendar(s, 'ledbeam150', '2027-06-06', '2027-06-13', 'wh-brod');
    expect(cal.map((d) => d.free)).toEqual([16, 6, 6, -2, -2, 8, 8, 16]);
    expect(cal.map((d) => d.softHeld)).toEqual([0, 0, 0, 0, 6, 6, 6, 6]);
  });

  it('the worst day lists all three bookings', () => {
    const day = itemCalendar(s, 'ledbeam150', '2027-06-10', '2027-06-10', 'wh-brod')[0]!;
    expect(day.holders.map((h) => h.bookingId).sort()).toEqual([CHAIN.a, CHAIN.b, CHAIN.c].sort());
  });

  it('B carries a conflict record; C is amber/red for Jana', () => {
    expect(s.conflicts.filter((c) => c.status !== 'resolved')).toEqual([
      expect.objectContaining({ bookingId: CHAIN.b, shortQty: 2, source: 'override' }),
    ]);
    expect(evaluateBooking(s, get(s, CHAIN.c)).get(get(s, CHAIN.c).lines[0]!.id)).toMatchObject({
      badge: 'red',
      short: 8,
    });
  });
});

describe('scenario transfer', () => {
  it('holds without a gap and hands over in vratka', () => {
    let s = transfer();
    const idx = buildHoldIndex(s);
    for (const d of ['2027-04-20', '2027-04-21', '2027-04-22', '2027-04-25']) {
      expect(itemDay(s, idx, 'ledbeam150', 'wh-brod', d).hardHeld, d).toBeGreaterThanOrEqual(8);
    }
    const martin = s.users.find((u) => u.id === 'u-martin')!;
    const line = get(s, TRANSFER.from).lines.find(
      (l) => 'itemId' in l.target && l.target.itemId === 'ledbeam150',
    )!;
    s = unwrap(
      recordReturnSession(s, martin, DEMO_TODAY, TRANSFER.from, {
        lines: [
          {
            lineId: line.id,
            returnedQty: 0,
            transferredQty: 8,
            transferredToBookingId: TRANSFER.to,
            confirmed: true,
            condition: 'ok',
          },
        ],
      }),
    );
    const planned = get(s, TRANSFER.to).lines.find((l) => l.fromBookingId === TRANSFER.from)!;
    expect(planned.transferredOn).toBe(DEMO_TODAY);
    expect(
      s.shipments.some(
        (x) => x.bookingId === TRANSFER.to && x.transferFromBookingId === TRANSFER.from,
      ),
    ).toBe(true);
  });
});

describe('scenario caseBreaking', () => {
  it('loose AX1 that would break the cases booked whole shows amber "rozbije case"', () => {
    const s = caseBreaking();
    const y = get(s, BREAKING.y);
    const a = evaluateBooking(s, y).get(y.lines[0]!.id)!;
    expect(a.badge).toBe('amber');
    expect(a.breaksCase).toEqual({ caseTypeId: 'ct-ax1', bookingIds: [BREAKING.x] });
  });
});
