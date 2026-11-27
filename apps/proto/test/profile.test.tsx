/** Gamification in the app: the profile (G5). */
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeBooking, computeLedger, levelFor, RULE_IDS, totalPoints } from '@quix/core';
import { titleOf } from '../src/lib/gamification';
import { useProto } from '../src/store';
import { renderApp, renderCurrent, state } from './helpers';

const MARTIN = 'u-martin';

/** Martin closes the returned order "Benefice Dobrý start": +3 for closing it. */
function closeBenefice() {
  const user = state().users.find((u) => u.id === MARTIN)!;
  act(() => {
    useProto
      .getState()
      .run((st) => closeBooking(st, user, useProto.getState().today, 'bk-benefice'));
  });
}

const total = (userId: string) => totalPoints(computeLedger(state()), userId);

afterEach(() => vi.useRealTimers());

describe('profile (G5)', () => {
  const showAll = () => {
    for (let b = screen.queryByRole('button', { name: 'Zobrazit další' }); b;) {
      fireEvent.click(b);
      b = screen.queryByRole('button', { name: 'Zobrazit další' });
    }
  };

  it('shows the level, title and totals of the person', () => {
    renderApp('/profil', { scenario: 'base', user: MARTIN });
    const head = screen.getByTestId('profile-level');
    expect(head).toHaveTextContent('Martin Svoboda');
    expect(head).toHaveTextContent(titleOf(levelFor(total(MARTIN))));
    expect(head).toHaveTextContent(`Celkem ${total(MARTIN)} XP`);
  });

  it('"Proč mám body" explains every point: the rows add up to the total', () => {
    renderApp('/profil', { scenario: 'base', user: MARTIN });
    showAll();
    const pts = screen
      .getAllByTestId('history-points')
      .map((el) => Number(el.textContent?.replace('+', '')));
    expect(pts.reduce((n, x) => n + x, 0)).toBe(total(MARTIN));
  });

  it('identical entries of one day are one row ("Case zkontrolován 4×")', () => {
    renderApp('/profil', { scenario: 'base', user: MARTIN });
    expect(screen.getAllByText(/Case zkontrolován \d+×/).length).toBeGreaterThan(0);
  });

  it('opening the profile marks what is new and clears the +N on the meter', () => {
    renderApp('/', { scenario: 'base', user: MARTIN });
    closeBenefice();
    expect(screen.getByTestId('xp-pending')).toBeInTheDocument();
    renderCurrent('/profil');
    const rows = screen.getAllByTestId('history-row');
    const fresh = rows.filter((r) => within(r).queryByText('nové'));
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toHaveTextContent('Uzavřená zakázka – Benefice Dobrý start');
    expect(screen.queryAllByTestId('xp-pending')).toHaveLength(0);
  });

  it('earned badges are shown with their date; badges not started are folded away', () => {
    renderApp('/profil', { scenario: 'base', user: MARTIN });
    expect(screen.getByTestId('badge-first.packing')).toHaveTextContent(
      /Získáno \d\d\.\d\d\.\d{4}/,
    );
    const more = screen.getByTestId('more-badges');
    expect(within(more).getByTestId('badge-first.request')).toBeInTheDocument();
  });

  it('activity by period: this month and everything', () => {
    renderApp('/profil', { scenario: 'base', user: MARTIN });
    expect(screen.getByTestId('activity')).toHaveTextContent('Vratky');
    fireEvent.change(screen.getByLabelText('Období'), { target: { value: 'all' } });
    expect(screen.getByTestId('activity')).toHaveTextContent(/\d+ vrat(ka|ky|ek)/);
    expect(screen.getByTestId('month-bars')).toBeInTheDocument();
  });

  it('the overview for management covers the chosen period', () => {
    renderApp('/profil', { scenario: 'base', user: MARTIN });
    const from = screen.getByLabelText('Od');
    fireEvent.change(from, { target: { value: '01.03.2027' } });
    fireEvent.blur(from);
    const paper = screen.getByTestId('overview-paper');
    expect(paper).toHaveTextContent('Období 01.03.–20.04.2027');
    expect(paper).toHaveTextContent(`Body za období: ${total(MARTIN)} XP`);
    expect(paper).toHaveTextContent(
      'Body ukazují práci zaznamenanou v systému, ne veškerou práci.',
    );
    fireEvent.change(from, { target: { value: '01.04.2027' } });
    fireEvent.blur(from);
    expect(screen.getByTestId('overview-paper')).not.toHaveTextContent(
      `Body za období: ${total(MARTIN)} XP`,
    );
  });

  it('"Jak se počítají body" explains every rule', () => {
    renderApp('/profil', { scenario: 'base', user: MARTIN });
    const how = screen.getByTestId('how-points');
    for (const r of RULE_IDS) expect(how.querySelector(`[data-rule="${r}"]`)).not.toBeNull();
  });
});
