import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  can,
  recordReturnSession,
  returnSheet,
  type Condition,
  type Id,
  type ReturnLineInput,
  type ReturnSheetLine,
  type UnexpectedItem,
} from '@quix/core';
import { CaseLabel, Empty, StatusChip } from '../components/ui';
import { cs } from '../i18n/cs';
import { caseNumber, itemName } from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';

interface Entry {
  returned: number;
  locationId: string;
  condition: Condition;
  damaged: number;
  note: string;
  intoCaseId: string;
  transferTo: string;
  transferQty: number;
  toSupplier: boolean;
  confirmed: boolean;
  /** Case cards: counted contents. */
  contents: Record<Id, number>;
  missingCase: boolean;
}

const CONDITIONS: Condition[] = ['ok', 'damaged', 'needs_check'];

function Stepper({
  value,
  max,
  onChange,
  label,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
  label: string;
}) {
  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        className="btn h-11 w-11 text-lg"
        aria-label={`${cs.vratka.minus}: ${label}`}
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        className="input h-11 w-16 text-center font-cond text-xl font-bold"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.min(max, Math.max(0, Number(e.target.value) || 0)))}
      />
      <button
        type="button"
        className="btn h-11 w-11 text-lg"
        aria-label={`${cs.vratka.plus}: ${label}`}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </span>
  );
}

/** Vratka on a phone. Counts start at 0; every line is confirmed on its own; no "select all". */
export function Vratka() {
  const { id = '' } = useParams();
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [unexpected, setUnexpected] = useState<UnexpectedItem[]>([]);
  const [uItem, setUItem] = useState('');
  const [uName, setUName] = useState('');
  const [uQty, setUQty] = useState(1);
  const [uNote, setUNote] = useState('');
  const [result, setResult] = useState<{ issues: string[]; services: string[] } | undefined>();
  const b = s.bookings.find((x) => x.id === id);
  if (!b) return <Empty>{cs.errors.not_found}</Empty>;
  const sheet = returnSheet(s, id);
  const pending = sheet.filter((l) => l.outcome !== 'consumable' && l.outstanding > 0);
  const settled = sheet.filter((l) => !pending.includes(l));
  const canRecord =
    can(user, 'record_return') &&
    ['shipped', 'returning', 'returned_with_issues'].includes(b.status);
  const locations = s.locations.filter((l) => l.name.startsWith('Police'));
  const targets = s.bookings.filter(
    (x) =>
      x.id !== id &&
      x.type === 'order' &&
      ['confirmed', 'packing', 'shipped', 'returning'].includes(x.status),
  );

  const key = (l: ReturnSheetLine, caseId?: string) =>
    caseId ? `${l.lineId}|${caseId}` : l.lineId;
  const get = (l: ReturnSheetLine, caseId?: string): Entry =>
    entries[key(l, caseId)] ?? {
      returned: 0,
      locationId: l.suggestedLocationId ?? '',
      condition: 'ok',
      damaged: 0,
      note: '',
      intoCaseId: l.suggestedIntoCaseId ?? '',
      transferTo: '',
      transferQty: 0,
      toSupplier: l.kind === 'external',
      confirmed: false,
      contents: {},
      missingCase: false,
    };
  const set = (l: ReturnSheetLine, p: Partial<Entry>, caseId?: string) =>
    setEntries({ ...entries, [key(l, caseId)]: { ...get(l, caseId), ...p } });

  const inputs: ReturnLineInput[] = [];
  for (const l of pending) {
    if (l.kind === 'case') {
      for (const caseId of l.pendingCaseIds) {
        const e = get(l, caseId);
        if (!e.confirmed) continue;
        const damaged = (l.contents ?? []).map((c) => ({
          itemId: c.itemId,
          qty: e.contents[c.itemId] ?? 0,
        }));
        const input: ReturnLineInput = {
          lineId: l.lineId,
          caseId,
          confirmed: true,
          returnedQty: e.missingCase ? 0 : 1,
          condition: e.condition,
          caseContents: e.missingCase ? [] : damaged,
        };
        if (e.locationId) input.locationId = e.locationId;
        if (e.note.trim()) input.note = e.note.trim();
        if (!e.missingCase && e.condition !== 'ok' && input.caseContents?.[0])
          input.caseContents[0].damagedQty = Math.min(
            input.caseContents[0].qty,
            Math.max(1, e.damaged),
          );
        inputs.push(input);
      }
      continue;
    }
    const e = get(l);
    if (!e.confirmed) continue;
    const input: ReturnLineInput = {
      lineId: l.lineId,
      returnedQty: e.returned,
      confirmed: true,
      condition: e.condition,
    };
    if (l.kind === 'external') input.returnedToSupplier = e.toSupplier;
    else if (e.locationId) input.locationId = e.locationId;
    if (e.note.trim()) input.note = e.note.trim();
    if (e.condition !== 'ok') input.damagedQty = e.damaged || e.returned;
    if (e.intoCaseId) input.intoCaseId = e.intoCaseId;
    if (e.transferTo && e.transferQty > 0) {
      input.transferredToBookingId = e.transferTo;
      input.transferredQty = e.transferQty;
    }
    inputs.push(input);
  }

  const submit = () => {
    const before = {
      issues: new Set(s.issues.map((i) => i.id)),
      services: new Set(s.serviceCases.map((x) => x.id)),
    };
    const err = run(
      (st) => recordReturnSession(st, user, today, id, { lines: inputs, unexpected }),
      cs.vratka.done,
    );
    if (err) return;
    const after = useProto.getState().state;
    if (!after) return;
    setResult({
      issues: after.issues
        .filter((i) => !before.issues.has(i.id))
        .map(
          (i) =>
            `${cs.issues.type[i.type]}: ${i.qty}× ${i.itemId ? itemName(after, i.itemId) : (i.name ?? (i.caseId ? caseNumber(after, i.caseId) : ''))}`,
        ),
      services: after.serviceCases
        .filter((x) => !before.services.has(x.id))
        .map((x) => `${x.qty}× ${itemName(after, x.itemId)} — ${x.reason}`),
    });
    setEntries({});
    setUnexpected([]);
  };

  const conditionPicker = (l: ReturnSheetLine, e: Entry, caseId?: string) => (
    <fieldset className="flex flex-wrap gap-1">
      <legend className="label">{cs.vratka.condition}</legend>
      {CONDITIONS.map((c) => (
        <label
          key={c}
          className={`rounded border px-3 py-2 text-sm ${e.condition === c ? 'border-tape bg-tape-light' : 'border-alu-line bg-white'}`}
        >
          <input
            type="radio"
            className="sr-only"
            name={`cond-${key(l, caseId)}`}
            checked={e.condition === c}
            onChange={() => set(l, { condition: c }, caseId)}
          />
          {cs.condition[c]}
        </label>
      ))}
    </fieldset>
  );

  const locationPicker = (l: ReturnSheetLine, e: Entry, caseId?: string) => (
    <label className="block">
      <span className="label">{cs.vratka.location}</span>
      <select
        className="input"
        value={e.locationId}
        onChange={(ev) => set(l, { locationId: ev.target.value }, caseId)}
      >
        <option value="" />
        {locations.map((loc) => (
          <option key={loc.id} value={loc.id}>
            {loc.path}
          </option>
        ))}
      </select>
    </label>
  );

  const confirmBox = (l: ReturnSheetLine, e: Entry, label: string, caseId?: string) => (
    <label className="mt-3 flex min-h-11 items-center gap-3 rounded border border-alu-line bg-alu/60 px-3 text-sm font-semibold">
      <input
        type="checkbox"
        className="h-6 w-6"
        aria-label={`${cs.vratka.confirmLine}: ${label}`}
        checked={e.confirmed}
        onChange={(ev) => set(l, { confirmed: ev.target.checked }, caseId)}
      />
      {cs.vratka.confirmLine}
    </label>
  );

  const lineCard = (l: ReturnSheetLine) => {
    const e = get(l);
    const used = e.returned + (e.transferTo ? e.transferQty : 0);
    const needsNote = (used < l.outstanding || e.condition !== 'ok') && !e.note.trim();
    const item = l.itemId ? s.items.find((i) => i.id === l.itemId) : undefined;
    return (
      <li
        key={l.lineId}
        data-testid={`ret-${l.lineId}`}
        className={`panel p-3 ${e.confirmed ? 'border-ok' : ''}`}
      >
        <div className="flex items-start gap-3">
          <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded bg-alu text-[10px] text-muted">
            {item?.photos?.[0] ? (
              <img src={item.photos[0]} alt="" className="h-full w-full object-cover" />
            ) : (
              cs.catalog.photo
            )}
          </div>
          <div className="min-w-0">
            <p className="font-cond text-lg font-bold leading-tight">{l.name}</p>
            <p className="text-xs text-muted">
              {cs.vratka.shipped(l.shipped)} · {cs.vratka.outstanding(l.outstanding)}
              {l.kind === 'external' && ` · ${cs.editor.externalTag}`}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <span className="label">
              {l.kind === 'external' ? cs.vratka.toSupplier : cs.vratka.returned}
            </span>
            <Stepper
              value={e.returned}
              max={l.outstanding}
              label={`${cs.vratka.returned}: ${l.name}`}
              onChange={(n) => set(l, { returned: n })}
            />
          </div>
          {l.kind !== 'external' && <div className="min-w-48 flex-1">{locationPicker(l, e)}</div>}
        </div>
        {l.kind !== 'external' && <div className="mt-3">{conditionPicker(l, e)}</div>}
        {e.condition !== 'ok' && (
          <label className="mt-2 block">
            <span className="label">{cs.vratka.damagedQty}</span>
            <input
              type="number"
              className="input w-24"
              min={0}
              max={e.returned}
              value={e.damaged || e.returned}
              onChange={(ev) =>
                set(l, { damaged: Math.min(e.returned, Number(ev.target.value) || 0) })
              }
            />
          </label>
        )}
        {l.kind === 'item' && l.suggestedIntoCaseId !== undefined && (
          <label className="mt-2 block">
            <span className="label">{cs.vratka.intoCase}</span>
            <select
              className="input"
              value={e.intoCaseId}
              onChange={(ev) => set(l, { intoCaseId: ev.target.value })}
            >
              <option value="">{cs.vratka.intoCaseNone}</option>
              <option value={l.suggestedIntoCaseId}>{caseNumber(s, l.suggestedIntoCaseId)}</option>
            </select>
          </label>
        )}
        {l.kind === 'item' && targets.length > 0 && (
          <details className="mt-2 text-sm" open={!!e.transferTo}>
            <summary className="cursor-pointer text-tape">{cs.vratka.transfer}</summary>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="flex-1">
                <span className="label">{cs.vratka.transferTo}</span>
                <select
                  className="input"
                  value={e.transferTo}
                  onChange={(ev) => set(l, { transferTo: ev.target.value })}
                >
                  <option value="" />
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.eventName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="label">{cs.vratka.transferQty}</span>
                <input
                  type="number"
                  className="input w-20"
                  min={0}
                  max={l.outstanding - e.returned}
                  value={e.transferQty}
                  onChange={(ev) =>
                    set(l, {
                      transferQty: Math.min(
                        l.outstanding - e.returned,
                        Math.max(0, Number(ev.target.value) || 0),
                      ),
                    })
                  }
                />
              </label>
            </div>
          </details>
        )}
        <label className="mt-2 block">
          <span className="label">{cs.vratka.note}</span>
          <input
            className={`input ${needsNote ? 'border-bad' : ''}`}
            value={e.note}
            onChange={(ev) => set(l, { note: ev.target.value })}
          />
          {needsNote && e.confirmed && (
            <span className="text-xs text-bad">{cs.vratka.noteRequired}</span>
          )}
        </label>
        {confirmBox(l, e, l.name)}
      </li>
    );
  };

  const caseCards = (l: ReturnSheetLine) =>
    l.pendingCaseIds.map((caseId) => {
      const e = get(l, caseId);
      const std = l.contents ?? [];
      const short = std.some((c) => (e.contents[c.itemId] ?? 0) < c.qty);
      const number = caseNumber(s, caseId);
      return (
        <li
          key={caseId}
          data-testid={`ret-case-${caseId}`}
          className={`panel p-3 ${e.confirmed ? 'border-ok' : ''}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <CaseLabel>{number}</CaseLabel>
              <span className="font-cond font-bold">{l.name}</span>
            </span>
            <button
              type="button"
              className="btn btn-sm"
              disabled={e.missingCase}
              onClick={() =>
                set(l, { contents: Object.fromEntries(std.map((c) => [c.itemId, c.qty])) }, caseId)
              }
            >
              {cs.vratka.completeStandard}
            </button>
          </div>
          {!e.missingCase && (
            <ul className="mt-2 space-y-2">
              {std.map((c) => (
                <li key={c.itemId} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {itemName(s, c.itemId)} <span className="text-xs text-muted">/ {c.qty}</span>
                  </span>
                  <Stepper
                    value={e.contents[c.itemId] ?? 0}
                    max={c.qty}
                    label={`${number}: ${itemName(s, c.itemId)}`}
                    onChange={(n) => set(l, { contents: { ...e.contents, [c.itemId]: n } }, caseId)}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 grid gap-2">
            {!e.missingCase && locationPicker(l, e, caseId)}
            {!e.missingCase && conditionPicker(l, e, caseId)}
            {!e.missingCase && e.condition !== 'ok' && std[0] && (
              <label className="block">
                <span className="label">
                  {cs.vratka.damagedQty} ({itemName(s, std[0].itemId)})
                </span>
                <input
                  type="number"
                  className="input w-24"
                  min={1}
                  max={std[0].qty}
                  value={Math.max(1, e.damaged)}
                  onChange={(ev) =>
                    set(l, { damaged: Math.max(1, Number(ev.target.value) || 1) }, caseId)
                  }
                />
              </label>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={e.missingCase}
                onChange={(ev) => set(l, { missingCase: ev.target.checked }, caseId)}
              />
              {cs.vratka.caseMissing}
            </label>
            <label className="block">
              <span className="label">{cs.vratka.note}</span>
              <input
                className={`input ${(short || e.missingCase) && !e.note.trim() ? 'border-bad' : ''}`}
                value={e.note}
                onChange={(ev) => set(l, { note: ev.target.value }, caseId)}
              />
            </label>
          </div>
          {confirmBox(l, e, number, caseId)}
        </li>
      );
    });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link to={`/bookings/${id}`} className="text-sm underline">
          {cs.common.back}
        </Link>
        <h1 className="mt-1">{cs.vratka.title(b.eventName)}</h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-muted">
          <StatusChip status={b.status} /> {cs.vratka.intro}
        </p>
      </div>
      {result && (
        <section data-testid="vratka-result" className="panel border-tape p-3 text-sm">
          <h2>{cs.vratka.result}</h2>
          <p>{cs.vratka.resultStatus(cs.status[b.status])}</p>
          {result.issues.length > 0 && (
            <>
              <h3 className="mt-2 font-semibold">{cs.vratka.resultIssues}</h3>
              <ul className="list-disc pl-5">
                {result.issues.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          )}
          {result.services.length > 0 && (
            <>
              <h3 className="mt-2 font-semibold">{cs.vratka.resultService}</h3>
              <ul className="list-disc pl-5">
                {result.services.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {pending.length === 0 ? (
        <Empty>{cs.vratka.nothingPending}</Empty>
      ) : (
        <ul className="space-y-3">
          {pending.flatMap((l) => (l.kind === 'case' ? caseCards(l) : [lineCard(l)]))}
        </ul>
      )}
      {canRecord && (
        <details className="panel p-3 text-sm">
          <summary className="cursor-pointer font-semibold">{cs.vratka.unexpected}</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label>
              <span className="label">{cs.vratka.unexpectedItem}</span>
              <select className="input" value={uItem} onChange={(e) => setUItem(e.target.value)}>
                <option value="" />
                {s.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">{cs.vratka.unexpectedName}</span>
              <input className="input" value={uName} onChange={(e) => setUName(e.target.value)} />
            </label>
            <label>
              <span className="label">{cs.common.qty}</span>
              <input
                type="number"
                className="input"
                min={1}
                value={uQty}
                onChange={(e) => setUQty(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
            <label>
              <span className="label">{cs.vratka.note}</span>
              <input className="input" value={uNote} onChange={(e) => setUNote(e.target.value)} />
            </label>
          </div>
          <button
            type="button"
            className="btn btn-sm mt-2"
            disabled={!uNote.trim() || (!uItem && !uName.trim())}
            onClick={() => {
              const u: UnexpectedItem = { qty: uQty, note: uNote.trim() };
              if (uItem) u.itemId = uItem;
              if (uName.trim()) u.name = uName.trim();
              setUnexpected([...unexpected, u]);
              setUItem('');
              setUName('');
              setUNote('');
              setUQty(1);
            }}
          >
            {cs.vratka.unexpectedAdd}
          </button>
          {unexpected.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {unexpected.map((u, i) => (
                <li key={i}>
                  {u.qty}× {u.itemId ? itemName(s, u.itemId) : u.name} — {u.note}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
      {settled.length > 0 && (
        <section>
          <h2>{cs.vratka.settled}</h2>
          <ul className="mt-1 text-sm">
            {settled.map((l) => (
              <li key={l.lineId}>
                {l.name}:{' '}
                <span className={l.outcome === 'missing' ? 'text-bad' : 'text-ok'}>
                  {cs.vratka.outcome[l.outcome]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {canRecord && (
        <div className="sticky bottom-0 -mx-4 border-t border-alu-line bg-alu/95 px-4 py-3 backdrop-blur">
          <button
            type="button"
            className="btn btn-primary min-h-12 w-full text-base"
            disabled={inputs.length === 0 && unexpected.length === 0}
            onClick={submit}
          >
            {cs.vratka.submit(inputs.length)}
          </button>
        </div>
      )}
    </div>
  );
}
