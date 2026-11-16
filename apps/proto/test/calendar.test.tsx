/**
 * M4 acceptance: prototype 1B (availability calendar).
 */
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setLineQty, unwrap, saveBooking } from '@quix/core';
import { CHAIN } from '@quix/fixtures';
import { renderApp, state } from './helpers';

const cell = (d: string) => screen.getByTestId(`day-${d}`);
const freeText = (d: string) => within(cell(d)).getByText(/-?\d+ \/ \d+/).textContent;

describe('M4 availability calendar', () => {
  it('conflictChain: LEDBeam calendar (Brod) shows the exact free counts', () => {
    renderApp('/items/ledbeam150?month=2027-06-01', { scenario: 'conflictChain', user: 'u-tomas' });
    fireEvent.click(screen.getByRole('button', { name: 'Brod' }));
    const expected: [string, string][] = [
      ['2027-06-06', '16 / 16'],
      ['2027-06-07', '6 / 16'],
      ['2027-06-08', '6 / 16'],
      ['2027-06-09', '-2 / 16'],
      ['2027-06-10', '-2 / 16'],
      ['2027-06-11', '8 / 16'],
      ['2027-06-12', '8 / 16'],
      ['2027-06-13', '16 / 16'],
    ];
    for (const [d, t] of expected) expect(freeText(d), d).toBe(t);
    // both warehouses together add Karlák's 8
    fireEvent.click(screen.getByRole('button', { name: 'Oba sklady' }));
    expect(freeText('2027-06-10')).toBe('6 / 24');
  });

  it('clicking the worst day lists all three bookings with event, PM, dates and state', () => {
    renderApp('/items/ledbeam150?month=2027-06-01', { scenario: 'conflictChain', user: 'u-tomas' });
    fireEvent.click(cell('2027-06-10'));
    const holders = within(screen.getByTestId('day-detail'))
      .getAllByTestId('holder')
      .map((h) => h.textContent ?? '');
    expect(holders).toHaveLength(3);
    expect(holders.find((h) => h.includes('Koncert v parku'))).toMatch(
      /Petr Dvořák, 7\. 6\. 2027 – 10\. 6\. 2027.*10 ks.*Potvrzená/,
    );
    expect(holders.find((h) => h.includes('Módní přehlídka'))).toMatch(/Lucie Malá.*8 ks/);
    expect(holders.find((h) => h.includes('Firemní párty Horizont'))).toMatch(
      /Jana Nováková.*6 ks.*předrezervace.*Ke schválení/,
    );
  });

  it('a service case opened from the item page lowers the counts immediately and keeps blocking after its expected date', () => {
    renderApp('/items/ledbeam150?month=2027-06-01', { scenario: 'conflictChain', user: 'u-karel' });
    fireEvent.click(screen.getByRole('button', { name: 'Brod' }));
    expect(freeText('2027-06-13')).toBe('16 / 16');
    fireEvent.click(screen.getByRole('button', { name: 'Nahlásit závadu' }));
    fireEvent.change(screen.getByLabelText('Kolik kusů'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Co je špatně'), { target: { value: 'Nejde tilt' } });
    fireEvent.change(screen.getByLabelText('Očekávaný návrat'), {
      target: { value: '2027-05-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Poslat do servisu' }));
    // expected back on 1 May, but still blocking in June
    expect(freeText('2027-06-13')).toBe('14 / 16');
    expect(freeText('2027-06-07')).toBe('4 / 16');
    fireEvent.click(cell('2027-06-13'));
    expect(
      within(screen.getByTestId('day-detail')).getByTestId('holder-service'),
    ).toHaveTextContent('Servis: 2 ks, Nahlášeno');
  });

  it('editing a booking shows recomputed numbers in the calendar', () => {
    renderApp('/items/ledbeam150?month=2027-06-01', { scenario: 'conflictChain', user: 'u-tomas' });
    fireEvent.click(screen.getByRole('button', { name: 'Brod' }));
    expect(freeText('2027-06-08')).toBe('6 / 16');
    const tomas = state().users.find((u) => u.id === 'u-tomas')!;
    const a = state().bookings.find((b) => b.id === CHAIN.a)!;
    const line = a.lines.find((l) => l.origin === 'manual')!;
    const s2 = unwrap(
      saveBooking(state(), tomas, '2027-04-20', setLineQty(state(), a, line.id, 4)),
    );
    renderApp('/items/ledbeam150?month=2027-06-01', {
      scenario: 'conflictChain',
      user: 'u-tomas',
      prepare: () => s2,
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Brod' }).at(-1)!);
    expect(screen.getAllByTestId('day-2027-06-08').at(-1)).toHaveTextContent('12 / 16');
  });

  it('case type calendar shows complete cases free; event calendar lists bookings by state', () => {
    renderApp('/case-types/ct-ax9?month=2027-04-01', { scenario: 'galaDinner', user: 'u-tomas' });
    fireEvent.click(screen.getByRole('button', { name: 'Brod' }));
    expect(freeText('2027-04-24')).toBe('1 / 2');
    expect(screen.getByTestId('case-list')).toHaveTextContent('AX9-03');
    renderApp('/calendar', { scenario: 'galaDinner', user: 'u-tomas' });
    expect(screen.getAllByTestId('row-bk-firemni').length).toBeGreaterThan(0);
    fireEvent.change(screen.getAllByLabelText('PM').at(-1)!, { target: { value: 'u-lucie' } });
    expect(screen.queryAllByTestId('row-bk-firemni')).toHaveLength(0);
  });
});
