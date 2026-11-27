import type { AppState, LedgerEntry, Message, Params, RuleId, SystemEventType } from '../../src';

/** Entries of one rule. */
export const of = (ledger: readonly LedgerEntry[], ruleId: RuleId) =>
  ledger.filter((e) => e.ruleId === ruleId);

/** Points of one rule (all entries together). */
export const pts = (ledger: readonly LedgerEntry[], ruleId: RuleId) =>
  of(ledger, ruleId).reduce((n, e) => n + e.points, 0);

let seq = 0;

/** A thread event as a core action would post it. */
export function ev(
  bookingId: string,
  authorId: string,
  on: string,
  type: SystemEventType,
  params: Params = {},
): Message {
  seq += 1;
  return { id: `msg-t${seq}`, bookingId, authorId, on, event: { type, params } };
}

/** A text message in a booking thread. */
export function msg(bookingId: string, authorId: string, on: string, text: string): Message {
  seq += 1;
  return { id: `msg-t${seq}`, bookingId, authorId, on, text };
}

export const withMessages = (s: AppState, ...messages: Message[]): AppState => ({
  ...s,
  messages: [...s.messages, ...messages],
});
