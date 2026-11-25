/** Paper packing list (print / save as PDF). */
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '@quix/core';
import { GALA_ID, GALA_STEPS } from '@quix/fixtures';
import { renderApp, state } from './helpers';

const confirmed = (s: AppState) => GALA_STEPS.confirm(GALA_STEPS.submit(GALA_STEPS.create(s)));

afterEach(() => vi.restoreAllMocks());

describe('packing list print', () => {
  it('prints the event, client contact, every line and case contents', () => {
    renderApp(`/packing/${GALA_ID}`, {
      scenario: 'galaDinner',
      user: 'u-martin',
      prepare: confirmed,
    });
    const print = vi.fn();
    vi.stubGlobal('print', print);
    fireEvent.click(screen.getByRole('button', { name: 'Tisk / uložit PDF', hidden: true }));
    expect(print).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();

    const paper = screen.getByTestId('packing-print');
    expect(paper).toHaveTextContent('Gala Dinner');
    expect(paper).toHaveTextContent('Sklad Brod');
    expect(paper).toHaveTextContent(
      'Klient: Hotel Grand Praha, Ing. Pavel Beneš, +420 601 111 222',
    );
    expect(paper).toHaveTextContent('Vydal');
    const b = state().bookings.find((x) => x.id === GALA_ID)!;
    for (const l of b.lines) {
      if (!('itemId' in l.target)) continue;
      const id = l.target.itemId;
      expect(paper).toHaveTextContent(state().items.find((i) => i.id === id)!.name);
    }
    // the case is listed with a blank number and its contents
    expect(paper).toHaveTextContent('case č. ____________');
    expect(within(paper).getAllByText(/8× Astera AX9/).length).toBeGreaterThan(0);
  });

  it('suggests a file name with the event while printing and restores the title', () => {
    document.title = 'QUIX HW';
    renderApp(`/packing/${GALA_ID}`, {
      scenario: 'galaDinner',
      user: 'u-petr',
      prepare: confirmed,
    });
    globalThis.dispatchEvent(new Event('beforeprint'));
    expect(document.title).toBe('Balicí list – Gala Dinner');
    globalThis.dispatchEvent(new Event('afterprint'));
    expect(document.title).toBe('QUIX HW');
  });
});
