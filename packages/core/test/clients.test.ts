/** Light client records: who may add and edit them, look-alike names, archiving. */
import { describe, expect, it } from 'vitest';
import {
  can,
  clientErrors,
  createBooking,
  createClient,
  emptyState,
  periodWithBuffer,
  saveBooking,
  setClientArchived,
  similarClients,
  unwrap,
  updateClient,
  type AppState,
  type Client,
  type Role,
  type User,
} from '../src';

const T = '2027-04-20';
const user = (role: Role, active = true): User => ({
  id: `u-${role}`,
  name: role,
  role,
  perms: { canConfirmOwnOrders: false, canEditCatalogue: false, canManageService: false },
  active,
});
const pm = user('pm');
const chief = user('chief');
const admin = user('admin');
const warehouse = user('warehouse');

function st(...clients: Client[]): AppState {
  return {
    ...emptyState(),
    users: [pm, chief, admin, warehouse],
    warehouses: [{ id: 'wh-1', name: 'Brod' }],
    clients,
  };
}
const GRAND: Client = { id: 'cl-grand', name: 'Hotel Grand Praha', phone: '1', note: 'Pozn.' };
const names = (list: Client[]) => list.map((c) => c.name);
const book = (s: AppState, clientId?: string) =>
  createBooking(s, pm, T, {
    eventName: 'Gala',
    periods: [periodWithBuffer('2027-05-01', '2027-05-01', s.settings)],
    ...(clientId ? { clientId } : {}),
  });

describe('client permissions', () => {
  it('PM, Chief and Admin add clients; only Chief and Admin manage them', () => {
    const table = [pm, chief, admin, warehouse].map((u) => [
      can(u, 'create_client'),
      can(u, 'manage_clients'),
    ]);
    expect(table).toEqual([
      [true, false],
      [true, true],
      [true, true],
      [false, false],
    ]);
    expect(can(user('pm', false), 'create_client')).toBe(false);
  });

  it('every action checks the permission', () => {
    const s = st(GRAND);
    expect(createClient(s, warehouse, T, { name: 'X' })).toMatchObject({
      error: { code: 'forbidden' },
    });
    expect(updateClient(s, pm, GRAND.id, { name: 'X' })).toMatchObject({
      error: { code: 'forbidden' },
    });
    expect(setClientArchived(s, pm, GRAND.id, true)).toMatchObject({
      error: { code: 'forbidden' },
    });
  });
});

describe('createClient', () => {
  it('stores trimmed fields, who and when, and does not mutate the input state', () => {
    const s = st(GRAND);
    const before = structuredClone(s);
    const r = unwrap(
      createClient(s, pm, T, { name: '  Nový   klient ', email: ' a@b.cz ', phone: ' ' }),
    );
    expect(r.state.clients.at(-1)).toEqual({
      id: r.clientId,
      name: 'Nový klient',
      email: 'a@b.cz',
      createdBy: pm.id,
      createdOn: T,
    });
    expect(s).toEqual(before);
  });

  it('needs a name and a sensible e-mail', () => {
    expect(createClient(st(), pm, T, { name: '  ' })).toMatchObject({
      error: { code: 'validation', details: { field: 'name', reason: 'required' } },
    });
    expect(createClient(st(), pm, T, { name: 'X', email: 'nesmysl' })).toMatchObject({
      error: { code: 'validation', details: { field: 'email' } },
    });
    expect(clientErrors(st(), { name: 'X', email: '' })).toEqual({});
  });

  it('refuses a name identical to an active client, but not to an archived one', () => {
    const same = { name: 'hotel  GRAND praha' };
    expect(createClient(st(GRAND), pm, T, same)).toMatchObject({
      error: { code: 'validation', details: { reason: 'taken' } },
    });
    expect(createClient(st({ ...GRAND, archived: true }), pm, T, same).ok).toBe(true);
  });
});

describe('similarClients (warning only)', () => {
  const s = st(
    GRAND,
    { id: 'c2', name: 'Pivovar Lednice a.s.' },
    { id: 'c3', name: 'Město Brod', archived: true },
    { id: 'c4', name: 'Divadlo Na Kraji' },
  );

  it('finds shorter, longer, differently written and archived names', () => {
    expect(names(similarClients(s, 'Hotel Gr'))).toEqual(['Hotel Grand Praha']);
    expect(names(similarClients(s, 'Hotel Grand Praha, výstaviště'))).toEqual([
      'Hotel Grand Praha',
    ]);
    expect(names(similarClients(s, 'pivovar lednice, s.r.o.'))).toEqual(['Pivovar Lednice a.s.']);
    expect(names(similarClients(s, 'MESTO BROD'))).toEqual(['Město Brod']);
  });

  it('stays quiet for other names, very short text and the client itself', () => {
    expect(similarClients(s, 'Hotel Moravan')).toEqual([]);
    expect(similarClients(s, 'na')).toEqual([]);
    expect(similarClients(s, '')).toEqual([]);
    expect(similarClients(s, 'Hotel Grand', GRAND.id)).toEqual([]);
  });

  it('does not block adding the client', () => {
    expect(createClient(s, pm, T, { name: 'Hotel Grand' }).ok).toBe(true);
  });
});

describe('updateClient', () => {
  it('changes fields and removes emptied ones, keeping who created it', () => {
    const s = st({ ...GRAND, createdBy: pm.id, createdOn: T });
    const r = unwrap(
      updateClient(s, admin, GRAND.id, { name: 'Grand', contactPerson: 'Jan', phone: '' }),
    );
    expect(r.clients).toEqual([
      { id: GRAND.id, name: 'Grand', contactPerson: 'Jan', createdBy: pm.id, createdOn: T },
    ]);
    expect(s.clients[0]?.name).toBe('Hotel Grand Praha');
  });

  it('may keep its own name but not take another active one', () => {
    const s = st(GRAND, { id: 'c2', name: 'Banka' });
    expect(updateClient(s, chief, GRAND.id, { name: 'Hotel Grand Praha' }).ok).toBe(true);
    expect(updateClient(s, chief, GRAND.id, { name: 'banka' })).toMatchObject({
      error: { code: 'validation' },
    });
    expect(updateClient(s, chief, 'nope', { name: 'X' })).toMatchObject({
      error: { code: 'not_found' },
    });
  });
});

describe('archiving', () => {
  it('archives and restores', () => {
    const a = unwrap(setClientArchived(st(GRAND), chief, GRAND.id, true));
    expect(a.clients[0]?.archived).toBe(true);
    expect(unwrap(setClientArchived(a, chief, GRAND.id, false)).clients).toEqual([GRAND]);
    expect(setClientArchived(a, chief, 'nope', true)).toMatchObject({
      error: { code: 'not_found' },
    });
  });

  it('cannot restore a client whose name is used by another active one', () => {
    const s = st({ ...GRAND, archived: true }, { id: 'c2', name: GRAND.name });
    expect(setClientArchived(s, chief, GRAND.id, false)).toMatchObject({
      error: { code: 'validation' },
    });
  });

  it('a new booking cannot pick an archived or unknown client', () => {
    expect(book(st({ ...GRAND, archived: true }), GRAND.id)).toMatchObject({
      error: { code: 'validation' },
    });
    expect(book(st(), 'nope')).toMatchObject({ error: { code: 'not_found' } });
  });

  it('a booking keeps its client after it is archived, but cannot switch to an archived one', () => {
    const s = st(GRAND, { id: 'c2', name: 'Banka' });
    const { state, bookingId } = unwrap(book(s, GRAND.id));
    const a = unwrap(setClientArchived(state, chief, GRAND.id, true));
    const b = a.bookings.find((x) => x.id === bookingId)!;
    const saved = unwrap(saveBooking(a, pm, T, { ...b, purposeMessage: 'Nové' }));
    expect(saved.bookings[0]?.clientId).toBe(GRAND.id);
    const moved = unwrap(saveBooking(saved, pm, T, { ...b, clientId: 'c2' }));
    expect(saveBooking(moved, pm, T, { ...b, clientId: GRAND.id })).toMatchObject({
      error: { code: 'validation' },
    });
  });

  it('clearing the client of a booking removes it', () => {
    const { state } = unwrap(book(st(GRAND), GRAND.id));
    const saved = unwrap(saveBooking(state, pm, T, { ...state.bookings[0]!, clientId: '' }));
    expect(saved.bookings[0]).not.toHaveProperty('clientId');
  });
});
