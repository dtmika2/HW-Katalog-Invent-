/** "Vysvětlivky": the legend of booking stages, reachable from every page. */
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CONFLICT_TIERS, FREE_STAGES, TRANSITIONS, type BookingStatus } from '@quix/core';
import { cs } from '../src/i18n/cs';
import { renderApp } from './helpers';

const open = (path = '/', user = 'u-petr') => {
  renderApp(path, { scenario: 'base', user });
  const button = screen.getByRole('button', { name: 'Vysvětlivky' });
  button.focus();
  fireEvent.click(button);
  return screen.getByRole('dialog', { name: 'Vysvětlivky: stavy rezervace' });
};

describe('Vysvětlivky', () => {
  it('lists every stage once, with its meaning, what comes next and what it holds', () => {
    const box = open();
    const all = Object.keys(cs.status) as BookingStatus[];
    expect(within(box).getAllByTestId(/^stage-(?!back|notes|tiers|cancel$)/)).toHaveLength(
      all.length,
    );
    for (const st of all) {
      const row = within(box).getByTestId(`stage-${st}`);
      expect(row).toHaveTextContent(cs.status[st]);
      expect(row).toHaveTextContent(cs.stages.info[st].means);
      expect(row).toHaveTextContent(`Co dál: ${cs.stages.info[st].next}`);
      expect(row).toHaveTextContent(`Drží techniku: ${cs.stages.info[st].holds}`);
    }
  });

  it('shows the ways back and the notes that are no stages', () => {
    const box = within(open());
    expect(box.getByTestId('stage-back')).toHaveTextContent(
      'Zrušit balení, pokud ještě nic neodjelo',
    );
    expect(box.getByTestId('stage-back')).toHaveTextContent('sklad ho může o zrušení požádat');
    expect(box.getByTestId('stage-notes')).toHaveTextContent('část odvezena, zbývá N ks');
    expect(box.getByTestId('stage-notes')).toHaveTextContent('Akce je zrušená, čeká na vybalení');
  });

  it('agrees with the rules: ways back, taking back, cancelling', () => {
    const ways = cs.stages.back.map((x) => [x.from, x.to]);
    expect(ways).toContainEqual([TRANSITIONS.returnToPm.from, [TRANSITIONS.returnToPm.to]]);
    expect(ways).toContainEqual([TRANSITIONS.reopen.from, [...FREE_STAGES]]);
    expect(ways).toContainEqual([TRANSITIONS.reopen.from, ['submitted']]);
    const [direct, packed, never] = cs.stages.cancelWays.map((x) => x.from);
    expect([...direct!, ...packed!]).toEqual(TRANSITIONS.cancel.from);
    for (const st of never!) expect(TRANSITIONS.cancel.from).not.toContain(st);
  });

  it('the usual way starts with the reservation of a date; visibility and tiers are explained', () => {
    const box = within(open());
    const flow = within(box.getByTestId('help-flow'))
      .getAllByRole('listitem')
      .map((x) => x.textContent?.replace('→', ''));
    expect(flow.slice(0, 5)).toEqual(
      [...FREE_STAGES, 'submitted' as const, 'confirmed' as const].map((x) => cs.status[x]),
    );
    expect(box.getByText(/administrátor, sklad ne/)).toBeInTheDocument();
    const tiers = box.getByTestId('stage-tiers');
    for (const t of CONFLICT_TIERS) expect(tiers).toHaveTextContent(cs.tiers.name[t]);
    expect(tiers).toHaveTextContent('Ve stejné dny, technika zatím neznámá');
  });

  it('closes with the button, Escape and a click beside it, and gives the focus back', () => {
    const closed = () => expect(screen.queryByTestId('stage-help')).toBeNull();
    const button = () => screen.getByRole('button', { name: 'Vysvětlivky' });
    const box = open();
    expect(within(box).getByRole('button', { name: 'Zavřít' })).toHaveFocus();
    fireEvent.click(within(box).getByRole('button', { name: 'Zavřít' }));
    closed();
    expect(button()).toHaveFocus();
    fireEvent.click(button());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    closed();
    fireEvent.click(button());
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.getByTestId('stage-help')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    closed();
  });

  it('keeps unsaved edits of the page underneath', () => {
    renderApp('/bookings/bk-teambuilding', { scenario: 'base', user: 'u-petr' });
    fireEvent.change(screen.getByLabelText('Název akce'), { target: { value: 'Rozepsané' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vysvětlivky' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zavřít' }));
    expect(screen.getByLabelText('Název akce')).toHaveValue('Rozepsané');
    expect(screen.getByRole('button', { name: 'Uložit' })).toBeEnabled();
  });

  it('every role has it', () => {
    for (const u of ['u-tomas', 'u-martin', 'u-admin']) {
      const { unmount } = renderApp('/', { scenario: 'base', user: u });
      expect(screen.getByRole('button', { name: 'Vysvětlivky' })).toBeInTheDocument();
      unmount();
    }
  });
});
