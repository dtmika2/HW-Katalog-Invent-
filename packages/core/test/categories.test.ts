import { describe, expect, it } from 'vitest';
import {
  categoryColor,
  categoryPath,
  deleteCategory,
  itemsInCategory,
  topCategoryId,
  unwrap,
  upsertCategory,
  upsertItem,
} from '../src';
import { baseState, U } from './helpers';

function withTree() {
  let s = baseState();
  const top = unwrap(upsertCategory(s, U.tomas, { name: 'Kabeláž', icon: 'cable' }));
  s = top.state;
  const sub = unwrap(
    upsertCategory(s, U.tomas, { name: 'Napájecí kabely', parentId: top.categoryId }),
  );
  s = sub.state;
  const it = s.items.find((i) => i.id === 'powercon')!;
  s = unwrap(upsertItem(s, U.tomas, { ...it, categoryId: sub.categoryId })).state;
  return { s, top: top.categoryId, sub: sub.categoryId };
}

describe('categories', () => {
  it('two levels: category → subcategory, with path and top lookup', () => {
    const { s, top, sub } = withTree();
    expect(categoryPath(s, sub).map((c) => c.name)).toEqual(['Kabeláž', 'Napájecí kabely']);
    expect(categoryPath(s, top).map((c) => c.name)).toEqual(['Kabeláž']);
    expect(topCategoryId(s, sub)).toBe(top);
    expect(s.categories.find((c) => c.id === top)?.icon).toBe('cable');
  });

  it('items in a top category include its subcategories; archived items are hidden', () => {
    const { s, top, sub } = withTree();
    expect(itemsInCategory(s, top).map((i) => i.id)).toEqual(['powercon']);
    expect(itemsInCategory(s, sub).map((i) => i.id)).toEqual(['powercon']);
    const archived = {
      ...s,
      items: s.items.map((i) => (i.id === 'powercon' ? { ...i, archived: true } : i)),
    };
    expect(itemsInCategory(archived, top)).toHaveLength(0);
    expect(itemsInCategory(archived, top, true)).toHaveLength(1);
  });

  it('only two levels; no own parent; parents with subcategories stay top-level', () => {
    const { s, top, sub } = withTree();
    expect(upsertCategory(s, U.tomas, { name: 'Optika 100 m', parentId: sub })).toMatchObject({
      ok: false,
      error: { details: { field: 'parentId' } },
    });
    expect(upsertCategory(s, U.tomas, { id: top, name: 'Kabeláž', parentId: 'cat' })).toMatchObject(
      { ok: false, error: { details: { field: 'parentId' } } },
    );
    expect(upsertCategory(s, U.tomas, { name: 'X', parentId: 'nope' })).toMatchObject({
      ok: false,
    });
  });

  it('names are unique among siblings; renaming works; permissions apply', () => {
    const { s, top, sub } = withTree();
    expect(upsertCategory(s, U.tomas, { name: 'napájecí KABELY', parentId: top })).toMatchObject({
      ok: false,
      error: { details: { field: 'name' } },
    });
    expect(upsertCategory(s, U.tomas, { name: ' ' })).toMatchObject({
      ok: false,
      error: { details: { field: 'name' } },
    });
    expect(upsertCategory(s, U.petr, { name: 'Y' })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    const renamed = unwrap(
      upsertCategory(s, U.tomas, { id: sub, name: 'PowerCON a napájení', parentId: top }),
    );
    expect(categoryPath(renamed.state, sub).map((c) => c.name)).toEqual([
      'Kabeláž',
      'PowerCON a napájení',
    ]);
  });

  it('subcategories inherit the colour of their category', () => {
    const { s, top, sub } = withTree();
    const s2 = unwrap(
      upsertCategory(s, U.tomas, { id: top, name: 'Kabeláž', icon: 'cable', color: 'sage' }),
    ).state;
    expect(categoryColor(s2, top)).toBe('sage');
    expect(categoryColor(s2, sub)).toBe('sage');
    const s3 = unwrap(
      upsertCategory(s2, U.tomas, {
        id: sub,
        name: 'Napájecí kabely',
        parentId: top,
        color: 'sand',
      }),
    ).state;
    expect(categoryColor(s3, sub)).toBe('sand');
  });

  it('only empty categories can be deleted', () => {
    const { s, top, sub } = withTree();
    expect(deleteCategory(s, U.tomas, top)).toMatchObject({
      ok: false,
      error: { details: { field: 'subcategories', count: 1 } },
    });
    expect(deleteCategory(s, U.tomas, sub)).toMatchObject({
      ok: false,
      error: { details: { field: 'items', count: 1 } },
    });
    const moved = unwrap(
      upsertItem(s, U.tomas, { ...s.items.find((i) => i.id === 'powercon')!, categoryId: 'cat' }),
    ).state;
    const s2 = unwrap(deleteCategory(moved, U.tomas, sub));
    expect(unwrap(deleteCategory(s2, U.tomas, top)).categories.some((c) => c.id === top)).toBe(
      false,
    );
  });
});
