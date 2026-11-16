/**
 * Vratka (returns). The sheet lists what was shipped (not what was ordered). Each line needs an
 * explicit count (default 0), location, condition and confirmation; nothing is assumed returned.
 */
import type { IsoDate } from '../dates';
import { shippedQty } from '../availability';
import {
  contentsMatchStandard,
  getCaseType,
  getItem,
  homeLocationId,
  isCaseComplete,
  resolveSourceWarehouse,
  standardQty,
} from '../catalog';
import { recomputeConflictRecords } from '../conflicts';
import { guard } from '../lifecycle';
import { chiefIds, notify, postEvent } from '../notifications';
import { openServiceInDraft } from '../service';
import type {
  AppState,
  Booking,
  BookingLine,
  Id,
  Issue,
  ReturnLine,
  ReturnSession,
  UnexpectedItem,
  User,
} from '../types';
import {
  err,
  isCaseTarget,
  isExternal,
  isItemTarget,
  nextId,
  ok,
  produce,
  type Result,
} from '../util';

export type LineOutcome =
  'pending' | 'complete' | 'missing' | 'transferred' | 'supplier' | 'consumable';

export interface ReturnSheetLine {
  lineId: Id;
  kind: 'item' | 'case' | 'external';
  itemId?: Id;
  caseTypeId?: Id;
  name: string;
  shipped: number;
  returned: number;
  transferred: number;
  outstanding: number;
  outcome: LineOutcome;
  consumable: boolean;
  sourceWarehouseId?: Id;
  expectedReturnWarehouseId?: Id;
  suggestedLocationId?: Id;
  /** Loose pieces that came out of this case are suggested back into it. */
  suggestedIntoCaseId?: Id;
  shippedCaseIds: Id[];
  pendingCaseIds: Id[];
  contents?: { itemId: Id; qty: number }[];
}

function entriesFor(
  state: Pick<AppState, 'returnSessions'>,
  bookingId: Id,
  lineId: Id,
): ReturnLine[] {
  const out: ReturnLine[] = [];
  for (const s of state.returnSessions) {
    if (s.bookingId !== bookingId) continue;
    for (const l of s.lines) if (l.lineId === lineId) out.push(l);
  }
  return out;
}

function shippedCaseIds(state: Pick<AppState, 'shipments'>, bookingId: Id, lineId: Id): Id[] {
  const ids: Id[] = [];
  for (const s of state.shipments) {
    if (s.bookingId !== bookingId) continue;
    for (const l of s.lines) if (l.lineId === lineId) ids.push(...(l.caseIds ?? []));
  }
  return ids;
}

function fromCaseOf(state: Pick<AppState, 'shipments'>, bookingId: Id, lineId: Id): Id | undefined {
  for (const s of state.shipments) {
    if (s.bookingId !== bookingId) continue;
    for (const l of s.lines) if (l.lineId === lineId && l.fromCaseId) return l.fromCaseId;
  }
  return undefined;
}

function lineName(state: AppState, line: BookingLine): string {
  if (isExternal(line.target)) return line.target.external.name;
  if (isItemTarget(line.target))
    return getItem(state, line.target.itemId)?.name ?? line.target.itemId;
  return getCaseType(state, line.target.caseTypeId)?.name ?? line.target.caseTypeId;
}

/** Return sheet of a booking: one entry per shipped line. */
export function returnSheet(state: AppState, bookingId: Id): ReturnSheetLine[] {
  const b = state.bookings.find((x) => x.id === bookingId);
  if (!b) return [];
  const out: ReturnSheetLine[] = [];
  for (const line of b.lines) {
    const shipped = shippedQty(state, b.id, line.id);
    if (shipped <= 0) continue;
    const entries = entriesFor(state, b.id, line.id);
    const consumable =
      isItemTarget(line.target) && getItem(state, line.target.itemId)?.returnable === false;
    const caseIds = shippedCaseIds(state, b.id, line.id);
    const reportedCases = new Set(entries.map((e) => e.caseId).filter((x): x is Id => !!x));
    const pendingCaseIds = caseIds.filter((c) => !reportedCases.has(c));
    const returned = entries.reduce((n, e) => n + e.returnedQty, 0);
    const transferred = entries.reduce((n, e) => n + (e.transferredQty ?? 0), 0);
    const kind = isExternal(line.target) ? 'external' : isCaseTarget(line.target) ? 'case' : 'item';
    const outstanding =
      kind === 'case' ? pendingCaseIds.length : Math.max(0, shipped - returned - transferred);

    let outcome: LineOutcome;
    if (consumable) outcome = 'consumable';
    else if (kind === 'case') {
      if (pendingCaseIds.length > 0) outcome = 'pending';
      else if (entries.some((e) => e.returnedQty === 0)) outcome = 'missing';
      else outcome = 'complete';
    } else if (outstanding === 0) {
      if (kind === 'external') outcome = 'supplier';
      else if (transferred >= shipped) outcome = 'transferred';
      else outcome = 'complete';
    } else outcome = entries.length > 0 ? 'missing' : 'pending';

    const sheet: ReturnSheetLine = {
      lineId: line.id,
      kind,
      name: lineName(state, line),
      shipped,
      returned,
      transferred,
      outstanding,
      outcome,
      consumable,
      shippedCaseIds: caseIds,
      pendingCaseIds,
    };
    if (kind !== 'external') {
      const src = resolveSourceWarehouse(state, b, line);
      const exp = line.expectedReturnWarehouseId ?? src;
      sheet.sourceWarehouseId = src;
      sheet.expectedReturnWarehouseId = exp;
      if (isItemTarget(line.target)) {
        sheet.itemId = line.target.itemId;
        const loc =
          homeLocationId(state, line.target.itemId, exp) ??
          state.locations.find((l) => l.warehouseId === exp)?.id;
        if (loc) sheet.suggestedLocationId = loc;
        const fromCase = fromCaseOf(state, b.id, line.id);
        if (fromCase) sheet.suggestedIntoCaseId = fromCase;
      } else if (isCaseTarget(line.target)) {
        sheet.caseTypeId = line.target.caseTypeId;
        sheet.contents = getCaseType(state, line.target.caseTypeId)?.contents ?? [];
        const c = state.cases.find((x) => x.id === pendingCaseIds[0]);
        const loc =
          c && c.warehouseId === exp
            ? c.locationId
            : state.locations.find((l) => l.warehouseId === exp)?.id;
        if (loc) sheet.suggestedLocationId = loc;
      }
    }
    out.push(sheet);
  }
  return out;
}

/** True when every shipped line has an outcome. */
export function allLinesSettled(sheet: ReturnSheetLine[]): boolean {
  return sheet.every((l) => l.outcome !== 'pending');
}

export interface ReturnLineInput extends ReturnLine {
  /** The per-line confirmation checkbox. */
  confirmed: boolean;
}

export interface ReturnSessionInput {
  lines: ReturnLineInput[];
  unexpected?: UnexpectedItem[];
}

const TRANSFER_TARGET = new Set(['confirmed', 'packing', 'shipped', 'returning']);

function validate(state: AppState, b: Booking, input: ReturnSessionInput): Result<true> {
  const sheet = new Map(returnSheet(state, b.id).map((s) => [s.lineId, s]));
  const byLine = new Map<Id, ReturnLineInput[]>();
  for (const e of input.lines) byLine.set(e.lineId, [...(byLine.get(e.lineId) ?? []), e]);
  for (const [lineId, entries] of byLine) {
    const s = sheet.get(lineId);
    if (!s) return err('validation', `Line ${lineId} was not shipped`, { lineId });
    if (s.consumable) return err('validation', 'Consumables are not returned', { lineId });
    let used = 0;
    for (const e of entries) {
      if (!e.confirmed) return err('validation', 'Every line must be confirmed', { lineId });
      if (!Number.isInteger(e.returnedQty) || e.returnedQty < 0)
        return err('validation', 'Invalid count', { lineId });
      const tq = e.transferredQty ?? 0;
      if (!Number.isInteger(tq) || tq < 0)
        return err('validation', 'Invalid transfer count', { lineId });
      const damaged = e.damagedQty ?? (e.condition === 'ok' ? 0 : e.returnedQty);
      if (damaged > e.returnedQty)
        return err('validation', 'Damaged count exceeds returned count', { lineId });
      if (e.condition !== 'ok' && !e.note?.trim())
        return err('validation', 'A note is required for damaged items', { lineId });
      if (s.kind === 'external') {
        if (e.returnedQty > 0 && !e.returnedToSupplier)
          return err('validation', 'External lines are returned to the supplier', { lineId });
      } else if (e.returnedQty > 0 && !e.locationId) {
        return err('validation', 'Location is required', { lineId });
      }
      if (e.locationId && !state.locations.some((l) => l.id === e.locationId))
        return err('validation', 'Unknown location', { lineId });
      if (tq > 0) {
        if (s.kind !== 'item')
          return err('validation', 'Only loose items can be transferred', { lineId });
        const target = state.bookings.find((x) => x.id === e.transferredToBookingId);
        if (
          !target ||
          target.id === b.id ||
          target.type !== 'order' ||
          !TRANSFER_TARGET.has(target.status)
        ) {
          return err('validation', 'Transfer target must be another active order', { lineId });
        }
      }
      if (s.kind === 'case') {
        if (!e.caseId || !s.pendingCaseIds.includes(e.caseId))
          return err('validation', 'Unknown or already returned case', { lineId });
        if (e.returnedQty > 1) return err('validation', 'One entry per case', { lineId });
        const std = s.contents ?? [];
        if (e.returnedQty === 1) {
          for (const c of e.caseContents ?? []) {
            const max = std.find((x) => x.itemId === c.itemId)?.qty ?? 0;
            if (c.qty < 0 || c.qty > max)
              return err('validation', 'Case content count out of range', { lineId });
            if ((c.damagedQty ?? 0) > c.qty)
              return err('validation', 'Damaged count exceeds returned count', { lineId });
            if ((c.damagedQty ?? 0) > 0 && !e.note?.trim())
              return err('validation', 'A note is required for damaged items', { lineId });
          }
          const short = std.some(
            (x) => (e.caseContents?.find((c) => c.itemId === x.itemId)?.qty ?? 0) < x.qty,
          );
          if (short && !e.note?.trim())
            return err('validation', 'A note is required when a case is short', { lineId });
        } else if (!e.note?.trim())
          return err('validation', 'A note is required for a missing case', { lineId });
      } else {
        used += e.returnedQty + tq;
      }
    }
    if (s.kind !== 'case') {
      if (used > s.outstanding) return err('validation', 'More returned than shipped', { lineId });
      if (used < s.outstanding && !entries.some((e) => e.note?.trim())) {
        return err('validation', 'A note is required when a line is short', { lineId });
      }
    }
  }
  for (const u of input.unexpected ?? []) {
    if (!u.note.trim() || u.qty <= 0 || (!u.itemId && !u.name?.trim()))
      return err('validation', 'Unexpected item needs item, count and note');
  }
  return ok(true);
}

/** Move stock of an item between warehouses (records a transfer). */
function moveStock(
  d: AppState,
  itemId: Id,
  qty: number,
  from: Id,
  to: Id,
  on: IsoDate,
  bookingId: Id,
  homeLoc?: Id,
) {
  if (qty <= 0 || from === to) return;
  const src = d.stock.find((s) => s.itemId === itemId && s.warehouseId === from);
  if (src) src.qty = Math.max(0, src.qty - qty);
  let dst = d.stock.find((s) => s.itemId === itemId && s.warehouseId === to);
  if (!dst) {
    dst = {
      itemId,
      warehouseId: to,
      qty: 0,
      homeLocationId: homeLoc ?? d.locations.find((l) => l.warehouseId === to)?.id ?? '',
    };
    d.stock.push(dst);
  }
  dst.qty += qty;
  d.transfers.push({
    id: nextId(d, 'trf'),
    itemId,
    qty,
    fromWarehouseId: from,
    toWarehouseId: to,
    on,
    bookingId,
  });
}

function upsertMissingIssue(
  d: AppState,
  userId: Id,
  today: IsoDate,
  fields: Omit<Issue, 'id' | 'type' | 'reportedBy' | 'reportedOn'>,
) {
  const existing = d.issues.find(
    (i) =>
      i.type === 'missing' &&
      !i.archivedOn &&
      i.bookingId === fields.bookingId &&
      i.lineId === fields.lineId &&
      i.caseId === fields.caseId &&
      i.itemId === fields.itemId,
  );
  if (existing) {
    existing.qty = fields.qty;
    if (fields.note) existing.note = fields.note;
    return;
  }
  d.issues.push({
    id: nextId(d, 'iss'),
    type: 'missing',
    reportedBy: userId,
    reportedOn: today,
    ...fields,
  });
}

/** Pieces arrive on booking B straight from booking A (closed on A, shipped on B). */
function transferIn(
  d: AppState,
  from: Booking,
  line: BookingLine,
  qty: number,
  toId: Id,
  userId: Id,
  today: IsoDate,
  sourceW: Id,
) {
  const to = d.bookings.find((x) => x.id === toId) as Booking;
  const itemId = (line.target as { itemId: Id }).itemId;
  let target = to.lines.find(
    (l) => l.fromBookingId === from.id && isItemTarget(l.target) && l.target.itemId === itemId,
  );
  if (!target) {
    let n = to.lines.length + 1;
    while (to.lines.some((l) => l.id === `${to.id}-l${n}`)) n += 1;
    target = {
      id: `${to.id}-l${n}`,
      target: { itemId },
      qty: 0,
      fromBookingId: from.id,
      sourceWarehouseId: sourceW,
      expectedReturnWarehouseId: line.expectedReturnWarehouseId ?? sourceW,
      origin: 'manual',
      parentLineIds: [],
      status: 'ok',
      conflictAck: false,
    };
    to.lines.push(target);
  }
  target.transferredOn = target.transferredOn ?? today;
  target.sourceWarehouseId = target.sourceWarehouseId ?? sourceW;
  const already = shippedQty(d, to.id, target.id);
  if (target.qty < already + qty) target.qty = already + qty;
  d.shipments.push({
    id: nextId(d, 'shp'),
    bookingId: to.id,
    label: from.eventName,
    shippedOn: today,
    userId,
    lines: [{ lineId: target.id, qty }],
    transferFromBookingId: from.id,
  });
  postEvent(d, from.id, userId, today, 'transfer_out', { qty, itemId, to: to.eventName });
  postEvent(d, to.id, userId, today, 'transfer_in', { qty, itemId, from: from.eventName });
}

/**
 * Record one vratka session. Outcomes: complete; short (missing → Issue); damaged / needs check
 * (→ service case); transferred to another order; returned to supplier (external). The booking
 * becomes `returned` when every shipped line has an outcome, or `returned_with_issues` when any
 * piece is missing. Sessions can be repeated (gear coming back later).
 */
export function recordReturnSession(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  input: ReturnSessionInput,
): Result<AppState> {
  const g = guard(state, user, 'recordReturnSession', bookingId);
  if (!g.ok) return g;
  const b = g.value;
  if (!state.shipments.some((s) => s.bookingId === bookingId)) {
    return err('invalid_state', 'Nothing has been shipped yet');
  }
  if (input.lines.length === 0 && (input.unexpected ?? []).length === 0)
    return err('validation', 'Nothing to record');
  const v = validate(state, b, input);
  if (!v.ok) return v;
  const sheetBefore = new Map(returnSheet(state, b.id).map((s) => [s.lineId, s]));

  const next = produce(state, (d) => {
    const session: ReturnSession = {
      id: nextId(d, 'ret'),
      bookingId,
      userId: user.id,
      on: today,
      lines: input.lines.map(({ confirmed: _c, ...rest }) => rest),
      unexpected: input.unexpected ?? [],
    };
    d.returnSessions.push(session);
    const booking = d.bookings.find((x) => x.id === bookingId) as Booking;
    const linesTouched = new Set<Id>();

    for (const e of input.lines) {
      const line = booking.lines.find((l) => l.id === e.lineId) as BookingLine;
      const sheet = sheetBefore.get(e.lineId) as ReturnSheetLine;
      linesTouched.add(line.id);
      if (sheet.kind === 'external') continue;
      const ws = resolveSourceWarehouse(d, booking, line);
      const loc = d.locations.find((l) => l.id === e.locationId);
      const wl = loc?.warehouseId ?? ws;

      if (sheet.kind === 'case') {
        const c = d.cases.find((x) => x.id === e.caseId);
        if (!c) continue;
        const t = getCaseType(d, c.caseTypeId);
        if (e.returnedQty === 0) {
          upsertMissingIssue(d, user.id, today, {
            bookingId,
            lineId: line.id,
            caseId: c.id,
            qty: 1,
            warehouseId: c.warehouseId,
            note: e.note ?? '',
          });
          continue;
        }
        const originalW = c.warehouseId;
        const newContents = (t?.contents ?? []).map((std) => ({
          itemId: std.itemId,
          qty: e.caseContents?.find((x) => x.itemId === std.itemId)?.qty ?? 0,
        }));
        for (const std of t?.contents ?? []) {
          const got = newContents.find((x) => x.itemId === std.itemId)?.qty ?? 0;
          if (got < std.qty) {
            upsertMissingIssue(d, user.id, today, {
              bookingId,
              lineId: line.id,
              caseId: c.id,
              itemId: std.itemId,
              qty: std.qty - got,
              warehouseId: originalW,
              note: e.note ?? '',
            });
          }
        }
        if (wl !== originalW) {
          for (const nc of newContents)
            moveStock(d, nc.itemId, nc.qty, originalW, wl, today, bookingId);
          c.warehouseId = wl;
        }
        c.contents = newContents.filter((x) => x.qty > 0);
        if (loc) c.locationId = loc.id;
        for (const cc of e.caseContents ?? []) {
          if ((cc.damagedQty ?? 0) > 0) {
            openServiceInDraft(d, user.id, today, {
              itemId: cc.itemId,
              warehouseId: wl,
              qty: cc.damagedQty ?? 0,
              reason: e.note ?? '',
              caseId: c.id,
              openedFromBookingId: bookingId,
            });
          }
        }
        if (contentsMatchStandard(d, c)) delete c.incompleteSince;
        else c.incompleteSince = today;
        continue;
      }

      // Loose item line.
      const itemId = (line.target as { itemId: Id }).itemId;
      const damaged = e.damagedQty ?? (e.condition === 'ok' ? 0 : e.returnedQty);
      const okPieces = e.returnedQty - damaged;
      if (e.returnedQty > 0) moveStock(d, itemId, e.returnedQty, ws, wl, today, bookingId, loc?.id);
      if (e.intoCaseId && okPieces > 0) {
        const c = d.cases.find((x) => x.id === e.intoCaseId);
        const t = c ? getCaseType(d, c.caseTypeId) : undefined;
        if (c && t && c.warehouseId === wl) {
          const entry = c.contents.find((x) => x.itemId === itemId);
          const have = entry?.qty ?? 0;
          const put = Math.min(okPieces, Math.max(0, standardQty(t, itemId) - have));
          if (put > 0) {
            if (entry) entry.qty += put;
            else c.contents.push({ itemId, qty: put });
          }
        }
      }
      if (damaged > 0) {
        openServiceInDraft(d, user.id, today, {
          itemId,
          warehouseId: wl,
          qty: damaged,
          reason: e.note ?? '',
          openedFromBookingId: bookingId,
        });
      }
      if ((e.transferredQty ?? 0) > 0 && e.transferredToBookingId) {
        transferIn(
          d,
          booking,
          line,
          e.transferredQty ?? 0,
          e.transferredToBookingId,
          user.id,
          today,
          ws,
        );
      }
    }

    // Shortfalls of loose lines become (or update) missing issues; late returns archive them.
    for (const lineId of linesTouched) {
      const line = booking.lines.find((l) => l.id === lineId) as BookingLine;
      const before = sheetBefore.get(lineId) as ReturnSheetLine;
      if (before.kind === 'case') continue;
      const after = returnSheet(d, bookingId).find((s) => s.lineId === lineId);
      const outstanding = after?.outstanding ?? 0;
      const ws = isExternal(line.target) ? undefined : resolveSourceWarehouse(d, booking, line);
      const open = d.issues.find(
        (i) =>
          i.type === 'missing' &&
          !i.archivedOn &&
          i.bookingId === bookingId &&
          i.lineId === lineId &&
          !i.caseId,
      );
      if (outstanding > 0) {
        const note = input.lines.find((x) => x.lineId === lineId && x.note)?.note ?? '';
        const fields: Omit<Issue, 'id' | 'type' | 'reportedBy' | 'reportedOn'> = {
          bookingId,
          lineId,
          qty: outstanding,
          note,
        };
        if (isItemTarget(line.target)) fields.itemId = line.target.itemId;
        else if (isExternal(line.target)) {
          fields.name = line.target.external.name;
          if (line.target.external.itemId) fields.itemId = line.target.external.itemId;
        }
        if (ws && !isExternal(line.target)) fields.warehouseId = ws;
        upsertMissingIssue(d, user.id, today, fields);
      } else if (open) {
        open.archivedOn = today;
        open.resolutionKind = 'found';
        open.resolution = 'returned-later';
        open.resolvedBy = user.id;
      }
      // A source case not refilled from this line starts its refill clock now.
      const fromCase = before.suggestedIntoCaseId;
      const c = fromCase ? d.cases.find((x) => x.id === fromCase) : undefined;
      if (c) {
        if (contentsMatchStandard(d, c)) delete c.incompleteSince;
        else c.incompleteSince = today;
      }
    }

    for (const u of input.unexpected ?? []) {
      const iss: Issue = {
        id: nextId(d, 'iss'),
        type: 'unexpected',
        qty: u.qty,
        note: u.note,
        bookingId,
        reportedBy: user.id,
        reportedOn: today,
      };
      if (u.itemId) iss.itemId = u.itemId;
      if (u.name) iss.name = u.name;
      d.issues.push(iss);
    }

    const sheet = returnSheet(d, bookingId);
    const settled = allLinesSettled(sheet);
    const openMissing = d.issues.some(
      (i) => i.bookingId === bookingId && i.type === 'missing' && !i.archivedOn,
    );
    const prevStatus = booking.status;
    booking.status = settled ? (openMissing ? 'returned_with_issues' : 'returned') : 'returning';
    postEvent(d, bookingId, user.id, today, 'return_session', {
      lines: input.lines.length,
      status: booking.status,
    });
    if (booking.status === 'returned_with_issues' && prevStatus !== 'returned_with_issues') {
      notify(
        d,
        [...chiefIds(d), booking.pmId],
        {
          type: 'returned_with_issues',
          text: `${booking.eventName} returned with issues`,
          params: { event: booking.eventName },
          bookingId,
        },
        today,
      );
    }
  }).state;
  return ok(recomputeConflictRecords(next, today));
}

/** "Kompletní dle standardu" for one case: a return entry with the full standard contents. */
export function completeAsStandard(
  state: AppState,
  lineId: Id,
  caseId: Id,
  locationId: Id,
): ReturnLineInput {
  const c = state.cases.find((x) => x.id === caseId);
  const t = c ? getCaseType(state, c.caseTypeId) : undefined;
  return {
    lineId,
    caseId,
    confirmed: true,
    returnedQty: 1,
    locationId,
    condition: 'ok',
    caseContents: (t?.contents ?? []).map((x) => ({ itemId: x.itemId, qty: x.qty })),
  };
}

/** True when the case is complete (for showing the result screen). */
export const caseIsComplete = (state: AppState, caseId: Id): boolean => {
  const c = state.cases.find((x) => x.id === caseId);
  return !!c && isCaseComplete(state, c);
};

/** Lines of a booking still to come back, for dashboards. */
export function expectedReturnCount(state: AppState, bookingId: Id): number {
  return returnSheet(state, bookingId).filter((l) => l.outcome === 'pending').length;
}
