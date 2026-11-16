import type { ReactNode } from 'react';
import { addMonths, eachDay, endOfMonth, startOfMonth, weekday } from '@quix/core';
import { cs } from '../i18n/cs';

/** Month navigation header. `month` is any day in the month. */
export function MonthNav({
  month,
  onChange,
  today,
}: {
  month: string;
  onChange: (m: string) => void;
  today: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="btn btn-sm"
        aria-label={cs.calendar.prevMonth}
        onClick={() => onChange(addMonths(startOfMonth(month), -1))}
      >
        ‹
      </button>
      <span className="min-w-36 text-center font-cond text-lg font-bold" data-testid="month-title">
        {cs.calendar.monthTitle(Number(month.slice(5, 7)), month.slice(0, 4))}
      </span>
      <button
        type="button"
        className="btn btn-sm"
        aria-label={cs.calendar.nextMonth}
        onClick={() => onChange(addMonths(startOfMonth(month), 1))}
      >
        ›
      </button>
      <button type="button" className="btn btn-sm" onClick={() => onChange(startOfMonth(today))}>
        {cs.calendar.thisMonth}
      </button>
    </div>
  );
}

/** Monday-first month grid; `renderDay` draws each in-month day. */
export function MonthGrid({
  month,
  renderDay,
}: {
  month: string;
  renderDay: (d: string) => ReactNode;
}) {
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const lead = weekday(first);
  const days = eachDay(first, last);
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">
        {cs.calendar.weekdays.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) =>
          d ? <div key={d}>{renderDay(d)}</div> : <div key={`e${i}`} aria-hidden="true" />,
        )}
      </div>
    </div>
  );
}

export const monthRange = (month: string) => ({ from: startOfMonth(month), to: endOfMonth(month) });
