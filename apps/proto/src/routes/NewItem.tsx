import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  can,
  createItem,
  expand,
  type AppState,
  type DomainError,
  type Item,
  type NewItemInput,
} from '@quix/core';
import { ConnectionForm, ConnectionText, type NewConnection } from '../components/ConnectionForm';
import { CaseLabel, Empty, Field, Section } from '../components/ui';
import { cs } from '../i18n/cs';
import { targetName } from '../lib/names';
import { useAppState, useProto, useUser } from '../store';

const t = cs.catalogEditor.newItemPage;

/** Leaf locations (shelves) of a warehouse: where an item lives. */
const shelvesOf = (s: AppState, warehouseId: string) =>
  s.locations.filter(
    (l) => l.warehouseId === warehouseId && !s.locations.some((c) => c.parentId === l.id),
  );

/** A readable Czech message for a `createItem` error. */
function errorText(s: AppState, e: DomainError): string {
  const field = String(e.details?.field ?? '');
  const msg = t.fieldError[field] ?? cs.errors[e.code] ?? e.message;
  if (typeof e.details?.connection === 'number')
    return t.connectionError(e.details.connection + 1, msg);
  if (typeof e.details?.warehouseId === 'string') {
    const w = s.warehouses.find((x) => x.id === e.details?.warehouseId);
    return t.stockError(w?.name ?? String(e.details.warehouseId), msg);
  }
  return msg;
}

/** "Nová položka": an item with its stock and all its connections, saved in one step. */
export function NewItem() {
  const s = useAppState();
  const user = useUser();
  const run = useProto((p) => p.run);
  const toast = useProto((p) => p.toast);
  const navigate = useNavigate();
  const tops = s.categories.filter((c) => !c.parentId);
  const firstCategory = s.categories.find((c) => c.parentId)?.id ?? tops[0]?.id ?? '';

  const [name, setName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [categoryId, setCategoryId] = useState(firstCategory);
  const [price, setPrice] = useState('0');
  const [weight, setWeight] = useState('');
  const [consumable, setConsumable] = useState(false);
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<string | undefined>();
  const [stock, setStock] = useState(() =>
    Object.fromEntries(
      s.warehouses.map((w) => [w.id, { qty: '0', loc: shelvesOf(s, w.id)[0]?.id ?? '' }]),
    ),
  );
  const [connections, setConnections] = useState<NewConnection[]>([]);
  const [previewQty, setPreviewQty] = useState(1);
  const [error, setError] = useState<string | undefined>();

  const input = (): NewItemInput => {
    const item: Item = {
      id: '',
      name,
      manufacturer: manufacturer.trim(),
      model: model.trim(),
      categoryId,
      priceDay: price.trim() === '' ? 0 : Number(price.replace(',', '.')),
      returnable: !consumable,
      archived: false,
    };
    if (weight.trim()) item.weightKg = Number(weight.replace(',', '.'));
    if (notes.trim()) item.notes = notes.trim();
    if (photo) item.photos = [photo];
    return {
      item,
      stock: s.warehouses.map((w) => ({
        warehouseId: w.id,
        qty: Number(stock[w.id]?.qty || 0),
        ...(stock[w.id]?.loc ? { homeLocationId: stock[w.id]?.loc } : {}),
      })),
      connections,
    };
  };

  // What the engine would add for a few pieces of the new item, before anything is saved.
  const preview = useMemo(() => {
    if (connections.length === 0) return undefined;
    const base = input();
    const r = createItem(s, user, {
      ...base,
      item: { ...base.item, name: name.trim() || cs.catalogEditor.newItemName, priceDay: 0 },
      stock: [],
    });
    if (!r.ok) return undefined;
    const e = expand(
      [
        {
          id: 'preview',
          target: { itemId: r.value.itemId },
          qty: previewQty,
          origin: 'manual',
          parentLineIds: [],
          status: 'ok',
          conflictAck: false,
        },
      ],
      r.value.state,
    );
    return { e, state: r.value.state };
  }, [s, user, connections, previewQty, name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!can(user, 'edit_catalogue')) {
    return (
      <div className="space-y-4">
        <h1>{cs.catalogEditor.newItem}</h1>
        <Empty>{t.forbidden}</Empty>
      </div>
    );
  }

  const orGroups = [
    ...new Set(
      connections.filter((c) => c.groupId && c.groupMode === 'or').map((c) => c.groupId as string),
    ),
  ];

  const save = () => {
    const data = input();
    const check = createItem(s, user, data);
    if (!check.ok) {
      const text = errorText(s, check.error);
      setError(text);
      toast('error', text);
      return;
    }
    setError(undefined);
    const err = run(() => ({ ok: true, value: check.value.state }), t.created(name.trim()));
    if (!err) navigate(`/items/${check.value.itemId}`);
  };

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>{cs.catalogEditor.newItem}</h1>
        <Link to="/catalog" className="btn btn-sm">
          {t.cancel}
        </Link>
      </div>
      <p className="text-sm text-muted">{t.intro}</p>

      <Section title={t.basics}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={cs.catalogEditor.col.name} htmlFor="ni-name">
            <input
              id="ni-name"
              className="input"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={cs.catalogEditor.col.manufacturer} htmlFor="ni-manufacturer">
            <input
              id="ni-manufacturer"
              className="input"
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
            />
          </Field>
          <Field label={cs.catalogEditor.col.model} htmlFor="ni-model">
            <input
              id="ni-model"
              className="input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </Field>
          <Field label={cs.catalogEditor.col.category} htmlFor="ni-category">
            <select
              id="ni-category"
              className="input"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              {tops.map((top) => {
                const subs = s.categories.filter((c) => c.parentId === top.id);
                return (
                  <optgroup key={top.id} label={top.name}>
                    {(subs.length > 0 ? subs : [top]).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </Field>
          <Field label={t.price} htmlFor="ni-price">
            <input
              id="ni-price"
              type="number"
              min={0}
              step="any"
              className="input"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <Field label={t.weight} htmlFor="ni-weight">
            <input
              id="ni-weight"
              type="number"
              min={0}
              step="any"
              className="input"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </Field>
          <Field label={t.notes} htmlFor="ni-notes">
            <textarea
              id="ni-notes"
              className="input"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <Field label={t.photo} htmlFor="ni-photo">
            {photo ? (
              <span className="flex items-center gap-2">
                <img src={photo} alt="" className="h-12 w-12 rounded object-cover" />
                <button type="button" className="btn btn-sm" onClick={() => setPhoto(undefined)}>
                  {t.photoRemove}
                </button>
              </span>
            ) : (
              <input
                id="ni-photo"
                type="file"
                accept="image/*"
                capture="environment"
                className="text-sm"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = () => setPhoto(String(reader.result));
                  reader.readAsDataURL(f);
                }}
              />
            )}
          </Field>
          <label className="flex items-center gap-2 self-end text-sm">
            <input
              type="checkbox"
              checked={consumable}
              onChange={(e) => setConsumable(e.target.checked)}
            />
            {t.consumable}
          </label>
        </div>
      </Section>

      <Section title={t.stock}>
        <div className="grid gap-3 sm:grid-cols-2">
          {s.warehouses.map((w) => (
            <div key={w.id} className="flex flex-wrap items-end gap-2">
              <Field label={`${w.name} — ${cs.catalogEditor.stockQty}`} htmlFor={`ni-st-${w.id}`}>
                <input
                  id={`ni-st-${w.id}`}
                  type="number"
                  min={0}
                  step={1}
                  className="input w-20"
                  value={stock[w.id]?.qty ?? '0'}
                  onChange={(e) =>
                    setStock((x) => ({
                      ...x,
                      [w.id]: { loc: x[w.id]?.loc ?? '', qty: e.target.value },
                    }))
                  }
                />
              </Field>
              <Field label={cs.catalogEditor.stockLocation} htmlFor={`ni-loc-${w.id}`}>
                <select
                  id={`ni-loc-${w.id}`}
                  className="input w-auto"
                  value={stock[w.id]?.loc ?? ''}
                  onChange={(e) =>
                    setStock((x) => ({
                      ...x,
                      [w.id]: { qty: x[w.id]?.qty ?? '0', loc: e.target.value },
                    }))
                  }
                >
                  {shelvesOf(s, w.id).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.path}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">{t.stockHint}</p>
      </Section>

      <Section title={t.connections}>
        <p className="mb-2 text-xs text-muted">{t.connectionsHint}</p>
        {connections.length === 0 ? (
          <Empty>{t.noConnections}</Empty>
        ) : (
          <>
            <p className="text-xs font-medium text-muted">
              {t.connectionsCount(connections.length)}
            </p>
            <ul className="mb-3 divide-y divide-alu-line text-sm" data-testid="new-connection-list">
              {connections.map((c, i) => (
                <li
                  key={`${i}-${JSON.stringify(c.target)}`}
                  className="flex items-center justify-between gap-2 py-1"
                >
                  <ConnectionText conn={c} />
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setConnections((xs) => xs.filter((_, j) => j !== i))}
                  >
                    {cs.catalogEditor.builderRemove}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="mt-3 border-t border-alu-line pt-3">
          <ConnectionForm
            orGroups={orGroups}
            onAdd={(c) => {
              setConnections((xs) => [...xs, c]);
              return true;
            }}
          />
        </div>
      </Section>

      {preview && (
        <Section
          title={t.preview}
          actions={
            <label className="flex items-center gap-2 text-xs">
              {t.previewQty}
              <input
                type="number"
                min={1}
                className="input w-16"
                value={previewQty}
                onChange={(e) => setPreviewQty(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
          }
        >
          <div className="text-sm" data-testid="new-item-preview">
            {preview.e.lines.filter((l) => l.origin === 'auto').length === 0 ? (
              <Empty>{t.previewNothing}</Empty>
            ) : (
              <ul className="space-y-0.5">
                {preview.e.lines
                  .filter((l) => l.origin === 'auto')
                  .map((l) => (
                    <li key={l.id}>
                      {l.qty}× {targetName(preview.state, l.target as { itemId: string })}{' '}
                      {'caseTypeId' in l.target && <CaseLabel>{cs.editor.caseTag}</CaseLabel>}
                    </li>
                  ))}
              </ul>
            )}
            {preview.e.orChoices.length > 0 && (
              <ul className="mt-2 text-xs text-muted">
                {preview.e.orChoices.map((o) => (
                  <li key={o.groupKey}>
                    {cs.editor.orTitle(name.trim() || cs.catalogEditor.newItem)}:{' '}
                    {o.options
                      .map((op) =>
                        op.targets.map((x) => targetName(preview.state, x.target)).join(' + '),
                      )
                      .join(' / ')}
                  </li>
                ))}
              </ul>
            )}
            {preview.e.checkWarnings.map((w) => (
              <p key={w.key} className="mt-2 text-xs">
                {cs.editor.checksTitle}{' '}
                {w.candidates.map((c) => targetName(preview.state, c.target)).join(', ')}
              </p>
            ))}
            {preview.e.recommendations.length > 0 && (
              <p className="mt-2 text-xs text-muted">
                {cs.editor.recsTitle}:{' '}
                {preview.e.recommendations
                  .map((r) => targetName(preview.state, r.target))
                  .join(', ')}
              </p>
            )}
          </div>
        </Section>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-bad">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary">
          {t.save}
        </button>
        <Link to="/catalog" className="btn">
          {t.cancel}
        </Link>
      </div>
    </form>
  );
}
