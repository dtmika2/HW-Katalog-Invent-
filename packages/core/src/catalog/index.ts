/**
 * Catalogue lookups: items, stock per warehouse, cases and their completeness,
 * loose vs. in-case stock.
 */
import type {
  AppState,
  Booking,
  BookingLine,
  Case,
  CaseType,
  Id,
  Item,
  QtyLine,
  RefillTask,
  ServiceCase,
} from '../types';
import { diffDays } from '../dates';
import { isCaseTarget, isExternal, isItemTarget } from '../util';

type S = Pick<AppState, 'items' | 'stock' | 'caseTypes' | 'cases' | 'serviceCases'>;

export function getItem(state: Pick<AppState, 'items'>, id: Id): Item | undefined {
  return state.items.find((i) => i.id === id);
}

export function getCaseType(state: Pick<AppState, 'caseTypes'>, id: Id): CaseType | undefined {
  return state.caseTypes.find((t) => t.id === id);
}

export function getCase(state: Pick<AppState, 'cases'>, id: Id): Case | undefined {
  return state.cases.find((c) => c.id === id);
}

/** Pieces of `itemId` registered in warehouse `warehouseId` (`ItemStock.qty`). */
export function stockQty(state: Pick<AppState, 'stock'>, itemId: Id, warehouseId: Id): number {
  return state.stock.find((s) => s.itemId === itemId && s.warehouseId === warehouseId)?.qty ?? 0;
}

/** Total pieces of an item over all warehouses. */
export function totalStock(state: Pick<AppState, 'stock'>, itemId: Id): number {
  let n = 0;
  for (const s of state.stock) if (s.itemId === itemId) n += s.qty;
  return n;
}

/** Home shelf of an item in a warehouse. */
export function homeLocationId(
  state: Pick<AppState, 'stock'>,
  itemId: Id,
  warehouseId: Id,
): Id | undefined {
  return state.stock.find((s) => s.itemId === itemId && s.warehouseId === warehouseId)
    ?.homeLocationId;
}

/** Actual quantity of `itemId` in a case. */
export function caseContentQty(c: Case, itemId: Id): number {
  let n = 0;
  for (const l of c.contents) if (l.itemId === itemId) n += l.qty;
  return n;
}

/** Standard per-case quantity of `itemId` for a case type. */
export function standardQty(t: CaseType, itemId: Id): number {
  let n = 0;
  for (const l of t.contents) if (l.itemId === itemId) n += l.qty;
  return n;
}

/** Items missing from a case compared with its type's standard contents. */
export function caseMissing(state: Pick<AppState, 'caseTypes'>, c: Case): QtyLine[] {
  const t = getCaseType(state, c.caseTypeId);
  if (!t) return [];
  const out: QtyLine[] = [];
  for (const std of t.contents) {
    const have = caseContentQty(c, std.itemId);
    if (have < std.qty) out.push({ itemId: std.itemId, qty: std.qty - have });
  }
  return out;
}

/** True when actual contents equal the standard contents exactly. */
export function contentsMatchStandard(state: Pick<AppState, 'caseTypes'>, c: Case): boolean {
  const t = getCaseType(state, c.caseTypeId);
  if (!t) return false;
  const ids = new Set([...t.contents.map((l) => l.itemId), ...c.contents.map((l) => l.itemId)]);
  for (const id of ids) if (caseContentQty(c, id) !== standardQty(t, id)) return false;
  return true;
}

export function isOpenService(sc: ServiceCase): boolean {
  return sc.status !== 'fixed' && sc.status !== 'written_off';
}

/**
 * A case is complete when its actual contents equal the standard and none of its pieces
 * sit in an open service case.
 */
export function isCaseComplete(
  state: Pick<AppState, 'caseTypes' | 'serviceCases'>,
  c: Case,
): boolean {
  if (c.archived) return false;
  if (!contentsMatchStandard(state, c)) return false;
  return !state.serviceCases.some((sc) => sc.caseId === c.id && isOpenService(sc));
}

/** Pieces of an item in a warehouse that are not inside any case. */
export function looseStock(state: S, itemId: Id, warehouseId: Id): number {
  let inCases = 0;
  for (const c of state.cases) {
    if (c.warehouseId !== warehouseId || c.archived) continue;
    inCases += caseContentQty(c, itemId);
  }
  return stockQty(state, itemId, warehouseId) - inCases;
}

/** Cases that are not complete, with what they miss and since when. */
export function refillTasks(state: S): RefillTask[] {
  const out: RefillTask[] = [];
  for (const c of state.cases) {
    if (c.archived) continue;
    const missing = caseMissing(state, c);
    if (missing.length === 0) continue;
    out.push({ caseId: c.id, missing, since: c.incompleteSince ?? '1970-01-01' });
  }
  return out;
}

/** Case types that contain an item. */
export function caseTypesContaining(state: Pick<AppState, 'caseTypes'>, itemId: Id): CaseType[] {
  return state.caseTypes.filter((t) => !t.archived && t.contents.some((l) => l.itemId === itemId));
}

/** Indicative price of one line per day (external lines are not priced). */
export function linePriceDay(state: Pick<AppState, 'items' | 'caseTypes'>, line: BookingLine) {
  const qty = line.overriddenQty ?? line.qty;
  if (isExternal(line.target)) return 0;
  if (isItemTarget(line.target)) return (getItem(state, line.target.itemId)?.priceDay ?? 0) * qty;
  if (isCaseTarget(line.target)) {
    const t = getCaseType(state, line.target.caseTypeId);
    if (!t) return 0;
    let p = 0;
    for (const c of t.contents) p += (getItem(state, c.itemId)?.priceDay ?? 0) * c.qty;
    return p * qty;
  }
  return 0;
}

/** Number of event days of a booking (the rental is quoted per event day, not per buffer day). */
export function eventDays(booking: Pick<Booking, 'periods'>): number {
  let n = 0;
  for (const p of booking.periods) n += diffDays(p.eventFrom, p.eventTo) + 1;
  return n;
}

/** Indicative total of a booking: sum of line day prices × event days. */
export function bookingPriceTotal(
  state: Pick<AppState, 'items' | 'caseTypes'>,
  booking: Pick<Booking, 'periods' | 'lines'>,
): number {
  let perDay = 0;
  for (const l of booking.lines)
    if (l.status === 'ok' && (!l.late || l.late.charged)) perDay += linePriceDay(state, l);
  return perDay * eventDays(booking);
}

/**
 * Warehouse a line is served from: its explicit source, else the booking default when that
 * warehouse stocks the resource, else the first warehouse that does.
 */
export function resolveSourceWarehouse(
  state: Pick<AppState, 'stock' | 'cases' | 'warehouses'>,
  booking: Pick<Booking, 'defaultWarehouseId'>,
  line: BookingLine,
): Id {
  if (line.sourceWarehouseId) return line.sourceWarehouseId;
  const has = (w: Id): boolean => {
    if (isItemTarget(line.target)) {
      const itemId = line.target.itemId;
      return state.stock.some((s) => s.itemId === itemId && s.warehouseId === w && s.qty > 0);
    }
    if (isCaseTarget(line.target)) {
      const t = line.target.caseTypeId;
      return state.cases.some((c) => c.caseTypeId === t && c.warehouseId === w && !c.archived);
    }
    return false;
  };
  if (has(booking.defaultWarehouseId)) return booking.defaultWarehouseId;
  return state.warehouses.find((w) => has(w.id))?.id ?? booking.defaultWarehouseId;
}
