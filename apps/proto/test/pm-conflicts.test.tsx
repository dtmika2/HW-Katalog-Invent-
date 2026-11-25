/** PMs solving conflicts: rental, proposal and its acceptance, an approved order. */
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { confirmBooking, setOverrideReason, unwrap, type AppState } from '@quix/core';
import { CHAIN } from '@quix/fixtures';
import { booking, renderApp, state } from './helpers';

const ID = CHAIN.c;
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const panel = () => within(screen.getByTestId('conflict-panel'));
/** Lucie has no permission to approve. */
const lucies = (s: AppState): AppState => ({
  ...s,
  bookings: s.bookings.map((b) => (b.id === ID ? { ...b, pmId: 'u-lucie' } : b)),
});
const open = (user: string, prepare: (s: AppState) => AppState = lucies) =>
  renderApp(`/bookings/${ID}`, { scenario: 'conflictChain', user, prepare });
const rent = () => {
  fireEvent.click(panel().getAllByRole('button', { name: 'Pokrýt externím pronájmem' })[0]!);
  fireEvent.change(screen.getByLabelText('Dodavatel'), { target: { value: 'Kamarádi AV' } });
  click('Přidat externí řádek');
};

describe('PM and a real conflict', () => {
  it('rents from a friendly company like the Chief', () => {
    open('u-lucie');
    rent();
    click('Uložit');
    expect(
      booking(ID)?.lines.some(
        (l) => 'external' in l.target && l.target.external.supplier === 'Kamarádi AV',
      ),
    ).toBe(true);
  });

  it('proposes going over it; the Chief accepts before approving', () => {
    const pm = open('u-lucie');
    const label = 'Navrhnout schválení i přesto — důvod';
    expect(panel().queryByLabelText('Schválit i přesto — důvod')).toBeNull();
    for (const x of panel().getAllByLabelText(label))
      fireEvent.change(x, { target: { value: 'Půjčí nám je kolega' } });
    expect(panel().getAllByText('Návrh čeká na šéfa techniky.').length).toBeGreaterThan(0);
    click('Uložit');
    pm.unmount();
    const proposed = state();
    open('u-tomas', () => proposed);
    const approve = () => screen.getByRole('button', { name: 'Schválit objednávku' });
    expect(approve()).toBeDisabled();
    expect(screen.getByText(/PM navrhuje schválit i přes konflikt/)).toBeInTheDocument();
    for (const x of panel().getAllByLabelText(/^Přijímám návrh, který napsal\(a\) Lucie/))
      fireEvent.click(x);
    expect(approve()).toBeEnabled();
    fireEvent.click(approve());
    expect(booking(ID)?.status).toBe('confirmed');
    expect(state().conflicts.find((c) => c.bookingId === ID)).toMatchObject({
      proposedBy: 'u-lucie',
      acceptedBy: 'u-tomas',
      overrideReason: 'Půjčí nám je kolega',
    });
  });

  it('solves it on their own approved order, the rest stays locked', () => {
    const approved = (s: AppState): AppState => {
      const tomas = s.users.find((u) => u.id === 'u-tomas')!;
      const x = lucies(s);
      const b = x.bookings.find((y) => y.id === ID)!;
      const withReasons = b.lines.reduce((acc, l) => setOverrideReason(acc, l.id, 'ok'), b);
      return unwrap(
        confirmBooking(
          { ...x, bookings: x.bookings.map((y) => (y.id === ID ? withReasons : y)) },
          tomas,
          '2027-04-20',
          ID,
        ),
      );
    };
    open('u-lucie', approved);
    expect(screen.getByLabelText('Název akce')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Uložit' })).toBeNull();
    rent();
    expect(screen.getByText(/Konflikt vyřešen: .*externě od Kamarádi AV/)).toBeInTheDocument();
    expect(
      state().notifications.some((n) => n.type === 'shortage_solved' && n.userId === 'u-martin'),
    ).toBe(true);
    const after = state();
    // another PM sees the conflict but no way to solve it
    renderApp(`/bookings/${ID}`, {
      scenario: 'conflictChain',
      user: 'u-petr',
      prepare: () => after,
    });
    expect(screen.queryAllByLabelText('Dodavatel')).toEqual([]);
  });

  it('another PM and the warehouse get no actions', () => {
    for (const user of ['u-petr', 'u-martin']) {
      const page = open(user);
      expect(panel().queryByRole('button')).toBeNull();
      expect(panel().queryByRole('textbox')).toBeNull();
      page.unmount();
    }
  });
});
