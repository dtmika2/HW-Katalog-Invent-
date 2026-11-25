/** Clients: added while booking (PM, Chief), managed on their own page (Chief, Admin). */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { booking, renderApp, state } from './helpers';

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const picker = () => screen.getByLabelText('Klient') as HTMLSelectElement;
const optionNames = () =>
  within(picker())
    .getAllByRole('option')
    .map((o) => o.textContent);
const clientByName = (name: string) => state().clients.find((c) => c.name === name);

describe('adding a client while booking', () => {
  it('a PM adds a client in a new pre-booking; the created booking has it', () => {
    renderApp('/bookings/new', { scenario: 'base', user: 'u-petr' });
    fill('Název akce', 'Vánoční večírek');
    click('+ Nový klient');
    const create = screen.getByRole('button', { name: 'Vytvořit předrezervaci' });
    expect(create).toBeDisabled();
    expect(screen.getByText('Nejdřív dokončete nového klienta, nebo ho zrušte.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Přidat klienta' })).toBeDisabled();

    fill('Název klienta (povinné)', 'Kino Orion');
    fill('E-mail', 'nesmysl');
    click('Přidat klienta');
    expect(screen.getByRole('alert')).toHaveTextContent('E-mail nemá správný tvar.');
    fill('E-mail', 'kino@orion.example');
    // Enter saves the client, not the booking around it
    const enterAllowed = fireEvent.keyDown(screen.getByLabelText('E-mail'), { key: 'Enter' });
    expect(enterAllowed).toBe(false);

    const c = clientByName('Kino Orion')!;
    expect(c).toMatchObject({ email: 'kino@orion.example', createdBy: 'u-petr' });
    expect(picker().value).toBe(c.id);
    expect(screen.getByTestId('client-contacts')).toHaveTextContent('kino@orion.example');
    fireEvent.click(create);
    expect(state().bookings.find((b) => b.eventName === 'Vánoční večírek')?.clientId).toBe(c.id);
  });

  it('similar names are offered and "Použít" picks the existing client', () => {
    renderApp('/bookings/new', { scenario: 'base', user: 'u-petr' });
    const before = state().clients.length;
    click('+ Nový klient');
    fill('Název klienta (povinné)', 'hotel grand');
    const box = screen.getByTestId('similar-clients');
    expect(box).toHaveTextContent('Hotel Grand Praha, Ing. Pavel Beneš');
    expect(screen.getByRole('button', { name: 'Přidat klienta' })).toBeEnabled();
    fill('Název klienta (povinné)', 'HOTEL Grand Praha');
    expect(screen.getByRole('alert')).toHaveTextContent('Klient s tímto názvem už existuje.');
    expect(screen.getByRole('button', { name: 'Přidat klienta' })).toBeDisabled();
    click('Použít');
    expect(picker().value).toBe('cl-grand');
    expect(screen.queryByTestId('client-form')).toBeNull();
    expect(state().clients).toHaveLength(before);
  });

  it('on the booking page unsaved edits survive and "Uložit" stores the new client', () => {
    const draft = 'bk-teambuilding';
    renderApp(`/bookings/${draft}`, { scenario: 'base', user: 'u-petr' });
    fill('Název akce', 'Přejmenovaná akce');
    click('+ Nový klient');
    fill('Název klienta (povinné)', 'Kino Orion');
    click('Přidat klienta');
    const c = clientByName('Kino Orion')!;
    expect(picker().value).toBe(c.id);
    expect(screen.getByLabelText('Název akce')).toHaveValue('Přejmenovaná akce');
    expect(booking(draft)?.clientId).not.toBe(c.id);
    click('Uložit');
    expect(booking(draft)).toMatchObject({ clientId: c.id, eventName: 'Přejmenovaná akce' });
  });

  it('the warehouse sees the contacts on a booking, but not the note or the add button', () => {
    renderApp('/bookings/bk-firemni', { scenario: 'base', user: 'u-martin' });
    const c = state().clients.find((x) => x.id === booking('bk-firemni')?.clientId)!;
    const box = screen.getByTestId('client-contacts');
    expect(box).toHaveTextContent(c.contactPerson!);
    expect(within(box).getByRole('link', { name: c.email! })).toHaveAttribute(
      'href',
      `mailto:${c.email}`,
    );
    expect(screen.queryByRole('button', { name: '+ Nový klient' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Klienti' })).toBeNull();
  });
});

describe('Clients page', () => {
  it('Admin edits, archives and restores; an archived client is no longer offered', () => {
    renderApp('/clients', { scenario: 'base', user: 'u-admin' });
    expect(screen.getByRole('link', { name: 'Klienti' })).toBeVisible();
    expect(screen.getAllByTestId('client-row')).toHaveLength(10);
    expect(screen.getByTestId('clients')).toHaveTextContent('Neziskovka, sleva dle dohody');

    click('Upravit: Banka Horizont');
    fill('Telefon', '+420 777 000 111');
    click('Uložit');
    expect(clientByName('Banka Horizont')?.phone).toBe('+420 777 000 111');

    click('Archivovat: Banka Horizont');
    expect(screen.getAllByTestId('client-row')).toHaveLength(9);
    fireEvent.click(screen.getByLabelText('Zobrazit archiv (1)'));
    expect(screen.getAllByTestId('client-row')).toHaveLength(10);
    const archivedId = clientByName('Banka Horizont')!.id;

    const archive = (s: ReturnType<typeof state>) => ({
      ...s,
      clients: s.clients.map((c) => (c.id === archivedId ? { ...c, archived: true } : c)),
    });
    click('Obnovit: Banka Horizont');
    expect(clientByName('Banka Horizont')?.archived).toBeUndefined();

    cleanup();
    renderApp('/bookings/new', { scenario: 'base', user: 'u-petr', prepare: archive });
    expect(optionNames()).not.toContain('Banka Horizont');
    expect(optionNames()).toContain('Autosalon Morava');
    cleanup();
    const kept = state().bookings.find((b) => b.clientId === archivedId)!;
    renderApp(`/bookings/${kept.id}`, { scenario: 'base', user: 'u-tomas', prepare: archive });
    expect(optionNames()).toContain('Banka Horizont (v archivu)');
  });

  it('search ignores diacritics and looks at contacts; the Chief can add a client with a note', () => {
    renderApp('/clients', { scenario: 'base', user: 'u-tomas' });
    fill('Hledat klienta nebo kontakt', 'mesto');
    expect(screen.getAllByTestId('client-row')).toHaveLength(1);
    fill('Hledat klienta nebo kontakt', 'fiala');
    expect(screen.getByTestId('client-row')).toHaveTextContent('TechConf s.r.o.');
    fill('Hledat klienta nebo kontakt', 'zzz');
    expect(screen.getByText('Žádný klient neodpovídá.')).toBeVisible();
    fill('Hledat klienta nebo kontakt', '');
    click('+ Nový klient');
    fill('Název klienta (povinné)', 'Kino Orion');
    fill('Poznámka', 'Platí předem');
    click('Přidat klienta');
    const row = screen.getAllByTestId('client-row').find((r) => /Kino Orion/.test(r.textContent!));
    expect(row).toHaveTextContent('bez rezervací, založeno: ');
    expect(row).toHaveTextContent('Poznámka: Platí předem');
  });

  it('a PM has no link and is refused', () => {
    renderApp('/clients', { scenario: 'base', user: 'u-petr' });
    expect(screen.queryByRole('link', { name: 'Klienti' })).toBeNull();
    expect(screen.getByText('Na tuto akci nemáte oprávnění.')).toBeVisible();
  });
});
