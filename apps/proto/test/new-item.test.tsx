/** "Nová položka": an item with its stock and all its connections in one step. */
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { cs } from '../src/i18n/cs';
import { useProto } from '../src/store';
import { renderApp, state } from './helpers';

const t = cs.catalogEditor.newItemPage;

const addConnection = (search: string, option: RegExp, qty?: number) => {
  fireEvent.change(screen.getByLabelText('Na co'), { target: { value: search } });
  fireEvent.click(screen.getByRole('option', { name: option }));
  if (qty) fireEvent.change(screen.getByLabelText('Kolik'), { target: { value: String(qty) } });
  fireEvent.click(screen.getByRole('button', { name: 'Přidat propojení' }));
};

beforeEach(() => useProto.setState({ toasts: [] }));

describe('Nová položka', () => {
  it('the catalogue header opens the new item page for catalogue editors only', () => {
    const chief = renderApp('/catalog', { scenario: 'base', user: 'u-tomas' });
    expect(screen.getByRole('link', { name: cs.catalogEditor.newItem })).toHaveAttribute(
      'href',
      '/items/new',
    );
    chief.unmount();
    renderApp('/catalog', { scenario: 'base', user: 'u-petr' });
    expect(screen.queryByRole('link', { name: cs.catalogEditor.newItem })).not.toBeInTheDocument();
  });

  it('saves the item with its stock and all its connections, nothing before that', () => {
    renderApp('/items/new', { scenario: 'base', user: 'u-tomas' });
    const before = state();
    fireEvent.change(screen.getByLabelText(cs.catalogEditor.col.name), {
      target: { value: 'Mlhostroj Testovací' },
    });
    fireEvent.change(screen.getByLabelText(t.price), { target: { value: '700' } });
    fireEvent.change(screen.getByLabelText(`Brod — ${cs.catalogEditor.stockQty}`), {
      target: { value: '3' },
    });
    addConnection('přejezd', /Kabelový přejezd 1 m/, 2);
    addConnection('PowerCON TRUE1 kabel 5', /PowerCON TRUE1 kabel 5 m/, 1);
    expect(screen.getByTestId('new-connection-list').children).toHaveLength(2);
    // the preview shows what the engine adds, but the store is untouched
    expect(screen.getByTestId('new-item-preview')).toHaveTextContent('2× Kabelový přejezd 1 m');
    expect(state()).toBe(before);

    fireEvent.click(screen.getByRole('button', { name: t.save }));
    const created = state().items.find((i) => i.name === 'Mlhostroj Testovací');
    expect(created).toMatchObject({ priceDay: 700, returnable: true });
    const id = created!.id;
    expect(
      state()
        .stock.filter((x) => x.itemId === id)
        .map((x) => x.qty),
    ).toEqual([3]);
    expect(
      state()
        .connections.filter((c) => c.fromItemId === id)
        .map((c) => ('itemId' in c.target ? [c.target.itemId, c.qty] : [])),
    ).toEqual([
      ['cable-ramp', 2],
      ['powercon-5', 1],
    ]);
    // lands on the new item's page with the connections listed
    expect(
      within(screen.getByTestId('connection-list')).getByText(/Kabelový přejezd 1 m/),
    ).toBeInTheDocument();
  });

  it('a removed connection is not saved; an invalid item saves nothing and says why', () => {
    renderApp('/items/new', { scenario: 'base', user: 'u-tomas' });
    addConnection('přejezd', /Kabelový přejezd 1 m/);
    fireEvent.click(
      within(screen.getByTestId('new-connection-list')).getByRole('button', {
        name: cs.catalogEditor.builderRemove,
      }),
    );
    expect(screen.queryByTestId('new-connection-list')).not.toBeInTheDocument();
    const before = state();
    fireEvent.change(screen.getByLabelText(cs.catalogEditor.col.name), {
      target: { value: 'Levná věc' },
    });
    fireEvent.change(screen.getByLabelText(t.price), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    expect(screen.getAllByRole('alert').some((a) => a.textContent === t.fieldError.priceDay)).toBe(
      true,
    );
    expect(state()).toBe(before);
  });
});

describe('booking editor panel colours', () => {
  it('each window on the booking page has its own tint', () => {
    renderApp('/bookings/bk-teambuilding', { scenario: 'base', user: 'u-petr' });
    const tone = (title: string) =>
      screen
        .getByRole('heading', { name: title })
        .closest('[data-tone]')
        ?.getAttribute('data-tone');
    expect(tone(cs.editor.addTitle)).toBe('white');
    expect(tone(cs.editor.linesTitle)).toBe('green');
    expect(tone(cs.attachments.title)).toBe('gray');
    expect(tone(cs.thread.title)).toBe('red');
    expect(screen.getByLabelText(cs.newBooking.stage).closest('[data-tone]')).toHaveAttribute(
      'data-tone',
      'blue',
    );
  });
});
