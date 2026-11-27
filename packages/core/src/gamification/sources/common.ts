import { SYSTEM_USER_ID, type AppState, type Message, type SystemEventType } from '../../types';

/** Thread events of one type, in the order they were posted. */
export function events(
  state: Pick<AppState, 'messages'>,
  type: SystemEventType,
): (Message & { event: NonNullable<Message['event']> })[] {
  return state.messages.filter(
    (m): m is Message & { event: NonNullable<Message['event']> } =>
      m.event?.type === type && isPerson(m.authorId),
  );
}

/** A person, not the nightly job. */
export function isPerson(userId: string | undefined): userId is string {
  return !!userId && userId !== SYSTEM_USER_ID;
}

/** Length of a text without surrounding whitespace. */
export function textLength(text: string | undefined): number {
  return text?.trim().length ?? 0;
}

/** A number from event params (0 when missing). */
export function num(value: string | number | undefined): number {
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
}
