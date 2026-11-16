import { useMemo, useState } from 'react';
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
  type ConnectionKind,
  type Item,
  type QtyRule,
  type Target,
} from '@quix/core';
import { CaseLabel, Field, Section } from '../components/ui';
import { cs } from '../i18n/cs';
import { itemName, targetName } from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';
import { TryIt } from './CatalogEditor';

const KINDS: ConnectionKind[] = ['required', 'check', 'recommended'];
const RULES: QtyRule[] = ['per_piece', 'per_n', 'once_per_order'];

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

function ConnectionBuilder({ item }: { item: Item }) {
  const s = useAppState();
  const user = useUser();
  const run = useProto((p) => p.run);
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<Target | undefined>();
  const [kind, setKind] = useState<ConnectionKind>('required');
  const [rule, setRule] = useState<QtyRule>('per_piece');
  const [n, setN] = useState(8);
  const [qty, setQty] = useState(1);
  const [group, setGroup] = useState('');
  const [mode, setMode] = useState<'and' | 'or'>('or');
  const [parent, setParent] = useState('');
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2 || target) return [];
    return [
      ...s.caseTypes
        .filter((t) => t.name.toLowerCase().includes(needle))
        .map((t) => ({ target: { caseTypeId: t.id } as Target, name: t.name })),
      ...s.items
        .filter((i) => !i.archived && i.id !== item.id && i.name.toLowerCase().includes(needle))
        .map((i) => ({ target: { itemId: i.id } as Target, name: i.name })),
    ].slice(0, 8);
  }, [q, s, item.id, target]);
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
            <span>
              <span className="text-xs text-muted">{cs.catalog.kind[c.kind]}:</span>{' '}
              {targetName(s, c.target)}{' '}
              <span className="text-xs text-muted">
                {cs.catalog.rule(c.rule, c.n, c.qty)}
                {c.groupId
                  ? ` · ${c.groupId}${c.groupMode ? ` (${cs.catalogEditor.builderMode[c.groupMode]})` : ''}`
                  : ''}
              </span>
            </span>
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
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={cs.catalogEditor.builderTarget} htmlFor="cb-target">
          <input
            id="cb-target"
            className="input"
            placeholder={cs.catalogEditor.builderTargetPh}
            value={target ? targetName(s, target) : q}
            onChange={(e) => {
              setTarget(undefined);
              setQ(e.target.value);
            }}
          />
          {matches.length > 0 && (
            <ul className="mt-1 rounded border border-alu-line bg-white" role="listbox">
              {matches.map((m) => (
                <li key={m.name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="w-full px-2 py-1 text-left text-sm hover:bg-alu"
                    onClick={() => setTarget(m.target)}
                  >
                    {m.name}{' '}
                    {'caseTypeId' in m.target && <CaseLabel>{cs.editor.caseTag}</CaseLabel>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Field>
        <Field label={cs.catalogEditor.builderKind} htmlFor="cb-kind">
          <select
            id="cb-kind"
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value as ConnectionKind)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {cs.catalog.kind[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={cs.catalogEditor.builderRule} htmlFor="cb-rule">
          <span className="flex gap-2">
            <input
              aria-label={cs.catalogEditor.builderQty}
              type="number"
              min={1}
              className="input w-16"
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
            />
            <select
              id="cb-rule"
              className="input"
              value={rule}
              onChange={(e) => setRule(e.target.value as QtyRule)}
            >
              {RULES.map((r) => (
                <option key={r} value={r}>
                  {cs.catalogEditor.builderRules[r]}
                </option>
              ))}
            </select>
            {rule === 'per_n' && (
              <input
                aria-label={cs.catalogEditor.builderN}
                type="number"
                min={1}
                className="input w-16"
                value={n}
                onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))}
              />
            )}
          </span>
        </Field>
        <Field label={cs.catalogEditor.builderGroup} htmlFor="cb-group">
          <span className="flex gap-2">
            <input
              id="cb-group"
              className="input"
              title={cs.catalogEditor.builderGroupHint}
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            />
            <select
              aria-label={cs.catalogEditor.builderGroup}
              className="input w-auto"
              value={mode}
              onChange={(e) => setMode(e.target.value as 'and' | 'or')}
              disabled={!group}
            >
              <option value="or">{cs.catalogEditor.builderMode.or}</option>
              <option value="and">{cs.catalogEditor.builderMode.and}</option>
            </select>
          </span>
        </Field>
        {group && mode === 'and' && groups.length > 0 && (
          <Field label={cs.catalogEditor.builderParent} htmlFor="cb-parent">
            <select
              id="cb-parent"
              className="input"
              value={parent}
              onChange={(e) => setParent(e.target.value)}
            >
              <option value="" />
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <button
        type="button"
        className="btn btn-primary mt-3"
        disabled={!target}
        onClick={() => {
          if (!target) return;
          const err = run((st) => {
            const r = addConnection(st, user, {
              fromItemId: item.id,
              target,
              kind,
              rule,
              qty,
              ...(rule === 'per_n' ? { n } : {}),
              ...(group.trim() ? { groupId: group.trim(), groupMode: mode } : {}),
              ...(group.trim() && parent ? { parentGroupId: parent } : {}),
            });
            return r.ok ? { ok: true, value: r.value.state } : r;
          }, cs.catalogEditor.saved);
          if (!err) {
            setTarget(undefined);
            setQ('');
          }
        }}
      >
        {cs.catalogEditor.builderAdd}
      </button>
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
