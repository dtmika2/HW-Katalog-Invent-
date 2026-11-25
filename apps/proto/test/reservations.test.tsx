/** Reservations of a date, conflict tiers and cancelling bookings in the app. */
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { booking, renderApp, renderCurrent, state } from './helpers';

const EMPTY = 'bk-mozna-svatba';
const PLANNED = 'bk-rodinny-den';
const DRAFT = 'bk-teambuilding';
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('reservations of a date', () => {
  it('a PM notes a date with a name only; the Chief is not notified', () => {
    renderApp('/bookings/new', { scenario: 'base', user: 'u-petr' });
    const before = state().notifications.length;
    change('Název akce', 'Možný večírek');
    change('Stav', 'tentative');
    click('Vytvořit předrezervaci');
    const b = state().bookings.at(-1)!;
    expect(b).toMatchObject({ eventName: 'Možný večírek', status: 'tentative', lines: [] });
    expect(state().notifications).toHaveLength(before);
  });

  it('the stage is switched on the booking; "Nepotvrzená" cannot be sent for approval', () => {
    renderApp(`/bookings/${EMPTY}`, { scenario: 'base', user: 'u-lucie' });
    expect(screen.queryByRole('button', { name: 'Potvrdit ke schválení' })).toBeNull();
    expect(screen.getByText(/Nepotvrzenou rezervaci nejdřív přepněte/)).toBeInTheDocument();
    change('Stav', 'planned');
    expect(booking(EMPTY)?.status).toBe('planned');
    expect(screen.getByRole('button', { name: 'Potvrdit ke schválení' })).toBeDisabled();
    expect(
      screen.getByText('Stav změněn: Nepotvrzená rezervace → Potvrzená rezervace'),
    ).toBeInTheDocument();
  });

  it('the stage switch keeps unsaved edits', () => {
    renderApp(`/bookings/${EMPTY}`, { scenario: 'base', user: 'u-lucie' });
    change('Název akce', 'Svatba');
    change('Stav', 'draft');
    expect(screen.getByLabelText('Název akce')).toHaveValue('Svatba');
    click('Uložit');
    expect(booking(EMPTY)).toMatchObject({ eventName: 'Svatba', status: 'draft' });
  });

  it('all PMs and the Chief see them in the list and the calendar, the warehouse does not', () => {
    for (const [user, sees] of [
      ['u-petr', true],
      ['u-tomas', true],
      ['u-admin', true],
      ['u-martin', false],
    ] as const) {
      const list = renderApp('/bookings', { scenario: 'base', user });
      click('Všechny');
      expect(!!screen.queryByText('Možná svatba, Hotel Grand')).toBe(sees);
      list.unmount();
      const cal = renderCurrent('/calendar');
      click('Další měsíc');
      expect(!!screen.queryByTestId(`row-${EMPTY}`)).toBe(sees);
      expect(!!screen.queryByLabelText('Zobrazit rezervace termínu')).toBe(sees);
      cal.unmount();
      const page = renderCurrent(`/bookings/${EMPTY}`);
      expect(!!screen.queryByLabelText('Název akce')).toBe(sees);
      page.unmount();
      const item = renderCurrent('/items/par-rgbw?month=2027-05-01');
      fireEvent.click(screen.getByTestId('day-2027-05-30'));
      expect(!!screen.queryByText('Rodinný den Morava')).toBe(sees);
      item.unmount();
    }
  });

  it('in the calendar they come last and can be switched off', () => {
    renderApp('/calendar', { scenario: 'base', user: 'u-petr' });
    click('Další měsíc');
    const rows = screen.getAllByTestId(/^row-/).map((r) => r.dataset.testid);
    expect(rows.slice(-2).sort()).toEqual([`row-${PLANNED}`, `row-${EMPTY}`].sort());
    fireEvent.click(screen.getByLabelText('Zobrazit rezervace termínu'));
    expect(screen.queryByTestId(`row-${EMPTY}`)).toBeNull();
    change('Stav', 'tentative');
    expect(screen.getAllByTestId(/^row-/).map((r) => r.dataset.testid)).toEqual([`row-${EMPTY}`]);
  });
});

describe('conflict tiers', () => {
  it('a likely conflict is on the badge and in the panel, and does not block sending', () => {
    renderApp(`/bookings/${DRAFT}`, { scenario: 'base', user: 'u-petr' });
    expect(screen.getByText('Pravděpodobně chybí 2 ks')).toHaveAttribute('class');
    const tier = within(screen.getByTestId('tier-likely'));
    expect(tier.getByText(/Rodinný den Morava — Lucie Malá.*Potvrzená rezervace/)).toBeVisible();
    expect(screen.queryByText('Viděl(a) jsem konflikt')).toBeNull();
    expect(screen.getByRole('button', { name: 'Potvrdit ke schválení' })).toBeEnabled();
  });

  it('with an unconfirmed reservation it is only possible', () => {
    const view = renderApp(`/bookings/${PLANNED}`, { scenario: 'base', user: 'u-lucie' });
    change('Stav', 'tentative');
    view.unmount();
    const other = renderCurrent(`/bookings/${DRAFT}`);
    expect(screen.getByText('Možná chybí 2 ks')).toBeInTheDocument();
    expect(screen.getByTestId('tier-possible')).toHaveTextContent('Rodinný den Morava');
    expect(screen.queryByTestId('tier-likely')).toBeNull();
    other.unmount();
  });

  it('bookings without gear are listed on both sides as same-day, with their tier', () => {
    const a = renderApp('/bookings/bk-valna', { scenario: 'base', user: 'u-petr' });
    const list = within(screen.getByTestId('same-day'));
    expect(list.getByText(/Možná svatba, Hotel Grand/)).toBeInTheDocument();
    expect(list.getByText(/Možný/)).toBeInTheDocument();
    a.unmount();
    renderCurrent(`/bookings/${EMPTY}`);
    expect(
      within(screen.getByTestId('same-day')).getByText(/Valná hromada Horizont/),
    ).toBeInTheDocument();
  });

  it('calendar: the level decides which marks are shown', () => {
    renderApp('/calendar', { scenario: 'base', user: 'u-petr' });
    click('Další měsíc');
    const row = () => within(screen.getByTestId(`row-${DRAFT}`));
    const marks = () => row().queryAllByRole('button', { name: /pravděpodobný/ });
    expect(marks().length).toBeGreaterThan(0);
    fireEvent.click(marks()[0]!);
    expect(screen.getByTestId('conflict-detail')).toHaveTextContent(
      /Pravděpodobný.*Počítá s ní: Rodinný den Morava/,
    );
    change('Konflikty', 'real');
    expect(marks()).toHaveLength(0);
    expect(screen.queryByTestId('conflict-detail')).toBeNull();
    change('Konflikty', 'all');
    expect(marks().length).toBeGreaterThan(0);
  });
});

describe('cancelling a booking', () => {
  const cancel = (reason = 'Klient akci zrušil') => {
    click('Zrušit akci');
    expect(screen.getByRole('button', { name: 'Ano, zrušit akci' })).toBeDisabled();
    change('Důvod (povinné)', reason);
    click('Ano, zrušit akci');
  };

  it('a PM cancels a draft with a reason, finds it in the archive and takes it back', () => {
    const page = renderApp(`/bookings/${DRAFT}`, { scenario: 'base', user: 'u-petr' });
    cancel();
    expect(booking(DRAFT)?.status).toBe('cancelled');
    expect(screen.getByTestId('cancelled-note')).toHaveTextContent(
      'Zrušeno 20.04.2027, Petr Dvořák. Důvod: Klient akci zrušil',
    );
    expect(screen.getByLabelText('Název akce')).toBeDisabled();
    expect(screen.getByTestId('booking-print')).toHaveTextContent('ZRUŠENO');
    page.unmount();
    const list = renderCurrent('/bookings');
    expect(screen.queryByText('Teambuilding Spektrum')).toBeNull();
    click('Archiv');
    expect(screen.getByText('Teambuilding Spektrum')).toBeInTheDocument();
    expect(screen.getByText('Zahradní slavnost Horizont')).toBeInTheDocument();
    list.unmount();
    renderCurrent(`/bookings/${DRAFT}`);
    click('Obnovit');
    expect(booking(DRAFT)?.status).toBe('draft');
    expect(screen.getByLabelText('Název akce')).toBeEnabled();
  });

  it('unsaved edits do not stay on a cancelled booking', () => {
    renderApp(`/bookings/${DRAFT}`, { scenario: 'base', user: 'u-petr' });
    change('Název akce', 'Rozepsané');
    cancel();
    expect(screen.getByLabelText('Název akce')).toHaveValue('Teambuilding Spektrum');
  });

  it('an approved order: its PM cancels alone, only the Chief takes it back, to be approved again', () => {
    const ID = 'bk-letni-noc';
    const page = renderApp(`/bookings/${ID}`, { scenario: 'base', user: 'u-lucie' });
    cancel();
    expect(booking(ID)?.status).toBe('cancelled');
    expect(screen.queryByRole('button', { name: 'Obnovit' })).toBeNull();
    page.unmount();
    const gone = state();
    renderApp(`/bookings/${ID}`, { scenario: 'base', user: 'u-tomas', prepare: () => gone });
    click('Obnovit');
    expect(booking(ID)).toMatchObject({ status: 'submitted', type: 'prebooking' });
    expect(screen.getByRole('button', { name: 'Schválit objednávku' })).toBeInTheDocument();
  });

  it('hidden in the calendar until asked for, without conflict marks', () => {
    renderApp('/calendar', { scenario: 'base', user: 'u-petr' });
    click('Další měsíc');
    expect(screen.queryByTestId('row-bk-zahradni')).toBeNull();
    fireEvent.click(screen.getByLabelText('Zobrazit zrušené'));
    const row = screen.getByTestId('row-bk-zahradni');
    expect(row.querySelector('[data-status="cancelled"]')).not.toBeNull();
    expect(row.querySelector('[data-conflict]')).toBeNull();
  });

  it('while packed: the PM asks, the Chief approves, the warehouse unpacks', () => {
    const s0 = renderApp('/', { scenario: 'base', user: 'u-tomas' });
    const b = state().bookings.find(
      (x) => x.status === 'packed' && !state().shipments.some((y) => y.bookingId === x.id),
    )!;
    s0.unmount();
    const pm = renderApp(`/bookings/${b.id}`, { scenario: 'base', user: b.pmId });
    click('Požádat šéfa o zrušení akce');
    change('Důvod (povinné)', 'Klient akci zrušil');
    click('Odeslat žádost');
    expect(screen.queryByRole('button', { name: 'Požádat šéfa o zrušení akce' })).toBeNull();
    pm.unmount();
    const asked = state();
    const chief = renderApp('/', { scenario: 'base', user: 'u-tomas', prepare: () => asked });
    expect(screen.getByTestId('cancel-requests')).toHaveTextContent('Zrušit celou akci');
    click('Schválit zrušení');
    expect(booking(b.id)).toMatchObject({ status: 'packed' });
    chief.unmount();
    const pending = state();
    const wh = renderApp('/', { scenario: 'base', user: 'u-martin', prepare: () => pending });
    expect(screen.getByTestId('to-unpack')).toHaveTextContent(b.eventName);
    expect(screen.getByTestId('ready-to-ship')).not.toHaveTextContent(b.eventName);
    wh.unmount();
    const page = renderCurrent(`/packing/${b.id}`);
    expect(screen.getByTestId('cancel-pending')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Potvrdit, že je vše vybalené' })).toBeDisabled();
    for (const c of screen.getAllByLabelText(/^Zpátky:/)) fireEvent.click(c);
    click('Potvrdit, že je vše vybalené');
    expect(booking(b.id)?.status).toBe('cancelled');
    page.unmount();
  });

  it('once anything has left there is no cancelling', () => {
    for (const st of ['shipped', 'returning', 'closed'] as const) {
      const first = renderApp('/', { scenario: 'base', user: 'u-tomas' });
      const b = state().bookings.find((x) => x.status === st)!;
      first.unmount();
      const page = renderCurrent(`/bookings/${b.id}`);
      expect(screen.queryByRole('button', { name: /zruš/i })).toBeNull();
      page.unmount();
    }
  });

  it('other PMs and the warehouse cannot cancel', () => {
    for (const user of ['u-lucie', 'u-martin', 'u-admin']) {
      const page = renderApp(`/bookings/${DRAFT}`, { scenario: 'base', user });
      expect(screen.queryByRole('button', { name: 'Zrušit akci' })).toBeNull();
      page.unmount();
    }
  });
});
