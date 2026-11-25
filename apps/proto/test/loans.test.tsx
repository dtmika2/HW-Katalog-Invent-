/** Quick loans: taking an item from its page, the warning, returning it. */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isCaseComplete } from '@quix/core';
import { CHAIN } from '@quix/fixtures';
import { useProto } from '../src/store';
import { renderApp, renderCurrent, state } from './helpers';

const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const page = (user: string, path: string) => {
  cleanup();
  useProto.getState().setUser(user);
  renderCurrent(path);
};

describe('borrowing an item', () => {
  it('from the catalogue card to the form; taken without a date it is out for 7 days', () => {
    renderApp('/catalog?cat=ost-misc', { scenario: 'base', user: 'u-petr' });
    fireEvent.click(screen.getByRole('link', { name: 'Vzít si / půjčit: Řečnický pult' }));
    const form = screen.getByTestId('loan-form');
    expect(form).toHaveTextContent('Nikomu nebude chybět.');
    expect(form).toHaveTextContent('příštích 7 dní');
    // a PM borrows only for themselves
    expect(within(form).queryByLabelText('Pro koho')).toBeNull();
    fill('Na co (nepovinné)', 'Schůzka s klientem');
    click('Vzít si');
    const l = state().loans.at(-1)!;
    expect(l).toMatchObject({
      itemId: 'lectern',
      borrowerId: 'u-petr',
      note: 'Schůzka s klientem',
      heldUntil: '2027-04-27',
    });
    expect(screen.queryByTestId('loan-form')).toBeNull();
    expect(screen.getByText('Kdo to má půjčené')).toBeInTheDocument();
    expect(screen.getByTestId(`loan-${l.id}`)).toHaveTextContent('bez data vrácení');
    page('u-petr', '/');
    expect(screen.getByText('Mám půjčeno')).toBeInTheDocument();
  });

  it('a collision lists the event, asks for a reason, tells the Chief, and the return clears it', () => {
    renderApp('/items/ledbeam150', { scenario: 'conflictChain', user: 'u-petr' });
    click('Vzít si / půjčit');
    fill('Od', '2027-06-07');
    fill('Vrátím do (nepovinné)', '2027-06-08');
    fill('Kolik kusů', '7');
    const hits = screen.getByTestId('loan-hits-order');
    expect(hits).toHaveTextContent('Koncert v parku Petr Dvořák, 07.–10.06.2027');
    expect(hits).toHaveTextContent('bude chybět 1× Robe LEDBeam 150 (07.06., 08.06.)');
    const go = screen.getByRole('button', { name: 'Přesto si vzít' });
    expect(go).toBeDisabled();
    fill('Proč si ji přesto berete (povinné)', 'Zkouška, vrátím hned');
    fireEvent.click(go);
    const loan = state().loans.at(-1)!;
    expect(loan).toMatchObject({ qty: 7, reason: 'Zkouška, vrátím hned' });
    const open = () =>
      state().conflicts.filter((c) => c.status !== 'resolved' && c.bookingId === CHAIN.a);
    expect(open()).toHaveLength(1);

    page('u-tomas', '/');
    expect(screen.getByTestId('conflict-records')).toHaveTextContent(
      'Půjčeno bez rezervace: Robe LEDBeam 150, 7 ks, Petr Dvořák, do 08.06.2027 (důvod: Zkouška, vrátím hned)',
    );
    page('u-tomas', `/bookings/${CHAIN.a}`);
    expect(screen.getByTestId('conflict-loans')).toHaveTextContent('7 ks, Petr Dvořák');
    // anyone can cancel a planned one
    page('u-lucie', '/loans');
    const row = within(screen.getByTestId(`loan-${loan.id}`));
    expect(row.queryByRole('button', { name: 'Vráceno' })).toBeNull();
    fireEvent.click(row.getByRole('button', { name: 'Zrušit výpůjčku' }));
    expect(open()).toHaveLength(0);
  });

  it('a pre-booking only informs', () => {
    renderApp('/items/ledbeam150', { scenario: 'conflictChain', user: 'u-petr' });
    click('Vzít si / půjčit');
    fill('Od', '2027-06-13');
    fill('Vrátím do (nepovinné)', '2027-06-13');
    fill('Kolik kusů', '12');
    expect(screen.getByTestId('loan-hits-prebooking')).toHaveTextContent('Firemní párty Horizont');
    expect(screen.queryByTestId('loan-hits-order')).toBeNull();
    expect(screen.getByRole('button', { name: 'Naplánovat výpůjčku' })).toBeEnabled();
  });

  it('too many pieces are refused; pieces in cases come from a named case', () => {
    renderApp('/items/ax1', { scenario: 'base', user: 'u-martin' });
    click('Vzít si / půjčit');
    const src = screen.getByLabelText('Odkud') as HTMLSelectElement;
    const firstCase = [...src.options].find((o) => /z casu/.test(o.text))!;
    fireEvent.change(src, { target: { value: firstCase.value } });
    fill('Kolik kusů', '99');
    expect(screen.getByRole('alert')).toHaveTextContent('Teď jde půjčit nejvýš');
    expect(screen.getByRole('button', { name: 'Vzít si' })).toBeDisabled();
    fill('Kolik kusů', '1');
    fill('Vrátím do (nepovinné)', '2027-04-20');
    fill('Pro koho', 'other');
    expect(screen.getByRole('button', { name: 'Vzít si' })).toBeDisabled();
    fill('Jméno', 'Divadlo Brod');
    click('Vzít si');
    const l = state().loans.at(-1)!;
    expect(l).toMatchObject({ borrowerName: 'Divadlo Brod', fromCaseId: firstCase.value });
    const theCase = () => state().cases.find((c) => c.id === firstCase.value)!;
    expect(isCaseComplete(state(), theCase())).toBe(false);
    fireEvent.click(
      within(screen.getByTestId(`loan-${l.id}`)).getByRole('button', { name: 'Vráceno' }),
    );
    expect(isCaseComplete(state(), theCase())).toBe(true);
  });
});

describe('Výpůjčky page', () => {
  it('shows overdue first, anyone returns and extends', () => {
    renderApp('/loans', { scenario: 'base', user: 'u-jana' });
    const rows = () => within(screen.getByTestId('loans')).getAllByTestId(/^loan-/);
    expect(rows()[0]).toHaveTextContent('po termínu, mělo se vrátit 16.04.2027');
    expect(rows().at(-1)).toHaveTextContent('Základní škola Brod');
    expect(rows().at(-1)).toHaveTextContent('zapsal(a) Karel Procházka');
    fireEvent.click(within(rows()[0]!).getByRole('button', { name: 'Prodloužit' }));
    fill('Vrátím do', '2027-04-30');
    click('Uložit');
    expect(rows()[0]).not.toHaveTextContent('po termínu');
    const count = rows().length;
    fireEvent.click(within(rows()[0]!).getByRole('button', { name: 'Vráceno' }));
    expect(rows()).toHaveLength(count - 1);
    click('Vrácené');
    expect(screen.getByTestId('loans')).toHaveTextContent('zapsal(a) Jana Nováková');
    click('Moje');
    expect(screen.getByText('Žádné výpůjčky.')).toBeInTheDocument();
  });

  it('the borrower is reminded of an overdue loan; the item calendar names the loan', () => {
    renderApp('/notifications', { scenario: 'base', user: 'u-lucie' });
    expect(screen.getByTestId('notifications')).toHaveTextContent(
      'Výpůjčka po termínu: 1× Monitor 24", Lucie Malá, mělo se vrátit 16.04.2027',
    );
    page('u-jana', '/items/walkie');
    fireEvent.click(screen.getByTestId('day-2027-04-21'));
    expect(screen.getByTestId('holder-loan')).toHaveTextContent('2 ks, Petr Dvořák, do 22.04.2027');
  });

  it('consumables offer no loan', () => {
    renderApp('/items/hazer-fluid', { scenario: 'base', user: 'u-petr' });
    expect(screen.queryByRole('button', { name: 'Vzít si / půjčit' })).toBeNull();
  });
});
