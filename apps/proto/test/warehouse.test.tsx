/**
 * M5b packing, M5c vratka, M5d service & warehouse dashboard — acceptance tests.
 */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { addLinesAfterShipping, isCaseComplete, newLine, unwrap, type AppState } from '@quix/core';
import { GALA_ID, GALA_STEPS, TRANSFER } from '@quix/fixtures';
import { useProto } from '../src/store';
import { booking, renderApp, renderCurrent, state } from './helpers';

const confirmed = (s: AppState) => GALA_STEPS.confirm(GALA_STEPS.submit(GALA_STEPS.create(s)));
const lineIdOf = (s: AppState, pred: (t: object) => boolean) =>
  s.bookings.find((b) => b.id === GALA_ID)!.lines.find((l) => pred(l.target))!.id;

/** "Zabalit a rovnou odvézt" of what is ticked. */
function packAndShipNow(label?: string) {
  fireEvent.click(screen.getByRole('button', { name: /^Zabalit a rovnou odvézt/ }));
  const form = within(screen.getByTestId('ship-confirm'));
  if (label)
    fireEvent.change(form.getByLabelText('Označení dodávky'), { target: { value: label } });
  fireEvent.click(form.getByRole('button', { name: /^Zabalit a rovnou odvézt/ }));
}

describe('M5b packing (mobile)', () => {
  it('starts packing, picks case numbers and ships a labelled batch', () => {
    renderApp(`/packing/${GALA_ID}`, {
      scenario: 'galaDinner',
      user: 'u-martin',
      prepare: confirmed,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Začít balit' }));
    expect(screen.getByRole('heading', { name: 'Sklad Brod' })).toBeInTheDocument();
    const ax9 = lineIdOf(
      state(),
      (t) => 'caseTypeId' in t && (t as { caseTypeId: string }).caseTypeId === 'ct-ax9',
    );
    const card = screen.getByTestId(`pack-${ax9}`);
    expect(card).toHaveTextContent('Astera AX9 PowerPAR');
    fireEvent.click(within(card).getByRole('checkbox', { name: /AX9-02/ }));
    // the contents are checked line by line, there is no "tick all"
    const go = () => screen.getByRole('button', { name: 'Zabalit zatržené (1)' });
    expect(go()).toBeDisabled();
    expect(screen.getByText('Nejdřív dokončete kontrolu obsahu: AX9-02')).toBeInTheDocument();
    const boxes = within(screen.getByTestId('check-case-ax9-02')).getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    for (const x of boxes) {
      expect(go()).toBeDisabled();
      fireEvent.click(x);
    }
    expect(go()).toBeEnabled();
    packAndShipNow('Dodávka 1 — case');
    const sh = state().shipments.filter((x) => x.bookingId === GALA_ID);
    expect(sh).toEqual([
      expect.objectContaining({
        label: 'Dodávka 1 — case',
        lines: [expect.objectContaining({ lineId: ax9, qty: 1, caseIds: ['case-ax9-02'] })],
      }),
    ]);
    // only the AX9 case left: the order is still being packed
    expect(booking(GALA_ID)?.status).toBe('packing');
  });

  it('a case that does not match: count, refill or ship short with a reason; switching the case starts over', () => {
    renderApp(`/packing/${GALA_ID}`, {
      scenario: 'galaDinner',
      user: 'u-martin',
      prepare: confirmed,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Začít balit' }));
    const ax9 = lineIdOf(
      state(),
      (t) => 'caseTypeId' in t && (t as { caseTypeId: string }).caseTypeId === 'ct-ax9',
    );
    const card = screen.getByTestId(`pack-${ax9}`);
    const choose = (n: RegExp) => fireEvent.click(within(card).getByRole('checkbox', { name: n }));
    const box = () => within(screen.getByTestId('check-case-ax9-02'));
    const tickAll = () =>
      box()
        .getAllByRole('checkbox')
        .forEach((x) => !(x as HTMLInputElement).disabled && fireEvent.click(x));
    const go = () => screen.getByRole('button', { name: 'Zabalit zatržené (1)' });
    choose(/^AX9-02$/);
    tickAll();
    expect(go()).toBeEnabled();
    choose(/^AX9-02$/);
    choose(/^AX9-02$/);
    expect(go()).toBeDisabled();

    fireEvent.click(box().getByRole('button', { name: 'Nesedí: AX9-02, Astera AX9 PowerPAR' }));
    tickAll();
    expect(box().getByText(/Case odjede neúplný, chybí 1× Astera AX9 PowerPAR/)).toBeVisible();
    expect(go()).toBeDisabled();
    fireEvent.change(box().getByLabelText('Proč odjíždí neúplný (povinné)'), {
      target: { value: 'Jeden je v opravě' },
    });
    fireEvent.click(go());
    // packed only: counted and reported, but still in the warehouse
    expect(state().shipments.filter((x) => x.bookingId === GALA_ID)).toEqual([]);
    const c = state().cases.find((x) => x.id === 'case-ax9-02')!;
    expect(isCaseComplete(state(), c)).toBe(false);
    const iss = state().issues.find((i) => i.caseId === 'case-ax9-02')!;
    expect(iss).toMatchObject({ itemId: 'ax9', qty: 1, note: 'Jeden je v opravě' });
    cleanup();

    // the Chief sees what happened and where
    useProto.getState().setUser('u-tomas');
    renderCurrent('/');
    expect(screen.getByTestId('issues')).toHaveTextContent('Chybělo už při balení casu AX9-02.');
    cleanup();
    renderCurrent('/notifications');
    expect(screen.getByTestId('notifications')).toHaveTextContent(
      'case AX9-02 zabalen neúplný, chybí 1× Astera AX9 PowerPAR (důvod: Jeden je v opravě)',
    );
    cleanup();

    // vratka expects what left
    useProto.getState().setUser('u-martin');
    renderCurrent(`/shipping/${GALA_ID}`);
    fireEvent.click(screen.getByRole('button', { name: 'Odvézt (1 ks)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Potvrdit odvoz (1 ks)' }));
    cleanup();
    renderCurrent(`/vratka/${GALA_ID}`);
    const ret = screen.getByTestId('ret-case-case-ax9-02');
    expect(ret).toHaveTextContent('Odvezen neúplný, chybělo 1× Astera AX9 PowerPAR');
    fireEvent.click(within(ret).getByRole('button', { name: 'Kompletní, jak byl odvezen' }));
    fireEvent.click(within(ret).getByRole('checkbox', { name: /Potvrzuji tento řádek/ }));
    fireEvent.click(screen.getByRole('button', { name: /Zapsat vratku/ }));
    expect(
      state()
        .issues.filter((i) => i.caseId === 'case-ax9-02')
        .map((i) => i.qty),
    ).toEqual([1]);
  });

  it('records loose pieces taken out of a case (the case becomes incomplete)', () => {
    const prepare = (s0: AppState) => {
      const s = confirmed(s0);
      const tomas = s.users.find((u) => u.id === 'u-tomas')!;
      return unwrap(
        addLinesAfterShipping(
          {
            ...s,
            bookings: s.bookings.map((b) => (b.id === GALA_ID ? { ...b, status: 'shipped' } : b)),
          },
          tomas,
          '2027-04-20',
          GALA_ID,
          [newLine({ itemId: 'ax9' }, 2, 'bk-gala-x1')],
        ),
      );
    };
    renderApp(`/packing/${GALA_ID}`, { scenario: 'galaDinner', user: 'u-martin', prepare });
    // lines added after shipping → high-priority banner
    expect(screen.getByTestId('high-priority')).toBeInTheDocument();
    const card = screen.getByTestId('pack-bk-gala-x1');
    fireEvent.click(within(card).getByRole('checkbox'));
    fireEvent.change(within(card).getByRole('combobox'), { target: { value: 'case-ax9-01' } });
    packAndShipNow();
    const c = state().cases.find((x) => x.id === 'case-ax9-01')!;
    expect(isCaseComplete(state(), c)).toBe(false);
    expect(state().shipments.at(-1)?.lines).toEqual([
      { lineId: 'bk-gala-x1', qty: 2, fromCaseId: 'case-ax9-01' },
    ]);
  });
});

describe('M5b packing — partial batches', () => {
  it('a partly shipped order stays on the warehouse packing list with what is left', () => {
    renderApp('/packing/bk-letni-warmup', { scenario: 'base', user: 'u-martin' });
    const first = screen.getAllByTestId(/^pack-/)[0]!;
    fireEvent.click(within(first).getAllByRole('checkbox')[0]!);
    packAndShipNow();
    expect(booking('bk-letni-warmup')?.status).toBe('packing');
    fireEvent.click(screen.getByRole('link', { name: 'Přehled' }));
    expect(screen.getAllByText('Balí se').length).toBeGreaterThan(0);
    const row = within(screen.getByTestId('packing-soon'))
      .getByText('Letní noc – warm-up')
      .closest('li')!;
    expect(row).toHaveTextContent(/část odvezena, zbývá \d+ ks/);
    expect(within(row).getByRole('link', { name: 'Balit' })).toHaveAttribute(
      'href',
      '/packing/bk-letni-warmup',
    );
  });
});

describe('M5c vratka (mobile)', () => {
  it('counts start at 0, every line needs its own confirmation; case complete as standard; short line → issue', () => {
    renderApp(`/vratka/${GALA_ID}`, {
      scenario: 'galaDinner',
      user: 'u-martin',
      prepare: (s) => GALA_STEPS.ship(confirmed(s)),
    });
    expect(
      screen.queryByRole('button', { name: /vybrat vše|select all/i }),
    ).not.toBeInTheDocument();
    for (const input of screen.getAllByRole('spinbutton', { name: /^Vráceno kusů/ }))
      expect(input).toHaveValue(0);
    expect(screen.getByRole('button', { name: /Zapsat vratku \(0/ })).toBeDisabled();

    // Each case card (AX9-02, SB-02): complete as standard, one conscious tap per case, then confirm
    expect(screen.getAllByTestId(/^ret-case-/).map((c) => c.getAttribute('data-testid'))).toEqual([
      'ret-case-case-ax9-02',
      'ret-case-case-sb-02',
    ]);
    for (const caseCard of screen.getAllByTestId(/^ret-case-/)) {
      fireEvent.click(within(caseCard).getByRole('button', { name: 'Kompletní dle standardu' }));
      fireEvent.click(within(caseCard).getByRole('checkbox', { name: /Potvrzuji tento řádek/ }));
    }
    // every other line: full count + confirm, except desk power (0 + note)
    for (const card of screen.getAllByTestId(/^ret-(?!case-)/)) {
      const name = card.querySelector('p')?.textContent ?? '';
      const stepper = within(card).getByRole('spinbutton', {
        name: /Vráceno kusů|Vráceno dodavateli/,
      });
      if (name !== 'IEC napájecí kabel pultu')
        fireEvent.change(stepper, { target: { value: stepper.getAttribute('max') } });
      else
        fireEvent.change(within(card).getByRole('textbox'), { target: { value: 'Zůstal v sále' } });
      fireEvent.click(within(card).getByRole('checkbox', { name: /Potvrzuji tento řádek/ }));
    }
    fireEvent.click(screen.getByRole('button', { name: /Zapsat vratku/ }));
    expect(booking(GALA_ID)?.status).toBe('returned_with_issues');
    const result = screen.getByTestId('vratka-result');
    expect(result).toHaveTextContent('Chybí: 1× IEC napájecí kabel pultu');
    expect(result).toHaveTextContent('Vráceno s problémy');
  });

  it('handover list offers upcoming orders, not ones that have already ended', () => {
    renderApp(`/vratka/${TRANSFER.from}`, { scenario: 'transfer', user: 'u-martin' });
    const lb = booking(TRANSFER.from)!.lines.find(
      (l) => 'itemId' in l.target && l.target.itemId === 'ledbeam150',
    )!;
    const select = within(screen.getByTestId(`ret-${lb.id}`)).getByLabelText('Na akci');
    const names = [...select.querySelectorAll('option')].map((o) => o.textContent);
    expect(names).toContain('Letní noc – warm-up');
    expect(names).not.toContain('Autosalon Morava – roadshow Brno');
  });

  it('damaged → service case shown in the result; partial transfer to another order', () => {
    renderApp(`/vratka/${TRANSFER.from}`, { scenario: 'transfer', user: 'u-martin' });
    const b = state().bookings.find((x) => x.id === TRANSFER.from)!;
    const lb = b.lines.find((l) => 'itemId' in l.target && l.target.itemId === 'ledbeam150')!;
    const card = screen.getByTestId(`ret-${lb.id}`);
    fireEvent.change(within(card).getByRole('spinbutton', { name: /Vráceno kusů/ }), {
      target: { value: '2' },
    });
    fireEvent.click(within(card).getByText('Poškozeno'));
    fireEvent.change(within(card).getByLabelText('Z toho poškozeno'), { target: { value: '1' } });
    fireEvent.click(within(card).getByText('Předat rovnou na jinou akci'));
    fireEvent.change(within(card).getByLabelText('Na akci'), { target: { value: TRANSFER.to } });
    fireEvent.change(within(card).getByLabelText('Kolik'), { target: { value: '6' } });
    fireEvent.change(within(card).getByLabelText('Poznámka'), {
      target: { value: 'Jeden nejde tilt' },
    });
    fireEvent.click(within(card).getByRole('checkbox', { name: /Potvrzuji tento řádek/ }));
    fireEvent.click(screen.getByRole('button', { name: /Zapsat vratku \(1/ }));
    expect(screen.getByTestId('vratka-result')).toHaveTextContent(
      '1× Robe LEDBeam 150 — Jeden nejde tilt',
    );
    const planned = state()
      .bookings.find((x) => x.id === TRANSFER.to)!
      .lines.find((l) => l.fromBookingId === TRANSFER.from)!;
    expect(planned.transferredOn).toBe('2027-04-20');
    expect(
      state().shipments.some((x) => x.bookingId === TRANSFER.to && x.lines[0]?.qty === 6),
    ).toBe(true);
  });
});

describe('M5d service and warehouse dashboard', () => {
  it('service list shows the overdue case; status flow to Opraveno releases the pieces', () => {
    renderApp('/service', { scenario: 'base', user: 'u-karel' });
    const list = screen.getByTestId('service-list');
    expect(
      within(list)
        .getByText(/Epson EB-L1075U/)
        .closest('button'),
    ).toHaveTextContent('Po termínu');
    fireEvent.click(within(list).getByText(/Chauvet Rogue R2 Wash/));
    const detail = screen.getByTestId('service-detail');
    fireEvent.click(within(detail).getByRole('button', { name: '→ Vráceno – ke kontrole' }));
    fireEvent.change(
      within(screen.getByTestId('service-detail')).getByLabelText('Komentář ke změně'),
      { target: { value: 'Funguje' } },
    );
    fireEvent.click(
      within(screen.getByTestId('service-detail')).getByRole('button', { name: '→ Opraveno' }),
    );
    const sc = state().serviceCases.find((x) => x.itemId === 'rogue-r2')!;
    expect(sc.status).toBe('fixed');
    expect(sc.events.map((e) => e.status)).toEqual([
      'reported',
      'in_progress',
      'back_to_check',
      'fixed',
    ]);
  });

  it('warehouse dashboard lists today’s packing and refills an incomplete case', () => {
    renderApp('/', { scenario: 'base', user: 'u-martin' });
    expect(screen.getByTestId('packing-soon')).toHaveTextContent('Letní noc – warm-up');
    const refill = screen.getByTestId('refill-tasks');
    const row = within(refill).getByText('AX1-04').closest('li')!;
    expect(row).toHaveTextContent('2× Astera AX1 nabíjecí kabel');
    fireEvent.click(within(row).getByRole('button', { name: 'Doplnit case' }));
    expect(
      isCaseComplete(
        state(),
        state().cases.find((c) => c.id === 'case-ax1-04')!,
      ),
    ).toBe(true);
    expect(
      within(screen.getByTestId('refill-tasks')).queryByText('AX1-04'),
    ).not.toBeInTheDocument();
  });
});
