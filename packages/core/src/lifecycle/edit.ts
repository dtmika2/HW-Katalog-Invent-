/**
 * Pure edits of a booking being built in an editor. They return a new booking; they do not
 * touch `AppState`. Saving goes through `saveBooking` / `submit` / `confirm`.
 */
import { addDays, type IsoDate } from '../dates';
import { availabilityOracle } from '../availability';
import { getCaseType, getItem } from '../catalog';
import { expand, type ExpandResult } from '../expansion';
import type {
  AppState,
  Booking,
  BookingLine,
  BookingPeriod,
  ExternalSpec,
  Id,
  LineStatus,
  Settings,
  Target,
} from '../types';
import { isCaseTarget, isItemTarget } from '../util';

/** Period with the default buffer around the event (e.g. event Fri–Sat → booked Thu–Sun). */
export function periodWithBuffer(
  eventFrom: IsoDate,
  eventTo: IsoDate,
  settings: Settings,
): BookingPeriod {
  return {
    eventFrom,
    eventTo,
    bookedFrom: addDays(eventFrom, -settings.bufferBeforeDays),
    bookedUntil: addDays(eventTo, settings.bufferAfterDays),
  };
}

/** New manual line. */
export function newLine(target: BookingLine['target'], qty: number, id: Id): BookingLine {
  return {
    id,
    target,
    qty,
    origin: 'manual',
    parentLineIds: [],
    status: 'ok',
    conflictAck: false,
  };
}

/** Next free manual line id for a booking (`<bookingId>-l<n>`). */
export function nextLineId(booking: Pick<Booking, 'id' | 'lines'>): Id {
  let n = booking.lines.length + 1;
  const ids = new Set(booking.lines.map((l) => l.id));
  while (ids.has(`${booking.id}-l${n}`)) n += 1;
  return `${booking.id}-l${n}`;
}

/** Re-run the connections engine on a booking (with availability-based OR preselection). */
export function recalcBooking(
  state: AppState,
  booking: Booking,
): { booking: Booking; expansion: ExpandResult } {
  const expansion = expand(booking.lines, state, {
    previous: booking.lines,
    orChoices: booking.orChoices,
    suppressed: booking.suppressedAuto,
    dismissedRecommendations: booking.dismissedRecommendations,
    dismissedChecks: booking.dismissedChecks,
    isAvailable: availabilityOracle(state, booking),
  });
  return { booking: { ...booking, lines: expansion.lines }, expansion };
}

function mapLine(b: Booking, lineId: Id, fn: (l: BookingLine) => BookingLine): Booking {
  return { ...b, lines: b.lines.map((l) => (l.id === lineId ? fn(l) : l)) };
}

/** Add a manual line (merges into an existing manual line of the same target and source). */
export function addLine(state: AppState, b: Booking, target: Target, qty: number): Booking {
  const existing = b.lines.find(
    (l) =>
      l.origin !== 'auto' &&
      l.status === 'ok' &&
      !l.fromBookingId &&
      ((isItemTarget(l.target) && isItemTarget(target) && l.target.itemId === target.itemId) ||
        (isCaseTarget(l.target) &&
          isCaseTarget(target) &&
          l.target.caseTypeId === target.caseTypeId)),
  );
  const next = existing
    ? mapLine(b, existing.id, (l) => ({ ...l, qty: l.qty + qty }))
    : { ...b, lines: [...b.lines, newLine(target, qty, nextLineId(b))] };
  return recalcBooking(state, next).booking;
}

/** Change a quantity: manual lines change `qty`; auto lines get an override. */
export function setLineQty(state: AppState, b: Booking, lineId: Id, qty: number): Booking {
  const q = Math.max(0, Math.floor(qty));
  const next = mapLine(b, lineId, (l) =>
    l.origin === 'auto' ? { ...l, overriddenQty: q } : { ...l, qty: q },
  );
  return recalcBooking(state, next).booking;
}

/** Drop a manual override of an auto line (back to the computed quantity). */
export function clearOverride(state: AppState, b: Booking, lineId: Id): Booking {
  const next = mapLine(b, lineId, (l) => {
    const c = { ...l };
    delete c.overriddenQty;
    return c;
  });
  return recalcBooking(state, next).booking;
}

/** Remove a manual line, or (Chief, with a reason) suppress an auto line. */
export function removeLine(state: AppState, b: Booking, lineId: Id, reason?: string): Booking {
  const line = b.lines.find((l) => l.id === lineId);
  if (!line) return b;
  if (line.origin === 'auto') {
    if (!reason?.trim()) return b;
    const next = { ...b, suppressedAuto: { ...b.suppressedAuto, [lineId]: reason.trim() } };
    return recalcBooking(state, next).booking;
  }
  return recalcBooking(state, { ...b, lines: b.lines.filter((l) => l.id !== lineId) }).booking;
}

/** Restore a suppressed auto line. */
export function restoreAutoLine(state: AppState, b: Booking, autoLineId: Id): Booking {
  const s = { ...b.suppressedAuto };
  delete s[autoLineId];
  return recalcBooking(state, { ...b, suppressedAuto: s }).booking;
}

/** A person picks an option of an OR group. */
export function chooseOr(
  state: AppState,
  b: Booking,
  groupKey: string,
  optionKey: string,
): Booking {
  return recalcBooking(state, { ...b, orChoices: { ...b.orChoices, [groupKey]: optionKey } })
    .booking;
}

export function dismissRecommendation(b: Booking, key: string): Booking {
  return b.dismissedRecommendations.includes(key)
    ? b
    : { ...b, dismissedRecommendations: [...b.dismissedRecommendations, key] };
}

export function dismissCheck(b: Booking, key: string): Booking {
  return b.dismissedChecks.includes(key)
    ? b
    : { ...b, dismissedChecks: [...b.dismissedChecks, key] };
}

/** "I have seen the conflict" on a red line. */
export function ackConflict(b: Booking, lineId: Id, value = true): Booking {
  return mapLine(b, lineId, (l) => ({ ...l, conflictAck: value }));
}

/** Written reason to confirm a short line anyway. */
export function setOverrideReason(b: Booking, lineId: Id, reason: string): Booking {
  return mapLine(b, lineId, (l) => {
    const c = { ...l };
    if (reason.trim()) c.overrideReason = reason;
    else delete c.overrideReason;
    return c;
  });
}

/** Mark a line missing / substituted (with reason) or back to ok. */
export function markLine(
  state: AppState,
  b: Booking,
  lineId: Id,
  status: LineStatus,
  note?: string,
): Booking {
  const next = mapLine(b, lineId, (l) => {
    const c = { ...l, status };
    if (note?.trim()) c.note = note.trim();
    return c;
  });
  return recalcBooking(state, next).booking;
}

export function setLineSource(
  state: AppState,
  b: Booking,
  lineId: Id,
  source: { warehouseId: Id } | { fromBookingId: Id },
): Booking {
  const next = mapLine(b, lineId, (l) => {
    const c = { ...l };
    if ('warehouseId' in source) {
      c.sourceWarehouseId = source.warehouseId;
      delete c.fromBookingId;
      c.expectedReturnWarehouseId = source.warehouseId;
    } else {
      c.fromBookingId = source.fromBookingId;
      delete c.sourceWarehouseId;
    }
    return c;
  });
  return recalcBooking(state, next).booking;
}

export function setExpectedReturn(b: Booking, lineId: Id, warehouseId: Id): Booking {
  return mapLine(b, lineId, (l) => ({ ...l, expectedReturnWarehouseId: warehouseId }));
}

/** Split `qty` pieces of a line into a second line served from another warehouse. */
export function splitLine(
  state: AppState,
  b: Booking,
  lineId: Id,
  qty: number,
  warehouseId: Id,
): Booking {
  const line = b.lines.find((l) => l.id === lineId);
  if (!line || qty <= 0 || line.origin === 'auto') return b;
  const moved = Math.min(qty, line.qty);
  const copy: BookingLine = {
    ...newLine(line.target, moved, nextLineId(b)),
    sourceWarehouseId: warehouseId,
    expectedReturnWarehouseId: warehouseId,
  };
  const lines = b.lines
    .map((l) => (l.id === lineId ? { ...l, qty: l.qty - moved } : l))
    .filter((l) => l.qty > 0 || l.origin === 'auto');
  return recalcBooking(state, { ...b, lines: [...lines, copy] }).booking;
}

/**
 * Cover `qty` of a short line with an external rental. A case-type line is covered by its
 * primary item (first standard content) × pieces per case; the own line is lowered.
 */
export function coverWithExternal(
  state: AppState,
  b: Booking,
  lineId: Id,
  qty: number,
  spec: Omit<ExternalSpec, 'name' | 'itemId'> & { name?: string },
): Booking {
  const line = b.lines.find((l) => l.id === lineId);
  if (!line || qty <= 0 || 'external' in line.target) return b;
  let ext: ExternalSpec;
  let extQty: number;
  if (isCaseTarget(line.target)) {
    const t = getCaseType(state, line.target.caseTypeId);
    const primary = t?.contents[0];
    const item = primary ? getItem(state, primary.itemId) : undefined;
    ext = { ...spec, name: spec.name ?? item?.name ?? t?.name ?? '' };
    if (item) ext.itemId = item.id;
    extQty = qty * (primary?.qty ?? 1);
  } else {
    const item = getItem(state, line.target.itemId);
    ext = { ...spec, name: spec.name ?? item?.name ?? '', itemId: line.target.itemId };
    extQty = qty;
  }
  const extLine = newLine({ external: ext }, extQty, nextLineId(b));
  let next: Booking;
  if (line.origin === 'auto') {
    const current = line.overriddenQty ?? line.qty;
    next = mapLine(b, lineId, (l) => ({ ...l, overriddenQty: Math.max(0, current - qty) }));
  } else {
    next = mapLine(b, lineId, (l) => ({ ...l, qty: Math.max(0, l.qty - qty) }));
  }
  next = {
    ...next,
    lines: [...next.lines.filter((l) => l.qty > 0 || l.origin === 'auto'), extLine],
  };
  return recalcBooking(state, next).booking;
}
