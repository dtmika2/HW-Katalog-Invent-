import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  addConnection,
  caseMissing,
  duplicateItem,
  removeConnection,
  setItemArchived,
  setItemStock,
  upsertCase,
  upsertItem,
  usedBy,
  type CaseType,
  type Item,
  type StagePart,
} from '@quix/core';
import { ConnectionForm, ConnectionText } from '../components/ConnectionForm';
import { CaseLabel, Field, Section } from '../components/ui';
import { cs } from '../i18n/cs';
import { itemName } from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';
import { TryIt } from './CatalogEditor';

/** Editing tools on the item page for catalogue editors. */
export function ItemEditPanels({ item }: { item: Item }) {
  const s = useAppState();
  const user = useUser();
  const run = useProto((p) => p.run);
  const navigate = useNavigate();
  const dependants = usedBy(s, { itemId: item.id }).length;
  const saveItem = (patch: Partial<Item>) =>
    run((st) => {
      const r = upsertItem(st, user, { ...item, ...patch });
      return r.ok ? { ok: true, value: r.value.state } : r;
    }, cs.catalogEditor.saved);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <label className="btn cursor-pointer" title={cs.catalogEditor.photoHint}>
          {cs.catalogEditor.photoAdd}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label={cs.catalogEditor.photoAdd}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const reader = new FileReader();
              reader.onload = () =>
                saveItem({ photos: [...(item.photos ?? []), String(reader.result)] });
              reader.readAsDataURL(f);
            }}
          />
        </label>
        <button
          type="button"
          className="btn"
          onClick={() => {
            let id = '';
            const err = run((st) => {
              const r = duplicateItem(st, user, item.id, cs.catalogEditor.copyName(item.name));
              if (!r.ok) return r;
              id = r.value.itemId;
              return { ok: true, value: r.value.state };
            });
            if (!err) navigate(`/items/${id}`);
          }}
        >
          {cs.catalogEditor.duplicate}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => run((st) => setItemArchived(st, user, item.id, !item.archived))}
        >
          {item.archived ? cs.catalogEditor.restore : cs.catalogEditor.archive}
        </button>
        {dependants > 0 && !item.archived && (
          <span className="self-center text-xs text-warn">
            {cs.catalogEditor.usedByWarn(dependants)}
          </span>
        )}
      </div>
      <StockEditor item={item} />
      <StagePartEditor item={item} />
      <ConnectionBuilder item={item} />
      <TryIt initial={`${item.name} ×10`} />
    </div>
  );
}

function StockEditor({ item }: { item: Item }) {
  const s = useAppState();
  const user = useUser();
  const run = useProto((p) => p.run);
  return (
    <Section title={cs.catalogEditor.stockEdit}>
      <div className="grid gap-3 sm:grid-cols-2">
        {s.warehouses.map((w) => {
          const st = s.stock.find((x) => x.itemId === item.id && x.warehouseId === w.id);
          const shelves = s.locations.filter(
            (l) => l.warehouseId === w.id && !s.locations.some((c) => c.parentId === l.id),
          );
          return (
            <form
              key={`${w.id}-${st?.qty ?? 0}-${st?.homeLocationId ?? ''}`}
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                run(
                  (x) =>
                    setItemStock(
                      x,
                      user,
                      item.id,
                      w.id,
                      Number(fd.get('qty')),
                      String(fd.get('loc') || '') || undefined,
                    ),
                  cs.catalogEditor.saved,
                );
              }}
            >
              <Field label={`${w.name} — ${cs.catalogEditor.stockQty}`} htmlFor={`st-${w.id}`}>
                <input
                  id={`st-${w.id}`}
                  name="qty"
                  type="number"
                  min={0}
                  className="input w-20"
                  defaultValue={st?.qty ?? 0}
                />
              </Field>
              <Field label={cs.catalogEditor.stockLocation} htmlFor={`loc-${w.id}`}>
                <select
                  id={`loc-${w.id}`}
                  name="loc"
                  className="input w-auto"
                  defaultValue={st?.homeLocationId ?? shelves[0]?.id}
                >
                  {shelves.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.path}
                    </option>
                  ))}
                </select>
              </Field>
              <button type="submit" className="btn btn-sm">
                {cs.common.save}
              </button>
            </form>
          );
        })}
      </div>
    </Section>
  );
}

const PART_KINDS: StagePart['part'][] = ['deck', 'leg', 'skirt', 'rail', 'stairs'];

/** Marks the item as a part of a stage, so the stage calculator counts with it. */
function StagePartEditor({ item }: { item: Item }) {
  const user = useUser();
  const run = useProto((p) => p.run);
  const [kind, setKind] = useState<StagePart['part'] | ''>(item.stage?.part ?? '');
  const t = cs.stagePlan.part;
  const v = (k: string) => {
    const x = item.stage as Record<string, unknown> | undefined;
    // stored in millimetres, shown in metres
    return typeof x?.[k] === 'number' ? (x[k] as number) / 1000 : undefined;
  };
  const size = (name: string, label: string) => (
    <Field label={label} htmlFor={`sp-${name}`}>
      <input
        id={`sp-${name}`}
        name={name}
        type="number"
        min={0.01}
        step={0.01}
        required
        className="input w-28"
        defaultValue={v(name)}
      />
    </Field>
  );
  return (
    <Section title={t.title}>
      <form
        key={JSON.stringify(item.stage ?? null)}
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const n = (k: string) => Math.round(Number(fd.get(k)) * 1000);
          const stage: StagePart | undefined =
            kind === 'deck'
              ? { part: 'deck', widthMm: n('widthMm'), depthMm: n('depthMm') }
              : kind === 'leg'
                ? { part: 'leg', heightMm: n('heightMm') }
                : kind === 'skirt' || kind === 'rail'
                  ? { part: kind, lengthMm: n('lengthMm') }
                  : kind === 'stairs'
                    ? { part: 'stairs' }
                    : undefined;
          const next: Item = { ...item };
          delete next.stage;
          run((st) => {
            const r = upsertItem(st, user, stage ? { ...next, stage } : next);
            return r.ok ? { ok: true, value: r.value.state } : r;
          }, cs.catalogEditor.saved);
        }}
      >
        <Field label={t.kind} htmlFor="sp-kind">
          <select
            id="sp-kind"
            className="input w-auto"
            value={kind}
            onChange={(e) => setKind(e.target.value as StagePart['part'] | '')}
          >
            <option value="">{t.none}</option>
            {PART_KINDS.map((k) => (
              <option key={k} value={k}>
                {t.kinds[k]}
              </option>
            ))}
          </select>
        </Field>
        {kind === 'deck' && (
          <>
            {size('widthMm', t.width)}
            {size('depthMm', t.depth)}
          </>
        )}
        {kind === 'leg' && size('heightMm', t.height)}
        {(kind === 'skirt' || kind === 'rail') && size('lengthMm', t.length)}
        <button type="submit" className="btn btn-sm">
          {cs.common.save}
        </button>
      </form>
      <p className="mt-2 text-xs text-muted">{t.hint}</p>
    </Section>
  );
}

function ConnectionBuilder({ item }: { item: Item }) {
  const s = useAppState();
  const user = useUser();
  const run = useProto((p) => p.run);
  const existing = s.connections.filter((c) => c.fromItemId === item.id);
  const groups = [
    ...new Set(
      existing.filter((c) => c.groupId && c.groupMode === 'or').map((c) => c.groupId as string),
    ),
  ];
  return (
    <Section title={cs.catalogEditor.builderTitle}>
      <ul className="mb-3 divide-y divide-alu-line text-sm" data-testid="connection-list">
        {existing.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 py-1">
            <ConnectionText conn={c} />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => run((st) => removeConnection(st, user, c.id))}
            >
              {cs.catalogEditor.builderRemove}
            </button>
          </li>
        ))}
      </ul>
      <ConnectionForm
        excludeItemId={item.id}
        orGroups={groups}
        onAdd={(conn) =>
          !run((st) => {
            const r = addConnection(st, user, { ...conn, fromItemId: item.id });
            return r.ok ? { ok: true, value: r.value.state } : r;
          }, cs.catalogEditor.saved)
        }
      />
    </Section>
  );
}

/** Edit actual contents of the cases of a type. */
export function CaseEditor({ type }: { type: CaseType }) {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const cases = s.cases.filter((c) => c.caseTypeId === type.id && !c.archived);
  return (
    <Section title={cs.catalogEditor.caseEdit}>
      <ul className="space-y-3">
        {cases.map((c) => (
          <li key={`${c.id}-${JSON.stringify(c.contents)}`}>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const contents = type.contents.map((x) => ({
                  itemId: x.itemId,
                  qty: Number(fd.get(x.itemId)) || 0,
                }));
                run((st) => {
                  const r = upsertCase(st, user, { ...c, contents }, today);
                  return r.ok ? { ok: true, value: r.value.state } : r;
                }, cs.catalogEditor.saved);
              }}
            >
              <CaseLabel>{c.number}</CaseLabel>
              {type.contents.map((x) => (
                <label key={x.itemId} className="text-xs">
                  <span className="block text-muted">
                    {itemName(s, x.itemId)} / {x.qty}
                  </span>
                  <input
                    name={x.itemId}
                    type="number"
                    min={0}
                    className="input w-20"
                    defaultValue={c.contents.find((y) => y.itemId === x.itemId)?.qty ?? 0}
                    aria-label={`${c.number}: ${itemName(s, x.itemId)}`}
                  />
                </label>
              ))}
              <button type="submit" className="btn btn-sm">
                {cs.catalogEditor.caseSave}
              </button>
              {caseMissing(s, c).length > 0 && (
                <span className="text-xs text-bad">
                  {cs.catalog.incomplete(
                    caseMissing(s, c)
                      .map((m) => `${m.qty}× ${itemName(s, m.itemId)}`)
                      .join(', '),
                  )}
                </span>
              )}
            </form>
          </li>
        ))}
      </ul>
    </Section>
  );
}
