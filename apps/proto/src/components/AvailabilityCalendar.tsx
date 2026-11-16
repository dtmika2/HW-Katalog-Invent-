import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  caseCalendar,
  firstBookedFrom,
  itemCalendar,
  lastBookedUntil,
  startOfMonth,
  type AppState,
  type HoldKind,
} from '@quix/core';
import { cs, fmtDate } from '../i18n/cs';
import { userName } from '../lib/names';
import { MonthGrid, MonthNav, monthRange } from './MonthGrid';
import { StatusChip } from './ui';

interface DayCell {
  date: string;
  free: number;
  total: number;
  soft: number;
  service: number;
  holders: { bookingId: string; qty: number; kind: HoldKind }[];
  serviceCaseIds: string[];
}

/**
 * Month view of an item or case type: each day "volné / celkem"; soft holds striped, service
 * grey, over-booked red. Clicking a day lists who holds it.
 */
export function AvailabilityCalendar({
  s,
  target,
  today,
  initialMonth,
}: {
  s: AppState;
  target: { itemId: string } | { caseTypeId: string };
  today: string;
  initialMonth?: string;
}) {
  const [month, setMonth] = useState(startOfMonth(initialMonth ?? today));
  const [warehouse, setWarehouse] = useState<string>('all');
  const [picked, setPicked] = useState<string | undefined>();
  const isCase = 'caseTypeId' in target;
  const cells = useMemo(() => {
    const { from, to } = monthRange(month);
    const m = new Map<string, DayCell>();
    if ('itemId' in target) {
      for (const d of itemCalendar(s, target.itemId, from, to, warehouse)) {
        m.set(d.date, {
          date: d.date,
          free: d.free,
          total: d.total,
          soft: d.softHeld,
          service: d.outOfService,
          holders: d.holders,
          serviceCaseIds: d.serviceCaseIds,
        });
      }
    } else {
      for (const d of caseCalendar(s, target.caseTypeId, from, to, warehouse)) {
        m.set(d.date, {
          date: d.date,
          free: d.free,
          total: d.completeCases,
          soft: d.softHeld,
          service: d.totalCases - d.completeCases,
          holders: d.holders,
          serviceCaseIds: [],
        });
      }
    }
    return m;
  }, [s, target, month, warehouse]);
  const day = picked ? cells.get(picked) : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonthNav month={month} onChange={setMonth} today={today} />
        <div className="flex gap-1" role="group" aria-label={cs.common.warehouse}>
          {[{ id: 'all', name: cs.common.allWarehouses }, ...s.warehouses].map((w) => (
            <button
              key={w.id}
              type="button"
              aria-pressed={warehouse === w.id}
              className={`btn btn-sm ${warehouse === w.id ? 'btn-primary' : ''}`}
              onClick={() => setWarehouse(w.id)}
            >
              {w.name}
            </button>
          ))}
        </div>
      </div>
      <MonthGrid
        month={month}
        renderDay={(d) => {
          const c = cells.get(d);
          if (!c) return null;
          const over = c.free < 0;
          const low = !over && c.free === 0;
          const striped = c.soft > 0;
          return (
            <button
              type="button"
              data-testid={`day-${d}`}
              aria-label={cs.calendar.cellLabel(fmtDate(d), c.free, c.total)}
              aria-pressed={picked === d}
              onClick={() => setPicked(d)}
              className={`relative flex h-16 w-full flex-col items-start justify-between rounded border p-1 text-left ${
                picked === d ? 'border-tape ring-2 ring-tape' : 'border-alu-line'
              } ${over ? 'bg-bad-light' : low ? 'bg-warn-light' : 'bg-white'} ${d === today ? 'outline outline-1 outline-ink' : ''}`}
              style={
                striped
                  ? {
                      backgroundImage:
                        'repeating-linear-gradient(135deg, transparent 0 6px, rgba(184,116,0,0.14) 6px 9px)',
                    }
                  : undefined
              }
            >
              <span className="text-[11px] text-muted">{Number(d.slice(8))}</span>
              <span
                className={`font-cond text-base font-bold leading-none ${over ? 'text-bad' : ''}`}
              >
                {cs.calendar.freeOfTotal(c.free, c.total)}
              </span>
              {c.service > 0 && (
                <span
                  className="absolute bottom-0 left-0 h-1 w-full rounded-b bg-muted/60"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        }}
      />
      <p className="flex flex-wrap gap-4 text-xs text-muted">
        <span>{isCase ? cs.calendar.legendFreeCases : cs.calendar.legendFree}</span>
        <span>
          <span
            className="mr-1 inline-block h-3 w-4 align-middle"
            style={{
              backgroundImage:
                'repeating-linear-gradient(135deg, transparent 0 3px, rgba(184,116,0,0.4) 3px 5px)',
            }}
          />
          {cs.calendar.legendSoft}
        </span>
        <span>
          <span className="mr-1 inline-block h-1 w-4 bg-muted/60 align-middle" />
          {cs.calendar.legendService}
        </span>
        <span>
          <span className="mr-1 inline-block h-3 w-4 bg-bad-light align-middle" />
          {cs.calendar.legendShort}
        </span>
      </p>
      {day && (
        <div className="panel p-3" data-testid="day-detail">
          <h3 className="mb-2 font-cond font-bold">{cs.calendar.dayTitle(fmtDate(day.date))}</h3>
          {day.holders.length === 0 && day.serviceCaseIds.length === 0 ? (
            <p className="text-sm text-muted">{cs.calendar.dayEmpty}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {day.holders.map((h) => {
                const b = s.bookings.find((x) => x.id === h.bookingId);
                if (!b) return null;
                return (
                  <li
                    key={`${h.bookingId}-${h.kind}`}
                    data-testid="holder"
                    className="flex flex-wrap items-center gap-2"
                  >
                    <Link to={`/bookings/${b.id}`} className="font-medium underline">
                      {b.eventName}
                    </Link>
                    <span className="text-xs text-muted">
                      {userName(s, b.pmId)}, {fmtDate(firstBookedFrom(b))} –{' '}
                      {fmtDate(lastBookedUntil(b))}
                    </span>
                    <span className="text-xs font-semibold">
                      {isCase ? cs.calendar.holdCases(h.qty) : cs.calendar.holdQty(h.qty)}
                    </span>
                    {h.kind === 'soft' && (
                      <span className="text-xs text-warn">{cs.calendar.soft}</span>
                    )}
                    <StatusChip status={b.status} />
                  </li>
                );
              })}
              {day.serviceCaseIds.map((id) => {
                const sc = s.serviceCases.find((x) => x.id === id);
                if (!sc) return null;
                return (
                  <li key={id} data-testid="holder-service" className="text-sm text-muted">
                    <Link to="/service" className="underline">
                      {cs.calendar.serviceRow(
                        sc.qty,
                        cs.service.status[sc.status],
                        fmtDate(sc.expectedBack),
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
