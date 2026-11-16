import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { eachDay, startOfMonth, weekday, type BookingStatus } from '@quix/core';
import { MonthNav, monthRange } from '../components/MonthGrid';
import { StatusChip } from '../components/ui';
import { cs } from '../i18n/cs';
import { userName } from '../lib/names';
import { useAppState, useToday } from '../store';

const BAR: Record<BookingStatus, string> = {
  draft: 'bg-alu-line',
  submitted: 'bg-warn',
  confirmed: 'bg-tape',
  packing: 'bg-tape-dark',
  shipped: 'bg-ink',
  returning: 'bg-ink-soft',
  returned: 'bg-ok',
  returned_with_issues: 'bg-bad',
  closed: 'bg-muted/50',
  expired: 'bg-muted/30',
};

/** All bookings as bars per day, coloured by state; buffer days are lighter. */
export function EventCalendar() {
  const s = useAppState();
  const today = useToday();
  const [month, setMonth] = useState(startOfMonth(today));
  const [pm, setPm] = useState('all');
  const [state, setState] = useState<'all' | BookingStatus>('all');
  const [hideClosed, setHideClosed] = useState(true);
  const { from, to } = monthRange(month);
  const days = eachDay(from, to);
  const rows = useMemo(
    () =>
      s.bookings
        .filter((b) => b.periods.some((p) => p.bookedFrom <= to && p.bookedUntil >= from))
        .filter((b) => pm === 'all' || b.pmId === pm)
        .filter((b) => state === 'all' || b.status === state)
        .filter((b) => !hideClosed || !['closed', 'expired'].includes(b.status))
        .sort((a, b) => (a.periods[0]!.bookedFrom < b.periods[0]!.bookedFrom ? -1 : 1)),
    [s, from, to, pm, state, hideClosed],
  );
  const statuses = Object.keys(cs.status) as BookingStatus[];
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
        <label className="flex items-center gap-2 pb-2">
          <input
            type="checkbox"
            checked={hideClosed}
            onChange={(e) => setHideClosed(e.target.checked)}
          />
          {cs.calendar.hideClosed}
        </label>
      </div>
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
              <th className="sticky left-0 bg-white" />
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
                  {cs.calendar.noBookings}
                </td>
              </tr>
            )}
            {rows.map((b) => (
              <tr key={b.id} className="border-t border-alu-line" data-testid={`row-${b.id}`}>
                <td className="sticky left-0 truncate bg-white px-2 py-1.5">
                  <Link
                    to={`/bookings/${b.id}`}
                    className="font-cond text-sm font-semibold hover:underline"
                    title={b.eventName}
                  >
                    {b.eventName}
                  </Link>
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
                    {userName(s, b.pmId)} <StatusChip status={b.status} />
                  </span>
                </td>
                {days.map((d) => {
                  const p = b.periods.find((x) => d >= x.bookedFrom && d <= x.bookedUntil);
                  const isEvent = !!p && d >= p.eventFrom && d <= p.eventTo;
                  return (
                    <td key={d} className={`px-0 py-1 ${d === today ? 'bg-tape-light/60' : ''}`}>
                      {p && (
                        <Link
                          to={`/bookings/${b.id}`}
                          aria-label={b.eventName}
                          title={isEvent ? cs.calendar.eventDays : cs.calendar.bufferDays}
                        >
                          <span
                            className={`block h-5 ${BAR[b.status]} ${isEvent ? '' : 'opacity-40'} ${b.type === 'prebooking' ? 'bg-[length:8px_8px]' : ''}`}
                          />
                        </Link>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
