import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { caseMissing, totalStock } from '@quix/core';
import { CaseLabel } from '../components/ui';
import { cs } from '../i18n/cs';
import { useAppState } from '../store';

/** Browse view of the catalogue (cards with photo, stock, price). The editor lives in M5a. */
export function CatalogBrowse() {
  const s = useAppState();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const tops = s.categories.filter((c) => !c.parentId);
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return s.items.filter((i) => {
      if (i.archived) return false;
      const top = s.categories.find((c) => c.id === i.categoryId)?.parentId ?? i.categoryId;
      if (cat && top !== cat && i.categoryId !== cat) return false;
      return !needle || `${i.name} ${i.manufacturer} ${i.model}`.toLowerCase().includes(needle);
    });
  }, [s, q, cat]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <input
          className="input max-w-sm"
          aria-label={cs.catalog.search}
          placeholder={cs.catalog.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input w-auto"
          aria-label={cs.catalog.category}
          value={cat}
          onChange={(e) => setCat(e.target.value)}
        >
          <option value="">{cs.catalog.allCategories}</option>
          {tops.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((i) => (
          <li key={i.id} className="panel flex gap-3 p-3">
            <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded bg-alu text-[10px] text-muted">
              {i.photos?.[0] ? (
                <img src={i.photos[0]} alt="" className="h-full w-full object-cover" />
              ) : (
                cs.catalog.photo
              )}
            </div>
            <div className="min-w-0">
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
            </div>
          </li>
        ))}
      </ul>
      <h2>{cs.catalog.caseTypes}</h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {s.caseTypes.map((t) => {
          const cases = s.cases.filter((c) => c.caseTypeId === t.id && !c.archived);
          const incomplete = cases.filter((c) => caseMissing(s, c).length > 0).length;
          return (
            <li key={t.id} className="panel p-3">
              <Link to={`/case-types/${t.id}`} className="font-cond font-semibold hover:underline">
                {t.name}
              </Link>
              <p className="mt-1 flex flex-wrap gap-1">
                {cases.map((c) => (
                  <CaseLabel key={c.id}>{c.number}</CaseLabel>
                ))}
              </p>
              {incomplete > 0 && (
                <p className="mt-1 text-xs text-bad">{cs.catalog.incompleteCount(incomplete)}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
