/**
 * Quick loans: someone takes an item without a reservation. A loan lowers what is free like a
 * service case does, so badges, calendars and conflict records react to it. It never frees
 * itself: an undated or overdue loan keeps blocking the next days until somebody returns it.
 */
import { addDays, type IsoDate } from '../dates';
import {
  buildHoldIndex,
  evaluateBooking,
  filterFor,
  firstBookedFrom,
  isOpenLoan,
  itemDay,
  lastBookedUntil,
} from '../availability';
import {
  caseContentQty,
  contentsMatchStandard,
  getCaseType,
  getItem,
  isOpenService,
  looseStock,
  resolveSourceWarehouse,
  standardQty,
  stockQty,
} from '../catalog';
import { recomputeConflictRecords } from '../conflicts';
import { can } from '../lifecycle/permissions';
import { returnSheet } from '../returns';
import { casesOut, packedInHouse } from '../packing';
import type { AppState, Booking, Id, Loan, Target, User } from '../types';
import {
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

export interface LoanInput {
  itemId: Id;
  warehouseId: Id;
  qty: number;
  /** Defaults to the person recording it. */
  borrowerId?: Id;
  /** Somebody without an account. */
  borrowerName?: string;
  /** Defaults to today. */
  from?: IsoDate;
  /** Expected return; without it the loan counts for the next days (settings.loanHorizonDays). */
  until?: IsoDate;
  /** The pieces are taken out of this case. */
  fromCaseId?: Id;
  note?: string;
  /** Required when a confirmed order would be short. */
  reason?: string;
}

export interface LoanHit {
  bookingId: Id;
  lineId: Id;
  target: Target;
  /** 'order' needs a reason, 'prebooking' only informs. */
  level: 'order' | 'prebooking';
  short: number;
  days: IsoDate[];
}

export interface LoanPreview {
  from: IsoDate;
  to: IsoDate;
  hits: LoanHit[];
  /** Lowest free count in the warehouse over the loan, with the loan already taken. */
  minFree: number;
}

export function openLoans(state: Pick<AppState, 'loans'>): Loan[] {
  return state.loans.filter(isOpenLoan);
}

export function isLoanPlanned(l: Loan, today: IsoDate): boolean {
  return isOpenLoan(l) && l.from > today;
}

export function isLoanOverdue(l: Loan, today: IsoDate): boolean {
  return isOpenLoan(l) && !!l.until && l.until < today;
}

/** Open loans of an item that are out today. */
export function loansOut(
  state: Pick<AppState, 'loans'>,
  itemId: Id,
  warehouseId: Id,
  today: IsoDate,
): Loan[] {
  return openLoans(state).filter(
    (l) => l.itemId === itemId && l.warehouseId === warehouseId && l.from <= today,
  );
}

/** Pieces that are really lying loose in the house today. */
export function looseHere(state: AppState, itemId: Id, warehouseId: Id, today: IsoDate): number {
  let n = looseStock(state, itemId, warehouseId);
  for (const sc of state.serviceCases)
    if (sc.itemId === itemId && sc.warehouseId === warehouseId && isOpenService(sc) && !sc.caseId)
      n -= sc.qty;
  for (const i of state.issues)
    if (
      i.type === 'missing' &&
      !i.archivedOn &&
      i.itemId === itemId &&
      i.warehouseId === warehouseId
    )
      n -= i.qty;
  for (const l of loansOut(state, itemId, warehouseId, today)) n -= l.qty;
  // packed pieces are ready for an order, nobody else can take them
  for (const b of state.bookings) {
    if (!['packing', 'packed', 'shipped'].includes(b.status)) continue;
    for (const l of b.lines)
      if (
        isItemTarget(l.target) &&
        l.target.itemId === itemId &&
        resolveSourceWarehouse(state, b, l) === warehouseId
      )
        n -= packedInHouse(state, b.id, l.id).reduce((x, e) => x + e.qty, 0);
  }
  for (const b of state.bookings) {
    if (b.type !== 'order' || !state.shipments.some((s) => s.bookingId === b.id)) continue;
    for (const line of returnSheet(state, b.id))
      if (
        line.kind === 'item' &&
        line.itemId === itemId &&
        line.sourceWarehouseId === warehouseId &&
        line.outcome === 'pending'
      )
        n -= line.outstanding;
  }
  return Math.max(0, n);
}

/** Cases in the house that hold the item, with how many pieces can be taken out. */
export function casesHere(
  state: AppState,
  itemId: Id,
  warehouseId: Id,
): { caseId: Id; qty: number }[] {
  const out = casesOut(state);
  const gone = new Set(
    state.issues
      .filter((i) => i.type === 'missing' && !i.archivedOn && i.caseId && !i.itemId)
      .map((i) => i.caseId),
  );
  return state.cases
    .filter(
      (c) => c.warehouseId === warehouseId && !c.archived && !out.has(c.id) && !gone.has(c.id),
    )
    .map((c) => ({
      caseId: c.id,
      qty:
        caseContentQty(c, itemId) -
        state.serviceCases
          .filter((sc) => sc.caseId === c.id && sc.itemId === itemId && isOpenService(sc))
          .reduce((n, sc) => n + sc.qty, 0),
    }))
    .filter((c) => c.qty > 0);
}

/** Last day a new loan holds its pieces. */
function heldUntilOf(state: AppState, from: IsoDate, until: IsoDate | undefined): IsoDate {
  return until ?? addDays(from, state.settings.loanHorizonDays);
}

function takeInDraft(d: AppState, loan: Loan, today: IsoDate): void {
  d.loans.push(loan);
  const c = loan.fromCaseId ? d.cases.find((x) => x.id === loan.fromCaseId) : undefined;
  const entry = c?.contents.find((x) => x.itemId === loan.itemId);
  if (!c || !entry) return;
  entry.qty -= loan.qty;
  c.contents = c.contents.filter((x) => x.qty > 0);
  if (!contentsMatchStandard(d, c)) c.incompleteSince = c.incompleteSince ?? today;
}

function uses(state: AppState, b: Booking, itemId: Id): boolean {
  return b.lines.some((l) => {
    if (!isActiveLine(l) || isExternal(l.target)) return false;
    if (isItemTarget(l.target)) return l.target.itemId === itemId;
    const t = isCaseTarget(l.target) ? getCaseType(state, l.target.caseTypeId) : undefined;
    return !!t && standardQty(t, itemId) > 0;
  });
}

/** Lines that get short (or shorter) on days `from`–`to` when `before` turns into `after`. */
function newShortages(
  before: AppState,
  after: AppState,
  itemId: Id,
  from: IsoDate,
  to: IsoDate,
): LoanHit[] {
  const out: LoanHit[] = [];
  for (const b of after.bookings) {
    const level =
      b.type === 'order' && ['confirmed', 'packing', 'packed'].includes(b.status)
        ? 'order'
        : b.type === 'prebooking' && b.status === 'submitted'
          ? 'prebooking'
          : undefined;
    if (!level || lastBookedUntil(b) < from || firstBookedFrom(b) > to) continue;
    if (!uses(after, b, itemId)) continue;
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

/** What taking the item would do: who gets short and how many pieces stay free. */
export function loanPreview(state: AppState, today: IsoDate, input: LoanInput): LoanPreview {
  const from = input.from ?? today;
  const to = heldUntilOf(state, from, input.until);
  const loan: Loan = {
    id: 'preview',
    itemId: input.itemId,
    warehouseId: input.warehouseId,
    qty: input.qty,
    recordedBy: '',
    createdOn: today,
    from,
    heldUntil: to,
    ...(input.fromCaseId ? { fromCaseId: input.fromCaseId } : {}),
  };
  const after = produce(state, (d) => takeInDraft(d, loan, today)).state;
  const idx = buildHoldIndex(after);
  let minFree = Infinity;
  for (let d = from; d <= to; d = addDays(d, 1))
    minFree = Math.min(minFree, itemDay(after, idx, input.itemId, input.warehouseId, d).free);
  return {
    from,
    to,
    hits: newShortages(state, after, input.itemId, from, to),
    minFree: minFree === Infinity ? 0 : minFree,
  };
}

/** Record a loan. Colliding with an order needs a reason and leaves a tracked conflict. */
export function createLoan(
  state: AppState,
  user: User,
  today: IsoDate,
  input: LoanInput,
): Result<{ state: AppState; loanId: Id }> {
  if (!can(user, 'borrow')) return err('forbidden', 'Not allowed to borrow');
  const name = input.borrowerName?.trim();
  const forOther = !!name || (!!input.borrowerId && input.borrowerId !== user.id);
  if (forOther && !can(user, 'borrow_for_other'))
    return err('forbidden', 'Only the warehouse and the Chief record loans for others');
  if (!name && input.borrowerId && !state.users.some((u) => u.id === input.borrowerId))
    return err('not_found', 'Unknown borrower');
  const item = getItem(state, input.itemId);
  if (!item || item.archived) return err('not_found', `Item ${input.itemId} not found`);
  if (!item.returnable) return err('validation', 'Consumables are not lent', { field: 'itemId' });
  if (!Number.isInteger(input.qty) || input.qty <= 0)
    return err('validation', 'Quantity must be positive', { field: 'qty' });
  const from = input.from ?? today;
  if (from < today) return err('validation', 'A loan cannot start in the past', { field: 'from' });
  if (input.until && input.until < from)
    return err('validation', 'Return is before the start', { field: 'until' });

  if (input.fromCaseId) {
    if (from > today)
      return err('validation', 'Pieces leave a case only on the day', { field: 'fromCaseId' });
    const c = casesHere(state, input.itemId, input.warehouseId).find(
      (x) => x.caseId === input.fromCaseId,
    );
    if (!c || input.qty > c.qty)
      return err('validation', 'Not enough pieces in that case', { field: 'fromCaseId' });
  } else if (from <= today) {
    const here = looseHere(state, input.itemId, input.warehouseId, today);
    if (input.qty > here)
      return err('validation', 'Not enough loose pieces in the house', { field: 'qty', here });
  } else if (input.qty > stockQty(state, input.itemId, input.warehouseId)) {
    return err('validation', 'More pieces than in stock', { field: 'qty' });
  }

  const preview = loanPreview(state, today, input);
  const reason = input.reason?.trim();
  if (preview.hits.some((h) => h.level === 'order') && !reason)
    return err('validation', 'A reason is required, an order needs the item', {
      field: 'reason',
      bookingIds: preview.hits.filter((h) => h.level === 'order').map((h) => h.bookingId),
    });

  const { state: next, result } = produce(state, (d) => {
    const loan: Loan = {
      id: nextId(d, 'loan'),
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      qty: input.qty,
      recordedBy: user.id,
      createdOn: today,
      from,
      heldUntil: preview.to,
    };
    if (name) loan.borrowerName = name;
    else loan.borrowerId = input.borrowerId ?? user.id;
    if (input.until) loan.until = input.until;
    if (input.fromCaseId) loan.fromCaseId = input.fromCaseId;
    const note = input.note?.trim();
    if (note) loan.note = note;
    if (reason) loan.reason = reason;
    takeInDraft(d, loan, today);
    return loan.id;
  });
  return ok({ state: recomputeConflictRecords(next, today), loanId: result });
}

function findOpen(state: AppState, user: User, id: Id): Result<Loan> {
  if (!can(user, 'borrow')) return err('forbidden', 'Not allowed');
  const l = state.loans.find((x) => x.id === id);
  if (!l) return err('not_found', `Loan ${id} not found`);
  if (!isOpenLoan(l)) return err('invalid_state', 'The loan is already closed');
  return ok(l);
}

/** Anyone may record that the item is back. Pieces out of a case go back into it. */
export function returnLoan(state: AppState, user: User, today: IsoDate, id: Id): Result<AppState> {
  const f = findOpen(state, user, id);
  if (!f.ok) return f;
  if (f.value.from > today) return err('invalid_state', 'The loan has not started');
  const away = casesOut(state);
  const next = produce(state, (d) => {
    const l = d.loans.find((x) => x.id === id) as Loan;
    l.returnedOn = today;
    l.returnedBy = user.id;
    const c = l.fromCaseId ? d.cases.find((x) => x.id === l.fromCaseId) : undefined;
    const t = c ? getCaseType(d, c.caseTypeId) : undefined;
    if (!c || !t || c.archived || away.has(c.id) || c.warehouseId !== l.warehouseId) return;
    const have = caseContentQty(c, l.itemId);
    const put = Math.min(l.qty, Math.max(0, standardQty(t, l.itemId) - have));
    if (put <= 0) return;
    const entry = c.contents.find((x) => x.itemId === l.itemId);
    if (entry) entry.qty += put;
    else c.contents.push({ itemId: l.itemId, qty: put });
    if (contentsMatchStandard(d, c)) delete c.incompleteSince;
  }).state;
  return ok(recomputeConflictRecords(next, today));
}

/** What moving the return date would do. */
export function extendPreview(
  state: AppState,
  today: IsoDate,
  id: Id,
  until: IsoDate,
): LoanPreview {
  const l = state.loans.find((x) => x.id === id);
  if (!l) return { from: today, to: until, hits: [], minFree: 0 };
  const after = produce(state, (d) => {
    const x = d.loans.find((y) => y.id === id) as Loan;
    x.until = until;
    x.heldUntil = until;
  }).state;
  const from = l.from > today ? l.from : today;
  return { from, to: until, hits: newShortages(state, after, l.itemId, from, until), minFree: 0 };
}

/** Move the return date; the same warning and reason rule as for a new loan. */
export function extendLoan(
  state: AppState,
  user: User,
  today: IsoDate,
  id: Id,
  until: IsoDate,
  reason = '',
): Result<AppState> {
  const f = findOpen(state, user, id);
  if (!f.ok) return f;
  if (until < today || until < f.value.from)
    return err('validation', 'The new return date has passed', { field: 'until' });
  const hits = extendPreview(state, today, id, until).hits;
  if (hits.some((h) => h.level === 'order') && !reason.trim())
    return err('validation', 'A reason is required, an order needs the item', { field: 'reason' });
  const next = produce(state, (d) => {
    const l = d.loans.find((x) => x.id === id) as Loan;
    l.until = until;
    l.heldUntil = until;
    if (reason.trim()) l.reason = reason.trim();
  }).state;
  return ok(recomputeConflictRecords(next, today));
}

/** Give up a loan that has not started yet. */
export function cancelLoan(state: AppState, user: User, today: IsoDate, id: Id): Result<AppState> {
  const f = findOpen(state, user, id);
  if (!f.ok) return f;
  if (f.value.from <= today) return err('invalid_state', 'The loan has already started');
  const next = produce(state, (d) => {
    const l = d.loans.find((x) => x.id === id) as Loan;
    l.cancelledOn = today;
    l.returnedBy = user.id;
  }).state;
  return ok(recomputeConflictRecords(next, today));
}
