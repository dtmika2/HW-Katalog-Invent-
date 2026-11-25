/**
 * Packing: gear is ticked as ready while it still stands in the warehouse. From then on it is
 * taken (nobody else can pack, borrow or refill with it) until it is shipped or unpacked.
 * Promised gear (rented, or short because of an accepted conflict) may be left for the shipping.
 */
import { addDays, diffDays, type IsoDate } from '../dates';
import { firstBookedFrom, firstEventDay, isOpenLoan, packedEntries } from '../availability';
import {
  caseContentQty,
  contentsMatchStandard,
  getCaseType,
  getItem,
  looseStock,
  resolveSourceWarehouse,
  standardQty,
} from '../catalog';
import { newShortages, recomputeConflictRecords, type ShortageHit } from '../conflicts';
import { guard } from '../lifecycle';
import { can } from '../lifecycle/permissions';
import { chiefIds, notify, postEvent } from '../notifications';
import type {
  AppState,
  Booking,
  BookingLine,
  BookingStatus,
  CaseCheck,
  ConflictRecord,
  Id,
  PackedLine,
  PackingRecord,
  QtyLine,
  Shipment,
  ShipmentLine,
  User,
} from '../types';
import {
  effectiveQty,
  err,
  isActiveLine,
  isCaseTarget,
  isExternal,
  isItemTarget,
  nextId,
  ok,
  produce,
  type Result,
} from '../util';

// ---------------------------------------------------------------------------
// What is taken

const IN_HOUSE = new Set<BookingStatus>(['packing', 'packed', 'shipped']);
// 'packing' and 'packed' too: part of the order may already have left
const ACTIVE_OUT = new Set<BookingStatus>([
  'packing',
  'packed',
  'shipped',
  'returning',
  'returned_with_issues',
]);

export interface CasePlace {
  bookingId: Id;
  place: 'packed' | 'out';
}

/** Cases taken by an order: packed in the warehouse, or out and not yet returned. */
export function casePlaces(state: AppState): Map<Id, CasePlace> {
  const places = new Map<Id, CasePlace>();
  const statusOf = new Map(state.bookings.map((b) => [b.id, b.status]));
  const returned = new Set<string>();
  for (const s of state.returnSessions)
    for (const l of s.lines) if (l.caseId) returned.add(`${s.bookingId}|${l.caseId}`);
  const left = new Set<string>();
  for (const sh of state.shipments) {
    const status = statusOf.get(sh.bookingId);
    for (const l of sh.lines)
      for (const c of l.caseIds ?? []) {
        left.add(`${sh.bookingId}|${c}`);
        if (status && ACTIVE_OUT.has(status) && !returned.has(`${sh.bookingId}|${c}`))
          places.set(c, { bookingId: sh.bookingId, place: 'out' });
      }
  }
  for (const p of state.packings) {
    const status = statusOf.get(p.bookingId);
    if (!status || !IN_HOUSE.has(status)) continue;
    for (const l of p.lines)
      for (const c of l.caseIds ?? [])
        if (!left.has(`${p.bookingId}|${c}`))
          places.set(c, { bookingId: p.bookingId, place: 'packed' });
  }
  return places;
}

/** Ids of cases taken by an order (packed or out). */
export function casesOut(state: AppState): Set<Id> {
  return new Set(casePlaces(state).keys());
}

/** Loose pieces of an item that are packed on orders (in the house or already gone with them). */
function packedLoose(state: AppState, itemId: Id, warehouseId: Id): number {
  let n = 0;
  for (const b of state.bookings) {
    if (!IN_HOUSE.has(b.status)) continue;
    for (const l of b.lines)
      if (
        isItemTarget(l.target) &&
        l.target.itemId === itemId &&
        resolveSourceWarehouse(state, b, l) === warehouseId
      )
        n += packedQty(state, b.id, l.id);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Progress of a line

/** Pieces packed on a line so far (shipped ones included). */
export function packedQty(state: Pick<AppState, 'packings'>, bookingId: Id, lineId: Id): number {
  return packedEntries(state, bookingId, lineId)
    .filter((l) => !l.deferred)
    .reduce((n, l) => n + l.qty, 0);
}

/**
 * Packing records of orders shipped before packing was recorded on its own: what left had been
 * packed. Handovers from another event were never packed here.
 */
export function packingsFromShipments(shipments: readonly Shipment[]): PackingRecord[] {
  return shipments
    .filter((s) => !s.transferFromBookingId)
    .map((s) => ({
      id: `${s.id}-packed`,
      bookingId: s.bookingId,
      on: s.shippedOn,
      userId: s.userId,
      lines: s.lines.map((l) => ({ ...l })),
    }));
}

function shippedSplit(state: Pick<AppState, 'shipments'>, bookingId: Id, lineId: Id) {
  let normal = 0;
  let deferred = 0;
  for (const s of state.shipments) {
    if (s.bookingId !== bookingId) continue;
    for (const l of s.lines) {
      if (l.lineId !== lineId) continue;
      if (l.deferred) deferred += l.qty;
      else normal += l.qty;
    }
  }
  return { normal, deferred };
}

export interface LineProgress {
  qty: number;
  shipped: number;
  /** Neither packed nor left for the shipping. */
  toPack: number;
  /** Packed and standing in the warehouse. */
  readyPacked: number;
  /** Promised for the shipping and not confirmed yet. */
  readyDeferred: number;
  /** Packed beyond what the order needs (it was lowered later). */
  extra: number;
}

/** Where the pieces of a line are. Lines coming from another event are never packed here. */
export function lineProgress(
  state: Pick<AppState, 'packings' | 'shipments'>,
  b: Pick<Booking, 'id'>,
  line: BookingLine,
): LineProgress {
  const qty = isActiveLine(line) ? effectiveQty(line) : 0;
  const out = shippedSplit(state, b.id, line.id);
  const shipped = out.normal + out.deferred;
  if (line.fromBookingId)
    return { qty, shipped, toPack: 0, readyPacked: 0, readyDeferred: 0, extra: 0 };
  // orders shipped before packing was recorded count as packed
  const packed = Math.max(packedQty(state, b.id, line.id), out.normal);
  const marked = packedEntries(state, b.id, line.id)
    .filter((l) => l.deferred)
    .reduce((n, l) => n + l.qty, 0);
  const need = Math.max(qty, shipped);
  const usable = Math.min(packed, need - out.deferred);
  const deferred = Math.max(out.deferred, Math.min(marked, need - usable));
  return {
    qty,
    shipped,
    toPack: Math.max(0, qty - usable - deferred),
    readyPacked: Math.max(0, usable - out.normal),
    readyDeferred: Math.max(0, deferred - out.deferred),
    extra: Math.max(0, packed - usable),
  };
}

/** Status of an order being packed or shipped, from its lines. */
export function statusAfter(
  state: Pick<AppState, 'packings' | 'shipments'>,
  b: Booking,
): BookingStatus {
  const all = b.lines
    .filter((l) => isActiveLine(l) && !l.fromBookingId)
    .map((l) => lineProgress(state, b, l));
  if (all.every((p) => p.shipped >= p.qty)) return 'shipped';
  return all.some((p) => p.toPack > 0) ? 'packing' : 'packed';
}

export interface OrderProgress {
  qty: number;
  /** Packed so far, shipped ones included. */
  packed: number;
  shipped: number;
  toPack: number;
  /** Can be shipped now: packed and standing here, or promised. */
  ready: number;
  /** Promised for the shipping and not confirmed yet. */
  promised: number;
}

/** Progress of a whole order (gear coming straight from another event is not packed here). */
export function orderProgress(
  state: Pick<AppState, 'packings' | 'shipments'>,
  b: Pick<Booking, 'id' | 'lines'>,
): OrderProgress {
  const out: OrderProgress = { qty: 0, packed: 0, shipped: 0, toPack: 0, ready: 0, promised: 0 };
  for (const l of b.lines) {
    if (!isActiveLine(l) || l.fromBookingId) continue;
    const p = lineProgress(state, b, l);
    out.qty += p.qty;
    out.shipped += p.shipped;
    out.packed += p.readyPacked + p.shipped;
    out.toPack += p.toPack;
    out.ready += p.readyPacked + p.readyDeferred;
    out.promised += p.readyDeferred;
  }
  return out;
}

/** Packed pieces of a line still in the house, oldest first (they leave in that order). */
export function packedInHouse(state: AppState, bookingId: Id, lineId: Id): PackedLine[] {
  let gone = shippedSplit(state, bookingId, lineId).normal;
  const leftCases = new Set(
    state.shipments
      .filter((s) => s.bookingId === bookingId)
      .flatMap((s) => s.lines.filter((l) => l.lineId === lineId).flatMap((l) => l.caseIds ?? [])),
  );
  const out: PackedLine[] = [];
  for (const e of packedEntries(state, bookingId, lineId)) {
    if (e.deferred) continue;
    if (e.caseIds) {
      const ids = e.caseIds.filter((c) => !leftCases.has(c));
      if (ids.length > 0)
        out.push({
          ...e,
          qty: ids.length,
          caseIds: ids,
          ...(e.caseChecks
            ? { caseChecks: e.caseChecks.filter((c) => ids.includes(c.caseId)) }
            : {}),
        });
      continue;
    }
    const take = Math.min(gone, e.qty);
    gone -= take;
    if (e.qty > take) out.push({ ...e, qty: e.qty - take });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Promised gear

/** Conflicts a person accepted on a line: the missing pieces are promised from elsewhere. */
export function acceptedConflicts(state: AppState, bookingId: Id, lineId: Id): ConflictRecord[] {
  return state.conflicts.filter(
    (r) =>
      r.bookingId === bookingId &&
      r.lineId === lineId &&
      (r.status !== 'resolved' || !!r.resolvedBy),
  );
}

/** How many pieces of a line may be left for the shipping. */
export function deferrableQty(state: AppState, b: Booking, line: BookingLine): number {
  const p = lineProgress(state, b, line);
  if (line.fromBookingId) return 0;
  if (isExternal(line.target)) return p.toPack;
  const short = Math.max(0, ...acceptedConflicts(state, b.id, line.id).map((r) => r.shortQty));
  return Math.max(0, Math.min(p.toPack, short - p.readyDeferred));
}

export interface PromisedLine {
  lineId: Id;
  qty: number;
  /** 'transfer' comes straight from another event and is confirmed by its handover. */
  kind: 'external' | 'own' | 'transfer';
  name: string;
  /** Supplier or the event it comes from. */
  from: string;
}

function nameOf(state: AppState, line: BookingLine): string {
  if (isExternal(line.target)) return line.target.external.name;
  if (isItemTarget(line.target)) return getItem(state, line.target.itemId)?.name ?? '';
  return getCaseType(state, line.target.caseTypeId)?.name ?? '';
}

/** Promised gear that has not been confirmed as part of a delivery yet. */
export function openPromises(state: AppState, b: Booking): PromisedLine[] {
  if (b.type !== 'order' || !['packing', 'packed', 'shipped'].includes(b.status)) return [];
  const out: PromisedLine[] = [];
  for (const line of b.lines) {
    if (!isActiveLine(line)) continue;
    const p = lineProgress(state, b, line);
    if (line.fromBookingId) {
      const qty = Math.max(0, p.qty - p.shipped);
      const from = state.bookings.find((x) => x.id === line.fromBookingId)?.eventName ?? '';
      if (qty > 0)
        out.push({ lineId: line.id, qty, kind: 'transfer', name: nameOf(state, line), from });
    } else if (p.readyDeferred > 0) {
      const ext = isExternal(line.target) ? line.target.external : undefined;
      out.push({
        lineId: line.id,
        qty: p.readyDeferred,
        kind: ext ? 'external' : 'own',
        name: nameOf(state, line),
        from: ext?.supplier ?? '',
      });
    }
  }
  return out;
}

/** "8× Astera AX9 (Astera Rent CZ), 2× …" for the conversation and notifications. */
export function promisedText(list: Pick<PromisedLine, 'qty' | 'name' | 'from'>[]): string {
  return list.map((p) => `${p.qty}× ${p.name}${p.from ? ` (${p.from})` : ''}`).join(', ');
}

// ---------------------------------------------------------------------------
// Case contents

/** Pieces of an item lying loose in a warehouse, without those missing, lent or packed. */
export function looseInHouse(state: AppState, itemId: Id, warehouseId: Id): number {
  const missing = state.issues
    .filter(
      (i) =>
        i.type === 'missing' &&
        !i.archivedOn &&
        i.itemId === itemId &&
        i.warehouseId === warehouseId,
    )
    .reduce((n, i) => n + i.qty, 0);
  const lent = state.loans
    .filter((l) => l.itemId === itemId && l.warehouseId === warehouseId && isOpenLoan(l))
    .reduce((n, l) => n + l.qty, 0);
  return Math.max(
    0,
    looseStock(state, itemId, warehouseId) -
      missing -
      lent -
      packedLoose(state, itemId, warehouseId),
  );
}

const qtyOf = (list: readonly QtyLine[] | undefined, itemId: Id): number =>
  (list ?? []).filter((l) => l.itemId === itemId).reduce((n, l) => n + l.qty, 0);

/** Contents a checked case leaves with: counted plus refilled pieces. */
export function checkedContents(check: CaseCheck): QtyLine[] {
  const ids = [...new Set([...check.counts, ...(check.refilled ?? [])].map((l) => l.itemId))];
  return ids.map((itemId) => ({
    itemId,
    qty: qtyOf(check.counts, itemId) + qtyOf(check.refilled, itemId),
  }));
}

/** What a checked case lacks compared with its standard contents. */
export function checkShort(state: Pick<AppState, 'cases' | 'caseTypes'>, check: CaseCheck) {
  const c = state.cases.find((x) => x.id === check.caseId);
  const t = c ? getCaseType(state, c.caseTypeId) : undefined;
  const have = checkedContents(check);
  return (t?.contents ?? [])
    .map((std) => ({ itemId: std.itemId, qty: std.qty - qtyOf(have, std.itemId) }))
    .filter((l) => l.qty > 0);
}

/** Checks saying every case holds exactly its standard contents. */
export function standardCaseChecks(
  state: Pick<AppState, 'cases' | 'caseTypes'>,
  caseIds: readonly Id[],
): CaseCheck[] {
  return caseIds.map((caseId) => {
    const c = state.cases.find((x) => x.id === caseId);
    const t = c ? getCaseType(state, c.caseTypeId) : undefined;
    return { caseId, counts: (t?.contents ?? []).map((l) => ({ ...l })) };
  });
}

/** Every case is counted line by line; a case that leaves short needs a written reason. */
export function validateCaseChecks(state: AppState, lines: ShipmentLine[]): Result<true> {
  const refilled = new Map<string, number>();
  for (const sl of lines) {
    for (const caseId of sl.caseIds ?? []) {
      const c = state.cases.find((x) => x.id === caseId);
      const t = c ? getCaseType(state, c.caseTypeId) : undefined;
      const checks = (sl.caseChecks ?? []).filter((x) => x.caseId === caseId);
      const check = checks[0];
      if (!c || !t || !check || checks.length !== 1)
        return err('validation', `Contents of case ${c?.number ?? caseId} were not checked`, {
          caseId,
          field: 'caseChecks',
        });
      for (const std of t.contents) {
        const counted = check.counts.filter((l) => l.itemId === std.itemId);
        const added = qtyOf(check.refilled, std.itemId);
        const n = counted[0]?.qty ?? -1;
        if (
          counted.length !== 1 ||
          !Number.isInteger(n) ||
          !Number.isInteger(added) ||
          n < 0 ||
          added < 0 ||
          n + added > std.qty
        )
          return err('validation', `Invalid count in case ${c.number}`, { caseId });
        if (added > 0) {
          const key = `${std.itemId}@${c.warehouseId}`;
          const sum = (refilled.get(key) ?? 0) + added;
          refilled.set(key, sum);
          if (sum > looseInHouse(state, std.itemId, c.warehouseId))
            return err('validation', 'Not enough loose pieces to refill', { caseId });
        }
      }
      const known = new Set(t.contents.map((l) => l.itemId));
      if ([...check.counts, ...(check.refilled ?? [])].some((l) => !known.has(l.itemId)))
        return err('validation', `Case ${c.number} does not hold that item`, { caseId });
      if (checkShort(state, check).length > 0 && !check.reason?.trim())
        return err('validation', `A reason is required, case ${c.number} is short`, {
          caseId,
          field: 'reason',
        });
    }
  }
  return ok(true);
}

/**
 * Take over what the packer counted: the case gets its real contents, pieces that should have
 * been there become a missing issue, PM and Chief hear about cases that left short.
 */
export function applyCaseChecks(
  d: AppState,
  userId: Id,
  today: IsoDate,
  booking: Booking,
  sl: ShipmentLine,
): boolean {
  let changed = false;
  for (const check of sl.caseChecks ?? []) {
    const c = d.cases.find((x) => x.id === check.caseId);
    if (!c || !sl.caseIds?.includes(c.id)) continue;
    const contents = checkedContents(check).filter((l) => l.qty > 0);
    for (const l of check.counts) {
      const lost = caseContentQty(c, l.itemId) - l.qty;
      if (lost <= 0) continue;
      changed = true;
      d.issues.push({
        id: nextId(d, 'iss'),
        type: 'missing',
        bookingId: booking.id,
        lineId: sl.lineId,
        caseId: c.id,
        itemId: l.itemId,
        qty: lost,
        warehouseId: c.warehouseId,
        note: check.reason?.trim() ?? '',
        reportedBy: userId,
        reportedOn: today,
      });
    }
    const before = contentsMatchStandard(d, c);
    c.contents = contents;
    if (contentsMatchStandard(d, c)) delete c.incompleteSince;
    else c.incompleteSince = c.incompleteSince ?? today;
    if (before !== contentsMatchStandard(d, c)) changed = true;
    const short = checkShort(d, check);
    if (short.length > 0) {
      const what = short
        .map((l) => `${l.qty}× ${getItem(d, l.itemId)?.name ?? l.itemId}`)
        .join(', ');
      notify(
        d,
        [booking.pmId, ...chiefIds(d)],
        {
          type: 'case_shipped_short',
          text: `${booking.eventName}: case ${c.number} packed without ${what}`,
          params: {
            event: booking.eventName,
            number: c.number,
            what,
            reason: check.reason?.trim() ?? '',
          },
          bookingId: booking.id,
        },
        today,
      );
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Actions

/** Shared checks of lines that are packed (or promised and shipped right away). */
export function validatePickedLines(
  state: AppState,
  b: Booking,
  lines: PackedLine[],
  limitOf: (line: BookingLine, l: PackedLine) => number,
): Result<true> {
  const busy = casesOut(state);
  const usedCases = new Set<Id>();
  const asked = new Map<string, number>();
  const taken = new Map<string, number>();
  for (const pl of lines) {
    const line = b.lines.find((l) => l.id === pl.lineId);
    if (!line || !isActiveLine(line) || line.fromBookingId)
      return err('validation', `Unknown line ${pl.lineId}`);
    const key = `${line.id}|${pl.deferred ? 'd' : ''}`;
    const sum = (asked.get(key) ?? 0) + pl.qty;
    asked.set(key, sum);
    const limit = limitOf(line, pl);
    if (!Number.isInteger(pl.qty) || pl.qty <= 0 || sum > limit)
      return err('validation', `Invalid quantity for line ${pl.lineId}`, {
        lineId: pl.lineId,
        remaining: limit,
      });
    if (isCaseTarget(line.target)) {
      const ids = pl.caseIds ?? [];
      if (ids.length !== pl.qty)
        return err('validation', 'Pick one case number per case', { lineId: pl.lineId });
      for (const cid of ids) {
        const c = state.cases.find((x) => x.id === cid);
        if (!c || c.caseTypeId !== line.target.caseTypeId)
          return err('validation', `Case ${cid} does not match`);
        if (busy.has(cid) || usedCases.has(cid))
          return err('validation', `Case ${c.number} is already taken`);
        usedCases.add(cid);
      }
    }
    if (pl.fromCaseId) {
      const c = state.cases.find((x) => x.id === pl.fromCaseId);
      if (!c || !isItemTarget(line.target) || busy.has(c.id))
        return err('validation', 'Invalid source case');
      const k = `${c.id}|${line.target.itemId}`;
      const out = (taken.get(k) ?? 0) + pl.qty;
      taken.set(k, out);
      if (caseContentQty(c, line.target.itemId) < out)
        return err('validation', `Case ${c.number} does not hold ${pl.qty} pieces`);
    }
  }
  return validateCaseChecks(state, lines);
}

/** Loose pieces packed out of a case: the case is short until it is refilled. */
function takeOutOfCase(d: AppState, line: BookingLine, pl: PackedLine, today: IsoDate): void {
  if (!pl.fromCaseId || !isItemTarget(line.target)) return;
  const itemId = line.target.itemId;
  const c = d.cases.find((x) => x.id === pl.fromCaseId);
  const entry = c?.contents.find((x) => x.itemId === itemId);
  if (!c || !entry) return;
  entry.qty -= pl.qty;
  c.contents = c.contents.filter((x) => x.qty > 0);
  if (!contentsMatchStandard(d, c) && !c.incompleteSince) c.incompleteSince = today;
}

// ---------------------------------------------------------------------------
// Packing ahead of time

/** True when the booked days are further away than packing is normally done. */
export function isEarlyPacking(
  state: Pick<AppState, 'settings'>,
  b: Pick<Booking, 'periods'>,
  today: IsoDate,
): boolean {
  return diffDays(today, firstBookedFrom(b)) > state.settings.earlyPackingDays;
}

/**
 * Who gets short because an order (or some of its lines) is packed today: the gear is taken from
 * now on, not only from the booked days.
 */
export function earlyPackingHits(
  state: AppState,
  today: IsoDate,
  bookingId: Id,
  lines?: readonly PackedLine[],
): ShortageHit[] {
  const b = state.bookings.find((x) => x.id === bookingId);
  if (!b) return [];
  const first = firstBookedFrom(b);
  if (today >= first) return [];
  const picked: PackedLine[] = lines
    ? lines.filter((l) => !l.deferred).map((l) => ({ ...l }))
    : b.lines
        .filter((l) => !isExternal(l.target) && !l.fromBookingId)
        .map((l) => ({ lineId: l.id, qty: lineProgress(state, b, l).toPack }))
        .filter((l) => l.qty > 0);
  if (picked.length === 0) return [];
  const after = produce(state, (d) => {
    const x = d.bookings.find((y) => y.id === bookingId) as Booking;
    if (x.status === 'confirmed') x.status = 'packing';
    d.packings.push({ id: 'preview', bookingId, on: today, userId: '', lines: picked });
  }).state;
  return newShortages(state, after, today, addDays(first, -1), (x) => x.id !== bookingId);
}

/**
 * Pack lines, or mark promised ones (`deferred`) as coming with the shipping. Every case is
 * checked against its contents. Packing before the booked days that leaves a confirmed order
 * short needs a reason. `silent` is used when the same lines ship right away.
 */
export function packLines(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  lines: PackedLine[],
  options: { silent?: boolean; earlyReason?: string } = {},
): Result<AppState> {
  const { silent = false } = options;
  const why = options.earlyReason?.trim() ?? '';
  const g = guard(state, user, 'pack', bookingId);
  if (!g.ok) return g;
  const b = g.value;
  if (lines.length === 0) return err('validation', 'Nothing to pack');
  for (const l of lines) {
    if (!l.deferred) continue;
    const line = b.lines.find((x) => x.id === l.lineId);
    if (!line || l.qty > deferrableQty(state, b, line) || !Number.isInteger(l.qty) || l.qty <= 0)
      return err('validation', 'Only promised gear can be left for the shipping', {
        lineId: l.lineId,
        field: 'deferred',
      });
  }
  const total = new Map<Id, number>();
  for (const l of lines) total.set(l.lineId, (total.get(l.lineId) ?? 0) + l.qty);
  for (const [lineId, n] of total) {
    const line = b.lines.find((x) => x.id === lineId);
    if (line && n > lineProgress(state, b, line).toPack)
      return err('validation', `Invalid quantity for line ${lineId}`, { lineId });
  }
  const v = validatePickedLines(
    state,
    b,
    lines.filter((l) => !l.deferred),
    (line) => lineProgress(state, b, line).toPack,
  );
  if (!v.ok) return v;
  if (
    !why &&
    !b.earlyPacking &&
    earlyPackingHits(state, today, bookingId, lines).some((h) => h.level === 'order')
  )
    return err('validation', 'A reason is required, an order needs the gear before', {
      field: 'earlyReason',
    });
  const next = produce(state, (d) => {
    const booking = d.bookings.find((x) => x.id === bookingId) as Booking;
    if (why) booking.earlyPacking = { by: user.id, on: today, reason: why };
    for (const pl of lines) {
      if (pl.deferred) continue;
      const line = booking.lines.find((l) => l.id === pl.lineId) as BookingLine;
      applyCaseChecks(d, user.id, today, booking, pl);
      takeOutOfCase(d, line, pl, today);
    }
    d.packings.push({
      id: nextId(d, 'pck'),
      bookingId,
      on: today,
      userId: user.id,
      lines: lines.map((l) => ({ ...l })),
    });
    const before = booking.status;
    booking.status = statusAfter(d, booking);
    if (silent) return;
    const count = (deferred: boolean) =>
      lines.filter((l) => !!l.deferred === deferred).reduce((n, l) => n + l.qty, 0);
    const promised = openPromises(d, booking);
    if (count(false) > 0)
      postEvent(
        d,
        bookingId,
        user.id,
        today,
        'packed',
        why ? { count: count(false), reason: why } : { count: count(false) },
      );
    if (booking.status === 'packed' && before !== 'packed')
      notify(
        d,
        [booking.pmId, ...chiefIds(d)],
        {
          type: 'order_packed',
          text: `${booking.eventName} is packed`,
          params: { event: booking.eventName, promised: promisedText(promised) },
          bookingId,
        },
        today,
      );
  }).state;
  return ok(recomputeConflictRecords(next, today));
}

// ---------------------------------------------------------------------------
// Taking packing back

/** One thing that has to be confirmed as back before packing or a delivery is cancelled. */
export interface BackItem {
  /** Case id, or line id of loose pieces. */
  key: Id;
  qty: number;
  name: string;
  caseId?: Id;
}

/** What a cancel has to confirm, one entry per case and per loose line. */
export function backItems(
  state: AppState,
  b: Booking,
  lines: readonly Pick<ShipmentLine, 'lineId' | 'qty' | 'caseIds'>[],
): BackItem[] {
  const out = new Map<Id, BackItem>();
  for (const l of lines) {
    const line = b.lines.find((x) => x.id === l.lineId);
    const name = line ? nameOf(state, line) : l.lineId;
    for (const caseId of l.caseIds ?? []) out.set(caseId, { key: caseId, qty: 1, name, caseId });
    if (l.caseIds) continue;
    const same = out.get(l.lineId);
    if (same) same.qty += l.qty;
    else out.set(l.lineId, { key: l.lineId, qty: l.qty, name });
  }
  return [...out.values()];
}

/** What "Zrušit balení" has to confirm: everything still packed in the warehouse. */
export function packingBackItems(state: AppState, b: Booking): BackItem[] {
  return backItems(
    state,
    b,
    b.lines.flatMap((l) => packedInHouse(state, b.id, l.id)),
  );
}

/** Once the event has begun, gear comes back through the vratka; only the Chief may cancel. */
export function cancelLocked(b: Pick<Booking, 'periods'>, today: IsoDate): boolean {
  return today >= firstEventDay(b);
}

export interface CancelInput {
  /** Keys of `BackItem`s confirmed one by one as back. */
  confirmed: readonly Id[];
  /** Required once the event has begun. */
  reason?: string;
}

/**
 * Shared rules of cancelling, so that it cannot replace the vratka: everything is confirmed as
 * back, and once the event has begun only the Chief cancels, with a reason.
 */
export function cancelGuard(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  items: readonly BackItem[],
  input: CancelInput,
): Result<Booking> {
  const b = state.bookings.find((x) => x.id === bookingId);
  if (!b) return err('not_found', `Booking ${bookingId} not found`);
  if (!can(user, 'cancel_delivery', b)) return err('forbidden', 'Not allowed to cancel');
  if (!IN_HOUSE.has(b.status))
    return err('invalid_state', `Cannot cancel a booking in state ${b.status}`);
  if (cancelLocked(b, today)) {
    if (!can(user, 'cancel_after_start', b))
      return err('forbidden', 'The event has begun, only the Chief may cancel', {
        field: 'started',
      });
    if (!input.reason?.trim())
      return err('validation', 'A reason is required once the event has begun', {
        field: 'reason',
      });
  }
  const missing = items.filter((i) => !input.confirmed.includes(i.key)).map((i) => i.key);
  if (missing.length > 0)
    return err('validation', 'Everything has to be confirmed as back', {
      field: 'confirmed',
      missing,
    });
  return ok(b);
}

/**
 * Undo packing of a line that still stands in the warehouse: all of it, or some pieces / one
 * case. With `deferred`, take back "comes with the shipping".
 */
export function unpackLine(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  lineId: Id,
  what: { qty?: number; caseId?: Id; deferred?: boolean } = {},
): Result<AppState> {
  // the Chief may unpack too, and is the only one once the event has begun
  const g = can(user, 'cancel_after_start')
    ? cancelGuard(state, user, today, bookingId, [], { confirmed: [], reason: 'unpack' })
    : guard(state, user, 'pack', bookingId);
  if (!g.ok) return g;
  if (!what.deferred && cancelLocked(g.value, today) && !can(user, 'cancel_after_start'))
    return err('forbidden', 'The event has begun, only the Chief may unpack', { field: 'started' });
  const line = g.value.lines.find((l) => l.id === lineId);
  if (!line) return err('not_found', `Line ${lineId} not found`);
  const p = lineProgress(state, g.value, line);
  const inHouse = packedInHouse(state, bookingId, lineId);
  const available = what.deferred ? p.readyDeferred : inHouse.reduce((n, l) => n + l.qty, 0);
  const caseIds = inHouse.flatMap((l) => l.caseIds ?? []);
  if (what.caseId && !caseIds.includes(what.caseId))
    return err('validation', 'That case is not packed here');
  const amount = what.caseId ? 1 : (what.qty ?? available);
  if (!Number.isInteger(amount) || amount <= 0 || amount > available)
    return err('validation', 'Nothing to unpack', { lineId });
  const next = produce(state, (d) => {
    const booking = d.bookings.find((x) => x.id === bookingId) as Booking;
    putBack(d, booking, line, amount, { ...what, caseIds });
    booking.status = statusAfter(d, booking);
    if (!what.deferred)
      postEvent(d, bookingId, user.id, today, 'unpacked', {
        count: amount,
        name: nameOf(d, line),
      });
  }).state;
  return ok(recomputeConflictRecords(next, today));
}

/** Take pieces of a line out of its packing records; loose ones go back into their case. */
function putBack(
  d: AppState,
  booking: Booking,
  line: BookingLine,
  amount: number,
  what: { caseId?: Id; deferred?: boolean; caseIds: Id[] },
): void {
  let left = amount;
  // newest first: the oldest are the ones that already left
  for (const rec of [...d.packings].reverse()) {
    if (rec.bookingId !== booking.id) continue;
    for (const e of [...rec.lines].reverse()) {
      if (left <= 0 || e.lineId !== line.id || !!e.deferred !== !!what.deferred) continue;
      if (e.caseIds) {
        const out = e.caseIds
          .filter((c) => what.caseIds.includes(c) && (!what.caseId || c === what.caseId))
          .slice(-left);
        e.caseIds = e.caseIds.filter((c) => !out.includes(c));
        if (e.caseChecks) e.caseChecks = e.caseChecks.filter((c) => !out.includes(c.caseId));
        e.qty -= out.length;
        left -= out.length;
        continue;
      }
      const n = Math.min(left, e.qty);
      e.qty -= n;
      left -= n;
      const c = e.fromCaseId ? d.cases.find((x) => x.id === e.fromCaseId) : undefined;
      const t = c ? getCaseType(d, c.caseTypeId) : undefined;
      if (!c || !t || !isItemTarget(line.target)) continue;
      // back into the case it was taken from
      const itemId = line.target.itemId;
      const have = caseContentQty(c, itemId);
      const put = Math.min(n, Math.max(0, standardQty(t, itemId) - have));
      const entry = c.contents.find((x) => x.itemId === itemId);
      if (entry) entry.qty += put;
      else if (put > 0) c.contents.push({ itemId, qty: put });
      if (contentsMatchStandard(d, c)) delete c.incompleteSince;
    }
    rec.lines = rec.lines.filter((e) => e.qty > 0);
  }
  d.packings = d.packings.filter((r) => r.lines.length > 0);
}

/**
 * Cancel packing: everything still in the house is confirmed as back on its place, unpacked and
 * free again, nothing is promised for the shipping. When nothing has left, the order is back at "Potvrzená" and can be packed
 * again later. What was found missing in a case stays reported, it is a fact.
 */
export function cancelPacking(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  input: CancelInput,
): Result<AppState> {
  const found = state.bookings.find((x) => x.id === bookingId);
  const items = found ? packingBackItems(state, found) : [];
  const g = cancelGuard(state, user, today, bookingId, items, input);
  if (!g.ok) return g;
  const b = g.value;
  const reason = input.reason ?? '';
  const gone = state.shipments.some((s) => s.bookingId === bookingId && !s.transferFromBookingId);
  const here = b.lines.map((line) => {
    const inHouse = packedInHouse(state, bookingId, line.id);
    return {
      line,
      qty: inHouse.reduce((n, e) => n + e.qty, 0),
      caseIds: inHouse.flatMap((e) => e.caseIds ?? []),
      deferred: lineProgress(state, b, line).readyDeferred,
    };
  });
  if (gone && here.every((h) => h.qty === 0 && h.deferred === 0))
    return err('invalid_state', 'Nothing of it is packed in the warehouse');
  const next = produce(state, (d) => {
    const booking = d.bookings.find((x) => x.id === bookingId) as Booking;
    for (const h of here) {
      if (h.qty > 0) putBack(d, booking, h.line, h.qty, { caseIds: h.caseIds });
      if (h.deferred > 0) putBack(d, booking, h.line, h.deferred, { deferred: true, caseIds: [] });
    }
    if (!gone) {
      // a lowered order may have left more records than it needs
      d.packings = d.packings.filter((p) => p.bookingId !== bookingId);
      delete booking.earlyPacking;
      delete booking.cancelRequests;
    } else if (booking.cancelRequests)
      booking.cancelRequests = booking.cancelRequests.filter((r) => r.shipmentId);
    booking.status = gone ? statusAfter(d, booking) : 'confirmed';
    const why = reason.trim();
    postEvent(d, bookingId, user.id, today, 'packing_cancelled', {
      count: here.reduce((n, h) => n + h.qty, 0),
      ...(why ? { reason: why } : {}),
    });
  }).state;
  return ok(recomputeConflictRecords(next, today));
}

/** Promised gear will not come: the line is lowered or marked missing, with a written reason. */
export function closePromised(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  lineId: Id,
  reason: string,
): Result<AppState> {
  const b = state.bookings.find((x) => x.id === bookingId);
  if (!b) return err('not_found', `Booking ${bookingId} not found`);
  if (!can(user, 'pack', b) && !can(user, 'mark_line', b))
    return err('forbidden', 'Only the warehouse and the Chief close promised gear');
  const open = openPromises(state, b).find((p) => p.lineId === lineId);
  if (!open) return err('invalid_state', 'Nothing promised on that line');
  if (!reason.trim()) return err('validation', 'A reason is required', { field: 'reason' });
  const next = produce(state, (d) => {
    const booking = d.bookings.find((x) => x.id === bookingId) as Booking;
    const line = booking.lines.find((l) => l.id === lineId) as BookingLine;
    const rest = effectiveQty(line) - open.qty;
    if (rest <= 0) line.status = 'missing';
    else if (line.origin === 'auto') line.overriddenQty = rest;
    else line.qty = rest;
    if (line.followsCheck) line.followsCheck = { ...line.followsCheck, byHand: true };
    line.note = reason.trim();
    for (const rec of d.packings)
      if (rec.bookingId === bookingId)
        rec.lines = rec.lines.filter((e) => !(e.lineId === lineId && e.deferred));
    d.packings = d.packings.filter((r) => r.lines.length > 0);
    // what has arrived as promised before stays counted through the shipments
    if (['packing', 'packed'].includes(booking.status)) booking.status = statusAfter(d, booking);
    postEvent(d, bookingId, user.id, today, 'promised_closed', {
      what: promisedText([open]),
      reason: reason.trim(),
    });
    notify(
      d,
      [booking.pmId, ...chiefIds(d)],
      {
        type: 'promised_missing',
        text: `${booking.eventName}: ${promisedText([open])} will not come`,
        params: {
          event: booking.eventName,
          what: promisedText([open]),
          reason: reason.trim(),
          closed: 1,
        },
        bookingId,
      },
      today,
    );
  }).state;
  return ok(recomputeConflictRecords(next, today));
}
