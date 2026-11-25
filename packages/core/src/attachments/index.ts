/**
 * Notes and files of a booking: venue photos, plans, agreements. Core keeps what was added by whom
 * and the rules; the contents of files are stored by the app under `file.key`.
 */
import type { IsoDate } from '../dates';
import { canSeeBooking } from '../lifecycle/permissions';
import { postEvent } from '../notifications';
import type { AppState, Attachment, Id, User } from '../types';
import { err, nextId, ok, produce, type Result } from '../util';

const MB = 1024 * 1024;

export const ATTACHMENT_LIMITS = {
  fileBytes: 10 * MB,
  bookingBytes: 50 * MB,
  files: 30,
  noteLength: 5000,
} as const;

/**
 * Allowed extensions and what they are opened as. The type never comes from the file itself;
 * formats that can run code in a page (html, svg) are left out on purpose.
 */
export const FILE_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  dwg: 'application/octet-stream',
  dxf: 'application/octet-stream',
};

/** Type of a file by its name, or undefined when it is not allowed. */
export function fileTypeOf(name: string): string | undefined {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const ext = name.slice(dot + 1).toLowerCase();
  return Object.prototype.hasOwnProperty.call(FILE_TYPES, ext) ? FILE_TYPES[ext] : undefined;
}

/** Notes and files of a booking, newest first. */
export function attachmentsOf(state: Pick<AppState, 'attachments'>, bookingId: Id): Attachment[] {
  return state.attachments.filter((a) => a.bookingId === bookingId).reverse();
}

export function usedBytes(state: Pick<AppState, 'attachments'>, bookingId: Id): number {
  return attachmentsOf(state, bookingId).reduce((n, a) => n + (a.file?.size ?? 0), 0);
}

export interface FileInput {
  name: string;
  size: number;
  /** Where the app keeps the contents. */
  key: string;
}

/** Why a file cannot be added, for a message before anything is stored. */
export function fileProblem(
  state: Pick<AppState, 'attachments'>,
  bookingId: Id,
  f: Pick<FileInput, 'name' | 'size'>,
): 'type' | 'empty' | 'size' | 'total' | 'count' | undefined {
  if (!fileTypeOf(f.name)) return 'type';
  if (!(f.size > 0)) return 'empty';
  if (f.size > ATTACHMENT_LIMITS.fileBytes) return 'size';
  if (usedBytes(state, bookingId) + f.size > ATTACHMENT_LIMITS.bookingBytes) return 'total';
  if (attachmentsOf(state, bookingId).filter((a) => a.file).length >= ATTACHMENT_LIMITS.files)
    return 'count';
  return undefined;
}

/** File name without folders or control characters, shortened but with its extension. */
function cleanName(name: string): string {
  const base = [...name.replace(/^.*[\\/]/, '')]
    .filter((c) => c >= ' ' && c !== '\u007f')
    .join('')
    .trim();
  if (base.length <= 120) return base;
  const dot = base.lastIndexOf('.');
  return `${base.slice(0, 115 - (base.length - dot))}…${base.slice(dot)}`;
}

function visible(state: AppState, user: User, bookingId: Id): Result<true> {
  const b = state.bookings.find((x) => x.id === bookingId);
  if (!b || !canSeeBooking(user, b)) return err('not_found', `Booking ${bookingId} not found`);
  if (!user.active) return err('forbidden', 'Not allowed');
  return ok(true);
}

/** Add a written note. Everybody who sees the booking may, in any state of it. */
export function addNote(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  text: string,
): Result<AppState> {
  const v = visible(state, user, bookingId);
  if (!v.ok) return v;
  const note = text.trim();
  if (!note || note.length > ATTACHMENT_LIMITS.noteLength)
    return err('validation', 'A note needs a text', { field: 'text' });
  return ok(
    produce(state, (d) => {
      d.attachments.push({ id: nextId(d, 'att'), bookingId, by: user.id, on: today, text: note });
      postEvent(d, bookingId, user.id, today, 'attachment_added', { name: '' });
    }).state,
  );
}

/** Add a file whose contents the app has stored. */
export function addFile(
  state: AppState,
  user: User,
  today: IsoDate,
  bookingId: Id,
  input: FileInput,
): Result<AppState> {
  const v = visible(state, user, bookingId);
  if (!v.ok) return v;
  const name = cleanName(input.name);
  const problem = fileProblem(state, bookingId, { name, size: input.size });
  if (problem) return err('validation', `The file cannot be added: ${problem}`, { field: problem });
  if (!input.key) return err('validation', 'The file is not stored', { field: 'key' });
  return ok(
    produce(state, (d) => {
      d.attachments.push({
        id: nextId(d, 'att'),
        bookingId,
        by: user.id,
        on: today,
        file: { name, size: input.size, key: input.key },
      });
      postEvent(d, bookingId, user.id, today, 'attachment_added', { name });
    }).state,
  );
}

/** Who added it, or the Chief. */
export function canRemoveAttachment(user: User, a: Attachment): boolean {
  return user.active && (a.by === user.id || user.role === 'chief');
}

export function removeAttachment(
  state: AppState,
  user: User,
  today: IsoDate,
  id: Id,
): Result<AppState> {
  const a = state.attachments.find((x) => x.id === id);
  if (!a) return err('not_found', `Attachment ${id} not found`);
  const v = visible(state, user, a.bookingId);
  if (!v.ok) return v;
  if (!canRemoveAttachment(user, a))
    return err('forbidden', 'Only who added it and the Chief remove it');
  return ok(
    produce(state, (d) => {
      d.attachments = d.attachments.filter((x) => x.id !== id);
      postEvent(d, a.bookingId, user.id, today, 'attachment_removed', {
        name: a.file?.name ?? '',
      });
    }).state,
  );
}
