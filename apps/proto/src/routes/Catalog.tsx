import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  can,
  caseMissing,
  categoryPath,
  itemsInCategory,
  topCategoryId,
  totalStock,
} from '@quix/core';
import { CategoryIcon, CategoryLabel, colorOf, Swatch, tint } from '../components/Category';
import { CaseLabel, Empty } from '../components/ui';
import { cs } from '../i18n/cs';
import { useAppState, useUser } from '../store';

/**
 * Category view of the catalogue: a two-level tree with counts on the left, breadcrumb and
 * subcategory chips on top, cards with photo, stock, price and category label. The selected
 * category lives in the URL (`?cat=`), so category labels elsewhere can link here.
 */
export function CatalogBrowse() {
  const s = useAppState();
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const cat = params.get('cat') ?? '';
  const [q, setQ] = useState('');
  const setCat = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('cat', id);
    else next.delete('cat');
    setParams(next, { replace: true });
  };
  const tops = s.categories.filter((c) => !c.parentId);
  const subsOf = (id: string) => s.categories.filter((c) => c.parentId === id);
  const selectedTop = cat ? topCategoryId(s, cat) : '';
  const path = cat ? categoryPath(s, cat) : [];

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool = cat ? itemsInCategory(s, cat) : s.items.filter((i) => !i.archived);
    return pool.filter(
      (i) => !needle || `${i.name} ${i.manufacturer} ${i.model}`.toLowerCase().includes(needle),
    );
  }, [s, q, cat]);
  const itemIds = new Set(items.map((i) => i.id));
  const caseTypes = cat
    ? s.caseTypes.filter((t) => t.contents.some((c) => itemIds.has(c.itemId)))
    : s.caseTypes;

  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
      <nav aria-label={cs.categories.tree} className="panel h-fit p-2 text-sm">
        <button
          type="button"
          aria-current={!cat}
          onClick={() => setCat('')}
          className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left ${!cat ? 'bg-tape text-white' : 'hover:bg-alu'}`}
        >
          {cs.categories.allItems}
          <span className="text-xs opacity-80">{s.items.filter((i) => !i.archived).length}</span>
        </button>
        <ul className="mt-1 space-y-0.5" data-testid="category-tree">
          {tops.map((t) => {
            const open = selectedTop === t.id;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  aria-current={cat === t.id}
                  aria-expanded={open}
                  onClick={() => setCat(t.id)}
                  className={`flex w-full items-center gap-2 rounded border-l-4 px-2 py-1.5 text-left font-medium ${cat === t.id ? 'font-semibold' : open ? '' : 'border-transparent hover:bg-alu'}`}
                  style={cat === t.id || open ? tint(s, t.id, cat === t.id) : undefined}
                >
                  <span style={{ color: colorOf(s, t.id)?.mark }}>
                    <CategoryIcon icon={t.icon} />
                  </span>
                  <span className="flex-1">{t.name}</span>
                  <span className="text-xs opacity-70">{itemsInCategory(s, t.id).length}</span>
                </button>
                {open && subsOf(t.id).length > 0 && (
                  <ul className="ml-6 mt-0.5 space-y-0.5 border-l border-alu-line pl-2">
                    {subsOf(t.id).map((sc) => (
                      <li key={sc.id}>
                        <button
                          type="button"
                          aria-current={cat === sc.id}
                          onClick={() => setCat(sc.id)}
                          className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1 text-left ${cat === sc.id ? 'font-semibold' : 'border-transparent hover:bg-alu'}`}
                          style={cat === sc.id ? tint(s, sc.id, true) : undefined}
                        >
                          <span>{sc.name}</span>
                          <span className="text-xs opacity-70">
                            {itemsInCategory(s, sc.id).length}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <nav
            aria-label={cs.categories.tree}
            className="flex flex-wrap items-center gap-1 font-cond text-lg font-bold"
            data-testid="breadcrumb"
          >
            <button type="button" className="hover:underline" onClick={() => setCat('')}>
              {cs.categories.allItems}
            </button>
            {path.map((c) => (
              <span key={c.id} className="flex items-center gap-1">
                <span aria-hidden="true" className="text-muted">
                  ›
                </span>
                <button type="button" className="hover:underline" onClick={() => setCat(c.id)}>
                  {c.name}
                </button>
              </span>
            ))}
            <span className="ml-2 font-sans text-sm font-normal text-muted">
              {cs.categories.itemsCount(items.length)}
            </span>
          </nav>
          <input
            className="input ml-auto max-w-xs"
            aria-label={cs.catalog.search}
            placeholder={cs.catalog.search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {selectedTop && subsOf(selectedTop).length > 0 && (
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label={cs.categories.subcategories}
          >
            {subsOf(selectedTop).map((sc) => (
              <button
                key={sc.id}
                type="button"
                aria-pressed={cat === sc.id}
                onClick={() => setCat(cat === sc.id ? selectedTop : sc.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${cat === sc.id ? 'font-semibold' : 'border-alu-line bg-white hover:bg-alu'}`}
                style={cat === sc.id ? tint(s, sc.id, true) : undefined}
              >
                <Swatch color={s.categories.find((x) => x.id === selectedTop)?.color} />
                {sc.name}{' '}
                <span className="text-xs opacity-70">{itemsInCategory(s, sc.id).length}</span>
              </button>
            ))}
          </div>
        )}

        {items.length === 0 ? (
          <Empty>{cs.categories.noItems}</Empty>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="catalog-cards">
            {items.map((i) => (
              <li
                key={i.id}
                className="panel flex gap-3 border-l-4 p-3"
                style={{ borderLeftColor: colorOf(s, i.categoryId)?.mark }}
              >
                <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded bg-alu text-[10px] text-muted">
                  {i.photos?.[0] ? (
                    <img src={i.photos[0]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    cs.catalog.photo
                  )}
                </div>
                <div className="min-w-0 space-y-1">
                  <Link
                    to={`/items/${i.id}`}
                    className="block truncate font-cond font-semibold hover:underline"
                  >
                    {i.name}
                  </Link>
                  <p className="text-xs text-muted">
                    {cs.common.pcs(totalStock(s, i.id))} ·{' '}
                    {cs.catalog.perDay(cs.common.czk(i.priceDay))}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <CategoryLabel s={s} categoryId={i.categoryId} />
                    {can(user, 'borrow') && i.returnable && (
                      <Link
                        to={`/items/${i.id}?loan=1`}
                        className="text-xs text-tape underline"
                        aria-label={`${cs.loans.button}: ${i.name}`}
                      >
                        {cs.loans.button}
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {caseTypes.length > 0 && (
          <>
            <h2>{cat ? cs.categories.caseTypesHere : cs.catalog.caseTypes}</h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {caseTypes.map((t) => {
                const cases = s.cases.filter((c) => c.caseTypeId === t.id && !c.archived);
                const incomplete = cases.filter((c) => caseMissing(s, c).length > 0).length;
                return (
                  <li key={t.id} className="panel p-3">
                    <Link
                      to={`/case-types/${t.id}`}
                      className="font-cond font-semibold hover:underline"
                    >
                      {t.name}
                    </Link>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {cases.map((c) => (
                        <CaseLabel key={c.id}>{c.number}</CaseLabel>
                      ))}
                    </p>
                    {incomplete > 0 && (
                      <p className="mt-1 text-xs text-bad">
                        {cs.catalog.incompleteCount(incomplete)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
