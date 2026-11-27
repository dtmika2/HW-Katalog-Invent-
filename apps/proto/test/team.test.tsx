/** Gamification in the app: the team page, colleague profiles and the off switch (G6). */
import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeBooking } from '@quix/core';
import { useProto } from '../src/store';
import { useGamificationStore } from '../src/store/gamification';
import { renderApp, renderCurrent, state } from './helpers';

const MARTIN = 'u-martin';

// the store outlives a test: start each one with nobody switched off and nothing shown
beforeEach(() => {
  globalThis.localStorage.clear();
  useGamificationStore.setState({ prefs: { v: 1, users: {} } });
});

function closeBenefice() {
  const user = state().users.find((u) => u.id === MARTIN)!;
  act(() => {
    useProto
      .getState()
      .run((st) => closeBooking(st, user, useProto.getState().today, 'bk-benefice'));
  });
}

const cards = () => screen.getAllByTestId(/^team-card-/);
const names = () => cards().map((c) => c.querySelector('p')?.firstChild?.textContent?.trim());

describe('team page (G6)', () => {
  it('the Chief sees everyone sorted by name, with the work of the last three months', () => {
    renderApp('/tym', { scenario: 'base', user: 'u-tomas' });
    const shown = names();
    expect(shown).toEqual([...shown].sort((a, b) => a!.localeCompare(b!, 'cs')));
    expect(shown).toContain('Martin Svoboda');
    const martin = screen.getByTestId('team-card-u-martin');
    expect(within(martin).getByTestId('team-work')).toHaveTextContent(/\d+ vrat(ka|ky|ek)/);
    expect(within(martin).getByRole('link', { name: 'Celý profil' })).toHaveAttribute(
      'href',
      '/profil/u-martin',
    );
  });

  it('no ranking: nothing on the page numbers or orders people by points', () => {
    renderApp('/tym', { scenario: 'base', user: 'u-tomas' });
    expect(screen.getByTestId('team')).not.toHaveTextContent(/\b(1\.|#1|pořadí:)/);
    expect(screen.getByText(/nejde o pořadí/)).toBeInTheDocument();
  });

  it('colleagues see levels and badges, not the work', () => {
    renderApp('/tym', { scenario: 'base', user: 'u-petr' });
    expect(screen.queryAllByTestId('team-work')).toHaveLength(0);
    expect(
      within(screen.getByTestId('team-card-u-martin')).getByText(/Odznaky: \d+/),
    ).toBeInTheDocument();
  });
});

describe('profiles of others (G6)', () => {
  it('a colleague’s profile shows level, title and badges only', () => {
    renderApp('/profil/u-martin', { scenario: 'base', user: 'u-petr' });
    expect(screen.getByTestId('profile-level')).toHaveTextContent('Martin Svoboda');
    expect(screen.getByTestId('profile-level')).not.toHaveTextContent(/Celkem \d+ XP/);
    expect(screen.getByTestId('badge-first.packing')).toBeInTheDocument();
    expect(screen.queryByText('Proč mám body')).toBeNull();
    expect(screen.queryByText('Přehled pro vedení')).toBeNull();
    expect(screen.queryByText('Zobrazovat úrovně a body')).toBeNull();
  });

  it('the Chief sees an employee’s whole profile, without touching their "new" marks', () => {
    renderApp('/', { scenario: 'base', user: MARTIN });
    closeBenefice();
    const before = useGamificationStore.getState().prefs.users[MARTIN]!.viewed.length;
    act(() => useProto.getState().setUser('u-tomas'));
    renderCurrent('/profil/u-martin');
    expect(screen.getAllByText('Proč mám body').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Přehled pro vedení').length).toBeGreaterThan(0);
    expect(useGamificationStore.getState().prefs.users[MARTIN]!.viewed).toHaveLength(before);
  });
});

describe('off switch (G6)', () => {
  const toggle = () =>
    fireEvent.click(screen.getByRole('checkbox', { name: /Zobrazovat úrovně a body/ }));

  it('off hides the meter; colleagues no longer see the profile, the Chief still does', () => {
    renderApp('/profil', { scenario: 'base', user: MARTIN });
    toggle();
    expect(screen.queryByTestId('xp')).toBeNull();
    act(() => useProto.getState().setUser('u-petr'));
    renderCurrent('/profil/u-martin');
    expect(screen.getAllByText('Tento profil se nezobrazuje.').length).toBeGreaterThan(0);
    renderCurrent('/tym');
    expect(
      within(screen.getAllByTestId('team-card-u-martin').at(-1)!).getByText(
        'Úroveň a odznaky nezobrazuje.',
      ),
    ).toBeInTheDocument();
    act(() => useProto.getState().setUser('u-tomas'));
    renderCurrent('/profil/u-martin');
    expect(screen.getAllByText('Proč mám body').length).toBeGreaterThan(0);
  });

  it('points keep counting while off; switching on again announces nothing old', () => {
    renderApp('/profil', { scenario: 'base', user: MARTIN });
    toggle();
    closeBenefice();
    toggle();
    expect(screen.getByTestId('xp-line')).toBeEmptyDOMElement();
    expect(screen.queryByTestId('xp-pending')).toBeNull();
  });

  it('the switch survives new demo data', () => {
    renderApp('/profil', { scenario: 'base', user: MARTIN });
    toggle();
    act(() => useProto.getState().loadScenario('base'));
    expect(useGamificationStore.getState().prefs.off?.[MARTIN]).toBe(true);
  });
});
