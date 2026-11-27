import { useMemo, useState } from 'react';
import type { Connection, ConnectionKind, QtyRule, Target } from '@quix/core';
import { cs } from '../i18n/cs';
import { targetName } from '../lib/names';
import { useAppState } from '../store';
import { CaseLabel, Field } from './ui';

const KINDS: ConnectionKind[] = ['required', 'check', 'recommended'];
const RULES: QtyRule[] = ['per_piece', 'per_n', 'once_per_order'];

export type NewConnection = Omit<Connection, 'id' | 'fromItemId'>;

/**
 * The connection builder fields: search the target, choose kind, quantity rule and AND/OR
 * group. `onAdd` returns true when the connection was taken, which clears the target.
 */
export function ConnectionForm({
  excludeItemId,
  orGroups,
  onAdd,
}: {
  /** The item the connection starts from (it cannot point at itself). */
  excludeItemId?: string;
  /** Existing OR groups of the item, offered as parents of a nested AND group. */
  orGroups: string[];
  onAdd: (conn: NewConnection) => boolean;
}) {
  const s = useAppState();
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
        .filter((t) => !t.archived && t.name.toLowerCase().includes(needle))
        .map((t) => ({ target: { caseTypeId: t.id } as Target, name: t.name })),
      ...s.items
        .filter(
          (i) => !i.archived && i.id !== excludeItemId && i.name.toLowerCase().includes(needle),
        )
        .map((i) => ({ target: { itemId: i.id } as Target, name: i.name })),
    ].slice(0, 8);
  }, [q, s, excludeItemId, target]);
  return (
    <>
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
        {group && mode === 'and' && orGroups.length > 0 && (
          <Field label={cs.catalogEditor.builderParent} htmlFor="cb-parent">
            <select
              id="cb-parent"
              className="input"
              value={parent}
              onChange={(e) => setParent(e.target.value)}
            >
              <option value="" />
              {orGroups.map((g) => (
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
          const taken = onAdd({
            target,
            kind,
            rule,
            qty,
            ...(rule === 'per_n' ? { n } : {}),
            ...(group.trim() ? { groupId: group.trim(), groupMode: mode } : {}),
            ...(group.trim() && mode === 'and' && parent ? { parentGroupId: parent } : {}),
          });
          if (taken) {
            setTarget(undefined);
            setQ('');
          }
        }}
      >
        {cs.catalogEditor.builderAdd}
      </button>
    </>
  );
}

/** One connection as a line of text: "Povinné: Clamp 1× na každý kus · rig (jedna z)". */
export function ConnectionText({ conn }: { conn: NewConnection }) {
  const s = useAppState();
  return (
    <span>
      <span className="text-xs text-muted">{cs.catalog.kind[conn.kind]}:</span>{' '}
      {targetName(s, conn.target)}{' '}
      <span className="text-xs text-muted">
        {cs.catalog.rule(conn.rule, conn.n, conn.qty)}
        {conn.groupId
          ? ` · ${conn.groupId}${conn.groupMode ? ` (${cs.catalogEditor.builderMode[conn.groupMode]})` : ''}`
          : ''}
      </span>
    </span>
  );
}
