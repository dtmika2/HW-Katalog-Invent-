import { describe, expect, it } from 'vitest';
import {
  addConnection,
  bulkUpdateItems,
  duplicateItem,
  expand,
  importItems,
  itemCompleteness,
  removeConnection,
  setItemArchived,
  setItemStock,
  unwrap,
  upsertCase,
  upsertCaseType,
  upsertItem,
  usedBy,
} from '../src';
import { baseState, L, ln, U, W } from './helpers';

const s = baseState();
const T = '2027-04-20';

describe('catalogue editing', () => {
  it('only catalogue editors edit; items are validated', () => {
    const it0 = s.items[0]!;
    expect(upsertItem(s, U.petr, it0)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(upsertItem(s, U.tomas, { ...it0, name: ' ' })).toMatchObject({
      ok: false,
      error: { code: 'validation', details: { field: 'name' } },
    });
    expect(upsertItem(s, U.tomas, { ...it0, priceDay: -1 })).toMatchObject({
      ok: false,
      error: { details: { field: 'priceDay' } },
    });
    expect(upsertItem(s, U.tomas, { ...it0, categoryId: 'x' })).toMatchObject({
      ok: false,
      error: { details: { field: 'categoryId' } },
    });
    const r = unwrap(upsertItem(s, U.tomas, { ...it0, id: '', name: 'Nové světlo' }));
    expect(r.state.items.find((i) => i.id === r.itemId)?.name).toBe('Nové světlo');
  });

  it('duplicate copies connections; archive hides; bulk edit sets price', () => {
    const d = unwrap(duplicateItem(s, U.tomas, 'ledbeam', 'Robe LEDBeam 150 FW'));
    expect(d.state.connections.filter((c) => c.fromItemId === d.itemId)).toHaveLength(
      s.connections.filter((c) => c.fromItemId === 'ledbeam').length,
    );
    expect(
      unwrap(setItemArchived(s, U.tomas, 'hazer', true)).items.find((i) => i.id === 'hazer')
        ?.archived,
    ).toBe(true);
    const b = unwrap(bulkUpdateItems(s, U.tomas, ['clamp', 'rope'], { priceDay: 25 }));
    expect(b.items.filter((i) => ['clamp', 'rope'].includes(i.id)).map((i) => i.priceDay)).toEqual([
      25, 25,
    ]);
  });

  it('stock cannot go below what sits in cases', () => {
    expect(setItemStock(s, U.tomas, 'ax9', W.brod, 15)).toMatchObject({
      ok: false,
      error: { details: { inCases: 16 } },
    });
    expect(
      unwrap(setItemStock(s, U.tomas, 'ax9', W.brod, 18)).stock.find(
        (x) => x.itemId === 'ax9' && x.warehouseId === W.brod,
      )?.qty,
    ).toBe(18);
    expect(
      unwrap(setItemStock(s, U.tomas, 'hazer', W.karlak, 1, L.karlakA)).stock.some(
        (x) => x.itemId === 'hazer' && x.warehouseId === W.karlak,
      ),
    ).toBe(true);
    expect(setItemStock(s, U.tomas, 'hazer', W.karlak, 1, L.brodA)).toMatchObject({ ok: false });
  });

  it('connections are validated, show in "used by" and drive expansion', () => {
    expect(
      addConnection(s, U.tomas, {
        fromItemId: 'hazer',
        target: { itemId: 'hazer' },
        kind: 'required',
        rule: 'per_piece',
        qty: 1,
      }),
    ).toMatchObject({ ok: false });
    expect(
      addConnection(s, U.tomas, {
        fromItemId: 'hazer',
        target: { itemId: 'lamp' },
        kind: 'required',
        rule: 'per_n',
        qty: 1,
      }),
    ).toMatchObject({ ok: false, error: { details: { field: 'n' } } });
    const r = unwrap(
      addConnection(s, U.tomas, {
        fromItemId: 'hazer',
        target: { itemId: 'powercon' },
        kind: 'required',
        rule: 'per_piece',
        qty: 2,
      }),
    );
    expect(usedBy(r.state, { itemId: 'powercon' }).map((c) => c.fromItemId)).toContain('hazer');
    expect(
      expand([ln('m', { itemId: 'hazer' }, 2)], r.state).lines.find(
        (l) => l.id === 'auto:item:powercon',
      )?.qty,
    ).toBe(4);
    expect(unwrap(removeConnection(r.state, U.tomas, r.connectionId)).connections).toHaveLength(
      s.connections.length,
    );
  });

  it('case types and cases: contents must fit stock; incomplete cases are flagged', () => {
    expect(upsertCaseType(s, U.tomas, { id: '', name: 'X', contents: [] })).toMatchObject({
      ok: false,
    });
    const t = unwrap(
      upsertCaseType(s, U.tomas, {
        id: '',
        name: 'Hazer case',
        contents: [
          { itemId: 'hazer', qty: 1 },
          { itemId: 'lamp', qty: 2 },
        ],
      }),
    );
    const c = unwrap(
      upsertCase(
        t.state,
        U.tomas,
        {
          id: '',
          caseTypeId: t.caseTypeId,
          number: 'HZ-01',
          warehouseId: W.brod,
          locationId: L.brodA,
          contents: [
            { itemId: 'hazer', qty: 1 },
            { itemId: 'lamp', qty: 1 },
          ],
        },
        T,
      ),
    );
    expect(c.state.cases.find((x) => x.id === c.caseId)?.incompleteSince).toBe(T);
    expect(
      upsertCase(
        t.state,
        U.tomas,
        {
          id: '',
          caseTypeId: t.caseTypeId,
          number: 'AX9-01',
          warehouseId: W.brod,
          locationId: L.brodA,
          contents: [],
        },
        T,
      ),
    ).toMatchObject({ ok: false, error: { details: { field: 'number' } } });
    expect(
      upsertCase(
        t.state,
        U.tomas,
        {
          id: '',
          caseTypeId: t.caseTypeId,
          number: 'HZ-02',
          warehouseId: W.brod,
          locationId: L.brodA,
          contents: [{ itemId: 'hazer', qty: 3 }],
        },
        T,
      ),
    ).toMatchObject({ ok: false });
  });

  it('completeness indicator', () => {
    const c = itemCompleteness(
      s,
      s.items.find((i) => i.id === 'hazer')!,
    );
    expect(c).toMatchObject({
      photo: false,
      location: true,
      price: true,
      connections: true,
      score: 3,
      needsSetup: true,
    });
  });

  it('import: valid rows created or updated, invalid rows reported by row and field', () => {
    const r = unwrap(
      importItems(s, U.tomas, [
        {
          row: 2,
          name: 'Mlhostroj Look Unique',
          manufacturer: 'Look',
          category: 'Test',
          priceDay: '900',
          stock: { Brod: 2 },
        },
        { row: 3, name: '', category: 'Test', priceDay: 10 },
        { row: 4, name: 'Clamp', category: 'Test', priceDay: '25,5', stock: { Karlák: 'x' } },
        { row: 5, name: 'Clamp', category: 'Test', priceDay: 30, returnable: 'ne' },
        { row: 6, name: 'Něco', category: 'Neexistuje', priceDay: 1 },
      ]),
    );
    expect(r.created).toBe(1);
    expect(r.updated).toBe(1);
    expect(r.errors).toEqual([
      { row: 3, field: 'name', message: 'missing' },
      { row: 4, field: 'stock:Karlák', message: 'invalid' },
      { row: 6, field: 'category', message: 'unknown' },
    ]);
    const unique = r.state.items.find((i) => i.name === 'Mlhostroj Look Unique')!;
    expect(r.state.stock.find((x) => x.itemId === unique.id)?.qty).toBe(2);
    expect(r.state.items.find((i) => i.id === 'clamp')).toMatchObject({
      priceDay: 30,
      returnable: false,
    });
  });
});
