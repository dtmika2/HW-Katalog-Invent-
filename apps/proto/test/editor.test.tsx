/**
 * M3 acceptance: prototype 1A (pre-booking / order editor).
 */
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  addLine,
  bookingHolds,
  createBooking,
  periodWithBuffer,
  saveBooking,
  setLineQty,
  unwrap,
  type AppState,
} from '@quix/core';
import { CHAIN, GALA_ID, GALA_STEPS, BREAKING } from '@quix/fixtures';
import { booking, renderApp, state } from './helpers';

const lineByName = (name: string) => {
  const el = screen.getAllByTestId(/^line-/).find((e) => e.getAttribute('data-line-name') === name);
  if (!el) throw new Error(`line ${name} not found`);
  return el;
};

function addItem(query: string, optionName: string | RegExp, qty = 1) {
  fireEvent.change(screen.getByLabelText('Počet'), { target: { value: String(qty) } });
  fireEvent.change(screen.getByLabelText('Hledat položku nebo case…'), {
    target: { value: query },
  });
  fireEvent.click(screen.getByRole('option', { name: optionName }));
}

describe('M3 order editor', () => {
  it('1. Petr creates the Gala Dinner pre-booking: accessories nested, PowerCON check, AX9 case short with conflict panel', () => {
    renderApp('/bookings/new', { scenario: 'galaDinner', user: 'u-petr' });
    fireEvent.change(screen.getByLabelText('Název akce'), { target: { value: 'Gala Dinner' } });
    fireEvent.change(screen.getByLabelText('Akce od'), { target: { value: '2027-04-24' } });
    fireEvent.change(screen.getByLabelText('Akce do'), { target: { value: '2027-04-24' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vytvořit předrezervaci' }));

    addItem('AX9 case', /AX9 case \(8×\)/, 2);
    addItem('dLive S5000', 'Allen & Heath dLive S5000');
    addItem('Stagebox', /Stagebox case/);

    // Required accessories appear nested under the desk with the "auto" tag
    for (const name of [
      'IEC napájecí kabel pultu',
      'CAT6 kabel 50 m (buben)',
      'Ubiquiti router ER-X',
    ]) {
      const row = lineByName(name);
      expect(within(row).getByText('auto')).toBeInTheDocument();
      expect(within(row).getByText(/pro: Allen & Heath dLive S5000 ×1/)).toBeInTheDocument();
    }
    // Check for PowerCON cables
    const checks = screen.getAllByTestId('check-warning').map((e) => e.textContent ?? '');
    expect(checks.some((t) => t.includes('PowerCON'))).toBe(true);
    // AX9 case line is red: short 1 case
    const ax9 = lineByName('AX9 case (8×)');
    expect(within(ax9).getByTestId('badge')).toHaveTextContent('Chybí 1 case');
    // Conflict panel names Firemní den, PM Jana Nováková and its dates
    const panel = screen.getByTestId('conflict-panel');
    const colliding = within(panel)
      .getAllByTestId('colliding')
      .map((e) => e.textContent ?? '');
    expect(colliding).toEqual([
      expect.stringContaining('Firemní den — Jana Nováková, 23. 4. 2027–25. 4. 2027'),
    ]);
  });

  it('2. submit is disabled until the conflict is acknowledged', () => {
    renderApp(`/bookings/${GALA_ID}`, {
      scenario: 'galaDinner',
      user: 'u-petr',
      prepare: GALA_STEPS.create,
    });
    const submit = screen.getByRole('button', { name: 'Odeslat ke schválení' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Viděl(a) jsem konflikt'));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(booking(GALA_ID)?.status).toBe('submitted');
  });

  it('3. Tomáš covers 8× AX9 externally and confirms: the order is a hard hold', () => {
    renderApp(`/bookings/${GALA_ID}`, {
      scenario: 'galaDinner',
      user: 'u-tomas',
      prepare: (s) => GALA_STEPS.submit(GALA_STEPS.create(s)),
    });
    const confirm = screen.getByRole('button', { name: 'Potvrdit objednávku' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Pokrýt externím pronájmem' }));
    fireEvent.change(screen.getByLabelText('Dodavatel'), { target: { value: 'Astera Rent CZ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Přidat externí řádek' }));
    expect(screen.queryByTestId('conflict-panel')).not.toBeInTheDocument();
    expect(lineByName('Astera AX9 PowerPAR')).toHaveTextContent('externě od Astera Rent CZ');
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    const b = booking(GALA_ID);
    expect(b).toMatchObject({ type: 'order', status: 'confirmed' });
    const holds = bookingHolds(state(), b!);
    expect(holds.length).toBeGreaterThan(0);
    expect(holds.every((h) => h.kind === 'hard')).toBe(true);
    expect(holds.find((h) => h.res === 'item:ax9')?.qty).toBe(8);
  });

  it('4. Jana confirms her own booking with an override → "Nový" conflict on the Chief dashboard, Petr notified', () => {
    renderApp(`/bookings/${CHAIN.c}`, { scenario: 'conflictChain', user: 'u-jana' });
    const confirm = screen.getByRole('button', { name: 'Potvrdit objednávku' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Potvrdit i přesto — důvod'), {
      target: { value: 'Klient trvá na termínu, řešíme s Petrem' },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(booking(CHAIN.c)?.status).toBe('confirmed');
    const rec = state().conflicts.find((c) => c.bookingId === CHAIN.c);
    expect(rec).toMatchObject({ status: 'new', source: 'override' });
    expect(
      state().notifications.some(
        (n) => n.userId === 'u-petr' && n.type === 'conflict_overridden' && n.bookingId === CHAIN.c,
      ),
    ).toBe(true);

    // Chief dashboard
    fireEvent.change(screen.getByLabelText('Přihlášen jako'), { target: { value: 'u-tomas' } });
    fireEvent.click(screen.getByRole('link', { name: 'Přehled' }));
    const list = screen.getByTestId('conflict-records');
    const item = within(list)
      .getByText(/Firemní párty Horizont: chybí/)
      .closest('li')!;
    expect(item).toHaveTextContent('Nový');
  });

  it('5. Lucie (no permission) has no Confirm button', () => {
    renderApp(`/bookings/${BREAKING.y}`, { scenario: 'caseBreaking', user: 'u-lucie' });
    expect(screen.getByRole('button', { name: 'Odeslat ke schválení' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Potvrdit objednávku' })).not.toBeInTheDocument();
  });

  it('loose pieces that would split a case booked whole show "Rozdělí obsah casu"', () => {
    renderApp(`/bookings/${BREAKING.y}`, { scenario: 'caseBreaking', user: 'u-lucie' });
    expect(screen.getByTestId('lines')).toHaveTextContent('Rozdělí obsah casu: AX1 case (8×)');
  });

  it('6. LEDBeam 10 → 4 recalculates clamps and splitters live and keeps an overridden rope count', () => {
    const prepare = (s0: AppState): AppState => {
      const petr = s0.users.find((u) => u.id === 'u-petr')!;
      const r = unwrap(
        createBooking(s0, petr, '2027-04-20', {
          id: 'bk-t6',
          eventName: 'Test LEDBeam',
          periods: [periodWithBuffer('2027-05-03', '2027-05-03', s0.settings)],
        }),
      );
      let b = r.state.bookings.find((x) => x.id === 'bk-t6')!;
      b = addLine(r.state, b, { itemId: 'ledbeam150' }, 10);
      b = setLineQty(r.state, b, 'auto:item:safety', 12);
      return unwrap(saveBooking(r.state, petr, '2027-04-20', b));
    };
    renderApp('/bookings/bk-t6', { scenario: 'base', user: 'u-petr', prepare });
    const qty = (name: string) =>
      (within(lineByName(name)).getByRole('spinbutton') as HTMLInputElement).value;
    expect(qty('Half coupler clamp')).toBe('10');
    expect(qty('DMX splitter 8×')).toBe('2');
    expect(qty('Bezpečnostní lanko')).toBe('12');
    fireEvent.change(within(lineByName('Robe LEDBeam 150')).getByRole('spinbutton'), {
      target: { value: '4' },
    });
    expect(qty('Half coupler clamp')).toBe('4');
    expect(qty('DMX splitter 8×')).toBe('1');
    expect(qty('Bezpečnostní lanko')).toBe('12');
    expect(lineByName('Bezpečnostní lanko')).toHaveTextContent('ručně upraveno (vypočteno 4)');
  });
});
