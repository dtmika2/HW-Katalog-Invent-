/**
 * Service (repairs). An item's out-of-service count is the sum of its open service cases.
 * Pieces are unavailable from the moment a case opens and are never released automatically:
 * only status `fixed` returns them; `written_off` lowers stock permanently.
 */
import type { IsoDate } from '../dates';
import { buildHoldIndex, evaluateBooking, filterFor, lastBookedUntil } from '../availability';
import { contentsMatchStandard, isOpenService, stockQty } from '../catalog';
import { recomputeConflictRecords } from '../conflicts';
import { can } from '../lifecycle/permissions';
import { chiefIds, notify } from '../notifications';
import type { AppState, Id, ServiceCase, ServiceStatus, User } from '../types';
import {
  err,
  isActiveLine,
  isItemTarget,
  isCaseTarget,
  nextId,
  ok,
  produce,
  type Result,
} from '../util';

export interface OpenServiceInput {
  itemId: Id;
  warehouseId: Id;
  qty: number;
  reason: string;
  internal?: boolean;
  repairShop?: string;
  responsibleUserId?: Id;
  expectedBack?: IsoDate;
  caseId?: Id;
  openedFromBookingId?: Id;
}

/** Default responsible person: a user with `canManageService`, else the first Chief. */
export function defaultResponsible(state: Pick<AppState, 'users'>): Id | undefined {
  return (
    state.users.find((u) => u.active && u.perms.canManageService && u.role === 'warehouse')?.id ??
    state.users.find((u) => u.active && u.role === 'chief')?.id
  );
}

/** Open a service case inside a draft (used by vratka as well). Returns the new case. */
export function openServiceInDraft(
  d: AppState,
  userId: Id,
  today: IsoDate,
  input: OpenServiceInput,
): ServiceCase {
  const sc: ServiceCase = {
    id: nextId(d, 'svc'),
    itemId: input.itemId,
    warehouseId: input.warehouseId,
    qty: input.qty,
    reason: input.reason,
    internal: input.internal ?? true,
    responsibleUserId: input.responsibleUserId ?? defaultResponsible(d) ?? userId,
    status: 'reported',
    openedOn: today,
    events: [{ status: 'reported', userId, on: today, comment: input.reason }],
  };
  if (input.repairShop) sc.repairShop = input.repairShop;
  if (input.expectedBack) sc.expectedBack = input.expectedBack;
  if (input.caseId) sc.caseId = input.caseId;
  if (input.openedFromBookingId) sc.openedFromBookingId = input.openedFromBookingId;
  d.serviceCases.push(sc);
  notify(
    d,
    [sc.responsibleUserId, ...chiefIds(d)],
    {
      type: 'service_opened',
      text: `Service case opened: ${sc.qty}× ${sc.itemId}`,
      params: { itemId: sc.itemId, qty: sc.qty, serviceId: sc.id },
    },
    today,
  );
  return sc;
}

/** Orders (from today on) that hold the item in the warehouse and are now short. */
function affectedOrders(state: AppState, itemId: Id, warehouseId: Id, today: IsoDate): Id[] {
  const out: Id[] = [];
  for (const b of state.bookings) {
    if (
      b.type !== 'order' ||
      !['confirmed', 'packing'].includes(b.status) ||
      lastBookedUntil(b) < today
    )
      continue;
    const relevant = b.lines.some((l) => {
      if (!isActiveLine(l)) return false;
      if (isItemTarget(l.target)) return l.target.itemId === itemId;
      if (isCaseTarget(l.target)) {
        const caseTypeId = l.target.caseTypeId;
        return !!state.caseTypes
          .find((t) => t.id === caseTypeId)
          ?.contents.some((c) => c.itemId === itemId);
      }
      return false;
    });
    if (!relevant) continue;
    const av = evaluateBooking(state, b, buildHoldIndex(state, filterFor(b)));
    if (
      [...av.values()].some(
        (a) => a.badge === 'red' && (a.warehouseId ?? warehouseId) === warehouseId,
      )
    )
      out.push(b.id);
  }
  return out;
}

/** Open a service case (anyone who finds a fault). Future orders are rechecked immediately. */
export function openServiceCase(
  state: AppState,
  user: User,
  today: IsoDate,
  input: OpenServiceInput,
): Result<{ state: AppState; serviceCaseId: Id }> {
  if (!can(user, 'open_service')) return err('forbidden', 'Not allowed');
  if (!Number.isInteger(input.qty) || input.qty <= 0)
    return err('validation', 'Quantity must be positive');
  if (!input.reason.trim()) return err('validation', 'Reason is required');
  const inService = state.serviceCases
    .filter(
      (s) => s.itemId === input.itemId && s.warehouseId === input.warehouseId && isOpenService(s),
    )
    .reduce((n, s) => n + s.qty, 0);
  if (input.qty > stockQty(state, input.itemId, input.warehouseId) - inService) {
    return err('validation', 'More pieces than in stock');
  }
  const { state: s1, result: id } = produce(
    state,
    (d) => openServiceInDraft(d, user.id, today, input).id,
  );
  const affected = affectedOrders(s1, input.itemId, input.warehouseId, today);
  let s2 = s1;
  if (affected.length > 0) {
    s2 = produce(s1, (d) => {
      for (const bid of affected) {
        const b = d.bookings.find((x) => x.id === bid);
        if (!b) continue;
        notify(
          d,
          [b.pmId],
          {
            type: 'service_affects_order',
            text: `Service case affects ${b.eventName}`,
            params: { event: b.eventName, itemId: input.itemId },
            bookingId: b.id,
          },
          today,
        );
      }
    }).state;
  }
  return ok({ state: recomputeConflictRecords(s2, today), serviceCaseId: id });
}

export interface ServiceStatusInput {
  comment?: string;
  cost?: number;
  expectedBack?: IsoDate;
  repairShop?: string;
  responsibleUserId?: Id;
}

/** Change status of a service case (Chief, `canManageService`, or the responsible person). */
export function setServiceStatus(
  state: AppState,
  user: User,
  today: IsoDate,
  id: Id,
  status: ServiceStatus,
  input: ServiceStatusInput = {},
): Result<AppState> {
  const sc = state.serviceCases.find((s) => s.id === id);
  if (!sc) return err('not_found', `Service case ${id} not found`);
  if (!can(user, 'manage_service') && sc.responsibleUserId !== user.id)
    return err('forbidden', 'Not allowed');
  if (!isOpenService(sc)) return err('invalid_state', 'Service case is closed');
  const next = produce(state, (d) => {
    const x = d.serviceCases.find((s) => s.id === id) as ServiceCase;
    x.status = status;
    const ev: ServiceCase['events'][number] = { status, userId: user.id, on: today };
    if (input.comment?.trim()) ev.comment = input.comment.trim();
    x.events.push(ev);
    if (input.cost !== undefined) x.cost = input.cost;
    if (input.expectedBack) x.expectedBack = input.expectedBack;
    if (input.repairShop) x.repairShop = input.repairShop;
    if (input.responsibleUserId) x.responsibleUserId = input.responsibleUserId;
    if (status === 'external') x.internal = false;
    if (status === 'written_off') {
      const st = d.stock.find((s) => s.itemId === x.itemId && s.warehouseId === x.warehouseId);
      if (st) st.qty = Math.max(0, st.qty - x.qty);
      if (x.caseId) {
        const c = d.cases.find((cc) => cc.id === x.caseId);
        const e = c?.contents.find((l) => l.itemId === x.itemId);
        if (c && e) {
          e.qty = Math.max(0, e.qty - x.qty);
          c.contents = c.contents.filter((l) => l.qty > 0);
          if (!contentsMatchStandard(d, c)) c.incompleteSince = today;
        }
      }
    }
    if (status === 'fixed') {
      notify(
        d,
        [x.responsibleUserId, ...chiefIds(d)],
        {
          type: 'service_fixed',
          text: `Service case ${x.id} fixed`,
          params: { serviceId: x.id, itemId: x.itemId },
        },
        today,
      );
    }
  }).state;
  return ok(recomputeConflictRecords(next, today));
}

/** Passing the expected date only raises a warning; pieces stay out of service. */
export function isServiceOverdue(sc: ServiceCase, today: IsoDate): boolean {
  return isOpenService(sc) && !!sc.expectedBack && today > sc.expectedBack;
}

export function openServiceCases(state: Pick<AppState, 'serviceCases'>): ServiceCase[] {
  return state.serviceCases.filter(isOpenService);
}
