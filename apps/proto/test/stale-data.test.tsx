/**
 * Demo data saved in the browser by an older prototype version: colours are added, a banner
 * offers to reload the demo data.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { DATA_VERSION, generateState } from '@quix/fixtures';
import { App } from '../src/App';
import { useProto } from '../src/store';

const KEY = 'quix-hw-proto-v1';

async function saveOld() {
  // let a pending debounced save from the previous test finish first
  await new Promise((r) => setTimeout(r, 400));
  const s = generateState();
  const old = { ...s, categories: s.categories.map(({ color: _c, ...rest }) => rest) };
  localStorage.setItem(
    KEY,
    JSON.stringify({ state: old, scenarioId: 'base', today: '2027-04-20', userId: 'u-petr' }),
  );
  useProto.setState({ state: null, staleData: false });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => localStorage.clear());

describe('older saved demo data', () => {
  it('gets the category colours and shows a banner offering a reload', async () => {
    await saveOld();
    renderAt('/catalog?cat=audio');
    const banner = await screen.findByTestId('stale-data', {}, { timeout: 5000 });
    const labels = screen.getAllByTestId('category-label');
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l).toHaveAttribute('data-color', 'lavender');
    // keep my data → banner disappears
    fireEvent.click(within(banner).getByRole('button', { name: 'Ponechat moje data' }));
    expect(screen.queryByTestId('stale-data')).not.toBeInTheDocument();
  });

  it('reloading the demo data removes the banner and stores the current version', async () => {
    await saveOld();
    renderAt('/');
    const banner = await screen.findByTestId('stale-data', {}, { timeout: 5000 });
    fireEvent.click(within(banner).getByRole('button', { name: 'Obnovit demo data' }));
    expect(screen.queryByTestId('stale-data')).not.toBeInTheDocument();
    expect(useProto.getState().state?.categories.some((c) => c.id === 'kab-opt')).toBe(true);
    await new Promise((r) => setTimeout(r, 400));
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').dataVersion).toBe(DATA_VERSION);
  });

  it('current data saved before loans existed still works, without a banner', async () => {
    await new Promise((r) => setTimeout(r, 400));
    const { loans: _loans, ...rest } = generateState();
    const { loanHorizonDays: _days, ...settings } = rest.settings;
    localStorage.setItem(
      KEY,
      JSON.stringify({
        state: { ...rest, settings },
        scenarioId: 'base',
        today: '2027-04-20',
        userId: 'u-petr',
        dataVersion: DATA_VERSION,
      }),
    );
    useProto.setState({ state: null, staleData: false });
    renderAt('/items/walkie');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Vzít si / půjčit' }, { timeout: 5000 }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Vzít si' }));
    expect(useProto.getState().state?.loans).toHaveLength(1);
    expect(screen.queryByTestId('stale-data')).not.toBeInTheDocument();
  });

  it('current saved data shows no banner', async () => {
    const s = generateState();
    localStorage.setItem(
      KEY,
      JSON.stringify({
        state: s,
        scenarioId: 'base',
        today: '2027-04-20',
        userId: 'u-petr',
        dataVersion: DATA_VERSION,
      }),
    );
    useProto.setState({ state: null, staleData: false });
    renderAt('/');
    await screen.findByRole('heading', { name: /Dobrý den/ }, { timeout: 5000 });
    expect(screen.queryByTestId('stale-data')).not.toBeInTheDocument();
  });
});
