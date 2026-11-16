import { describe, expect, it } from 'vitest';
import { autoLineId, expand, parseTryQuery, usedBy, type BookingLine } from '../src';
import { baseState, caseT, item, ln } from './helpers';

const cat = baseState();
const qtyOf = (lines: BookingLine[], itemId: string) =>
  lines
    .filter((l) => 'itemId' in l.target && l.target.itemId === itemId)
    .reduce((n, l) => n + (l.overriddenQty ?? l.qty), 0);
const auto = (lines: BookingLine[], itemId: string) =>
  lines.find((l) => l.id === autoLineId({ itemId }));

describe('expansion — quantity rules', () => {
  it('per_piece: 10 lights → 10 clamps', () => {
    const r = expand([ln('m1', item('rogue'), 10)], cat);
    expect(qtyOf(r.lines, 'clamp')).toBe(10);
    expect(auto(r.lines, 'clamp')?.origin).toBe('auto');
    expect(auto(r.lines, 'clamp')?.parentLineIds).toEqual(['m1']);
  });

  it('per_n rounds up: 10 lights → 2 splitters (1 per 8)', () => {
    const r = expand([ln('m1', item('ledbeam'), 10)], cat);
    expect(qtyOf(r.lines, 'splitter')).toBe(2);
  });

  it('once_per_order is capped across parents: LEDBeam + Rogue → one desk', () => {
    const r = expand([ln('m1', item('ledbeam'), 10), ln('m2', item('rogue'), 4)], cat);
    expect(qtyOf(r.lines, 'desk')).toBe(1);
    expect(auto(r.lines, 'desk')?.parentLineIds.sort()).toEqual(['m1', 'm2']);
  });

  it('sums per-piece quantities from several parents', () => {
    const r = expand([ln('m1', item('ledbeam'), 10), ln('m2', item('rogue'), 4)], cat);
    expect(qtyOf(r.lines, 'clamp')).toBe(14);
  });

  it('recursion: desk → its own power cable', () => {
    const r = expand([ln('m1', item('ledbeam'), 2)], cat);
    expect(qtyOf(r.lines, 'deskpower')).toBe(1);
    expect(auto(r.lines, 'deskpower')?.parentLineIds).toEqual([autoLineId({ itemId: 'desk' })]);
  });

  it('cycle detected without infinite loop', () => {
    const r = expand([ln('m1', item('cyA'), 1)], cat);
    expect(r.cycleWarnings.length).toBeGreaterThan(0);
    expect(r.cycleWarnings[0]?.path).toEqual(['item:cyA', 'item:cyB', 'item:cyA']);
    expect(qtyOf(r.lines, 'cyB')).toBe(1);
  });

  it('case-type line expands connections of its contents', () => {
    const s = baseState();
    s.connections.push({
      id: 'x',
      fromItemId: 'psu',
      target: { itemId: 'deskpower' },
      kind: 'required',
      rule: 'per_piece',
      qty: 1,
    });
    const r = expand([ln('m1', caseT('ct-ax9'), 2)], s);
    expect(qtyOf(r.lines, 'deskpower')).toBe(2);
    // AX9 inside the case triggers the PowerCON check (16 AX9 → 4 cables suggested)
    expect(r.checkWarnings.map((w) => w.fromItemId)).toContain('ax9');
    expect(r.checkWarnings.find((w) => w.fromItemId === 'ax9')?.candidates[0]?.qty).toBe(4);
  });
});

describe('expansion — OR groups', () => {
  it('OR preselects the first option that is available', () => {
    const r = expand([ln('m1', item('ledbeam'), 10)], cat, {
      isAvailable: (t) => !('itemId' in t && t.itemId === 'clamp'),
    });
    expect(qtyOf(r.lines, 'stand')).toBe(10);
    expect(qtyOf(r.lines, 'clamp')).toBe(0);
    expect(r.orChoices[0]?.decidedBy).toBe('preselected');
    expect(r.openOrChoices).toHaveLength(0);
  });

  it('OR without any available option stays open (blocks confirmation)', () => {
    const r = expand([ln('m1', item('ledbeam'), 10)], cat, { isAvailable: () => false });
    expect(r.openOrChoices).toHaveLength(1);
    expect(qtyOf(r.lines, 'clamp')).toBe(10); // first option shown provisionally
  });

  it('OR keeps the previous choice', () => {
    const first = expand([ln('m1', item('ledbeam'), 10)], cat, {
      orChoices: { 'm1|ledbeam|lb-mount': 'c-lb-stand' },
    });
    expect(qtyOf(first.lines, 'stand')).toBe(10);
    const again = expand(first.lines, cat, { previous: first.lines });
    expect(qtyOf(again.lines, 'stand')).toBe(10);
    expect(again.orChoices[0]?.decidedBy).toBe('previous');
  });

  it('a person’s OR choice wins', () => {
    const r = expand([ln('m1', item('ledbeam'), 3)], cat, {
      orChoices: { 'm1|ledbeam|lb-mount': 'c-lb-stand' },
    });
    expect(r.orChoices[0]?.decidedBy).toBe('person');
    expect(qtyOf(r.lines, 'stand')).toBe(3);
  });

  it('nested OR(AND) group: ("clamp AND rope") OR stand', () => {
    const r = expand([ln('m1', item('par'), 4)], cat);
    expect(qtyOf(r.lines, 'clamp')).toBe(4);
    expect(qtyOf(r.lines, 'rope')).toBe(4);
    expect(qtyOf(r.lines, 'stand')).toBe(0);
    expect(r.orChoices[0]?.options.map((o) => o.key)).toEqual(['group:par-hang', 'c-par-stand']);
    const alt = expand([ln('m1', item('par'), 4)], cat, {
      isAvailable: (t) => !('itemId' in t && t.itemId === 'clamp'),
    });
    expect(qtyOf(alt.lines, 'stand')).toBe(4);
    expect(qtyOf(alt.lines, 'clamp')).toBe(0);
  });
});

describe('expansion — recalculation', () => {
  it('parent qty lowered → auto lines recalculated', () => {
    const r1 = expand([ln('m1', item('ledbeam'), 10)], cat);
    const lowered = r1.lines.map((l) => (l.id === 'm1' ? { ...l, qty: 4 } : l));
    const r2 = expand(lowered, cat, { previous: r1.lines });
    expect(qtyOf(r2.lines, 'clamp')).toBe(4);
    expect(qtyOf(r2.lines, 'rope')).toBe(4);
    expect(qtyOf(r2.lines, 'splitter')).toBe(1);
  });

  it('parent removed → auto lines removed', () => {
    const r1 = expand([ln('m1', item('ledbeam'), 10), ln('m2', item('hazer'), 1)], cat);
    const r2 = expand(
      r1.lines.filter((l) => l.id !== 'm1'),
      cat,
      { previous: r1.lines },
    );
    expect(r2.lines.map((l) => l.id)).toEqual(['m2']);
  });

  it('override kept on recalculation and marked', () => {
    const r1 = expand([ln('m1', item('ledbeam'), 10)], cat);
    const withOverride = r1.lines.map((l) =>
      l.id === autoLineId({ itemId: 'rope' }) ? { ...l, overriddenQty: 12 } : l,
    );
    const lowered = withOverride.map((l) => (l.id === 'm1' ? { ...l, qty: 4 } : l));
    const r2 = expand(lowered, cat, { previous: withOverride });
    const rope = auto(r2.lines, 'rope');
    expect(rope?.overriddenQty).toBe(12);
    expect(rope?.qty).toBe(4);
  });

  it('overridden auto line whose parents disappear becomes manual', () => {
    const r1 = expand([ln('m1', item('ledbeam'), 10)], cat);
    const withOverride = r1.lines.map((l) =>
      l.id === autoLineId({ itemId: 'rope' }) ? { ...l, overriddenQty: 12 } : l,
    );
    const r2 = expand(
      withOverride.filter((l) => l.id !== 'm1'),
      cat,
      { previous: withOverride },
    );
    expect(r2.lines).toHaveLength(1);
    expect(r2.lines[0]).toMatchObject({ origin: 'manual', qty: 12, target: { itemId: 'rope' } });
  });

  it('suppressed auto line is removed together with its subtree', () => {
    const r = expand([ln('m1', item('ledbeam'), 2)], cat, {
      suppressed: { [autoLineId({ itemId: 'desk' })]: 'own desk' },
    });
    expect(qtyOf(r.lines, 'desk')).toBe(0);
    expect(qtyOf(r.lines, 'deskpower')).toBe(0);
  });

  it('auto lines keep status and acknowledgement from the previous expansion', () => {
    const r1 = expand([ln('m1', item('ledbeam'), 2)], cat);
    const acked = r1.lines.map((l) =>
      l.id === autoLineId({ itemId: 'desk' }) ? { ...l, conflictAck: true } : l,
    );
    const r2 = expand(acked, cat, { previous: acked });
    expect(auto(r2.lines, 'desk')?.conflictAck).toBe(true);
  });
});

describe('expansion — check warnings and recommendations', () => {
  it('check warning when no cable present, gone when one is added', () => {
    const r1 = expand([ln('m1', item('ledbeam'), 10)], cat);
    expect(r1.checkWarnings.map((w) => w.key)).toEqual(['ledbeam:power']);
    expect(
      r1.checkWarnings[0]?.candidates.map((c) => ('itemId' in c.target ? c.target.itemId : '')),
    ).toEqual(['powercon', 'adapter']);
    const r2 = expand([...r1.lines, ln('m2', item('adapter'), 2)], cat, { previous: r1.lines });
    expect(r2.checkWarnings).toHaveLength(0);
  });

  it('check warnings can be dismissed', () => {
    const r = expand([ln('m1', item('ledbeam'), 10)], cat, { dismissedChecks: ['ledbeam:power'] });
    expect(r.checkWarnings).toHaveLength(0);
  });

  it('recommendations are deduplicated, exclude the list, and hide dismissed ones', () => {
    const r1 = expand([ln('m1', item('ledbeam'), 2), ln('m2', item('rogue'), 2)], cat);
    const keys = r1.recommendations.map((r) => r.key).sort();
    expect(keys).toEqual(['item:hazer', 'item:lamp']);
    expect(r1.recommendations.find((r) => r.key === 'item:hazer')?.forItemIds.sort()).toEqual([
      'ledbeam',
      'rogue',
    ]);
    const r2 = expand([...r1.lines, ln('m3', item('lamp'), 1)], cat, {
      dismissedRecommendations: ['item:hazer'],
    });
    expect(r2.recommendations).toHaveLength(0);
  });

  it('recommendations are never added to the list', () => {
    const r = expand([ln('m1', item('ledbeam'), 2)], cat);
    expect(qtyOf(r.lines, 'hazer')).toBe(0);
  });
});

describe('expansion — helpers', () => {
  it('usedBy lists items that depend on an accessory', () => {
    expect(
      usedBy(cat, { itemId: 'clamp' })
        .map((c) => c.fromItemId)
        .sort(),
    ).toEqual(['ledbeam', 'par', 'rogue']);
  });
  it('parses "try it" queries', () => {
    expect(parseTryQuery(cat, 'LEDBeam ×10')).toEqual({ itemId: 'ledbeam', qty: 10 });
    expect(parseTryQuery(cat, 'rogue x 3')).toEqual({ itemId: 'rogue', qty: 3 });
    expect(parseTryQuery(cat, 'hazer')).toEqual({ itemId: 'hazer', qty: 1 });
    expect(parseTryQuery(cat, 'nonexistent ×2')).toBeUndefined();
  });
  it('external lines are not expanded', () => {
    const r = expand(
      [
        ln(
          'e1',
          {
            external: {
              name: 'LEDBeam',
              itemId: 'ledbeam',
              supplier: 'X',
              pickup: '2027-04-22',
              returnDate: '2027-04-25',
            },
          },
          10,
        ),
      ],
      cat,
    );
    expect(r.lines).toHaveLength(1);
  });
});
