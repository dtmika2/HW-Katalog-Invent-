/** Deterministic demo data (seed 2027, today 2027-04-20) and scenarios for the prototypes. */
import type { AppState } from '@quix/core';
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
