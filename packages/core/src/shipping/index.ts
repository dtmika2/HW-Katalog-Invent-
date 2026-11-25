/**
 * The packing list and shipping in batches. The packing list is flat per warehouse, grouped by storage
 * location; cases are one line with their contents.
 */
import type { IsoDate } from '../dates';
import { shippedQty } from '../availability';
import {
  getCaseType,
  getItem,
  homeLocationId,
  isCaseComplete,
  resolveSourceWarehouse,
} from '../catalog';
import { recomputeConflictRecords } from '../conflicts';
import { groupOfLine, guard, recalcBooking } from '../lifecycle';
import { can } from '../lifecycle/permissions';
import { chiefIds, notify, postEvent, warehouseIds } from '../notifications';
import {
  acceptedConflicts,
  applyCaseChecks,
  backItems,
  cancelGuard,
  casePlaces,
  deferrableQty,
  lineProgress,
  openPromises,
  packedInHouse,
  packLines,
  promisedText,
  statusAfter,
  validatePickedLines,
  type BackItem,
  type CancelInput,
  type CasePlace,
  type LineProgress,
} from '../packing';
import { recordReturnSession, returnSheet } from '../returns';
import type {
  AppState,
  Booking,
  BookingGroup,
  BookingLine,
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
  /** Taken by an order (this one included): packed or out. */
  busy: boolean;
  place?: CasePlace;
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
  /** The PM's own group the line is shown in. */
  group?: BookingGroup;
  progress: LineProgress;
  /** Pieces that may be left for the shipping. */
  deferrable: number;
  /** Why own pieces are short: accepted conflicts with reasons. */
  conflicts: { short: number; reason: string; colliding: string[] }[];
  /** Last time something of it was packed. */
  packedBy?: { userId: Id; on: IsoDate };
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
  const places = casePlaces(state);
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
      progress: lineProgress(state, b, line),
      deferrable: deferrableQty(state, b, line),
      conflicts: acceptedConflicts(state, b.id, line.id).map((r) => ({
        short: r.shortQty,
        reason: r.overrideReason || r.resolution || '',
        colliding: r.collidingBookingIds.map(
          (id) => state.bookings.find((x) => x.id === id)?.eventName ?? id,
        ),
      })),
    };
    const last = state.packings
      .filter(
        (p) => p.bookingId === b.id && p.lines.some((l) => l.lineId === line.id && !l.deferred),
      )
      .at(-1);
    if (last) base.packedBy = { userId: last.userId, on: last.on };
    const group = groupOfLine(b, line.id);
    if (group) base.group = group;
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
          busy: places.has(c.id),
          ...(places.has(c.id) ? { place: places.get(c.id) as CasePlace } : {}),
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

export interface ShipBatchInput {
  label: string;
  lines: ShipmentLine[];
  /** Why promised gear is not on board ("dorazí rovnou na místo"). */
  note?: string;
  /** Pack and ship in one go: why it is taken before the booked days. */
  earlyReason?: string;
}

/** The oldest packed pieces of a line, with the cases they came out of. */
function takePacked(state: AppState, bookingId: Id, sl: ShipmentLine): ShipmentLine[] {
  const inHouse = packedInHouse(state, bookingId, sl.lineId);
  if (sl.caseIds) {
    const ids = sl.caseIds;
    const checks = inHouse.flatMap((e) => e.caseChecks ?? []).filter((c) => ids.includes(c.caseId));
    return [
      {
        lineId: sl.lineId,
        qty: sl.qty,
        caseIds: ids,
        ...(checks.length > 0 ? { caseChecks: checks } : {}),
      },
    ];
  }
  let left = sl.qty;
  const out: ShipmentLine[] = [];
  for (const e of inHouse) {
    const n = Math.min(left, e.qty);
    if (n <= 0) continue;
    left -= n;
    out.push({ lineId: sl.lineId, qty: n, ...(e.fromCaseId ? { fromCaseId: e.fromCaseId } : {}) });
  }
  return out;
}

/**
 * Ship a batch ("Dodávka 1"): packed gear, and promised gear confirmed as part of the delivery
 * (`deferred`). The van leaves even when something promised has not come; that is written into
 * the conversation, and it stays open for a later batch. Consumables leave the stock, PM and
 * Chief are notified.
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
  for (const sl of input.lines) {
    const line = b.lines.find((l) => l.id === sl.lineId);
    if (!line || !isActiveLine(line)) return err('validation', `Unknown line ${sl.lineId}`);
    const p = lineProgress(state, b, line);
    const limit = sl.deferred ? p.readyDeferred : p.readyPacked;
    if (!Number.isInteger(sl.qty) || sl.qty <= 0 || sl.qty > limit)
      return err('validation', `Invalid quantity for line ${sl.lineId}`, {
        lineId: sl.lineId,
        remaining: limit,
      });
    if (!sl.deferred && isCaseTarget(line.target)) {
      const here = packedInHouse(state, bookingId, line.id).flatMap((e) => e.caseIds ?? []);
      const ids = sl.caseIds ?? [];
      if (
        ids.length !== sl.qty ||
        new Set(ids).size !== ids.length ||
        ids.some((c) => !here.includes(c))
      )
        return err('validation', 'Ship the cases that were packed', { lineId: sl.lineId });
    }
  }
  const keys = input.lines.map((l) => `${l.lineId}|${l.deferred ? 'd' : ''}`);
  if (new Set(keys).size !== keys.length) return err('validation', 'A line is listed twice');
  const arriving = input.lines.filter((l) => l.deferred);
  const v = validatePickedLines(
    state,
    b,
    arriving,
    (line) => lineProgress(state, b, line).readyDeferred,
  );
  if (!v.ok) return v;

  const { state: next, result: casesChanged } = produce(state, (d) => {
    let casesChanged = false;
    const booking = d.bookings.find((x) => x.id === bookingId) as Booking;
    for (const sl of arriving)
      if (applyCaseChecks(d, user.id, today, booking, sl)) casesChanged = true;
    const lines = input.lines.flatMap((sl) =>
      sl.deferred ? [{ ...sl }] : takePacked(state, bookingId, sl),
    );
    d.shipments.push({
      id: nextId(d, 'shp'),
      bookingId,
      label: input.label.trim(),
      shippedOn: today,
      userId: user.id,
      lines,
    });
    for (const sl of lines) {
      const line = booking.lines.find((l) => l.id === sl.lineId) as BookingLine;
      if (isItemTarget(line.target) && getItem(d, line.target.itemId)?.returnable === false) {
        const w = resolveSourceWarehouse(d, booking, line);
        const itemId = line.target.itemId;
        const st = d.stock.find((s) => s.itemId === itemId && s.warehouseId === w);
        if (st) st.qty = Math.max(0, st.qty - sl.qty);
      }
    }
    // "Odvezeno" only when everything has left.
    booking.status = statusAfter(d, booking);
    const remaining = booking.lines
      .filter((l) => isActiveLine(l) && !l.fromBookingId)
      .reduce((n, l) => n + Math.max(0, effectiveQty(l) - shippedQty(d, booking.id, l.id)), 0);
    const shippedCount = lines.reduce((n, l) => n + l.qty, 0);
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
    trackPromises(d, user, today, booking, arriving, input.note?.trim() ?? '');
    return casesChanged;
  });
  return ok(casesChanged ? recomputeConflictRecords(next, today) : next);
}

/** Write into the conversation what was promised and is not on board, and what came late. */
function trackPromises(
  d: AppState,
  user: User,
  today: IsoDate,
  booking: Booking,
  arriving: ShipmentLine[],
  note: string,
): void {
  const events = d.messages.filter((m) => m.bookingId === booking.id && m.event);
  // a cancelled delivery starts the story again
  const cut = events.map((m) => m.event?.type).lastIndexOf('shipping_cancelled');
  const earlier = events.slice(cut + 1).filter((m) => m.event?.type === 'shipped_without');
  if (arriving.length > 0 && earlier.length > 0) {
    const came = arriving.map((sl) => {
      const line = booking.lines.find((l) => l.id === sl.lineId) as BookingLine;
      return {
        qty: sl.qty,
        name: lineName(d, line),
        from: isExternal(line.target) ? line.target.external.supplier : '',
      };
    });
    postEvent(d, booking.id, user.id, today, 'promised_arrived', { what: promisedText(came) });
  }
  const open = openPromises(d, booking);
  const what = promisedText(open);
  // the same gap is not repeated with every van
  if (!what || (!note && earlier.at(-1)?.event?.params.what === what)) return;
  postEvent(d, booking.id, user.id, today, 'shipped_without', { what, note });
  // gear coming straight from another event was never meant to be on this van
  const missing = promisedText(open.filter((p) => p.kind !== 'transfer'));
  if (!missing) return;
  notify(
    d,
    [booking.pmId, ...chiefIds(d)],
    {
      type: 'promised_missing',
      text: `${booking.eventName}: shipped without ${missing}`,
      params: { event: booking.eventName, what: missing, reason: note },
      bookingId: booking.id,
    },
    today,
  );
}

/** Pack and ship the same lines in one go. */
export function packAndShip(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  input: ShipBatchInput,
): Result<AppState> {
  if (!input.label.trim()) return err('validation', 'Batch label is required');
  const packed = packLines(state, user, today, bookingId, input.lines, {
    silent: true,
    ...(input.earlyReason ? { earlyReason: input.earlyReason } : {}),
  });
  if (!packed.ok) return packed;
  const lines = new Map<Id, ShipmentLine>();
  for (const l of input.lines) {
    const same = lines.get(l.lineId);
    if (!same)
      lines.set(l.lineId, {
        lineId: l.lineId,
        qty: l.qty,
        ...(l.caseIds ? { caseIds: l.caseIds } : {}),
      });
    else {
      same.qty += l.qty;
      if (l.caseIds) same.caseIds = [...(same.caseIds ?? []), ...l.caseIds];
    }
  }
  return shipBatch(packed.value, user, today, bookingId, {
    ...input,
    lines: [...lines.values()],
  });
}

/** What "Zrušit odvoz" has to confirm: every case and loose line of the delivery. */
export function shipmentBackItems(state: AppState, shipmentId: Id): BackItem[] {
  const s = state.shipments.find((x) => x.id === shipmentId);
  const b = s && state.bookings.find((x) => x.id === s.bookingId);
  return s && b ? backItems(state, b, s.lines) : [];
}

/** True while a delivery can be taken back: it is the order's own and no vratka was recorded. */
export function canCancelShipment(state: AppState, shipmentId: Id): boolean {
  const s = state.shipments.find((x) => x.id === shipmentId);
  const b = s && state.bookings.find((x) => x.id === s.bookingId);
  return (
    !!s &&
    !!b &&
    !s.transferFromBookingId &&
    ['packing', 'packed', 'shipped'].includes(b.status) &&
    !state.returnSessions.some((r) => r.bookingId === b.id)
  );
}

/**
 * Cancel a delivery recorded by mistake, after confirming that every piece and case of it is back
 * (anything missing has to go through the vratka). Its gear is packed again, promised gear
 * is open again and consumables are back in the stock. PM and Chief, who heard that it left, are
 * told.
 */
export function cancelShipment(
  state: AppState,
  user: User,
  today: IsoDate,
  shipmentId: Id,
  input: CancelInput,
): Result<AppState> {
  const shipment = state.shipments.find((x) => x.id === shipmentId);
  if (!shipment) return err('not_found', `Shipment ${shipmentId} not found`);
  const g = cancelGuard(
    state,
    user,
    today,
    shipment.bookingId,
    shipmentBackItems(state, shipmentId),
    input,
  );
  if (!g.ok) return g;
  if (!canCancelShipment(state, shipmentId))
    return err('invalid_state', 'The delivery can no longer be cancelled');
  const why = input.reason?.trim() ?? '';
  const next = produce(state, (d) => {
    const booking = d.bookings.find((x) => x.id === shipment.bookingId) as Booking;
    d.shipments = d.shipments.filter((x) => x.id !== shipmentId);
    if (booking.cancelRequests)
      booking.cancelRequests = booking.cancelRequests.filter((r) => r.shipmentId !== shipmentId);
    for (const sl of shipment.lines) {
      const line = booking.lines.find((l) => l.id === sl.lineId);
      if (!line || !isItemTarget(line.target)) continue;
      if (getItem(d, line.target.itemId)?.returnable !== false) continue;
      const w = resolveSourceWarehouse(d, booking, line);
      const itemId = line.target.itemId;
      const st = d.stock.find((s) => s.itemId === itemId && s.warehouseId === w);
      if (st) st.qty += sl.qty;
    }
    booking.status = statusAfter(d, booking);
    const count = shipment.lines.reduce((n, l) => n + l.qty, 0);
    postEvent(d, booking.id, user.id, today, 'shipping_cancelled', {
      label: shipment.label,
      count,
      ...(why ? { reason: why } : {}),
    });
    notify(
      d,
      [booking.pmId, ...chiefIds(d)],
      {
        type: 'shipping_cancelled',
        text: `${booking.eventName}: ${shipment.label} was cancelled`,
        params: { event: booking.eventName, label: shipment.label, count, reason: why },
        bookingId: booking.id,
      },
      today,
    );
  }).state;
  return ok(recomputeConflictRecords(next, today));
}

/**
 * Confirm a planned handover from the receiving order: recorded in the vratka of the event the
 * gear comes from. Only when everything outstanding there is handed over; a partial handover is
 * recorded in that vratka, where the rest is counted too.
 */
export function confirmHandover(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  lineId: Id,
): Result<AppState> {
  const b = state.bookings.find((x) => x.id === bookingId);
  const line = b?.lines.find((l) => l.id === lineId);
  if (!b || !line?.fromBookingId || !isItemTarget(line.target))
    return err('not_found', 'No planned handover on that line');
  const h = handoverOf(state, b, line);
  if (!h) return err('invalid_state', 'The gear has not been shipped on the other event yet');
  if (!h.whole)
    return err('validation', 'A partial handover is recorded in the other vratka', {
      field: 'partial',
    });
  return recordReturnSession(state, user, today, line.fromBookingId, {
    lines: [
      {
        lineId: h.sourceLineId,
        returnedQty: 0,
        condition: 'ok',
        confirmed: true,
        transferredToBookingId: b.id,
        transferredQty: h.outstanding,
      },
    ],
  });
}

/** Source line of a planned handover and whether all of it can go over at once. */
export function handoverOf(
  state: AppState,
  b: Booking,
  line: BookingLine,
): { sourceLineId: Id; outstanding: number; whole: boolean } | undefined {
  if (!line.fromBookingId || !isItemTarget(line.target)) return undefined;
  const itemId = line.target.itemId;
  const open = Math.max(0, effectiveQty(line) - shippedQty(state, b.id, line.id));
  const src = returnSheet(state, line.fromBookingId).find(
    (l) => l.itemId === itemId && l.outstanding > 0,
  );
  if (!src || open <= 0) return undefined;
  return {
    sourceLineId: src.lineId,
    outstanding: src.outstanding,
    whole: src.outstanding <= open,
  };
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
  if (!b || b.type !== 'order' || !['confirmed', 'packing', 'packed', 'shipped'].includes(b.status))
    return 0;
  let n = 0;
  for (const l of b.lines) {
    if (!isActiveLine(l) || l.fromBookingId) continue;
    n += Math.max(0, effectiveQty(l) - shippedQty(state, b.id, l.id));
  }
  return n;
}

/** True when the user may ship (for UI). */
export const canShip = (user: User): boolean => can(user, 'ship');
