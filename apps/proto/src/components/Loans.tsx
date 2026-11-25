/** Quick loans: the form on the item page, the warning, and rows with return / extend / cancel. */
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  addDays,
  can,
  cancelLoan,
  casesHere,
  createLoan,
  extendLoan,
  extendPreview,
  isLoanOverdue,
  isLoanPlanned,
  isOpenLoan,
  loanPreview,
  looseHere,
  returnLoan,
  stockQty,
  type AppState,
  type Loan,
  type LoanHit,
  type LoanInput,
} from '@quix/core';
import { cs, fmtDate, fmtRange, fmtShort } from '../i18n/cs';
import {
  bookingSpan,
  caseNumber,
  itemName,
  targetName,
  userName,
  warehouseName,
} from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';
import { CaseLabel, Field } from './ui';

export const loanWho = (s: AppState, l: Loan): string =>
  l.borrowerName ?? userName(s, l.borrowerId);

/** "1 ks, Petr Dvořák, do 24. 4. 2027 (důvod: …)" for lists of who has the gear. */
export const loanLine = (s: AppState, l: Loan): string =>
  cs.loans.line(l.qty, loanWho(s, l), l.until ? fmtDate(l.until) : '', l.reason ?? '');

/** Loans named in a conflict, each linking to the loans page. */
export function LoanNames({ s, ids }: { s: AppState; ids: string[] }) {
  const list = s.loans.filter((l) => ids.includes(l.id));
  if (list.length === 0) return null;
  return (
    <p data-testid="conflict-loans" className="text-xs">
      {cs.loans.alsoLoaned}{' '}
      {list.map((l, i) => (
        <span key={l.id}>
          {i > 0 && '; '}
          <Link to="/loans" className="underline">
            {itemName(s, l.itemId)}, {loanLine(s, l)}
          </Link>
        </span>
      ))}
    </p>
  );
}

/** Who would be short: orders firmly, pre-bookings as information. */
function Hits({ s, hits }: { s: AppState; hits: LoanHit[] }) {
  const group = (level: LoanHit['level']) => {
    const list = hits.filter((h) => h.level === level);
    if (list.length === 0) return null;
    return (
      <div
        data-testid={`loan-hits-${level}`}
        className={`rounded border p-3 text-sm ${level === 'order' ? 'border-bad bg-bad-light' : 'border-warn/40 bg-warn-light'}`}
      >
        <p className={`font-semibold ${level === 'order' ? 'text-bad' : ''}`}>
          {cs.loans.hits[level]}
        </p>
        <ul className="mt-1 space-y-1">
          {list.map((h) => {
            const b = s.bookings.find((x) => x.id === h.bookingId);
            if (!b) return null;
            const span = bookingSpan(b);
            return (
              <li key={`${h.bookingId}-${h.lineId}`}>
                <Link to={`/bookings/${b.id}`} className="font-medium underline">
                  {b.eventName}
                </Link>{' '}
                <span className="text-xs">
                  {userName(s, b.pmId)}, {fmtRange(span.from, span.to)}
                </span>
                <span className="block text-xs">
                  {cs.loans.wouldMiss(
                    h.short,
                    targetName(s, h.target),
                    h.days.map((d) => fmtShort(d)).join(', '),
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };
  return (
    <>
      {group('order')}
      {group('prebooking')}
    </>
  );
}

function ReasonField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field label={cs.loans.reason} htmlFor={id}>
      <input
        id={id}
        className="input"
        placeholder={cs.loans.reasonHint}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function LoanForm({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const stocked = s.stock.filter((x) => x.itemId === itemId && x.qty > 0);
  const [wh, setWh] = useState(stocked[0]?.warehouseId ?? '');
  const [qty, setQty] = useState(1);
  const [from, setFrom] = useState(today);
  const [until, setUntil] = useState('');
  const [source, setSource] = useState<string | undefined>();
  const [who, setWho] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');

  const now = from <= today;
  const loose = looseHere(s, itemId, wh, today);
  const cases = now ? casesHere(s, itemId, wh) : [];
  // loose pieces first; when there are none, the first case that has some
  const caseId = source ?? (now && loose === 0 ? (cases[0]?.caseId ?? '') : '');
  const inCase = cases.find((c) => c.caseId === caseId)?.qty;
  const max = now ? (caseId ? (inCase ?? 0) : loose) : stockQty(s, itemId, wh);
  const datesOk = from >= today && (!until || until >= from);

  const input = useMemo<LoanInput>(
    () => ({
      itemId,
      warehouseId: wh,
      qty,
      from,
      ...(until ? { until } : {}),
      ...(now && caseId ? { fromCaseId: caseId } : {}),
    }),
    [itemId, wh, qty, from, until, now, caseId],
  );
  const preview = useMemo(
    () => (datesOk && qty <= max ? loanPreview(s, today, input) : undefined),
    [s, today, input, datesOk, qty, max],
  );
  const needsReason = !!preview?.hits.some((h) => h.level === 'order');
  const ready =
    !!preview && (!needsReason || !!reason.trim()) && (who !== 'other' || !!name.trim());

  const save = () => {
    const err = run(
      (st) => {
        const r = createLoan(st, user, today, {
          ...input,
          ...(who === 'other' ? { borrowerName: name } : who ? { borrowerId: who } : {}),
          ...(note.trim() ? { note } : {}),
          ...(needsReason ? { reason } : {}),
        });
        return r.ok ? { ok: true, value: r.value.state } : r;
      },
      now ? cs.loans.taken : cs.loans.planned,
    );
    if (!err) onClose();
  };

  return (
    <form
      data-testid="loan-form"
      className="panel space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) save();
      }}
    >
      <h2>{cs.loans.formTitle(itemName(s, itemId))}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={cs.loans.qty} htmlFor="ln-qty">
          <input
            id="ln-qty"
            type="number"
            className="input"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
          />
        </Field>
        <Field label={cs.common.warehouse} htmlFor="ln-wh">
          <select
            id="ln-wh"
            className="input"
            value={wh}
            onChange={(e) => {
              setWh(e.target.value);
              setSource(undefined);
            }}
          >
            {stocked.map((x) => (
              <option key={x.warehouseId} value={x.warehouseId}>
                {warehouseName(s, x.warehouseId)}
              </option>
            ))}
          </select>
        </Field>
        {cases.length > 0 && (
          <Field label={cs.loans.source} htmlFor="ln-src">
            <select
              id="ln-src"
              className="input"
              value={caseId}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">{cs.loans.sourceLoose(loose)}</option>
              {cases.map((c) => (
                <option key={c.caseId} value={c.caseId}>
                  {cs.loans.sourceCase(caseNumber(s, c.caseId), c.qty)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={cs.loans.from} htmlFor="ln-from">
          <input
            id="ln-from"
            type="date"
            className="input"
            min={today}
            required
            value={from}
            onChange={(e) => setFrom(e.target.value || today)}
          />
        </Field>
        <Field label={cs.loans.until} htmlFor="ln-until">
          <input
            id="ln-until"
            type="date"
            className="input"
            min={from}
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
        </Field>
        {can(user, 'borrow_for_other') && (
          <Field label={cs.loans.forWhom} htmlFor="ln-who">
            <select
              id="ln-who"
              className="input"
              value={who}
              onChange={(e) => setWho(e.target.value)}
            >
              <option value="">{cs.loans.forMe(user.name)}</option>
              {s.users
                .filter((u) => u.active && u.id !== user.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              <option value="other">{cs.loans.forOther}</option>
            </select>
          </Field>
        )}
        {who === 'other' && (
          <Field label={cs.loans.otherName} htmlFor="ln-name">
            <input
              id="ln-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        )}
      </div>
      <Field label={cs.loans.note} htmlFor="ln-note">
        <input
          id="ln-note"
          className="input"
          placeholder={cs.loans.noteHint}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      {!until && (
        <p className="text-xs text-muted">{cs.loans.noDate(s.settings.loanHorizonDays)}</p>
      )}
      {qty > max && (
        <p role="alert" className="text-sm text-bad">
          {cs.loans.tooMany(max)}
        </p>
      )}
      {!datesOk && (
        <p role="alert" className="text-sm text-bad">
          {cs.loans.badDates}
        </p>
      )}
      {preview && (
        <div aria-live="polite" className="space-y-2">
          <p data-testid="loan-free" className="text-sm text-muted">
            {preview.hits.length === 0 && (
              <strong className="mr-1 font-semibold text-ok">{cs.loans.nobody}</strong>
            )}
            {cs.loans.leftFree(Math.max(0, preview.minFree), fmtRange(preview.from, preview.to))}
          </p>
          <Hits s={s} hits={preview.hits} />
          {needsReason && <ReasonField id="ln-reason" value={reason} onChange={setReason} />}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={!ready}>
          {needsReason ? cs.loans.takeAnyway : now ? cs.loans.take : cs.loans.plan}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {cs.common.cancel}
        </button>
      </div>
    </form>
  );
}

function Extend({ l, onClose }: { l: Loan; onClose: () => void }) {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const base = l.until && l.until > today ? l.until : today;
  const [until, setUntil] = useState(addDays(base, 1));
  const [reason, setReason] = useState('');
  const ok = until >= today && until >= l.from;
  const hits = useMemo(
    () => (ok ? extendPreview(s, today, l.id, until).hits : []),
    [s, today, l.id, until, ok],
  );
  const needsReason = hits.some((h) => h.level === 'order');
  return (
    <form
      className="mt-2 space-y-2 rounded border border-alu-line bg-alu/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (
          !run(
            (st) => extendLoan(st, user, today, l.id, until, needsReason ? reason : ''),
            cs.loans.extended,
          )
        )
          onClose();
      }}
    >
      <Field label={cs.loans.newUntil} htmlFor={`ext-${l.id}`}>
        <input
          id={`ext-${l.id}`}
          type="date"
          className="input w-auto"
          min={today}
          value={until}
          onChange={(e) => setUntil(e.target.value)}
        />
      </Field>
      <Hits s={s} hits={hits} />
      {needsReason && <ReasonField id={`exr-${l.id}`} value={reason} onChange={setReason} />}
      <div className="flex gap-2">
        <button
          type="submit"
          className="btn btn-sm btn-primary"
          disabled={!ok || (needsReason && !reason.trim())}
        >
          {cs.common.save}
        </button>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          {cs.common.cancel}
        </button>
      </div>
    </form>
  );
}

/** One loan with what anyone may do with it. */
function LoanRow({ l, showItem }: { l: Loan; showItem: boolean }) {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const [extending, setExtending] = useState(false);
  const open = isOpenLoan(l);
  const plannedYet = isLoanPlanned(l, today);
  const overdue = isLoanOverdue(l, today);
  const state: [string, string] = !open
    ? [
        l.cancelledOn
          ? cs.loans.state.cancelled
          : cs.loans.returnedBy(fmtDate(l.returnedOn), userName(s, l.returnedBy)),
        'text-muted',
      ]
    : overdue
      ? [cs.loans.state.overdue(fmtDate(l.until)), 'text-bad font-semibold']
      : plannedYet
        ? [cs.loans.state.planned(fmtDate(l.from)), 'text-tape-dark']
        : [l.until ? cs.loans.state.until(fmtDate(l.until)) : cs.loans.state.noDate, 'text-ink'];
  return (
    <li data-testid={`loan-${l.id}`} className="px-3 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2">
            <span className="font-medium">
              {l.qty}×{' '}
              {showItem ? (
                <Link to={`/items/${l.itemId}`} className="font-cond font-semibold hover:underline">
                  {itemName(s, l.itemId)}
                </Link>
              ) : (
                cs.loans.pcs
              )}
            </span>
            {l.fromCaseId && <CaseLabel>{caseNumber(s, l.fromCaseId)}</CaseLabel>}
            <span className={`text-xs ${state[1]}`}>{state[0]}</span>
          </p>
          <p className="text-xs text-muted">
            {loanWho(s, l)}, {cs.packing.warehouse(warehouseName(s, l.warehouseId))},{' '}
            {cs.loans.since(fmtDate(l.from))}
            {l.recordedBy !== l.borrowerId && `, ${cs.loans.recordedBy(userName(s, l.recordedBy))}`}
          </p>
          {(l.note || l.reason) && (
            <p className="text-xs">
              {l.note}
              {l.note && l.reason && ' '}
              {l.reason && cs.loans.reasonLine(l.reason)}
            </p>
          )}
        </div>
        {open && (
          <div className="flex flex-wrap gap-2">
            {plannedYet ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => run((st) => cancelLoan(st, user, today, l.id), cs.loans.cancelled)}
              >
                {cs.loans.cancel}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => run((st) => returnLoan(st, user, today, l.id), cs.loans.returned)}
              >
                {cs.loans.giveBack}
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm"
              aria-expanded={extending}
              onClick={() => setExtending(!extending)}
            >
              {cs.loans.extend}
            </button>
          </div>
        )}
      </div>
      {open && extending && <Extend l={l} onClose={() => setExtending(false)} />}
    </li>
  );
}

export function LoanList({
  loans,
  showItem = true,
  empty,
}: {
  loans: Loan[];
  showItem?: boolean;
  empty?: ReactNode;
}) {
  if (loans.length === 0) return <>{empty ?? null}</>;
  return (
    <ul data-testid="loans" className="divide-y divide-alu-line">
      {loans.map((l) => (
        <LoanRow key={l.id} l={l} showItem={showItem} />
      ))}
    </ul>
  );
}

/** Overdue first, then by expected return; undated ones last. */
export const byReturn = (a: Loan, b: Loan): number =>
  (a.until ?? '9999').localeCompare(b.until ?? '9999') || a.from.localeCompare(b.from);
