/** Gamification in the app: the profile (G5). */
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeBooking,
  computeLedger,
  levelFor,
  levelTier,
  RULE_IDS,
  totalPoints,
} from '@quix/core';
import { titleOf } from '../src/lib/gamification';
import { useProto } from '../src/store';
import { useGamificationStore } from '../src/store/gamification';
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
// the store outlives a test: nothing shown, nobody switched off, no title form chosen
beforeEach(() => {
  globalThis.localStorage.clear();
  useGamificationStore.setState({ prefs: { v: 1, users: {} } });
});

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

describe('titles', () => {
  it('every title shows the rank and its step, so the order is clear, plus a name up to level 49', () => {
    const names = Array.from({ length: 49 }, (_, i) => titleOf(levelTier(i + 1)));
    expect(new Set(names).size).toBe(49);
    expect(names.every((n) => / [IVX]+ – \S/.test(n))).toBe(true);
    expect(titleOf(levelTier(1))).toBe('Učeň I – prodlužek');
    expect(titleOf(levelTier(15))).toBe('Rytíř I – kabelů');
    expect(titleOf(levelTier(16))).toBe('Rytíř II – trussů');
    expect(titleOf(levelTier(16), 'f')).toBe('Rytířka II – trussů');
    expect(titleOf(levelTier(50))).toBe('Legenda XI');
  });

  it('the form can be changed back and forth at any time', () => {
    renderApp('/profil', { scenario: 'base', user: MARTIN });
    const level = levelFor(total(MARTIN));
    fireEvent.click(screen.getByRole('radio', { name: titleOf(level, 'f') }));
    expect(screen.getByTestId('xp-title')).toHaveTextContent(titleOf(level, 'f'));
    fireEvent.click(screen.getByRole('radio', { name: titleOf(level, 'm') }));
    expect(screen.getByTestId('xp-title')).toHaveTextContent(titleOf(level, 'm'));
  });

  it('badges never deplete: the count keeps growing, only the next target moves up', () => {
    // Martin has 17 checked cases: bronze needs 25, so the card shows 17 / 25 …
    renderApp('/profil', { scenario: 'base', user: MARTIN });
    expect(screen.getByTestId('badge-completeCases')).toHaveTextContent('17 / 25');
    cleanup();
    // … and with 30, bronze is earned and the bar continues from 30 towards silver, not from 0.
    renderApp('/profil', {
      scenario: 'base',
      user: MARTIN,
      prepare: (s) => ({
        ...s,
        packings: [
          ...s.packings,
          {
            id: 'pk-extra',
            bookingId: 'bk-benefice',
            on: '2027-04-19',
            userId: MARTIN,
            lines: Array.from({ length: 13 }, (_, i) => ({
              lineId: `l-extra-${i}`,
              qty: 1,
              caseIds: [`case-extra-${i}`],
              caseChecks: [{ caseId: `case-extra-${i}`, counts: [] }],
            })),
          },
        ],
      }),
    });
    const card = screen.getByTestId('badge-completeCases');
    expect(card).toHaveAttribute('data-earned', '1');
    expect(card).toHaveTextContent('30 / 150');
  });

  it('the form of the title is the person’s choice and shows everywhere', () => {
    renderApp('/profil', { scenario: 'base', user: MARTIN });
    const level = levelFor(total(MARTIN));
    const female = titleOf(level, 'f');
    fireEvent.click(screen.getByRole('radio', { name: female }));
    expect(screen.getByTestId('xp-title')).toHaveTextContent(female);
    expect(screen.getByTestId('profile-level')).toHaveTextContent(female);
    act(() => useProto.getState().setUser('u-tomas'));
    renderCurrent('/tym');
    expect(screen.getAllByTestId('team-card-u-martin').at(-1)).toHaveTextContent(female);
  });
});
