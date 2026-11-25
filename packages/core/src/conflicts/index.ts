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
  type TierShortage,
} from '../availability';
import { chiefIds, notify } from '../notifications';
import {
  ARCHIVED_STATUSES,
  PRE_STATUSES,
  type AppState,
  type Booking,
  type BookingStatus,
  type ConflictRecord,
  type Id,
  type Target,
  type User,
} from '../types';
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
  /** Quick loans that are out on the short days. */
  loanIds: Id[];
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
      loanIds: a.collidingLoanIds,
    });
  }
  return out;
}

/**
 * How real a conflict is, by the state of the other booking: 'possible' with an unconfirmed
 * reservation, 'likely' with anything on its way to approval, 'real' with an approved order.
 */
export const CONFLICT_TIERS = ['real', 'likely', 'possible'] as const;
export type ConflictTier = (typeof CONFLICT_TIERS)[number];

/** Tier of a conflict with a booking in `status`; undefined when it cannot collide. */
export function tierOf(status: BookingStatus): ConflictTier | undefined {
  if (ARCHIVED_STATUSES.includes(status)) return undefined;
  if (status === 'tentative') return 'possible';
  return PRE_STATUSES.includes(status) ? 'likely' : 'real';
}

export interface ConflictTiers extends Record<ConflictTier, LineConflict[]> {
  /** Bookings on the same days where one side has no gear yet, worst first. */
  sameDay: { tier: ConflictTier; booking: CollidingBooking }[];
}

/** Everything a booking collides with, by tier. An approved order has real conflicts only. */
export function conflictTiers(
  state: AppState,
  booking: Booking,
  availability?: Map<Id, LineAvailability>,
): ConflictTiers {
  const av = availability ?? evaluateBooking(state, booking);
  const tier = (pick: (a: LineAvailability) => TierShortage | undefined): LineConflict[] =>
    booking.lines.flatMap((line) => {
      const a = av.get(line.id);
      const t = a && pick(a);
      if (!t || isExternal(line.target)) return [];
      return [
        {
          lineId: line.id,
          target: line.target,
          warehouseId: a.warehouseId ?? booking.defaultWarehouseId,
          short: t.short,
          worstDay: t.worstDay,
          days: t.days,
          colliding: describe(state, t.bookingIds),
          loanIds: [],
        },
      ];
    });
  return {
    real: detectConflicts(state, booking, av),
    likely: tier((a) => a.likely),
    possible: tier((a) => a.possible),
    sameDay: sameDayUnknown(state, booking),
  };
}

const hasGear = (b: Pick<Booking, 'lines'>) => b.lines.some(isActiveLine);

/** Overlapping bookings that cannot be compared yet, because one side lists no gear. */
export function sameDayUnknown(
  state: Pick<AppState, 'bookings'>,
  booking: Booking,
): ConflictTiers['sameDay'] {
  if (!PRE_STATUSES.includes(booking.status)) return [];
  const gear = hasGear(booking);
  return state.bookings
    .flatMap((b) => {
      const tier = tierOf(b.status);
      if (b.id === booking.id || !tier || (gear && hasGear(b))) return [];
      // what is back holds nothing any more
      if (b.status === 'returned' || b.status === 'returned_with_issues') return [];
      const overlaps = b.periods.some((p) =>
        booking.periods.some((q) => p.bookedFrom <= q.bookedUntil && q.bookedFrom <= p.bookedUntil),
      );
      return overlaps ? describe(state, [b.id]).map((x) => ({ tier, booking: x })) : [];
    })
    .sort((a, b) => CONFLICT_TIERS.indexOf(a.tier) - CONFLICT_TIERS.indexOf(b.tier));
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

const DETECT_STATUSES = new Set(['confirmed', 'packing', 'packed']);
const HOLDING = new Set([
  'confirmed',
  'packing',
  'packed',
  'shipped',
  'returning',
  'returned_with_issues',
]);

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
  tier: ConflictTier;
}

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
        : b.type === 'prebooking' && PRE_STATUSES.includes(b.status)
          ? 'prebooking'
          : undefined;
    if (!level) continue;
    const tiers = conflictTiers(state, b);
    for (const tier of ['likely', 'possible'] as const)
      for (const c of tiers[tier]) out.push({ ...c, bookingId: b.id, level, tier });
    for (const c of tiers.real) {
      const records = state.conflicts.filter((r) => r.bookingId === b.id && r.lineId === c.lineId);
      const closed =
        records.some((r) => r.status === 'resolved' && r.resolvedBy) &&
        records.every((r) => r.status === 'resolved');
      if (!closed) out.push({ ...c, bookingId: b.id, level, tier: 'real' });
    }
  }
  return out;
}

export interface ConflictDay {
  /**
   * 'short': this order misses gear; 'partner': its gear is what another order misses;
   * 'request': a pre-booking is short because of orders; 'likely' / 'possible': it would be short
   * if other pre-bookings happen.
   */
  role: 'short' | 'partner' | 'request' | 'likely' | 'possible';
  conflicts: OverviewConflict[];
}

const ROLE_RANK = { possible: 0, likely: 1, request: 2, partner: 3, short: 4 };

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
      const role = c.tier !== 'real' ? c.tier : c.level === 'order' ? 'short' : 'request';
      mark(c.bookingId, day, role, c);
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

/** A line of another booking that gets short because gear is taken now. */
export interface ShortageHit {
  bookingId: Id;
  lineId: Id;
  target: Target;
  /** 'order' needs a reason, 'prebooking' only informs. */
  level: 'order' | 'prebooking';
  short: number;
  days: IsoDate[];
}

/** Lines that get short (or shorter) on days `from`–`to` when `before` turns into `after`. */
export function newShortages(
  before: AppState,
  after: AppState,
  from: IsoDate,
  to: IsoDate,
  relevant: (b: Booking) => boolean = () => true,
  pre: readonly BookingStatus[] = ['submitted'],
): ShortageHit[] {
  const out: ShortageHit[] = [];
  for (const b of after.bookings) {
    const level =
      b.type === 'order' && DETECT_STATUSES.has(b.status)
        ? 'order'
        : b.type === 'prebooking' && pre.includes(b.status)
          ? 'prebooking'
          : undefined;
    if (!level || lastBookedUntil(b) < from || firstBookedFrom(b) > to || !relevant(b)) continue;
    const was = evaluateBooking(before, b, buildHoldIndex(before, filterFor(b)));
    const now = evaluateBooking(after, b, buildHoldIndex(after, filterFor(b)));
    for (const line of b.lines) {
      const a = now.get(line.id);
      const p = was.get(line.id);
      if (!a || a.badge !== 'red' || isExternal(line.target)) continue;
      const days = a.shortDays.filter((x) => x >= from && x <= to);
      const worse = a.short > (p?.short ?? 0) || days.some((x) => !p?.shortDays.includes(x));
      if (days.length > 0 && worse)
        out.push({
          bookingId: b.id,
          lineId: line.id,
          target: line.target,
          level,
          short: a.short,
          days,
        });
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
