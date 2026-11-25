import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppState } from '@quix/core';
import type { ScenarioId } from '@quix/fixtures';
import { AppRoutes } from '../src/App';
import { useProto } from '../src/store';

/** Load a scenario into the store, optionally transform it, and render the app at `path`. */
export function renderApp(
  path: string,
  opts: { scenario: ScenarioId; user: string; prepare?: (s: AppState) => AppState },
) {
  const store = useProto.getState();
  store.loadScenario(opts.scenario);
  if (opts.prepare) store.apply(opts.prepare);
  store.setUser(opts.user);
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AppRoutes />
    </MemoryRouter>,
  );
}

/** Render another page with the current store state. */
export function renderCurrent(path: string) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AppRoutes />
    </MemoryRouter>,
  );
}

export const state = (): AppState => {
  const s = useProto.getState().state;
  if (!s) throw new Error('no state');
  return s;
};

export const booking = (id: string) => state().bookings.find((b) => b.id === id);
