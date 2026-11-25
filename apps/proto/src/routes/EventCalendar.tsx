import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  can,
  conflictDays,
  conflictOverview,
  eachDay,
  RESERVATION_STATUSES,
  startOfMonth,
  visibleState,
  weekday,
  type Booking,
  type BookingStatus,
  type ConflictDay,
} from '@quix/core';
import { LoanNames } from '../components/Loans';
import { MonthNav, monthRange } from '../components/MonthGrid';
import { StatusChip } from '../components/ui';
import { cs, fmtDate, fmtRange, fmtShort } from '../i18n/cs';
import { targetName, userName, warehouseName } from '../lib/names';
import { TierChip } from '../components/Conflicts';
import { useAppState, useToday, useUser } from '../store';

const BAR: Record<BookingStatus, string> = {
  tentative: 'bg-muted/30',
  planned: 'bg-muted/60',
  draft: 'bg-alu-line',
  submitted: 'bg-warn',
  confirmed: 'bg-tape',
  packing: 'bg-tape-dark',
  packed: 'bg-tape-dark',
  shipped: 'bg-ink',
  returning: 'bg-ink-soft',
  returned: 'bg-ok',
  returned_with_issues: 'bg-bad',
  closed: 'bg-muted/50',
  expired: 'bg-muted/30',
  cancelled:
    'bg-[linear-gradient(to_bottom,transparent_45%,rgb(100_116_139)_45%,rgb(100_116_139)_58%,transparent_58%)] bg-alu-line',
};

const MARK: Record<ConflictDay['role'], string> = {
  short: 'border-white bg-bad text-white',
  partner: 'border-bad bg-white text-bad',
  request: 'border-bad bg-bad-light text-bad',
  likely: 'border-warn-bright bg-warn-light text-ink',
  possible: 'border-muted bg-white text-ink-soft',
};

function Mark({ role }: { role: ConflictDay['role'] }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 text-[11px] font-bold leading-none ${MARK[role]}`}
    >
      {role === 'possible' ? '?' : '!'}
    </span>
  );
}

/** What collides on one booking and day: item, count, days and the events involved. */
function ConflictDetail({
  bookingId,
  day,
  info,
  onClose,
}: {
  bookingId: string;
  day: string;
  info: ConflictDay;
  onClose: () => void;
}) {
  const s = useAppState();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.scrollIntoView?.({ block: 'nearest' }), [bookingId, day]);
  const name = (id: string) => s.bookings.find((b) => b.id === id)?.eventName ?? '';
  return (
    <section ref={ref} data-testid="conflict-detail" className="panel p-4" aria-live="polite">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h2 className="flex items-center gap-2">
          <Mark role={info.role} /> {cs.calendar.conflictTitle(name(bookingId), fmtDate(day))}
        </h2>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          {cs.common.close}
        </button>
      </div>
      <ul className="divide-y divide-alu-line text-sm">
        {info.conflicts.map((c) => {
          const holders = c.colliding;
          return (
            <li key={`${c.bookingId}-${c.lineId}-${c.tier}`} className="space-y-0.5 py-2">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <TierChip tier={c.tier} />
                {cs.calendar.conflictMissing(
                  c.short,
                  targetName(s, c.target),
                  warehouseName(s, c.warehouseId),
                )}
              </p>
              <p>
                {cs.calendar.conflictOf}{' '}
                <Link to={`/bookings/${c.bookingId}`} className="underline">
                  {name(c.bookingId)}
                </Link>{' '}
                <span className="text-xs text-muted">
                  {cs.bookingType[c.level]},{' '}
                  {userName(s, s.bookings.find((b) => b.id === c.bookingId)?.pmId)}
                </span>
              </p>
              {holders.length > 0 && (
                <p>
                  {c.tier === 'real' ? cs.calendar.conflictHeldBy : cs.calendar.conflictWantedBy}{' '}
                  {holders.map((x, i) => (
                    <span key={x.id}>
                      {i > 0 && '; '}
                      <Link to={`/bookings/${x.id}`} className="underline">
                        {x.eventName}
                      </Link>{' '}
                      <span className="text-xs text-muted">
                        {userName(s, x.pmId)}, {fmtRange(x.from, x.to)}, {cs.status[x.status]}
                      </span>
                    </span>
                  ))}
                </p>
              )}
              <LoanNames s={s} ids={c.loanIds} />
              <p className="text-xs text-muted">
                {cs.calendar.conflictDays(c.days.map((d) => fmtShort(d)).join(', '))}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Reservations and cancelled bookings come last and thin. */
const isLow = (b: Pick<Booking, 'status'>) =>
  RESERVATION_STATUSES.includes(b.status) || b.status === 'cancelled';

/** All bookings as bars per day, coloured by state; buffer days are lighter. */
export function EventCalendar() {
  const all = useAppState();
  const user = useUser();
  const s = useMemo(() => visibleState(all, user), [all, user]);
  const seesReservations = can(user, 'see_reservations');
  const today = useToday();
  const [month, setMonth] = useState(startOfMonth(today));
  const [pm, setPm] = useState('all');
  const [state, setState] = useState<'all' | BookingStatus>('all');
  const [hideClosed, setHideClosed] = useState(true);
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [reservations, setReservations] = useState(true);
  const [cancelled, setCancelled] = useState(false);
  const [level, setLevel] = useState<'real' | 'likely' | 'all'>('likely');
  const [picked, setPicked] = useState<{ id: string; day: string } | undefined>();
  const overview = useMemo(() => conflictOverview(s, today), [s, today]);
  const marks = useMemo(
    () =>
      conflictDays(
        s,
        overview.filter(
          (c) =>
            c.tier === 'real' || level === 'all' || (c.tier === 'likely' && level === 'likely'),
        ),
      ),
    [s, overview, level],
  );
  const { from, to } = monthRange(month);
  const days = eachDay(from, to);
  const rows = useMemo(
    () =>
      s.bookings
        .filter((b) => b.periods.some((p) => p.bookedFrom <= to && p.bookedUntil >= from))
        .filter((b) => pm === 'all' || b.pmId === pm)
        .filter((b) => {
          // a state picked on purpose wins over the switches
          if (state !== 'all') return b.status === state;
          if (b.status === 'cancelled') return cancelled;
          if (RESERVATION_STATUSES.includes(b.status)) return reservations;
          return !hideClosed || !['closed', 'expired'].includes(b.status);
        })
        .filter(
          (b) =>
            !onlyConflicts ||
            [...(marks.get(b.id)?.keys() ?? [])].some((d) => d >= from && d <= to),
        )
        .sort(
          (a, b) =>
            Number(isLow(a)) - Number(isLow(b)) ||
            (a.periods[0]!.bookedFrom < b.periods[0]!.bookedFrom ? -1 : 1),
        ),
    [s, from, to, pm, state, hideClosed, reservations, cancelled, onlyConflicts, marks],
  );
  const pickedInfo = picked && marks.get(picked.id)?.get(picked.day);
  const statuses = (Object.keys(cs.status) as BookingStatus[]).filter(
    (x) => seesReservations || !RESERVATION_STATUSES.includes(x),
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1>{cs.calendar.title}</h1>
        <MonthNav month={month} onChange={setMonth} today={today} />
      </div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <div>
          <label className="label" htmlFor="ec-pm">
            {cs.calendar.filterPm}
          </label>
          <select
            id="ec-pm"
            className="input w-auto"
            value={pm}
            onChange={(e) => setPm(e.target.value)}
          >
            <option value="all">{cs.calendar.all}</option>
            {s.users
              .filter((u) => u.role === 'pm')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ec-state">
            {cs.calendar.filterState}
          </label>
          <select
            id="ec-state"
            className="input w-auto"
            value={state}
            onChange={(e) => setState(e.target.value as 'all' | BookingStatus)}
          >
            <option value="all">{cs.calendar.allStates}</option>
            {statuses.map((st) => (
              <option key={st} value={st}>
                {cs.status[st]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ec-level">
            {cs.calendar.conflictLevel}
          </label>
          <select
            id="ec-level"
            className="input w-auto"
            value={level}
            onChange={(e) => setLevel(e.target.value as typeof level)}
          >
            {(['real', 'likely', 'all'] as const).map((x) => (
              <option key={x} value={x}>
                {cs.calendar.conflictLevels[x]}
              </option>
            ))}
          </select>
        </div>
        {seesReservations && (
          <label className="flex items-center gap-2 pb-2">
            <input
              type="checkbox"
              checked={reservations}
              onChange={(e) => setReservations(e.target.checked)}
            />
            {cs.calendar.showReservations}
          </label>
        )}
        <label className="flex items-center gap-2 pb-2">
          <input
            type="checkbox"
            checked={cancelled}
            onChange={(e) => setCancelled(e.target.checked)}
          />
          {cs.calendar.showCancelled}
        </label>
        <label className="flex items-center gap-2 pb-2">
          <input
            type="checkbox"
            checked={hideClosed}
            onChange={(e) => setHideClosed(e.target.checked)}
          />
          {cs.calendar.hideClosed}
        </label>
        <label className="flex items-center gap-2 pb-2">
          <input
            type="checkbox"
            checked={onlyConflicts}
            onChange={(e) => setOnlyConflicts(e.target.checked)}
          />
          {cs.calendar.onlyConflicts}
        </label>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {(['short', 'partner', 'request', 'likely', 'possible'] as const).map((r) => (
          <li key={r} className="flex items-center gap-1.5">
            <Mark role={r} /> {cs.calendar.conflict[r]}
          </li>
        ))}
      </ul>
      <div className="panel overflow-x-auto">
        <table
          className="w-full min-w-[56rem] table-fixed border-collapse text-xs"
          data-testid="event-calendar"
        >
          <colgroup>
            <col className="w-56" />
            {days.map((d) => (
              <col key={d} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white" />
              {days.map((d) => (
                <th
                  key={d}
                  className={`py-1 font-medium ${weekday(d) >= 5 ? 'text-bad' : 'text-muted'} ${d === today ? 'bg-tape-light' : ''}`}
                >
                  {Number(d.slice(8))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={days.length + 1} className="p-3 text-muted">
                  {onlyConflicts ? cs.calendar.noConflicts : cs.calendar.noBookings}
                </td>
              </tr>
            )}
            {rows.map((b) => {
              const first = [...(marks.get(b.id) ?? [])]
                .filter(([d]) => d >= from && d <= to)
                .sort()[0];
              return (
                <tr key={b.id} className="border-t border-alu-line" data-testid={`row-${b.id}`}>
                  <td className="sticky left-0 z-10 truncate bg-white px-2 py-1.5">
                    <Link
                      to={`/bookings/${b.id}`}
                      className="font-cond text-sm font-semibold hover:underline"
                      title={b.eventName}
                    >
                      {b.eventName}
                    </Link>
                    <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
                      {userName(s, b.pmId)} <StatusChip status={b.status} />
                      {first && (
                        <button
                          type="button"
                          className="lg:hidden"
                          aria-label={cs.calendar.conflictJump(b.eventName)}
                          onClick={() => setPicked({ id: b.id, day: first[0] })}
                        >
                          <Mark role={first[1].role} />
                        </button>
                      )}
                    </span>
                  </td>
                  {days.map((d) => {
                    const p = b.periods.find((x) => d >= x.bookedFrom && d <= x.bookedUntil);
                    const isEvent = !!p && d >= p.eventFrom && d <= p.eventTo;
                    const mark = p && marks.get(b.id)?.get(d);
                    const bar = (
                      <span
                        data-status={b.status}
                        className={`block ${isLow(b) ? 'my-1 h-3' : 'h-5'} ${BAR[b.status]} ${isEvent ? '' : 'opacity-40'} ${b.type === 'prebooking' ? 'bg-[length:8px_8px]' : ''}`}
                      />
                    );
                    const text =
                      mark &&
                      cs.calendar.conflictMark(
                        b.eventName,
                        fmtDate(d),
                        cs.calendar.conflict[mark.role],
                      );
                    return (
                      <td key={d} className={`px-0 py-1 ${d === today ? 'bg-tape-light/60' : ''}`}>
                        {mark ? (
                          <button
                            type="button"
                            data-conflict={mark.role}
                            aria-label={text}
                            aria-expanded={picked?.id === b.id && picked.day === d}
                            title={text}
                            className="relative block w-full"
                            onClick={() => setPicked({ id: b.id, day: d })}
                          >
                            {bar}
                            <span className="absolute inset-0 grid place-items-center">
                              <Mark role={mark.role} />
                            </span>
                          </button>
                        ) : (
                          p && (
                            <Link
                              to={`/bookings/${b.id}`}
                              aria-label={b.eventName}
                              title={isEvent ? cs.calendar.eventDays : cs.calendar.bufferDays}
                            >
                              {bar}
                            </Link>
                          )
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {picked && pickedInfo && (
        <ConflictDetail
          bookingId={picked.id}
          day={picked.day}
          info={pickedInfo}
          onClose={() => setPicked(undefined)}
        />
      )}
    </div>
  );
}
