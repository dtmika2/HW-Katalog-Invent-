/** Packing and shipping as two steps, and promised gear. */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppState } from '@quix/core';
import { CHAIN, GALA_ID, GALA_STEPS } from '@quix/fixtures';
import { useProto } from '../src/store';
import { booking, renderApp, renderCurrent, state } from './helpers';

const confirmed = (s: AppState) => GALA_STEPS.confirm(GALA_STEPS.submit(GALA_STEPS.create(s)));
const page = (user: string, path: string) => {
  cleanup();
  useProto.getState().setUser(user);
  renderCurrent(path);
};
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const cards = () => screen.getAllByTestId(/^pack-/);
const card = (name: string) => cards().find((c) => c.textContent?.startsWith(name)) as HTMLElement;
const shipments = (id: string) => state().shipments.filter((x) => x.bookingId === id);
const events = (id: string) =>
  state()
    .messages.filter((m) => m.bookingId === id && m.event)
    .map((m) => m.event!.type);

/** Gala Dinner, packing started, on the packing screen as Martin. */
function openGala() {
  renderApp(`/packing/${GALA_ID}`, {
    scenario: 'galaDinner',
    user: 'u-martin',
    prepare: confirmed,
  });
  click('Začít balit');
}
/** Tick every own line (cases with all their checks) and pack. */
function packOwn() {
  for (const c of cards()) {
    if (
      c.textContent?.includes('Astera Rent') ||
      within(c).queryByRole('button', { name: /Přijede až/ })
    )
      continue;
    fireEvent.click(within(c).getAllByRole('checkbox')[0]!);
  }
  for (const box of screen.queryAllByTestId(/^check-/))
    for (const x of within(box).getAllByRole('checkbox')) fireEvent.click(x);
  click(/^Zabalit zatržené/);
}

describe('packing is not shipping', () => {
  it('packed gear stays in the warehouse, shows who packed it, and can be unpacked', () => {
    openGala();
    const c = card('Allen & Heath') ?? cards()[0]!;
    const name = c.querySelector('.font-cond')!.textContent!;
    fireEvent.click(within(c).getAllByRole('checkbox')[0]!);
    for (const box of screen.queryAllByTestId(/^check-/))
      for (const x of within(box).getAllByRole('checkbox')) fireEvent.click(x);
    click('Zabalit zatržené (1)');
    expect(shipments(GALA_ID)).toEqual([]);
    expect(booking(GALA_ID)!.status).toBe('packing');
    expect(card(name)).toHaveTextContent(/zabaleno 1 \(Martin Svoboda, 20\.04\.2027\)/);
    fireEvent.click(within(card(name)).getByRole('button', { name: /^Vybalit/ }));
    expect(state().packings.filter((p) => p.bookingId === GALA_ID)).toEqual([]);
  });

  it('whole flow: rental left for the shipping, van leaves without it, it comes later', () => {
    openGala();
    // only promised gear may be left
    expect(screen.getAllByRole('button', { name: /Přijede až při odvozu/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Přijede až při odvozu \(8\)/ }));
    packOwn();
    expect(booking(GALA_ID)!.status).toBe('packed');
    expect(screen.getByText('Vše je zabaleno a čeká na odvoz.')).toBeInTheDocument();

    page('u-petr', '/notifications');
    expect(screen.getByTestId('notifications')).toHaveTextContent(
      'Gala Dinner: zabaleno, připraveno k odvozu (při odvozu přijede: 8× Astera AX9 PowerPAR (Astera Rent CZ))',
    );

    page('u-martin', `/shipping/${GALA_ID}`);
    const packed = within(screen.getByTestId('packed'));
    for (const x of packed.getAllByRole('checkbox')) expect(x).toBeChecked();
    const promised = within(screen.getByTestId('promised'));
    expect(promised.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByTestId('promised')).toHaveTextContent(
      'externě od Astera Rent CZ, vyzvednout 23.04.2027',
    );
    click(/^Odvézt \(\d+ ks\)/);
    const form = within(screen.getByTestId('ship-confirm'));
    expect(screen.getByTestId('ship-confirm')).toHaveTextContent(
      'Dodávka odjede bez přislíbeného:8× Astera AX9 PowerPAR (Astera Rent CZ)',
    );
    fireEvent.change(form.getByLabelText('Poznámka do rezervace (nepovinné)'), {
      target: { value: 'Astera dorazí rovnou na místo' },
    });
    fireEvent.click(form.getByRole('button', { name: /Potvrdit odvoz/ }));
    expect(shipments(GALA_ID)).toHaveLength(1);
    expect(booking(GALA_ID)!.status).toBe('packed');

    // the reservation tracks it
    page('u-petr', `/bookings/${GALA_ID}`);
    expect(screen.getByTestId('open-promises')).toHaveTextContent('8× Astera AX9 PowerPAR');
    expect(
      screen.getByText(
        /Odvezeno bez přislíbeného: 8× Astera AX9 PowerPAR \(Astera Rent CZ\)\. Poznámka: Astera dorazí rovnou na místo/,
      ),
    ).toBeInTheDocument();
    page('u-tomas', '/notifications');
    expect(screen.getByTestId('notifications')).toHaveTextContent(
      'Gala Dinner: odvezeno bez přislíbeného: 8× Astera AX9 PowerPAR',
    );

    page('u-martin', '/');
    expect(screen.getByTestId('ready-to-ship')).toHaveTextContent('Gala Dinner');
    expect(screen.getByTestId('packing-soon')).not.toHaveTextContent('Gala Dinner');
    page('u-martin', `/shipping/${GALA_ID}`);
    fireEvent.click(screen.getByRole('checkbox', { name: /^Jede s dodávkou/ }));
    click('Odvézt (8 ks)');
    expect(screen.getByTestId('ship-confirm')).not.toHaveTextContent('bez přislíbeného');
    click('Potvrdit odvoz (8 ks)');
    expect(booking(GALA_ID)!.status).toBe('shipped');
    expect(events(GALA_ID).slice(-2)).toEqual(['batch_shipped', 'promised_arrived']);
    page('u-martin', `/vratka/${GALA_ID}`);
    expect(
      screen.getAllByTestId(/^ret-/).some((r) => /Astera AX9 PowerPAR/.test(r.textContent!)),
    ).toBe(true);
  });

  it('a rental that will not come is closed with a reason', () => {
    renderApp('/shipping/bk-tiskovka', { scenario: 'base', user: 'u-martin' });
    click('Nedorazí: LED obrazovka 3×2 m');
    expect(screen.getByRole('button', { name: 'Uzavřít jako nedorazí' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Proč nedorazí (povinné)'), {
      target: { value: 'Dodavatel zrušil' },
    });
    click('Uzavřít jako nedorazí');
    expect(screen.queryByTestId('promised')).toBeNull();
    expect(booking('bk-tiskovka')!.lines.find((l) => 'external' in l.target)).toMatchObject({
      status: 'missing',
      note: 'Dodavatel zrušil',
    });
    page('u-petr', '/bookings/bk-tiskovka');
    expect(
      screen.getByText(
        /Nedorazí: 1× LED obrazovka 3×2 m \(LED Rent CZ\)\. Důvod: Dodavatel zrušil/,
      ),
    ).toBeInTheDocument();
  });

  it('what stays for another van is unticked, a count can be lowered', () => {
    renderApp('/shipping/bk-tiskovka', { scenario: 'base', user: 'u-martin' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Naloženo: Řečnický pult' }));
    fireEvent.change(screen.getByLabelText('Kolik kusů: Vysílačka Motorola'), {
      target: { value: '3' },
    });
    click(/^Odvézt \(\d+ ks\)/);
    click(/^Potvrdit odvoz/);
    const packed = screen.getByTestId('packed');
    expect(packed).toHaveTextContent('1× Řečnický pult');
    expect(packed).toHaveTextContent('1× Vysílačka Motorola');
    expect(packed).not.toHaveTextContent('TV 65"');
    expect(booking('bk-tiskovka')!.status).toBe('packed');
  });

  it('pack and ship in one go', () => {
    renderApp('/packing/bk-letni-warmup', { scenario: 'base', user: 'u-martin' });
    const c = card('QSC K12.2');
    fireEvent.click(within(c).getAllByRole('checkbox')[0]!);
    click('Zabalit a rovnou odvézt (1)');
    const form = within(screen.getByTestId('ship-confirm'));
    // gear from another event is listed as not on this van
    expect(screen.getByTestId('ship-confirm')).toHaveTextContent(
      '8× Robe LEDBeam 150 (TechConf 2027)',
    );
    fireEvent.change(form.getByLabelText('Označení dodávky'), { target: { value: 'Auto 1' } });
    fireEvent.click(form.getByRole('button', { name: /^Zabalit a rovnou odvézt/ }));
    expect(shipments('bk-letni-warmup')).toEqual([
      expect.objectContaining({ label: 'Auto 1', lines: [expect.objectContaining({ qty: 2 })] }),
    ]);
    expect(card('QSC K12.2')).toHaveTextContent('odvezeno 2');
  });
});

describe('promised gear of our own and from other events', () => {
  it('pieces missing because of an accepted conflict say why and may be left', () => {
    renderApp(`/packing/${CHAIN.b}`, { scenario: 'conflictChain', user: 'u-martin' });
    click('Začít balit');
    const c = card('Robe LEDBeam 150');
    expect(c).toHaveTextContent(
      'Chybí 2 ks, drží Koncert v parku. Domluveno: Koncert v parku vrátí 2 kusy dřív',
    );
    fireEvent.click(within(c).getByRole('button', { name: /Přijede až při odvozu \(2\)/ }));
    expect(card('Robe LEDBeam 150')).toHaveTextContent('při odvozu přijede 2, zbývá zabalit 6');
    expect(
      within(card('DMX splitter 8×')).queryByRole('button', { name: /Přijede až/ }),
    ).toBeNull();
    fireEvent.click(
      within(card('Robe LEDBeam 150')).getByRole('button', { name: 'Přece jen zabalit tady' }),
    );
    expect(card('Robe LEDBeam 150')).not.toHaveTextContent('při odvozu přijede');
  });

  it('a whole handover is confirmed on the shipping screen', () => {
    renderApp('/shipping/bk-letni-warmup', { scenario: 'transfer', user: 'u-martin' });
    const h = within(screen.getByTestId('handovers'));
    fireEvent.click(h.getByRole('button', { name: 'Potvrdit předání (8 ks)' }));
    expect(screen.queryByTestId('handovers')).toBeNull();
    expect(
      state().shipments.some(
        (x) => x.bookingId === 'bk-letni-warmup' && x.transferFromBookingId === 'bk-techconf',
      ),
    ).toBe(true);
    expect(state().issues.some((i) => i.bookingId === 'bk-techconf')).toBe(false);
  });
});

describe('packed gear is not accessible', () => {
  it('cannot be borrowed; the case says where it is packed', () => {
    renderApp('/items/lectern?loan=1', { scenario: 'base', user: 'u-petr' });
    const free = screen.getByTestId('loan-form').textContent!;
    expect(free).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Kolik kusů'), { target: { value: '2' } });
    // two in Brod, one packed for Tiskovka
    expect(screen.getByRole('alert')).toHaveTextContent('Teď jde půjčit nejvýš 1 ks.');
  });

  it('readers see both screens without buttons', () => {
    renderApp('/shipping/bk-tiskovka', { scenario: 'base', user: 'u-petr' });
    expect(screen.queryByRole('button', { name: /Odvézt/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Nedorazí/ })).toBeNull();
    for (const x of screen.getAllByRole('checkbox')) expect(x).toBeDisabled();
    page('u-petr', '/packing/bk-tiskovka');
    expect(screen.queryByRole('button', { name: /Vybalit/ })).toBeNull();
  });
});
