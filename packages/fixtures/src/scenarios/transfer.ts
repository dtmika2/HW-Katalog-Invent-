/**
 * Event-to-event transfer: TechConf 2027 (shipped, ends 21 Apr) hands 8 LEDBeams straight to
 * "Letní noc – warm-up" (booked from 22 Apr). The calendar shows no gap between them.
 */
import type { AppState } from '@quix/core';
import { generateState } from '../generate';

export const TRANSFER = {
  from: 'bk-techconf',
  to: 'bk-letni-warmup',
  itemId: 'ledbeam150',
} as const;

export function transfer(): AppState {
  return generateState();
}
