/**
 * Catalogue editing for the Chief (or anyone with `canEditCatalogue`): items, stock per warehouse,
 * connections, case types and cases, completeness, bulk import. Nothing is hard-deleted.
 */
import type { IsoDate } from '../dates';
import { can } from '../lifecycle/permissions';
import type { AppState, Case, CaseType, Connection, Id, Item, User } from '../types';
import { err, nextId, ok, produce, type Result } from '../util';
import { caseContentQty, contentsMatchStandard } from './index';

const forbidden = <T>() => err<T>('forbidden', 'Catalogue editing is not allowed');

function validateItem(state: AppState, item: Item): Result<true> {
  if (!item.name.trim()) return err('validation', 'Name is required', { field: 'name' });
  if (!Number.isFinite(item.priceDay) || item.priceDay < 0) {
    return err('validation', 'Price must be zero or more', { field: 'priceDay' });
  }
  if (!state.categories.some((c) => c.id === item.categoryId)) {
    return err('validation', 'Unknown category', { field: 'categoryId' });
  }
  if (item.weightKg !== undefined && (!Number.isFinite(item.weightKg) || item.weightKg < 0)) {
    return err('validation', 'Weight must be zero or more', { field: 'weightKg' });
  }
  return ok(true);
}

/** Create or update an item. A new item without id gets one. */
export function upsertItem(
  state: AppState,
  user: User,
  item: Item,
): Result<{ state: AppState; itemId: Id }> {
  if (!can(user, 'edit_catalogue')) return forbidden();
  const v = validateItem(state, item);
  if (!v.ok) return v;
  const { state: next, result } = produce(state, (d) => {
    const id = item.id || nextId(d, 'item');
    const clean: Item = { ...item, id, name: item.name.trim() };
    const i = d.items.findIndex((x) => x.id === id);
    if (i >= 0) d.items[i] = clean;
    else d.items.push(clean);
    return id;
  });
  return ok({ state: next, itemId: result });
}

/** Copy an item (similar lights differ only in name). Stock is not copied. */
export function duplicateItem(
  state: AppState,
  user: User,
  itemId: Id,
  name: string,
): Result<{ state: AppState; itemId: Id }> {
  const src = state.items.find((i) => i.id === itemId);
  if (!src) return err('not_found', `Item ${itemId} not found`);
  const r = upsertItem(state, user, { ...structuredClone(src), id: '', name });
  if (!r.ok) return r;
  // copy outgoing connections too
  return ok({
    state: produce(r.value.state, (d) => {
      for (const c of state.connections.filter((x) => x.fromItemId === itemId)) {
        d.connections.push({
          ...structuredClone(c),
          id: nextId(d, 'con'),
          fromItemId: r.value.itemId,
        });
      }
    }).state,
    itemId: r.value.itemId,
  });
}

/** Archive (or restore) an item; it disappears from search but history stays. */
export function setItemArchived(
  state: AppState,
  user: User,
  itemId: Id,
  archived: boolean,
): Result<AppState> {
  if (!can(user, 'edit_catalogue')) return forbidden();
  if (!state.items.some((i) => i.id === itemId))
    return err('not_found', `Item ${itemId} not found`);
  return ok(
    produce(state, (d) => {
      const it = d.items.find((i) => i.id === itemId);
      if (it) it.archived = archived;
    }).state,
  );
}

/** Set several items' category or price at once. */
export function bulkUpdateItems(
  state: AppState,
  user: User,
  ids: Id[],
  patch: Partial<Pick<Item, 'categoryId' | 'priceDay' | 'returnable'>>,
): Result<AppState> {
  if (!can(user, 'edit_catalogue')) return forbidden();
  let s = state;
  for (const id of ids) {
    const it = s.items.find((i) => i.id === id);
    if (!it) return err('not_found', `Item ${id} not found`);
    const r = upsertItem(s, user, { ...it, ...patch });
    if (!r.ok) return r;
    s = r.value.state;
  }
  return ok(s);
}

/** Pieces of an item in a warehouse; cannot go below what sits in cases there. */
export function setItemStock(
  state: AppState,
  user: User,
  itemId: Id,
  warehouseId: Id,
  qty: number,
  homeLocationId?: Id,
): Result<AppState> {
  if (!can(user, 'edit_catalogue')) return forbidden();
  if (!Number.isInteger(qty) || qty < 0)
    return err('validation', 'Stock must be a whole number', { field: 'qty' });
  const inCases = state.cases
    .filter((c) => c.warehouseId === warehouseId && !c.archived)
    .reduce((n, c) => n + caseContentQty(c, itemId), 0);
  if (qty < inCases)
    return err('validation', 'Fewer pieces than are inside cases', { field: 'qty', inCases });
  const loc =
    homeLocationId ??
    state.stock.find((s) => s.itemId === itemId && s.warehouseId === warehouseId)?.homeLocationId;
  const location = state.locations.find((l) => l.id === loc);
  if (qty > 0 && (!location || location.warehouseId !== warehouseId)) {
    return err('validation', 'Home location must be in the warehouse', { field: 'homeLocationId' });
  }
  return ok(
    produce(state, (d) => {
      const st = d.stock.find((s) => s.itemId === itemId && s.warehouseId === warehouseId);
      if (st) {
        st.qty = qty;
        if (loc) st.homeLocationId = loc;
      } else if (qty > 0 && loc) d.stock.push({ itemId, warehouseId, qty, homeLocationId: loc });
    }).state,
  );
}

/** Add a connection (validated: targets exist, no self link, n for per-N). */
export function addConnection(
  state: AppState,
  user: User,
  conn: Omit<Connection, 'id'>,
): Result<{ state: AppState; connectionId: Id }> {
  if (!can(user, 'edit_catalogue')) return forbidden();
  if (!state.items.some((i) => i.id === conn.fromItemId))
    return err('validation', 'Unknown item', { field: 'fromItemId' });
  const t = conn.target;
  const exists =
    'itemId' in t
      ? state.items.some((i) => i.id === t.itemId)
      : state.caseTypes.some((c) => c.id === t.caseTypeId);
  if (!exists) return err('validation', 'Unknown target', { field: 'target' });
  if ('itemId' in t && t.itemId === conn.fromItemId)
    return err('validation', 'An item cannot point at itself', { field: 'target' });
  if (!Number.isInteger(conn.qty) || conn.qty < 1)
    return err('validation', 'Quantity must be at least 1', { field: 'qty' });
  if (conn.rule === 'per_n' && (!conn.n || conn.n < 1))
    return err('validation', 'N is required for "per N pieces"', { field: 'n' });
  const { state: next, result } = produce(state, (d) => {
    const id = nextId(d, 'con');
    d.connections.push({ ...conn, id });
    return id;
  });
  return ok({ state: next, connectionId: result });
}

export function removeConnection(state: AppState, user: User, id: Id): Result<AppState> {
  if (!can(user, 'edit_catalogue')) return forbidden();
  if (!state.connections.some((c) => c.id === id))
    return err('not_found', `Connection ${id} not found`);
  return ok(
    produce(state, (d) => void (d.connections = d.connections.filter((c) => c.id !== id))).state,
  );
}

/** Create or update a case type's standard contents. */
export function upsertCaseType(
  state: AppState,
  user: User,
  t: CaseType,
): Result<{ state: AppState; caseTypeId: Id }> {
  if (!can(user, 'edit_catalogue')) return forbidden();
  if (!t.name.trim()) return err('validation', 'Name is required', { field: 'name' });
  if (
    t.contents.length === 0 ||
    t.contents.some((c) => c.qty < 1 || !state.items.some((i) => i.id === c.itemId))
  ) {
    return err('validation', 'Contents need items with a count', { field: 'contents' });
  }
  const { state: next, result } = produce(state, (d) => {
    const id = t.id || nextId(d, 'ct');
    const i = d.caseTypes.findIndex((x) => x.id === id);
    if (i >= 0) d.caseTypes[i] = { ...t, id };
    else d.caseTypes.push({ ...t, id });
    return id;
  });
  return ok({ state: next, caseTypeId: result });
}

/** Create or update a physical case (actual contents must fit the warehouse stock). */
export function upsertCase(
  state: AppState,
  user: User,
  c: Case,
  today: IsoDate,
): Result<{ state: AppState; caseId: Id }> {
  if (!can(user, 'edit_catalogue')) return forbidden();
  if (!c.number.trim()) return err('validation', 'Case number is required', { field: 'number' });
  if (!state.caseTypes.some((t) => t.id === c.caseTypeId))
    return err('validation', 'Unknown case type', { field: 'caseTypeId' });
  if (state.cases.some((x) => x.number === c.number.trim() && x.id !== c.id)) {
    return err('validation', 'Case number already used', { field: 'number' });
  }
  for (const line of c.contents) {
    const stock =
      state.stock.find((s) => s.itemId === line.itemId && s.warehouseId === c.warehouseId)?.qty ??
      0;
    const others = state.cases
      .filter((x) => x.id !== c.id && x.warehouseId === c.warehouseId && !x.archived)
      .reduce((n, x) => n + caseContentQty(x, line.itemId), 0);
    if (line.qty + others > stock)
      return err('validation', 'Not enough pieces in the warehouse', {
        field: 'contents',
        itemId: line.itemId,
      });
  }
  const { state: next, result } = produce(state, (d) => {
    const id = c.id || nextId(d, 'case');
    const clean: Case = {
      ...c,
      id,
      number: c.number.trim(),
      contents: c.contents.filter((l) => l.qty > 0),
    };
    if (contentsMatchStandard(d, clean)) delete clean.incompleteSince;
    else clean.incompleteSince = clean.incompleteSince ?? today;
    const i = d.cases.findIndex((x) => x.id === id);
    if (i >= 0) d.cases[i] = clean;
    else d.cases.push(clean);
    return id;
  });
  return ok({ state: next, caseId: result });
}

export interface Completeness {
  photo: boolean;
  location: boolean;
  price: boolean;
  connections: boolean;
  /** 0–4 */
  score: number;
  needsSetup: boolean;
}

/** Completeness indicator (photo, location, price, connections) for gradual catalogue setup. */
export function itemCompleteness(state: AppState, item: Item): Completeness {
  const photo = (item.photos?.length ?? 0) > 0;
  const location = state.stock.some((s) => s.itemId === item.id && s.qty > 0 && !!s.homeLocationId);
  const price = item.priceDay > 0;
  const connections = state.connections.some(
    (c) => c.fromItemId === item.id || ('itemId' in c.target && c.target.itemId === item.id),
  );
  const score = [photo, location, price, connections].filter(Boolean).length;
  return { photo, location, price, connections, score, needsSetup: score < 4 };
}

// ---------------------------------------------------------------------------
// Import

export interface ImportRow {
  /** Row number in the sheet (for the error report). */
  row: number;
  id?: string;
  name?: string;
  manufacturer?: string;
  model?: string;
  /** Category id or name. */
  category?: string;
  priceDay?: number | string;
  /** Pieces per warehouse name or id, e.g. { Brod: 8, Karlák: 4 }. */
  stock?: Record<string, number | string | undefined>;
  returnable?: boolean | string;
  weightKg?: number | string;
  notes?: string;
}

export interface ImportError {
  row: number;
  field: string;
  message: string;
}

export interface ImportResult {
  state: AppState;
  created: number;
  updated: number;
  errors: ImportError[];
}

const num = (v: number | string | undefined): number | undefined => {
  if (v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

const bool = (v: boolean | string | undefined): boolean => {
  if (v === undefined || v === '') return true;
  if (typeof v === 'boolean') return v;
  return !['ne', 'no', 'false', '0', 'n'].includes(v.trim().toLowerCase());
};

/**
 * Import items row by row: valid rows are created or updated (matched by id, else by exact
 * name); invalid rows are reported with row and field and skipped.
 */
export function importItems(state: AppState, user: User, rows: ImportRow[]): Result<ImportResult> {
  if (!can(user, 'edit_catalogue')) return forbidden();
  let s = state;
  const errors: ImportError[] = [];
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const rowErrors: ImportError[] = [];
    const name = (r.name ?? '').trim();
    if (!name) rowErrors.push({ row: r.row, field: 'name', message: 'missing' });
    const cat = s.categories.find(
      (c) =>
        c.id === r.category || c.name.toLowerCase() === (r.category ?? '').trim().toLowerCase(),
    );
    if (!cat) rowErrors.push({ row: r.row, field: 'category', message: 'unknown' });
    const price = num(r.priceDay) ?? 0;
    if (Number.isNaN(price) || price < 0)
      rowErrors.push({ row: r.row, field: 'priceDay', message: 'invalid' });
    const weight = num(r.weightKg);
    if (weight !== undefined && (Number.isNaN(weight) || weight < 0))
      rowErrors.push({ row: r.row, field: 'weightKg', message: 'invalid' });
    const stock: { w: string; qty: number }[] = [];
    for (const [key, raw] of Object.entries(r.stock ?? {})) {
      const w = s.warehouses.find(
        (x) => x.id === key || x.name.toLowerCase() === key.toLowerCase(),
      );
      const q = num(raw);
      if (q === undefined) continue;
      if (!w) rowErrors.push({ row: r.row, field: `stock:${key}`, message: 'unknown warehouse' });
      else if (Number.isNaN(q) || q < 0 || !Number.isInteger(q))
        rowErrors.push({ row: r.row, field: `stock:${key}`, message: 'invalid' });
      else stock.push({ w: w.id, qty: q });
    }
    if (rowErrors.length > 0 || !cat) {
      errors.push(...rowErrors);
      continue;
    }
    const existing = s.items.find(
      (i) => (r.id && i.id === r.id) || i.name.toLowerCase() === name.toLowerCase(),
    );
    const item: Item = {
      ...(existing ?? { archived: false }),
      id: existing?.id ?? r.id ?? '',
      name,
      manufacturer: (r.manufacturer ?? existing?.manufacturer ?? '').trim(),
      model: (r.model ?? existing?.model ?? '').trim(),
      categoryId: cat.id,
      priceDay: price,
      returnable: bool(r.returnable),
    };
    if (weight !== undefined) item.weightKg = weight;
    if (r.notes?.trim()) item.notes = r.notes.trim();
    const up = upsertItem(s, user, item);
    if (!up.ok) {
      errors.push({
        row: r.row,
        field: String(up.error.details?.field ?? 'row'),
        message: up.error.message,
      });
      continue;
    }
    let s2 = up.value.state;
    for (const st of stock) {
      const home =
        s2.stock.find((x) => x.itemId === up.value.itemId && x.warehouseId === st.w)
          ?.homeLocationId ??
        s2.locations.find(
          (l) => l.warehouseId === st.w && !s2.locations.some((c) => c.parentId === l.id),
        )?.id;
      const sr = setItemStock(s2, user, up.value.itemId, st.w, st.qty, home);
      if (!sr.ok) {
        errors.push({ row: r.row, field: `stock:${st.w}`, message: sr.error.message });
        continue;
      }
      s2 = sr.value;
    }
    s = s2;
    if (existing) updated += 1;
    else created += 1;
  }
  return ok({ state: s, created, updated, errors });
}
