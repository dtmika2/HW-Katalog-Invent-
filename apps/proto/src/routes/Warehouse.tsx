import { Link } from 'react-router-dom';
import {
  addDays,
  firstBookedFrom,
  isOpenService,
  isServiceOverdue,
  lastBookedUntil,
  refillCase,
  refillTasksWithAge,
} from '@quix/core';
import { CaseLabel, Section, StatusChip } from '../components/ui';
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
        ['confirmed', 'packing'].includes(b.status) &&
        firstBookedFrom(b) <= addDays(today, 3),
    )
    .sort((a, b) => (firstBookedFrom(a) < firstBookedFrom(b) ? -1 : 1));
  const returns = s.bookings
    .filter((b) => ['shipped', 'returning'].includes(b.status))
    .sort((a, b) => (lastBookedUntil(a) < lastBookedUntil(b) ? -1 : 1));
  const open = s.serviceCases.filter(isOpenService);
  const check = open.filter((sc) => sc.status === 'back_to_check' || sc.status === 'reported');
  const refill = refillTasksWithAge(s, today);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title={cs.warehouseUi.packingSoon}>
        <ul data-testid="packing-soon" className="divide-y divide-alu-line text-sm">
          {soon.length === 0 && <li className="text-muted">{cs.warehouseUi.none}</li>}
          {soon.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-cond font-semibold">{b.eventName}</span>
                <span className="block text-xs text-muted">
                  {cs.warehouseUi.loading(fmtDate(firstBookedFrom(b)))}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <StatusChip status={b.status} />
                <Link to={`/packing/${b.id}`} className="btn btn-sm btn-primary">
                  {cs.warehouseUi.openPacking}
                </Link>
              </span>
            </li>
          ))}
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
      <Section title={cs.dashboard.pendingIssues}>
        <IssuesList compact />
      </Section>
    </div>
  );
}
