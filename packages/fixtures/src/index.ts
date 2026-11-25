/** Deterministic demo data (seed 2027, today 2027-04-20) and scenarios for the prototypes. */
import { emptyState, packingsFromShipments, type AppState } from '@quix/core';
import { CATEGORY_COLOR } from './catalog-data';
import { generateState } from './generate';
import { caseBreaking } from './scenarios/case-breaking';
import { conflictChain } from './scenarios/conflict-chain';
import { galaDinner } from './scenarios/gala-dinner';
import { transfer } from './scenarios/transfer';

export { BOOKINGS, buildCatalog, DEMO_TODAY, generateState, SEED } from './generate';
export { Builder, type BookingSpec, type LineSpec, type Stage } from './builder';
export { mulberry32 } from './prng';
export * from './catalog-data';
export { GALA_ID, GALA_STEPS, galaDinner } from './scenarios/gala-dinner';
export { CHAIN, conflictChain } from './scenarios/conflict-chain';
export { TRANSFER, transfer } from './scenarios/transfer';
export { BREAKING, caseBreaking } from './scenarios/case-breaking';

/** Seed of the deterministic generator. */
export const FIXTURES_SEED = 2027;

/**
 * Version of the demo data. Bump it whenever the generated data changes (new items,
 * categories, …) so a prototype with older data saved in the browser can tell the user.
 */
export const DATA_VERSION = 3;

/**
 * Safe, additive upgrade of demo data saved by an older prototype: fills in what can be
 * added without touching the user's own changes (currently: category colours).
 */
export function migrateSavedState(s: AppState): AppState {
  return {
    ...s,
    categories: s.categories.map((c) =>
      !c.parentId && !c.color && CATEGORY_COLOR[c.id] ? { ...c, color: CATEGORY_COLOR[c.id] } : c,
    ),
  };
}

/**
 * Fill in collections and settings that did not exist when the state was saved, so the app never
 * meets an undefined list. Gear shipped before packing was recorded counts as packed.
 */
export function completeSavedState(s: AppState): AppState {
  const empty = emptyState();
  return {
    ...empty,
    ...s,
    packings: s.packings ?? packingsFromShipments(s.shipments),
    settings: { ...empty.settings, ...s.settings },
  };
}

export type ScenarioId = 'base' | 'galaDinner' | 'conflictChain' | 'transfer' | 'caseBreaking';

export interface Scenario {
  id: ScenarioId;
  build: () => AppState;
  /** What the demo should open first. */
  focus?: { bookingId?: string; itemId?: string; caseTypeId?: string; userId?: string };
}

export const SCENARIOS: Scenario[] = [
  { id: 'base', build: generateState },
  { id: 'galaDinner', build: galaDinner, focus: { bookingId: 'bk-firemni', userId: 'u-petr' } },
  {
    id: 'conflictChain',
    build: conflictChain,
    focus: { itemId: 'ledbeam150', bookingId: 'bk-chain-c', userId: 'u-jana' },
  },
  {
    id: 'transfer',
    build: transfer,
    focus: { bookingId: 'bk-techconf', itemId: 'ledbeam150', userId: 'u-martin' },
  },
  {
    id: 'caseBreaking',
    build: caseBreaking,
    focus: { bookingId: 'bk-break-y', caseTypeId: 'ct-ax1', userId: 'u-lucie' },
  },
];
