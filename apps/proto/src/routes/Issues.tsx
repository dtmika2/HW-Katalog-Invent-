import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  can,
  openIssues,
  resolveIssue,
  returnSheet,
  type AppState,
  type Issue,
  type IssueResolutionKind,
} from '@quix/core';
import { CaseLabel, Empty } from '../components/ui';
import { cs, fmtDate, fmtRange } from '../i18n/cs';
import { ageDays, caseNumber, eventSpan, itemName, userName, warehouseName } from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';

const KINDS: IssueResolutionKind[] = ['found', 'written_off', 'charged_to_client', 'other'];

/** What happened, in one sentence. */
function whatHappened(s: AppState, i: Issue): string | undefined {
  if (i.type === 'unexpected') return cs.issues.unexpectedWhat;
  if (i.type !== 'missing') return undefined;
  if (i.caseId)
    return i.itemId ? cs.issues.missingInCase(caseNumber(s, i.caseId)) : cs.issues.caseNotReturned;
  const line = i.bookingId
    ? returnSheet(s, i.bookingId).find((l) => l.lineId === i.lineId)
    : undefined;
  return line ? cs.issues.returnedOf(line.returned, line.shipped, line.transferred) : undefined;
}

/** What the open issue blocks (own stock only; missing external gear blocks nothing of ours). */
function whatItBlocks(s: AppState, i: Issue): string | undefined {
  if (i.type !== 'missing') return undefined;
  if (i.itemId && i.warehouseId) return cs.issues.blocks(i.qty, warehouseName(s, i.warehouseId));
  return i.caseId ? cs.issues.blocksCase : undefined;
}

/** What choosing a resolution does to the stock (mirrors `resolveIssue`). */
function effectOf(i: Issue, kind: IssueResolutionKind): string {
  const ownItem = !!i.itemId && !!i.warehouseId;
  if (i.type !== 'missing' || (!ownItem && !i.caseId)) return cs.issues.effectNone;
  if (kind === 'found' || kind === 'other') return cs.issues.effectFree;
  return ownItem ? cs.issues.effectLower(i.qty) : cs.issues.effectLowerCase;
}

function IssueName({ s, i }: { s: AppState; i: Issue }) {
  return (
    <>
      <span className="font-medium">
        {i.qty}×{' '}
        {i.itemId ? (
          <Link to={`/items/${i.itemId}`} className="hover:underline">
            {itemName(s, i.itemId)}
          </Link>
        ) : (
          (i.name ?? (i.caseId ? caseNumber(s, i.caseId) : ''))
        )}
      </span>
      {i.caseId && i.itemId && <CaseLabel>{caseNumber(s, i.caseId)}</CaseLabel>}
    </>
  );
}

/**
 * Pending issues (missing pieces, unexpected items) with Chief resolution. Each entry says what
 * happened, where, who reported it and what it blocks. With `bookingId`, only that order's.
 */
export function IssuesList({ bookingId }: { bookingId?: string }) {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const [editing, setEditing] = useState<string | undefined>();
  const [kind, setKind] = useState<IssueResolutionKind>('found');
  const [text, setText] = useState('');
  const list = openIssues(s).filter((i) => !bookingId || i.bookingId === bookingId);
  if (list.length === 0) return <Empty>{cs.dashboard.noneWaiting}</Empty>;
  return (
    <ul data-testid="issues" className="divide-y divide-alu-line text-sm">
      {list.map((i) => {
        const b = s.bookings.find((x) => x.id === i.bookingId);
        const span = b && eventSpan(b);
        const what = whatHappened(s, i);
        const blocks = whatItBlocks(s, i);
        return (
          <li key={i.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-bad-light px-1.5 text-xs text-bad">
                {cs.issues.type[i.type]}
              </span>
              <IssueName s={s} i={i} />
            </div>
            {(what || i.note) && (
              <p>
                {what} {i.note && <em>{cs.issues.quote(i.note)}</em>}
              </p>
            )}
            {b && span && !bookingId && (
              <p className="text-xs text-muted">
                {cs.issues.fromEvent}{' '}
                <Link to={`/bookings/${b.id}`} className="text-ink underline">
                  {b.eventName}
                </Link>
                , {fmtRange(span.from, span.to)}, {cs.common.pm} {userName(s, b.pmId)}
              </p>
            )}
            <p className="text-xs text-muted">
              {cs.issues.reported(
                userName(s, i.reportedBy),
                fmtDate(i.reportedOn),
                cs.common.daysOld(ageDays(i.reportedOn, today)),
              )}
            </p>
            {blocks && <p className="text-xs text-bad">{blocks}</p>}
            <p className="text-xs text-muted">
              {i.type === 'unexpected' ? cs.issues.nextUnexpected : cs.issues.nextMissing}
            </p>
            {editing === i.id ? (
              <form
                className="space-y-1 pt-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!run((st) => resolveIssue(st, user, today, i.id, kind, text)))
                    setEditing(undefined);
                }}
              >
                <div className="flex flex-wrap items-end gap-2">
                  <select
                    className="input w-auto"
                    aria-label={cs.issues.how}
                    value={kind}
                    onChange={(e) => setKind(e.target.value as IssueResolutionKind)}
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {cs.issues.resolution[k]}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input min-w-40 flex-1"
                    aria-label={cs.common.note}
                    placeholder={cs.issues.howNote}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <button type="submit" className="btn btn-sm btn-primary" disabled={!text.trim()}>
                    {cs.common.save}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setEditing(undefined)}
                  >
                    {cs.common.cancel}
                  </button>
                </div>
                <p className="text-xs text-muted">{effectOf(i, kind)}</p>
              </form>
            ) : (
              <div className="flex flex-wrap gap-2 pt-1">
                {can(user, 'resolve_issue') && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setEditing(i.id);
                      setText('');
                      setKind('found');
                    }}
                  >
                    {cs.dashboard.resolveConflict}
                  </button>
                )}
                {b && i.type === 'missing' && can(user, 'record_return') && (
                  <Link to={`/vratka/${b.id}`} className="btn btn-sm">
                    {cs.issues.openVratka}
                  </Link>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
