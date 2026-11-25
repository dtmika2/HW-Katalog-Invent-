import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  can,
  casePlaces,
  diffDays,
  firstBookedFrom,
  isEarlyPacking,
  isOpenService,
  isServiceOverdue,
  lastBookedUntil,
  openLoans,
  orderProgress,
  refillCase,
  refillTasksWithAge,
} from '@quix/core';
import { byReturn, LoanList } from '../components/Loans';
import { CaseLabel, PartlyShipped, Section, StatusChip } from '../components/ui';
import { cs, fmtDate } from '../i18n/cs';
import { caseNumber, itemName, userName } from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';
import { IssuesList } from './Issues';

/** Warehouse dashboard: packing, expected returns, gear to check, service, incomplete cases. */
export function WarehouseDashboard() {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const soon = s.bookings
    .filter(
      (b) =>
        b.type === 'order' &&
        !b.cancelPending &&
        (b.status === 'confirmed' || (b.status === 'packing' && orderProgress(s, b).toPack > 0)),
    )
    .sort((a, b) => (firstBookedFrom(a) < firstBookedFrom(b) ? -1 : 1));
  /** Far orders the person decided to pack now. */
  const [active, setActive] = useState<Set<string>>(new Set());
  const ready = s.bookings
    .filter(
      (b) =>
        ['packing', 'packed', 'shipped'].includes(b.status) &&
        !b.cancelPending &&
        orderProgress(s, b).ready > 0,
    )
    .sort((a, b) => (firstBookedFrom(a) < firstBookedFrom(b) ? -1 : 1));
  const unpack = s.bookings.filter((b) => b.cancelPending);
  const returns = s.bookings
    .filter(
      (b) =>
        ['shipped', 'returning'].includes(b.status) ||
        (['packing', 'packed'].includes(b.status) && s.shipments.some((x) => x.bookingId === b.id)),
    )
    .sort((a, b) => (lastBookedUntil(a) < lastBookedUntil(b) ? -1 : 1));
  const open = s.serviceCases.filter(isOpenService);
  const check = open.filter((sc) => sc.status === 'back_to_check' || sc.status === 'reported');
  const refill = refillTasksWithAge(s, today);
  const places = casePlaces(s);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {unpack.length > 0 && (
        <div className="lg:col-span-2">
          <Section title={`${cs.cancelBooking.toUnpack} (${unpack.length})`}>
            <ul data-testid="to-unpack" className="divide-y divide-alu-line text-sm">
              {unpack.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-cond font-semibold">{b.eventName}</span>
                    <span className="block text-xs text-muted">{b.cancelPending?.reason}</span>
                  </span>
                  <Link to={`/packing/${b.id}`} className="btn btn-sm btn-danger">
                    {cs.packing.unpack}
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
      <Section title={cs.warehouseUi.packingSoon}>
        <ul data-testid="packing-soon" className="divide-y divide-alu-line text-sm">
          {soon.length === 0 && <li className="text-muted">{cs.warehouseUi.none}</li>}
          {soon.map((b) => {
            const far = b.status === 'confirmed' && isEarlyPacking(s, b, today);
            const locked = far && !active.has(b.id);
            const days = diffDays(today, firstBookedFrom(b));
            return (
              <li
                key={b.id}
                data-testid={`packing-row-${b.id}`}
                data-locked={locked}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className={locked ? 'opacity-50 grayscale' : ''}>
                  <span className="font-cond font-semibold">{b.eventName}</span>
                  <span className="block text-xs text-muted">
                    {cs.warehouseUi.loading(fmtDate(firstBookedFrom(b)))}
                    {days > 0 && `, ${cs.packing.early.inDays(days)}`}
                  </span>
                  {far && !locked && (
                    <span className="block max-w-sm text-xs font-medium text-warn">
                      {cs.packing.early.warn(days)}
                    </span>
                  )}
                  <span className="block">
                    <PartlyShipped s={s} b={b} />
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={locked ? 'opacity-50 grayscale' : ''}>
                    <StatusChip status={b.status} />
                  </span>
                  {locked && can(user, 'start_packing') ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-label={cs.packing.early.activateLabel(b.eventName)}
                      onClick={() => setActive(new Set([...active, b.id]))}
                    >
                      {cs.packing.early.activate}
                    </button>
                  ) : (
                    <Link
                      to={`/packing/${b.id}`}
                      className={`btn btn-sm ${locked ? '' : 'btn-primary'}`}
                    >
                      {cs.warehouseUi.openPacking}
                    </Link>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title={cs.shipping.ready}>
        <ul data-testid="ready-to-ship" className="divide-y divide-alu-line text-sm">
          {ready.length === 0 && <li className="text-muted">{cs.warehouseUi.none}</li>}
          {ready.map((b) => {
            const p = orderProgress(s, b);
            return (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-cond font-semibold">{b.eventName}</span>
                  <span className="block text-xs text-muted">
                    {cs.warehouseUi.loading(fmtDate(firstBookedFrom(b)))},{' '}
                    {cs.packing.progress(p.packed, p.qty)}
                    {p.shipped > 0 && `, ${cs.packing.shippedN(p.shipped)}`}
                  </span>
                  {p.promised > 0 && (
                    <span className="block text-xs font-medium text-warn">
                      {cs.packing.deferredN(p.promised)}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <StatusChip status={b.status} />
                  <Link to={`/shipping/${b.id}`} className="btn btn-sm btn-primary">
                    {cs.shipping.open}
                  </Link>
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title={cs.warehouseUi.expectedReturns}>
        <ul className="divide-y divide-alu-line text-sm">
          {returns.length === 0 && <li className="text-muted">{cs.warehouseUi.none}</li>}
          {returns.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-cond font-semibold">{b.eventName}</span>
                <span
                  className={`block text-xs ${lastBookedUntil(b) < today ? 'text-bad' : 'text-muted'}`}
                >
                  {cs.warehouseUi.returnBy(fmtDate(lastBookedUntil(b)))}
                </span>
              </span>
              <Link to={`/vratka/${b.id}`} className="btn btn-sm">
                {cs.warehouseUi.openVratka}
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={cs.warehouseUi.incompleteCases}>
        <ul data-testid="refill-tasks" className="divide-y divide-alu-line text-sm">
          {refill.length === 0 && <li className="text-muted">{cs.warehouseUi.none}</li>}
          {refill.map((t) => (
            <li key={t.caseId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex flex-wrap items-center gap-2">
                <CaseLabel>{caseNumber(s, t.caseId)}</CaseLabel>
                <span className="text-xs">
                  {t.missing.map((m) => `${m.qty}× ${itemName(s, m.itemId)}`).join(', ')}
                </span>
                <span
                  className={`text-xs ${t.ageDays >= 7 ? 'text-bad' : t.ageDays >= 2 ? 'text-warn' : 'text-muted'}`}
                >
                  {cs.warehouseUi.age(t.ageDays)}
                </span>
              </span>
              {places.has(t.caseId) ? (
                <span className="text-xs text-muted">
                  {places.get(t.caseId)?.place === 'packed'
                    ? cs.packing.casePacked(
                        s.bookings.find((b) => b.id === places.get(t.caseId)?.bookingId)
                          ?.eventName ?? '',
                      )
                    : cs.packing.caseBusy}
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    run(
                      (st) => refillCase(st, user, today, t.caseId),
                      cs.warehouseUi.refilled(caseNumber(s, t.caseId)),
                    )
                  }
                >
                  {cs.warehouseUi.refill}
                </button>
              )}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={cs.warehouseUi.waitingCheck}>
        <ul className="text-sm">
          {check.length === 0 && <li className="text-muted">{cs.warehouseUi.none}</li>}
          {check.map((sc) => (
            <li key={sc.id}>
              <Link to="/service" className="underline">
                {sc.qty}× {itemName(s, sc.itemId)}
              </Link>{' '}
              <span className="text-xs text-muted">{cs.service.status[sc.status]}</span>
            </li>
          ))}
        </ul>
        <h3 className="mt-3 text-sm font-semibold">{cs.warehouseUi.openService}</h3>
        <ul className="text-sm">
          {open.map((sc) => (
            <li key={sc.id}>
              {sc.qty}× {itemName(s, sc.itemId)}{' '}
              <span className="text-xs text-muted">
                {cs.service.status[sc.status]} · {userName(s, sc.responsibleUserId)}
              </span>
              {isServiceOverdue(sc, today) && (
                <span className="ml-1 text-xs text-bad">{cs.serviceUi.overdue}</span>
              )}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={cs.loans.out}>
        <LoanList
          loans={openLoans(s).sort(byReturn)}
          empty={<p className="text-sm text-muted">{cs.warehouseUi.none}</p>}
        />
      </Section>
      <Section title={cs.dashboard.pendingIssues}>
        <IssuesList />
      </Section>
    </div>
  );
}
