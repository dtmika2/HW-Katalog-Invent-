/**
 * How a booking's list is organised: lines nested under other lines and the PM's own groups.
 * Organisation only, it never changes quantities held, prices or conflicts.
 *
 * - A required ("auto") line stays with the line that needs it; a shared one may be moved
 *   between the lines that need it.
 * - Any other line may be nested under any line or put into a group; children move along.
 */
import type { Booking, BookingGroup, BookingLine, CatalogView, Id } from '../types';
import { isCaseTarget, isExternal, isItemTarget } from '../util';

type Listed = Pick<Booking, 'lines' | 'groups'>;

/** Where a line is put when it is added. */
export interface LinePlace {
  nestedUnder?: Id;
  groupId?: Id;
}

export interface LineNode {
  line: BookingLine;
  depth: number;
  children: LineNode[];
}

export interface LineGroupNode {
  /** Undefined: lines in no group. */
  group?: BookingGroup;
  roots: LineNode[];
}

/** An overridden auto line that lost its parents lives on as `kept:`. */
const alive = (ids: Set<Id>, id: Id | undefined): Id | undefined => {
  if (!id) return undefined;
  if (ids.has(id)) return id;
  const kept = id.startsWith('auto:') ? `kept:${id.slice('auto:'.length)}` : undefined;
  return kept && ids.has(kept) ? kept : undefined;
};

function rawParent(line: BookingLine, ids: Set<Id>): Id | undefined {
  if (line.origin !== 'auto') return alive(ids, line.nestedUnder);
  const needs = line.parentLineIds.filter((p) => ids.has(p));
  return line.nestedUnder && needs.includes(line.nestedUnder) ? line.nestedUnder : needs[0];
}

/** Shown parent of every nested line; loops are cut so the tree is always finite. */
export function parentMap(b: Pick<Booking, 'lines'>): Map<Id, Id> {
  const ids = new Set(b.lines.map((l) => l.id));
  const raw = new Map<Id, Id>();
  for (const l of b.lines) {
    const p = rawParent(l, ids);
    if (p && p !== l.id) raw.set(l.id, p);
  }
  for (const l of b.lines) {
    const seen = new Set<Id>([l.id]);
    let at = raw.get(l.id);
    while (at) {
      if (seen.has(at)) {
        raw.delete(at);
        break;
      }
      seen.add(at);
      at = raw.get(at);
    }
  }
  return raw;
}

/** Group a line is shown in (through its top-level parent). */
export function groupOfLine(b: Listed, lineId: Id): BookingGroup | undefined {
  const parents = parentMap(b);
  let id = lineId;
  for (let p = parents.get(id); p; p = parents.get(id)) id = p;
  const groupId = b.lines.find((l) => l.id === id)?.groupId;
  return (b.groups ?? []).find((g) => g.id === groupId);
}

/** The list as shown: groups in order (then lines in no group) → top-level lines → children. */
export function lineTree(b: Listed): LineGroupNode[] {
  const parents = parentMap(b);
  const kids = new Map<Id, BookingLine[]>();
  const roots: BookingLine[] = [];
  for (const l of b.lines) {
    const p = parents.get(l.id);
    if (p) kids.set(p, [...(kids.get(p) ?? []), l]);
    else roots.push(l);
  }
  const node = (line: BookingLine, depth: number): LineNode => ({
    line,
    depth,
    children: (kids.get(line.id) ?? []).map((c) => node(c, depth + 1)),
  });
  const groups = b.groups ?? [];
  const known = new Set(groups.map((g) => g.id));
  const inGroup = (id: Id | undefined) =>
    roots
      .filter((l) => (l.groupId && known.has(l.groupId) ? l.groupId : undefined) === id)
      .map((l) => node(l, 0));
  return [
    ...groups.map((group) => ({ group, roots: inGroup(group.id) })),
    { roots: inGroup(undefined) },
  ];
}

/** A node and everything below it, in order. */
export function flattenNodes(nodes: LineNode[]): LineNode[] {
  return nodes.flatMap((n) => [n, ...flattenNodes(n.children)]);
}

/** Everything shown below a line. */
export function descendants(b: Pick<Booking, 'lines'>, lineId: Id): BookingLine[] {
  const parents = parentMap(b);
  const below = (id: Id): boolean => {
    for (let p = parents.get(id); p; p = parents.get(p)) if (p === lineId) return true;
    return false;
  };
  return b.lines.filter((l) => below(l.id));
}

/** True when a line may be nested under another one. */
export function canNest(b: Pick<Booking, 'lines'>, lineId: Id, parentId: Id): boolean {
  const line = b.lines.find((l) => l.id === lineId);
  const parent = b.lines.find((l) => l.id === parentId);
  if (!line || lineId === parentId || !parent || line.late || parent.late) return false;
  if (line.origin === 'auto' && !line.parentLineIds.includes(parentId)) return false;
  return !descendants(b, lineId).some((l) => l.id === parentId);
}

/** Required lines stay with the line that needs them, last-minute ones are not arranged. */
export const canLeave = (line: BookingLine): boolean => line.origin !== 'auto' && !line.late;

/** True when a line is the item or brings it (a case that holds it). */
export function bringsItem(
  catalog: Pick<CatalogView, 'caseTypes'>,
  line: BookingLine,
  itemId: Id,
): boolean {
  if (isExternal(line.target)) return line.target.external.itemId === itemId;
  if (isItemTarget(line.target)) return line.target.itemId === itemId;
  if (!isCaseTarget(line.target)) return false;
  const typeId = line.target.caseTypeId;
  return !!catalog.caseTypes
    .find((t) => t.id === typeId)
    ?.contents.some((c) => c.itemId === itemId);
}

function place(line: BookingLine, p: LinePlace, keepFollowing = false): BookingLine {
  const l = { ...line };
  delete l.nestedUnder;
  delete l.groupId;
  if (!keepFollowing) delete l.followsCheck;
  if (p.nestedUnder) l.nestedUnder = p.nestedUnder;
  else if (p.groupId) l.groupId = p.groupId;
  return l;
}

const mapLines = (b: Booking, fn: (l: BookingLine) => BookingLine): Booking => ({
  ...b,
  lines: b.lines.map(fn),
});

/** Nest a line under another; it keeps following its item's count only under that item. */
export function nestLine(
  catalog: Pick<CatalogView, 'caseTypes'>,
  b: Booking,
  lineId: Id,
  parentId: Id,
): Booking {
  if (!canNest(b, lineId, parentId)) return b;
  const parent = b.lines.find((l) => l.id === parentId) as BookingLine;
  return mapLines(b, (l) => {
    if (l.id !== lineId) return l;
    const follows = l.followsCheck && bringsItem(catalog, parent, l.followsCheck.fromItemId);
    return place(l, { nestedUnder: parentId }, !!follows);
  });
}

/** Put a line (with its children) at the top level of a group, or of no group. */
export function moveToGroup(b: Booking, lineId: Id, groupId?: Id): Booking {
  const line = b.lines.find((l) => l.id === lineId);
  if (!line || !canLeave(line)) return b;
  if (groupId && !(b.groups ?? []).some((g) => g.id === groupId)) return b;
  return mapLines(b, (l) => (l.id === lineId ? place(l, groupId ? { groupId } : {}) : l));
}

/** Take a line out of its parent; it stays in the group it was shown in. */
export function unnestLine(b: Booking, lineId: Id): Booking {
  if (!parentMap(b).has(lineId)) return b;
  return moveToGroup(b, lineId, groupOfLine(b, lineId)?.id);
}

/** Place of a line as it is shown, for putting another line next to it. */
export function placeOf(b: Listed, lineId: Id): LinePlace {
  const parent = parentMap(b).get(lineId);
  if (parent) return { nestedUnder: parent };
  const group = groupOfLine(b, lineId);
  return group ? { groupId: group.id } : {};
}

// ---------------------------------------------------------------------------
// Groups

export function addGroup(b: Booking, name: string): { booking: Booking; groupId: Id | undefined } {
  const clean = name.trim();
  if (!clean) return { booking: b, groupId: undefined };
  const groups = b.groups ?? [];
  let n = groups.length + 1;
  while (groups.some((g) => g.id === `${b.id}-g${n}`)) n += 1;
  const id = `${b.id}-g${n}`;
  return { booking: { ...b, groups: [...groups, { id, name: clean }] }, groupId: id };
}

export function renameGroup(b: Booking, groupId: Id, name: string): Booking {
  const clean = name.trim();
  if (!clean) return b;
  return {
    ...b,
    groups: (b.groups ?? []).map((g) => (g.id === groupId ? { ...g, name: clean } : g)),
  };
}

/** Move a group up (-1) or down (1). */
export function moveGroup(b: Booking, groupId: Id, by: -1 | 1): Booking {
  const groups = [...(b.groups ?? [])];
  const i = groups.findIndex((g) => g.id === groupId);
  const a = groups[i];
  const z = groups[i + by];
  if (!a || !z) return b;
  groups[i] = z;
  groups[i + by] = a;
  return { ...b, groups };
}

/** Delete a group; its lines stay, in no group. */
export function removeGroup(b: Booking, groupId: Id): Booking {
  return {
    ...mapLines(b, (l) => {
      if (l.groupId !== groupId) return l;
      const c = { ...l };
      delete c.groupId;
      return c;
    }),
    groups: (b.groups ?? []).filter((g) => g.id !== groupId),
  };
}

// ---------------------------------------------------------------------------
// Saving

/** Drop references that lead nowhere, so the stored list says exactly what is shown. */
export function cleanOrganisation(b: Booking): Booking {
  const ids = new Set(b.lines.map((l) => l.id));
  const groups = (b.groups ?? []).map((g) => ({ ...g, name: g.name.trim() })).filter((g) => g.name);
  const known = new Set(groups.map((g) => g.id));
  const parents = parentMap(b);
  const out = mapLines(b, (line) => {
    if (line.nestedUnder === undefined && line.groupId === undefined) return line;
    const l = { ...line };
    const shown = parents.get(l.id);
    if (l.origin === 'auto') {
      if (l.nestedUnder !== shown) delete l.nestedUnder;
      delete l.groupId;
      return l;
    }
    const parent = alive(ids, l.nestedUnder);
    if (parent && shown === parent) l.nestedUnder = parent;
    else delete l.nestedUnder;
    if (l.nestedUnder || (l.groupId && !known.has(l.groupId))) delete l.groupId;
    return l;
  });
  if (groups.length > 0) return { ...out, groups };
  const rest = { ...out };
  delete rest.groups;
  return rest;
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [z]) => (a < z ? -1 : 1))
        .map(([k, x]) => [k, canonical(x)]),
    );
  return v;
}

/** True when two versions of a booking differ at most in how the list is organised. */
export function sameExceptOrganisation(a: Booking, z: Booking): boolean {
  const bare = (b: Booking) => {
    const { groups: _g, ...rest } = b;
    return JSON.stringify(
      canonical({
        ...rest,
        lines: b.lines.map(({ nestedUnder: _n, groupId: _i, followsCheck: _f, ...l }) => l),
      }),
    );
  };
  return bare(a) === bare(z);
}
