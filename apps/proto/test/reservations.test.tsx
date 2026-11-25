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

  it('unconfirmed becomes possible, approved becomes real', () => {
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
