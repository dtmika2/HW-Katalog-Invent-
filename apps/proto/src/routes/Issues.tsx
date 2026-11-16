import { useState } from 'react';
import { Link } from 'react-router-dom';
import { can, openIssues, resolveIssue, type IssueResolutionKind } from '@quix/core';
import { Empty } from '../components/ui';
import { cs, fmtDate } from '../i18n/cs';
import { caseNumber, itemName, userName } from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';

const KINDS: IssueResolutionKind[] = ['found', 'written_off', 'charged_to_client', 'other'];

/** Pending issues (missing pieces, unexpected items, incomplete cases) with Chief resolution. */
export function IssuesList({ compact = false }: { compact?: boolean }) {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const [editing, setEditing] = useState<string | undefined>();
  const [kind, setKind] = useState<IssueResolutionKind>('found');
  const [text, setText] = useState('');
  const list = openIssues(s);
  if (list.length === 0) return <Empty>{cs.dashboard.noneWaiting}</Empty>;
  return (
    <ul data-testid="issues" className="divide-y divide-alu-line text-sm">
      {list.map((i) => {
        const b = s.bookings.find((x) => x.id === i.bookingId);
        return (
          <li key={i.id} className="py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-bad-light px-1.5 text-xs text-bad">
                {cs.issues.type[i.type]}
              </span>
              <span className="font-medium">
                {i.qty}×{' '}
                {i.itemId
                  ? itemName(s, i.itemId)
                  : (i.name ?? (i.caseId ? caseNumber(s, i.caseId) : ''))}
              </span>
              {i.caseId && i.itemId && (
                <span className="case-label">{caseNumber(s, i.caseId)}</span>
              )}
              {b && (
                <Link to={`/bookings/${b.id}`} className="text-xs underline">
                  {b.eventName}
                </Link>
              )}
            </div>
            {!compact && (
              <p className="text-xs text-muted">
                {userName(s, i.reportedBy)}, {fmtDate(i.reportedOn)}
                {i.note ? ` — ${i.note}` : ''}
              </p>
            )}
            {can(user, 'resolve_issue') &&
              (editing === i.id ? (
                <form
                  className="mt-2 flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!run((st) => resolveIssue(st, user, today, i.id, kind, text)))
                      setEditing(undefined);
                  }}
                >
                  <select
                    className="input w-auto"
                    aria-label={cs.common.state}
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
                    className="input flex-1"
                    aria-label={cs.common.note}
                    placeholder={cs.common.note}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <button type="submit" className="btn btn-sm btn-primary" disabled={!text.trim()}>
                    {cs.common.save}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm mt-1"
                  onClick={() => {
                    setEditing(i.id);
                    setText('');
                    setKind('found');
                  }}
                >
                  {cs.dashboard.resolveConflict}
                </button>
              ))}
          </li>
        );
      })}
    </ul>
  );
}
