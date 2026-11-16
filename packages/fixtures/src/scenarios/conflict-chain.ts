/**
 * Three overlapping bookings on Robe LEDBeam 150 in June (Brod has 16):
 * A — Petr, order, 10 pcs, booked 7–10 Jun (hard)
 * B — Lucie, order, 8 pcs, booked 9–12 Jun, confirmed with an override (conflict record)
 * C — Jana, submitted pre-booking, 6 pcs, booked 10–13 Jun (soft)
 */
import type { AppState } from '@quix/core';
import { Builder } from '../builder';
import { U } from '../catalog-data';
import { DEMO_TODAY, generateState } from '../generate';

export const CHAIN = { a: 'bk-chain-a', b: 'bk-chain-b', c: 'bk-chain-c' } as const;

export function conflictChain(): AppState {
  const b = new Builder(generateState(), DEMO_TODAY);
  b.book({
    id: CHAIN.a,
    name: 'Koncert v parku',
    pm: U.petr,
    client: 'cl-brod',
    purpose: 'Open-air koncert',
    periods: [['2027-06-08', '2027-06-09']],
    stage: 'confirmed',
    lines: [{ item: 'ledbeam150', qty: 10 }],
  });
  b.book({
    id: CHAIN.b,
    name: 'Módní přehlídka',
    pm: U.lucie,
    client: 'cl-spektrum',
    purpose: 'Přehlídka, molo 20 m',
    periods: [['2027-06-10', '2027-06-11']],
    stage: 'confirmed',
    lines: [{ item: 'ledbeam150', qty: 8 }],
    overrides: { 'item:ledbeam150': 'Koncert v parku vrátí 2 kusy dřív, domluveno s Petrem' },
  });
  b.book({
    id: CHAIN.c,
    name: 'Firemní párty Horizont',
    pm: U.jana,
    client: 'cl-horizont',
    purpose: 'Večírek na střeše',
    periods: [['2027-06-11', '2027-06-12']],
    stage: 'submitted',
    lines: [{ item: 'ledbeam150', qty: 6 }],
  });
  return b.state;
}
