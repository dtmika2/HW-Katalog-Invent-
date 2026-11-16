import { useState } from 'react';
import { deleteCategory, upsertCategory, type AppState, type Category } from '@quix/core';
import {
  CATEGORY_COLOR_KEYS,
  CATEGORY_ICON_KEYS,
  CategoryIcon,
  CategoryLabel,
  Swatch,
} from '../components/Category';
import { Section } from '../components/ui';
import { cs } from '../i18n/cs';
import { useAppState, useProto, useUser } from '../store';

const asState = (r: ReturnType<typeof upsertCategory>) =>
  r.ok ? { ok: true as const, value: r.value.state } : r;

function NameInput({ c, onSave }: { c: Category; onSave: (name: string) => boolean }) {
  const [v, setV] = useState(c.name);
  return (
    <input
      className="input max-w-xs"
      aria-label={`${cs.categories.name}: ${c.name}`}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v.trim() !== c.name && !onSave(v)) setV(c.name);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function AddSub({ parent, onAdd }: { parent: Category; onAdd: (name: string) => boolean }) {
  const [v, setV] = useState('');
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (onAdd(v)) setV('');
      }}
    >
      <input
        className="input max-w-xs"
        aria-label={`${cs.categories.newSub}: ${parent.name}`}
        placeholder={cs.categories.newSub}
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <button type="submit" className="btn btn-sm" disabled={!v.trim()}>
        {cs.categories.add}
      </button>
    </form>
  );
}

/** Manage the two-level category tree: add, rename, icon, delete when empty. */
export function CategoryManager() {
  const s = useAppState();
  const user = useUser();
  const run = useProto((p) => p.run);
  const toast = useProto((p) => p.toast);
  const [newTop, setNewTop] = useState('');
  const tops = s.categories.filter((c) => !c.parentId);
  const count = (st: AppState, id: string) => st.items.filter((i) => i.categoryId === id).length;

  const save = (c: Category, patch: Partial<Category>) => {
    const next = { ...c, ...patch };
    const input: { id: string; name: string; parentId?: string; icon?: string; color?: string } = {
      id: c.id,
      name: next.name,
    };
    if (next.parentId) input.parentId = next.parentId;
    if (next.icon) input.icon = next.icon;
    if (next.color) input.color = next.color;
    return !run(
      (st) => asState(upsertCategory(st, user, input)),
      cs.categories.saved,
      cs.categories.nameTaken,
    );
  };

  const remove = (c: Category) => {
    const subs = s.categories.filter((x) => x.parentId === c.id).length;
    const items = count(s, c.id);
    if (subs > 0) return toast('error', cs.categories.deleteBlockedSubs(subs));
    if (items > 0) return toast('error', cs.categories.deleteBlockedItems(items));
    run((st) => deleteCategory(st, user, c.id), cs.categories.deleted);
  };

  return (
    <Section title={cs.catalogEditor.tabs.categories ?? ''}>
      <p className="mb-4 max-w-prose text-sm text-muted">{cs.categories.manageHint}</p>
      <ul className="space-y-4" data-testid="category-manager">
        {tops.map((t) => (
          <li key={t.id} className="rounded border border-alu-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <CategoryIcon icon={t.icon} className="h-5 w-5" />
              <NameInput key={t.name} c={t} onSave={(name) => save(t, { name })} />
              <select
                className="input w-auto"
                aria-label={`${cs.categories.icon}: ${t.name}`}
                value={t.icon ?? ''}
                onChange={(e) => save(t, { icon: e.target.value })}
              >
                <option value="">{cs.categories.noIcon}</option>
                {CATEGORY_ICON_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {cs.categories.icons[k] ?? k}
                  </option>
                ))}
              </select>
              <div
                className="flex items-center gap-1"
                role="radiogroup"
                aria-label={`${cs.categories.color}: ${t.name}`}
                title={cs.categories.colorHint}
              >
                {CATEGORY_COLOR_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={t.color === k}
                    aria-label={cs.categories.colors[k] ?? k}
                    onClick={() => save(t, { color: k })}
                    className={`grid h-6 w-6 place-items-center rounded-full border ${t.color === k ? 'border-ink' : 'border-transparent hover:border-alu-line'}`}
                  >
                    <Swatch color={k} className="h-4 w-4" />
                  </button>
                ))}
              </div>
              <CategoryLabel s={s} categoryId={t.id} link={false} />
              <span className="text-xs text-muted">{cs.categories.itemsCount(count(s, t.id))}</span>
              <button
                type="button"
                className="btn btn-sm btn-danger ml-auto"
                onClick={() => remove(t)}
              >
                {cs.categories.delete}
              </button>
            </div>
            <ul className="ml-7 mt-2 space-y-1 border-l border-alu-line pl-3">
              {s.categories
                .filter((c) => c.parentId === t.id)
                .map((sc) => (
                  <li key={sc.id} className="flex flex-wrap items-center gap-2">
                    <NameInput key={sc.name} c={sc} onSave={(name) => save(sc, { name })} />
                    <span className="text-xs text-muted">
                      {cs.categories.itemsCount(count(s, sc.id))}
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-label={`${cs.categories.delete}: ${sc.name}`}
                      onClick={() => remove(sc)}
                    >
                      {cs.categories.delete}
                    </button>
                  </li>
                ))}
              <li>
                <AddSub
                  parent={t}
                  onAdd={(name) =>
                    !run(
                      (st) => asState(upsertCategory(st, user, { name, parentId: t.id })),
                      cs.categories.created,
                      cs.categories.nameTaken,
                    )
                  }
                />
              </li>
            </ul>
          </li>
        ))}
      </ul>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !run(
              (st) => asState(upsertCategory(st, user, { name: newTop, icon: 'box' })),
              cs.categories.created,
              cs.categories.nameTaken,
            )
          )
            setNewTop('');
        }}
      >
        <input
          className="input max-w-xs"
          aria-label={cs.categories.newTop}
          placeholder={cs.categories.newTop}
          value={newTop}
          onChange={(e) => setNewTop(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={!newTop.trim()}>
          {cs.categories.add}
        </button>
      </form>
    </Section>
  );
}
