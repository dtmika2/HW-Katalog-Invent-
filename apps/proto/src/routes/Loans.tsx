/** All quick loans: who has what, since when, and when it should be back. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { openLoans } from '@quix/core';
import { byReturn, LoanList } from '../components/Loans';
import { Empty } from '../components/ui';
import { cs } from '../i18n/cs';
import { useAppState, useUser } from '../store';

type Tab = 'mine' | 'all' | 'returned';

export function Loans() {
  const s = useAppState();
  const user = useUser();
  const [tab, setTab] = useState<Tab>('all');
  const open = openLoans(s);
  const list =
    tab === 'returned'
      ? s.loans.filter((l) => !open.includes(l)).reverse()
      : open.filter((l) => tab === 'all' || l.borrowerId === user.id).sort(byReturn);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>{cs.loans.title}</h1>
        <div className="flex gap-1" role="group">
          {(['all', 'mine', 'returned'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`btn btn-sm ${tab === t ? 'btn-primary' : ''}`}
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
            >
              {cs.loans.tabs[t]}
            </button>
          ))}
        </div>
      </div>
      <p className="max-w-prose text-sm text-muted">
        {cs.loans.hint}{' '}
        <Link to="/catalog" className="text-tape underline">
          {cs.loans.toCatalog}
        </Link>
      </p>
      {list.length === 0 ? (
        <Empty>{cs.loans.empty}</Empty>
      ) : (
        <div className="panel">
          <LoanList loans={list} />
        </div>
      )}
    </div>
  );
}
