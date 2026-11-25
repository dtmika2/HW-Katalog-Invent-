import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  can,
  caseContentQty,
  firstBookedFrom,
  loansOut,
  packingList,
  shipBatch,
  startPacking,
  type PackLine,
  type ShipmentLine,
} from '@quix/core';
import {
  CaseChecklist,
  emptyDraft,
  isChecked,
  toCheck,
  type CaseDraft,
} from '../components/CaseChecklist';
import { loanLine } from '../components/Loans';
import { PackingPrint } from '../components/PackingPrint';
import { PrintButton } from '../components/print';
import { CaseLabel, Empty, StatusChip } from '../components/ui';
import { cs, fmtDate } from '../i18n/cs';
import {
  caseNumber,
  itemName,
  locationPath,
  packByGroup,
  userName,
  warehouseName,
} from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';

interface Pick {
  ticked: boolean;
  qty: number;
  caseIds: string[];
  fromCaseId: string;
  /** Case checklists by case id; a case that is deselected starts over. */
  checks: Record<string, CaseDraft>;
}

/** Packing list on a phone: one card per line, grouped by warehouse and shelf; ship in batches. */
export function Packing() {
  const { id = '' } = useParams();
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const b = s.bookings.find((x) => x.id === id);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const batchNo =
    s.shipments.filter((x) => x.bookingId === id && !x.transferFromBookingId).length + 1;
  const [label, setLabel] = useState('');
  const [wantGroups, setWantGroups] = useState(false);
  if (!b) return <Empty>{cs.errors.not_found}</Empty>;
  const pl = packingList(s, id);
  if (!pl) return <Empty>{cs.errors.not_found}</Empty>;
  const canShip = can(user, 'ship') && ['packing', 'shipped'].includes(b.status);

  const pick = (l: PackLine): Pick =>
    picks[l.lineId] ?? { ticked: false, qty: l.remaining, caseIds: [], fromCaseId: '', checks: {} };
  const setPick = (l: PackLine, p: Partial<Pick>) => {
    const next = { ...pick(l), ...p };
    next.checks = Object.fromEntries(
      Object.entries(next.checks).filter(([id]) => next.caseIds.includes(id)),
    );
    setPicks({ ...picks, [l.lineId]: next });
  };
  const allLines = [
    ...pl.byWarehouse.flatMap((w) => w.groups.flatMap((g) => g.lines)),
    ...pl.external,
  ];
  const ticked = allLines.filter((l) => l.remaining > 0 && pick(l).ticked);
  const unchecked = ticked.flatMap((l) =>
    l.kind === 'case'
      ? pick(l).caseIds.filter(
          (c) => !isChecked(s, c, l.contents ?? [], pick(l).checks[c] ?? emptyDraft()),
        )
      : [],
  );
  const newLinesPending = allLines.some((l) => l.addedAfterShipping && l.remaining > 0);

  const ship = () => {
    const lines: ShipmentLine[] = ticked.map((l) => {
      const p = pick(l);
      const sl: ShipmentLine = {
        lineId: l.lineId,
        qty: l.kind === 'case' ? p.caseIds.length : p.qty,
      };
      if (l.kind === 'case') {
        sl.caseIds = p.caseIds;
        sl.caseChecks = p.caseIds.map((c) =>
          toCheck(c, l.contents ?? [], p.checks[c] ?? emptyDraft()),
        );
      }
      if (p.fromCaseId) sl.fromCaseId = p.fromCaseId;
      return sl;
    });
    const name = label.trim() || cs.packing.labelDefault(batchNo);
    if (
      !run((st) => shipBatch(st, user, today, id, { label: name, lines }), cs.packing.shipped(name))
    ) {
      setPicks({});
      setLabel('');
    }
  };

  const card = (l: PackLine) => {
    const p = pick(l);
    const done = l.remaining === 0;
    const lent = l.itemId && l.warehouseId ? loansOut(s, l.itemId, l.warehouseId, today) : [];
    const sourceCases =
      l.kind === 'item' && l.itemId
        ? s.cases.filter(
            (c) =>
              c.warehouseId === l.warehouseId &&
              !c.archived &&
              caseContentQty(c, l.itemId ?? '') > 0,
          )
        : [];
    return (
      <li
        key={l.lineId}
        data-testid={`pack-${l.lineId}`}
        className={`panel p-3 ${done ? 'opacity-60' : ''}`}
      >
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-6 w-6 shrink-0"
            aria-label={`${cs.packing.packed}: ${l.name}`}
            disabled={done || !canShip}
            checked={done || p.ticked}
            onChange={(e) => {
              if (l.kind === 'case' && e.target.checked && p.caseIds.length === 0) {
                // Ticking a case line picks the first free complete cases; the packer can change them.
                const free = (l.candidateCases ?? []).filter((c) => c.complete && !c.busy);
                setPick(l, {
                  ticked: true,
                  caseIds: free.slice(0, l.remaining).map((c) => c.caseId),
                });
              } else if (!e.target.checked) setPick(l, { ticked: false, caseIds: [] });
              else setPick(l, { ticked: true });
            }}
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-cond text-lg font-bold leading-tight">{l.name}</span>
              {l.kind === 'case' && <CaseLabel>{cs.editor.caseTag}</CaseLabel>}
              {l.consumable && <span className="text-xs text-warn">{cs.packing.consumable}</span>}
              {l.addedAfterShipping && !done && (
                <span className="rounded bg-bad px-1.5 text-xs text-white">
                  {cs.notifications.highPriority}
                </span>
              )}
            </span>
            <span className="block text-sm">
              <strong className="font-cond text-xl">{l.qty}×</strong>{' '}
              <span className="text-muted">
                {done
                  ? cs.packing.allShipped
                  : l.shipped > 0
                    ? cs.packing.remaining(l.remaining)
                    : ''}
              </span>
            </span>
            {!done && lent.length > 0 && (
              <span className="block text-xs font-medium text-warn">
                {cs.loans.packingHint(lent.map((x) => loanLine(s, x)).join('; '))}
              </span>
            )}
            {(byGroup || l.group) && (
              <span className="block text-xs text-muted">
                {byGroup
                  ? l.locationId && cs.packing.shelf(locationPath(s, l.locationId))
                  : l.group && cs.packing.group(l.group.name)}
              </span>
            )}
            {l.forHint.length > 0 && (
              <span className="block text-xs text-muted">
                {cs.editor.forHint(l.forHint.map((h) => `${h.name} ×${h.qty}`).join(', '))}
              </span>
            )}
          </span>
        </label>
        {l.kind === 'case' && (
          <div className="mt-2 pl-9">
            <ul className="text-xs text-muted">
              {(l.contents ?? []).map((c) => (
                <li key={c.itemId}>
                  {c.qty}× {itemName(s, c.itemId)}
                </li>
              ))}
            </ul>
            {!done && canShip && (
              <fieldset className="mt-2">
                <legend className="label">{cs.packing.pickCases}</legend>
                <div className="flex flex-wrap gap-2">
                  {(l.candidateCases ?? []).map((c) => {
                    const on = p.caseIds.includes(c.caseId);
                    return (
                      <label
                        key={c.caseId}
                        className={`flex items-center gap-1 rounded border px-2 py-1 text-sm ${on ? 'border-tape bg-tape-light' : 'border-alu-line'}`}
                      >
                        <input
                          type="checkbox"
                          disabled={c.busy || !c.complete}
                          checked={on}
                          onChange={(e) => {
                            const ids = e.target.checked
                              ? [...p.caseIds, c.caseId].slice(-l.remaining)
                              : p.caseIds.filter((x) => x !== c.caseId);
                            setPick(l, { caseIds: ids, ticked: ids.length > 0 });
                          }}
                        />
                        <CaseLabel>{c.number}</CaseLabel>
                        {c.busy && (
                          <span className="text-xs text-muted">{cs.packing.caseBusy}</span>
                        )}
                        {!c.complete && !c.busy && (
                          <span className="text-xs text-bad">{cs.packing.caseIncomplete}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
            {!done &&
              canShip &&
              p.caseIds.map((caseId) => (
                <CaseChecklist
                  key={caseId}
                  s={s}
                  caseId={caseId}
                  contents={l.contents ?? []}
                  value={p.checks[caseId] ?? emptyDraft()}
                  onChange={(d) => setPick(l, { checks: { ...p.checks, [caseId]: d } })}
                />
              ))}
          </div>
        )}
        {l.kind !== 'case' && !done && canShip && (
          <div className="mt-2 flex flex-wrap items-end gap-3 pl-9 text-sm">
            <label className="flex items-center gap-1">
              <span className="text-xs text-muted">{cs.packing.shipQty}</span>
              <input
                type="number"
                className="input w-20"
                min={1}
                max={l.remaining}
                value={p.qty}
                onChange={(e) =>
                  setPick(l, {
                    qty: Math.min(l.remaining, Math.max(1, Number(e.target.value) || 1)),
                  })
                }
              />
            </label>
            {sourceCases.length > 0 && (
              <label className="flex items-center gap-1">
                <span className="text-xs text-muted">{cs.packing.fromCase}</span>
                <select
                  className="input w-auto"
                  value={p.fromCaseId}
                  onChange={(e) => setPick(l, { fromCaseId: e.target.value })}
                >
                  <option value="">{cs.packing.fromCaseNone}</option>
                  {sourceCases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.number}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </li>
    );
  };

  const shipments = s.shipments.filter((x) => x.bookingId === id);
  const hasGroups = allLines.some((l) => l.group);
  const byGroup = hasGroups && wantGroups;
  const pickedCases = Object.fromEntries(
    allLines.map((l) => [l.lineId, pick(l).ticked ? pick(l).caseIds : []]),
  );
  return (
    <>
      <PackingPrint s={s} b={b} list={pl} pickedCases={pickedCases} byGroup={byGroup} />
      <div className="mx-auto max-w-2xl space-y-4 print:hidden">
        <div>
          <Link to={`/bookings/${id}`} className="text-sm underline">
            {cs.common.back}
          </Link>
          <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
            <h1>{cs.packing.title(b.eventName)}</h1>
            <PrintButton />
          </div>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted">
            <StatusChip status={b.status} /> {fmtDate(firstBookedFrom(b))}
          </p>
        </div>
        {b.editedAfterShipping && newLinesPending && (
          <p
            role="alert"
            data-testid="high-priority"
            className="rounded border-2 border-bad bg-bad-light p-3 text-sm font-semibold text-bad"
          >
            {cs.packing.highPriority}
          </p>
        )}
        {b.status === 'confirmed' && (
          <div className="panel p-3 text-sm">
            <p>{cs.packing.notStarted}</p>
            {can(user, 'start_packing') && (
              <button
                type="button"
                className="btn btn-primary mt-2"
                onClick={() => run((st) => startPacking(st, user, today, id))}
              >
                {cs.packing.start}
              </button>
            )}
          </div>
        )}
        {hasGroups && (
          <div
            role="group"
            aria-label={cs.packing.groupBy}
            className="flex items-center gap-2 text-sm text-muted"
          >
            {cs.packing.groupBy}
            {[false, true].map((v) => (
              <button
                key={String(v)}
                type="button"
                className={`btn btn-sm ${byGroup === v ? 'btn-primary' : ''}`}
                aria-pressed={byGroup === v}
                onClick={() => setWantGroups(v)}
              >
                {v ? cs.packing.byGroup : cs.packing.byShelf}
              </button>
            ))}
          </div>
        )}
        {pl.byWarehouse.map((w) => (
          <section key={w.warehouseId} className="space-y-2">
            <h2>{cs.packing.warehouse(warehouseName(s, w.warehouseId))}</h2>
            {byGroup &&
              packByGroup(
                b,
                w.groups.flatMap((g) => g.lines),
              ).map((g) => (
                <div key={g.id || 'none'}>
                  <h3 className="mb-1 text-sm font-semibold">{g.name ?? cs.lines.noGroup}</h3>
                  <ul className="space-y-2">{g.lines.map(card)}</ul>
                </div>
              ))}
            {!byGroup &&
              w.groups.map((g) => (
                <div key={g.locationId ?? 'none'}>
                  <h3 className="mb-1 text-xs font-semibold text-muted">
                    {g.locationId ? locationPath(s, g.locationId) : cs.packing.noLocation}
                  </h3>
                  <ul className="space-y-2">{g.lines.map(card)}</ul>
                </div>
              ))}
          </section>
        ))}
        {pl.external.length > 0 && (
          <section className="space-y-2">
            <h2>{cs.packing.external}</h2>
            <ul className="space-y-2">{pl.external.map(card)}</ul>
          </section>
        )}
        {pl.transfers.length > 0 && (
          <section className="space-y-2">
            <h2>{cs.packing.transfers}</h2>
            <ul className="space-y-1 text-sm">
              {pl.transfers.map((l) => (
                <li key={l.lineId} className="panel p-3">
                  {l.qty}× {l.name} —{' '}
                  {cs.packing.transferFrom(
                    s.bookings.find((x) => x.id === l.fromBookingId)?.eventName ?? '',
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {canShip && (
          <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-alu-line bg-alu/95 px-4 py-3 backdrop-blur">
            <label className="block">
              <span className="label">{cs.packing.label}</span>
              <input
                className="input"
                placeholder={cs.packing.labelDefault(batchNo)}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            {unchecked.length > 0 && (
              <p className="text-sm text-bad" role="status">
                {cs.packing.check.missing(unchecked.map((c) => caseNumber(s, c)).join(', '))}
              </p>
            )}
            <button
              type="button"
              className="btn btn-primary min-h-12 w-full text-base"
              disabled={ticked.length === 0 || unchecked.length > 0}
              onClick={ship}
            >
              {cs.packing.ship(ticked.length)}
            </button>
          </div>
        )}
        {shipments.length > 0 && (
          <section>
            <h2>{cs.packing.batches}</h2>
            <ul className="mt-1 text-sm">
              {shipments.map((sh) => (
                <li key={sh.id}>
                  {cs.packing.batchRow(
                    sh.label,
                    fmtDate(sh.shippedOn),
                    sh.lines.reduce((n, x) => n + x.qty, 0),
                    userName(s, sh.userId),
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
