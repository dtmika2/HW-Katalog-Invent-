/** Pending issues explain themselves: what happened, where, who reported it, what it blocks. */
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, state } from './helpers';

const brodSm58 = () =>
  state().stock.find((x) => x.itemId === 'sm58' && x.warehouseId === 'wh-brod')!.qty;

describe('pending issues', () => {
  it('the Chief dashboard entry shows item, count, order, reporter, note and what it blocks', () => {
    renderApp('/', { scenario: 'base', user: 'u-tomas' });
    const list = screen.getByTestId('issues');
    expect(list).toHaveTextContent('Chybí1× Shure SM58');
    expect(list).toHaveTextContent('Vrátilo se 5 z 6 ks.');
    expect(list).toHaveTextContent('„Jeden SM58 se po akci nenašel“');
    expect(list).toHaveTextContent('Pivovar Lednice – den otevřených dveří');
    expect(list).toHaveTextContent('PM Jana Nováková');
    const issue = state().issues.find((i) => i.itemId === 'sm58')!;
    const reporter = state().users.find((u) => u.id === issue.reportedBy)!.name;
    expect(list).toHaveTextContent(`Nahlášeno: ${reporter}`);
    expect(list).toHaveTextContent('Do vyřešení nejde rezervovat: 1 ks, sklad Brod.');
    expect(within(list).queryByRole('link', { name: 'Otevřít vratku' })).toBeNull();
  });

  it('the resolve form says what each choice does to the stock', () => {
    renderApp('/', { scenario: 'base', user: 'u-tomas' });
    const list = screen.getByTestId('issues');
    fireEvent.click(within(list).getByRole('button', { name: 'Vyřešit' }));
    expect(list).toHaveTextContent('Kusy půjdou znovu rezervovat, počet skladem se nezmění.');
    fireEvent.change(within(list).getByLabelText('Jak to dopadlo'), {
      target: { value: 'written_off' },
    });
    expect(list).toHaveTextContent('Počet skladem se trvale sníží o 1 ks.');
    const before = brodSm58();
    fireEvent.change(within(list).getByLabelText('Poznámka'), { target: { value: 'Ztracen' } });
    fireEvent.click(within(list).getByRole('button', { name: 'Uložit' }));
    expect(brodSm58()).toBe(before - 1);
    expect(screen.queryByTestId('issues')).toBeNull();
  });

  it('the booking page explains its own open issue to the PM, without a Resolve button', () => {
    renderApp('/bookings/bk-lednice-dod', { scenario: 'base', user: 'u-jana' });
    const section = screen.getByText('Nevyřešené problémy z této akce').closest('section')!;
    expect(section).toHaveTextContent('„Jeden SM58 se po akci nenašel“');
    expect(within(section).queryByRole('button', { name: 'Vyřešit' })).toBeNull();
  });

  it('the warehouse gets a link to the vratka where a found piece is recorded', () => {
    renderApp('/', { scenario: 'base', user: 'u-martin' });
    const link = within(screen.getByTestId('issues')).getByRole('link', {
      name: 'Otevřít vratku',
    });
    expect(link.getAttribute('href')).toBe('/vratka/bk-lednice-dod');
  });

  it('bookings without an open issue have no issues panel', () => {
    renderApp('/bookings/bk-firemni', { scenario: 'base', user: 'u-jana' });
    expect(screen.queryByText('Nevyřešené problémy z této akce')).toBeNull();
  });
});
