/**
 * Stage calculator: from the size a PM needs (millimetres, width × depth) it works out how many
 * decks make it, with legs, skirts, rails and stairs, and compares that with what is free for the
 * booking's dates. Parts are catalogue items marked with `Item.stage`.
 */
import { buildHoldIndex, filterFor, minFreeInWarehouse } from '../availability';
import { itemTotals, ruleQty } from '../expansion';
import { addLine, chooseOr, recalcBooking } from '../lifecycle/edit';
import { addGroup } from '../lifecycle/organise';
import type { AppState, Booking, Id, Item, StagePart } from '../types';
import { isItemTarget } from '../util';

/** Legs a deck stands on when the catalogue does not say. */
export const LEGS_PER_DECK = 4;
/** Largest side accepted, in millimetres. */
export const STAGE_MAX_MM = 100_000;

export interface StageSize {
  widthMm: number;
  depthMm: number;
}

/** "6000*4000", "6000 x 4000", "6 000 × 4 000 mm" → width and depth; undefined when not a size. */
export function parseStageSize(text: string): StageSize | undefined {
  const m = /^(\d+)[*x×](\d+)(mm)?$/i.exec(text.replace(/\s+/g, ''));
  if (!m) return undefined;
  const widthMm = Number(m[1]);
  const depthMm = Number(m[2]);
  if (!(widthMm > 0 && depthMm > 0 && widthMm <= STAGE_MAX_MM && depthMm <= STAGE_MAX_MM))
    return undefined;
  return { widthMm, depthMm };
}

type Part<P extends StagePart['part']> = Item & { stage: StagePart & { part: P } };

export interface StageParts {
  decks: Part<'deck'>[];
  legs: Part<'leg'>[];
  rails: Part<'rail'>[];
  skirts: Part<'skirt'>[];
  stairs: Part<'stairs'>[];
}

/** Catalogue items marked as stage parts (archived ones left out); legs from the lowest. */
export function stageParts(state: Pick<AppState, 'items'>): StageParts {
  const live = state.items.filter((i) => !i.archived && i.stage);
  const of = <P extends StagePart['part']>(p: P) =>
    live.filter((i): i is Part<P> => i.stage?.part === p) as Part<P>[];
  return {
    decks: of('deck'),
    legs: of('leg').sort((a, b) => a.stage.heightMm - b.stage.heightMm),
    rails: of('rail'),
    skirts: of('skirt'),
    stairs: of('stairs'),
  };
}

/** A deck placed on the plan, millimetres from the back left corner. */
export interface DeckRect {
  x: number;
  y: number;
  w: number;
  d: number;
}

export interface StageLayout extends StageSize {
  decks: number;
  rects: DeckRect[];
}

/** Grid of `cols × rows` decks of one orientation. */
function grid(cols: number, rows: number, w: number, d: number): StageLayout {
  const rects: DeckRect[] = [];
  for (let r = 0; r < rows; r += 1)
    for (let c = 0; c < cols; c += 1) rects.push({ x: c * w, y: r * d, w, d });
  return { widthMm: cols * w, depthMm: rows * d, decks: cols * rows, rects };
}

/**
 * Stage of `u × v` units of the deck's short side, decks lying along the side divisible by `k`.
 * The caller makes sure one of them is.
 */
function unitLayout(u: number, v: number, unit: number, k: number): StageLayout {
  return k > 1 && u % k !== 0 ? grid(u, v / k, unit, unit * k) : grid(u / k, v, unit * k, unit);
}

const roundTo = (n: number, k: number, how: 'up' | 'down') =>
  how === 'up' ? Math.ceil(n / k) * k : Math.floor(n / k) * k;

/**
 * Units of the deck's short side, when its long side is a whole number of them (2×1 m, 1×1 m):
 * then the decks can lie both ways on one stage, and a stage of `u × v` units can be built when
 * `k` divides one of the sides.
 */
function unitPlan(size: StageSize, deck: StageSize, how: 'up' | 'down') {
  const unit = Math.min(deck.widthMm, deck.depthMm);
  const long = Math.max(deck.widthMm, deck.depthMm);
  if (long % unit !== 0) return undefined;
  const k = long / unit;
  const u = how === 'up' ? Math.ceil(size.widthMm / unit) : Math.floor(size.widthMm / unit);
  const v = how === 'up' ? Math.ceil(size.depthMm / unit) : Math.floor(size.depthMm / unit);
  return { unit, k, u, v };
}

/** Is `u × v` units buildable with decks `k` units long? */
const buildable = (u: number, v: number, k: number) =>
  u > 0 && v > 0 && (u % k === 0 || v % k === 0);

/**
 * The nearest stage that can be built from decks: `up` covers at least the size asked for, with
 * as few decks as possible; `down` fits into it, as big as possible. Undefined when no deck fits.
 */
export function deckLayout(
  size: StageSize,
  deck: StageSize,
  how: 'up' | 'down',
): StageLayout | undefined {
  const p = unitPlan(size, deck, how);
  if (p) {
    const { unit, k, u, v } = p;
    if (buildable(u, v, k)) return unitLayout(u, v, unit, k);
    // grow (or shrink) one side to a whole number of decks, whichever changes the stage less
    const options = [
      [roundTo(u, k, how), v],
      [u, roundTo(v, k, how)],
    ].filter(([a, b]) => buildable(a!, b!, k));
    const best = options.sort((a, b) =>
      how === 'up' ? a[0]! * a[1]! - b[0]! * b[1]! : b[0]! * b[1]! - a[0]! * a[1]!,
    )[0];
    return best ? unitLayout(best[0]!, best[1]!, unit, k) : undefined;
  }
  // decks that cannot be mixed: one orientation for the whole stage
  const round = how === 'up' ? Math.ceil : Math.floor;
  const ways = [
    [deck.widthMm, deck.depthMm],
    [deck.depthMm, deck.widthMm],
  ]
    .map(([w, d]) => grid(round(size.widthMm / w!), round(size.depthMm / d!), w!, d!))
    .filter((l) => l.decks > 0);
  ways.sort((a, b) =>
    how === 'up'
      ? a.decks - b.decks || a.widthMm * a.depthMm - b.widthMm * b.depthMm
      : b.widthMm * b.depthMm - a.widthMm * a.depthMm,
  );
  return ways[0];
}

/** The biggest stage no larger than `size` made of at most `maxDecks` decks; deeper first. */
export function largestStage(
  size: StageSize,
  deck: StageSize,
  maxDecks: number,
): StageLayout | undefined {
  if (maxDecks <= 0) return undefined;
  const p = unitPlan(size, deck, 'down');
  let best: StageLayout | undefined;
  const better = (l: StageLayout) =>
    !best ||
    l.widthMm * l.depthMm > best.widthMm * best.depthMm ||
    (l.widthMm * l.depthMm === best.widthMm * best.depthMm && l.depthMm > best.depthMm);
  if (p) {
    for (let v = p.v; v >= 1; v -= 1)
      for (let u = p.u; u >= 1; u -= 1) {
        if (!buildable(u, v, p.k) || (u * v) / p.k > maxDecks) continue;
        const l = unitLayout(u, v, p.unit, p.k);
        if (better(l)) best = l;
      }
    return best;
  }
  for (const [w, d] of [
    [deck.widthMm, deck.depthMm],
    [deck.depthMm, deck.widthMm],
  ]) {
    const rows = Math.floor(size.depthMm / d!);
    for (let r = rows; r >= 1; r -= 1) {
      const cols = Math.min(Math.floor(size.widthMm / w!), Math.floor(maxDecks / r));
      if (cols < 1) continue;
      const l = grid(cols, r, w!, d!);
      if (better(l)) best = l;
    }
  }
  return best;
}

export interface StageInput extends StageSize {
  deckId: Id;
  legId?: Id;
  /** Skirt along the front and both sides. */
  skirt: boolean;
  /** Rail along the back and both sides. */
  rail: boolean;
  stairs: number;
  /** Take the nearest bigger (default) or smaller stage when the size is not whole decks. */
  round?: 'up' | 'down';
}

export interface StageNeed {
  itemId: Id;
  role: 'deck' | 'leg' | 'rail' | 'skirt' | 'stairs';
  qty: number;
  /** Free for the booking's dates, all warehouses together (other bookings taken off). */
  free: number;
  /** Already on this booking. */
  onBooking: number;
  /** Comes with the decks by itself (catalogue connection). */
  auto: boolean;
}

export interface StagePlan {
  layout: StageLayout;
  /** The size asked for is not whole decks: the other nearest stage. */
  other?: StageLayout;
  needs: StageNeed[];
  /** Not enough decks or legs: the biggest stage that is free. */
  fits?: StageLayout;
}

/** Connection that brings the leg with the deck (also as one option of "this or that"). */
function legConnection(state: AppState, deckId: Id, legId: Id) {
  return state.connections.find(
    (c) =>
      c.kind === 'required' &&
      c.fromItemId === deckId &&
      isItemTarget(c.target) &&
      c.target.itemId === legId,
  );
}

/** What the stage needs, and how much of it is free for the booking. */
export function planStage(
  state: AppState,
  booking: Booking,
  input: StageInput,
): StagePlan | undefined {
  const parts = stageParts(state);
  const deck = parts.decks.find((d) => d.id === input.deckId);
  if (!deck) return undefined;
  const how = input.round ?? 'up';
  const layout = deckLayout(input, deck.stage, how);
  if (!layout) return undefined;
  const otherWay = deckLayout(input, deck.stage, how === 'up' ? 'down' : 'up');
  const exact = layout.widthMm === input.widthMm && layout.depthMm === input.depthMm;
  const idx = buildHoldIndex(state, filterFor(booking));
  const totals = itemTotals(
    booking.lines.filter((l) => !l.late),
    state,
  );
  const need = (itemId: Id, role: StageNeed['role'], qty: number, auto = false): StageNeed => ({
    itemId,
    role,
    qty,
    free: state.warehouses.reduce(
      (n, w) => n + minFreeInWarehouse(state, booking, { itemId }, w.id, idx),
      0,
    ),
    onBooking: totals.get(itemId) ?? 0,
    auto,
  });
  const needs: StageNeed[] = [need(deck.id, 'deck', layout.decks)];
  const leg = parts.legs.find((l) => l.id === input.legId);
  let legsPerDeck = 0;
  if (leg) {
    const c = legConnection(state, deck.id, leg.id);
    legsPerDeck = c ? ruleQty(c, 1) : LEGS_PER_DECK;
    needs.push(
      need(leg.id, 'leg', c ? ruleQty(c, layout.decks) : layout.decks * LEGS_PER_DECK, !!c),
    );
  }
  // the front is the width: the skirt hides the front and sides, the rail guards back and sides
  const edge = layout.widthMm + 2 * layout.depthMm;
  const skirt = parts.skirts[0];
  if (input.skirt && skirt)
    needs.push(need(skirt.id, 'skirt', Math.ceil(edge / skirt.stage.lengthMm)));
  const rail = parts.rails[0];
  if (input.rail && rail) needs.push(need(rail.id, 'rail', Math.ceil(edge / rail.stage.lengthMm)));
  const stairs = parts.stairs[0];
  if (input.stairs > 0 && stairs) needs.push(need(stairs.id, 'stairs', Math.floor(input.stairs)));

  const spare = (n: StageNeed) => Math.max(0, n.free - n.onBooking);
  const deckNeed = needs[0]!;
  const legNeed = needs.find((n) => n.role === 'leg');
  const maxDecks = Math.min(
    spare(deckNeed),
    legNeed && legsPerDeck > 0 ? Math.floor(spare(legNeed) / legsPerDeck) : Infinity,
  );
  const plan: StagePlan = { layout, needs };
  if (!exact && otherWay) plan.other = otherWay;
  if (maxDecks < layout.decks) {
    const fits = largestStage(input, deck.stage, maxDecks);
    if (fits) plan.fits = fits;
  }
  return plan;
}

/**
 * Put the stage on the booking: its own group named `groupName`, the decks with the chosen legs
 * (picked in the catalogue's "this or that" when the decks bring legs by themselves), then skirts,
 * rails and stairs.
 */
export function addStage(
  state: AppState,
  booking: Booking,
  input: StageInput,
  groupName: string,
): Booking {
  const plan = planStage(state, booking, input);
  if (!plan) return booking;
  const { booking: grouped, groupId } = addGroup(booking, groupName);
  const place = groupId ? { groupId } : {};
  let b = addLine(state, grouped, { itemId: input.deckId }, plan.layout.decks, place);
  const deckLine = b.lines.find(
    (l) =>
      l.origin !== 'auto' &&
      l.groupId === groupId &&
      isItemTarget(l.target) &&
      l.target.itemId === input.deckId,
  );
  const legs = plan.needs.find((n) => n.role === 'leg');
  if (legs && deckLine) {
    if (legs.auto) {
      const or = recalcBooking(state, b).expansion.orChoices.find(
        (o) =>
          o.parentLineId === deckLine.id &&
          o.options.some((x) =>
            x.targets.some((t) => isItemTarget(t.target) && t.target.itemId === legs.itemId),
          ),
      );
      const option = or?.options.find((x) =>
        x.targets.some((t) => isItemTarget(t.target) && t.target.itemId === legs.itemId),
      );
      if (or && option) b = chooseOr(state, b, or.groupKey, option.key);
    } else {
      b = addLine(state, b, { itemId: legs.itemId }, legs.qty, { nestedUnder: deckLine.id });
    }
  }
  for (const n of plan.needs) {
    if (n.role === 'deck' || n.role === 'leg') continue;
    b = addLine(state, b, { itemId: n.itemId }, n.qty, place);
  }
  return b;
}
