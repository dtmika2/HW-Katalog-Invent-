/**
 * Shipping on a phone: what is packed leaves the warehouse. Packed gear is ticked already (each
 * piece was checked while packing), promised gear always needs its own tick.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  can,
  closePromised,
  confirmHandover,
  firstBookedFrom,
  handoverOf,
  openPromises,
  orderProgress,
  packedInHouse,
  packingList,
  shipBatch,
  type PackLine,
  type ShipmentLine,
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
  CancelRequests,
  DeliveryTabs,
  PromiseReasons,
  ShipConfirm,
} from '../components/Delivery';
import { CaseLabel, Empty, StatusChip } from '../components/ui';
import { cs, fmtDate } from '../i18n/cs';
import { caseNumber, packByGroup, warehouseName } from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';

interface Promised extends CasePicks {
  ticked: boolean;
  qty: number;
}

function WontCome({ id, l }: { id: string; l: PackLine | { lineId: string; name: string } }) {
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const [reason, setReason] = useState<string | undefined>();
  if (reason === undefined)
    return (
      <button
        type="button"
        className="text-xs text-muted underline"
        aria-label={`${cs.shipping.wontCome}: ${l.name}`}
        onClick={() => setReason('')}
      >
        {cs.shipping.wontCome}
      </button>
    );
  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run((st) => closePromised(st, user, today, id, l.lineId, reason), cs.shipping.closed);
      }}
    >
      <label className="min-w-52 flex-1">
        <span className="label">{cs.shipping.wontComeReason}</span>
        <input
          className="input"
          autoFocus
          placeholder={cs.shipping.wontComeHint}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button type="submit" className="btn btn-danger" disabled={!reason.trim()}>
        {cs.shipping.wontComeSave}
      </button>
      <button type="button" className="btn" onClick={() => setReason(undefined)}>
        {cs.common.cancel}
      </button>
    </form>
  );
}

export function Shipping() {
  const { id = '' } = useParams();
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  /** Line ids (or case ids) that stay for another van. */
  const [stays, setStays] = useState<Set<string>>(new Set());
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [promised, setPromised] = useState<Record<string, Promised>>({});
  const [confirming, setConfirming] = useState(false);
  const b = s.bookings.find((x) => x.id === id);
  const pl = b && packingList(s, id);
  if (!b || !pl) return <Empty>{cs.errors.not_found}</Empty>;
  const canShip = can(user, 'ship') && ['packing', 'packed', 'shipped'].includes(b.status);
  const canClose = canShip || can(user, 'mark_line');
  const all = [...pl.byWarehouse.flatMap((w) => w.groups.flatMap((g) => g.lines)), ...pl.external];
  const packed = all.filter((l) => l.progress.readyPacked > 0);
  const waiting = all.filter((l) => l.progress.readyDeferred > 0);
  const progress = orderProgress(s, b);
  const open = openPromises(s, b);
  const transfers = pl.transfers.filter((l) => open.some((p) => p.lineId === l.lineId));
  const batchNo =
    s.shipments.filter((x) => x.bookingId === id && !x.transferFromBookingId).length + 1;

  const toggle = (key: string) => {
    const next = new Set(stays);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setStays(next);
  };
  const casesOf = (l: PackLine) => packedInHouse(s, id, l.lineId).flatMap((e) => e.caseIds ?? []);
  const qtyOf = (l: PackLine) =>
    Math.min(qtys[l.lineId] ?? l.progress.readyPacked, l.progress.readyPacked);
  const promisedOf = (l: PackLine): Promised =>
    promised[l.lineId] ?? { ...noCases(), ticked: false, qty: l.progress.readyDeferred };
  const setPromisedOf = (l: PackLine, p: Partial<Promised>) =>
    setPromised({ ...promised, [l.lineId]: { ...promisedOf(l), ...p } });

  const lines: ShipmentLine[] = [];
  for (const l of packed) {
    if (l.kind === 'case') {
      const ids = casesOf(l)
        .filter((c) => !stays.has(c))
        .slice(0, l.progress.readyPacked);
      if (ids.length > 0) lines.push({ lineId: l.lineId, qty: ids.length, caseIds: ids });
    } else if (!stays.has(l.lineId)) lines.push({ lineId: l.lineId, qty: qtyOf(l) });
  }
  const unchecked: string[] = [];
  for (const l of waiting) {
    const p = promisedOf(l);
    if (!p.ticked) continue;
    if (l.kind === 'case') {
      unchecked.push(...uncheckedCases(s, l, p));
      if (p.caseIds.length > 0)
        lines.push({
          lineId: l.lineId,
          qty: p.caseIds.length,
          deferred: true,
          caseIds: p.caseIds,
          caseChecks: caseChecksOf(l, p),
        });
    } else
      lines.push({
        lineId: l.lineId,
        qty: Math.min(p.qty, l.progress.readyDeferred),
        deferred: true,
      });
  }
  const count = lines.reduce((n, l) => n + l.qty, 0);
  // what stays promised after this van
  const missing = open
    .map((p) => ({
      ...p,
      qty: p.qty - (lines.find((l) => l.deferred && l.lineId === p.lineId)?.qty ?? 0),
    }))
    .filter((p) => p.qty > 0);

  const ship = (label: string, note: string) => {
    const err = run(
      (st) => shipBatch(st, user, today, id, { label, lines, ...(note.trim() ? { note } : {}) }),
      cs.packing.shipped(label),
    );
    if (err) return;
    setStays(new Set());
    setQtys({});
    setPromised({});
    setConfirming(false);
  };

  const packedRow = (l: PackLine) => (
    <li key={l.lineId} data-testid={`ship-${l.lineId}`} className="panel p-3">
      {l.kind === 'case' ? (
        <>
          <p className="font-cond text-lg font-bold leading-tight">{l.name}</p>
          <div className="mt-1 flex flex-wrap gap-3">
            {casesOf(l).map((c) => (
              <label key={c} className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  className="h-6 w-6"
                  disabled={!canShip}
                  checked={!stays.has(c)}
                  onChange={() => toggle(c)}
                />
                <CaseLabel>{caseNumber(s, c)}</CaseLabel>
              </label>
            ))}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-3">
          <label className="flex min-h-11 min-w-0 flex-1 items-center gap-3">
            <input
              type="checkbox"
              className="h-6 w-6 shrink-0"
              aria-label={`${cs.shipping.load}: ${l.name}`}
              disabled={!canShip}
              checked={!stays.has(l.lineId)}
              onChange={() => toggle(l.lineId)}
            />
            <span>
              <strong className="font-cond text-lg">{l.progress.readyPacked}×</strong> {l.name}
            </span>
          </label>
          {l.progress.readyPacked > 1 && canShip && (
            <input
              type="number"
              className="input w-20"
              aria-label={cs.shipping.qty(l.name)}
              min={1}
              max={l.progress.readyPacked}
              value={qtyOf(l)}
              disabled={stays.has(l.lineId)}
              onChange={(e) =>
                setQtys({
                  ...qtys,
                  [l.lineId]: Math.min(
                    l.progress.readyPacked,
                    Math.max(1, Number(e.target.value) || 1),
                  ),
                })
              }
            />
          )}
        </div>
      )}
    </li>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="space-y-2">
        <BackToBooking id={id} />
        <h1>{cs.shipping.title(b.eventName)}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <StatusChip status={b.status} /> {fmtDate(firstBookedFrom(b))}
        </p>
        <DeliveryTabs id={id} ready={progress.ready} />
      </div>
      <CancelRequests id={id} />
      {progress.toPack > 0 && (
        <p className="rounded border border-warn/40 bg-warn-light p-3 text-sm">
          {cs.shipping.notPacked(progress.toPack)}{' '}
          <Link to={`/packing/${id}`} className="underline">
            {cs.shipping.toPacking}
          </Link>
        </p>
      )}

      {waiting.length > 0 && (
        <section className="space-y-2" data-testid="promised">
          <h2>{cs.shipping.promised}</h2>
          <p className="text-sm text-muted">{cs.shipping.promisedHint}</p>
          <ul className="space-y-2">
            {waiting.map((l) => {
              const p = promisedOf(l);
              const max = l.progress.readyDeferred;
              const t = b.lines.find((x) => x.id === l.lineId)?.target;
              const ext = t && 'external' in t ? t.external : undefined;
              return (
                <li
                  key={l.lineId}
                  data-testid={`promised-${l.lineId}`}
                  className="panel border-l-4 border-l-warn-bright p-3"
                >
                  <div className="flex items-center gap-3">
                    <label className="flex min-h-11 min-w-0 flex-1 items-center gap-3">
                      <input
                        type="checkbox"
                        className="h-6 w-6 shrink-0"
                        aria-label={`${cs.shipping.arrived}: ${l.name}`}
                        disabled={!canShip}
                        checked={p.ticked}
                        onChange={(e) =>
                          setPromisedOf(
                            l,
                            l.kind === 'case'
                              ? {
                                  ticked: e.target.checked,
                                  caseIds: e.target.checked ? firstFreeCases(l, max) : [],
                                  checks: {},
                                }
                              : { ticked: e.target.checked },
                          )
                        }
                      />
                      <span>
                        <strong className="font-cond text-lg">{max}×</strong> {l.name}
                        {ext && (
                          <span className="block text-xs text-muted">
                            {cs.shipping.supplier(ext.supplier, fmtDate(ext.pickup))}
                          </span>
                        )}
                        <PromiseReasons l={l} />
                      </span>
                    </label>
                    {l.kind !== 'case' && max > 1 && p.ticked && (
                      <input
                        type="number"
                        className="input w-20"
                        aria-label={cs.shipping.qty(l.name)}
                        min={1}
                        max={max}
                        value={Math.min(p.qty, max)}
                        onChange={(e) =>
                          setPromisedOf(l, {
                            qty: Math.min(max, Math.max(1, Number(e.target.value) || 1)),
                          })
                        }
                      />
                    )}
                  </div>
                  {l.kind === 'case' && p.ticked && (
                    <CasePicker
                      s={s}
                      l={l}
                      limit={max}
                      value={p}
                      onChange={(v) => setPromisedOf(l, v)}
                    />
                  )}
                  {canClose && <WontCome id={id} l={l} />}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {transfers.length > 0 && (
        <section className="space-y-2" data-testid="handovers">
          <h2>{cs.packing.transfers}</h2>
          <ul className="space-y-2">
            {transfers.map((l) => {
              const line = b.lines.find((x) => x.id === l.lineId);
              const h = line && handoverOf(s, b, line);
              const from = s.bookings.find((x) => x.id === l.fromBookingId);
              return (
                <li
                  key={l.lineId}
                  className="panel flex flex-wrap items-center justify-between gap-2 border-l-4 border-l-warn-bright p-3"
                >
                  <span>
                    <strong className="font-cond text-lg">{l.remaining}×</strong> {l.name}
                    <span className="block text-xs text-muted">
                      {cs.packing.transferFrom(from?.eventName ?? '')}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {h?.whole && can(user, 'record_return') && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          run(
                            (st) => confirmHandover(st, user, today, id, l.lineId),
                            cs.shipping.handedOver,
                          )
                        }
                      >
                        {cs.shipping.confirmHandover(h.outstanding)}
                      </button>
                    )}
                    {h && !h.whole && (
                      <Link to={`/vratka/${l.fromBookingId}`} className="btn">
                        {cs.issues.openVratka}
                      </Link>
                    )}
                    {!h && (
                      <span className="text-xs text-muted">{cs.shipping.notShippedThere}</span>
                    )}
                    {canClose && <WontCome id={id} l={l} />}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="space-y-2" data-testid="packed">
        <h2>{cs.shipping.packed}</h2>
        {packed.length === 0 ? (
          <Empty>{cs.shipping.nothingPacked}</Empty>
        ) : (
          <>
            {canShip && <p className="text-sm text-muted">{cs.shipping.packedHint}</p>}
            {pl.byWarehouse.map((w) => {
              const here = packed.filter(
                (l) => l.kind !== 'external' && l.warehouseId === w.warehouseId,
              );
              if (here.length === 0) return null;
              return (
                <div key={w.warehouseId} className="space-y-2">
                  <h3 className="text-sm font-semibold">
                    {cs.packing.warehouse(warehouseName(s, w.warehouseId))}
                  </h3>
                  {packByGroup(b, here).map((g) => (
                    <div key={g.id || 'none'} className="space-y-1">
                      {g.name && <h4 className="text-xs font-semibold text-muted">{g.name}</h4>}
                      <ul className="space-y-2">{g.lines.map(packedRow)}</ul>
                    </div>
                  ))}
                </div>
              );
            })}
            {packed.some((l) => l.kind === 'external') && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">{cs.shipping.externalPacked}</h3>
                <ul className="space-y-2">
                  {packed.filter((l) => l.kind === 'external').map(packedRow)}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      {canShip && progress.ready > 0 && (
        <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-alu-line bg-alu/95 px-4 py-3 backdrop-blur">
          {unchecked.length > 0 && (
            <p className="text-sm text-bad" role="status">
              {cs.packing.check.missing(unchecked.map((c) => caseNumber(s, c)).join(', '))}
            </p>
          )}
          {confirming && count > 0 && unchecked.length === 0 ? (
            <ShipConfirm
              defaultLabel={cs.packing.labelDefault(batchNo)}
              missing={missing}
              button={cs.shipping.ship(count)}
              onShip={ship}
              onCancel={() => setConfirming(false)}
            />
          ) : (
            <button
              type="button"
              className="btn btn-primary min-h-12 w-full text-base"
              disabled={count === 0 || unchecked.length > 0}
              onClick={() => setConfirming(true)}
            >
              {cs.shipping.next(count)}
            </button>
          )}
        </div>
      )}
      <CancelPacking id={id} />
      <Batches s={s} id={id} />
    </div>
  );
}
