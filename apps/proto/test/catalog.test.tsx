/**
 * M5a catalogue editor — acceptance tests.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import * as XLSX from 'xlsx';
import { usedBy } from '@quix/core';
import { describe, expect, it } from 'vitest';
import { cs } from '../src/i18n/cs';
import { renderApp, state } from './helpers';

const item = (id: string) => state().items.find((i) => i.id === id);

describe('M5a catalogue editor', () => {
  it('table view: inline edit saves, invalid values are rejected, completeness filter', () => {
    renderApp('/catalog', { scenario: 'base', user: 'u-tomas' });
    fireEvent.click(screen.getByRole('tab', { name: 'Tabulka' }));
    const price = screen.getByLabelText('Cena / den: MDG ATMe hazer');
    fireEvent.change(price, { target: { value: '1500' } });
    fireEvent.blur(price);
    expect(item('hazer')?.priceDay).toBe(1500);
    const price2 = screen.getByLabelText('Cena / den: MDG ATMe hazer');
    fireEvent.change(price2, { target: { value: '-5' } });
    fireEvent.blur(price2);
    expect(item('hazer')?.priceDay).toBe(1500);
    expect(screen.getByLabelText('Cena / den: MDG ATMe hazer')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(cs.catalogEditor.invalid);
    // "potřebuje doplnit": the presenter has no price and no connections
    fireEvent.click(screen.getByLabelText('Potřebuje doplnit'));
    expect(within(screen.getByTestId('row-presenter')).getByText('1/4')).toBeInTheDocument();
  });

  it('connection builder adds a connection, shows it in "used by" and in the try-it preview', () => {
    renderApp('/items/hazer', { scenario: 'base', user: 'u-tomas' });
    fireEvent.change(screen.getByLabelText('Na co'), { target: { value: 'přejezd' } });
    fireEvent.click(screen.getByRole('option', { name: /Kabelový přejezd 1 m/ }));
    fireEvent.change(screen.getByLabelText('Kolik'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Přidat propojení' }));
    expect(
      within(screen.getByTestId('connection-list')).getByText(/Kabelový přejezd 1 m/),
    ).toBeInTheDocument();
    expect(
      state().connections.some(
        (c) =>
          c.fromItemId === 'hazer' &&
          'itemId' in c.target &&
          c.target.itemId === 'cable-ramp' &&
          c.qty === 2,
      ),
    ).toBe(true);
    // try-it on the item page defaults to "<name> ×10"
    expect(screen.getByTestId('try-result')).toHaveTextContent('20× Kabelový přejezd 1 m');
    // reverse view on the accessory
    expect(usedBy(state(), { itemId: 'cable-ramp' }).map((c) => c.fromItemId)).toContain('hazer');
  });

  it('try-it: "LEDBeam ×10" shows the expanded list', () => {
    renderApp('/catalog', { scenario: 'base', user: 'u-petr' });
    fireEvent.click(screen.getByRole('tab', { name: 'Vyzkoušet' }));
    fireEvent.change(screen.getByLabelText('Vyzkoušet propojení'), {
      target: { value: 'LEDBeam ×10' },
    });
    const r = screen.getByTestId('try-result');
    expect(r).toHaveTextContent('10× Robe LEDBeam 150 přidá:');
    expect(r).toHaveTextContent('10× Half coupler clamp');
    expect(r).toHaveTextContent('2× DMX splitter 8×');
    expect(r).toHaveTextContent('1× IEC napájecí kabel pultu');
  });

  it('Excel import: valid rows imported, invalid rows reported by row and field', async () => {
    renderApp('/catalog', { scenario: 'base', user: 'u-tomas' });
    fireEvent.click(screen.getByRole('tab', { name: 'Import a export' }));
    const H = cs.catalogEditor.headers;
    const ws = XLSX.utils.aoa_to_sheet([
      H,
      ['Look Unique 2.1', 'Look Solutions', 'Unique 2.1', 'Efekty', 900, 2, 0, 'ano', 12, ''],
      ['', 'X', 'Y', 'Efekty', 100, 1, 0, 'ano', '', ''],
      ['Sada LED pásků', 'X', 'Y', 'Neexistuje', 100, 1, 0, 'ano', '', ''],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Katalog');
    const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const file = new File([data], 'katalog.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    fireEvent.change(screen.getByLabelText('Nahrát vyplněný soubor'), {
      target: { files: [file] },
    });
    await waitFor(() => expect(screen.getByTestId('import-errors')).toBeInTheDocument());
    const errs = screen.getByTestId('import-errors');
    expect(errs).toHaveTextContent('Řádek 3: Název — chybí');
    expect(errs).toHaveTextContent('Řádek 4: Kategorie — neznámá hodnota');
    const created = state().items.find((i) => i.name === 'Look Unique 2.1');
    expect(created).toMatchObject({ manufacturer: 'Look Solutions', priceDay: 900, weightKg: 12 });
    expect(state().stock.find((s) => s.itemId === created?.id)?.qty).toBe(2);
  });

  it('archive instead of delete: the item disappears from browsing but stays in data', () => {
    renderApp('/items/presenter', { scenario: 'base', user: 'u-tomas' });
    fireEvent.click(screen.getByRole('button', { name: 'Archivovat' }));
    expect(item('presenter')?.archived).toBe(true);
    renderApp('/catalog', {
      scenario: 'base',
      user: 'u-tomas',
      prepare: (s) => ({
        ...s,
        items: s.items.map((i) => (i.id === 'presenter' ? { ...i, archived: true } : i)),
      }),
    });
    fireEvent.change(screen.getAllByLabelText('Hledat v katalogu…').at(-1)!, {
      target: { value: 'Prezentér' },
    });
    expect(screen.queryAllByRole('link', { name: 'Prezentér Logitech' })).toHaveLength(0);
  });
});
