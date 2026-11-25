/** The booking's list: toolbar (sort, filter, new group), groups and nested lines. */
import { useState, type ReactNode } from 'react';
import {
  addGroup,
  bookingPriceTotal,
  effectiveQty,
  flattenNodes,
  lineTree,
  moveGroup,
  removeGroup,
  renameGroup,
  type AppState,
  type Booking,
  type BookingGroup,
  type LineAvailability,
  type LineNode,
  type OrChoiceInfo,
  type User,
} from '@quix/core';
import { cs } from '../../i18n/cs';
import { lineName } from '../../lib/names';
import { Empty, Field } from '../ui';
import { useDragState } from './drag';
import { LineRow } from './LineRow';
import { DEFAULT_VIEW, isFiltered, SORTS, usedCategories, viewTree, type ListView } from './view';

interface Props {
  s: AppState;
  booking: Booking;
  av: Map<string, LineAvailability>;
  orChoices: OrChoiceInfo[];
  editable: boolean;
  user: User;
  update: (b: Booking) => void;
  view: ListView;
  setView: (v: ListView) => void;
}

function NewGroup({ booking, update }: { booking: Booking; update: (b: Booking) => void }) {
  const [name, setName] = useState<string | undefined>();
  if (name === undefined)
    return (
      <button type="button" className="btn" onClick={() => setName('')}>
        {cs.lines.newGroup}
      </button>
    );
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const r = addGroup(booking, name);
        if (!r.groupId) return;
        update(r.booking);
        setName(undefined);
      }}
      onKeyDown={(e) => e.key === 'Escape' && setName(undefined)}
    >
      <Field label={cs.lines.groupName} htmlFor="ln-newgroup">
        <input
          id="ln-newgroup"
          className="input w-56"
          autoFocus
          placeholder={cs.lines.groupNameHint}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
        {cs.common.add}
      </button>
      <button type="button" className="btn" onClick={() => setName(undefined)}>
        {cs.common.cancel}
      </button>
    </form>
  );
}

function Toolbar({
  s,
  booking,
  editable,
  update,
  view,
  setView,
  shown,
}: Props & { shown: number }) {
  const filtered = isFiltered(view);
  return (
    <div data-testid="list-toolbar" className="mb-3 space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={cs.lines.sort} htmlFor="ln-sort">
          <select
            id="ln-sort"
            className="input w-auto"
            value={view.sort}
            onChange={(e) => setView({ ...view, sort: e.target.value as ListView['sort'] })}
          >
            {SORTS.map((k) => (
              <option key={k} value={k}>
                {cs.lines.sorts[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={cs.lines.category} htmlFor="ln-cat">
          <select
            id="ln-cat"
            className="input w-auto max-w-56"
            value={view.category}
            onChange={(e) => setView({ ...view, category: e.target.value })}
          >
            <option value="">{cs.lines.allCategories}</option>
            {usedCategories(s, booking).map((c) => (
              <option key={c.id} value={c.id}>
                {c.sub ? `› ${c.name}` : c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={cs.common.search} htmlFor="ln-text">
          <input
            id="ln-text"
            type="search"
            className="input w-40"
            value={view.text}
            onChange={(e) => setView({ ...view, text: e.target.value })}
          />
        </Field>
        {editable && <NewGroup booking={booking} update={update} />}
      </div>
      {filtered && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-tape/40 bg-tape-light px-3 py-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={view.attached}
              onChange={(e) => setView({ ...view, attached: e.target.checked })}
            />
            {cs.lines.attached}
          </label>
          <span data-testid="shown-count" className="text-xs text-muted">
            {cs.lines.shown(shown, booking.lines.length)}
          </span>
          <button
            type="button"
            className="text-xs text-tape underline"
            onClick={() => setView({ ...DEFAULT_VIEW, sort: view.sort, attached: view.attached })}
          >
            {cs.lines.clearFilter}
          </button>
        </div>
      )}
    </div>
  );
}

/** Strip that appears in a group while dragging, so a line can be dropped at its top level. */
function DropStrip({ dropKey, text }: { dropKey: string; text: string }) {
  const { payload, over } = useDragState();
  if (!payload) return null;
  return (
    <div
      className={`my-1 rounded border-2 border-dashed px-3 py-2 text-center text-xs ${
        over === dropKey ? 'border-tape bg-tape-light font-semibold' : 'border-alu-line text-muted'
      }`}
    >
      {text}
    </div>
  );
}

function GroupHeader({
  s,
  booking,
  group,
  nodes,
  editable,
  update,
  collapsed,
  toggle,
}: {
  s: AppState;
  booking: Booking;
  group: BookingGroup | undefined;
  nodes: LineNode[];
  editable: boolean;
  update: (b: Booking) => void;
  collapsed: boolean;
  toggle: () => void;
}) {
  const [name, setName] = useState<string | undefined>();
  const [deleting, setDeleting] = useState(false);
  const groups = booking.groups ?? [];
  const index = group ? groups.findIndex((g) => g.id === group.id) : -1;
  const lines = flattenNodes(nodes).map((n) => n.line);
  const active = lines.filter((l) => l.status === 'ok' && effectiveQty(l) > 0);
  const subtotal = bookingPriceTotal(s, { periods: booking.periods, lines });
  const label = group?.name ?? cs.lines.noGroup;
  return (
    <div className="rounded bg-alu px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          className="grid h-6 w-6 shrink-0 place-items-center rounded hover:bg-alu-dark"
          aria-expanded={!collapsed}
          aria-label={collapsed ? cs.lines.expand(label) : cs.lines.collapse(label)}
          onClick={toggle}
        >
          <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        </button>
        {group && name !== undefined ? (
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              update(renameGroup(booking, group.id, name));
              setName(undefined);
            }}
          >
            <input
              className="input min-h-7 w-48 py-0"
              aria-label={cs.lines.groupName}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setName(undefined)}
            />
            <button type="submit" className="btn btn-sm" disabled={!name.trim()}>
              {cs.common.save}
            </button>
          </form>
        ) : (
          <h3 className={`font-cond text-base font-bold ${group ? '' : 'text-muted'}`}>{label}</h3>
        )}
        <span className="text-xs text-muted">
          {cs.lines.groupInfo(active.length, cs.common.czk(subtotal))}
        </span>
        {editable && group && name === undefined && (
          <span className="ml-auto flex flex-wrap gap-1">
            <button
              type="button"
              className="btn btn-sm"
              disabled={index <= 0}
              aria-label={cs.lines.groupUp(label)}
              onClick={() => update(moveGroup(booking, group.id, -1))}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={index >= groups.length - 1}
              aria-label={cs.lines.groupDown(label)}
              onClick={() => update(moveGroup(booking, group.id, 1))}
            >
              ↓
            </button>
            <button
              type="button"
              className="btn btn-sm"
              aria-label={cs.lines.groupRename(label)}
              onClick={() => setName(group.name)}
            >
              {cs.lines.rename}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              aria-label={cs.lines.groupDelete(label)}
              onClick={() =>
                lines.length > 0 ? setDeleting(true) : update(removeGroup(booking, group.id))
              }
            >
              {cs.lines.delete}
            </button>
          </span>
        )}
      </div>
      {group && deleting && (
        <div role="alertdialog" className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          {cs.lines.groupDeleteAsk}
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => update(removeGroup(booking, group.id))}
          >
            {cs.lines.groupDeleteYes}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setDeleting(false)}>
            {cs.common.cancel}
          </button>
        </div>
      )}
    </div>
  );
}

export function LineList(props: Props) {
  const { s, booking, av, editable, update, view, setView } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { over } = useDragState();
  const { groups, shown } = viewTree(s, booking, view, av);
  const full = lineTree(booking);
  const named = (booking.groups ?? []).length > 0;
  const filtered = isFiltered(view);
  const names = new Map(booking.lines.map((l) => [l.id, lineName(s, l)]));

  const render = (n: LineNode): ReactNode => (
    <li key={n.line.id}>
      <LineRow {...props} line={n.line} depth={n.depth} name={names.get(n.line.id) ?? ''} />
      {n.children.length > 0 && <ul>{n.children.map(render)}</ul>}
    </li>
  );

  if (booking.lines.length === 0 && !named)
    return (
      <div data-drop="group:">
        {editable && (
          <div className="mb-3">
            <NewGroup booking={booking} update={update} />
          </div>
        )}
        <Empty>{cs.editor.noLines}</Empty>
        <DropStrip dropKey="group:" text={cs.lines.dropFree} />
      </div>
    );

  return (
    <>
      <Toolbar {...props} shown={shown} />
      <div data-testid="lines" className="space-y-3">
        {groups.map((g) => {
          const id = g.group?.id ?? '';
          const dropKey = `group:${id}`;
          const all = full.find((x) => x.group?.id === g.group?.id)?.roots ?? [];
          // without a filter an empty "no group" section is only noise
          if (filtered && g.roots.length === 0) return null;
          const isClosed = collapsed.has(id);
          return (
            <section
              key={id || 'none'}
              data-drop={dropKey}
              data-testid={g.group ? `group-${id}` : 'group-none'}
              className={over === dropKey ? 'rounded ring-2 ring-tape' : ''}
            >
              {named && (
                <GroupHeader
                  s={s}
                  booking={booking}
                  group={g.group}
                  nodes={all}
                  editable={editable}
                  update={update}
                  collapsed={isClosed}
                  toggle={() => {
                    const next = new Set(collapsed);
                    if (isClosed) next.delete(id);
                    else next.add(id);
                    setCollapsed(next);
                  }}
                />
              )}
              {!isClosed && (
                <>
                  {g.roots.length > 0 ? (
                    <ul className="divide-y divide-alu-line">{g.roots.map(render)}</ul>
                  ) : (
                    g.group && <p className="px-2 py-2 text-xs text-muted">{cs.lines.groupEmpty}</p>
                  )}
                  <DropStrip
                    dropKey={dropKey}
                    text={g.group ? cs.lines.dropGroup(g.group.name) : cs.lines.dropFree}
                  />
                </>
              )}
            </section>
          );
        })}
        {shown === 0 && (
          <p className="text-sm text-muted">
            {cs.lines.nothing}{' '}
            <button
              type="button"
              className="text-tape underline"
              onClick={() => setView({ ...DEFAULT_VIEW, sort: view.sort })}
            >
              {cs.lines.clearFilter}
            </button>
          </p>
        )}
      </div>
    </>
  );
}
