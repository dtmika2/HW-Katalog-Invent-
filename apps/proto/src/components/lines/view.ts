/** Sorting and filtering of a booking's list. View only: nothing here changes the booking. */
import {
  categoryPath,
  effectiveQty,
  flattenNodes,
  foldText,
  groupOfLine,
  linePriceDay,
  lineTree,
  parentMap,
  type AppState,
  type Booking,
  type BookingLine,
  type LineAvailability,
  type LineGroupNode,
  type LineNode,
} from '@quix/core';
import { lineCategoryId, lineName } from '../../lib/names';

export const SORTS = ['own', 'name', 'category', 'qty', 'price', 'availability'] as const;
export type SortKey = (typeof SORTS)[number];

export interface ListView {
  sort: SortKey;
  /** Category or subcategory id; '' = all. */
  category: string;
  text: string;
  /** Also everything nested and required under what matches. */
  attached: boolean;
}

export const DEFAULT_VIEW: ListView = { sort: 'own', category: '', text: '', attached: true };

export const isFiltered = (v: ListView): boolean => !!v.category || !!v.text.trim();

/** Lines the filter leaves visible. */
export function shownLines(s: AppState, b: Booking, v: ListView): BookingLine[] {
  if (!isFiltered(v)) return b.lines;
  const text = foldText(v.text.trim());
  const matches = (l: BookingLine) =>
    (!text || foldText(lineName(s, l)).includes(text)) &&
    (!v.category || categoryPath(s, lineCategoryId(s, l) ?? '').some((c) => c.id === v.category));
  const shown = new Set(b.lines.filter(matches).map((l) => l.id));
  const parents = parentMap(b);
  if (v.attached) {
    // a required item shared by several lines belongs to each of them
    const ups = (l: BookingLine) =>
      l.origin === 'auto' ? [...l.parentLineIds, parents.get(l.id)] : [parents.get(l.id)];
    for (let grew = true; grew;) {
      grew = false;
      for (const l of b.lines)
        if (!shown.has(l.id) && ups(l).some((p) => p && shown.has(p))) {
          shown.add(l.id);
          grew = true;
        }
    }
  }
  return b.lines
    .filter((l) => shown.has(l.id))
    .map((l) => {
      const p = parents.get(l.id);
      if (!p || shown.has(p)) return l;
      // its parent is hidden: show it on its own, still in the right group
      const g = groupOfLine(b, l.id);
      return g ? { ...l, groupId: g.id } : l;
    });
}

const BADGE_RANK = { red: 0, amber: 1, possible: 2, green: 3, none: 4 } as const;

function comparer(
  s: AppState,
  sort: SortKey,
  av: Map<string, LineAvailability>,
): ((a: LineNode, z: LineNode) => number) | undefined {
  const name = (n: LineNode) => lineName(s, n.line);
  const byName = (a: LineNode, z: LineNode) => name(a).localeCompare(name(z), 'cs');
  // lines without a category go last
  const cat = (n: LineNode) =>
    categoryPath(s, lineCategoryId(s, n.line) ?? '')
      .map((c) => c.name)
      .join(' › ') || '￿';
  // a parent is as urgent as the worst thing under it
  const rank = (n: LineNode) =>
    Math.min(...flattenNodes([n]).map((x) => BADGE_RANK[av.get(x.line.id)?.badge ?? 'none']));
  const price = (n: LineNode) => (n.line.status === 'ok' ? linePriceDay(s, n.line) : 0);
  switch (sort) {
    case 'own':
      return undefined;
    case 'name':
      return byName;
    case 'category':
      return (a, z) => cat(a).localeCompare(cat(z), 'cs') || byName(a, z);
    case 'qty':
      return (a, z) => effectiveQty(z.line) - effectiveQty(a.line) || byName(a, z);
    case 'price':
      return (a, z) => price(z) - price(a) || byName(a, z);
    case 'availability':
      return (a, z) => rank(a) - rank(z) || byName(a, z);
  }
}

/** Groups and lines as they should be shown. */
export function viewTree(
  s: AppState,
  b: Booking,
  v: ListView,
  av: Map<string, LineAvailability>,
): { groups: LineGroupNode[]; shown: number } {
  const lines = shownLines(s, b, v);
  const compare = comparer(s, v.sort, av);
  const sorted = (nodes: LineNode[]): LineNode[] => {
    const list = nodes.map((n) => ({ ...n, children: sorted(n.children) }));
    return compare ? list.sort(compare) : list;
  };
  return {
    groups: lineTree({ ...b, lines }).map((g) => ({ ...g, roots: sorted(g.roots) })),
    shown: lines.length,
  };
}

/** Categories present on the list: every top category followed by its used subcategories. */
export function usedCategories(
  s: AppState,
  b: Booking,
): { id: string; name: string; sub: boolean }[] {
  const used = new Set(
    b.lines.flatMap((l) => categoryPath(s, lineCategoryId(s, l) ?? '').map((c) => c.id)),
  );
  const byName = (a: { name: string }, z: { name: string }) => a.name.localeCompare(z.name, 'cs');
  return s.categories
    .filter((c) => !c.parentId && used.has(c.id))
    .sort(byName)
    .flatMap((top) => [
      { id: top.id, name: top.name, sub: false },
      ...s.categories
        .filter((c) => c.parentId === top.id && used.has(c.id))
        .sort(byName)
        .map((c) => ({ id: c.id, name: c.name, sub: true })),
    ]);
}
