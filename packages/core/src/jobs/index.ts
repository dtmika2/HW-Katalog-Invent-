/**
 * Nightly job: expires pre-bookings and sends the reminders from the concept's timing table.
 * Idempotent for the same day (a reminder fires at most once per day; `jobLog` remembers).
 */
import { addDays, diffDays, type IsoDate } from '../dates';
import { firstBookedFrom, firstEventDay, lastBookedUntil } from '../availability';
import { refillTasks } from '../catalog';
import { recomputeConflictRecords } from '../conflicts';
import { chiefIds, notify, postEvent, warehouseIds } from '../notifications';
import { returnSheet } from '../returns';
import { casesOut } from '../shipping';
import type { AppState, Notification } from '../types';
import { SYSTEM_USER_ID } from '../types';
import { produce } from '../util';

export interface DailyJobResult {
  state: AppState;
  /** Notifications created by this run. */
  notifications: Notification[];
  /** Pre-bookings expired by this run. */
  expired: string[];
}

/** Cases whose loose pieces are currently out on an active order. */
function casesWithPiecesOut(state: AppState): Set<string> {
  const out = new Set<string>();
  for (const sh of state.shipments) {
    const b = state.bookings.find((x) => x.id === sh.bookingId);
    if (!b || !['shipped', 'returning'].includes(b.status)) continue;
    for (const l of sh.lines) if (l.fromCaseId) out.add(l.fromCaseId);
  }
  return out;
}

export function runDailyJobs(state: AppState, today: IsoDate): DailyJobResult {
  const r = state.settings.reminders;
  const before = state.notifications.length;
  const expired: string[] = [];
  const onOrder = new Set([...casesOut(state), ...casesWithPiecesOut(state)]);

  const { state: next } = produce(state, (d) => {
    /** True (and remembered) when a reminder is due today. `every` undefined = once. */
    const due = (key: string, firstDue: IsoDate, every?: number): boolean => {
      if (today < firstDue) return false;
      const last = d.jobLog[key];
      if (last === today) return false;
      if (last && (every === undefined || diffDays(last, today) < every)) return false;
      d.jobLog[key] = today;
      return true;
    };

    for (const b of d.bookings) {
      const params = { event: b.eventName };
      if (b.type === 'prebooking' && (b.status === 'draft' || b.status === 'submitted')) {
        const first = firstEventDay(b);
        if (today >= first) {
          b.status = 'expired';
          expired.push(b.id);
          postEvent(d, b.id, SYSTEM_USER_ID, today, 'expired', {});
          notify(
            d,
            [b.pmId],
            {
              type: 'prebooking_expired',
              text: `Pre-booking ${b.eventName} expired`,
              params,
              bookingId: b.id,
            },
            today,
          );
          continue;
        }
        if (
          b.status === 'submitted' &&
          b.submittedAt &&
          due(
            `validation:${b.id}`,
            addDays(b.submittedAt, r.validationWaitingAfter),
            r.validationWaitingEvery,
          )
        ) {
          notify(
            d,
            chiefIds(d),
            {
              type: 'validation_waiting',
              text: `${b.eventName} waits for validation`,
              params,
              bookingId: b.id,
            },
            today,
          );
        }
        if (due(`expiring:${b.id}`, addDays(first, -r.prebookingExpiryWarnBefore))) {
          notify(
            d,
            [...chiefIds(d), b.pmId],
            {
              type: 'prebooking_expiring',
              text: `${b.eventName} expires on ${first}`,
              params: { ...params, date: first },
              bookingId: b.id,
            },
            today,
          );
        }
        continue;
      }
      if (b.type !== 'order') continue;
      if (b.status === 'confirmed' || b.status === 'packing') {
        for (const p of b.periods) {
          if (today > p.bookedFrom) continue;
          if (due(`loading:${b.id}:${p.bookedFrom}`, addDays(p.bookedFrom, -r.loadingBefore))) {
            notify(
              d,
              warehouseIds(d),
              {
                type: 'upcoming_loading',
                text: `Loading ${b.eventName} on ${p.bookedFrom}`,
                params: { ...params, date: p.bookedFrom },
                bookingId: b.id,
              },
              today,
            );
          }
        }
      }
      if (b.status === 'shipped' || b.status === 'returning') {
        if (due(`overdue:${b.id}`, addDays(lastBookedUntil(b), 1), r.overdueReturnEvery)) {
          notify(
            d,
            [...warehouseIds(d), ...chiefIds(d)],
            {
              type: 'overdue_return',
              text: `${b.eventName} not returned`,
              params,
              bookingId: b.id,
            },
            today,
          );
        }
      }
      if (['shipped', 'returning', 'returned_with_issues', 'returned'].includes(b.status)) {
        const sheet = returnSheet(d, b.id);
        for (const line of b.lines) {
          if (!('external' in line.target)) continue;
          const s = sheet.find((x) => x.lineId === line.id);
          if (!s || s.outcome === 'supplier') continue;
          if (
            due(
              `external:${b.id}:${line.id}`,
              addDays(line.target.external.returnDate, 1),
              r.externalNotReturnedEvery,
            )
          ) {
            notify(
              d,
              chiefIds(d),
              {
                type: 'external_not_returned',
                text: `${line.target.external.name} not returned to ${line.target.external.supplier}`,
                params: {
                  ...params,
                  name: line.target.external.name,
                  supplier: line.target.external.supplier,
                },
                bookingId: b.id,
              },
              today,
            );
          }
        }
      }
    }

    for (const sc of d.serviceCases) {
      if (sc.status === 'fixed' || sc.status === 'written_off' || !sc.expectedBack) continue;
      if (due(`service:${sc.id}`, addDays(sc.expectedBack, 1), r.serviceOverdueEvery)) {
        notify(
          d,
          [sc.responsibleUserId, ...chiefIds(d)],
          {
            type: 'service_overdue',
            text: `Service case ${sc.id} overdue`,
            params: { serviceId: sc.id, itemId: sc.itemId },
          },
          today,
        );
      }
    }

    for (const t of refillTasks(d)) {
      if (onOrder.has(t.caseId)) continue;
      const c = d.cases.find((x) => x.id === t.caseId);
      const params = { caseId: t.caseId, number: c?.number ?? t.caseId };
      if (due(`case-w:${t.caseId}:${t.since}`, addDays(t.since, r.caseIncompleteWarehouseAfter))) {
        notify(
          d,
          warehouseIds(d),
          { type: 'case_incomplete', text: `Case ${params.number} incomplete`, params },
          today,
        );
      }
      if (due(`case-c:${t.caseId}:${t.since}`, addDays(t.since, r.caseIncompleteChiefAfter))) {
        notify(
          d,
          chiefIds(d),
          {
            type: 'case_incomplete',
            text: `Case ${params.number} incomplete`,
            params: { ...params, escalated: 1 },
          },
          today,
        );
      }
    }

    for (const rec of d.conflicts) {
      if (rec.status === 'resolved') continue;
      const b = d.bookings.find((x) => x.id === rec.bookingId);
      if (!b) continue;
      if (due(`conflict:${rec.id}`, addDays(firstBookedFrom(b), -r.conflictBefore), 1)) {
        const pms = rec.collidingBookingIds.map((id) => d.bookings.find((x) => x.id === id)?.pmId);
        notify(
          d,
          [...chiefIds(d), b.pmId, ...pms],
          {
            type: 'conflict_unresolved',
            text: `Unresolved conflict on ${b.eventName}`,
            params: { event: b.eventName, conflictId: rec.id },
            bookingId: b.id,
          },
          today,
        );
      }
    }
  });

  const finalState = recomputeConflictRecords(next, today);
  return { state: finalState, notifications: finalState.notifications.slice(before), expired };
}
