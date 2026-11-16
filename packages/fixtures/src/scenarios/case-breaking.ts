/**
 * Loose bookings that would break cases booked whole by another order.
 * AX1 (Brod: 32 pcs, all in 4 cases; AX1-04 is incomplete → 3 complete cases).
 * X — Petr's order books all 3 complete AX1 cases for 31 May – 4 Jun.
 * Y — Lucie's draft asks for 6 loose AX1 on 2 Jun → item-level OK, but it would force a case
 *     open → amber "rozbije case" naming X.
 */
import type { AppState } from '@quix/core';
import { Builder } from '../builder';
import { U } from '../catalog-data';
import { DEMO_TODAY, generateState } from '../generate';

export const BREAKING = { x: 'bk-break-x', y: 'bk-break-y' } as const;

export function caseBreaking(): AppState {
  const b = new Builder(generateState(), DEMO_TODAY);
  b.book({
    id: BREAKING.x,
    name: 'Výstava designu',
    pm: U.petr,
    client: 'cl-morava',
    purpose: 'AX1 tuby v celých casech',
    periods: [['2027-06-01', '2027-06-03']],
    stage: 'confirmed',
    lines: [{ caseType: 'ct-ax1', qty: 3 }],
  });
  b.book({
    id: BREAKING.y,
    name: 'Křest alba',
    pm: U.lucie,
    client: 'cl-divadlo',
    purpose: 'Pár AX1 na pódium',
    periods: [['2027-06-02', '2027-06-02']],
    stage: 'draft',
    lines: [{ item: 'ax1', qty: 6 }],
  });
  return b.state;
}
