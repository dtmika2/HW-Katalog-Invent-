/**
 * Project managers and the Chief. Everything comes from thread events (who and when), and the
 * booking itself for the quality of the request (lead time, purpose, client, groups).
 */
import { diffDays } from '../../dates';
import type { AppState, Booking, Message } from '../../types';
import type { Draft } from '../types';
import { events, isPerson, textLength } from './common';

/** Submitted this many days before the event: the warehouse and the Chief can plan. */
export const EARLY_DAYS = 14;
export const VERY_EARLY_DAYS = 30;
/** A purpose message this long tells the Chief what the event is. */
export const PURPOSE_MIN = 40;
/** Approved within this many days of the submission. */
export const QUICK_DAYS = 2;

type Ev = Message & { event: NonNullable<Message['event']> };

export function bookingDrafts(state: AppState): Draft[] {
  const out: Draft[] = [];
  const thread = new Map<string, Ev[]>();
  for (const m of state.messages)
    if (m.event && isPerson(m.authorId))
      thread.set(m.bookingId, [...(thread.get(m.bookingId) ?? []), m as Ev]);

  for (const b of state.bookings) {
    const t = thread.get(b.id) ?? [];
    const first = (type: string) => t.find((m) => m.event.type === type);

    const created = first('created');
    if (created)
      out.push({
        id: `booking.created:${b.id}`,
        userId: created.authorId,
        on: created.on,
        ruleId: 'booking.created',
        bookingId: b.id,
        params: {},
      });

    const submitted = first('submitted');
    const firstConfirm = first('confirmed');
    // A PM allowed to confirm their own pre-booking skips the submission.
    const request = submitted ?? (firstConfirm?.authorId === b.pmId ? firstConfirm : undefined);
    if (request) out.push(...requestDrafts(b, request, submitted ? firstConfirm : undefined, t));

    const closed = first('closed');
    if (closed && isPerson(b.pmId))
      out.push({
        id: `booking.completed:${b.id}`,
        userId: b.pmId,
        on: closed.on,
        ruleId: 'booking.completed',
        bookingId: b.id,
        params: {},
      });
    if (closed)
      out.push({
        id: `booking.closedBy:${b.id}`,
        userId: closed.authorId,
        on: closed.on,
        ruleId: 'booking.closedBy',
        bookingId: b.id,
        params: {},
      });
  }

  for (const m of events(state, 'shortage_solved'))
    out.push({
      id: `booking.shortageSolved:${m.id}`,
      userId: m.authorId,
      on: m.on,
      ruleId: 'booking.shortageSolved',
      bookingId: m.bookingId,
      params: {},
    });
  return out;
}

/** The request (submission) and its quality bonuses, credited to whoever submitted it. */
function requestDrafts(b: Booking, request: Ev, approval: Ev | undefined, t: Ev[]): Draft[] {
  const id = `booking.submitted:${b.id}`;
  const who = { userId: request.authorId, bookingId: b.id, parentId: id };
  const out: Draft[] = [
    {
      id,
      userId: request.authorId,
      on: request.on,
      ruleId: 'booking.submitted',
      bookingId: b.id,
      params: {},
    },
  ];
  const eventFrom = b.periods.map((p) => p.eventFrom).sort()[0];
  const lead = eventFrom ? diffDays(request.on, eventFrom) : 0;
  if (lead >= VERY_EARLY_DAYS)
    out.push({
      ...who,
      id: `booking.veryEarly:${b.id}`,
      on: request.on,
      ruleId: 'booking.veryEarly',
      params: { days: lead },
    });
  else if (lead >= EARLY_DAYS)
    out.push({
      ...who,
      id: `booking.early:${b.id}`,
      on: request.on,
      ruleId: 'booking.early',
      params: { days: lead },
    });
  if (textLength(b.purposeMessage) >= PURPOSE_MIN)
    out.push({
      ...who,
      id: `booking.purpose:${b.id}`,
      on: request.on,
      ruleId: 'booking.purpose',
      params: {},
    });
  if (b.clientId)
    out.push({
      ...who,
      id: `booking.client:${b.id}`,
      on: request.on,
      ruleId: 'booking.client',
      params: {},
    });

  // Approved by someone else, and never sent back before that.
  if (approval && approval.authorId !== b.pmId) {
    const returned = t.some(
      (m) => m.event.type === 'returned_to_pm' && t.indexOf(m) < t.indexOf(approval),
    );
    if (!returned)
      out.push({
        ...who,
        id: `booking.firstTime:${b.id}`,
        on: approval.on,
        ruleId: 'booking.firstTime',
        params: {},
      });
  }
  const approvedOn = approval?.on ?? (request.event.type === 'confirmed' ? request.on : undefined);
  if (approvedOn && b.type === 'order' && (b.groups?.length ?? 0) > 0)
    out.push({
      ...who,
      id: `booking.organised:${b.id}`,
      on: approvedOn,
      ruleId: 'booking.organised',
      params: {},
    });
  return out;
}

export function chiefDrafts(state: AppState): Draft[] {
  const out: Draft[] = [];
  const bookings = new Map(state.bookings.map((b) => [b.id, b]));

  for (const m of events(state, 'confirmed')) {
    const b = bookings.get(m.bookingId);
    if (!b || m.authorId === b.pmId) continue; // approving one's own booking is not a decision
    const id = `chief.approved:${m.id}`;
    out.push({
      id,
      userId: m.authorId,
      on: m.on,
      ruleId: 'chief.approved',
      bookingId: b.id,
      params: {},
    });
    if (b.submittedAt) {
      const days = diffDays(b.submittedAt, m.on);
      if (days >= 0 && days <= QUICK_DAYS)
        out.push({
          id: `chief.quick:${m.id}`,
          userId: m.authorId,
          on: m.on,
          ruleId: 'chief.quick',
          parentId: id,
          bookingId: b.id,
          params: { days },
        });
    }
  }

  for (const m of events(state, 'returned_to_pm'))
    out.push({
      id: `chief.returned:${m.id}`,
      userId: m.authorId,
      on: m.on,
      ruleId: 'chief.returned',
      bookingId: m.bookingId,
      params: {},
    });

  for (const c of state.conflicts) {
    if (!isPerson(c.resolvedBy) || !c.resolvedOn || textLength(c.resolution) === 0) continue;
    out.push({
      id: `chief.conflictResolved:${c.id}`,
      userId: c.resolvedBy,
      on: c.resolvedOn,
      ruleId: 'chief.conflictResolved',
      bookingId: c.bookingId,
      params: {},
    });
  }

  for (const c of state.clients) {
    if (!isPerson(c.createdBy) || !c.createdOn) continue;
    out.push({
      id: `client.created:${c.id}`,
      userId: c.createdBy,
      on: c.createdOn,
      ruleId: 'client.created',
      params: { name: c.name },
    });
  }
  return out;
}
