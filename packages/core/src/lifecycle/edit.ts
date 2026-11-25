/**
 * Pure edits of a booking being built in an editor. They return a new booking; they do not
 * touch `AppState`. Saving goes through `saveBooking` / `submit` / `confirm`.
 */
import { addDays, type IsoDate } from '../dates';
import { availabilityOracle } from '../availability';
import { getCaseType, getItem } from '../catalog';
import { expand, itemTotals, ruleQty, type ExpandResult } from '../expansion';
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
import { isCaseTarget, isExternal, isItemTarget, targetKey } from '../util';
import { bringsItem, descendants, parentMap, placeOf, type LinePlace } from './organise';

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
  // ids still named as a parent stay reserved, a new line must not inherit its children
  const ids = new Set(booking.lines.flatMap((l) => [l.id, l.nestedUnder ?? '']));
  while (ids.has(`${booking.id}-l${n}`)) n += 1;
  return `${booking.id}-l${n}`;
}

/**
 * Lines added from a check follow the count of the item that asked for them, until a person
 * types another one. Without any piece of that item (e.g. while its count is being retyped) the
 * last count stays.
 */
function followChecks(state: AppState, lines: BookingLine[]): BookingLine[] | undefined {
  if (!lines.some((l) => l.followsCheck && !l.followsCheck.byHand)) return undefined;
  const totals = itemTotals(
    lines.filter((l) => !l.late),
    state,
  );
  let changed = false;
  const next = lines.map((l) => {
    const f = l.followsCheck;
    if (!f || f.byHand || l.origin === 'auto' || isExternal(l.target)) return l;
    const total = totals.get(f.fromItemId) ?? 0;
    const key = targetKey(l.target);
    const c = state.connections.find(
      (x) => x.kind === 'check' && x.fromItemId === f.fromItemId && targetKey(x.target) === key,
    );
    if (total <= 0 || !c) return l;
    const qty = Math.max(1, ruleQty(c, total));
    if (qty === l.qty) return l;
    changed = true;
    return { ...l, qty };
  });
  return changed ? next : undefined;
}

/**
 * Re-run the connections engine on a booking (with availability-based OR preselection) and let
 * check lines follow their item.
 */
export function recalcBooking(
  state: AppState,
  booking: Booking,
): { booking: Booking; expansion: ExpandResult } {
  let r = expandBooking(state, booking);
  // a following line may itself bring required items, so expand again
  for (let i = 0; i < 3; i += 1) {
    const lines = followChecks(state, r.booking.lines);
    if (!lines) break;
    r = expandBooking(state, { ...r.booking, lines });
  }
  return r;
}

function expandBooking(
  state: AppState,
  booking: Booking,
): { booking: Booking; expansion: ExpandResult } {
  // what was taken at the last minute brings nothing with it and counts for nothing on the list
  const listed = booking.lines.filter((l) => !l.late);
  const late = booking.lines.filter((l) => l.late);
  const expansion = expand(listed, state, {
    previous: listed,
    orChoices: booking.orChoices,
    suppressed: booking.suppressedAuto,
    dismissedRecommendations: booking.dismissedRecommendations,
    dismissedChecks: booking.dismissedChecks,
    isAvailable: availabilityOracle(state, booking),
  });
  return { booking: { ...booking, lines: [...expansion.lines, ...late] }, expansion };
}

function mapLine(b: Booking, lineId: Id, fn: (l: BookingLine) => BookingLine): Booking {
  return { ...b, lines: b.lines.map((l) => (l.id === lineId ? fn(l) : l)) };
}

export interface AddOptions extends LinePlace {
  followsCheck?: BookingLine['followsCheck'];
}

/** Add a manual line (merges into an existing manual line of the same target, source and place). */
export function addLine(
  state: AppState,
  b: Booking,
  target: Target,
  qty: number,
  options: AddOptions = {},
): Booking {
  const { followsCheck, nestedUnder, groupId } = options;
  const existing = b.lines.find(
    (l) =>
      l.origin !== 'auto' &&
      !l.late &&
      l.status === 'ok' &&
      !l.fromBookingId &&
      l.nestedUnder === nestedUnder &&
      (nestedUnder !== undefined || l.groupId === groupId) &&
      ((isItemTarget(l.target) && isItemTarget(target) && l.target.itemId === target.itemId) ||
        (isCaseTarget(l.target) &&
          isCaseTarget(target) &&
          l.target.caseTypeId === target.caseTypeId)),
  );
  const line: BookingLine = {
    ...newLine(target, qty, nextLineId(b)),
    ...(nestedUnder ? { nestedUnder } : groupId ? { groupId } : {}),
    ...(followsCheck ? { followsCheck } : {}),
  };
  const next = existing
    ? mapLine(b, existing.id, (l) => byHand({ ...l, qty: l.qty + qty }))
    : { ...b, lines: [...b.lines, line] };
  return recalcBooking(state, next).booking;
}

/** The count was changed by a person, so it no longer follows the item that asked for it. */
function byHand(l: BookingLine): BookingLine {
  return l.followsCheck ? { ...l, followsCheck: { ...l.followsCheck, byHand: true } } : l;
}

/** Line that asks for something on behalf of an item: the item itself or a case holding it. */
export function lineOfItem(state: AppState, b: Booking, itemId: Id): BookingLine | undefined {
  return b.lines.find((l) => l.status === 'ok' && bringsItem(state, l, itemId));
}

/** Add one of "Máš aspoň jeden z těchto?" under the item that asked for it. */
export function addCheckCandidate(
  state: AppState,
  b: Booking,
  fromItemId: Id,
  target: Target,
  qty: number,
): Booking {
  const parent = lineOfItem(state, b, fromItemId);
  return addLine(state, b, target, qty, {
    ...(parent ? { nestedUnder: parent.id } : {}),
    followsCheck: { fromItemId },
  });
}

/** Let a line from a check follow its item's count again. */
export function followAgain(state: AppState, b: Booking, lineId: Id): Booking {
  const next = mapLine(b, lineId, (l) =>
    l.followsCheck ? { ...l, followsCheck: { fromItemId: l.followsCheck.fromItemId } } : l,
  );
  return recalcBooking(state, next).booking;
}

/** Change a quantity: manual lines change `qty`; auto lines get an override. */
export function setLineQty(state: AppState, b: Booking, lineId: Id, qty: number): Booking {
  const q = Math.max(0, Math.floor(qty));
  const next = mapLine(b, lineId, (l) =>
    l.origin === 'auto' ? { ...l, overriddenQty: q } : byHand({ ...l, qty: q }),
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

/** Lines a person put under `lineId`, at any depth (required ones come and go by themselves). */
export function nestedByHand(b: Booking, lineId: Id): BookingLine[] {
  return descendants(b, lineId).filter((l) => l.origin !== 'auto');
}

/**
 * Remove a manual line, or (Chief, with a reason) suppress an auto line. Lines a person nested
 * under it are kept one level up, or removed with it.
 */
export function removeLine(
  state: AppState,
  b: Booking,
  lineId: Id,
  reason?: string,
  children: 'keep' | 'remove' = 'keep',
): Booking {
  const line = b.lines.find((l) => l.id === lineId);
  if (!line) return b;
  const auto = line.origin === 'auto';
  if (auto && !reason?.trim()) return b;
  const below = new Set(nestedByHand(b, lineId).map((l) => l.id));
  const up = placeOf(b, lineId);
  let next: Booking = auto
    ? { ...b, suppressedAuto: { ...b.suppressedAuto, [lineId]: reason?.trim() ?? '' } }
    : { ...b, lines: b.lines.filter((l) => l.id !== lineId) };
  next = recalcBooking(state, next).booking;
  // Removing one line can take required lines (and what hangs on them) away, so go on until
  // every line that was below has a parent again or is gone.
  for (;;) {
    const ids = new Set(next.lines.map((l) => l.id));
    const lost = next.lines.filter(
      (l) =>
        below.has(l.id) && l.nestedUnder && !ids.has(l.nestedUnder) && !parentMap(next).has(l.id),
    );
    if (lost.length === 0) return next;
    const lostIds = new Set(lost.map((l) => l.id));
    if (children === 'remove') {
      next = recalcBooking(state, {
        ...next,
        lines: next.lines.filter((l) => !lostIds.has(l.id)),
      }).booking;
      continue;
    }
    return {
      ...next,
      lines: next.lines.map((l) => {
        if (!lostIds.has(l.id)) return l;
        const c = { ...l };
        delete c.nestedUnder;
        delete c.groupId;
        delete c.followsCheck;
        return { ...c, ...up };
      }),
    };
  }
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
    ...placeOf(b, lineId),
    sourceWarehouseId: warehouseId,
    expectedReturnWarehouseId: warehouseId,
  };
  const lines = b.lines.map((l) => (l.id === lineId ? byHand({ ...l, qty: l.qty - moved }) : l));
  return recalcBooking(state, { ...b, lines: dropEmpty([...lines, copy], lineId, copy.id) })
    .booking;
}

/** Drop lines without pieces; children of `goneId` move to its replacement. */
function dropEmpty(lines: BookingLine[], goneId: Id, replacementId: Id): BookingLine[] {
  const kept = lines.filter((l) => l.qty > 0 || l.origin === 'auto');
  if (kept.some((l) => l.id === goneId)) return kept;
  return kept.map((l) => (l.nestedUnder === goneId ? { ...l, nestedUnder: replacementId } : l));
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
  const extLine: BookingLine = {
    ...newLine({ external: ext }, extQty, nextLineId(b)),
    ...placeOf(b, lineId),
  };
  let next: Booking;
  if (line.origin === 'auto') {
    const current = line.overriddenQty ?? line.qty;
    next = mapLine(b, lineId, (l) => ({ ...l, overriddenQty: Math.max(0, current - qty) }));
  } else {
    next = mapLine(b, lineId, (l) => byHand({ ...l, qty: Math.max(0, l.qty - qty) }));
  }
  next = { ...next, lines: dropEmpty([...next.lines, extLine], lineId, extLine.id) };
  return recalcBooking(state, next).booking;
}
