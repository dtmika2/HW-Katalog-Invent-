/**
 * Light client records (not a CRM). PMs and the Chief add a client while booking; the Chief and
 * Admin edit and archive them. Nothing is hard-deleted, bookings keep their client.
 */
import type { IsoDate } from '../dates';
import { can } from '../lifecycle/permissions';
import type { AppState, Client, Id, User } from '../types';
import { err, nextId, ok, produce, type Result } from '../util';

export type ClientInput = Pick<Client, 'name' | 'contactPerson' | 'email' | 'phone' | 'note'>;

const OPTIONAL_FIELDS = ['contactPerson', 'email', 'phone', 'note'] as const;

/** Case and spacing do not make a different name; diacritics and legal forms may. */
const sameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

const LEGAL_FORM =
  /[\s,]+(spol\.?\s*s\s*r\.?\s*o\.?|s\.\s*r\.\s*o\.?|sro|a\.\s*s\.?|z\.\s*s\.?|o\.\s*p\.\s*s\.?|v\.\s*o\.\s*s\.?|k\.\s*s\.?)$/;

/** Lower case without diacritics, for searching and comparing. */
export const foldText = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/** Words of a name without case, diacritics, punctuation and legal form. */
function nameWords(name: string): string[] {
  return foldText(sameKey(name))
    .replace(LEGAL_FORM, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Every word of `a` begins some word of `b`. */
const beginsIn = (a: string[], b: string[]) => a.every((w) => b.some((x) => x.startsWith(w)));

/**
 * Existing clients whose name looks like `name`: every word of the shorter name begins a word of
 * the longer one. A warning only; archived clients are included, typos are not caught.
 */
export function similarClients(state: AppState, name: string, exceptId?: Id): Client[] {
  const words = nameWords(name);
  if (words.join('').length < 3) return [];
  return state.clients.filter((c) => {
    const other = nameWords(c.name);
    if (c.id === exceptId || other.length === 0) return false;
    return (
      (words.length <= other.length && beginsIn(words, other)) ||
      (other.length <= words.length && beginsIn(other, words))
    );
  });
}

export interface ClientErrors {
  name?: 'required' | 'taken';
  email?: 'invalid';
}

/** What is wrong with the input; empty when it can be saved. `self` is the client being edited. */
export function clientErrors(state: AppState, input: ClientInput, self?: Client): ClientErrors {
  const out: ClientErrors = {};
  const key = sameKey(input.name);
  if (!key) out.name = 'required';
  else if (
    !self?.archived &&
    state.clients.some((c) => c.id !== self?.id && !c.archived && sameKey(c.name) === key)
  )
    out.name = 'taken';
  const email = input.email?.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) out.email = 'invalid';
  return out;
}

function validate(state: AppState, input: ClientInput, self?: Client): Result<true> {
  const e = clientErrors(state, input, self);
  if (e.name)
    return err('validation', e.name === 'taken' ? 'Name is taken' : 'Name is required', {
      field: 'name',
      reason: e.name,
    });
  if (e.email) return err('validation', 'E-mail is not valid', { field: 'email' });
  return ok(true);
}

/** Trimmed fields; empty optional ones are left out. */
function clean(input: ClientInput): ClientInput {
  const out: ClientInput = { name: input.name.trim().replace(/\s+/g, ' ') };
  for (const f of OPTIONAL_FIELDS) {
    const v = input[f]?.trim();
    if (v) out[f] = v;
  }
  return out;
}

/** Add a client. An identical active name is refused; a similar one is fine. */
export function createClient(
  state: AppState,
  user: User,
  today: IsoDate,
  input: ClientInput,
): Result<{ state: AppState; clientId: Id }> {
  if (!can(user, 'create_client')) return err('forbidden', 'Not allowed to add clients');
  const v = validate(state, input);
  if (!v.ok) return v;
  const { state: next, result } = produce(state, (d) => {
    const id = nextId(d, 'client');
    d.clients.push({ id, ...clean(input), createdBy: user.id, createdOn: today });
    return id;
  });
  return ok({ state: next, clientId: result });
}

/** Change a client's name and contacts; emptied optional fields are removed. */
export function updateClient(
  state: AppState,
  user: User,
  clientId: Id,
  input: ClientInput,
): Result<AppState> {
  if (!can(user, 'manage_clients')) return err('forbidden', 'Not allowed to edit clients');
  const current = state.clients.find((c) => c.id === clientId);
  if (!current) return err('not_found', `Client ${clientId} not found`);
  const v = validate(state, input, current);
  if (!v.ok) return v;
  return ok(
    produce(state, (d) => {
      const i = d.clients.findIndex((c) => c.id === clientId);
      const kept: Client = { ...current };
      for (const f of OPTIONAL_FIELDS) delete kept[f];
      d.clients[i] = { ...kept, ...clean(input) };
    }).state,
  );
}

/** Archive a client (no longer offered for bookings; existing bookings keep it) or restore it. */
export function setClientArchived(
  state: AppState,
  user: User,
  clientId: Id,
  archived: boolean,
): Result<AppState> {
  if (!can(user, 'manage_clients')) return err('forbidden', 'Not allowed to archive clients');
  const current = state.clients.find((c) => c.id === clientId);
  if (!current) return err('not_found', `Client ${clientId} not found`);
  if (!archived) {
    const { name } = current;
    // the name may have been given to another client in the meantime
    const v = validate(state, { name }, { id: clientId, name });
    if (!v.ok) return v;
  }
  return ok(
    produce(state, (d) => {
      const c = d.clients.find((x) => x.id === clientId);
      if (!c) return;
      if (archived) c.archived = true;
      else delete c.archived;
    }).state,
  );
}

/** A booking may keep its client, even an archived one, but only pick an active one. */
export function checkBookingClient(
  state: AppState,
  clientId: Id | undefined,
  previousId?: Id,
): Result<true> {
  if (!clientId || clientId === previousId) return ok(true);
  const c = state.clients.find((x) => x.id === clientId);
  if (!c) return err('not_found', `Client ${clientId} not found`);
  if (c.archived) return err('validation', 'The client is archived', { field: 'clientId' });
  return ok(true);
}
