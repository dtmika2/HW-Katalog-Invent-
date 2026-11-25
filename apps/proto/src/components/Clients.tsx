/** Picking, adding and showing a client (light record, not a CRM). */
import { useId, useState, type KeyboardEvent } from 'react';
import {
  can,
  clientErrors,
  createClient,
  similarClients,
  type Client,
  type ClientInput,
} from '@quix/core';
import { cs } from '../i18n/cs';
import { useAppState, useProto, useToday, useUser } from '../store';
import { Field } from './ui';

export const byName = (a: Client, b: Client) => a.name.localeCompare(b.name, 'cs');

/** Store action behind every "new client" form; returns the new client's id. */
export function useAddClient() {
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  return (input: ClientInput, okText: string): string | undefined => {
    let id: string | undefined;
    run((st) => {
      const r = createClient(st, user, today, input);
      if (!r.ok) return r;
      id = r.value.clientId;
      return { ok: true, value: r.value.state };
    }, okText);
    return id;
  };
}

/**
 * Fields of one client. Not a `<form>`: it also sits inside the new booking form, so Enter saves
 * the client here instead of submitting the booking.
 */
export function ClientForm({
  initial,
  withNote = false,
  onSave,
  onUse,
  onCancel,
}: {
  initial?: Client;
  withNote?: boolean;
  onSave: (input: ClientInput) => void;
  /** Offer an existing look-alike instead. */
  onUse?: (id: string) => void;
  onCancel: () => void;
}) {
  const s = useAppState();
  const uid = useId();
  const [name, setName] = useState(initial?.name ?? '');
  const [contactPerson, setContactPerson] = useState(initial?.contactPerson ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [tried, setTried] = useState(false);

  const input: ClientInput = { name, contactPerson, email, phone, note };
  const errors = clientErrors(s, input, initial);
  const similar = name.trim() === initial?.name ? [] : similarClients(s, name, initial?.id);

  const submit = () => {
    setTried(true);
    if (!errors.name && !errors.email) onSave(input);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div
      role="group"
      aria-label={initial ? cs.clients.editTitle(initial.name) : cs.clients.newTitle}
      data-testid="client-form"
      className="space-y-3 rounded border border-alu-line bg-alu/40 p-3"
      onKeyDown={onKeyDown}
    >
      <p className="font-cond font-semibold">
        {initial ? cs.clients.editTitle(initial.name) : cs.clients.newTitle}
      </p>
      <Field label={cs.clients.name} htmlFor={`${uid}-name`}>
        <input
          id={`${uid}-name`}
          className="input"
          autoFocus
          aria-invalid={errors.name === 'taken'}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      {errors.name === 'taken' && (
        <p role="alert" className="text-xs text-bad">
          {cs.clients.nameTaken}
        </p>
      )}
      {similar.length > 0 && (
        <div
          data-testid="similar-clients"
          className="rounded border border-warn/40 bg-warn-light px-3 py-2 text-sm"
        >
          <p className="text-xs">{cs.clients.similar}</p>
          <ul className="mt-1 space-y-1">
            {similar.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <span>
                  <span className="font-medium">{c.name}</span>
                  {c.contactPerson && <span className="text-muted">, {c.contactPerson}</span>}
                </span>
                {c.archived ? (
                  <span className="text-xs text-muted">{cs.clients.archivedHint}</span>
                ) : (
                  onUse && (
                    <button type="button" className="btn btn-sm" onClick={() => onUse(c.id)}>
                      {cs.clients.use}
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={cs.clients.contactPerson} htmlFor={`${uid}-contact`}>
          <input
            id={`${uid}-contact`}
            className="input"
            value={contactPerson}
            onChange={(e) => setContactPerson(e.target.value)}
          />
        </Field>
        <Field label={cs.clients.email} htmlFor={`${uid}-email`}>
          <input
            id={`${uid}-email`}
            className="input"
            inputMode="email"
            aria-invalid={tried && !!errors.email}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label={cs.clients.phone} htmlFor={`${uid}-phone`}>
          <input
            id={`${uid}-phone`}
            className="input"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
      </div>
      {tried && errors.email && (
        <p role="alert" className="text-xs text-bad">
          {cs.clients.emailInvalid}
        </p>
      )}
      {withNote && (
        <Field label={cs.common.note} htmlFor={`${uid}-note`}>
          <input
            id={`${uid}-note`}
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!!errors.name}
          onClick={submit}
        >
          {initial ? cs.common.save : cs.clients.add}
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          {cs.common.cancel}
        </button>
      </div>
    </div>
  );
}

/** Contact person, e-mail and phone; the note stays on the Clients page. */
export function ClientContacts({ client }: { client: Client }) {
  const { contactPerson, email, phone } = client;
  return (
    <p
      data-testid="client-contacts"
      className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted"
    >
      {!contactPerson && !email && !phone && cs.clients.noContacts}
      {contactPerson && <span>{contactPerson}</span>}
      {email && (
        <a href={`mailto:${email}`} className="break-all text-ink underline">
          {email}
        </a>
      )}
      {phone && (
        <a
          href={`tel:${phone.replace(/\s/g, '')}`}
          className="whitespace-nowrap text-ink underline"
        >
          {phone}
        </a>
      )}
    </p>
  );
}

/**
 * Client select with "+ Nový klient". Sits in a dense grid: the open form takes the whole width
 * below, later fields fill the row next to the select.
 */
export function ClientPicker({
  id,
  value,
  onChange,
  disabled = false,
  createdText,
  onFormOpen,
}: {
  id: string;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  /** Toast after adding a client. */
  createdText: string;
  onFormOpen?: (open: boolean) => void;
}) {
  const s = useAppState();
  const user = useUser();
  const addClient = useAddClient();
  const [adding, setAdding] = useState(false);
  const open = (v: boolean) => {
    setAdding(v);
    onFormOpen?.(v);
  };
  const pick = (clientId: string) => {
    onChange(clientId);
    open(false);
  };
  const options = s.clients.filter((c) => !c.archived || c.id === value).sort(byName);
  const selected = s.clients.find((c) => c.id === value);
  const canAdd = !disabled && can(user, 'create_client');
  return (
    <>
      <div className="min-w-0">
        <Field label={cs.common.client} htmlFor={id}>
          <select
            id={id}
            className="input"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">{cs.common.none}</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.archived ? cs.clients.archivedName(c.name) : c.name}
              </option>
            ))}
          </select>
        </Field>
        {selected && <ClientContacts client={selected} />}
        {canAdd && !adding && (
          <button
            type="button"
            className="mt-1 text-xs text-tape underline"
            onClick={() => open(true)}
          >
            {cs.clients.newButton}
          </button>
        )}
      </div>
      {canAdd && adding && (
        <div className="col-span-full">
          <ClientForm
            onSave={(input) => {
              const newId = addClient(input, createdText);
              if (newId) pick(newId);
            }}
            onUse={pick}
            onCancel={() => open(false)}
          />
        </div>
      )}
    </>
  );
}
