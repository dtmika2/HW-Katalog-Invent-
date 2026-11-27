/** "Spočítat pódium" on a booking and "Díl pódia" in the catalogue. */
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { itemTotals } from '@quix/core';
import { booking, renderApp, state } from './helpers';

const ID = 'bk-teambuilding';
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const size = (value: string) =>
  fireEvent.change(screen.getByLabelText('Rozměr pódia v metrech (šířka × hloubka)'), {
    target: { value },
  });
const needs = () =>
  screen.getAllByTestId('stage-need').map((r) => {
    const [name, qty] = within(r).getAllByRole('cell');
    return `${name!.textContent} ${qty!.textContent}`;
  });
const open = () => {
  renderApp(`/bookings/${ID}`, { scenario: 'base', user: 'u-petr' });
  click('Spočítat pódium');
};

describe('Kalkulačka pódia', () => {
  it('6*4: twelve decks with their legs, skirt and stairs; added as a group and saved', () => {
    open();
    size('6*4');
    expect(screen.getByText('Přesně 6 × 4 m, 12 dílců.')).toBeInTheDocument();
    expect(needs()).toEqual([
      'Pódiový dílec 2×1 m 12',
      'Noha pódia 40 cm' + 'přijdou s dílci 48',
      'Sukně pódia 2 m 7',
      'Schody k pódiu 1',
    ]);
    expect(screen.getByRole('img', { name: /Rozložení dílců/ })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Zábradlí (zadní strana a boky)'));
    fireEvent.change(screen.getByLabelText('Výška (nohy)'), {
      target: { value: 'stage-leg-80' },
    });
    expect(needs()).toContain('Zábradlí pódia 2 m 7');
    click('Přidat do rezervace');
    expect(screen.queryByTestId('stage-planner')).toBeNull();
    click('Uložit');
    const b = booking(ID)!;
    expect(b.groups?.map((g) => g.name)).toContain('Pódium 6 × 4 m');
    const t = itemTotals(b.lines, state());
    expect([t.get('stage-deck'), t.get('stage-leg-80'), t.get('stage-leg-40')]).toEqual([
      12,
      48,
      undefined,
    ]);
    expect([t.get('stage-skirt'), t.get('stage-rail'), t.get('stage-stairs')]).toEqual([7, 7, 1]);
  });

  it('a size that is not whole decks: bigger or smaller; a bad size says how to write it', () => {
    open();
    size('6');
    expect(screen.getByText(/v metrech, např\. 6\*4/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Přidat do rezervace' })).toBeDisabled();
    size('3 x 3');
    expect(screen.getByLabelText('Větší: 4 × 3 m (6 dílců)')).toBeChecked();
    fireEvent.click(screen.getByLabelText(/^Menší: .* \(3 dílce\)$/));
    expect(needs()[0]).toBe('Pódiový dílec 2×1 m 3');
  });

  it('more than is free: what is missing, and the biggest stage that is free', () => {
    open();
    size('20*10');
    const deck = screen.getAllByTestId('stage-need')[0]!;
    expect(within(deck).getByText(/^Chybí \d+ ks$/)).toBeInTheDocument();
    expect(screen.getByText(/Z volných kusů jde postavit nejvýš/)).toBeInTheDocument();
    click('Použít tento rozměr');
    expect(within(screen.getAllByTestId('stage-need')[0]!).getByText('Stačí')).toBeInTheDocument();
  });

  it('the catalogue says what is a stage part: the drum riser marked as a 2×2 m deck', () => {
    renderApp('/items/riser', { scenario: 'base', user: 'u-tomas' });
    fireEvent.change(screen.getByLabelText('Druh', { selector: '#sp-kind' }), {
      target: { value: 'deck' },
    });
    fireEvent.change(screen.getByLabelText('Šířka (m)'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Hloubka (m)'), { target: { value: '2' } });
    fireEvent.submit(screen.getByLabelText('Druh', { selector: '#sp-kind' }).closest('form')!);
    expect(state().items.find((i) => i.id === 'riser')?.stage).toEqual({
      part: 'deck',
      widthMm: 2000,
      depthMm: 2000,
    });
    fireEvent.change(screen.getByLabelText('Druh', { selector: '#sp-kind' }), {
      target: { value: '' },
    });
    fireEvent.submit(screen.getByLabelText('Druh', { selector: '#sp-kind' }).closest('form')!);
    expect(state().items.find((i) => i.id === 'riser')).not.toHaveProperty('stage');
  });
});
