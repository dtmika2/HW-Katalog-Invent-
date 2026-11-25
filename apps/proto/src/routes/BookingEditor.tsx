import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ackConflict,
  addDays,
  addLine,
  bookingPriceTotal,
  can,
  categoryPath,
  chooseOr,
  clearOverride,
  closeBooking,
  confirmBooking,
  coverWithExternal,
  detectConflicts,
  diffDays,
  dismissCheck,
  dismissRecommendation,
  eventDays,
  evaluateBooking,
  firstBookedFrom,
  firstEventDay,
  lastBookedUntil,
  markLine,
  minFreeInWarehouse,
  openIssues,
  periodWithBuffer,
  postMessage,
  recalcBooking,
  removeLine,
  restoreAutoLine,
  returnToPm,
  saveBooking,
  setLineQty,
  setLineSource,
  setOverrideReason,
  splitLine,
  submitPrebooking,
  thread,
  type AppState,
  type Booking,
  type BookingLine,
  type BookingPeriod,
  type LineAvailability,
  type OrChoiceInfo,
  type Target,
  type User,
} from '@quix/core';
import { CategoryLabel } from '../components/Category';
import { ClientPicker } from '../components/Clients';
import { LoanNames } from '../components/Loans';
import {
  AvailabilityBadge,
  CaseLabel,
  Empty,
  Field,
  PartlyShipped,
  Section,
  StatusChip,
} from '../components/ui';
import { cs, fmtDate } from '../i18n/cs';
import {
  ageDays,
  caseTypeName,
  isCaseLine,
  itemName,
  lineCategoryId,
  lineName,
  targetName,
  userName,
} from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';
import { IssuesList } from './Issues';

const EDITABLE = ['draft', 'submitted', 'confirmed', 'packing'];

export function BookingEditor() {
  const { id = '' } = useParams();
  const s = useAppState();
  const stored = s.bookings.find((b) => b.id === id);
  if (!stored) return <Empty>{cs.errors.not_found}</Empty>;
  return <Editor key={`${stored.id}`} stored={stored} />;
}

function Editor({ stored }: { stored: Booking }) {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const [draft, setDraft] = useState<Booking>(stored);
  const [dirty, setDirty] = useState(false);

  // Follow the stored booking when it changes elsewhere (after save, other users' actions).
  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [stored, dirty]);

  const editable = can(user, 'edit_booking', stored) && EDITABLE.includes(stored.status);
  const update = (b: Booking) => {
    setDraft(b);
    setDirty(true);
  };

  const { booking, expansion } = useMemo(() => recalcBooking(s, draft), [s, draft]);
  const av = useMemo(() => evaluateBooking(s, booking), [s, booking]);
  const conflicts = useMemo(() => detectConflicts(s, booking, av), [s, booking, av]);
  const unacked = conflicts.filter(
    (c) => !booking.lines.find((l) => l.id === c.lineId)?.conflictAck,
  );
  const blocking = conflicts.filter(
    (c) => !booking.lines.find((l) => l.id === c.lineId)?.overrideReason?.trim(),
  );

  const hasSide =
    conflicts.length > 0 ||
    [...av.values()].some((x) => x.breaksCase) ||
    expansion.checkWarnings.length > 0 ||
    (editable && expansion.recommendations.length > 0);
  const isPre = stored.type === 'prebooking';
  const canSubmit = isPre && stored.status === 'draft' && can(user, 'submit', stored);
  const canConfirm =
    isPre && ['draft', 'submitted'].includes(stored.status) && can(user, 'confirm', stored);
  const canReturn = isPre && stored.status === 'submitted' && can(user, 'return_to_pm', stored);

  const save = (then?: (st: AppState) => ReturnType<typeof submitPrebooking>, okText?: string) => {
    const err = run((st) => {
      const r = editable ? saveBooking(st, user, today, booking) : { ok: true as const, value: st };
      if (!r.ok || !then) return r;
      return then(r.value);
    }, okText);
    if (!err) setDirty(false);
  };

  return (
    <div className="space-y-4">
      <Header stored={stored} draft={booking} editable={editable} update={update} today={today} />
      {!editable && <p className="text-sm text-muted">{cs.editor.actions.readonly}</p>}
      {openIssues(s).some((i) => i.bookingId === stored.id) && (
        <Section title={cs.issues.onBooking}>
          <IssuesList bookingId={stored.id} />
        </Section>
      )}

      <div className={`grid gap-4 ${hasSide ? 'xl:grid-cols-[1fr_22rem]' : ''}`}>
        <div className="space-y-4">
          {editable && <AddPanel s={s} onAdd={(t, q) => update(addLine(s, draft, t, q))} />}
          <Section title={cs.editor.linesTitle}>
            {expansion.cycleWarnings.length > 0 && (
              <p className="mb-2 text-xs text-warn">{cs.editor.cycle}</p>
            )}
            <LineTree
              s={s}
              booking={booking}
              av={av}
              orChoices={expansion.orChoices}
              editable={editable}
              user={user}
              update={update}
            />
            {Object.keys(booking.suppressedAuto).length > 0 && (
              <div className="mt-3 text-xs text-muted">
                {cs.editor.suppressed(Object.keys(booking.suppressedAuto).length)}{' '}
                {Object.entries(booking.suppressedAuto).map(([lid, reason]) => (
                  <span key={lid} className="mr-2">
                    {targetName(
                      s,
                      lid.startsWith('auto:item:')
                        ? { itemId: lid.slice(10) }
                        : { caseTypeId: lid.slice(10) },
                    )}{' '}
                    ({reason})
                    {editable && (
                      <button
                        type="button"
                        className="ml-1 underline"
                        onClick={() => update(restoreAutoLine(s, draft, lid))}
                      >
                        {cs.editor.restore}
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-4 flex items-baseline justify-between border-t border-alu-line pt-3">
              <span className="text-sm text-muted">
                {cs.editor.priceTotal}{' '}
                <span className="text-xs">({cs.editor.priceHint(eventDays(booking))})</span>
              </span>
              <span data-testid="price-total" className="font-cond text-xl font-bold">
                {cs.common.czk(bookingPriceTotal(s, booking))}
              </span>
            </div>
          </Section>
          <ThreadPanel s={s} bookingId={stored.id} user={user} today={today} />
        </div>

        <div className="space-y-4">
          <ConflictPanel
            s={s}
            booking={booking}
            av={av}
            conflicts={conflicts}
            user={user}
            editable={editable}
            update={update}
          />
          {expansion.checkWarnings.length > 0 && (
            <Section title={cs.editor.checksTitle}>
              <ul className="space-y-3">
                {expansion.checkWarnings.map((w) => (
                  <li key={w.key} data-testid="check-warning" className="text-sm">
                    <p className="mb-1">{cs.editor.checkFor(itemName(s, w.fromItemId))}</p>
                    <div className="flex flex-wrap gap-1">
                      {w.candidates.map((c) => (
                        <button
                          key={targetName(s, c.target)}
                          type="button"
                          className="btn btn-sm"
                          disabled={!editable}
                          onClick={() => update(addLine(s, draft, c.target, Math.max(1, c.qty)))}
                        >
                          + {c.qty}× {targetName(s, c.target)}
                        </button>
                      ))}
                      {editable && can(user, 'dismiss_check') && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => update(dismissCheck(draft, w.key))}
                        >
                          {cs.editor.checkDismiss}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {expansion.recommendations.length > 0 && editable && (
            <Section title={cs.editor.recsTitle}>
              <ul className="space-y-2">
                {expansion.recommendations.map((r) => (
                  <li key={r.key} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {targetName(s, r.target)}
                      <span className="block text-xs text-muted">
                        {cs.editor.recFor(r.forItemIds.map((i) => itemName(s, i)).join(', '))}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => update(addLine(s, draft, r.target, Math.max(1, r.qty)))}
                      >
                        + {r.qty}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => update(dismissRecommendation(draft, r.key))}
                      >
                        {cs.editor.recDismiss}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-alu-line bg-alu/95 px-4 py-3 backdrop-blur">
        {editable && (
          <button
            type="button"
            className="btn"
            disabled={!dirty}
            onClick={() => save(undefined, cs.common.saved)}
          >
            {cs.editor.actions.save}
          </button>
        )}
        {canSubmit && (
          <>
            <button
              type="button"
              className="btn btn-primary"
              disabled={unacked.length > 0 || booking.lines.length === 0}
              onClick={() =>
                save((st) => submitPrebooking(st, user, today, stored.id), cs.editor.actions.submit)
              }
            >
              {cs.editor.actions.submit}
            </button>
            {unacked.length > 0 && (
              <span className="text-xs text-bad">{cs.editor.actions.submitBlocked}</span>
            )}
          </>
        )}
        {canReturn && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              const reason = globalThis.prompt?.(cs.editor.actions.returnPrompt) ?? '';
              if (reason.trim())
                save(
                  (st) => returnToPm(st, user, today, stored.id, reason),
                  cs.editor.actions.returnToPm,
                );
            }}
          >
            {cs.editor.actions.returnToPm}
          </button>
        )}
        {canConfirm && (
          <>
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                expansion.openOrChoices.length > 0 ||
                blocking.length > 0 ||
                booking.lines.length === 0
              }
              onClick={() =>
                save((st) => confirmBooking(st, user, today, stored.id), cs.editor.actions.confirm)
              }
            >
              {cs.editor.actions.confirm}
            </button>
            {expansion.openOrChoices.length > 0 && (
              <span className="text-xs text-bad">{cs.editor.actions.confirmBlockedOr}</span>
            )}
            {blocking.length > 0 && (
              <span className="text-xs text-bad">{cs.editor.actions.confirmBlockedConflict}</span>
            )}
          </>
        )}
        {['packing', 'confirmed', 'shipped'].includes(stored.status) && (
          <Link to={`/packing/${stored.id}`} className="btn">
            {cs.editor.actions.openPacking}
          </Link>
        )}
        {(['shipped', 'returning', 'returned_with_issues'].includes(stored.status) ||
          (stored.status === 'packing' && s.shipments.some((x) => x.bookingId === stored.id))) && (
          <Link to={`/vratka/${stored.id}`} className="btn">
            {cs.editor.actions.openVratka}
          </Link>
        )}
        {stored.status === 'returned' && can(user, 'close', stored) && (
          <button
            type="button"
            className="btn"
            onClick={() =>
              run((st) => closeBooking(st, user, today, stored.id), cs.editor.actions.close)
            }
          >
            {cs.editor.actions.close}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Header({
  stored,
  draft,
  editable,
  update,
  today,
}: {
  stored: Booking;
  draft: Booking;
  editable: boolean;
  update: (b: Booking) => void;
  today: string;
}) {
  const s = useAppState();
  const setPeriod = (i: number, p: BookingPeriod) => {
    const periods = draft.periods.map((x, j) => (j === i ? p : x));
    update(recalcBooking(s, { ...draft, periods }).booking);
  };
  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted">{cs.bookingType[stored.type]}</span>
        <StatusChip status={stored.status} />
        <PartlyShipped s={s} b={stored} />
        <span className="text-xs text-muted">
          {cs.common.pm}: {userName(s, stored.pmId)}
        </span>
        {stored.type === 'prebooking' && ['draft', 'submitted'].includes(stored.status) && (
          <span className="text-xs text-muted">
            {cs.editor.expires(
              fmtDate(firstEventDay(stored)),
              cs.common.daysOld(ageDays(stored.createdAt, today)),
            )}
          </span>
        )}
      </div>
      {stored.returnedToPm && stored.status === 'draft' && (
        <p className="mb-3 rounded border border-warn/40 bg-warn-light px-3 py-2 text-sm text-warn">
          {cs.editor.returnedToPm(stored.returnedToPm.reason)}
        </p>
      )}
      <div className="grid grid-flow-row-dense gap-3 md:grid-cols-[2fr_1fr_1fr]">
        <Field label={cs.newBooking.eventName} htmlFor="ed-name">
          <input
            id="ed-name"
            className="input font-cond text-lg font-bold"
            value={draft.eventName}
            disabled={!editable}
            onChange={(e) => update({ ...draft, eventName: e.target.value })}
          />
        </Field>
        <ClientPicker
          id="ed-client"
          value={draft.clientId ?? ''}
          disabled={!editable}
          onChange={(clientId) => update({ ...draft, clientId })}
          createdText={cs.clients.createdOnBooking}
        />
        <Field label={cs.editor.defaultWarehouse} htmlFor="ed-wh">
          <select
            id="ed-wh"
            className="input"
            value={draft.defaultWarehouseId}
            disabled={!editable}
            onChange={(e) =>
              update(recalcBooking(s, { ...draft, defaultWarehouseId: e.target.value }).booking)
            }
          >
            {s.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-3">
        <Field label={cs.editor.purpose} htmlFor="ed-purpose">
          <textarea
            id="ed-purpose"
            className="input"
            rows={2}
            value={draft.purposeMessage}
            disabled={!editable}
            placeholder={cs.newBooking.purposeHint}
            onChange={(e) => update({ ...draft, purposeMessage: e.target.value })}
          />
        </Field>
      </div>
      <div className="mt-3">
        <p className="label">{cs.editor.periods}</p>
        <div className="space-y-2">
          {draft.periods.map((p, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 text-sm">
              <Field label={cs.newBooking.eventFrom} htmlFor={`p${i}-ef`}>
                <input
                  id={`p${i}-ef`}
                  type="date"
                  className="input w-auto"
                  value={p.eventFrom}
                  disabled={!editable}
                  onChange={(e) =>
                    e.target.value &&
                    setPeriod(
                      i,
                      periodWithBuffer(
                        e.target.value,
                        e.target.value > p.eventTo ? e.target.value : p.eventTo,
                        s.settings,
                      ),
                    )
                  }
                />
              </Field>
              <Field label={cs.newBooking.eventTo} htmlFor={`p${i}-et`}>
                <input
                  id={`p${i}-et`}
                  type="date"
                  className="input w-auto"
                  value={p.eventTo}
                  min={p.eventFrom}
                  disabled={!editable}
                  onChange={(e) =>
                    e.target.value &&
                    setPeriod(i, {
                      ...p,
                      eventTo: e.target.value,
                      bookedUntil: addDays(e.target.value, s.settings.bufferAfterDays),
                    })
                  }
                />
              </Field>
              <Field label={cs.editor.bookedDays} htmlFor={`p${i}-bf`}>
                <span className="flex gap-1">
                  <input
                    id={`p${i}-bf`}
                    type="date"
                    className="input w-auto"
                    value={p.bookedFrom}
                    max={p.eventFrom}
                    disabled={!editable}
                    onChange={(e) =>
                      e.target.value &&
                      e.target.value <= p.eventFrom &&
                      setPeriod(i, { ...p, bookedFrom: e.target.value })
                    }
                  />
                  <input
                    aria-label={`${cs.editor.bookedDays} ${cs.common.to}`}
                    type="date"
                    className="input w-auto"
                    value={p.bookedUntil}
                    min={p.eventTo}
                    disabled={!editable}
                    onChange={(e) =>
                      e.target.value &&
                      e.target.value >= p.eventTo &&
                      setPeriod(i, { ...p, bookedUntil: e.target.value })
                    }
                  />
                </span>
              </Field>
              {editable && draft.periods.length > 1 && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    update(
                      recalcBooking(s, {
                        ...draft,
                        periods: draft.periods.filter((_, j) => j !== i),
                      }).booking,
                    )
                  }
                >
                  {cs.editor.removePeriod}
                </button>
              )}
            </div>
          ))}
        </div>
        {editable && (
          <button
            type="button"
            className="mt-2 text-xs text-tape underline"
            title={cs.editor.multiPeriodHint}
            onClick={() => {
              const last = draft.periods[draft.periods.length - 1];
              const start = last ? addDays(last.eventFrom, 7) : today;
              const len = last ? Math.max(0, diffDays(last.eventFrom, last.eventTo)) : 0;
              update(
                recalcBooking(s, {
                  ...draft,
                  periods: [
                    ...draft.periods,
                    periodWithBuffer(start, addDays(start, len), s.settings),
                  ],
                }).booking,
              );
            }}
          >
            {cs.editor.addPeriod}
          </button>
        )}
      </div>
    </div>
  );
}

function AddPanel({ s, onAdd }: { s: AppState; onAdd: (t: Target, qty: number) => void }) {
  const [q, setQ] = useState('');
  const [qty, setQty] = useState(1);
  const [sel, setSel] = useState<Target | undefined>();
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const items = s.items
      .filter(
        (i) =>
          !i.archived &&
          (i.name.toLowerCase().includes(needle) ||
            i.model.toLowerCase().includes(needle) ||
            // searching a category name ("optické", "kabely") finds everything in it
            categoryPath(s, i.categoryId).some((c) => c.name.toLowerCase().includes(needle))),
      )
      .map((i) => ({
        target: { itemId: i.id } as Target,
        name: i.name,
        isCase: false,
        categoryId: i.categoryId,
      }));
    const types = s.caseTypes
      .filter((t) => !t.archived && t.name.toLowerCase().includes(needle))
      .map((t) => ({
        target: { caseTypeId: t.id } as Target,
        name: t.name,
        isCase: true,
        categoryId: '',
      }));
    return [...types, ...items].slice(0, 12);
  }, [q, s]);
  return (
    <Section title={cs.editor.addTitle}>
      <div className="flex flex-wrap gap-2">
        <input
          className="input min-w-48 flex-1"
          aria-label={cs.editor.addPlaceholder}
          placeholder={cs.editor.addPlaceholder}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(undefined);
          }}
        />
        <input
          className="input w-20"
          type="number"
          min={1}
          aria-label={cs.common.qty}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
        />
      </div>
      {matches.length > 0 && (
        <ul
          className="mt-2 divide-y divide-alu-line rounded border border-alu-line"
          role="listbox"
          aria-label={cs.editor.addTitle}
        >
          {matches.map((m) => (
            <li key={m.name}>
              <button
                type="button"
                role="option"
                aria-selected={sel === m.target}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-alu"
                onClick={() => {
                  onAdd(m.target, qty);
                  setQ('');
                  setQty(1);
                  setSel(m.target);
                }}
              >
                <span aria-label={m.name}>{m.name}</span>
                <span className="flex items-center gap-2" aria-hidden="true">
                  {m.categoryId && <CategoryLabel s={s} categoryId={m.categoryId} link={false} />}
                  {m.isCase && <CaseLabel>{cs.editor.caseTag}</CaseLabel>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------

interface TreeProps {
  s: AppState;
  booking: Booking;
  av: Map<string, LineAvailability>;
  orChoices: OrChoiceInfo[];
  editable: boolean;
  user: User;
  update: (b: Booking) => void;
}

function LineTree(props: TreeProps) {
  const { booking } = props;
  if (booking.lines.length === 0) return <Empty>{cs.editor.noLines}</Empty>;
  const byParent = new Map<string, BookingLine[]>();
  const roots: BookingLine[] = [];
  const ids = new Set(booking.lines.map((l) => l.id));
  for (const l of booking.lines) {
    const parent = l.origin === 'auto' ? l.parentLineIds.find((p) => ids.has(p)) : undefined;
    if (parent) byParent.set(parent, [...(byParent.get(parent) ?? []), l]);
    else roots.push(l);
  }
  const render = (l: BookingLine, depth: number): JSX.Element => (
    <li key={l.id}>
      <LineRow {...props} line={l} depth={depth} />
      {(byParent.get(l.id) ?? []).length > 0 && (
        <ul>{(byParent.get(l.id) ?? []).map((c) => render(c, depth + 1))}</ul>
      )}
    </li>
  );
  return (
    <ul data-testid="lines" className="divide-y divide-alu-line">
      {roots.map((l) => render(l, 0))}
    </ul>
  );
}

function LineRow({
  s,
  booking,
  av,
  orChoices,
  editable,
  user,
  update,
  line,
  depth,
}: TreeProps & { line: BookingLine; depth: number }) {
  const a = av.get(line.id);
  const name = lineName(s, line);
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

  return (
    <div
      data-testid={`line-${line.id}`}
      data-line-name={name}
      className={`py-2 ${line.status !== 'ok' ? 'opacity-60' : ''}`}
      style={{ paddingLeft: `${depth * 1.25}rem` }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {depth > 0 && (
          <span aria-hidden="true" className="text-muted">
            └
          </span>
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
      {(parents.length > 0 || line.note || line.overriddenQty !== undefined) && (
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
          {line.note && <span>{line.note}</span>}
        </div>
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
              onClick={() => update(removeLine(s, booking, line.id))}
            >
              {cs.common.remove}
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
        !['confirmed', 'packing', 'shipped'].includes(o.status)
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

// ---------------------------------------------------------------------------

function ConflictPanel({
  s,
  booking,
  av,
  conflicts,
  user,
  editable,
  update,
}: {
  s: AppState;
  booking: Booking;
  av: Map<string, LineAvailability>;
  conflicts: ReturnType<typeof detectConflicts>;
  user: User;
  editable: boolean;
  update: (b: Booking) => void;
}) {
  const amberBreaks = booking.lines.filter((l) => av.get(l.id)?.breaksCase);
  if (conflicts.length === 0 && amberBreaks.length === 0) return null;
  const canOverride = can(user, 'override_conflict', booking);
  return (
    <section data-testid="conflict-panel" className="panel border-bad/50 p-4">
      <h2 className="mb-2 text-bad">{cs.conflict.title}</h2>
      <ul className="space-y-4">
        {conflicts.map((c) => {
          const line = booking.lines.find((l) => l.id === c.lineId);
          if (!line) return null;
          const isCase = isCaseLine(line);
          const shortText = cs.badge.red(c.short, isCase);
          const otherW = s.warehouses.find((w) => w.id !== c.warehouseId);
          const freeOther = otherW
            ? minFreeInWarehouse(s, booking, line.target as Target, otherW.id)
            : 0;
          return (
            <li key={c.lineId} className="text-sm">
              <p className="font-semibold">
                {cs.conflict.lineShort(lineName(s, line), shortText, fmtDate(c.worstDay))}
              </p>
              <LoanNames s={s} ids={c.loanIds} />
              {c.colliding.length > 0 && (
                <p className="mt-1 text-xs text-muted">{cs.conflict.heldBy}</p>
              )}
              <ul className="ml-3 list-disc text-xs">
                {c.colliding.map((b) => (
                  <li key={b.id} data-testid="colliding">
                    <Link to={`/bookings/${b.id}`} className="underline">
                      {cs.conflict.collidingRow(
                        b.eventName,
                        userName(s, b.pmId),
                        fmtDate(b.from),
                        fmtDate(b.to),
                        cs.status[b.status],
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted">{cs.conflict.waysOut}</p>
              {editable && (
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={line.conflictAck}
                    onChange={(e) => update(ackConflict(booking, line.id, e.target.checked))}
                  />
                  {cs.conflict.ack}
                </label>
              )}
              {editable &&
                line.origin !== 'auto' &&
                'itemId' in line.target &&
                otherW &&
                freeOther > 0 && (
                  <button
                    type="button"
                    className="btn btn-sm mt-2"
                    onClick={() =>
                      update(
                        splitLine(s, booking, line.id, Math.min(freeOther, c.short), otherW.id),
                      )
                    }
                  >
                    {cs.editor.split(Math.min(freeOther, c.short), otherW.name)}
                  </button>
                )}
              {editable && canOverride && (
                <div className="mt-2">
                  <label className="label" htmlFor={`ov-${line.id}`}>
                    {cs.conflict.override}
                  </label>
                  <textarea
                    id={`ov-${line.id}`}
                    className="input"
                    rows={2}
                    placeholder={cs.conflict.overridePlaceholder}
                    value={line.overrideReason ?? ''}
                    onChange={(e) => update(setOverrideReason(booking, line.id, e.target.value))}
                  />
                </div>
              )}
              {editable && user.role === 'chief' && (
                <ExternalForm s={s} booking={booking} line={line} short={c.short} update={update} />
              )}
            </li>
          );
        })}
        {amberBreaks.map((l) => {
          const a = av.get(l.id);
          return (
            <li key={l.id} className="text-sm text-warn">
              {lineName(s, l)}:{' '}
              {cs.conflict.breaksCaseInfo(
                (a?.breaksCase?.bookingIds ?? [])
                  .map((id) => s.bookings.find((b) => b.id === id)?.eventName ?? id)
                  .join(', '),
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ExternalForm({
  s,
  booking,
  line,
  short,
  update,
}: {
  s: AppState;
  booking: Booking;
  line: BookingLine;
  short: number;
  update: (b: Booking) => void;
}) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(short);
  const [supplier, setSupplier] = useState('');
  const [pickup, setPickup] = useState(firstBookedFrom(booking));
  const [ret, setRet] = useState(lastBookedUntil(booking));
  if (!open) {
    return (
      <button type="button" className="btn btn-sm mt-2" onClick={() => setOpen(true)}>
        {cs.conflict.externalTitle}
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-2 rounded border border-alu-line bg-alu/50 p-2">
      <p className="text-xs font-semibold">{cs.conflict.externalTitle}</p>
      <div className="grid grid-cols-2 gap-2">
        <Field
          label={
            isCaseLine(line)
              ? `${cs.conflict.externalQty} (${cs.common.cases(qty)})`
              : cs.conflict.externalQty
          }
          htmlFor={`ext-q-${line.id}`}
        >
          <input
            id={`ext-q-${line.id}`}
            className="input"
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          />
        </Field>
        <Field label={cs.conflict.supplier} htmlFor={`ext-s-${line.id}`}>
          <input
            id={`ext-s-${line.id}`}
            className="input"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          />
        </Field>
        <Field label={cs.conflict.pickup} htmlFor={`ext-p-${line.id}`}>
          <input
            id={`ext-p-${line.id}`}
            className="input"
            type="date"
            value={pickup}
            onChange={(e) => setPickup(e.target.value)}
          />
        </Field>
        <Field label={cs.conflict.returnDate} htmlFor={`ext-r-${line.id}`}>
          <input
            id={`ext-r-${line.id}`}
            className="input"
            type="date"
            value={ret}
            onChange={(e) => setRet(e.target.value)}
          />
        </Field>
      </div>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={!supplier.trim()}
        onClick={() => {
          update(
            coverWithExternal(s, booking, line.id, qty, {
              supplier: supplier.trim(),
              pickup,
              returnDate: ret,
            }),
          );
          setOpen(false);
        }}
      >
        {cs.conflict.externalAdd}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ThreadPanel({
  s,
  bookingId,
  user,
  today,
}: {
  s: AppState;
  bookingId: string;
  user: User;
  today: string;
}) {
  const apply = useProto((p) => p.apply);
  const [text, setText] = useState('');
  const msgs = thread(s, bookingId);
  return (
    <Section title={cs.thread.title}>
      <ol className="space-y-2 text-sm">
        {msgs.map((m) => (
          <li key={m.id} className={m.event ? 'text-xs text-muted' : ''}>
            <span className="mr-2 text-xs text-muted">{fmtDate(m.on)}</span>
            <span className="mr-1 font-medium">
              {m.authorId === 'system' ? cs.thread.system : userName(s, m.authorId)}:
            </span>
            {m.event ? cs.events[m.event.type](m.event.params) : m.text}
          </li>
        ))}
      </ol>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply((st) => postMessage(st, user, bookingId, text, today));
          setText('');
        }}
      >
        <input
          className="input"
          aria-label={cs.thread.placeholder}
          placeholder={cs.thread.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn" disabled={!text.trim()}>
          {cs.thread.send}
        </button>
      </form>
    </Section>
  );
}
