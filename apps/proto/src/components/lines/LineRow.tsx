/** One line of a booking's list: name, badge, count, hints, choices and what can be done with it. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addDays,
  can,
  canLeave,
  canNest,
  chooseOr,
  clearOverride,
  effectiveQty,
  firstBookedFrom,
  flattenNodes,
  followAgain,
  groupOfLine,
  lastBookedUntil,
  lineTree,
  markLine,
  moveToGroup,
  nestedByHand,
  nestLine,
  parentMap,
  removeLine,
  setLineQty,
  setLineSource,
  unnestLine,
  type AppState,
  type Booking,
  type BookingLine,
  type LineAvailability,
  type OrChoiceInfo,
  type User,
} from '@quix/core';
import { cs, fmtDate } from '../../i18n/cs';
import {
  caseTypeName,
  isCaseLine,
  itemName,
  lineCategoryId,
  lineName,
  targetName,
  userName,
} from '../../lib/names';
import { CategoryLabel } from '../Category';
import { LateTag } from '../LateItem';
import { AvailabilityBadge, CaseLabel } from '../ui';
import { DragHandle, useDragState } from './drag';

export function LineRow({
  s,
  booking,
  av,
  orChoices,
  editable,
  user,
  update,
  line,
  depth,
  name,
}: {
  s: AppState;
  booking: Booking;
  av: Map<string, LineAvailability>;
  orChoices: OrChoiceInfo[];
  editable: boolean;
  user: User;
  update: (b: Booking) => void;
  line: BookingLine;
  depth: number;
  name: string;
}) {
  const [moving, setMoving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { payload, over } = useDragState();
  const a = av.get(line.id);
  const categoryId = lineCategoryId(s, line);
  const isAuto = line.origin === 'auto';
  const isExt = 'external' in line.target;
  const qty = line.overriddenQty ?? line.qty;
  const parents = line.parentLineIds
    .map((p) => booking.lines.find((x) => x.id === p))
    .filter((p): p is BookingLine => !!p)
    .map((p) => `${lineName(s, p)} ×${p.overriddenQty ?? p.qty}`);
  const groups = orChoices.filter((o) => o.parentLineId === line.id);
  const sources = sourceOptions(s, booking, line);
  const isChief = user.role === 'chief';
  // a required line stays with what needs it; a shared one may go to the other
  const movable = canLeave(line) || line.parentLineIds.length > 1;
  const follows = line.followsCheck;
  const below = removing ? nestedByHand(booking, line.id).length : 0;

  return (
    <div
      data-testid={`line-${line.id}`}
      data-line-name={name}
      data-drop={`line:${line.id}`}
      className={`py-2 ${line.status !== 'ok' ? 'opacity-60' : ''} ${
        over === `line:${line.id}` ? 'rounded bg-tape-light ring-2 ring-tape' : ''
      } ${payload?.kind === 'line' && payload.id === line.id ? 'opacity-40' : ''}`}
      style={{ paddingLeft: `${Math.min(depth, 4) * 1.25}rem` }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {depth > 0 && (
          <span aria-hidden="true" className="text-muted">
            └
          </span>
        )}
        {editable && movable && (
          <DragHandle payload={{ kind: 'line', id: line.id, label: name }} title={cs.lines.drag} />
        )}
        {isExt ? (
          <span className="font-cond text-[15px] font-semibold">{name}</span>
        ) : (
          <Link
            to={
              'itemId' in line.target
                ? `/items/${line.target.itemId}`
                : `/case-types/${(line.target as { caseTypeId: string }).caseTypeId}`
            }
            className={`font-cond text-[15px] font-semibold hover:underline ${line.status !== 'ok' ? 'line-through' : ''}`}
          >
            {name}
          </Link>
        )}
        {isCaseLine(line) && <CaseLabel>{cs.editor.caseTag}</CaseLabel>}
        {/* not a link: a click would leave the editor and lose unsaved changes */}
        {categoryId && <CategoryLabel s={s} categoryId={categoryId} link={false} />}
        {line.late && <LateTag />}
        {isAuto && (
          <span className="rounded bg-alu px-1.5 text-[11px] font-medium text-muted">
            {cs.editor.autoTag}
          </span>
        )}
        {isExt && (
          <span className="rounded bg-tape-light px-1.5 text-[11px] font-medium text-tape-dark">
            {cs.editor.externalTag}{' '}
            {cs.editor.externalFrom(
              (line.target as { external: { supplier: string } }).external.supplier,
            )}
          </span>
        )}
        {line.status === 'missing' && (
          <span className="text-xs text-bad">{cs.editor.statusMissing}</span>
        )}
        {line.status === 'substituted' && (
          <span className="text-xs text-warn">{cs.editor.statusSubstituted}</span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <AvailabilityBadge
            a={a}
            isCase={isCaseLine(line)}
            caseName={a?.breaksCase ? caseTypeName(s, a.breaksCase.caseTypeId) : undefined}
          />
          <input
            type="number"
            min={0}
            className="input w-20 text-right"
            aria-label={`${cs.common.qty} ${name}`}
            value={qty}
            disabled={!editable || isExt}
            onChange={(e) => update(setLineQty(s, booking, line.id, Number(e.target.value) || 0))}
          />
        </span>
      </div>
      {(parents.length > 0 || line.note || follows || line.overriddenQty !== undefined) && (
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
          {parents.length > 0 && <span>{cs.editor.forHint(parents.join(', '))}</span>}
          {line.overriddenQty !== undefined && (
            <span className="text-warn">
              {cs.editor.overridden(line.qty)}
              {editable && (
                <button
                  type="button"
                  className="ml-1 underline"
                  onClick={() => update(clearOverride(s, booking, line.id))}
                >
                  {cs.editor.resetOverride}
                </button>
              )}
            </span>
          )}
          {follows && !follows.byHand && (
            <span>{cs.lines.follows(itemName(s, follows.fromItemId))}</span>
          )}
          {follows?.byHand && (
            <span className="text-warn">
              {cs.lines.byHand}
              {editable && (
                <button
                  type="button"
                  className="ml-1 underline"
                  onClick={() => update(followAgain(s, booking, line.id))}
                >
                  {cs.lines.followAgain(itemName(s, follows.fromItemId))}
                </button>
              )}
            </span>
          )}
          {line.note && <span>{line.note}</span>}
        </div>
      )}
      {line.late && (
        <p className="mt-0.5 text-xs text-muted">
          {cs.late.by(userName(s, line.late.by), fmtDate(line.late.on))}
          {line.late.note && `. ${line.late.note}`}
          {line.late.reason && `. ${cs.common.reason}: ${line.late.reason}`}
          {!line.late.charged && `. ${cs.late.notCharged}`}
        </p>
      )}
      {groups.map((g) => (
        <div
          key={g.groupKey}
          className="mt-1 flex flex-wrap items-center gap-1 text-xs"
          role="radiogroup"
          aria-label={cs.editor.orTitle(name)}
        >
          <span className="text-muted">{cs.editor.orTitle(name)}:</span>
          {g.options.map((o) => (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={g.selected === o.key}
              disabled={!editable}
              onClick={() => update(chooseOr(s, booking, g.groupKey, o.key))}
              className={`rounded-full border px-2 py-0.5 ${g.selected === o.key ? 'border-tape bg-tape text-white' : 'border-alu-line bg-white'}`}
            >
              {o.targets.map((t) => targetName(s, t.target)).join(' + ')}
            </button>
          ))}
          {g.open && <span className="text-bad">{cs.editor.orOpen}</span>}
        </div>
      ))}
      {editable && !isExt && (sources.length > 1 || line.fromBookingId) && (
        <div className="mt-1 flex items-center gap-2 text-xs">
          <label className="text-muted" htmlFor={`src-${line.id}`}>
            {cs.editor.source}
          </label>
          <select
            id={`src-${line.id}`}
            className="input min-h-7 w-auto py-0 text-xs"
            value={
              line.fromBookingId
                ? `b:${line.fromBookingId}`
                : `w:${line.sourceWarehouseId ?? a?.warehouseId ?? booking.defaultWarehouseId}`
            }
            onChange={(e) => {
              const v = e.target.value;
              update(
                setLineSource(
                  s,
                  booking,
                  line.id,
                  v.startsWith('b:') ? { fromBookingId: v.slice(2) } : { warehouseId: v.slice(2) },
                ),
              );
            }}
          >
            {sources.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {editable && (
        <div className="mt-1 flex flex-wrap gap-2 text-xs">
          {!isAuto && (
            <button
              type="button"
              className="text-muted underline"
              onClick={() =>
                nestedByHand(booking, line.id).length > 0
                  ? setRemoving(true)
                  : update(removeLine(s, booking, line.id))
              }
            >
              {cs.common.remove}
            </button>
          )}
          {movable && (
            <button
              type="button"
              className="text-muted underline"
              aria-expanded={moving}
              onClick={() => setMoving(!moving)}
            >
              {cs.lines.move}
            </button>
          )}
          {isAuto && can(user, 'remove_auto_line') && (
            <button
              type="button"
              className="text-muted underline"
              onClick={() => {
                const r = globalThis.prompt?.(cs.editor.removeAutoPrompt) ?? '';
                if (r.trim()) update(removeLine(s, booking, line.id, r));
              }}
            >
              {cs.editor.removeAuto}
            </button>
          )}
          {isChief && line.status === 'ok' && !isExt && (
            <>
              <button
                type="button"
                className="text-muted underline"
                onClick={() => {
                  const r = globalThis.prompt?.(cs.editor.markReasonPrompt) ?? '';
                  update(markLine(s, booking, line.id, 'missing', r));
                }}
              >
                {cs.editor.markMissing}
              </button>
              <button
                type="button"
                className="text-muted underline"
                onClick={() => {
                  const r = globalThis.prompt?.(cs.editor.markReasonPrompt) ?? '';
                  update(markLine(s, booking, line.id, 'substituted', r));
                }}
              >
                {cs.editor.markSubstituted}
              </button>
            </>
          )}
          {isChief && line.status !== 'ok' && (
            <button
              type="button"
              className="text-muted underline"
              onClick={() => update(markLine(s, booking, line.id, 'ok'))}
            >
              {cs.editor.markOk}
            </button>
          )}
        </div>
      )}
      {editable && moving && (
        <MoveMenu
          s={s}
          booking={booking}
          line={line}
          name={name}
          update={update}
          close={() => setMoving(false)}
        />
      )}
      {removing && (
        <div
          role="alertdialog"
          aria-label={cs.lines.removeAsk(name, below)}
          className="mt-2 flex flex-wrap items-center gap-2 rounded border border-bad/40 bg-bad-light p-2 text-sm"
        >
          <span>{cs.lines.removeAsk(name, below)}</span>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => update(removeLine(s, booking, line.id, undefined, 'remove'))}
          >
            {cs.lines.removeAll}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => update(removeLine(s, booking, line.id, undefined, 'keep'))}
          >
            {cs.lines.removeKeep}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setRemoving(false)}>
            {cs.common.cancel}
          </button>
        </div>
      )}
    </div>
  );
}

/** Moving without dragging: for the keyboard, and for long lists. */
function MoveMenu({
  s,
  booking,
  line,
  name,
  update,
  close,
}: {
  s: AppState;
  booking: Booking;
  line: BookingLine;
  name: string;
  update: (b: Booking) => void;
  close: () => void;
}) {
  const parent = parentMap(booking).get(line.id);
  const group = groupOfLine(booking, line.id);
  const free = canLeave(line);
  const under = flattenNodes(lineTree(booking).flatMap((g) => g.roots)).filter(
    (n) => n.line.id !== parent && canNest(booking, line.id, n.line.id),
  );
  const groups = booking.groups ?? [];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <label className="text-xs text-muted" htmlFor={`mv-${line.id}`}>
        {cs.lines.moveTo}
      </label>
      <select
        id={`mv-${line.id}`}
        className="input w-auto max-w-full"
        aria-label={cs.lines.moveLabel(name)}
        autoFocus
        value=""
        onKeyDown={(e) => e.key === 'Escape' && close()}
        onChange={(e) => {
          const [kind, id] = [e.target.value.slice(0, 2), e.target.value.slice(2)];
          if (kind === 'l:') update(nestLine(s, booking, line.id, id));
          else if (kind === 'g:') update(moveToGroup(booking, line.id, id || undefined));
          else if (kind === 'o:') update(unnestLine(booking, line.id));
          close();
        }}
      >
        <option value="">{cs.lines.moveChoose}</option>
        {free && parent && <option value="o:">{cs.lines.moveOut}</option>}
        {free && (groups.length > 0 || parent) && (
          <optgroup label={cs.lines.moveGroup}>
            {groups
              .filter((g) => parent || g.id !== group?.id)
              .map((g) => (
                <option key={g.id} value={`g:${g.id}`}>
                  {g.name}
                </option>
              ))}
            {(parent || group) && <option value="g:">{cs.lines.noGroup}</option>}
          </optgroup>
        )}
        {under.length > 0 && (
          <optgroup label={cs.lines.moveUnder}>
            {under.map((n) => (
              <option key={n.line.id} value={`l:${n.line.id}`}>
                {`${'\u2003'.repeat(n.depth)}${lineName(s, n.line)} ×${effectiveQty(n.line)}`}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <button type="button" className="btn btn-sm" onClick={close}>
        {cs.common.cancel}
      </button>
    </div>
  );
}

/** Warehouses that stock the line's resource, plus orders it could come from directly. */
function sourceOptions(
  s: AppState,
  b: Booking,
  line: BookingLine,
): { value: string; label: string }[] {
  if ('external' in line.target) return [];
  const t = line.target;
  const out = s.warehouses
    .filter((w) =>
      'itemId' in t
        ? s.stock.some((st) => st.itemId === t.itemId && st.warehouseId === w.id && st.qty > 0)
        : s.cases.some(
            (c) => c.caseTypeId === t.caseTypeId && c.warehouseId === w.id && !c.archived,
          ),
    )
    .map((w) => ({ value: `w:${w.id}`, label: w.name }));
  if ('itemId' in t && line.origin !== 'auto') {
    const start = firstBookedFrom(b);
    for (const o of s.bookings) {
      if (
        o.id === b.id ||
        o.type !== 'order' ||
        !['confirmed', 'packing', 'packed', 'shipped'].includes(o.status)
      )
        continue;
      const end = lastBookedUntil(o);
      if (end >= start || addDays(end, 14) < start) continue;
      if (!o.lines.some((l) => 'itemId' in l.target && l.target.itemId === t.itemId)) continue;
      out.push({ value: `b:${o.id}`, label: cs.editor.sourceFromBooking(o.eventName) });
    }
  }
  if (line.fromBookingId && !out.some((o) => o.value === `b:${line.fromBookingId}`)) {
    const o = s.bookings.find((x) => x.id === line.fromBookingId);
    out.push({
      value: `b:${line.fromBookingId}`,
      label: cs.editor.sourceFromBooking(o?.eventName ?? ''),
    });
  }
  return out;
}
