/**
 * Conflict detection on a booking, conflict records (overrides and later detections) and their
 * resolution. A record is never deleted; it resolves when availability covers the line again or
 * when the Chief closes it with a written resolution.
 */
import type { IsoDate } from '../dates';
import {
  buildHoldIndex,
  evaluateBooking,
  filterFor,
  firstBookedFrom,
  lastBookedUntil,
  type LineAvailability,
} from '../availability';
import { chiefIds, notify } from '../notifications';
import type { AppState, Booking, ConflictRecord, Id, Target, User } from '../types';
import { err, isActiveLine, isExternal, nextId, ok, produce, type Result } from '../util';

export interface CollidingBooking {
  id: Id;
  eventName: string;
  pmId: Id;
  type: Booking['type'];
  status: Booking['status'];
  from: IsoDate;
  to: IsoDate;
}

export interface LineConflict {
  lineId: Id;
  target: Target;
  warehouseId: Id;
  short: number;
  worstDay: IsoDate;
  days: IsoDate[];
  colliding: CollidingBooking[];
}

function describe(state: Pick<AppState, 'bookings'>, ids: Id[]): CollidingBooking[] {
  const out: CollidingBooking[] = [];
  for (const id of ids) {
    const b = state.bookings.find((x) => x.id === id);
    if (!b) continue;
    out.push({
      id: b.id,
      eventName: b.eventName,
      pmId: b.pmId,
      type: b.type,
      status: b.status,
      from: firstBookedFrom(b),
      to: lastBookedUntil(b),
    });
  }
  return out;
}

/** Short (red) lines of a booking with worst day, short count and colliding bookings. */
export function detectConflicts(
  state: AppState,
  booking: Booking,
  availability?: Map<Id, LineAvailability>,
): LineConflict[] {
  const av = availability ?? evaluateBooking(state, booking);
  const out: LineConflict[] = [];
  for (const line of booking.lines) {
    const a = av.get(line.id);
    if (!a || a.badge !== 'red' || isExternal(line.target)) continue;
    out.push({
      lineId: line.id,
      target: line.target,
      warehouseId: a.warehouseId ?? booking.defaultWarehouseId,
      short: a.short,
      worstDay: a.worstDay ?? a.shortDays[0] ?? firstBookedFrom(booking),
      days: a.shortDays,
      colliding: describe(state, a.collidingBookingIds),
    });
  }
  return out;
}

/** Create a conflict record in a draft state and notify the Chief and PMs of colliding orders. */
export function addConflictRecord(
  draft: AppState,
  booking: Booking,
  c: LineConflict,
  source: ConflictRecord['source'],
  overrideReason: string,
  today: IsoDate,
): ConflictRecord {
  const rec: ConflictRecord = {
    id: nextId(draft, 'cfl'),
    bookingId: booking.id,
    lineId: c.lineId,
    target: c.target,
    warehouseId: c.warehouseId,
    shortQty: c.short,
    days: c.days,
    collidingBookingIds: c.colliding.map((x) => x.id),
    status: 'new',
    source,
    overrideReason,
    createdOn: today,
  };
  draft.conflicts.push(rec);
  const pms = c.colliding.filter((x) => x.type === 'order').map((x) => x.pmId);
  notify(
    draft,
    [...chiefIds(draft), booking.pmId, ...pms],
    {
      type: source === 'override' ? 'conflict_overridden' : 'conflict_detected',
      text: `Conflict on ${booking.eventName}: short ${c.short}`,
      params: { event: booking.eventName, short: c.short, conflictId: rec.id },
      bookingId: booking.id,
    },
    today,
  );
  return rec;
}

const DETECT_STATUSES = new Set(['confirmed', 'packing']);
const HOLDING = new Set(['confirmed', 'packing', 'shipped', 'returning', 'returned_with_issues']);

/**
 * Run after every state change: unresolved records resolve automatically when their line is no
 * longer short; confirmed orders that became short (a service case, a changed order) get a new
 * `detected` record.
 */
export function recomputeConflictRecords(state: AppState, today: IsoDate): AppState {
  const evaluations = new Map<Id, Map<Id, LineAvailability>>();
  const evalOf = (b: Booking) => {
    let e = evaluations.get(b.id);
    if (!e) {
      e = evaluateBooking(state, b, buildHoldIndex(state, filterFor(b)));
      evaluations.set(b.id, e);
    }
    return e;
  };

  const toResolve: Id[] = [];
  for (const r of state.conflicts) {
    if (r.status === 'resolved') continue;
    const b = state.bookings.find((x) => x.id === r.bookingId);
    const line = b?.lines.find((l) => l.id === r.lineId);
    if (
      !b ||
      !line ||
      !HOLDING.has(b.status) ||
      b.type !== 'order' ||
      !isActiveLine(line) ||
      isExternal(line.target)
    ) {
      toResolve.push(r.id);
      continue;
    }
    const a = evalOf(b).get(line.id);
    if (!a || a.badge !== 'red') toResolve.push(r.id);
  }

  const toCreate: { booking: Booking; c: LineConflict }[] = [];
  for (const b of state.bookings) {
    if (b.type !== 'order' || !DETECT_STATUSES.has(b.status) || lastBookedUntil(b) < today)
      continue;
    const av = evalOf(b);
    for (const c of detectConflicts(state, b, av)) {
      const open = state.conflicts.some(
        (r) =>
          r.bookingId === b.id &&
          r.lineId === c.lineId &&
          r.status !== 'resolved' &&
          !toResolve.includes(r.id),
      );
      if (!open) toCreate.push({ booking: b, c });
    }
  }

  if (toResolve.length === 0 && toCreate.length === 0) return state;
  return produce(state, (d) => {
    for (const r of d.conflicts) {
      if (!toResolve.includes(r.id)) continue;
      r.status = 'resolved';
      r.resolution = r.resolution ?? 'auto';
      r.resolvedOn = today;
    }
    for (const { booking, c } of toCreate) addConflictRecord(d, booking, c, 'detected', '', today);
  }).state;
}

/** A live shortage of one line, for overviews over many bookings. */
export interface OverviewConflict extends LineConflict {
  bookingId: Id;
  /** 'order': a confirmed order is short; 'prebooking': a request would be short. */
  level: 'order' | 'prebooking';
}

const OVERVIEW_PRE = new Set(['draft', 'submitted']);

/**
 * All live conflicts of bookings that have not ended, computed the same way as on the booking
 * page. Lines whose conflict a person closed with a written resolution are left out.
 */
export function conflictOverview(state: AppState, today: IsoDate): OverviewConflict[] {
  const out: OverviewConflict[] = [];
  for (const b of state.bookings) {
    if (lastBookedUntil(b) < today) continue;
    const level =
      b.type === 'order' && DETECT_STATUSES.has(b.status)
        ? 'order'
        : b.type === 'prebooking' && OVERVIEW_PRE.has(b.status)
          ? 'prebooking'
          : undefined;
    if (!level) continue;
    for (const c of detectConflicts(state, b)) {
      const records = state.conflicts.filter((r) => r.bookingId === b.id && r.lineId === c.lineId);
      const closed =
        records.some((r) => r.status === 'resolved' && r.resolvedBy) &&
        records.every((r) => r.status === 'resolved');
      if (!closed) out.push({ ...c, bookingId: b.id, level });
    }
  }
  return out;
}

export interface ConflictDay {
  /** 'short': this order misses gear; 'partner': its gear is what another order misses; 'request': a pre-booking would be short. */
  role: 'short' | 'partner' | 'request';
  conflicts: OverviewConflict[];
}

const ROLE_RANK = { request: 0, partner: 1, short: 2 };

/** Booking id → day → what collides there (the strongest role wins). */
export function conflictDays(
  state: Pick<AppState, 'bookings'>,
  overview: OverviewConflict[],
): Map<Id, Map<IsoDate, ConflictDay>> {
  const out = new Map<Id, Map<IsoDate, ConflictDay>>();
  const mark = (id: Id, day: IsoDate, role: ConflictDay['role'], c: OverviewConflict) => {
    const days = out.get(id) ?? new Map<IsoDate, ConflictDay>();
    out.set(id, days);
    const e = days.get(day);
    if (!e) days.set(day, { role, conflicts: [c] });
    else {
      e.conflicts.push(c);
      if (ROLE_RANK[role] > ROLE_RANK[e.role]) e.role = role;
    }
  };
  for (const c of overview) {
    for (const day of c.days) {
      mark(c.bookingId, day, c.level === 'order' ? 'short' : 'request', c);
      if (c.level !== 'order') continue;
      for (const x of c.colliding) {
        if (x.type !== 'order') continue;
        const b = state.bookings.find((y) => y.id === x.id);
        if (b?.periods.some((p) => day >= p.bookedFrom && day <= p.bookedUntil))
          mark(x.id, day, 'partner', c);
      }
    }
  }
  return out;
}

/** Chief moves a record to "V řešení". */
export function setConflictInProgress(state: AppState, user: User, id: Id): Result<AppState> {
  if (user.role !== 'chief' && user.role !== 'admin')
    return err('forbidden', 'Only the Chief manages conflicts');
  const r = state.conflicts.find((x) => x.id === id);
  if (!r) return err('not_found', `Conflict ${id} not found`);
  if (r.status === 'resolved') return err('invalid_state', 'Conflict already resolved');
  return ok(
    produce(state, (d) => {
      const x = d.conflicts.find((c) => c.id === id);
      if (x) x.status = 'in_progress';
    }).state,
  );
}

/** Chief closes a record with a written resolution. */
export function resolveConflict(
  state: AppState,
  user: User,
  today: IsoDate,
  id: Id,
  resolution: string,
): Result<AppState> {
  if (user.role !== 'chief' && user.role !== 'admin')
    return err('forbidden', 'Only the Chief resolves conflicts');
  if (!resolution.trim()) return err('validation', 'A written resolution is required');
  const r = state.conflicts.find((x) => x.id === id);
  if (!r) return err('not_found', `Conflict ${id} not found`);
  if (r.status === 'resolved') return err('invalid_state', 'Conflict already resolved');
  return ok(
    produce(state, (d) => {
      const x = d.conflicts.find((c) => c.id === id);
      if (!x) return;
      x.status = 'resolved';
      x.resolution = resolution.trim();
      x.resolvedBy = user.id;
      x.resolvedOn = today;
    }).state,
  );
}
