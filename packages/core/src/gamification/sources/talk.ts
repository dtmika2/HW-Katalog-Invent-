/**
 * Communication and loans. Text earns points only above a minimum length and within daily
 * limits (see `RULES`), so it supports the work without replacing it.
 */
import { diffDays } from '../../dates';
import type { AppState, Message } from '../../types';
import type { Draft } from '../types';
import { isPerson, textLength } from './common';

/** A message or note this long says something. */
export const TEXT_MIN = 15;
/** A message within this many days of another person's message answers it. */
export const REPLY_DAYS = 1;

export function talkDrafts(state: AppState): Draft[] {
  const out: Draft[] = [];
  const earlier = new Map<string, Message[]>();
  for (const m of state.messages) {
    if (m.event || !m.text || !isPerson(m.authorId)) continue;
    const before = earlier.get(m.bookingId) ?? [];
    earlier.set(m.bookingId, [...before, m]);
    if (textLength(m.text) < TEXT_MIN) continue;
    const id = `talk.message:${m.id}`;
    out.push({
      id,
      userId: m.authorId,
      on: m.on,
      ruleId: 'talk.message',
      bookingId: m.bookingId,
      params: {},
    });
    const other = [...before].reverse().find((x) => x.authorId !== m.authorId);
    if (other && diffDays(other.on, m.on) <= REPLY_DAYS)
      out.push({
        id: `talk.reply:${m.id}`,
        userId: m.authorId,
        on: m.on,
        ruleId: 'talk.reply',
        parentId: id,
        bookingId: m.bookingId,
        params: {},
      });
  }

  for (const a of state.attachments) {
    if (!isPerson(a.by)) continue;
    if (a.file)
      out.push({
        id: `talk.file:${a.id}`,
        userId: a.by,
        on: a.on,
        ruleId: 'talk.file',
        bookingId: a.bookingId,
        params: { name: a.file.name },
      });
    else if (textLength(a.text) >= TEXT_MIN)
      out.push({
        id: `talk.note:${a.id}`,
        userId: a.by,
        on: a.on,
        ruleId: 'talk.note',
        bookingId: a.bookingId,
        params: {},
      });
  }
  return out;
}

export function loanDrafts(state: AppState): Draft[] {
  const out: Draft[] = [];
  for (const l of state.loans) {
    if (l.cancelledOn) continue;
    const params = { itemId: l.itemId, qty: l.qty };
    if (l.until && isPerson(l.recordedBy))
      out.push({
        id: `loan.recorded:${l.id}`,
        userId: l.recordedBy,
        on: l.createdOn,
        ruleId: 'loan.recorded',
        params,
      });
    if (!l.returnedOn) continue;
    if (l.until && l.returnedOn <= l.until && isPerson(l.borrowerId))
      out.push({
        id: `loan.returnedOnTime:${l.id}`,
        userId: l.borrowerId,
        on: l.returnedOn,
        ruleId: 'loan.returnedOnTime',
        params,
      });
    if (isPerson(l.returnedBy) && l.returnedBy !== l.borrowerId)
      out.push({
        id: `loan.returnedFor:${l.id}`,
        userId: l.returnedBy,
        on: l.returnedOn,
        ruleId: 'loan.returnedFor',
        params,
      });
  }
  return out;
}
