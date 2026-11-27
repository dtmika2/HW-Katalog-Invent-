/** Stage calculator: decks, legs, skirts, rails and stairs for a size in millimetres. */
import { describe, expect, it } from 'vitest';
import {
  addStage,
  deckLayout,
  largestStage,
  parseStageSize,
  planStage,
  recalcBooking,
  upsertItem,
  type AppState,
  type Booking,
  type Connection,
  type Item,
  type StageInput,
} from '../src';
import { baseState, bk, ln, item, order, U, W, withBookings } from './helpers';

const DECK = { widthMm: 2000, depthMm: 1000 };

const part = (id: string, stage: Item['stage']): Item => ({
  id,
  name: id,
  manufacturer: 'Test',
  model: id,
  categoryId: 'cat',
  priceDay: 100,
  returnable: true,
  archived: false,
  stage,
});
const legs = (id: string, leg: string): Connection => ({
  id,
  fromItemId: 'deck',
  target: { itemId: leg },
  kind: 'required',
  groupId: 'deck-legs',
  groupMode: 'or',
  rule: 'per_piece',
  qty: 4,
});

/** 10 + 2 decks, 60 low legs, 20 high legs, skirts, rails, stairs; decks bring legs. */
function stageState(connected = true): AppState {
  const s = baseState();
  const st = (itemId: string, w: string, qty: number) => ({
    itemId,
    warehouseId: w,
    qty,
    homeLocationId: w === W.brod ? 'loc-b-a1' : 'loc-k-a1',
  });
  return {
    ...s,
    items: [
      ...s.items,
      part('deck', { part: 'deck', ...DECK }),
      part('leg40', { part: 'leg', heightMm: 400 }),
      part('leg80', { part: 'leg', heightMm: 800 }),
      part('skirt', { part: 'skirt', lengthMm: 2000 }),
      part('rail', { part: 'rail', lengthMm: 2000 }),
      part('stairs', { part: 'stairs' }),
    ],
    stock: [
      ...s.stock,
      st('deck', W.brod, 10),
      st('deck', W.karlak, 2),
      st('leg40', W.brod, 60),
      st('leg80', W.brod, 20),
      st('skirt', W.brod, 20),
      st('rail', W.brod, 12),
      st('stairs', W.brod, 2),
    ],
    connections: connected
      ? [...s.connections, legs('c-l40', 'leg40'), legs('c-l80', 'leg80')]
      : s.connections,
  };
}

const input = (extra: Partial<StageInput> = {}): StageInput => ({
  widthMm: 6000,
  depthMm: 4000,
  deckId: 'deck',
  legId: 'leg40',
  skirt: true,
  rail: true,
  stairs: 1,
  ...extra,
});
const me = (lines: Booking['lines'] = []) => bk({ id: 'me', lines });
const need = (s: AppState, b: Booking, extra: Partial<StageInput> = {}) =>
  Object.fromEntries(planStage(s, b, input(extra))!.needs.map((n) => [n.itemId, n]));

describe('stage size', () => {
  it('is written as width × depth in millimetres, with *, x or ×', () => {
    for (const t of ['6000*4000', '6000 x 4000', '6 000 × 4 000 mm', '6000X4000'])
      expect(parseStageSize(t)).toEqual({ widthMm: 6000, depthMm: 4000 });
    for (const t of ['', 'abc', '6000', '0*4000', '6000*-1', '200000*1000'])
      expect(parseStageSize(t)).toBeUndefined();
  });
});

describe('deck layout', () => {
  it('a size of whole decks is built exactly', () => {
    const l = deckLayout({ widthMm: 6000, depthMm: 4000 }, DECK, 'up')!;
    expect(l).toMatchObject({ widthMm: 6000, depthMm: 4000, decks: 12 });
    expect(l.rects).toHaveLength(12);
  });

  it('decks turn to fit the side that takes them (3 × 2 m from three decks lying in depth)', () => {
    const l = deckLayout({ widthMm: 3000, depthMm: 2000 }, DECK, 'up')!;
    expect(l.decks).toBe(3);
    expect(l.rects.every((r) => r.w === 1000 && r.d === 2000)).toBe(true);
  });

  it('a size that is not whole decks: the nearest bigger and the nearest smaller stage', () => {
    expect(deckLayout({ widthMm: 3000, depthMm: 3000 }, DECK, 'up')).toMatchObject({
      widthMm: 4000,
      depthMm: 3000,
      decks: 6,
    });
    expect(deckLayout({ widthMm: 3000, depthMm: 3000 }, DECK, 'down')).toMatchObject({
      decks: 3,
    });
    expect(deckLayout({ widthMm: 6500, depthMm: 4200 }, DECK, 'up')).toMatchObject({
      widthMm: 8000,
      depthMm: 5000,
      decks: 20,
    });
    expect(deckLayout({ widthMm: 6500, depthMm: 4200 }, DECK, 'down')).toMatchObject({
      widthMm: 6000,
      depthMm: 4000,
      decks: 12,
    });
    expect(deckLayout({ widthMm: 800, depthMm: 800 }, DECK, 'down')).toBeUndefined();
  });

  it('decks whose sides do not match are all laid one way, the cheaper one', () => {
    expect(
      deckLayout({ widthMm: 3000, depthMm: 2000 }, { widthMm: 1500, depthMm: 1000 }, 'up'),
    ).toMatchObject({ widthMm: 3000, depthMm: 2000, decks: 4 });
  });

  it('the biggest stage from what is free keeps the depth when it can', () => {
    expect(largestStage({ widthMm: 8000, depthMm: 4000 }, DECK, 12)).toMatchObject({
      widthMm: 6000,
      depthMm: 4000,
    });
    expect(largestStage({ widthMm: 8000, depthMm: 4000 }, DECK, 0)).toBeUndefined();
  });
});

describe('stage plan', () => {
  it('decks with their legs, skirt on the front and sides, rail on the back and sides, stairs', () => {
    const n = need(stageState(), me());
    expect(n.deck).toMatchObject({ qty: 12, free: 12, onBooking: 0 });
    expect(n.leg40).toMatchObject({ qty: 48, free: 60, auto: true });
    expect(n.skirt!.qty).toBe(7);
    expect(n.rail!.qty).toBe(7);
    expect(n.stairs!.qty).toBe(1);
    expect(need(stageState(), me(), { skirt: false, rail: false, stairs: 0 })).not.toHaveProperty(
      'skirt',
    );
  });

  it('what other bookings hold is not free; what this booking has is counted', () => {
    const s = withBookings(stageState(), order({ id: 'o', lines: [ln('l1', item('deck'), 4)] }));
    const b = recalcBooking(s, me([ln('l1', item('deck'), 2)])).booking;
    expect(need(s, b).deck).toMatchObject({ free: 8, onBooking: 2 });
    // 6 decks are left, so the biggest stage of the depth asked for is 3 × 4 m
    expect(planStage(s, b, input())!.fits).toMatchObject({ widthMm: 3000, depthMm: 4000 });
  });

  it('the legs limit the stage too', () => {
    const p = planStage(stageState(), me(), input({ legId: 'leg80' }))!;
    expect(p.needs.find((n) => n.itemId === 'leg80')).toMatchObject({ qty: 48, free: 20 });
    expect(p.fits).toMatchObject({ decks: 5, widthMm: 5000, depthMm: 2000 });
  });

  it('the other nearest stage is offered when the size is not whole decks', () => {
    const p = planStage(stageState(), me(), input({ widthMm: 3000, depthMm: 3000 }))!;
    expect(p.layout.decks).toBe(6);
    expect(p.other?.decks).toBe(3);
    expect(planStage(stageState(), me(), input())!.other).toBeUndefined();
    expect(
      planStage(stageState(), me(), input({ widthMm: 3000, depthMm: 3000, round: 'down' }))!.layout
        .decks,
    ).toBe(3);
  });
});

describe('stage on the booking', () => {
  it('a group of its own; the legs chosen come with the decks', () => {
    const s = stageState();
    const b = recalcBooking(s, addStage(s, me(), input({ legId: 'leg80' }), 'Pódium')).booking;
    const g = b.groups!.find((x) => x.name === 'Pódium')!;
    const qty = (id: string) =>
      b.lines.filter((l) => 'itemId' in l.target && l.target.itemId === id);
    expect(qty('deck')).toMatchObject([{ qty: 12, groupId: g.id }]);
    expect(qty('leg80')).toMatchObject([{ origin: 'auto', qty: 48 }]);
    expect(qty('leg40')).toEqual([]);
    expect(qty('skirt')).toMatchObject([{ qty: 7, groupId: g.id }]);
    expect(qty('rail')).toMatchObject([{ qty: 7, groupId: g.id }]);
    expect(qty('stairs')).toMatchObject([{ qty: 1, groupId: g.id }]);
  });

  it('legs the decks do not bring are put under the decks, four each', () => {
    const s = stageState(false);
    const b = addStage(s, me(), input({ skirt: false, rail: false, stairs: 0 }), 'Pódium');
    const deck = b.lines.find((l) => 'itemId' in l.target && l.target.itemId === 'deck')!;
    expect(b.lines.find((l) => 'itemId' in l.target && l.target.itemId === 'leg40')).toMatchObject({
      qty: 48,
      nestedUnder: deck.id,
    });
  });

  it('stage sizes of an item are whole millimetres', () => {
    const r = upsertItem(stageState(), U.tomas, part('x', { part: 'leg', heightMm: 0 }));
    expect(r).toMatchObject({ ok: false, error: { details: { field: 'stage' } } });
  });
});
