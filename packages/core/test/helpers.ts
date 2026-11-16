/** Small hand-made catalogue for unit tests (independent of the fixtures package). */
import {
  emptyState,
  type AppState,
  type Booking,
  type BookingLine,
  type BookingPeriod,
  type Connection,
  type LineTarget,
  type User,
} from '../src';

const perms = (p: Partial<User['perms']> = {}): User['perms'] => ({
  canConfirmOwnOrders: false,
  canEditCatalogue: false,
  canManageService: false,
  ...p,
});

export const U = {
  tomas: {
    id: 'u-tomas',
    name: 'Tomáš',
    role: 'chief',
    perms: perms({ canEditCatalogue: true, canManageService: true }),
    active: true,
  },
  jana: {
    id: 'u-jana',
    name: 'Jana Nováková',
    role: 'pm',
    perms: perms({ canConfirmOwnOrders: true }),
    active: true,
  },
  petr: { id: 'u-petr', name: 'Petr Dvořák', role: 'pm', perms: perms(), active: true },
  lucie: { id: 'u-lucie', name: 'Lucie Malá', role: 'pm', perms: perms(), active: true },
  martin: { id: 'u-martin', name: 'Martin', role: 'warehouse', perms: perms(), active: true },
  karel: {
    id: 'u-karel',
    name: 'Karel',
    role: 'warehouse',
    perms: perms({ canManageService: true }),
    active: true,
  },
  admin: { id: 'u-admin', name: 'Admin', role: 'admin', perms: perms(), active: true },
} satisfies Record<string, User>;

export const W = { brod: 'wh-brod', karlak: 'wh-karlak' };
export const L = { brodA: 'loc-b-a1', brodB: 'loc-b-b1', karlakA: 'loc-k-a1' };

const mkItem = (id: string, name: string, priceDay: number, returnable = true) => ({
  id,
  name,
  manufacturer: 'Test',
  model: name,
  categoryId: 'cat',
  priceDay,
  returnable,
  archived: false,
});

const req = (
  id: string,
  from: string,
  to: string,
  extra: Partial<Connection> = {},
): Connection => ({
  id,
  fromItemId: from,
  target: { itemId: to },
  kind: 'required',
  rule: 'per_piece',
  qty: 1,
  ...extra,
});

/**
 * Items: ledbeam (12 Brod + 4 Karlák), rogue (8), clamp (40), stand (10), rope (40),
 * splitter (6), desk (2), deskpower (4), powercon (30), adapter (10), lamp, hazer (2),
 * tape (consumable), ax9 (24 Brod in 2 cases + 8 loose... see cases), charger, psu,
 * par (nested group), cyA/cyB (cycle).
 */
export function baseState(): AppState {
  const s = emptyState();
  s.users = Object.values(U);
  s.warehouses = [
    { id: W.brod, name: 'Brod' },
    { id: W.karlak, name: 'Karlák' },
  ];
  s.locations = [
    { id: L.brodA, warehouseId: W.brod, name: 'A1', path: 'Brod / A / 1' },
    { id: L.brodB, warehouseId: W.brod, name: 'B1', path: 'Brod / B / 1' },
    { id: L.karlakA, warehouseId: W.karlak, name: 'A1', path: 'Karlák / A / 1' },
  ];
  s.categories = [{ id: 'cat', name: 'Test' }];
  s.items = [
    mkItem('ledbeam', 'Robe LEDBeam 150', 450),
    mkItem('rogue', 'Chauvet Rogue R2', 500),
    mkItem('clamp', 'Clamp', 20),
    mkItem('stand', 'Floor stand', 50),
    mkItem('rope', 'Safety rope', 10),
    mkItem('splitter', 'DMX splitter', 150),
    mkItem('desk', 'Lighting desk', 2000),
    mkItem('deskpower', 'Desk power cable', 20),
    mkItem('powercon', 'PowerCON cable', 30),
    mkItem('adapter', 'PowerCON–Schuko adapter', 20),
    mkItem('lamp', 'Spare lamp', 100),
    mkItem('hazer', 'Hazer', 800),
    mkItem('tape', 'Gaffer tape', 150, false),
    mkItem('ax9', 'Astera AX9 PowerPAR', 600),
    mkItem('charger', 'AX9 charger plate', 50),
    mkItem('psu', 'AX9 PSU', 100),
    mkItem('par', 'LED PAR', 200),
    mkItem('cyA', 'Cycle A', 1),
    mkItem('cyB', 'Cycle B', 1),
  ];
  const st = (itemId: string, w: string, qty: number) => ({
    itemId,
    warehouseId: w,
    qty,
    homeLocationId: w === W.brod ? L.brodA : L.karlakA,
  });
  s.stock = [
    st('ledbeam', W.brod, 12),
    st('ledbeam', W.karlak, 4),
    st('rogue', W.brod, 8),
    st('clamp', W.brod, 40),
    st('stand', W.brod, 10),
    st('rope', W.brod, 40),
    st('splitter', W.brod, 6),
    st('desk', W.brod, 2),
    st('deskpower', W.brod, 4),
    st('powercon', W.brod, 30),
    st('adapter', W.brod, 10),
    st('lamp', W.brod, 10),
    st('hazer', W.brod, 2),
    st('tape', W.brod, 20),
    st('ax9', W.brod, 20),
    st('charger', W.brod, 16),
    st('psu', W.brod, 2),
    st('ax9', W.karlak, 8),
    st('charger', W.karlak, 8),
    st('psu', W.karlak, 1),
    st('par', W.brod, 20),
    st('cyA', W.brod, 5),
    st('cyB', W.brod, 5),
  ];
  s.caseTypes = [
    {
      id: 'ct-ax9',
      name: 'AX9 case',
      contents: [
        { itemId: 'ax9', qty: 8 },
        { itemId: 'charger', qty: 8 },
        { itemId: 'psu', qty: 1 },
      ],
    },
  ];
  const full = [
    { itemId: 'ax9', qty: 8 },
    { itemId: 'charger', qty: 8 },
    { itemId: 'psu', qty: 1 },
  ];
  // Brod: 2 cases (16 AX9 inside) + 4 loose AX9. Karlák: 1 case.
  s.cases = [
    {
      id: 'case-1',
      caseTypeId: 'ct-ax9',
      number: 'AX9-01',
      warehouseId: W.brod,
      locationId: L.brodB,
      contents: full.map((x) => ({ ...x })),
    },
    {
      id: 'case-2',
      caseTypeId: 'ct-ax9',
      number: 'AX9-02',
      warehouseId: W.brod,
      locationId: L.brodB,
      contents: full.map((x) => ({ ...x })),
    },
    {
      id: 'case-3',
      caseTypeId: 'ct-ax9',
      number: 'AX9-03',
      warehouseId: W.karlak,
      locationId: L.karlakA,
      contents: full.map((x) => ({ ...x })),
    },
  ];
  s.connections = [
    // LEDBeam: (clamp OR stand) per piece, rope per piece, splitter per 8, desk once
    req('c-lb-clamp', 'ledbeam', 'clamp', { groupId: 'lb-mount', groupMode: 'or' }),
    req('c-lb-stand', 'ledbeam', 'stand', { groupId: 'lb-mount', groupMode: 'or' }),
    req('c-lb-rope', 'ledbeam', 'rope'),
    req('c-lb-split', 'ledbeam', 'splitter', { rule: 'per_n', n: 8 }),
    req('c-lb-desk', 'ledbeam', 'desk', { rule: 'once_per_order' }),
    {
      id: 'c-lb-chk1',
      fromItemId: 'ledbeam',
      target: { itemId: 'powercon' },
      kind: 'check',
      groupId: 'power',
      rule: 'per_piece',
      qty: 1,
    },
    {
      id: 'c-lb-chk2',
      fromItemId: 'ledbeam',
      target: { itemId: 'adapter' },
      kind: 'check',
      groupId: 'power',
      rule: 'per_piece',
      qty: 1,
    },
    {
      id: 'c-lb-rec1',
      fromItemId: 'ledbeam',
      target: { itemId: 'lamp' },
      kind: 'recommended',
      rule: 'once_per_order',
      qty: 1,
    },
    {
      id: 'c-lb-rec2',
      fromItemId: 'ledbeam',
      target: { itemId: 'hazer' },
      kind: 'recommended',
      rule: 'once_per_order',
      qty: 1,
    },
    // Rogue: clamp per piece, desk once (shared desk)
    req('c-rg-clamp', 'rogue', 'clamp'),
    req('c-rg-desk', 'rogue', 'desk', { rule: 'once_per_order' }),
    {
      id: 'c-rg-rec',
      fromItemId: 'rogue',
      target: { itemId: 'hazer' },
      kind: 'recommended',
      rule: 'once_per_order',
      qty: 1,
    },
    // Desk needs its own power cable (recursion)
    req('c-desk-pw', 'desk', 'deskpower', { rule: 'once_per_order' }),
    // PAR: ("clamp AND rope") OR stand — nested group
    req('c-par-clamp', 'par', 'clamp', {
      groupId: 'par-hang',
      groupMode: 'and',
      parentGroupId: 'par-mount',
    }),
    req('c-par-rope', 'par', 'rope', {
      groupId: 'par-hang',
      groupMode: 'and',
      parentGroupId: 'par-mount',
    }),
    req('c-par-stand', 'par', 'stand', { groupId: 'par-mount', groupMode: 'or' }),
    // AX9 (inside cases): needs a PowerCON check
    {
      id: 'c-ax9-chk',
      fromItemId: 'ax9',
      target: { itemId: 'powercon' },
      kind: 'check',
      rule: 'per_n',
      n: 4,
      qty: 1,
    },
    // Cycle
    req('c-cy-ab', 'cyA', 'cyB'),
    req('c-cy-ba', 'cyB', 'cyA'),
  ];
  s.clients = [{ id: 'cl-1', name: 'Klient X' }];
  return s;
}

export const P = (
  eventFrom: string,
  eventTo: string,
  bookedFrom?: string,
  bookedUntil?: string,
): BookingPeriod => ({
  eventFrom,
  eventTo,
  bookedFrom: bookedFrom ?? eventFrom,
  bookedUntil: bookedUntil ?? eventTo,
});

export function ln(
  id: string,
  target: LineTarget,
  qty: number,
  extra: Partial<BookingLine> = {},
): BookingLine {
  return {
    id,
    target,
    qty,
    origin: 'manual',
    parentLineIds: [],
    status: 'ok',
    conflictAck: false,
    ...extra,
  };
}

export const item = (itemId: string) => ({ itemId });
export const caseT = (caseTypeId: string) => ({ caseTypeId });

export function bk(partial: Partial<Booking> & { id: string }): Booking {
  return {
    type: 'prebooking',
    status: 'draft',
    eventName: partial.id,
    purposeMessage: '',
    pmId: U.petr.id,
    createdAt: '2027-04-01',
    periods: [P('2027-04-23', '2027-04-24', '2027-04-22', '2027-04-25')],
    lines: [],
    defaultWarehouseId: W.brod,
    orChoices: {},
    dismissedRecommendations: [],
    dismissedChecks: [],
    suppressedAuto: {},
    ...partial,
  };
}

/** A confirmed order with a confirmation sequence number. */
export function order(partial: Partial<Booking> & { id: string }, seq = 1): Booking {
  return bk({
    type: 'order',
    status: 'confirmed',
    confirmSeq: seq,
    confirmedBy: U.tomas.id,
    ...partial,
  });
}

export function withBookings(s: AppState, ...bookings: Booking[]): AppState {
  return { ...s, bookings: [...s.bookings, ...bookings] };
}

export const TODAY = '2027-04-20';
