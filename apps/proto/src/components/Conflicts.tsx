/** How real a conflict is: chips, the lists of hypothetical conflicts and same-day bookings. */
import { Link } from 'react-router-dom';
import type { Booking, ConflictTier, ConflictTiers, LineConflict } from '@quix/core';
import { cs, fmtDate, fmtShort } from '../i18n/cs';
import { isCaseLine, lineName, userName } from '../lib/names';
import { useAppState } from '../store';

export const TIER_STYLE: Record<ConflictTier, string> = {
  real: 'border-bad bg-bad text-white',
  likely: 'border-warn bg-warn text-white',
  possible: 'border-ink-soft/40 bg-alu text-ink-soft',
};

/** Blocks under each other are divided; the first one under the title is not. */
const BLOCK =
  'mt-4 border-t border-alu-line pt-3 [ul:empty+&]:mt-0 [ul:empty+&]:border-0 [ul:empty+&]:pt-0';

export function TierChip({ tier }: { tier: ConflictTier }) {
  return (
    <span
      data-tier={tier}
      title={cs.tiers.hint[tier]}
      className={`inline-block whitespace-nowrap rounded border px-1.5 text-xs font-medium ${TIER_STYLE[tier]}`}
    >
      {cs.tiers.mark[tier]} {cs.tiers.name[tier]}
    </span>
  );
}

/** Link to a colliding booking: event, PM, days and state. */
export function CollidingLink({ b }: { b: LineConflict['colliding'][number] }) {
  const s = useAppState();
  return (
    <Link to={`/bookings/${b.id}`} className="underline">
      {cs.conflict.collidingRow(
        b.eventName,
        userName(s, b.pmId),
        fmtDate(b.from),
        fmtDate(b.to),
        cs.status[b.status],
      )}
    </Link>
  );
}

/** Conflicts that happen only if other pre-bookings do; nothing has to be acknowledged. */
export function TierSection({
  tier,
  conflicts,
  booking,
}: {
  tier: 'likely' | 'possible';
  conflicts: LineConflict[];
  booking: Booking;
}) {
  const s = useAppState();
  if (conflicts.length === 0) return null;
  return (
    <div data-testid={`tier-${tier}`} className={BLOCK}>
      <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <TierChip tier={tier} /> {cs.tiers.hint[tier]}
      </p>
      <ul className="space-y-3">
        {conflicts.map((c) => {
          const line = booking.lines.find((l) => l.id === c.lineId);
          if (!line) return null;
          return (
            <li key={c.lineId} className="text-sm">
              <p className="font-medium">
                {lineName(s, line)}: {cs.badge[tier](c.short, isCaseLine(line))}
              </p>
              <p className="text-xs text-muted">
                {cs.calendar.conflictDays(c.days.map((d) => fmtShort(d)).join(', '))}
              </p>
              <ul className="ml-3 list-disc text-xs">
                {c.colliding.map((b) => (
                  <li key={b.id}>
                    <CollidingLink b={b} />
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SameDaySection({ list }: { list: ConflictTiers['sameDay'] }) {
  if (list.length === 0) return null;
  return (
    <div data-testid="same-day" className={BLOCK}>
      <p className="mb-2 text-sm font-medium">{cs.tiers.sameDay}</p>
      <ul className="space-y-1.5 text-xs">
        {list.map(({ tier, booking }) => (
          <li key={booking.id} className="flex flex-wrap items-baseline gap-2">
            <TierChip tier={tier} /> <CollidingLink b={booking} />
          </li>
        ))}
      </ul>
    </div>
  );
}
