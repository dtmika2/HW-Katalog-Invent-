/** The organised list of a booking: nesting, groups, sorting and filtering. */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { addGroup, addLine, lineTree, moveToGroup, nestLine, type AppState } from '@quix/core';
import { lineName } from '../src/lib/names';
import { useProto } from '../src/store';
import { booking, renderApp, renderCurrent, state } from './helpers';

const ID = 'bk-teambuilding';
const open = (prepare?: (s: AppState) => AppState, user = 'u-petr', id = ID) =>
  renderApp(`/bookings/${id}`, { scenario: 'base', user, ...(prepare ? { prepare } : {}) });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const rows = () => within(screen.getByTestId('lines')).getAllByTestId(/^line-/);
const row = (name: string) =>
  rows().find((r) => r.getAttribute('data-line-name') === name) as HTMLElement;
const names = () =>
  rows().map(
    (r) => `${'>'.repeat(parseFloat(r.style.paddingLeft || '0') / 1.25)}${r.dataset.lineName}`,
  );
const tops = () => names().filter((n) => !n.startsWith('>'));
const addItem = (text: string) => {
  fireEvent.change(screen.getByLabelText('Hledat položku nebo case…'), { target: { value: text } });
  fireEvent.click(screen.getByRole('option', { name: text }));
};
/** Move with the "Přesunout…" menu. */
const move = (name: string, to: string) => {
  fireEvent.click(within(row(name)).getByRole('button', { name: 'Přesunout…' }));
  const select = screen.getByLabelText(`Přesunout: ${name}`) as HTMLSelectElement;
  const option = [...select.options].find((o) => o.text.trim() === to);
  if (!option) throw new Error(`${to} not in ${[...select.options].map((o) => o.text).join('|')}`);
  fireEvent.change(select, { target: { value: option.value } });
};
const PAR = 'LED PAR RGBW 18×10 W';
const K12 = 'QSC K12.2';

describe('nesting', () => {
  it('a candidate from "Máš aspoň jeden z těchto?" becomes a child and follows the count', () => {
    open();
    const check = screen
      .getAllByTestId('check-warning')
      .find((x) => x.textContent?.startsWith(PAR)) as HTMLElement;
    const button = within(check).getAllByRole('button')[0]!;
    const added = button.textContent!.replace(/^\+ \d+× /, '');
    fireEvent.click(button);
    const at = names().indexOf(`>${added}`);
    expect(at).toBeGreaterThan(names().indexOf(PAR));
    expect(row(added)).toHaveTextContent(`počet podle: ${PAR}`);
    const qty = () =>
      Number((within(row(added)).getByRole('spinbutton') as HTMLInputElement).value);
    const before = qty();
    change(`Počet ${PAR}`, '3');
    expect(qty()).toBe(before / 2);
    fireEvent.change(within(row(added)).getByRole('spinbutton'), { target: { value: '9' } });
    change(`Počet ${PAR}`, '6');
    expect(qty()).toBe(9);
    fireEvent.click(within(row(added)).getByRole('button', { name: `Počítat znovu podle ${PAR}` }));
    expect(qty()).toBe(before);
    click('Uložit');
    expect(booking(ID)!.lines.some((l) => l.followsCheck && l.nestedUnder)).toBe(true);
  });

  it('moves under another item and out again; never under its own child; price stays', () => {
    open();
    const price = screen.getByTestId('price-total').textContent;
    move(K12, `${PAR} ×6`);
    expect(tops()).toEqual([PAR]);
    expect(names()).toContain(`>${K12}`);
    fireEvent.click(within(row(PAR)).getByRole('button', { name: 'Přesunout…' }));
    const options = [...(screen.getByLabelText(`Přesunout: ${PAR}`) as HTMLSelectElement).options];
    expect(options.map((o) => o.text.trim())).not.toContain(`${K12} ×2`);
    click('Zrušit');
    move(K12, 'Vyjmout z nadřazené položky');
    expect(tops()).toEqual([K12, PAR]);
    expect(screen.getByTestId('price-total').textContent).toBe(price);
  });

  it('required items have no handle and no move menu, unless two items share them', () => {
    open();
    const clamp = row('Omega držák');
    expect(within(clamp).queryByTestId('drag-handle')).toBeNull();
    expect(within(clamp).queryByRole('button', { name: 'Přesunout…' })).toBeNull();
    expect(within(row(K12)).getByTestId('drag-handle')).toBeInTheDocument();
  });

  it('removing an item with nested ones asks; keep or remove everything', () => {
    const nested = () => {
      cleanup();
      open();
      move(K12, `${PAR} ×6`);
      fireEvent.click(within(row(PAR)).getByRole('button', { name: 'Odebrat' }));
      expect(screen.getByRole('alertdialog')).toHaveTextContent(
        `Pod položkou ${PAR} je ještě 1 položka.`,
      );
    };
    nested();
    click('Ponechat je na seznamu');
    expect(tops()).toEqual([K12]);
    nested();
    click('Odebrat i vše pod ní');
    expect(screen.getByText(/Zatím prázdné/)).toBeInTheDocument();
    cleanup();
    open();
    fireEvent.click(within(row(K12)).getByRole('button', { name: 'Odebrat' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(tops()).toEqual([PAR]);
  });
});

describe('groups', () => {
  const newGroup = (name: string) => {
    click('+ Nová skupina');
    change('Název skupiny', name);
    click('Přidat');
  };

  it('create, add into, move between, rename, reorder, collapse and delete', () => {
    open();
    newGroup('Zkouška zvuku');
    newGroup('Dekorace');
    move(K12, 'Zkouška zvuku');
    change(
      'Přidávat do',
      [...(screen.getByLabelText('Přidávat do') as HTMLSelectElement).options].find((o) =>
        /Dekorace/.test(o.text),
      )!.value,
    );
    addItem('Řečnický pult');
    const group = (name: string) =>
      screen.getByRole('heading', { name }).closest('section') as HTMLElement;
    expect(group('Zkouška zvuku')).toHaveTextContent(K12);
    expect(group('Dekorace')).toHaveTextContent('Řečnický pult');
    expect(group('Dekorace')).toHaveTextContent('1 položka, 500 Kč');
    expect(group('Bez skupiny')).toHaveTextContent(PAR);
    click('Uložit');
    expect(booking(ID)!.groups!.map((g) => g.name)).toEqual(['Zkouška zvuku', 'Dekorace']);

    click('Posunout nahoru: Dekorace');
    click('Přejmenovat: Dekorace');
    change('Název skupiny', 'Výzdoba');
    fireEvent.submit(screen.getByLabelText('Název skupiny').closest('form')!);
    click('Sbalit: Výzdoba');
    expect(group('Výzdoba')).not.toHaveTextContent('Řečnický pult');
    click('Rozbalit: Výzdoba');
    click('Smazat skupinu: Výzdoba');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Položky zůstanou na seznamu');
    click('Smazat skupinu');
    expect(group('Bez skupiny')).toHaveTextContent('Řečnický pult');
    click('Uložit');
    expect(booking(ID)!.groups!.map((g) => g.name)).toEqual(['Zkouška zvuku']);
  });

  it('are on the booking PDF with subtotals and on the packing list', () => {
    open(undefined, 'u-martin', 'bk-letni-noc');
    const paper = screen.getByTestId('booking-print');
    expect(paper).toHaveTextContent('LED stěna');
    expect(paper).toHaveTextContent('Bez skupiny');
    cleanup();
    renderCurrent('/packing/bk-letni-noc');
    const card = (name: string) =>
      screen.getAllByTestId(/^pack-/).find((c) => c.textContent?.startsWith(name))!;
    expect(card('d&b Y10P')).toHaveTextContent('skupina: Ozvučení');
    // required items follow the item that needs them
    expect(card('Half coupler clamp')).toHaveTextContent('skupina: Světla a rigging');
    expect(screen.queryByRole('heading', { name: 'Ozvučení' })).toBeNull();
    click('skupin');
    expect(screen.getByRole('heading', { name: 'Ozvučení' })).toBeInTheDocument();
    expect(card('d&b Y10P')).toHaveTextContent('police: Brod');
    expect(screen.getByTestId('packing-print')).toHaveTextContent('Světla a rigging');
    cleanup();
    // without groups there is nothing to switch
    renderCurrent('/packing/bk-firemni');
    expect(screen.queryByRole('group', { name: 'Seskupit podle' })).toBeNull();
  });
});

describe('sorting and filtering', () => {
  const list = (s: AppState): AppState => ({
    ...s,
    bookings: s.bookings.map((b) => {
      if (b.id !== ID) return b;
      let x = addLine(s, b, { itemId: 'tv-65' }, 1);
      x = addLine(s, x, { itemId: 'lectern' }, 1);
      const pult = x.lines.find((l) => 'itemId' in l.target && l.target.itemId === 'lectern')!;
      const tv = x.lines.find((l) => 'itemId' in l.target && l.target.itemId === 'tv-65')!;
      x = nestLine(s, x, pult.id, tv.id);
      const g = addGroup(x, 'Zvuk');
      const k12 = x.lines.find((l) => 'itemId' in l.target && l.target.itemId === 'qsc-k12')!;
      return moveToGroup(g.booking, k12.id, g.groupId);
    }),
  });
  const TV = 'TV 65" na stojanu';
  const inside = (id: string) =>
    within(screen.getByTestId(id))
      .getAllByTestId(/^line-/)
      .filter((r) => !parseFloat(r.style.paddingLeft || '0'))
      .map((r) => r.dataset.lineName);

  it('sorts inside groups without changing the booking', () => {
    open(list);
    const orderOf = (key: string) => {
      change('Seřadit podle', key);
      return inside('group-none');
    };
    expect(orderOf('own')).toEqual([PAR, TV]);
    expect(orderOf('name')).toEqual([PAR, TV]);
    expect(orderOf('price')).toEqual([TV, PAR]);
    expect(orderOf('qty')).toEqual([PAR, TV]);
    expect(orderOf('category')).toEqual([PAR, TV]);
    expect(orderOf('availability')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Uložit' })).toBeDisabled();
  });

  it('problems come first', () => {
    open((s) => ({
      ...s,
      bookings: s.bookings.map((b) => (b.id === ID ? addLine(s, b, { itemId: 'lectern' }, 50) : b)),
    }));
    expect(tops()[0]).not.toBe('Řečnický pult');
    change('Seřadit podle', 'availability');
    expect(tops()[0]).toBe('Řečnický pult');
  });

  it('a category shows its items with everything attached, or only the items', () => {
    open(list);
    const total = rows().length;
    const video = state().categories.find((c) => c.name === 'Video a projekce')!;
    change('Jen kategorie', video.id);
    expect(names()[0]).toBe(TV);
    // nested by hand and required, both from other categories
    expect(names()).toContain('>Řečnický pult');
    expect(names()).toContain('>HDMI kabel 10 m');
    expect(names()).not.toContain(PAR);
    expect(screen.getByTestId('shown-count')).toHaveTextContent(
      `Zobrazeno ${rows().length} z ${total}`,
    );
    const withAll = rows().length;
    fireEvent.click(screen.getByLabelText('Včetně všeho, co k tomu patří'));
    expect(rows().length).toBeLessThan(withAll);
    expect(names()).not.toContain('>Řečnický pult');
    expect(names()).toContain(TV);
    click('Zrušit filtr');
    expect(rows()).toHaveLength(total);
  });

  it('a nested item found on its own is shown at top level, in its group', () => {
    open(list);
    change('Hledat', 'recnicky');
    expect(names()).toEqual(['Řečnický pult']);
    change('Hledat', 'xyz');
    expect(screen.getByText(/Filtru nic neodpovídá/)).toBeInTheDocument();
  });

  it('never hides conflicts or changes the total, and adding lifts the filter', () => {
    open((s) => ({
      ...s,
      bookings: s.bookings.map((b) => (b.id === ID ? addLine(s, b, { itemId: 'lectern' }, 50) : b)),
    }));
    const price = screen.getByTestId('price-total').textContent;
    change('Hledat', 'qsc');
    expect(screen.getByTestId('conflict-panel')).toHaveTextContent('Řečnický pult');
    expect(screen.getByTestId('price-total').textContent).toBe(price);
    addItem('Vysílačka Motorola');
    expect(names()).toContain('Vysílačka Motorola');
    expect(screen.getByLabelText('Hledat')).toHaveValue('');
  });

  it('readers can sort and filter, but not organise', () => {
    open(list, 'u-martin');
    expect(screen.getByLabelText('Seřadit podle')).toBeInTheDocument();
    expect(screen.queryByTestId('drag-handle')).toBeNull();
    for (const n of ['+ Nová skupina', 'Přesunout…', 'Přejmenovat: Zvuk'])
      expect(screen.queryByRole('button', { name: n })).toBeNull();
    change('Hledat', 'qsc');
    expect(names()[0]).toBe(K12);
  });
});

describe('older saved bookings', () => {
  it('without groups look as before', () => {
    open();
    expect(screen.queryByRole('heading', { name: 'Bez skupiny' })).toBeNull();
    const b = booking(ID)!;
    expect(lineTree(b)).toHaveLength(1);
    expect(tops()).toEqual(lineTree(b)[0]!.roots.map((n) => lineName(state(), n.line)));
    expect(useProto.getState().toasts.filter((t) => t.kind === 'error')).toEqual([]);
  });
});
