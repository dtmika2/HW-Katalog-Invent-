import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  bulkUpdateItems,
  can,
  expand,
  importItems,
  itemCompleteness,
  parseTryQuery,
  stockQty,
  upsertItem,
  type AppState,
  type BookingLine,
  type ImportError,
  type ImportRow,
  type Item,
} from '@quix/core';
import { CaseLabel, Empty, Section } from '../components/ui';
import { cs } from '../i18n/cs';
import { itemName, targetName } from '../lib/names';
import { useAppState, useProto, useUser } from '../store';
import { CatalogBrowse } from './Catalog';
import { CategoryManager } from './CategoryManager';

type Tab = 'cards' | 'table' | 'categories' | 'tryIt' | 'import';

export function Catalog() {
  const user = useUser();
  const editor = can(user, 'edit_catalogue');
  const [tab, setTab] = useState<Tab>('cards');
  const tabs: Tab[] = editor
    ? ['cards', 'table', 'categories', 'tryIt', 'import']
    : ['cards', 'tryIt'];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>{cs.catalog.title}</h1>
        {editor && (
          <Link to="/items/new" className="btn btn-sm btn-primary">
            {cs.catalogEditor.newItem}
          </Link>
        )}
        <div className="ml-auto flex gap-1" role="tablist">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`btn btn-sm ${tab === t ? 'btn-primary' : ''}`}
              onClick={() => setTab(t)}
            >
              {cs.catalogEditor.tabs[t]}
            </button>
          ))}
        </div>
      </div>
      {tab === 'cards' && <CatalogBrowse />}
      {tab === 'table' && <CatalogTable />}
      {tab === 'categories' && <CategoryManager />}
      {tab === 'tryIt' && <TryIt />}
      {tab === 'import' && <ImportExport />}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** A cell that edits on change and saves on blur / Enter; reverts and warns when invalid. */
function Cell({
  value,
  onSave,
  type = 'text',
  label,
  children,
}: {
  value: string;
  onSave: (v: string) => boolean;
  type?: string;
  label: string;
  children?: ReactNode;
}) {
  const [v, setV] = useState(value);
  const [bad, setBad] = useState(false);
  const commit = () => {
    if (v === value) return;
    const okSaved = onSave(v);
    setBad(!okSaved);
    if (!okSaved) setV(value);
  };
  if (children) return <>{children}</>;
  return (
    <input
      aria-label={label}
      aria-invalid={bad}
      type={type}
      className={`w-full rounded border bg-transparent px-1.5 py-1 text-sm hover:border-alu-line focus:border-tape focus:bg-white ${bad ? 'border-bad' : 'border-transparent'}`}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setV(value);
      }}
    />
  );
}

function CatalogTable() {
  const s = useAppState();
  const user = useUser();
  const run = useProto((p) => p.run);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [bulkCat, setBulkCat] = useState('');
  const [bulkPrice, setBulkPrice] = useState('');
  const subs = s.categories.filter((c) => c.parentId);
  const rows = useMemo(
    () =>
      s.items
        .filter((i) => showArchived || !i.archived)
        .filter((i) => !q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase()))
        .map((i) => ({ i, c: itemCompleteness(s, i) }))
        .filter((r) => !needsSetup || r.c.needsSetup),
    [s, q, needsSetup, showArchived],
  );
  const save = (item: Item, patch: Partial<Item>): boolean => {
    const err = run(
      (st) => {
        const r = upsertItem(st, user, { ...item, ...patch });
        return r.ok ? { ok: true, value: r.value.state } : r;
      },
      undefined,
      cs.catalogEditor.invalid,
    );
    return !err;
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input
          className="input max-w-xs"
          aria-label={cs.catalog.search}
          placeholder={cs.catalog.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={needsSetup}
            onChange={(e) => setNeedsSetup(e.target.checked)}
          />
          {cs.catalogEditor.needsSetup}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          {cs.catalogEditor.showArchived}
        </label>
      </div>
      {sel.length > 0 && (
        <div className="panel flex flex-wrap items-end gap-2 p-2 text-sm">
          <span className="font-semibold">{cs.catalogEditor.selected(sel.length)}</span>
          <select
            className="input w-auto"
            aria-label={cs.catalogEditor.bulkCategory}
            value={bulkCat}
            onChange={(e) => setBulkCat(e.target.value)}
          >
            <option value="">{cs.catalogEditor.bulkCategory}</option>
            {subs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            className="input w-28"
            type="number"
            min={0}
            aria-label={cs.catalogEditor.bulkPrice}
            placeholder={cs.catalogEditor.bulkPrice}
            value={bulkPrice}
            onChange={(e) => setBulkPrice(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-sm"
            disabled={!bulkCat && bulkPrice === ''}
            onClick={() => {
              const patch: Partial<Item> = {};
              if (bulkCat) patch.categoryId = bulkCat;
              if (bulkPrice !== '') patch.priceDay = Number(bulkPrice);
              if (!run((st) => bulkUpdateItems(st, user, sel, patch), cs.catalogEditor.saved))
                setSel([]);
            }}
          >
            {cs.catalogEditor.apply}
          </button>
        </div>
      )}
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[60rem] text-sm" data-testid="catalog-table">
          <thead className="border-b border-alu-line text-left text-xs text-muted">
            <tr>
              <th className="w-8 px-2 py-2">
                <span className="sr-only">{cs.catalogEditor.col.select}</span>
              </th>
              <th className="px-2 py-2 font-medium">{cs.catalogEditor.col.name}</th>
              <th className="px-2 py-2 font-medium">{cs.catalogEditor.col.manufacturer}</th>
              <th className="px-2 py-2 font-medium">{cs.catalogEditor.col.category}</th>
              <th className="w-28 px-2 py-2 font-medium">{cs.catalogEditor.col.price}</th>
              {s.warehouses.map((w) => (
                <th key={w.id} className="w-16 px-2 py-2 text-right font-medium">
                  {w.name}
                </th>
              ))}
              <th className="px-2 py-2 font-medium">{cs.catalogEditor.col.consumable}</th>
              <th className="px-2 py-2 font-medium">{cs.catalogEditor.col.completeness}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-alu-line">
            {rows.map(({ i, c }) => {
              const missing = (['photo', 'location', 'price', 'connections'] as const)
                .filter((k) => !c[k])
                .map((k) => cs.catalogEditor.parts[k])
                .join(', ');
              return (
                <tr
                  key={i.id}
                  data-testid={`row-${i.id}`}
                  className={i.archived ? 'opacity-50' : ''}
                >
                  <td className="px-2">
                    <input
                      type="checkbox"
                      aria-label={`${cs.catalogEditor.col.select}: ${i.name}`}
                      checked={sel.includes(i.id)}
                      onChange={(e) =>
                        setSel(e.target.checked ? [...sel, i.id] : sel.filter((x) => x !== i.id))
                      }
                    />
                  </td>
                  <td className="px-1">
                    <span className="flex items-center gap-1">
                      <Cell
                        key={`${i.id}-n-${i.name}`}
                        label={`${cs.catalogEditor.col.name}: ${i.name}`}
                        value={i.name}
                        onSave={(v) => save(i, { name: v })}
                      />
                      <Link
                        to={`/items/${i.id}`}
                        className="text-xs text-tape"
                        aria-label={`${cs.common.open}: ${i.name}`}
                      >
                        ↗
                      </Link>
                    </span>
                  </td>
                  <td className="px-1">
                    <Cell
                      key={`${i.id}-m-${i.manufacturer}`}
                      label={`${cs.catalogEditor.col.manufacturer}: ${i.name}`}
                      value={i.manufacturer}
                      onSave={(v) => save(i, { manufacturer: v })}
                    />
                  </td>
                  <td className="px-1">
                    <select
                      className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-sm hover:border-alu-line"
                      aria-label={`${cs.catalogEditor.col.category}: ${i.name}`}
                      value={i.categoryId}
                      onChange={(e) => save(i, { categoryId: e.target.value })}
                    >
                      {s.categories
                        .filter((t) => !t.parentId)
                        .map((t) => (
                          <optgroup key={t.id} label={t.name}>
                            <option value={t.id}>{t.name}</option>
                            {s.categories
                              .filter((sc) => sc.parentId === t.id)
                              .map((sc) => (
                                <option key={sc.id} value={sc.id}>
                                  {sc.name}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                    </select>
                  </td>
                  <td className="px-1">
                    <Cell
                      key={`${i.id}-p-${i.priceDay}`}
                      type="number"
                      label={`${cs.catalogEditor.col.price}: ${i.name}`}
                      value={String(i.priceDay)}
                      onSave={(v) => v.trim() !== '' && save(i, { priceDay: Number(v) })}
                    />
                  </td>
                  {s.warehouses.map((w) => (
                    <td key={w.id} className="px-2 text-right tabular-nums">
                      {stockQty(s, i.id, w.id)}
                    </td>
                  ))}
                  <td className="px-2 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${cs.catalogEditor.col.consumable}: ${i.name}`}
                      checked={!i.returnable}
                      onChange={(e) => save(i, { returnable: !e.target.checked })}
                    />
                  </td>
                  <td className="px-2" title={cs.catalogEditor.completenessHint(missing)}>
                    <span
                      className={`text-xs font-semibold ${c.needsSetup ? 'text-warn' : 'text-ok'}`}
                    >
                      {cs.catalogEditor.completeness(c.score)}
                    </span>
                    {i.archived && (
                      <span className="ml-1 text-xs text-muted">{cs.catalogEditor.archived}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** "Vyzkoušet": type "LEDBeam ×10" and see the expanded list before booking. */
export function TryIt({ initial = '' }: { initial?: string }) {
  const s = useAppState();
  const [q, setQ] = useState(initial);
  const parsed = q.trim() ? parseTryQuery(s, q) : undefined;
  const result = useMemo(() => {
    if (!parsed) return undefined;
    const manual: BookingLine = {
      id: 'try',
      target: { itemId: parsed.itemId },
      qty: parsed.qty,
      origin: 'manual',
      parentLineIds: [],
      status: 'ok',
      conflictAck: false,
    };
    return expand([manual], s);
  }, [s, parsed?.itemId, parsed?.qty]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Section title={cs.catalogEditor.tryTitle}>
      <p className="mb-2 text-xs text-muted">{cs.catalogEditor.tryHint}</p>
      <input
        className="input max-w-sm"
        aria-label={cs.catalogEditor.tryTitle}
        placeholder={cs.catalogEditor.tryPlaceholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {q.trim() && !parsed && (
        <p className="mt-2 text-sm text-bad">{cs.catalogEditor.tryNotFound}</p>
      )}
      {parsed && result && (
        <div className="mt-3 text-sm" data-testid="try-result">
          <p className="font-semibold">
            {cs.catalogEditor.tryResult(itemName(s, parsed.itemId), parsed.qty)}
          </p>
          {result.lines.length <= 1 ? (
            <Empty>{cs.catalogEditor.tryNothing}</Empty>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {result.lines
                .filter((l) => l.origin === 'auto')
                .map((l) => (
                  <li key={l.id}>
                    {l.qty}× {targetName(s, l.target as { itemId: string })}
                    {'caseTypeId' in l.target && <CaseLabel>{cs.editor.caseTag}</CaseLabel>}
                    <span className="ml-2 text-xs text-muted">
                      {cs.editor.forHint(
                        l.parentLineIds
                          .map((p) =>
                            p === 'try'
                              ? itemName(s, parsed.itemId)
                              : targetName(
                                  s,
                                  result.lines.find((x) => x.id === p)?.target as {
                                    itemId: string;
                                  },
                                ),
                          )
                          .join(', '),
                      )}
                    </span>
                  </li>
                ))}
            </ul>
          )}
          {result.orChoices.length > 0 && (
            <ul className="mt-2 text-xs text-muted">
              {result.orChoices.map((o) => (
                <li key={o.groupKey}>
                  {cs.editor.orTitle(itemName(s, o.fromItemId))}:{' '}
                  {o.options
                    .map((op) => op.targets.map((t) => targetName(s, t.target)).join(' + '))
                    .join(' / ')}
                </li>
              ))}
            </ul>
          )}
          {result.checkWarnings.map((w) => (
            <p key={w.key} className="mt-2 text-xs">
              {cs.editor.checksTitle} {w.candidates.map((c) => targetName(s, c.target)).join(', ')}
            </p>
          ))}
          {result.recommendations.length > 0 && (
            <p className="mt-2 text-xs text-muted">
              {cs.editor.recsTitle}:{' '}
              {result.recommendations.map((r) => targetName(s, r.target)).join(', ')}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------

const H = cs.catalogEditor.headers;

/** Map a sheet row (Czech headers) to an import row. */
export function sheetRowsToImport(s: AppState, rows: Record<string, unknown>[]): ImportRow[] {
  const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
  return rows.map((r, i) => {
    const stock: Record<string, string | undefined> = {};
    for (const w of s.warehouses) stock[w.name] = str(r[w.name]);
    const row: ImportRow = { row: i + 2, stock };
    const set = <K extends keyof ImportRow>(k: K, v: ImportRow[K] | undefined) => {
      if (v !== undefined) row[k] = v;
    };
    set('name', str(r[H[0] as string]));
    set('manufacturer', str(r[H[1] as string]));
    set('model', str(r[H[2] as string]));
    set('category', str(r[H[3] as string]));
    set('priceDay', str(r[H[4] as string]));
    set('returnable', str(r[H[7] as string]));
    set('weightKg', str(r[H[8] as string]));
    set('notes', str(r[H[9] as string]));
    return row;
  });
}

function download(wb: XLSX.WorkBook, name: string) {
  XLSX.writeFile(wb, name);
}

function ImportExport() {
  const s = useAppState();
  const user = useUser();
  const run = useProto((p) => p.run);
  const toast = useProto((p) => p.toast);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const fieldLabel = (f: string) =>
    f === 'name'
      ? H[0]
      : f === 'category'
        ? H[3]
        : f === 'priceDay'
          ? H[4]
          : f === 'weightKg'
            ? H[8]
            : f.startsWith('stock:')
              ? f.slice(6)
              : f;
  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const wb = XLSX.read(reader.result as ArrayBuffer, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0] ?? ''];
      if (!sheet) return;
      const rows = sheetRowsToImport(
        s,
        XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' }),
      );
      let res: { created: number; updated: number; errors: ImportError[] } | undefined;
      run((st) => {
        const r = importItems(st, user, rows);
        if (!r.ok) return r;
        res = r.value;
        return { ok: true, value: r.value.state };
      });
      if (res) {
        setErrors(res.errors);
        toast('ok', cs.catalogEditor.importDone(res.created, res.updated));
      }
    };
    reader.readAsArrayBuffer(file);
  };
  return (
    <Section title={cs.catalogEditor.importTitle}>
      <p className="mb-3 max-w-prose text-sm text-muted">{cs.catalogEditor.importHint}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn"
          onClick={() => {
            const wb = XLSX.utils.book_new();
            const example = [
              'Robe LEDBeam 150',
              'Robe',
              'LEDBeam 150',
              s.categories.find((c) => c.parentId)?.name ?? '',
              450,
              8,
              4,
              'ano',
              6.5,
              '',
            ];
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, example]), 'Katalog');
            download(wb, cs.catalogEditor.fileName);
          }}
        >
          {cs.catalogEditor.template}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const rows = s.items
              .filter((i) => !i.archived)
              .map((i) => [
                i.name,
                i.manufacturer,
                i.model,
                s.categories.find((c) => c.id === i.categoryId)?.name ?? '',
                i.priceDay,
                ...s.warehouses.map((w) => stockQty(s, i.id, w.id)),
                i.returnable ? 'ano' : 'ne',
                i.weightKg ?? '',
                i.notes ?? '',
              ]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, ...rows]), 'Katalog');
            download(wb, cs.catalogEditor.exportName);
          }}
        >
          {cs.catalogEditor.exportAll}
        </button>
        <label className="btn btn-primary cursor-pointer">
          {cs.catalogEditor.upload}
          <input
            type="file"
            className="sr-only"
            accept=".xlsx,.xls,.csv"
            aria-label={cs.catalogEditor.upload}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {errors.length > 0 && (
        <div className="mt-4" data-testid="import-errors">
          <h3 className="text-sm font-semibold text-bad">{cs.catalogEditor.importErrors}</h3>
          <ul className="mt-1 text-sm">
            {errors.map((e, i) => (
              <li key={i}>
                {cs.catalogEditor.importErrorRow(
                  e.row,
                  fieldLabel(e.field) ?? e.field,
                  cs.catalogEditor.importMessages[e.message] ?? e.message,
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
