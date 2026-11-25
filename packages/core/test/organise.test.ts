/** Organising a booking's list: nesting, groups, counts that follow a check. */
import { describe, expect, it } from 'vitest';
import {
  addCheckCandidate,
  addGroup,
  addLine,
  bookingPriceTotal,
  canNest,
  cleanOrganisation,
  conflictOverview,
  coverWithExternal,
  descendants,
  evaluateBooking,
  flattenNodes,
  followAgain,
  groupOfLine,
  lineTree,
  moveGroup,
  moveToGroup,
  nestedByHand,
  nestLine,
  nextLineId,
  packingList,
  recalcBooking,
  removeGroup,
  removeLine,
  renameGroup,
  sameExceptOrganisation,
  saveBooking,
  setLineQty,
  splitLine,
  unnestLine,
  unwrap,
  type Booking,
} from '../src';
import { baseState, bk, order, TODAY as T, U, W, withBookings } from './helpers';

const s = baseState();
const empty = () => bk({ id: 'd1' });
const add = (b: Booking, itemId: string, qty = 1, o = {}) => addLine(s, b, { itemId }, qty, o);
const find = (b: Booking, itemId: string) =>
  b.lines.find((l) => 'itemId' in l.target && l.target.itemId === itemId)!;
const idOf = (b: Booking, itemId: string) => find(b, itemId).id;
/** Tree as indented text, one array per group. */
const shape = (b: Booking) =>
  lineTree(b).map((g) => [
    g.group?.name ?? '-',
    ...flattenNodes(g.roots).map(
      (n) =>
        `${'>'.repeat(n.depth)}${'itemId' in n.line.target ? n.line.target.itemId : 'caseTypeId' in n.line.target ? n.line.target.caseTypeId : n.line.target.external.name}`,
    ),
  ]);

describe('nesting', () => {
  const base = () => add(add(add(empty(), 'hazer'), 'lamp'), 'par', 0);

  it('required lines stay under the line that needs them, others are top level', () => {
    const b = add(add(empty(), 'rogue', 2), 'hazer');
    expect(shape(b)).toEqual([['-', 'rogue', '>clamp', '>desk', '>>deskpower', 'hazer']]);
  });

  it('a line nests under any other, children travel along, un-nesting brings it back', () => {
    let b = base();
    b = nestLine(s, b, idOf(b, 'lamp'), idOf(b, 'hazer'));
    b = nestLine(s, b, idOf(b, 'hazer'), idOf(b, 'par'));
    expect(shape(b)).toEqual([['-', 'par', '>hazer', '>>lamp']]);
    expect(descendants(b, idOf(b, 'par')).map((l) => l.id)).toHaveLength(2);
    b = unnestLine(b, idOf(b, 'hazer'));
    expect(shape(b)).toEqual([['-', 'hazer', '>lamp', 'par']]);
    expect(unnestLine(b, idOf(b, 'hazer'))).toBe(b);
  });

  it('never under itself, its own child or something unknown', () => {
    let b = base();
    const [hazer, lamp] = [idOf(b, 'hazer'), idOf(b, 'lamp')];
    b = nestLine(s, b, lamp, hazer);
    expect([canNest(b, hazer, lamp), canNest(b, hazer, hazer), canNest(b, hazer, 'x')]).toEqual([
      false,
      false,
      false,
    ]);
    expect(nestLine(s, b, hazer, lamp)).toBe(b);
  });

  it('a loop in stored data is cut, every line is still shown once', () => {
    const b = base();
    const [a, z] = [idOf(b, 'hazer'), idOf(b, 'lamp')];
    const loop = {
      ...b,
      lines: b.lines.map((l) =>
        l.id === a ? { ...l, nestedUnder: z } : l.id === z ? { ...l, nestedUnder: a } : l,
      ),
    };
    expect(shape(loop).flat()).toHaveLength(1 + loop.lines.length);
    expect(shape(cleanOrganisation(loop)).flat()).toHaveLength(1 + loop.lines.length);
  });

  it('a required line cannot leave; a shared one moves between those that need it', () => {
    let b = add(add(add(empty(), 'ledbeam', 1), 'rogue', 1), 'hazer');
    const desk = idOf(b, 'desk');
    expect(shape(b)[0]).toContain('>desk');
    expect(canNest(b, desk, idOf(b, 'hazer'))).toBe(false);
    expect(moveToGroup(b, desk)).toBe(b);
    expect(unnestLine(b, desk)).toBe(b);
    b = nestLine(s, b, desk, idOf(b, 'rogue'));
    const [only] = lineTree(b);
    const under = (id: string) =>
      only!.roots.find((r) => r.line.id === id)!.children.map((c) => c.line.id);
    expect(under(idOf(b, 'rogue'))).toContain(desk);
    expect(under(idOf(b, 'ledbeam'))).not.toContain(desk);
    // kept through recalculation, dropped when that line no longer needs it
    b = setLineQty(s, b, idOf(b, 'ledbeam'), 3);
    expect(find(b, 'desk').nestedUnder).toBe(idOf(b, 'rogue'));
    b = removeLine(s, b, idOf(b, 'rogue'));
    expect(flattenNodes(lineTree(b)[0]!.roots).find((n) => n.line.id === desk)?.depth).toBe(1);
  });

  it('a manual line may hang under a required one', () => {
    let b = add(add(empty(), 'rogue', 1), 'adapter');
    b = nestLine(s, b, idOf(b, 'adapter'), idOf(b, 'desk'));
    expect(shape(b)).toEqual([['-', 'rogue', '>clamp', '>desk', '>>adapter', '>>deskpower']]);
  });

  it('adding merges only into the same place', () => {
    let b = add(add(empty(), 'hazer'), 'adapter', 2);
    b = add(b, 'adapter', 3, { nestedUnder: idOf(b, 'hazer') });
    b = add(b, 'adapter', 1);
    expect(
      b.lines
        .filter((l) => 'itemId' in l.target && l.target.itemId === 'adapter')
        .map((l) => [l.qty, l.nestedUnder]),
    ).toEqual([
      [3, undefined],
      [3, idOf(b, 'hazer')],
    ]);
  });

  it('a new line never inherits children of a removed one', () => {
    let b = base();
    b = {
      ...b,
      lines: b.lines.map((l) => (l.id === idOf(b, 'lamp') ? { ...l, nestedUnder: 'd1-l4' } : l)),
    };
    expect(nextLineId(b)).toBe('d1-l5');
  });

  it('a parent that became "kept" keeps its children', () => {
    let b = add(add(empty(), 'ledbeam', 4), 'adapter');
    b = nestLine(s, b, idOf(b, 'adapter'), 'auto:item:rope');
    b = setLineQty(s, b, 'auto:item:rope', 9);
    b = { ...b, lines: b.lines.filter((l) => l.id !== idOf(b, 'ledbeam')) };
    b = recalcBooking(s, b).booking;
    expect(shape(b)).toEqual([['-', 'rope', '>adapter']]);
    expect(find(cleanOrganisation(b), 'adapter').nestedUnder).toBe('kept:item:rope');
  });
});

describe('removing a line with children', () => {
  const tree = () => {
    let b = add(add(add(add(empty(), 'par', 0), 'rogue', 1), 'hazer'), 'lamp');
    b = nestLine(s, b, idOf(b, 'rogue'), idOf(b, 'par'));
    b = nestLine(s, b, idOf(b, 'hazer'), idOf(b, 'rogue'));
    b = nestLine(s, b, idOf(b, 'lamp'), 'auto:item:desk');
    return b;
  };

  it('keep: they move one level up, also those under its required items', () => {
    const b = tree();
    expect(nestedByHand(b, idOf(b, 'rogue'))).toHaveLength(2);
    const r = removeLine(s, b, idOf(b, 'rogue'));
    expect(shape(r)).toEqual([['-', 'par', '>hazer', '>lamp']]);
  });

  it('remove: everything below goes', () => {
    const b = tree();
    const r = removeLine(s, b, idOf(b, 'rogue'), undefined, 'remove');
    expect(shape(r)).toEqual([['-', 'par']]);
  });

  it('remove leaves what hangs on a shared required item that stays', () => {
    let b = add(tree(), 'ledbeam', 1);
    b = removeLine(s, b, idOf(b, 'rogue'), undefined, 'remove');
    expect(b.lines.some((l) => l.id === idOf(b, 'lamp'))).toBe(true);
    expect(find(b, 'lamp').nestedUnder).toBe('auto:item:desk');
  });

  it('a required line removed by the Chief lets its children go one level up', () => {
    const b = removeLine(s, tree(), 'auto:item:desk', 'máme vlastní');
    expect(shape(b)).toEqual([['-', 'par', '>rogue', '>>hazer', '>>lamp', '>>clamp']]);
  });

  it('in a group the children stay in that group', () => {
    const g = addGroup(tree(), 'Audio');
    let b = moveToGroup(g.booking, idOf(g.booking, 'par'), g.groupId);
    b = removeLine(s, b, idOf(b, 'par'));
    expect(shape(b)[0]).toEqual([
      'Audio',
      'rogue',
      '>hazer',
      '>clamp',
      '>desk',
      '>>lamp',
      '>>deskpower',
    ]);
  });
});

describe('groups', () => {
  const two = () => {
    const a = addGroup(add(add(empty(), 'hazer'), 'lamp'), '  Dekorace ');
    const z = addGroup(a.booking, 'Audio raw');
    return { b: z.booking, deco: a.groupId!, audio: z.groupId! };
  };

  it('are named, ordered, renamed; empty names are refused', () => {
    const { b, deco, audio } = two();
    expect(shape(b).map((g) => g[0])).toEqual(['Dekorace', 'Audio raw', '-']);
    expect(addGroup(b, '  ').groupId).toBeUndefined();
    expect(renameGroup(b, deco, ' ')).toBe(b);
    expect(shape(renameGroup(b, deco, 'Výzdoba'))[0]).toEqual(['Výzdoba']);
    expect(shape(moveGroup(b, audio, -1)).map((g) => g[0])).toEqual(['Audio raw', 'Dekorace', '-']);
    expect(moveGroup(b, deco, -1)).toBe(b);
  });

  it('a line moves in with its children; nested lines show the group of their parent', () => {
    const g = two();
    let b = nestLine(s, g.b, idOf(g.b, 'lamp'), idOf(g.b, 'hazer'));
    b = moveToGroup(b, idOf(b, 'hazer'), g.deco);
    expect(shape(b)).toEqual([['Dekorace', 'hazer', '>lamp'], ['Audio raw'], ['-']]);
    expect(groupOfLine(b, idOf(b, 'lamp'))?.name).toBe('Dekorace');
    // un-nesting keeps it in the group, moving to another group takes it out of the parent
    expect(shape(unnestLine(b, idOf(b, 'lamp')))[0]).toEqual(['Dekorace', 'hazer', 'lamp']);
    expect(shape(moveToGroup(b, idOf(b, 'lamp'), g.audio))).toEqual([
      ['Dekorace', 'hazer'],
      ['Audio raw', 'lamp'],
      ['-'],
    ]);
    expect(moveToGroup(b, idOf(b, 'lamp'), 'nope')).toBe(b);
  });

  it('deleting a group never deletes its lines', () => {
    const g = two();
    let b = moveToGroup(g.b, idOf(g.b, 'hazer'), g.deco);
    b = removeGroup(b, g.deco);
    expect(shape(b)).toEqual([['Audio raw'], ['-', 'hazer', 'lamp']]);
  });

  it('the packing list names the group of every line', () => {
    const g = two();
    let b = add(moveToGroup(g.b, idOf(g.b, 'hazer'), g.deco), 'rogue', 1, { groupId: g.audio });
    b = { ...b, type: 'order', status: 'packing' };
    const lines = packingList(withBookings(s, b), b.id)!.byWarehouse.flatMap((w) =>
      w.groups.flatMap((x) => x.lines),
    );
    const of = (itemId: string) => lines.find((l) => l.itemId === itemId)?.group?.name;
    expect([of('hazer'), of('clamp'), of('deskpower'), of('lamp')]).toEqual([
      'Dekorace',
      'Audio raw',
      'Audio raw',
      undefined,
    ]);
  });
});

describe('count that follows a check', () => {
  const checked = (qty = 10) =>
    addCheckCandidate(s, add(empty(), 'ledbeam', qty), 'ledbeam', { itemId: 'powercon' }, qty);
  const qtyOf = (b: Booking) => find(b, 'powercon').qty;

  it('is added under the item that asked and answers the check', () => {
    const b = checked();
    expect(find(b, 'powercon')).toMatchObject({ nestedUnder: idOf(b, 'ledbeam'), qty: 10 });
    expect(recalcBooking(s, b).expansion.checkWarnings).toEqual([]);
  });

  it('10 → 4 follows; a typed count stays; it can follow again', () => {
    let b = checked();
    b = setLineQty(s, b, idOf(b, 'ledbeam'), 4);
    expect(qtyOf(b)).toBe(4);
    b = setLineQty(s, b, idOf(b, 'powercon'), 6);
    b = setLineQty(s, b, idOf(b, 'ledbeam'), 8);
    expect(qtyOf(b)).toBe(6);
    b = followAgain(s, b, idOf(b, 'powercon'));
    expect(qtyOf(b)).toBe(8);
  });

  it('keeps the last count while the item is being retyped or gone', () => {
    let b = checked();
    b = setLineQty(s, b, idOf(b, 'ledbeam'), 0);
    expect(qtyOf(b)).toBe(10);
    b = setLineQty(s, b, idOf(b, 'ledbeam'), 2);
    expect(qtyOf(b)).toBe(2);
    b = removeLine(s, b, idOf(b, 'ledbeam'));
    expect(find(b, 'powercon')).toMatchObject({ qty: 2 });
    expect(find(b, 'powercon')).not.toHaveProperty('followsCheck');
  });

  it('counts case contents and uses the rule of the check', () => {
    let b = addLine(s, empty(), { caseTypeId: 'ct-ax9' }, 2);
    b = addCheckCandidate(s, b, 'ax9', { itemId: 'powercon' }, 4);
    const theCase = b.lines.find((l) => 'caseTypeId' in l.target)!;
    expect(find(b, 'powercon')).toMatchObject({ nestedUnder: theCase.id, qty: 4 });
    expect(qtyOf(setLineQty(s, b, theCase.id, 1))).toBe(2);
  });

  it('stops following when moved elsewhere, not when moved to the same item', () => {
    let b = add(checked(), 'hazer');
    const pc = idOf(b, 'powercon');
    expect(
      nestLine(s, b, pc, idOf(b, 'ledbeam')).lines.find((l) => l.id === pc)?.followsCheck,
    ).toBeTruthy();
    b = nestLine(s, b, pc, idOf(b, 'hazer'));
    b = setLineQty(s, b, idOf(b, 'ledbeam'), 3);
    expect(qtyOf(b)).toBe(10);
  });

  it('splitting to another warehouse counts as changed by hand', () => {
    let b = checked();
    b = splitLine(s, b, idOf(b, 'powercon'), 4, W.karlak);
    expect(
      b.lines
        .filter((l) => 'itemId' in l.target && l.target.itemId === 'powercon')
        .map((l) => [l.qty, l.nestedUnder]),
    ).toEqual([
      [6, idOf(b, 'ledbeam')],
      [4, idOf(b, 'ledbeam')],
    ]);
  });

  it('an external line takes the place of the line it covers, with its children', () => {
    let b = add(checked(2), 'hazer');
    b = nestLine(s, b, idOf(b, 'hazer'), idOf(b, 'powercon'));
    b = coverWithExternal(s, b, idOf(b, 'powercon'), 2, {
      supplier: 'Rent',
      pickup: T,
      returnDate: T,
    });
    const ext = b.lines.find((l) => 'external' in l.target)!;
    expect(ext.nestedUnder).toBe(idOf(b, 'ledbeam'));
    expect(find(b, 'hazer').nestedUnder).toBe(ext.id);
  });
});

describe('organisation only', () => {
  const organised = () => {
    let b = add(add(add(empty(), 'ledbeam', 14), 'hazer'), 'lamp', 2);
    const before = b;
    const g = addGroup(b, 'Světla');
    b = moveToGroup(g.booking, idOf(b, 'ledbeam'), g.groupId);
    b = nestLine(s, b, idOf(b, 'hazer'), idOf(b, 'ledbeam'));
    return { before, b };
  };

  it('changes neither price, availability nor conflicts', () => {
    const { before, b } = organised();
    expect(sameExceptOrganisation(before, b)).toBe(true);
    expect(bookingPriceTotal(s, b)).toBe(bookingPriceTotal(s, before));
    expect(evaluateBooking(s, b)).toEqual(evaluateBooking(s, before));
    const overview = (x: Booking) =>
      conflictOverview(withBookings(s, { ...x, status: 'submitted' }), T);
    expect(overview(b)).toEqual(overview(before));
    expect(sameExceptOrganisation(before, setLineQty(s, b, idOf(b, 'lamp'), 3))).toBe(false);
  });

  it('regrouping an order being packed does not alarm the warehouse, a real change does', () => {
    const o = recalcBooking(s, {
      ...order({ id: 'o1', status: 'packing' }),
      lines: add(add(empty(), 'hazer'), 'lamp').lines,
    }).booking;
    const st = withBookings(s, o);
    const alarms = (x: Booking) =>
      unwrap(saveBooking(st, U.tomas, T, x)).notifications.filter(
        (n) => n.type === 'order_edited_after_packing',
      ).length;
    const g = addGroup(o, 'Efekty');
    const grouped = moveToGroup(g.booking, idOf(o, 'hazer'), g.groupId);
    expect(alarms(nestLine(s, grouped, idOf(o, 'lamp'), idOf(o, 'hazer')))).toBe(0);
    expect(alarms(setLineQty(s, grouped, idOf(o, 'lamp'), 5))).toBeGreaterThan(0);
  });

  it('saving stores groups and drops references that lead nowhere', () => {
    const g = addGroup(add(add(empty(), 'hazer'), 'lamp'), 'Efekty');
    const st = withBookings(s, empty());
    const saved = unwrap(
      saveBooking(st, U.petr, T, {
        ...g.booking,
        groups: [...g.booking.groups!, { id: 'x', name: ' ' }],
        lines: g.booking.lines.map((l, i) =>
          i === 0 ? { ...l, groupId: 'unknown' } : { ...l, nestedUnder: 'unknown' },
        ),
      }),
    ).bookings[0]!;
    expect(saved.groups?.map((x) => x.name)).toEqual(['Efekty']);
    for (const l of saved.lines) {
      expect(l).not.toHaveProperty('groupId');
      expect(l).not.toHaveProperty('nestedUnder');
    }
    // data saved before groups existed
    expect(unwrap(saveBooking(st, U.petr, T, empty())).bookings[0]).not.toHaveProperty('groups');
  });
});
