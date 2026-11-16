/**
 * Connections engine: turns manual lines into a complete list with required accessories,
 * OR choices, check warnings and recommendations.
 */
import type { BookingLine, CatalogView, Connection, Id, LineTarget, Target } from '../types';
import { effectiveQty, isCaseTarget, isExternal, isItemTarget, targetKey } from '../util';

export interface OrOption {
  /** Connection id, or `group:<groupId>` for a compound (AND) option. */
  key: string;
  targets: { target: Target; qty: number }[];
}

export interface OrChoiceInfo {
  /** `<parent node>|<fromItemId>|<groupId>` */
  groupKey: string;
  parentLineId: Id;
  fromItemId: Id;
  groupId: string;
  options: OrOption[];
  /** Option currently used for the list. */
  selected: string;
  /** How `selected` was decided. */
  decidedBy: 'person' | 'previous' | 'preselected' | 'fallback';
  /** True when no person chose and no option had enough stock: blocks confirmation. */
  open: boolean;
}

export interface CheckCandidate {
  target: Target;
  qty: number;
}

export interface CheckWarning {
  /** `<fromItemId>:<groupId>` */
  key: string;
  fromItemId: Id;
  candidates: CheckCandidate[];
}

export interface Recommendation {
  target: Target;
  key: string;
  qty: number;
  forItemIds: Id[];
}

export interface CycleWarning {
  path: string[];
}

export interface ExpandOptions {
  /** Lines from the previous expansion (keeps overrides and statuses of auto lines). */
  previous?: BookingLine[];
  /** OR choices made by a person. */
  orChoices?: Record<string, string>;
  /** Auto line ids removed by the Chief (their subtree is not expanded). */
  suppressed?: Record<string, string>;
  dismissedRecommendations?: string[];
  dismissedChecks?: string[];
  /** Availability oracle for OR preselection: is `qty` of `target` free for the whole period? */
  isAvailable?: (target: Target, qty: number) => boolean;
}

export interface ExpandResult {
  /** Manual lines first, then auto lines (stable ids `auto:<target key>`). */
  lines: BookingLine[];
  orChoices: OrChoiceInfo[];
  openOrChoices: OrChoiceInfo[];
  checkWarnings: CheckWarning[];
  recommendations: Recommendation[];
  cycleWarnings: CycleWarning[];
}

/** Id of the auto line for a target. */
export const autoLineId = (t: Target): Id => `auto:${targetKey(t)}`;

// ---------------------------------------------------------------------------
// internals

interface Node {
  /** Line id: manual line id or `auto:<key>`. */
  id: Id;
  key: string;
  target: Target;
  qty: number;
}

interface Edge {
  from: Id;
  to: string;
  target: Target;
  qty: number;
  once: boolean;
  orGroupKey?: string;
  orChoice?: string;
}

function ruleQty(c: Connection, parentQty: number): number {
  switch (c.rule) {
    case 'per_piece':
      return parentQty * c.qty;
    case 'per_n':
      return Math.ceil(parentQty / Math.max(1, c.n ?? 1)) * c.qty;
    case 'once_per_order':
      return parentQty > 0 ? c.qty : 0;
  }
}

/** Item-level contents of a node: an item, or a case type's standard contents × qty. */
function nodeContents(
  catalog: CatalogView,
  target: Target,
  qty: number,
): { itemId: Id; qty: number }[] {
  if (isItemTarget(target)) return [{ itemId: target.itemId, qty }];
  const t = catalog.caseTypes.find((x) => x.id === target.caseTypeId);
  if (!t) return [];
  return t.contents.map((c) => ({ itemId: c.itemId, qty: c.qty * qty }));
}

interface GroupDef {
  id: string;
  mode: 'and' | 'or';
  parent?: string;
  members: Connection[];
  /** Position of the first connection, used to order options. */
  order: number;
}

/** Required connections of one item, organised as standalone connections and groups. */
function requiredStructure(catalog: CatalogView, itemId: Id) {
  const conns = catalog.connections.filter((c) => c.fromItemId === itemId && c.kind === 'required');
  const standalone: Connection[] = [];
  const groups = new Map<string, GroupDef>();
  conns.forEach((c, i) => {
    if (!c.groupId) {
      standalone.push(c);
      return;
    }
    let g = groups.get(c.groupId);
    if (!g) {
      g = { id: c.groupId, mode: c.groupMode ?? 'and', members: [], order: i };
      if (c.parentGroupId) g.parent = c.parentGroupId;
      groups.set(c.groupId, g);
    }
    if (c.groupMode) g.mode = c.groupMode;
    if (c.parentGroupId) g.parent = c.parentGroupId;
    g.members.push(c);
  });
  return { standalone, groups };
}

type Contribution = {
  target: Target;
  qty: number;
  once: boolean;
  orGroupKey?: string;
  orChoice?: string;
};

type Chooser = (info: Omit<OrChoiceInfo, 'selected' | 'decidedBy' | 'open'>) => string;

/**
 * Resolve the required connections of `itemId` (with `qty` pieces) for node `nodeId` into
 * flat contributions. With `choose === 'all'`, every OR option is returned (structure pass).
 */
function resolveItem(
  catalog: CatalogView,
  nodeId: Id,
  itemId: Id,
  qty: number,
  choose: Chooser | 'all',
): Contribution[] {
  const { standalone, groups } = requiredStructure(catalog, itemId);
  const out: Contribution[] = [];
  const add = (c: Connection, orGroupKey?: string, orChoice?: string) => {
    const q = choose === 'all' ? 1 : ruleQty(c, qty);
    if (q <= 0) return;
    const entry: Contribution = { target: c.target, qty: q, once: c.rule === 'once_per_order' };
    if (orGroupKey) entry.orGroupKey = orGroupKey;
    if (orChoice) entry.orChoice = orChoice;
    out.push(entry);
  };
  for (const c of standalone) add(c);

  const childGroups = (gid: string) => [...groups.values()].filter((g) => g.parent === gid);

  const evalGroup = (g: GroupDef, depth: number, orGroupKey?: string, orChoice?: string): void => {
    if (g.mode === 'and') {
      for (const c of g.members) add(c, orGroupKey, orChoice);
      if (depth < 1) {
        for (const cg of childGroups(g.id)) evalGroup(cg, depth + 1, orGroupKey, orChoice);
      }
      return;
    }
    // OR group: options are single members and compound child groups (one level deep).
    type Opt = { key: string; order: number; conns: Connection[] };
    const opts: Opt[] = g.members.map((c) => ({
      key: c.id,
      order: catalog.connections.indexOf(c),
      conns: [c],
    }));
    if (depth < 1) {
      for (const cg of childGroups(g.id)) {
        opts.push({ key: `group:${cg.id}`, order: cg.order, conns: cg.members });
      }
    }
    opts.sort((a, b) => a.order - b.order);
    if (opts.length === 0) return;
    const groupKey = `${nodeId}|${itemId}|${g.id}`;
    if (choose === 'all') {
      for (const o of opts) for (const c of o.conns) add(c, groupKey, o.key);
      return;
    }
    const options: OrOption[] = opts.map((o) => ({
      key: o.key,
      targets: o.conns.map((c) => ({ target: c.target, qty: ruleQty(c, qty) })),
    }));
    const selected = choose({
      groupKey,
      parentLineId: nodeId,
      fromItemId: itemId,
      groupId: g.id,
      options,
    });
    const opt = opts.find((o) => o.key === selected) ?? opts[0];
    if (!opt) return;
    for (const c of opt.conns) add(c, groupKey, opt.key);
  };

  for (const g of groups.values()) if (!g.parent) evalGroup(g, 0);
  return out;
}

function lineTarget(line: BookingLine): Target | undefined {
  if (isExternal(line.target)) return undefined;
  return line.target;
}

/**
 * Expand manual lines through required connections.
 *
 * Rules (docs/plan.md, "Connections expansion"): walk required connections recursively;
 * per-piece, per-N and once-per-order quantities; sum per target across parents, but take the
 * max for once-per-order; detect cycles; OR groups with preselection of the first option that
 * is available; overrides kept on recalculation; check warnings and recommendations are
 * collected separately and never added to the list.
 */
export function expand(
  manualLines: BookingLine[],
  catalog: CatalogView,
  options: ExpandOptions = {},
): ExpandResult {
  const previous = options.previous ?? [];
  const prevById = new Map(previous.map((l) => [l.id, l]));
  const suppressed = options.suppressed ?? {};
  const manual = manualLines.filter((l) => l.origin !== 'auto');
  const avail = options.isAvailable;

  const prevChoice = new Map<string, string>();
  for (const l of previous) {
    if (l.orGroupKey && l.orChoice) prevChoice.set(l.orGroupKey, l.orChoice);
  }

  const orInfos = new Map<string, OrChoiceInfo>();
  const choose: Chooser = (info) => {
    const has = (k: string | undefined) => k !== undefined && info.options.some((o) => o.key === k);
    const isGreen = (k: string) => {
      const o = info.options.find((x) => x.key === k);
      return !!o && (!avail || o.targets.every((t) => avail(t.target, t.qty)));
    };
    const person = options.orChoices?.[info.groupKey];
    const prev = prevChoice.get(info.groupKey);
    let selected = info.options[0]?.key ?? '';
    let decidedBy: OrChoiceInfo['decidedBy'] = 'fallback';
    if (has(person)) {
      selected = person as string;
      decidedBy = 'person';
    } else if (has(prev) && isGreen(prev as string)) {
      selected = prev as string;
      decidedBy = 'previous';
    } else {
      const green = info.options.find((o) => isGreen(o.key));
      if (green) {
        selected = green.key;
        decidedBy = 'preselected';
      }
    }
    orInfos.set(info.groupKey, { ...info, selected, decidedBy, open: decidedBy === 'fallback' });
    return selected;
  };

  const edgesOf = (nodeId: Id, target: Target, qty: number, mode: Chooser | 'all'): Edge[] => {
    const out: Edge[] = [];
    for (const content of nodeContents(catalog, target, qty)) {
      for (const c of resolveItem(catalog, nodeId, content.itemId, content.qty, mode)) {
        if (suppressed[autoLineId(c.target)] !== undefined) continue;
        const e: Edge = {
          from: nodeId,
          to: targetKey(c.target),
          target: c.target,
          qty: c.qty,
          once: c.once,
        };
        if (c.orGroupKey) e.orGroupKey = c.orGroupKey;
        if (c.orChoice) e.orChoice = c.orChoice;
        out.push(e);
      }
    }
    return out;
  };

  // Roots: active manual lines (items and case types; externals are not expanded).
  const roots: Node[] = [];
  for (const l of manual) {
    const t = lineTarget(l);
    if (!t || l.status !== 'ok') continue;
    roots.push({ id: l.id, key: targetKey(t), target: t, qty: effectiveQty(l) });
  }

  // 1. Structure pass: DFS over every possible edge (all OR options), dropping back edges.
  const autoNodes = new Map<string, Node>();
  const structural = new Map<Id, Set<string>>();
  const color = new Map<Id, 'gray' | 'black'>();
  const cycleWarnings: CycleWarning[] = [];
  const cycleSeen = new Set<string>();
  const visit = (nodeId: Id, key: string, target: Target, path: string[], rootKey: string) => {
    color.set(nodeId, 'gray');
    const kept = new Set<string>();
    for (const e of edgesOf(nodeId, target, 1, 'all')) {
      const childId = `auto:${e.to}`;
      if (color.get(childId) === 'gray' || e.to === rootKey) {
        const sig = `${key}->${e.to}`;
        if (!cycleSeen.has(sig)) {
          cycleSeen.add(sig);
          cycleWarnings.push({ path: [...path, e.to] });
        }
        continue;
      }
      kept.add(e.to);
      if (!autoNodes.has(e.to)) {
        autoNodes.set(e.to, { id: childId, key: e.to, target: e.target, qty: 0 });
      }
      if (!color.has(childId)) visit(childId, e.to, e.target, [...path, e.to], rootKey);
    }
    structural.set(nodeId, kept);
    color.set(nodeId, 'black');
  };
  for (const r of roots) visit(r.id, r.key, r.target, [r.key], r.key);

  // 2. Quantity pass in topological order (Kahn). A node is processed once all parents are.
  const remaining = new Map<string, number>();
  for (const n of autoNodes.values()) remaining.set(n.key, 0);
  for (const kids of structural.values()) {
    for (const k of kids) remaining.set(k, (remaining.get(k) ?? 0) + 1);
  }
  const incoming = new Map<string, Edge[]>();
  const queue: string[] = [];
  const processNode = (nodeId: Id, target: Target, qty: number) => {
    const allowed = structural.get(nodeId) ?? new Set<string>();
    if (qty > 0) {
      for (const e of edgesOf(nodeId, target, qty, choose)) {
        if (!allowed.has(e.to)) continue;
        const list = incoming.get(e.to);
        if (list) list.push(e);
        else incoming.set(e.to, [e]);
      }
    }
    for (const k of allowed) {
      const n = (remaining.get(k) ?? 0) - 1;
      remaining.set(k, n);
      if (n === 0) queue.push(k);
    }
  };
  for (const r of roots) processNode(r.id, r.target, r.qty);
  const order: string[] = [];
  while (queue.length > 0) {
    const key = queue.shift() as string;
    const node = autoNodes.get(key);
    if (!node) continue;
    order.push(key);
    let summed = 0;
    let onceMax = 0;
    for (const e of incoming.get(key) ?? []) {
      if (e.once) onceMax = Math.max(onceMax, e.qty);
      else summed += e.qty;
    }
    node.qty = summed + onceMax;
    const prev = prevById.get(node.id);
    const eff = node.qty > 0 ? (prev?.overriddenQty ?? node.qty) : 0;
    processNode(node.id, node.target, eff);
  }

  // 3. Build lines.
  const lines: BookingLine[] = [...manual];
  const autoIds = new Set<Id>();
  for (const key of order) {
    const node = autoNodes.get(key);
    if (!node || node.qty <= 0) continue;
    const ins = incoming.get(key) ?? [];
    const prev = prevById.get(node.id);
    const line: BookingLine = {
      ...(prev ?? {}),
      id: node.id,
      target: node.target as LineTarget,
      qty: node.qty,
      origin: 'auto',
      parentLineIds: [...new Set(ins.map((e) => e.from))],
      status: prev?.status ?? 'ok',
      conflictAck: prev?.conflictAck ?? false,
    };
    const orEdge = ins.find((e) => e.orGroupKey);
    delete line.orGroupKey;
    delete line.orChoice;
    if (orEdge?.orGroupKey) line.orGroupKey = orEdge.orGroupKey;
    if (orEdge?.orChoice) line.orChoice = orEdge.orChoice;
    lines.push(line);
    autoIds.add(node.id);
  }
  // Overridden auto lines whose parents all disappeared become manual lines with a note.
  for (const p of previous) {
    if (p.origin !== 'auto' || autoIds.has(p.id) || p.overriddenQty === undefined) continue;
    if (suppressed[p.id] !== undefined) continue;
    const kept: BookingLine = {
      ...p,
      id: `kept:${p.id.slice('auto:'.length)}`,
      origin: 'manual',
      qty: p.overriddenQty,
      parentLineIds: [],
      note: p.note ?? ORPHANED_NOTE,
    };
    delete kept.overriddenQty;
    delete kept.orGroupKey;
    delete kept.orChoice;
    if (!lines.some((l) => l.id === kept.id)) lines.push(kept);
  }

  const lineIds = new Set(lines.map((l) => l.id));
  const orList = [...orInfos.values()].filter((o) => lineIds.has(o.parentLineId));
  return {
    lines,
    orChoices: orList,
    openOrChoices: orList.filter((o) => o.open),
    checkWarnings: collectCheckWarnings(lines, catalog, options.dismissedChecks ?? []),
    recommendations: collectRecommendations(lines, catalog, options.dismissedRecommendations ?? []),
    cycleWarnings,
  };
}

/** Note put on an overridden auto line that lost all its parents and became manual. */
export const ORPHANED_NOTE = 'auto-orphaned';

/** Item quantities on the list, counting case contents. */
export function itemTotals(lines: BookingLine[], catalog: CatalogView): Map<Id, number> {
  const m = new Map<Id, number>();
  for (const l of lines) {
    if (l.status !== 'ok') continue;
    const qty = effectiveQty(l);
    if (isExternal(l.target)) {
      const id = l.target.external.itemId;
      if (id) m.set(id, (m.get(id) ?? 0) + qty);
      continue;
    }
    for (const c of nodeContents(catalog, l.target, qty))
      m.set(c.itemId, (m.get(c.itemId) ?? 0) + c.qty);
  }
  return m;
}

function targetsOnList(lines: BookingLine[], catalog: CatalogView): Set<string> {
  const keys = new Set<string>();
  for (const l of lines) {
    if (l.status !== 'ok') continue;
    if (isExternal(l.target)) {
      if (l.target.external.itemId) keys.add(`item:${l.target.external.itemId}`);
      continue;
    }
    keys.add(targetKey(l.target));
    if (isCaseTarget(l.target)) {
      for (const c of nodeContents(catalog, l.target, 1)) keys.add(`item:${c.itemId}`);
    }
  }
  return keys;
}

/** "Máš aspoň jeden z těchto?" — warn when none of a check group's targets is on the list. */
export function collectCheckWarnings(
  lines: BookingLine[],
  catalog: CatalogView,
  dismissed: string[],
): CheckWarning[] {
  const totals = itemTotals(lines, catalog);
  const onList = targetsOnList(lines, catalog);
  const groups = new Map<string, { fromItemId: Id; conns: Connection[] }>();
  for (const c of catalog.connections) {
    if (c.kind !== 'check' || !totals.has(c.fromItemId)) continue;
    const key = `${c.fromItemId}:${c.groupId ?? 'check'}`;
    const g = groups.get(key) ?? { fromItemId: c.fromItemId, conns: [] };
    g.conns.push(c);
    groups.set(key, g);
  }
  const out: CheckWarning[] = [];
  for (const [key, g] of groups) {
    if (dismissed.includes(key)) continue;
    if (g.conns.some((c) => onList.has(targetKey(c.target)))) continue;
    const parentQty = totals.get(g.fromItemId) ?? 0;
    out.push({
      key,
      fromItemId: g.fromItemId,
      candidates: g.conns.map((c) => ({ target: c.target, qty: ruleQty(c, parentQty) })),
    });
  }
  return out;
}

/** "Mohlo by se hodit" — deduplicated, excluding what is on the list or dismissed. */
export function collectRecommendations(
  lines: BookingLine[],
  catalog: CatalogView,
  dismissed: string[],
): Recommendation[] {
  const totals = itemTotals(lines, catalog);
  const onList = targetsOnList(lines, catalog);
  const recs = new Map<string, Recommendation>();
  for (const c of catalog.connections) {
    if (c.kind !== 'recommended' || !totals.has(c.fromItemId)) continue;
    const key = targetKey(c.target);
    if (onList.has(key) || dismissed.includes(key)) continue;
    const qty = ruleQty(c, totals.get(c.fromItemId) ?? 0);
    const r = recs.get(key);
    if (r) {
      if (!r.forItemIds.includes(c.fromItemId)) r.forItemIds.push(c.fromItemId);
      r.qty = Math.max(r.qty, qty);
    } else {
      recs.set(key, { target: c.target, key, qty, forItemIds: [c.fromItemId] });
    }
  }
  return [...recs.values()];
}

/** Items that point at `target` ("used by" reverse view). */
export function usedBy(catalog: CatalogView, target: Target): Connection[] {
  const key = targetKey(target);
  return catalog.connections.filter((c) => targetKey(c.target) === key);
}

/**
 * Parse a "try it" query like `LEDBeam ×10` or `ledbeam x 10`: returns the item whose name
 * best matches and the quantity (default 1).
 */
export function parseTryQuery(
  catalog: Pick<CatalogView, 'items'>,
  query: string,
): { itemId: Id; qty: number } | undefined {
  const m = /^(.*?)(?:\s*[×x*]\s*(\d+))?\s*$/i.exec(query.trim());
  if (!m) return undefined;
  const name = (m[1] ?? '').trim().toLowerCase();
  const qty = m[2] ? Number(m[2]) : 1;
  if (!name) return undefined;
  const items = catalog.items.filter((i) => !i.archived);
  const exact = items.find((i) => i.name.toLowerCase() === name);
  const hit = exact ?? items.find((i) => i.name.toLowerCase().includes(name));
  return hit ? { itemId: hit.id, qty } : undefined;
}
