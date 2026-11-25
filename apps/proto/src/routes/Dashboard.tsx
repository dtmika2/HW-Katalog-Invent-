import { Link } from 'react-router-dom';
import {
  can,
  isServiceOverdue,
  loansOn,
  openIssues,
  openLoans,
  resolveConflict,
  returnSheet,
  setConflictInProgress,
  type AppState,
  type Booking,
  type ConflictRecord,
  type User,
} from '@quix/core';
import { byReturn, LoanList, LoanNames } from '../components/Loans';
import { Empty, Section, StatusChip } from '../components/ui';
import { cs, fmtDate, fmtRange } from '../i18n/cs';
import { ageDays, bookingSpan, itemName, targetName, userName } from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';
import { IssuesList } from './Issues';
import { WarehouseDashboard } from './Warehouse';

export function BookingRow({ s, b, today }: { s: AppState; b: Booking; today: string }) {
  const span = bookingSpan(b);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <Link
        to={`/bookings/${b.id}`}
        className="font-cond font-semibold underline-offset-2 hover:underline"
      >
        {b.eventName}
      </Link>
      <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{fmtRange(span.from, span.to)}</span>
        <span>{userName(s, b.pmId)}</span>
        {b.status === 'submitted' && b.submittedAt && (
          <span>{cs.common.daysOld(ageDays(b.submittedAt, today))}</span>
        )}
        <StatusChip status={b.status} />
      </span>
    </li>
  );
}

/** Loans that are out on the days of a conflict. */
function loanIdsOf(s: AppState, c: ConflictRecord): string[] {
  const t = c.target;
  const items =
    'itemId' in t
      ? [t.itemId]
      : (s.caseTypes.find((x) => x.id === t.caseTypeId)?.contents ?? []).map((x) => x.itemId);
  return items.flatMap((i) =>
    c.days.flatMap((d) => loansOn(s, i, c.warehouseId, d).map((l) => l.id)),
  );
}

function ConflictRecords({ s, user, today }: { s: AppState; user: User; today: string }) {
  const run = useProto((p) => p.run);
  const open = s.conflicts.filter((c) => c.status !== 'resolved');
  if (open.length === 0) return <Empty>{cs.dashboard.noneWaiting}</Empty>;
  return (
    <ul data-testid="conflict-records" className="divide-y divide-alu-line">
      {open.map((c) => {
        const b = s.bookings.find((x) => x.id === c.bookingId);
        return (
          <li key={c.id} className="py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link to={`/bookings/${c.bookingId}`} className="underline">
                {cs.dashboard.conflictLine(b?.eventName ?? '', c.shortQty, targetName(s, c.target))}
              </Link>
              <span className="rounded border border-bad/40 bg-bad-light px-2 text-xs text-bad">
                {cs.conflictStatus[c.status]}
              </span>
            </div>
            <p className="text-xs text-muted">
              {c.overrideReason && `${cs.common.reason}: ${c.overrideReason} · `}
              {c.collidingBookingIds
                .map((id) => s.bookings.find((x) => x.id === id)?.eventName ?? id)
                .join(', ')}
            </p>
            <LoanNames s={s} ids={loanIdsOf(s, c)} />
            {can(user, 'manage_conflicts') && (
              <div className="mt-1 flex gap-2">
                {c.status === 'new' && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => run((st) => setConflictInProgress(st, user, c.id))}
                  >
                    {cs.dashboard.inProgress}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const r = globalThis.prompt?.(cs.dashboard.resolutionPrompt) ?? '';
                    if (r.trim()) run((st) => resolveConflict(st, user, today, c.id, r));
                  }}
                >
                  {cs.dashboard.resolveConflict}
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ChiefDashboard({ s, user, today }: { s: AppState; user: User; today: string }) {
  const queue = s.bookings.filter((b) => b.type === 'prebooking' && b.status === 'submitted');
  const overdue = s.serviceCases.filter((sc) => isServiceOverdue(sc, today));
  const externalOpen = s.bookings.flatMap((b) =>
    ['shipped', 'returning', 'returned_with_issues'].includes(b.status)
      ? returnSheet(s, b.id)
          .filter((l) => l.kind === 'external' && l.outcome !== 'supplier')
          .map((l) => ({ b, l }))
      : [],
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title={`${cs.dashboard.validationQueue} (${queue.length})`}>
        {queue.length === 0 ? (
          <Empty>{cs.dashboard.noneWaiting}</Empty>
        ) : (
          <ul className="divide-y divide-alu-line">
            {queue.map((b) => (
              <BookingRow key={b.id} s={s} b={b} today={today} />
            ))}
          </ul>
        )}
      </Section>
      <Section
        title={`${cs.dashboard.openConflicts} (${s.conflicts.filter((c) => c.status !== 'resolved').length})`}
      >
        <ConflictRecords s={s} user={user} today={today} />
      </Section>
      <Section title={`${cs.loans.out} (${openLoans(s).length})`}>
        <LoanList loans={openLoans(s).sort(byReturn)} empty={<Empty>{cs.loans.empty}</Empty>} />
      </Section>
      <Section title={`${cs.dashboard.pendingIssues} (${openIssues(s).length})`}>
        <IssuesList />
      </Section>
      <Section title={`${cs.dashboard.overdueService} (${overdue.length})`}>
        {overdue.length === 0 ? (
          <Empty>{cs.dashboard.noneWaiting}</Empty>
        ) : (
          <ul className="space-y-1 text-sm">
            {overdue.map((sc) => (
              <li key={sc.id}>
                <Link to="/service" className="underline">
                  {sc.qty}× {itemName(s, sc.itemId)}
                </Link>{' '}
                <span className="text-xs text-muted">
                  {cs.service.status[sc.status]}, {fmtDate(sc.expectedBack)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {externalOpen.length > 0 && (
          <>
            <h3 className="mt-3 text-sm font-semibold">{cs.dashboard.externalOpen}</h3>
            <ul className="text-sm">
              {externalOpen.map(({ b, l }) => (
                <li key={l.lineId}>
                  <Link to={`/bookings/${b.id}`} className="underline">
                    {b.eventName}
                  </Link>
                  : {l.name}
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </div>
  );
}

function PmDashboard({ s, user, today }: { s: AppState; user: User; today: string }) {
  const mine = s.bookings
    .filter((b) => b.pmId === user.id && !['closed', 'expired'].includes(b.status))
    .sort((a, b) => (bookingSpan(a).from < bookingSpan(b).from ? -1 : 1));
  const returned = mine.filter((b) => b.status === 'draft' && b.returnedToPm);
  const mineLoans = openLoans(s)
    .filter((l) => l.borrowerId === user.id)
    .sort(byReturn);
  const myIds = new Set(mine.map((b) => b.id));
  const conflicts = s.conflicts.filter(
    (c) =>
      c.status !== 'resolved' &&
      (myIds.has(c.bookingId) || c.collidingBookingIds.some((id) => myIds.has(id))),
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section
        title={cs.dashboard.myBookings}
        actions={
          can(user, 'create_booking') ? (
            <Link to="/bookings/new" className="btn btn-primary btn-sm">
              {cs.dashboard.newBooking}
            </Link>
          ) : undefined
        }
      >
        {mine.length === 0 ? (
          <Empty>{cs.common.empty}</Empty>
        ) : (
          <ul className="divide-y divide-alu-line">
            {mine.map((b) => (
              <BookingRow key={b.id} s={s} b={b} today={today} />
            ))}
          </ul>
        )}
      </Section>
      <div className="space-y-4">
        {returned.length > 0 && (
          <Section title={cs.dashboard.returnedToMe}>
            <ul className="divide-y divide-alu-line">
              {returned.map((b) => (
                <BookingRow key={b.id} s={s} b={b} today={today} />
              ))}
            </ul>
          </Section>
        )}
        {mineLoans.length > 0 && (
          <Section title={cs.loans.mine}>
            <LoanList loans={mineLoans} />
          </Section>
        )}
        <Section title={cs.dashboard.conflictsOnMine}>
          {conflicts.length === 0 ? (
            <Empty>{cs.dashboard.noneWaiting}</Empty>
          ) : (
            <ul className="space-y-1 text-sm">
              {conflicts.map((c) => (
                <li key={c.id}>
                  <Link to={`/bookings/${c.bookingId}`} className="underline">
                    {cs.dashboard.conflictLine(
                      s.bookings.find((b) => b.id === c.bookingId)?.eventName ?? '',
                      c.shortQty,
                      targetName(s, c.target),
                    )}
                  </Link>{' '}
                  <span className="text-xs text-muted">{cs.conflictStatus[c.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

export function Dashboard() {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  return (
    <div className="space-y-4">
      <h1>{cs.dashboard.hello(user.name.split(' ')[0] ?? user.name)}</h1>
      {user.role === 'chief' || user.role === 'admin' ? (
        <ChiefDashboard s={s} user={user} today={today} />
      ) : user.role === 'warehouse' ? (
        <WarehouseDashboard />
      ) : (
        <PmDashboard s={s} user={user} today={today} />
      )}
    </div>
  );
}
