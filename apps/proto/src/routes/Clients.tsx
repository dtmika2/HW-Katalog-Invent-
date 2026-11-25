/** Client list for the Chief and Admin: add, edit, archive. */
import { useState } from 'react';
import { can, foldText, setClientArchived, updateClient, type Client } from '@quix/core';
import { byName, ClientContacts, ClientForm, useAddClient } from '../components/Clients';
import { Empty } from '../components/ui';
import { cs, fmtDate } from '../i18n/cs';
import { userName } from '../lib/names';
import { useAppState, useProto, useUser } from '../store';

function Row({
  c,
  editing,
  onEdit,
}: {
  c: Client;
  editing: boolean;
  onEdit: (id: string | undefined) => void;
}) {
  const s = useAppState();
  const user = useUser();
  const run = useProto((p) => p.run);
  if (editing)
    return (
      <li className="p-3">
        <ClientForm
          initial={c}
          withNote
          onSave={(input) => {
            if (!run((st) => updateClient(st, user, c.id, input), cs.common.saved))
              onEdit(undefined);
          }}
          onCancel={() => onEdit(undefined)}
        />
      </li>
    );
  return (
    <li
      data-testid="client-row"
      className="grid gap-x-4 gap-y-1 px-3 py-3 text-sm md:grid-cols-[2fr_3fr_10rem] md:items-center"
    >
      <div className="min-w-0">
        <span className="font-cond font-semibold">{c.name}</span>
        {c.archived && (
          <span className="ml-2 rounded bg-alu-dark px-1.5 text-xs text-muted">
            {cs.clients.archivedChip}
          </span>
        )}
        <p className="text-xs text-muted">
          {cs.clients.bookingCount(s.bookings.filter((b) => b.clientId === c.id).length)}
          {c.createdOn && `, ${cs.clients.created(userName(s, c.createdBy), fmtDate(c.createdOn))}`}
        </p>
      </div>
      <div className="min-w-0">
        <ClientContacts client={c} />
        {c.note && <p className="text-xs">{cs.clients.noteLine(c.note)}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-sm"
          aria-label={`${cs.common.edit}: ${c.name}`}
          onClick={() => onEdit(c.id)}
        >
          {cs.common.edit}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          aria-label={`${c.archived ? cs.clients.restore : cs.clients.archive}: ${c.name}`}
          onClick={() =>
            run(
              (st) => setClientArchived(st, user, c.id, !c.archived),
              c.archived ? cs.clients.restored : cs.clients.archivedOk,
              c.archived ? cs.clients.nameTaken : undefined,
            )
          }
        >
          {c.archived ? cs.clients.restore : cs.clients.archive}
        </button>
      </div>
    </li>
  );
}

export function Clients() {
  const s = useAppState();
  const user = useUser();
  const addClient = useAddClient();
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | undefined>();
  if (!can(user, 'manage_clients'))
    return <p className="text-sm text-muted">{cs.errors.forbidden}</p>;
  const q = foldText(query.trim());
  const list = s.clients
    .filter((c) => showArchived || !c.archived)
    .filter((c) => !q || foldText(`${c.name} ${c.contactPerson ?? ''}`).includes(q))
    .sort(byName);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>{cs.clients.title}</h1>
        {!adding && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            {cs.clients.newButton}
          </button>
        )}
      </div>
      <p className="max-w-prose text-sm text-muted">{cs.clients.hint}</p>
      {adding && (
        <ClientForm
          withNote
          onSave={(input) => {
            if (addClient(input, cs.clients.createdOk)) setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      <div className="flex flex-wrap items-center gap-4">
        <input
          type="search"
          className="input max-w-xs"
          aria-label={cs.clients.search}
          placeholder={cs.clients.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          {cs.clients.showArchived(s.clients.filter((c) => c.archived).length)}
        </label>
      </div>
      {list.length === 0 ? (
        <Empty>{cs.clients.empty}</Empty>
      ) : (
        <ul data-testid="clients" className="panel divide-y divide-alu-line">
          {list.map((c) => (
            <Row key={c.id} c={c} editing={editing === c.id} onEdit={setEditing} />
          ))}
        </ul>
      )}
    </div>
  );
}
