/**
 * Availability per day, per warehouse and in total, for items and case types.
 *
 * free(i,w,d) = total − outOfService − hardHeld; soft holds (submitted pre-bookings) only turn a
 * badge amber. Case types: caseFree = completeCases − caseHeld − broken (docs/plan.md).
 */
import { addDays, eachDay, maxDate, type IsoDate } from '../dates';
import {
  caseContentQty,
  caseMissing,
  caseTypesContaining,
  contentsMatchStandard,
  getCaseType,
  getItem,
  isCaseComplete,
  isOpenService,
  looseStock,
  resolveSourceWarehouse,
  standardQty,
  stockQty,
} from '../catalog';
import type { AppState, Booking, BookingLine, Case, Id, Loan, Target } from '../types';
import {
  effectiveQty,
  isActiveLine,
  isCaseTarget,
  isExternal,
  isItemTarget,
  targetKey,
} from '../util';

export type HoldKind = 'hard' | 'soft';

/** One booking (or open issue) holding a quantity of a resource in a warehouse over a range. */
export interface Hold {
  bookingId: Id;
  lineId?: Id;
  issueId?: Id;
  kind: HoldKind;
  /** `item:<id>` or `case:<id>` */
  res: string;
  warehouseId: Id;
  qty: number;
  from: IsoDate;
  to: IsoDate;
  /** Item holds from loose-item lines (not case contents). */
  loose: boolean;
}

const FAR_FUTURE = '9999-12-31';

/** Statuses in which an order holds stock (hard). */
export const HARD_STATUSES = new Set([
  'confirmed',
  'packing',
  'shipped',
  'returning',
  'returned',
  'returned_with_issues',
]);

const POST_SHIP = new Set(['returning', 'returned', 'returned_with_issues']);

export function firstBookedFrom(b: Pick<Booking, 'periods'>): IsoDate {
  return b.periods.reduce((m, p) => (p.bookedFrom < m ? p.bookedFrom : m), FAR_FUTURE);
}

export function lastBookedUntil(b: Pick<Booking, 'periods'>): IsoDate {
  return b.periods.reduce((m, p) => (p.bookedUntil > m ? p.bookedUntil : m), '0000-01-01');
}

export function firstEventDay(b: Pick<Booking, 'periods'>): IsoDate {
  return b.periods.reduce((m, p) => (p.eventFrom < m ? p.eventFrom : m), FAR_FUTURE);
}

/** Date ranges during which a line is held. Transfer lines start when the source booking ends. */
export function lineWindows(
  state: Pick<AppState, 'bookings'>,
  booking: Booking,
  line: BookingLine,
): { from: IsoDate; to: IsoDate }[] {
  if (line.fromBookingId) {
    const src = state.bookings.find((b) => b.id === line.fromBookingId);
    const end = lastBookedUntil(booking);
    const start =
      line.transferredOn ?? (src ? addDays(lastBookedUntil(src), 1) : firstBookedFrom(booking));
    return [{ from: start, to: maxDate(start, end) }];
  }
  return booking.periods.map((p) => ({ from: p.bookedFrom, to: p.bookedUntil }));
}

/** Quantity shipped for a line over all shipments of the booking. */
export function shippedQty(state: Pick<AppState, 'shipments'>, bookingId: Id, lineId: Id): number {
  let n = 0;
  for (const s of state.shipments) {
    if (s.bookingId !== bookingId) continue;
    for (const l of s.lines) if (l.lineId === lineId) n += l.qty;
  }
  return n;
}

/** True when any return session recorded something for this line. */
export function isLineTouched(state: Pick<AppState, 'returnSessions'>, bookingId: Id, lineId: Id) {
  return state.returnSessions.some(
    (s) => s.bookingId === bookingId && s.lines.some((l) => l.lineId === lineId),
  );
}

/** Cases of a case line already reported in vratka (returned or declared missing). */
export function reportedCaseCount(
  state: Pick<AppState, 'returnSessions'>,
  bookingId: Id,
  lineId: Id,
): number {
  const ids = new Set<Id>();
  for (const s of state.returnSessions) {
    if (s.bookingId !== bookingId) continue;
    for (const l of s.lines) if (l.lineId === lineId && l.caseId) ids.add(l.caseId);
  }
  return ids.size;
}

type HoldState = Pick<
  AppState,
  | 'bookings'
  | 'items'
  | 'caseTypes'
  | 'cases'
  | 'stock'
  | 'warehouses'
  | 'shipments'
  | 'returnSessions'
  | 'issues'
>;

function pushTargetHolds(
  out: Hold[],
  state: HoldState,
  base: Omit<Hold, 'res' | 'qty' | 'loose'>,
  target: Target,
  qty: number,
): void {
  if (qty <= 0) return;
  if (isItemTarget(target)) {
    out.push({ ...base, res: targetKey(target), qty, loose: true });
    return;
  }
  out.push({ ...base, res: targetKey(target), qty, loose: false });
  const t = getCaseType(state, target.caseTypeId);
  for (const c of t?.contents ?? []) {
    out.push({ ...base, res: `item:${c.itemId}`, qty: c.qty * qty, loose: false });
  }
}

/** Cases of a line that left and were not reported in vratka yet. */
function casesOutOnLine(state: HoldState, bookingId: Id, lineId: Id): Case[] {
  const reported = new Set<Id>();
  for (const s of state.returnSessions) {
    if (s.bookingId !== bookingId) continue;
    for (const l of s.lines) if (l.lineId === lineId && l.caseId) reported.add(l.caseId);
  }
  const ids = new Set<Id>();
  for (const sh of state.shipments) {
    if (sh.bookingId !== bookingId) continue;
    for (const l of sh.lines)
      if (l.lineId === lineId) for (const c of l.caseIds ?? []) if (!reported.has(c)) ids.add(c);
  }
  return state.cases.filter((c) => ids.has(c.id));
}

/**
 * A case that left short is not one of the complete cases any more and the pieces it lacks did
 * not leave, so the line holds that much less.
 */
function reduceByShortCases(out: Hold[], state: HoldState, bookingId: Id, line: BookingLine) {
  if (!isCaseTarget(line.target)) return;
  const t = getCaseType(state, line.target.caseTypeId);
  if (!t) return;
  for (const c of casesOutOnLine(state, bookingId, line.id)) {
    if (contentsMatchStandard(state, c)) continue;
    for (const h of out) {
      if (h.lineId !== line.id) continue;
      if (h.res === `case:${t.id}`) h.qty -= 1;
      else
        for (const std of t.contents)
          if (h.res === `item:${std.itemId}`)
            h.qty -= Math.max(0, std.qty - caseContentQty(c, std.itemId));
    }
  }
}

/**
 * Holds a booking creates in its current state.
 * With `asDemand`, the booking is treated as if it were confirmed now (used for the booking
 * being edited, so its own lines are evaluated with their full quantities).
 */
export function bookingHolds(state: HoldState, booking: Booking, asDemand = false): Hold[] {
  const out: Hold[] = [];
  let kind: HoldKind;
  if (asDemand) kind = 'hard';
  else if (booking.type === 'prebooking' && booking.status === 'submitted') kind = 'soft';
  else if (booking.type === 'order' && HARD_STATUSES.has(booking.status)) kind = 'hard';
  else return out;

  const postShip = !asDemand && POST_SHIP.has(booking.status);
  const shippedStatus = !asDemand && (booking.status === 'shipped' || booking.status === 'packing');

  for (const line of booking.lines) {
    if (!isActiveLine(line) || isExternal(line.target)) continue;
    const w = resolveSourceWarehouse(state, booking, line);
    const consumable =
      isItemTarget(line.target) && getItem(state, line.target.itemId)?.returnable === false;
    let qty = effectiveQty(line);
    const shipped = asDemand ? 0 : shippedQty(state, booking.id, line.id);
    if (postShip) {
      if (consumable) qty = 0;
      else if (isCaseTarget(line.target))
        qty = shipped - reportedCaseCount(state, booking.id, line.id);
      else qty = isLineTouched(state, booking.id, line.id) ? 0 : shipped;
    } else if (shippedStatus) {
      qty = consumable ? Math.max(0, qty - shipped) : Math.max(qty, shipped);
    }
    for (const win of lineWindows(state, booking, line)) {
      pushTargetHolds(
        out,
        state,
        {
          bookingId: booking.id,
          lineId: line.id,
          kind,
          warehouseId: w,
          from: win.from,
          to: win.to,
        },
        line.target,
        qty,
      );
    }
    reduceByShortCases(out, state, booking.id, line);
  }

  // Missing pieces stay "out" on the order until the issue is resolved.
  if (!asDemand && kind === 'hard') {
    const from = firstBookedFrom(booking);
    for (const iss of state.issues) {
      if (iss.bookingId !== booking.id || iss.type !== 'missing' || iss.archivedOn) continue;
      const base = { bookingId: booking.id, issueId: iss.id, kind, from, to: FAR_FUTURE };
      if (iss.itemId && iss.warehouseId) {
        out.push({
          ...base,
          res: `item:${iss.itemId}`,
          warehouseId: iss.warehouseId,
          qty: iss.qty,
          loose: true,
        });
      } else if (iss.caseId) {
        const c = state.cases.find((x) => x.id === iss.caseId);
        if (c) {
          // what the case really held when it got lost
          const b = { ...base, warehouseId: c.warehouseId, loose: false };
          if (contentsMatchStandard(state, c))
            out.push({ ...b, res: `case:${c.caseTypeId}`, qty: iss.qty });
          for (const l of c.contents) out.push({ ...b, res: `item:${l.itemId}`, qty: l.qty });
        }
      }
    }
  }
  return out;
}

export interface HoldFilter {
  /** Booking that never counts against itself. */
  excludeBookingId?: Id;
  /** Only count orders confirmed strictly before this sequence number (priority). */
  priorityBefore?: number;
}

/** Holds indexed by `<res>@<warehouse>`. */
export interface HoldIndex {
  byRes: Map<string, Hold[]>;
}

export function buildHoldIndex(state: HoldState, filter: HoldFilter = {}): HoldIndex {
  const byRes = new Map<string, Hold[]>();
  for (const b of state.bookings) {
    if (b.id === filter.excludeBookingId) continue;
    if (
      filter.priorityBefore !== undefined &&
      b.type === 'order' &&
      (b.confirmSeq ?? Infinity) >= filter.priorityBefore
    ) {
      continue;
    }
    for (const h of bookingHolds(state, b)) {
      const k = `${h.res}@${h.warehouseId}`;
      const list = byRes.get(k);
      if (list) list.push(h);
      else byRes.set(k, [h]);
    }
  }
  return { byRes };
}

function holdsOn(idx: HoldIndex, res: string, w: Id, d: IsoDate): Hold[] {
  return (idx.byRes.get(`${res}@${w}`) ?? []).filter((h) => d >= h.from && d <= h.to);
}

export interface ItemDay {
  total: number;
  outOfService: number;
  /** Out on quick loans. */
  loaned: number;
  hardHeld: number;
  softHeld: number;
  /** Hard held by loose-item lines only. */
  looseHardHeld: number;
  free: number;
}

type AvState = HoldState & Pick<AppState, 'serviceCases' | 'loans'>;

export function isOpenLoan(l: Loan): boolean {
  return !l.returnedOn && !l.cancelledOn;
}

/** Open loans of an item that count as out on a day. */
export function loansOn(state: Pick<AppState, 'loans'>, itemId: Id, w: Id, d: IsoDate): Loan[] {
  return state.loans.filter(
    (l) =>
      l.itemId === itemId &&
      l.warehouseId === w &&
      isOpenLoan(l) &&
      d >= l.from &&
      d <= l.heldUntil,
  );
}

const loanedOn = (state: Pick<AppState, 'loans'>, itemId: Id, w: Id, d: IsoDate): number =>
  loansOn(state, itemId, w, d).reduce((n, l) => n + l.qty, 0);

/** Pieces of an item out of service in a warehouse on a day (open cases block until closed). */
export function outOfService(state: Pick<AppState, 'serviceCases'>, itemId: Id, w: Id, d: IsoDate) {
  let n = 0;
  for (const sc of state.serviceCases) {
    if (sc.itemId === itemId && sc.warehouseId === w && isOpenService(sc) && sc.openedOn <= d)
      n += sc.qty;
  }
  return n;
}

export function itemDay(state: AvState, idx: HoldIndex, itemId: Id, w: Id, d: IsoDate): ItemDay {
  const total = stockQty(state, itemId, w);
  const oos = outOfService(state, itemId, w, d);
  const loaned = loanedOn(state, itemId, w, d);
  let hard = 0;
  let soft = 0;
  let looseHard = 0;
  for (const h of holdsOn(idx, `item:${itemId}`, w, d)) {
    if (h.kind === 'hard') {
      hard += h.qty;
      if (h.loose) looseHard += h.qty;
    } else soft += h.qty;
  }
  return {
    total,
    outOfService: oos,
    loaned,
    hardHeld: hard,
    softHeld: soft,
    looseHardHeld: looseHard,
    free: total - oos - loaned - hard,
  };
}

/** Item availability summed over all warehouses. */
export function itemDayTotal(state: AvState, idx: HoldIndex, itemId: Id, d: IsoDate): ItemDay {
  const acc: ItemDay = {
    total: 0,
    outOfService: 0,
    loaned: 0,
    hardHeld: 0,
    softHeld: 0,
    looseHardHeld: 0,
    free: 0,
  };
  for (const w of state.warehouses) {
    const x = itemDay(state, idx, itemId, w.id, d);
    acc.total += x.total;
    acc.outOfService += x.outOfService;
    acc.loaned += x.loaned;
    acc.hardHeld += x.hardHeld;
    acc.softHeld += x.softHeld;
    acc.looseHardHeld += x.looseHardHeld;
    acc.free += x.free;
  }
  return acc;
}

export interface CaseDay {
  completeCases: number;
  caseHeld: number;
  softHeld: number;
  broken: number;
  free: number;
}

/** True when all a case lacks is out on loans that are back before day `d`. */
function completeAgainOn(state: AvState, c: Case, d: IsoDate): boolean {
  if (c.archived) return false;
  const back = state.loans.filter((l) => l.fromCaseId === c.id && isOpenLoan(l) && l.heldUntil < d);
  if (back.length === 0) return false;
  const qtyBack = (itemId: Id) =>
    back.filter((l) => l.itemId === itemId).reduce((n, l) => n + l.qty, 0);
  return caseMissing(state, c).every((m) => qtyBack(m.itemId) >= m.qty);
}

/**
 * Complete, non-archived cases of a type in a warehouse. With a day, a case that is only short
 * because of a loan counts again once that loan is over.
 */
export function completeCases(state: AvState, caseTypeId: Id, w: Id, d?: IsoDate): number {
  return state.cases.filter(
    (c) =>
      c.caseTypeId === caseTypeId &&
      c.warehouseId === w &&
      (isCaseComplete(state, c) || (d !== undefined && completeAgainOn(state, c, d))),
  ).length;
}

/**
 * Case-type availability. `extraLooseDemand` adds loose-item demand (item id → qty) on top of
 * other bookings' loose holds, e.g. the booking being edited.
 */
export function caseDay(
  state: AvState,
  idx: HoldIndex,
  caseTypeId: Id,
  w: Id,
  d: IsoDate,
  extraLooseDemand?: Map<Id, number>,
): CaseDay {
  const t = getCaseType(state, caseTypeId);
  const complete = completeCases(state, caseTypeId, w, d);
  let held = 0;
  let soft = 0;
  for (const h of holdsOn(idx, `case:${caseTypeId}`, w, d)) {
    if (h.kind === 'hard') held += h.qty;
    else soft += h.qty;
  }
  let broken = 0;
  for (const c of t?.contents ?? []) {
    if (c.qty <= 0) continue;
    let looseDemand = (extraLooseDemand?.get(c.itemId) ?? 0) + loanedOn(state, c.itemId, w, d);
    for (const h of holdsOn(idx, `item:${c.itemId}`, w, d))
      if (h.kind === 'hard' && h.loose) looseDemand += h.qty;
    const overflow = Math.max(0, looseDemand - looseStock(state, c.itemId, w));
    broken = Math.max(broken, Math.ceil(overflow / c.qty));
  }
  return {
    completeCases: complete,
    caseHeld: held,
    softHeld: soft,
    broken,
    free: complete - held - broken,
  };
}

// ---------------------------------------------------------------------------
// Line badges

export type Badge = 'green' | 'amber' | 'red';

export interface LineAvailability {
  lineId: Id;
  badge: Badge | 'none';
  /** Pieces (or cases) missing on the worst day. */
  short: number;
  worstDay?: IsoDate;
  shortDays: IsoDate[];
  warehouseId?: Id;
  /** Lowest free count over the period, before this booking's demand. */
  minFree: number;
  /** Loose demand that forces open cases booked whole by other orders. */
  breaksCase?: { caseTypeId: Id; bookingIds: Id[] };
  /** Bookings holding the resource on short days. */
  collidingBookingIds: Id[];
  /** Loans that are out on short days. */
  collidingLoanIds: Id[];
  /** Pre-bookings that make the line amber. */
  softBookingIds: Id[];
}

const rank: Record<Badge, number> = { green: 0, amber: 1, red: 2 };

function sumOn(holds: Hold[], d: IsoDate, pred: (h: Hold) => boolean): number {
  let n = 0;
  for (const h of holds) if (d >= h.from && d <= h.to && pred(h)) n += h.qty;
  return n;
}

/** Filter used when evaluating `booking`: never itself; confirmed orders see only earlier orders. */
export function filterFor(booking: Booking): HoldFilter {
  const f: HoldFilter = { excludeBookingId: booking.id };
  if (
    booking.type === 'order' &&
    booking.confirmSeq !== undefined &&
    HARD_STATUSES.has(booking.status)
  ) {
    f.priorityBefore = booking.confirmSeq;
  }
  return f;
}

/**
 * Availability badge for every line of a booking: worst day over all its booked periods.
 * The booking never counts against itself.
 */
export function evaluateBooking(
  state: AvState,
  booking: Booking,
  idx?: HoldIndex,
): Map<Id, LineAvailability> {
  const index = idx ?? buildHoldIndex(state, filterFor(booking));
  const post =
    booking.type === 'order' && (booking.status === 'shipped' || POST_SHIP.has(booking.status));
  const own = bookingHolds(state, booking, !post);
  const ownByRes = new Map<string, Hold[]>();
  for (const h of own) {
    const k = `${h.res}@${h.warehouseId}`;
    const list = ownByRes.get(k);
    if (list) list.push(h);
    else ownByRes.set(k, [h]);
  }
  const out = new Map<Id, LineAvailability>();

  for (const line of booking.lines) {
    const none: LineAvailability = {
      lineId: line.id,
      badge: 'none',
      short: 0,
      shortDays: [],
      minFree: 0,
      collidingBookingIds: [],
      collidingLoanIds: [],
      softBookingIds: [],
    };
    if (!isActiveLine(line) || isExternal(line.target)) {
      out.set(line.id, none);
      continue;
    }
    const w = resolveSourceWarehouse(state, booking, line);
    const res = targetKey(line.target);
    const ownHolds = ownByRes.get(`${res}@${w}`) ?? [];
    const days = new Set<IsoDate>();
    for (const win of lineWindows(state, booking, line))
      for (const d of eachDay(win.from, win.to)) days.add(d);

    let badge: Badge = 'green';
    let worst = -Infinity;
    let worstDay: IsoDate | undefined;
    let minFree = Infinity;
    const shortDays: IsoDate[] = [];
    const colliding = new Set<Id>();
    const softIds = new Set<Id>();
    const loanIds = new Set<Id>();
    let breaksCase: LineAvailability['breaksCase'];

    for (const d of [...days].sort()) {
      const req = sumOn(ownHolds, d, () => true);
      let free: number;
      let soft: number;
      if (isCaseTarget(line.target)) {
        const ownLoose = new Map<Id, number>();
        for (const c of getCaseType(state, line.target.caseTypeId)?.contents ?? []) {
          const hs = ownByRes.get(`item:${c.itemId}@${w}`) ?? [];
          ownLoose.set(
            c.itemId,
            sumOn(hs, d, (h) => h.loose),
          );
        }
        const cd = caseDay(state, index, line.target.caseTypeId, w, d, ownLoose);
        free = cd.free;
        soft = cd.softHeld;
      } else {
        const id = itemDay(state, index, (line.target as { itemId: Id }).itemId, w, d);
        free = id.free;
        soft = id.softHeld;
      }
      minFree = Math.min(minFree, free);
      let dayBadge: Badge = 'green';
      if (free - req < 0) dayBadge = 'red';
      else if (free - soft - req < 0) dayBadge = 'amber';

      if (dayBadge === 'red') {
        shortDays.push(d);
        for (const h of holdsOn(index, res, w, d)) colliding.add(h.bookingId);
        const items = isCaseTarget(line.target)
          ? (getCaseType(state, line.target.caseTypeId)?.contents ?? []).map((c) => c.itemId)
          : [(line.target as { itemId: Id }).itemId];
        for (const itemId of items) for (const l of loansOn(state, itemId, w, d)) loanIds.add(l.id);
        if (isCaseTarget(line.target)) {
          for (const c of getCaseType(state, line.target.caseTypeId)?.contents ?? []) {
            for (const h of holdsOn(index, `item:${c.itemId}`, w, d))
              if (h.loose && h.kind === 'hard') colliding.add(h.bookingId);
          }
        }
      }
      if (dayBadge === 'amber') {
        for (const h of holdsOn(index, res, w, d)) if (h.kind === 'soft') softIds.add(h.bookingId);
      }

      // Loose demand forcing open cases that another order booked whole → amber "rozbije case".
      if (dayBadge === 'green' && isItemTarget(line.target)) {
        const itemId = line.target.itemId;
        for (const t of caseTypesContaining(state, itemId)) {
          const held = holdsOn(index, `case:${t.id}`, w, d).filter((h) => h.kind === 'hard');
          if (held.length === 0) continue;
          const ownLoose = new Map<Id, number>();
          for (const c of t.contents) {
            const hs = ownByRes.get(`item:${c.itemId}@${w}`) ?? [];
            ownLoose.set(
              c.itemId,
              sumOn(hs, d, (h) => h.loose),
            );
          }
          const withOwn = caseDay(state, index, t.id, w, d, ownLoose);
          const without = caseDay(state, index, t.id, w, d);
          if (withOwn.free < 0 && withOwn.free < without.free && standardQty(t, itemId) > 0) {
            dayBadge = 'amber';
            const ids = new Set(breaksCase?.bookingIds ?? []);
            for (const h of held) ids.add(h.bookingId);
            breaksCase = { caseTypeId: t.id, bookingIds: [...ids] };
          }
        }
      }

      if (rank[dayBadge] > rank[badge]) badge = dayBadge;
      const shortNow = req - free;
      if (shortNow > worst) {
        worst = shortNow;
        worstDay = d;
      }
    }

    const la: LineAvailability = {
      lineId: line.id,
      badge,
      short: badge === 'red' ? Math.max(0, worst) : 0,
      shortDays,
      warehouseId: w,
      minFree: minFree === Infinity ? 0 : minFree,
      collidingBookingIds: [...colliding],
      collidingLoanIds: [...loanIds],
      softBookingIds: [...softIds],
    };
    if (worstDay) la.worstDay = worstDay;
    if (breaksCase) la.breaksCase = breaksCase;
    out.set(line.id, la);
  }
  return out;
}

/** Lowest free count of a resource in a warehouse over a booking's periods (others' holds only). */
export function minFreeInWarehouse(
  state: AvState,
  booking: Booking,
  target: Target,
  w: Id,
  idx?: HoldIndex,
): number {
  const index = idx ?? buildHoldIndex(state, filterFor(booking));
  let min = Infinity;
  for (const p of booking.periods) {
    for (const d of eachDay(p.bookedFrom, p.bookedUntil)) {
      const free = isItemTarget(target)
        ? itemDay(state, index, target.itemId, w, d).free
        : caseDay(state, index, target.caseTypeId, w, d).free;
      min = Math.min(min, free);
    }
  }
  return min === Infinity ? 0 : min;
}

/**
 * Oracle for OR preselection: is `qty` of `target` free (incl. soft holds) for the whole
 * booked period in the booking's default warehouse?
 */
export function availabilityOracle(
  state: AvState,
  booking: Booking,
): (t: Target, qty: number) => boolean {
  const index = buildHoldIndex(state, filterFor(booking));
  return (t, qty) => {
    for (const p of booking.periods) {
      for (const d of eachDay(p.bookedFrom, p.bookedUntil)) {
        if (isItemTarget(t)) {
          const x = itemDay(state, index, t.itemId, booking.defaultWarehouseId, d);
          if (x.free - x.softHeld - qty < 0) return false;
        } else {
          const x = caseDay(state, index, t.caseTypeId, booking.defaultWarehouseId, d);
          if (x.free - x.softHeld - qty < 0) return false;
        }
      }
    }
    return true;
  };
}

// ---------------------------------------------------------------------------
// Calendar

export interface CalendarDay {
  date: IsoDate;
  total: number;
  free: number;
  hardHeld: number;
  softHeld: number;
  outOfService: number;
  loaned: number;
  /** Loans out that day. */
  loanIds: Id[];
  /** Bookings holding the resource that day. */
  holders: { bookingId: Id; qty: number; kind: HoldKind }[];
  /** Open service cases blocking that day. */
  serviceCaseIds: Id[];
}

/** Item calendar: free / total per day, for one warehouse or all (`'all'`). */
export function itemCalendar(
  state: AvState,
  itemId: Id,
  from: IsoDate,
  to: IsoDate,
  warehouse: Id | 'all',
  idx?: HoldIndex,
): CalendarDay[] {
  const index = idx ?? buildHoldIndex(state);
  const ws = warehouse === 'all' ? state.warehouses.map((w) => w.id) : [warehouse];
  return eachDay(from, to).map((d) => {
    const acc: CalendarDay = {
      date: d,
      total: 0,
      free: 0,
      hardHeld: 0,
      softHeld: 0,
      outOfService: 0,
      loaned: 0,
      loanIds: [],
      holders: [],
      serviceCaseIds: [],
    };
    const holders = new Map<string, { bookingId: Id; qty: number; kind: HoldKind }>();
    for (const w of ws) {
      const x = itemDay(state, index, itemId, w, d);
      acc.total += x.total;
      acc.free += x.free;
      acc.hardHeld += x.hardHeld;
      acc.softHeld += x.softHeld;
      acc.outOfService += x.outOfService;
      acc.loaned += x.loaned;
      for (const l of loansOn(state, itemId, w, d)) acc.loanIds.push(l.id);
      for (const h of holdsOn(index, `item:${itemId}`, w, d)) {
        const k = `${h.bookingId}|${h.kind}`;
        const e = holders.get(k);
        if (e) e.qty += h.qty;
        else holders.set(k, { bookingId: h.bookingId, qty: h.qty, kind: h.kind });
      }
      for (const sc of state.serviceCases) {
        if (sc.itemId === itemId && sc.warehouseId === w && isOpenService(sc) && sc.openedOn <= d)
          acc.serviceCaseIds.push(sc.id);
      }
    }
    acc.holders = [...holders.values()];
    return acc;
  });
}

export interface CaseCalendarDay {
  date: IsoDate;
  completeCases: number;
  totalCases: number;
  free: number;
  caseHeld: number;
  softHeld: number;
  broken: number;
  /** Loans of pieces this case type holds. */
  loanIds: Id[];
  holders: { bookingId: Id; qty: number; kind: HoldKind }[];
}

/** Case type calendar: complete cases free per day. */
export function caseCalendar(
  state: AvState,
  caseTypeId: Id,
  from: IsoDate,
  to: IsoDate,
  warehouse: Id | 'all',
  idx?: HoldIndex,
): CaseCalendarDay[] {
  const index = idx ?? buildHoldIndex(state);
  const ws = warehouse === 'all' ? state.warehouses.map((w) => w.id) : [warehouse];
  return eachDay(from, to).map((d) => {
    const acc: CaseCalendarDay = {
      date: d,
      completeCases: 0,
      totalCases: 0,
      free: 0,
      caseHeld: 0,
      softHeld: 0,
      broken: 0,
      loanIds: [],
      holders: [],
    };
    for (const w of ws) {
      const x = caseDay(state, index, caseTypeId, w, d);
      for (const c of getCaseType(state, caseTypeId)?.contents ?? [])
        for (const l of loansOn(state, c.itemId, w, d)) acc.loanIds.push(l.id);
      acc.completeCases += x.completeCases;
      acc.totalCases += state.cases.filter(
        (c) => c.caseTypeId === caseTypeId && c.warehouseId === w && !c.archived,
      ).length;
      acc.free += x.free;
      acc.caseHeld += x.caseHeld;
      acc.softHeld += x.softHeld;
      acc.broken += x.broken;
      for (const h of holdsOn(index, `case:${caseTypeId}`, w, d))
        acc.holders.push({ bookingId: h.bookingId, qty: h.qty, kind: h.kind });
    }
    return acc;
  });
}
