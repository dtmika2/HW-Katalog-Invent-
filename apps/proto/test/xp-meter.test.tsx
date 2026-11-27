/** Gamification in the app: the XP meter and the line where new points appear (G4). */
import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeBooking, computeLedger, levelFor, totalPoints } from '@quix/core';
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

describe('XP meter (G4)', () => {
  it('shows the title and level of the current user', () => {
    renderApp('/', { scenario: 'base', user: MARTIN });
    const expected = titleOf(levelFor(total(MARTIN)));
    expect(screen.getByTestId('xp-title')).toHaveTextContent(expected);
    expect(within(screen.getByTestId('xp')).getByRole('progressbar')).toBeInTheDocument();
  });

  it('the first view announces nothing: the history so far is not "new"', () => {
    renderApp('/', { scenario: 'base', user: MARTIN });
    expect(screen.getByTestId('xp-line')).toBeEmptyDOMElement();
    expect(screen.queryByTestId('xp-pending')).toBeNull();
  });

  it('new points appear next to the meter with the reason, and nowhere else', () => {
    renderApp('/', { scenario: 'base', user: MARTIN });
    closeBenefice();
    const line = screen.getByTestId('xp-line');
    expect(line).toHaveTextContent('+3 · Uzavřená zakázka – Benefice Dobrý start');
    expect(screen.getByTestId('xp-pending')).toHaveTextContent('+3');
    const meter = screen.getByTestId('xp');
    for (const el of screen.getAllByText(/Uzavřená zakázka/)) expect(meter).toContainElement(el);
  });

  it('the points line fades after a few seconds; the +N stays until the profile is opened', () => {
    vi.useFakeTimers();
    renderApp('/', { scenario: 'base', user: MARTIN });
    closeBenefice();
    expect(screen.getByTestId('xp-line')).not.toBeEmptyDOMElement();
    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(screen.getByTestId('xp-line')).toBeEmptyDOMElement();
    expect(screen.getByTestId('xp-pending')).toHaveTextContent('+3');
  });

  it('switching user does not announce the other person’s history', () => {
    renderApp('/', { scenario: 'base', user: MARTIN });
    act(() => useProto.getState().setUser('u-lucie'));
    expect(screen.getByTestId('xp-title')).toHaveTextContent(titleOf(levelFor(total('u-lucie'))));
    expect(screen.getByTestId('xp-line')).toBeEmptyDOMElement();
  });

  it('each point is announced once: going to another page does not repeat it', () => {
    renderApp('/', { scenario: 'base', user: MARTIN });
    closeBenefice();
    screen.getByTestId('xp-line');
    renderCurrent('/bookings');
    const lines = screen.getAllByTestId('xp-line');
    expect(lines.at(-1)).toBeEmptyDOMElement();
  });
});
