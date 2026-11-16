/**
 * Pending issues: missing pieces, unexpected items and incomplete cases. The Chief writes how
 * each was resolved and archives it; resolving updates stock accordingly.
 */
import type { IsoDate } from '../dates';
import { recomputeConflictRecords } from '../conflicts';
import { can } from '../lifecycle/permissions';
import { postEvent } from '../notifications';
import type { AppState, Booking, Id, Issue, IssueResolutionKind, User } from '../types';
import { err, ok, produce, type Result } from '../util';

export function openIssues(state: Pick<AppState, 'issues'>): Issue[] {
  return state.issues.filter((i) => !i.archivedOn);
}

export function archivedIssues(state: Pick<AppState, 'issues'>): Issue[] {
  return state.issues.filter((i) => !!i.archivedOn);
}

/** After issues change: a booking returned with issues becomes `returned` once none is open. */
export function settleBookingAfterIssues(d: AppState, bookingId: Id | undefined): void {
  if (!bookingId) return;
  const b = d.bookings.find((x) => x.id === bookingId) as Booking | undefined;
  if (!b || b.status !== 'returned_with_issues') return;
  const open = d.issues.some(
    (i) => i.bookingId === bookingId && i.type === 'missing' && !i.archivedOn,
  );
  if (!open) b.status = 'returned';
}

/**
 * Resolve and archive an issue (Chief).
 * - found: pieces are back; stock unchanged.
 * - written_off / charged_to_client: stock is lowered (a whole missing case is archived).
 */
export function resolveIssue(
  state: AppState,
  user: User,
  today: IsoDate,
  issueId: Id,
  kind: IssueResolutionKind,
  text: string,
): Result<AppState> {
  if (!can(user, 'resolve_issue')) return err('forbidden', 'Only the Chief resolves issues');
  const iss = state.issues.find((i) => i.id === issueId);
  if (!iss) return err('not_found', `Issue ${issueId} not found`);
  if (iss.archivedOn) return err('invalid_state', 'Issue already archived');
  if (!text.trim()) return err('validation', 'Describe how the issue was resolved');
  const next = produce(state, (d) => {
    const x = d.issues.find((i) => i.id === issueId) as Issue;
    x.resolutionKind = kind;
    x.resolution = text.trim();
    x.resolvedBy = user.id;
    x.archivedOn = today;
    const lowersStock = kind === 'written_off' || kind === 'charged_to_client';
    if (x.type === 'missing' && lowersStock) {
      if (x.itemId && x.warehouseId) {
        const st = d.stock.find((s) => s.itemId === x.itemId && s.warehouseId === x.warehouseId);
        if (st) st.qty = Math.max(0, st.qty - x.qty);
      } else if (x.caseId) {
        const c = d.cases.find((cc) => cc.id === x.caseId);
        if (c) {
          for (const l of c.contents) {
            const st = d.stock.find(
              (s) => s.itemId === l.itemId && s.warehouseId === c.warehouseId,
            );
            if (st) st.qty = Math.max(0, st.qty - l.qty);
          }
          c.archived = true;
        }
      }
    }
    if (x.bookingId)
      postEvent(d, x.bookingId, user.id, today, 'issue_resolved', { issueId: x.id, kind });
    settleBookingAfterIssues(d, x.bookingId);
  }).state;
  return ok(recomputeConflictRecords(next, today));
}
