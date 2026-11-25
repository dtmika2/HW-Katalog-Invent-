/** "Přibrat na poslední chvíli": from the booking, packing and shipping to the vratka. */
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { addLateItem, bookingPriceTotal, looseHere, unwrap, type AppState } from '@quix/core';
import { booking, renderApp, renderCurrent, state } from './helpers';

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const pickItem = (text: string) => {
  click('Přibrat na poslední chvíli');
  change('Hledat položku…', text);
  fireEvent.click(within(screen.getByTestId('late-form')).getAllByRole('listitem')[0]!.firstChild!);
};
const firstWith = (s: AppState, status: string) => s.bookings.find((b) => b.status === status)!;

describe('last-minute item', () => {
  it('the warehouse takes a spare, it is marked and expected on the vratka', () => {
    const first = renderApp('/', { scenario: 'base', user: 'u-martin' });
    const b = firstWith(state(), 'shipped');
    const price = bookingPriceTotal(state(), b);
    first.unmount();
    const page = renderCurrent(`/shipping/${b.id}`);
    pickItem('sm58');
    change('Poznámka (nepovinné)', 'Náhradní mikrofon');
    click(/Vzít na akci|Přesto vzít/);
    const line = booking(b.id)!.lines.find((l) => l.late)!;
    expect(line).toMatchObject({ qty: 1, late: { by: 'u-martin', note: 'Náhradní mikrofon' } });
    expect(booking(b.id)?.status).toBe('shipped');
    expect(bookingPriceTotal(state(), booking(b.id)!)).toBe(price);
    expect(screen.getByTestId('batches')).toHaveTextContent('Na poslední chvíli');
    page.unmount();
    const vratka = renderCurrent(`/vratka/${b.id}`);
    expect(screen.getByTestId(`ret-${line.id}`)).toHaveTextContent('Navíc');
    vratka.unmount();
    renderCurrent(`/bookings/${b.id}`);
    const row = screen.getByTestId(`line-${line.id}`);
    expect(row).toHaveTextContent(/Navíc.*Přibral\(a\) Martin.*Náhradní mikrofon.*neúčtuje se/);
    expect(
      screen.getByText(/Přibráno na poslední chvíli: 1× .*Náhradní mikrofon/),
    ).toBeInTheDocument();
  });

  it('more than is here cannot be taken', () => {
    const first = renderApp('/', { scenario: 'base', user: 'u-martin' });
    const b = firstWith(state(), 'packing');
    first.unmount();
    renderCurrent(`/packing/${b.id}`);
    pickItem('hazer');
    change('Kolik kusů', '99');
    expect(screen.getByRole('alert')).toHaveTextContent(/Teď (jde vzít nejvýš|tu není)/);
    expect(screen.getByRole('button', { name: 'Vzít na akci' })).toBeDisabled();
  });

  it('offered to the PM of the event, the Chief and the warehouse, in the right states', () => {
    const first = renderApp('/', { scenario: 'base', user: 'u-tomas' });
    const shipped = firstWith(state(), 'shipped');
    const confirmed = firstWith(state(), 'confirmed');
    const other = state().users.find((u) => u.role === 'pm' && u.id !== shipped.pmId)!;
    first.unmount();
    const has = (id: string, user: string) => {
      const page = renderApp(`/bookings/${id}`, { scenario: 'base', user });
      const r = !!screen.queryByRole('button', { name: 'Přibrat na poslední chvíli' });
      page.unmount();
      return r;
    };
    expect(
      [shipped.pmId, 'u-tomas', 'u-martin', other.id, 'u-admin'].map((u) => has(shipped.id, u)),
    ).toEqual([true, true, true, false, false]);
    expect(has(confirmed.id, 'u-martin')).toBe(false);
  }, 20_000);

  it('the Chief cannot change it in the list; the PDF for the client names it only when charged', () => {
    const first = renderApp('/', { scenario: 'base', user: 'u-tomas' });
    const s = state();
    const b = firstWith(s, 'packing');
    first.unmount();
    const item = s.items.find(
      (i) =>
        i.returnable &&
        looseHere(s, i.id, 'wh-brod', '2027-04-20') > 2 &&
        !b.lines.some((l) => 'itemId' in l.target && l.target.itemId === i.id) &&
        !s.caseTypes.some((c) => c.contents.some((x) => x.itemId === i.id)),
    )!;
    const taken = (charged: boolean) =>
      unwrap(
        addLateItem(
          s,
          s.users.find((u) => u.id === 'u-martin')!,
          '2027-04-20',
          b.id,
          {
            itemId: item.id,
            warehouseId: 'wh-brod',
            qty: 1,
            label: 'Na poslední chvíli',
            reason: 'x',
            charged,
          },
        ),
      );
    for (const charged of [false, true]) {
      const next = taken(charged);
      const line = next.bookings.find((x) => x.id === b.id)!.lines.find((l) => l.late)!;
      const page = renderApp(`/bookings/${b.id}`, {
        scenario: 'base',
        user: 'u-tomas',
        prepare: () => next,
      });
      const row = within(screen.getByTestId(`line-${line.id}`));
      expect(row.getByRole('spinbutton')).toBeDisabled();
      expect(row.queryByRole('button', { name: 'Odebrat' })).toBeNull();
      const paper = screen.getByTestId('booking-print');
      expect(paper.textContent?.includes(item.name)).toBe(charged);
      fireEvent.click(screen.getByLabelText('S interními údaji'));
      expect(paper).toHaveTextContent(`${item.name} (navíc)`);
      page.unmount();
    }
  });
});
