/** Small monochrome line icons for badges; the step shows only as the outline's tone. */
import type { BadgeId, BadgeStepTier } from '@quix/core';

type Icon =
  | 'box'
  | 'return'
  | 'calendar'
  | 'eye'
  | 'check'
  | 'wrench'
  | 'note'
  | 'arrows'
  | 'clock'
  | 'warehouse';

const ICON_OF: Record<BadgeId, Icon> = {
  'first.packing': 'box',
  completeCases: 'box',
  fullCase: 'box',
  'first.vratka': 'return',
  carefulVratka: 'return',
  bigEvent: 'return',
  'first.request': 'calendar',
  ahead: 'calendar',
  firstTime: 'calendar',
  'first.report': 'eye',
  sharpEye: 'eye',
  'first.decision': 'check',
  solver: 'check',
  workshop: 'wrench',
  chronicle: 'note',
  bridge: 'arrows',
  loansOnTime: 'clock',
  bothWarehouses: 'warehouse',
};

const PATHS: Record<Icon, string[]> = {
  box: ['M4 8l8-4 8 4v8l-8 4-8-4z', 'M4 8l8 4 8-4', 'M12 12v8'],
  return: ['M9 14l-4-4 4-4', 'M5 10h9a5 5 0 0 1 0 10h-3'],
  calendar: ['M5 6h14v14H5z', 'M5 10h14', 'M9 4v4', 'M15 4v4'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  check: ['M5 12l5 5 9-10'],
  wrench: ['M14.5 5.5a4 4 0 0 0 4.9 4.9L11 18.8a2 2 0 0 1-2.8-2.8l8.4-8.4', 'M14.5 5.5l2 2'],
  note: ['M6 4h9l4 4v12H6z', 'M15 4v4h4', 'M9 12h7', 'M9 16h5'],
  arrows: ['M4 9h14l-3-3', 'M20 15H6l3 3'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  warehouse: ['M3 10l9-6 9 6v10H3z', 'M7 20v-6h10v6', 'M7 17h10'],
};

/** Tame metal tones for the outline; locked badges stay grey. */
const TONE: Record<BadgeStepTier, string> = {
  bronze: 'border-[#9A6B3F] text-[#7A5230]',
  silver: 'border-[#7C8894] text-[#55616D]',
  gold: 'border-[#A87F00] text-[#7E5F00]',
  single: 'border-ink text-ink',
};

export function BadgeIcon({ id, tier }: { id: BadgeId; tier: BadgeStepTier | undefined }) {
  const tone = tier ? TONE[tier] : 'border-alu-line text-muted';
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 bg-white ${tone}`}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {PATHS[ICON_OF[id]].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}
