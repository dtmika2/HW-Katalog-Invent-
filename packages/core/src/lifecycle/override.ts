/**
 * Going over a conflict with a written reason. Who may approve decides; another PM proposes and
 * the reason counts only once somebody who may approve has accepted it.
 */
import type { Booking, BookingLine, Id, User } from '../types';
import { can } from './permissions';

const mapLine = (b: Booking, id: Id, fn: (l: BookingLine) => BookingLine): Booking => ({
  ...b,
  lines: b.lines.map((l) => (l.id === id ? fn(l) : l)),
});

/** Reason written by somebody who may not decide, not accepted yet. */
export function isProposedOverride(
  l: Pick<BookingLine, 'overrideReason' | 'overrideProposedBy' | 'overrideAcceptedBy'>,
): boolean {
  return !!l.overrideReason?.trim() && !!l.overrideProposedBy && !l.overrideAcceptedBy;
}

/** A reason that lets a short line be approved. */
export function isOverridden(
  l: Pick<BookingLine, 'overrideReason' | 'overrideProposedBy' | 'overrideAcceptedBy'>,
): boolean {
  return !!l.overrideReason?.trim() && !isProposedOverride(l);
}

function withoutOverride(l: BookingLine): BookingLine {
  const c = { ...l };
  delete c.overrideReason;
  delete c.overrideProposedBy;
  delete c.overrideAcceptedBy;
  return c;
}

/** Write (or with an empty text remove) the reason. A changed reason is not accepted any more. */
export function setOverrideReason(b: Booking, lineId: Id, reason: string, by?: User): Booking {
  return mapLine(b, lineId, (l) => {
    const c = withoutOverride(l);
    if (!reason.trim()) return c;
    c.overrideReason = reason;
    if (by && !can(by, 'override_conflict', b)) c.overrideProposedBy = by.id;
    return c;
  });
}

/** Accept a proposed reason, or take the acceptance back. */
export function acceptOverride(b: Booking, lineId: Id, by: User, accepted = true): Booking {
  return mapLine(b, lineId, (l) => {
    const c = { ...l };
    if (accepted && c.overrideProposedBy) c.overrideAcceptedBy = by.id;
    else delete c.overrideAcceptedBy;
    return c;
  });
}

/**
 * Make sure an edit only decides what its author may decide: without the permission a new or
 * changed reason is a proposal, and an acceptance cannot be set.
 */
export function settleOverrides(user: User, stored: Booking, edited: Booking): Booking {
  const decides = can(user, 'override_conflict', stored);
  return {
    ...edited,
    lines: edited.lines.map((l) => {
      const reason = l.overrideReason?.trim();
      if (!reason) return withoutOverride(l);
      const was = stored.lines.find((x) => x.id === l.id);
      const c = withoutOverride(l);
      c.overrideReason = l.overrideReason as string;
      if (decides) {
        if (l.overrideProposedBy) {
          c.overrideProposedBy = l.overrideProposedBy;
          if (l.overrideAcceptedBy) c.overrideAcceptedBy = was?.overrideAcceptedBy ?? user.id;
        }
      } else if (was?.overrideReason?.trim() === reason) {
        if (was.overrideProposedBy) c.overrideProposedBy = was.overrideProposedBy;
        if (was.overrideAcceptedBy) c.overrideAcceptedBy = was.overrideAcceptedBy;
      } else c.overrideProposedBy = user.id;
      return c;
    }),
  };
}
