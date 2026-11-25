/**
 * Packing and shipping in batches. The packing list is flat per warehouse, grouped by storage
 * location; cases are one line with their contents.
 */
import type { IsoDate } from '../dates';
import { shippedQty } from '../availability';
import {
  caseContentQty,
  getCaseType,
  getItem,
  homeLocationId,
  isCaseComplete,
  contentsMatchStandard,
  looseStock,
  resolveSourceWarehouse,
} from '../catalog';
import { recomputeConflictRecords } from '../conflicts';
import { guard, recalcBooking } from '../lifecycle';
import { can } from '../lifecycle/permissions';
import { chiefIds, notify, postEvent, warehouseIds } from '../notifications';
import type {
  AppState,
  Booking,
  BookingLine,
  CaseCheck,
  Id,
  QtyLine,
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

export interface CandidateCase {
  caseId: Id;
  number: string;
  locationId: Id;
  complete: boolean;
  /** Already out on an active order (this one included). */
  busy: boolean;
}

export interface PackLine {
  lineId: Id;
  kind: 'item' | 'case' | 'external';
  itemId?: Id;
  caseTypeId?: Id;
  name: string;
  qty: number;
  shipped: number;
  remaining: number;
  warehouseId?: Id;
  locationId?: Id;
  contents?: QtyLine[];
  candidateCases?: CandidateCase[];
  /** Names of parent lines ("pro: LEDBeam ×10"). */
  forHint: { name: string; qty: number }[];
  consumable: boolean;
  addedAfterShipping: boolean;
  fromBookingId?: Id;
}

export interface PackingGroup {
  locationId: Id | undefined;
  lines: PackLine[];
}

export interface PackingList {
  bookingId: Id;
  byWarehouse: { warehouseId: Id; groups: PackingGroup[] }[];
  external: PackLine[];
  /** Lines coming straight from another event (transfer), not packed in the warehouse. */
  transfers: PackLine[];
}

// 'packing' too: part of the order may already have left
const ACTIVE_OUT = new Set(['packing', 'shipped', 'returning', 'returned_with_issues']);

/** Case ids currently out on an active order (shipped and not yet returned). */
export function casesOut(state: AppState): Set<Id> {
  const out = new Set<Id>();
  const returned = new Set<string>();
  for (const s of state.returnSessions)
    for (const l of s.lines) if (l.caseId) returned.add(`${s.bookingId}|${l.caseId}`);
  for (const sh of state.shipments) {
    const b = state.bookings.find((x) => x.id === sh.bookingId);
    if (!b || !ACTIVE_OUT.has(b.status)) continue;
    for (const l of sh.lines)
      for (const c of l.caseIds ?? []) if (!returned.has(`${sh.bookingId}|${c}`)) out.add(c);
  }
  return out;
}

function lineName(state: AppState, line: BookingLine): string {
  if (isExternal(line.target)) return line.target.external.name;
  if (isItemTarget(line.target))
    return getItem(state, line.target.itemId)?.name ?? line.target.itemId;
  return getCaseType(state, line.target.caseTypeId)?.name ?? line.target.caseTypeId;
}

/** Build the packing list of a booking. */
export function packingList(state: AppState, bookingId: Id): PackingList | undefined {
  const b = state.bookings.find((x) => x.id === bookingId);
  if (!b) return undefined;
  const busy = casesOut(state);
  const groups = new Map<Id, Map<string, PackLine[]>>();
  const external: PackLine[] = [];
  const transfers: PackLine[] = [];
  for (const line of b.lines) {
    if (!isActiveLine(line)) continue;
    const qty = effectiveQty(line);
    const shipped = shippedQty(state, b.id, line.id);
    const forHint = line.parentLineIds
      .map((pid) => b.lines.find((l) => l.id === pid))
      .filter((p): p is BookingLine => !!p)
      .map((p) => ({ name: lineName(state, p), qty: effectiveQty(p) }));
    const base: PackLine = {
      lineId: line.id,
      kind: isExternal(line.target) ? 'external' : isCaseTarget(line.target) ? 'case' : 'item',
      name: lineName(state, line),
      qty,
      shipped,
      remaining: Math.max(0, qty - shipped),
      forHint,
      consumable:
        isItemTarget(line.target) && getItem(state, line.target.itemId)?.returnable === false,
      addedAfterShipping: !!line.addedAfterShipping,
    };
    if (isExternal(line.target)) {
      external.push(base);
      continue;
    }
    const w = resolveSourceWarehouse(state, b, line);
    base.warehouseId = w;
    if (isItemTarget(line.target)) {
      base.itemId = line.target.itemId;
      const loc = homeLocationId(state, line.target.itemId, w);
      if (loc) base.locationId = loc;
    } else {
      const caseTypeId = line.target.caseTypeId;
      const t = getCaseType(state, caseTypeId);
      base.caseTypeId = caseTypeId;
      base.contents = t?.contents ?? [];
      base.candidateCases = state.cases
        .filter((c) => c.caseTypeId === caseTypeId && c.warehouseId === w && !c.archived)
        .map((c) => ({
          caseId: c.id,
          number: c.number,
          locationId: c.locationId,
          complete: isCaseComplete(state, c),
          busy: busy.has(c.id),
        }));
      const firstFree =
        base.candidateCases.find((c) => c.complete && !c.busy) ?? base.candidateCases[0];
      if (firstFree) base.locationId = firstFree.locationId;
    }
    if (line.fromBookingId) {
      base.fromBookingId = line.fromBookingId;
      transfers.push(base);
      continue;
    }
    const byLoc = groups.get(w) ?? new Map<string, PackLine[]>();
    const key = base.locationId ?? '';
    byLoc.set(key, [...(byLoc.get(key) ?? []), base]);
    groups.set(w, byLoc);
  }
  const pathOf = (id: string) => state.locations.find((l) => l.id === id)?.path ?? '~';
  return {
    bookingId,
    byWarehouse: [...groups].map(([warehouseId, byLoc]) => ({
      warehouseId,
      groups: [...byLoc]
        .sort((a, b2) => pathOf(a[0]).localeCompare(pathOf(b2[0])))
        .map(([loc, lines]) => ({ locationId: loc || undefined, lines })),
    })),
    external,
    transfers,
  };
}

/** Pieces of an item lying loose in a warehouse, without those known to be missing. */
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
  return Math.max(0, looseStock(state, itemId, warehouseId) - missing);
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
function validateCaseChecks(state: AppState, lines: ShipmentLine[]): Result<true> {
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
function applyCaseChecks(
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
          text: `${booking.eventName}: case ${c.number} left without ${what}`,
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

export interface ShipBatchInput {
  label: string;
  lines: ShipmentLine[];
}

/**
 * Ship a batch ("Dodávka 1"). Every case is checked against its contents first. Records what
 * left the house, takes loose pieces out of cases when
 * `fromCaseId` is given, reduces consumable stock, notifies PM and Chief.
 */
export function shipBatch(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  input: ShipBatchInput,
): Result<AppState> {
  const g = guard(state, user, 'ship', bookingId);
  if (!g.ok) return g;
  const b = g.value;
  if (!input.label.trim()) return err('validation', 'Batch label is required');
  if (input.lines.length === 0) return err('validation', 'Nothing to ship');
  const busy = casesOut(state);
  const usedCases = new Set<Id>();
  for (const sl of input.lines) {
    const line = b.lines.find((l) => l.id === sl.lineId);
    if (!line || !isActiveLine(line)) return err('validation', `Unknown line ${sl.lineId}`);
    const remaining = effectiveQty(line) - shippedQty(state, b.id, line.id);
    if (!Number.isInteger(sl.qty) || sl.qty <= 0 || sl.qty > remaining) {
      return err('validation', `Invalid quantity for line ${sl.lineId}`, {
        lineId: sl.lineId,
        remaining,
      });
    }
    if (isCaseTarget(line.target)) {
      const ids = sl.caseIds ?? [];
      if (ids.length !== sl.qty)
        return err('validation', 'Pick one case number per case', { lineId: sl.lineId });
      for (const cid of ids) {
        const c = state.cases.find((x) => x.id === cid);
        if (!c || c.caseTypeId !== line.target.caseTypeId)
          return err('validation', `Case ${cid} does not match`);
        if (busy.has(cid) || usedCases.has(cid))
          return err('validation', `Case ${c.number} is already out`);
        usedCases.add(cid);
      }
    }
    if (sl.fromCaseId) {
      const c = state.cases.find((x) => x.id === sl.fromCaseId);
      if (!c || !isItemTarget(line.target)) return err('validation', 'Invalid source case');
      if (caseContentQty(c, line.target.itemId) < sl.qty) {
        return err('validation', `Case ${c.number} does not hold ${sl.qty} pieces`);
      }
    }
  }
  const checks = validateCaseChecks(state, input.lines);
  if (!checks.ok) return checks;

  const { state: next, result: casesChanged } = produce(state, (d) => {
    let casesChanged = false;
    const shipmentId = nextId(d, 'shp');
    d.shipments.push({
      id: shipmentId,
      bookingId,
      label: input.label.trim(),
      shippedOn: today,
      userId: user.id,
      lines: input.lines,
    });
    const booking = d.bookings.find((x) => x.id === bookingId) as Booking;
    for (const sl of input.lines) {
      const line = booking.lines.find((l) => l.id === sl.lineId) as BookingLine;
      if (applyCaseChecks(d, user.id, today, booking, sl)) casesChanged = true;
      if (sl.fromCaseId && isItemTarget(line.target)) {
        const c = d.cases.find((x) => x.id === sl.fromCaseId);
        const itemId = line.target.itemId;
        const entry = c?.contents.find((x) => x.itemId === itemId);
        if (c && entry) {
          entry.qty -= sl.qty;
          c.contents = c.contents.filter((x) => x.qty > 0);
          if (!contentsMatchStandard(d, c) && !c.incompleteSince) c.incompleteSince = today;
        }
      }
      if (isItemTarget(line.target) && getItem(d, line.target.itemId)?.returnable === false) {
        const w = resolveSourceWarehouse(d, booking, line);
        const itemId = line.target.itemId;
        const st = d.stock.find((s) => s.itemId === itemId && s.warehouseId === w);
        if (st) st.qty = Math.max(0, st.qty - sl.qty);
      }
    }
    // The order stays "Balí se" until everything has left; only then it is "Odvezeno".
    booking.status = remainingToShip(d, bookingId) === 0 ? 'shipped' : 'packing';
    const remaining = booking.lines
      .filter((l) => isActiveLine(l) && !l.fromBookingId)
      .reduce((n, l) => n + Math.max(0, effectiveQty(l) - shippedQty(d, booking.id, l.id)), 0);
    const shippedCount = input.lines.reduce((n, l) => n + l.qty, 0);
    postEvent(d, bookingId, user.id, today, 'batch_shipped', {
      label: input.label.trim(),
      shipped: shippedCount,
      remaining,
    });
    notify(
      d,
      [booking.pmId, ...chiefIds(d)],
      {
        type: 'batch_shipped',
        text: `${booking.eventName}: ${input.label.trim()} shipped (${shippedCount}), ${remaining} still to ship`,
        params: {
          event: booking.eventName,
          label: input.label.trim(),
          shipped: shippedCount,
          remaining,
        },
        bookingId,
      },
      today,
    );
    return casesChanged;
  });
  return ok(casesChanged ? recomputeConflictRecords(next, today) : next);
}

/**
 * Chief adds lines after shipping: the order goes back to packing as a new batch and the
 * warehouse gets a high-priority notification. Edits after shipping are logged and flagged.
 */
export function addLinesAfterShipping(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  lines: BookingLine[],
): Result<AppState> {
  const g = guard(state, user, 'addLinesAfterShipping', bookingId);
  if (!g.ok) return g;
  if (lines.length === 0) return err('validation', 'No lines to add');
  const added = lines.map((l) => ({ ...l, addedAfterShipping: true }));
  const { booking } = recalcBooking(state, { ...g.value, lines: [...g.value.lines, ...added] });
  // Auto lines created by the new lines are flagged as well.
  const before = new Set(g.value.lines.map((l) => l.id));
  booking.lines = booking.lines.map((l) =>
    before.has(l.id) ? l : { ...l, addedAfterShipping: true },
  );
  const next = produce(state, (d) => {
    const i = d.bookings.findIndex((x) => x.id === bookingId);
    d.bookings[i] = { ...booking, status: 'packing', editedAfterShipping: true };
    postEvent(d, bookingId, user.id, today, 'lines_added_after_shipping', { count: added.length });
    notify(
      d,
      warehouseIds(d),
      {
        type: 'order_edited_after_packing',
        text: `${booking.eventName}: lines added after shipping`,
        params: { event: booking.eventName, count: added.length },
        bookingId,
        highPriority: true,
      },
      today,
    );
  }).state;
  return ok(recomputeConflictRecords(next, today));
}

/**
 * Pieces (or cases) still to leave the warehouse on an order: active lines, external pickups
 * included, transfer lines excluded (they arrive from another event). A partly shipped order
 * stays on the packing list until this is 0.
 */
export function remainingToShip(state: AppState, bookingId: Id): number {
  const b = state.bookings.find((x) => x.id === bookingId);
  if (!b || b.type !== 'order' || !['confirmed', 'packing', 'shipped'].includes(b.status)) return 0;
  let n = 0;
  for (const l of b.lines) {
    if (!isActiveLine(l) || l.fromBookingId) continue;
    n += Math.max(0, effectiveQty(l) - shippedQty(state, b.id, l.id));
  }
  return n;
}

/** True when the user may ship (for UI). */
export const canShip = (user: User): boolean => can(user, 'ship');
