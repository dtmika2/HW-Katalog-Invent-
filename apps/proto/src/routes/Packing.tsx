import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  can,
  cancelLocked,
  caseContentQty,
  casePlaces,
  diffDays,
  earlyPackingHits,
  firstBookedFrom,
  isEarlyPacking,
  loansOut,
  openPromises,
  orderProgress,
  packAndShip,
  packedInHouse,
  packingList,
  packLines,
  startPacking,
  unpackLine,
  type PackedLine,
  type PackLine,
} from '@quix/core';
import {
  CasePicker,
  caseChecksOf,
  firstFreeCases,
  noCases,
  uncheckedCases,
  type CasePicks,
} from '../components/CasePicker';
import {
  BackToBooking,
  Batches,
  CancelPacking,
  DeliveryTabs,
  PromiseReasons,
  ShipConfirm,
} from '../components/Delivery';
import { Hits, loanLine } from '../components/Loans';
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

interface Pick extends CasePicks {
  ticked: boolean;
  qty: number;
  fromCaseId: string;
}

/** Starting; far ahead with a warning and the events that would get short. */
function StartPacking({ id, onStart }: { id: string; onStart: (reason: string) => void }) {
  const s = useAppState();
  const today = useToday();
  const [reason, setReason] = useState('');
  const b = s.bookings.find((x) => x.id === id);
  const early = !!b && isEarlyPacking(s, b, today);
  const hits = useMemo(() => (early ? earlyPackingHits(s, today, id) : []), [early, s, today, id]);
  if (!b) return null;
  const needsReason = hits.some((h) => h.level === 'order');
  return (
    <div className="mt-2 space-y-2">
      {early && (
        <div data-testid="early-packing" className="space-y-2">
          <p className="rounded border border-warn/40 bg-warn-light p-3 font-medium">
            {cs.packing.early.warn(diffDays(today, firstBookedFrom(b)))}
          </p>
          {hits.length === 0 ? (
            <p className="text-ok">{cs.packing.early.nobody}</p>
          ) : (
            <Hits s={s} hits={hits} />
          )}
          {needsReason && <EarlyReason value={reason} onChange={setReason} />}
        </div>
      )}
      <button
        type="button"
        className="btn btn-primary"
        disabled={needsReason && !reason.trim()}
        onClick={() => onStart(reason)}
      >
        {early ? cs.packing.early.start : cs.packing.start}
      </button>
    </div>
  );
}

function EarlyReason({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="label">{cs.packing.early.reason}</span>
      <input
        className="input"
        placeholder={cs.packing.early.reasonHint}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/**
 * Packing on a phone: one card per line, grouped by warehouse and shelf. What is ticked here is
 * ready but still in the warehouse; it leaves on the shipping screen (or at once).
 */
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
  const [confirming, setConfirming] = useState(false);
  const [early, setEarly] = useState('');
  const [wantGroups, setWantGroups] = useState(false);
  if (!b) return <Empty>{cs.errors.not_found}</Empty>;
  const pl = packingList(s, id);
  if (!pl) return <Empty>{cs.errors.not_found}</Empty>;
  const canPack = can(user, 'pack') && ['packing', 'packed', 'shipped'].includes(b.status);
  // taking packed gear back: the Chief always, the warehouse until the event begins
  const canUnpack =
    ['packing', 'packed', 'shipped'].includes(b.status) &&
    can(user, 'cancel_delivery') &&
    (!cancelLocked(b, today) || can(user, 'cancel_after_start'));
  const progress = orderProgress(s, b);

  const pick = (l: PackLine): Pick =>
    picks[l.lineId] ?? { ...noCases(), ticked: false, qty: l.progress.toPack, fromCaseId: '' };
  const setPick = (l: PackLine, p: Partial<Pick>) =>
    setPicks({ ...picks, [l.lineId]: { ...pick(l), ...p } });
  const allLines = [
    ...pl.byWarehouse.flatMap((w) => w.groups.flatMap((g) => g.lines)),
    ...pl.external,
  ];
  const ticked = allLines.filter((l) => l.progress.toPack > 0 && pick(l).ticked);
  const unchecked = ticked.flatMap((l) => (l.kind === 'case' ? uncheckedCases(s, l, pick(l)) : []));
  const newLinesPending = allLines.some((l) => l.addedAfterShipping && l.progress.toPack > 0);

  const lines: PackedLine[] = ticked.map((l) => {
    const p = pick(l);
    return {
      lineId: l.lineId,
      qty: l.kind === 'case' ? p.caseIds.length : Math.min(p.qty, l.progress.toPack),
      ...(l.kind === 'case' ? { caseIds: p.caseIds, caseChecks: caseChecksOf(l, p) } : {}),
      ...(p.fromCaseId ? { fromCaseId: p.fromCaseId } : {}),
    };
  });
  // packed before the booked days: who gets short because of exactly these lines
  const hits = b.earlyPacking ? [] : earlyPackingHits(s, today, id, lines);
  const needsReason = hits.some((h) => h.level === 'order');
  const blocked = ticked.length === 0 || unchecked.length > 0 || (needsReason && !early.trim());
  const why = needsReason ? { earlyReason: early } : {};
  const pack = () => {
    const n = lines.reduce((x, l) => x + l.qty, 0);
    if (!run((st) => packLines(st, user, today, id, lines, why), cs.packing.packedOk(n)))
      setPicks({});
  };
  const packShip = (label: string, note: string) => {
    const err = run(
      (st) =>
        packAndShip(st, user, today, id, {
          label,
          lines,
          ...why,
          ...(note.trim() ? { note } : {}),
        }),
      cs.packing.shipped(label),
    );
    if (err) return;
    setPicks({});
    setConfirming(false);
  };
  const places = casePlaces(s);

  const card = (l: PackLine) => {
    const p = pick(l);
    const g = l.progress;
    const done = g.toPack === 0;
    const here = packedInHouse(s, id, l.lineId);
    const casesHere = here.flatMap((e) => e.caseIds ?? []);
    const lent = l.itemId && l.warehouseId ? loansOut(s, l.itemId, l.warehouseId, today) : [];
    const sourceCases =
      l.kind === 'item' && l.itemId
        ? s.cases.filter(
            (c) =>
              c.warehouseId === l.warehouseId &&
              !c.archived &&
              !places.has(c.id) &&
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
            disabled={done || !canPack}
            checked={done || p.ticked}
            onChange={(e) => {
              if (l.kind !== 'case') setPick(l, { ticked: e.target.checked });
              // Ticking a case line picks the first free complete cases; the packer can change them.
              else
                setPick(l, {
                  ticked: e.target.checked,
                  caseIds: e.target.checked ? firstFreeCases(l, g.toPack) : [],
                  checks: {},
                });
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
                {[
                  g.shipped > 0 && cs.packing.shippedN(g.shipped),
                  g.readyPacked > 0 &&
                    (l.packedBy
                      ? cs.packing.packedBy(
                          g.readyPacked,
                          userName(s, l.packedBy.userId),
                          fmtDate(l.packedBy.on),
                        )
                      : cs.packing.packedN(g.readyPacked)),
                  g.readyDeferred > 0 && cs.packing.deferredN(g.readyDeferred),
                  !done && g.toPack < g.qty && cs.packing.remaining(g.toPack),
                ]
                  .filter(Boolean)
                  .join(', ')}
              </span>
            </span>
            {g.extra > 0 && (
              <span className="block text-xs font-medium text-warn">
                {cs.packing.extra(g.extra)}
              </span>
            )}
            <PromiseReasons l={l} />
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
            {casesHere.length > 0 && (
              <ul className="mt-2 space-y-1">
                {casesHere.map((c) => (
                  <li key={c} className="flex items-center gap-2 text-sm">
                    <CaseLabel>{caseNumber(s, c)}</CaseLabel> {cs.packing.packed.toLowerCase()}
                    {canUnpack && (
                      <button
                        type="button"
                        className="text-xs underline"
                        aria-label={`${cs.packing.unpack}: ${caseNumber(s, c)}`}
                        onClick={() =>
                          run(
                            (st) => unpackLine(st, user, today, id, l.lineId, { caseId: c }),
                            cs.packing.unpacked,
                          )
                        }
                      >
                        {cs.packing.unpack}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!done && canPack && (
              <CasePicker
                s={s}
                l={l}
                limit={g.toPack}
                value={p}
                onChange={(v) => setPick(l, { ...v, ticked: v.caseIds.length > 0 })}
              />
            )}
          </div>
        )}
        {l.kind !== 'case' && !done && canPack && (
          <div className="mt-2 flex flex-wrap items-end gap-3 pl-9 text-sm">
            <label className="flex items-center gap-1">
              <span className="text-xs text-muted">{cs.packing.packQty}</span>
              <input
                type="number"
                className="input w-20"
                min={1}
                max={g.toPack}
                value={Math.min(p.qty, g.toPack)}
                onChange={(e) =>
                  setPick(l, {
                    qty: Math.min(g.toPack, Math.max(1, Number(e.target.value) || 1)),
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
        {(canPack || canUnpack) && (
          <div className="mt-2 flex flex-wrap gap-3 pl-9 text-sm">
            {canPack && l.deferrable > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                aria-label={`${cs.packing.defer(l.deferrable)}: ${l.name}`}
                onClick={() =>
                  run(
                    (st) =>
                      packLines(st, user, today, id, [
                        { lineId: l.lineId, qty: l.deferrable, deferred: true },
                      ]),
                    cs.packing.deferOk,
                  )
                }
              >
                {cs.packing.defer(l.deferrable)}
              </button>
            )}
            {canPack && g.readyDeferred > 0 && (
              <button
                type="button"
                className="text-xs underline"
                onClick={() =>
                  run((st) => unpackLine(st, user, today, id, l.lineId, { deferred: true }))
                }
              >
                {cs.packing.undoDefer}
              </button>
            )}
            {canUnpack && l.kind !== 'case' && here.length > 0 && (
              <button
                type="button"
                className="text-xs underline"
                aria-label={`${cs.packing.unpack}: ${l.name}`}
                onClick={() =>
                  run(
                    (st) =>
                      unpackLine(
                        st,
                        user,
                        today,
                        id,
                        l.lineId,
                        g.extra > 0 ? { qty: g.extra } : {},
                      ),
                    cs.packing.unpacked,
                  )
                }
              >
                {g.extra > 0 ? cs.packing.unpackExtra(g.extra) : cs.packing.unpack}
              </button>
            )}
          </div>
        )}
      </li>
    );
  };

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
          <BackToBooking id={id} />
          <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
            <h1>{cs.packing.title(b.eventName)}</h1>
            <PrintButton />
          </div>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted">
            <StatusChip status={b.status} /> {fmtDate(firstBookedFrom(b))}
            {progress.toPack > 0 && b.status !== 'confirmed' && (
              <span>{cs.packing.progress(progress.packed, progress.qty)}</span>
            )}
          </p>
          {b.earlyPacking && (
            <p className="mt-1 text-xs text-warn">
              {cs.packing.early.given(userName(s, b.earlyPacking.by), b.earlyPacking.reason)}
            </p>
          )}
          {b.status !== 'confirmed' && (
            <div className="mt-2">
              <DeliveryTabs id={id} ready={progress.ready} />
            </div>
          )}
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
              <StartPacking
                id={id}
                onStart={(reason) => run((st) => startPacking(st, user, today, id, reason))}
              />
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
            <p className="text-sm text-muted">{cs.packing.transferHint}</p>
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
        {canPack && progress.toPack > 0 && (
          <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-alu-line bg-alu/95 px-4 py-3 backdrop-blur">
            {unchecked.length > 0 && (
              <p className="text-sm text-bad" role="status">
                {cs.packing.check.missing(unchecked.map((c) => caseNumber(s, c)).join(', '))}
              </p>
            )}
            {hits.length > 0 && (
              <div data-testid="early-lines" className="max-h-[40vh] space-y-2 overflow-y-auto">
                <p className="text-sm font-medium">{cs.packing.early.warnLines}</p>
                <Hits s={s} hits={hits} />
                {needsReason && <EarlyReason value={early} onChange={setEarly} />}
              </div>
            )}
            {confirming && !blocked ? (
              <ShipConfirm
                defaultLabel={cs.packing.labelDefault(batchNo)}
                missing={openPromises(s, b)}
                button={cs.packing.packShip(ticked.length)}
                onShip={packShip}
                onCancel={() => setConfirming(false)}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary min-h-12 flex-1 whitespace-nowrap text-base"
                  disabled={blocked}
                  onClick={pack}
                >
                  {cs.packing.pack(ticked.length)}
                </button>
                <button
                  type="button"
                  className="btn min-h-12 flex-1 whitespace-nowrap"
                  disabled={blocked}
                  onClick={() => setConfirming(true)}
                >
                  {cs.packing.packShip(ticked.length)}
                </button>
              </div>
            )}
          </div>
        )}
        {canPack && progress.toPack === 0 && progress.ready > 0 && (
          <div className="panel flex flex-wrap items-center justify-between gap-2 border-ok p-3 text-sm">
            <span>{cs.packing.allPacked}</span>
            <Link to={`/shipping/${id}`} className="btn btn-primary">
              {cs.shipping.open}
            </Link>
          </div>
        )}
        <CancelPacking id={id} />
        <Batches s={s} id={id} />
      </div>
    </>
  );
}
