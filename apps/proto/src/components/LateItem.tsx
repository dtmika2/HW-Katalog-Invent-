/** "Přibrat na poslední chvíli": an item taken to the event without having been approved. */
import { useMemo, useState } from 'react';
import {
  addLateItem,
  casesHere,
  guard,
  lateAvailable,
  latePreview,
  looseHere,
  type Booking,
  type LateItemInput,
} from '@quix/core';
import { cs } from '../i18n/cs';
import { caseNumber, itemName, warehouseName } from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';
import { Hits } from './Loans';
import { Field } from './ui';

/** Small mark next to an item that was not on the approved list. */
export function LateTag() {
  return (
    <span className="rounded border border-warn/40 bg-warn-light px-1.5 text-xs font-medium text-warn">
      {cs.late.tag}
    </span>
  );
}

export function LateItem({ b, disabled = false }: { b: Booking; disabled?: boolean }) {
  const s = useAppState();
  const user = useUser();
  const [open, setOpen] = useState(false);
  if (!guard(s, user, 'addLateItem', b.id).ok) return null;
  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" disabled={disabled} onClick={() => setOpen(true)}>
          {cs.late.button}
        </button>
        <span className="text-xs text-muted">
          {disabled ? cs.editor.print.saveFirst : cs.late.hint}
        </span>
      </div>
    );
  return <LateForm b={b} onClose={() => setOpen(false)} />;
}

function LateForm({ b, onClose }: { b: Booking; onClose: () => void }) {
  const s = useAppState();
  const [q, setQ] = useState('');
  const [itemId, setItemId] = useState('');
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    return s.items
      .filter(
        (i) =>
          !i.archived &&
          (i.name.toLowerCase().includes(needle) || i.model.toLowerCase().includes(needle)) &&
          s.stock.some((x) => x.itemId === i.id && x.qty > 0),
      )
      .slice(0, 8);
  }, [q, s]);
  return (
    <section data-testid="late-form" className="panel space-y-3 p-4">
      <h2>{itemId ? cs.late.title(itemName(s, itemId)) : cs.late.button}</h2>
      {itemId ? (
        <LateDetail b={b} itemId={itemId} onBack={() => setItemId('')} onClose={onClose} />
      ) : (
        <>
          <input
            className="input"
            autoFocus
            aria-label={cs.late.search}
            placeholder={cs.late.search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {matches.length > 0 && (
            <ul className="divide-y divide-alu-line rounded border border-alu-line">
              {matches.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    className="min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-alu"
                    onClick={() => setItemId(i.id)}
                  >
                    {i.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && matches.length === 0 && (
            <p className="text-sm text-muted">{cs.late.none}</p>
          )}
          <button type="button" className="btn" onClick={onClose}>
            {cs.common.cancel}
          </button>
        </>
      )}
    </section>
  );
}

function LateDetail({
  b,
  itemId,
  onBack,
  onClose,
}: {
  b: Booking;
  itemId: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const stocked = s.stock.filter((x) => x.itemId === itemId && x.qty > 0);
  const [wh, setWh] = useState(
    (stocked.find((x) => x.warehouseId === b.defaultWarehouseId) ?? stocked[0])?.warehouseId ?? '',
  );
  const [qty, setQty] = useState(1);
  const [source, setSource] = useState<string | undefined>();
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [charged, setCharged] = useState(false);

  const loose = looseHere(s, itemId, wh, today);
  const cases = casesHere(s, itemId, wh);
  // loose pieces first; when there are none, the first case that has some
  const caseId = source ?? (loose === 0 ? (cases[0]?.caseId ?? '') : '');
  const input = useMemo<LateItemInput>(
    () => ({
      itemId,
      warehouseId: wh,
      qty,
      label: cs.late.delivery,
      ...(caseId ? { fromCaseId: caseId } : {}),
    }),
    [itemId, wh, qty, caseId],
  );
  const max = lateAvailable(s, today, input);
  const hits = useMemo(
    () => (qty <= max ? latePreview(s, today, b.id, input) : []),
    [s, today, b.id, input, qty, max],
  );
  const needsReason = hits.some((h) => h.level === 'order');
  const ready = qty <= max && (!needsReason || !!reason.trim());
  const returnable = s.items.find((i) => i.id === itemId)?.returnable !== false;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        const err = run(
          (st) =>
            addLateItem(st, user, today, b.id, {
              ...input,
              charged,
              ...(note.trim() ? { note } : {}),
              ...(needsReason ? { reason } : {}),
            }),
          returnable ? cs.late.done : cs.late.doneConsumable,
        );
        if (!err) onClose();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={cs.loans.qty} htmlFor="lt-qty">
          <input
            id="lt-qty"
            type="number"
            className="input"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
          />
        </Field>
        <Field label={cs.common.warehouse} htmlFor="lt-wh">
          <select
            id="lt-wh"
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
          <Field label={cs.loans.source} htmlFor="lt-src">
            <select
              id="lt-src"
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
      </div>
      <Field label={cs.late.note} htmlFor="lt-note">
        <input
          id="lt-note"
          className="input"
          placeholder={cs.late.noteHint}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" checked={charged} onChange={(e) => setCharged(e.target.checked)} />
        {cs.late.charged}
      </label>
      {qty > max && (
        <p role="alert" className="text-sm text-bad">
          {cs.late.tooMany(max)}
        </p>
      )}
      <div aria-live="polite" className="space-y-2">
        <Hits s={s} hits={hits} />
        {needsReason && (
          <Field label={cs.loans.reason} htmlFor="lt-reason">
            <textarea
              id="lt-reason"
              className="input"
              rows={2}
              placeholder={cs.loans.reasonHint}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={!ready}>
          {needsReason ? cs.late.takeAnyway : cs.late.take}
        </button>
        <button type="button" className="btn" onClick={onBack}>
          {cs.late.other}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {cs.common.cancel}
        </button>
      </div>
    </form>
  );
}
