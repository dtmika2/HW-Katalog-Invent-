/**
 * Reporting problems and service. Issues are created automatically from counts in packing and
 * vratka, so they are not "reports"; only their resolution by a person counts.
 */
import type { AppState } from '../../types';
import type { Draft } from '../types';
import { isPerson, textLength } from './common';

/** Automatic closure when missing pieces turn up in a later vratka. */
const AUTO_RESOLUTION = 'returned-later';

export function reportDrafts(state: AppState): Draft[] {
  const out: Draft[] = [];
  for (const sc of state.serviceCases) {
    const reporter = sc.events[0]?.userId;
    const byHand = !sc.openedFromBookingId;
    const faultId = `report.fault:${sc.id}`;
    if (byHand && isPerson(reporter))
      out.push({
        id: faultId,
        userId: reporter,
        on: sc.openedOn,
        ruleId: 'report.fault',
        params: { itemId: sc.itemId, qty: sc.qty },
      });

    sc.events.forEach((e, i) => {
      if (i === 0 || !isPerson(e.userId)) return;
      if (e.status === 'fixed')
        out.push({
          id: `service.fixed:${sc.id}`,
          userId: e.userId,
          on: e.on,
          ruleId: 'service.fixed',
          params: { itemId: sc.itemId },
        });
      else
        out.push({
          id: `service.progress:${sc.id}:${i}`,
          userId: e.userId,
          on: e.on,
          ruleId: 'service.progress',
          subject: sc.id,
          params: { itemId: sc.itemId, status: e.status },
        });
    });

    // report.confirmed — the report was right: the case ended repaired or written off.
    const end = [...sc.events]
      .reverse()
      .find((e) => e.status === 'fixed' || e.status === 'written_off');
    if (end && (sc.status === 'fixed' || sc.status === 'written_off') && isPerson(reporter))
      out.push({
        id: `report.confirmed:${sc.id}`,
        userId: reporter,
        on: end.on,
        ruleId: 'report.confirmed',
        ...(byHand ? { parentId: faultId } : {}),
        ...(sc.openedFromBookingId ? { bookingId: sc.openedFromBookingId } : {}),
        params: { itemId: sc.itemId },
      });
  }

  for (const i of state.issues) {
    if (!isPerson(i.resolvedBy) || !i.archivedOn) continue;
    if (i.resolution === AUTO_RESOLUTION || textLength(i.resolution) === 0) continue;
    out.push({
      id: `issue.resolved:${i.id}`,
      userId: i.resolvedBy,
      on: i.archivedOn,
      ruleId: 'issue.resolved',
      ...(i.bookingId ? { bookingId: i.bookingId } : {}),
      params: { type: i.type },
    });
  }
  return out;
}
