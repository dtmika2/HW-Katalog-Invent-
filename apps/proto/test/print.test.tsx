/** Paper versions of vratka and of the booking. */
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bookingPriceTotal, returnSheet, type AppState } from '@quix/core';
import { CHAIN, GALA_ID, GALA_STEPS } from '@quix/fixtures';
import { booking, renderApp, state } from './helpers';

const submitted = (s: AppState) => GALA_STEPS.submit(GALA_STEPS.create(s));
const confirmed = (s: AppState) => GALA_STEPS.confirm(submitted(s));
const shipped = (s: AppState) => GALA_STEPS.ship(confirmed(s));
const printTitle = () => {
  globalThis.dispatchEvent(new Event('beforeprint'));
  const t = document.title;
  globalThis.dispatchEvent(new Event('afterprint'));
  return t;
};

afterEach(() => vi.unstubAllGlobals());

describe('vratka sheet', () => {
  const open = (prepare: (s: AppState) => AppState, user = 'u-martin') =>
    renderApp(`/vratka/${GALA_ID}`, { scenario: 'galaDinner', user, prepare });

  it('lists what left: case numbers with contents, externals with supplier, no consumables', () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    open(shipped);
    fireEvent.click(screen.getByRole('button', { name: 'Tisk / uložit PDF' }));
    expect(print).toHaveBeenCalledOnce();
    const paper = screen.getByTestId('vratka-print');
    expect(paper).toHaveTextContent('Vratka do skladu Brod');
    expect(paper).toHaveTextContent('Odvezeno: Dodávka 1 (20.04.2027), Dodávka 2 (20.04.2027)');
    expect(paper).toHaveTextContent('case č. AX9-02');
    expect(within(paper).getAllByText('Astera AX9 PowerPAR').length).toBeGreaterThan(0);
    expect(paper).toHaveTextContent('Astera Rent CZ, vrátit do 25.04.2027');
    for (const l of returnSheet(state(), GALA_ID)) {
      if (l.consumable) expect(within(paper).queryByText(l.name)).toBeNull();
      else expect(paper).toHaveTextContent(l.name);
    }
    expect(paper).toHaveTextContent('Čísla zapište do aplikace');
    expect(printTitle()).toBe('Vratka – Gala Dinner');
  });

  it('after a first vratka only the rest is listed, the settled lines are summarised', () => {
    open((s) => GALA_STEPS.vratka(shipped(s)));
    const paper = screen.getByTestId('vratka-print');
    expect(paper).toHaveTextContent('Vyřízené řádky');
    expect(paper).toHaveTextContent('IEC napájecí kabel pultu');
    expect(paper).not.toHaveTextContent('case č. AX9-02');
  });

  it('nothing shipped, nothing to print', () => {
    open(confirmed);
    expect(screen.queryByRole('button', { name: 'Tisk / uložit PDF' })).toBeNull();
  });
});

describe('booking sheet', () => {
  const options = () => within(screen.getByTestId('print-options'));
  const paper = () => screen.getByTestId('booking-print');

  it('a PM prints the pre-booking with client, gear and indicative price', () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    renderApp(`/bookings/${GALA_ID}`, {
      scenario: 'galaDinner',
      user: 'u-petr',
      prepare: submitted,
    });
    fireEvent.click(options().getByRole('button', { name: 'Tisk / uložit PDF' }));
    expect(print).toHaveBeenCalledOnce();
    expect(paper()).toHaveTextContent('Předrezervace');
    expect(paper()).toHaveTextContent('Klient: Hotel Grand Praha, Ing. Pavel Beneš');
    expect(paper()).toHaveTextContent('Akce: 24.04.2027 (technika 23.–25.04.2027)');
    const total = bookingPriceTotal(state(), booking(GALA_ID)!).toLocaleString('cs-CZ');
    expect(paper().textContent).toContain(`${total} Kč`);
    expect(paper()).toHaveTextContent('Nejde o závaznou nabídku.');
    expect(printTitle()).toBe('Předrezervace – Gala Dinner');
  });

  it('prices can be left out', () => {
    renderApp(`/bookings/${GALA_ID}`, {
      scenario: 'galaDinner',
      user: 'u-petr',
      prepare: submitted,
    });
    fireEvent.click(options().getByLabelText('S cenami'));
    expect(paper()).not.toHaveTextContent('Kč');
    expect(paper()).toHaveTextContent('AX9 case');
  });

  it('internal details are off by default; on, they show shortages, reasons and signatures', () => {
    renderApp(`/bookings/${CHAIN.b}`, { scenario: 'conflictChain', user: 'u-tomas' });
    for (const secret of ['Chybí', 'Koncert v parku', 'Schválil', 'Zdroj', 'Interní'])
      expect(paper()).not.toHaveTextContent(secret);
    fireEvent.click(options().getByLabelText('S interními údaji'));
    expect(paper()).toHaveTextContent('Chybí 2 ks (09.06., 10.06.), drží: Koncert v parku');
    expect(paper()).toHaveTextContent(
      'Schváleno přes konflikt: Koncert v parku vrátí 2 kusy dřív, domluveno s Petrem',
    );
    expect(paper()).toHaveTextContent('Zdroj: Brod');
    expect(paper()).toHaveTextContent('Schválil (šéf techniky)');
    expect(paper()).toHaveTextContent('Objednávka');
  });

  it('unsaved changes have to be saved first', () => {
    renderApp('/bookings/bk-teambuilding', { scenario: 'base', user: 'u-petr' });
    fireEvent.change(screen.getByLabelText('Název akce'), { target: { value: 'Jinak' } });
    expect(options().getByRole('button')).toBeDisabled();
    expect(options().getByText('Nejdřív uložte změny.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Uložit' }));
    expect(options().getByRole('button')).toBeEnabled();
  });

  it('the warehouse can print a finished booking too', () => {
    renderApp('/bookings/bk-ples', { scenario: 'base', user: 'u-martin' });
    expect(options().getByRole('button')).toBeEnabled();
    expect(paper()).toHaveTextContent('Uzavřeno');
  });
});
