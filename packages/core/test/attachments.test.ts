/** Notes and files of a booking. */
import { describe, expect, it } from 'vitest';
import {
  addFile,
  addNote,
  ATTACHMENT_LIMITS,
  attachmentsOf,
  canRemoveAttachment,
  fileProblem,
  fileTypeOf,
  removeAttachment,
  unwrap,
  usedBytes,
  type AppState,
  type BookingStatus,
  type User,
} from '../src';
import { baseState, bk, order, TODAY as T, U, withBookings } from './helpers';

const MB = 1024 * 1024;
const st = (status: BookingStatus = 'draft') =>
  withBookings(baseState(), bk({ id: 'b', status }), bk({ id: 'other' }));
const file = (s: AppState, name = 'sal.jpg', size = MB, u: User = U.petr, key = 'k') =>
  addFile(s, u, T, 'b', { name, size, key });
const events = (s: AppState) => s.messages.map((m) => [m.event?.type, m.event?.params.name]);

describe('notes and files', () => {
  it('everybody who sees the booking adds, in any state of it', () => {
    for (const u of [U.petr, U.lucie, U.tomas, U.martin, U.admin]) {
      expect(addNote(st(), u, T, 'b', 'Vjezd ze dvora').ok).toBe(true);
      expect(file(st(), 'plan.pdf', MB, u).ok).toBe(true);
    }
    for (const status of ['tentative', 'submitted', 'expired', 'cancelled'] as const)
      expect(file(st(status)).ok).toBe(true);
    for (const status of ['shipped', 'closed'] as const) {
      const s = withBookings(baseState(), order({ id: 'b', status }));
      expect(addNote(s, U.martin, T, 'b', 'x').ok).toBe(true);
    }
  });

  it('not the warehouse on a reservation it does not see', () => {
    for (const status of ['tentative', 'planned'] as const) {
      expect(addNote(st(status), U.martin, T, 'b', 'x')).toMatchObject({
        error: { code: 'not_found' },
      });
      const s = unwrap(file(st(status)));
      expect(removeAttachment(s, U.martin, T, s.attachments[0]!.id).ok).toBe(false);
    }
    expect(addNote(st(), U.petr, T, 'nope', 'x')).toMatchObject({ error: { code: 'not_found' } });
  });

  it('are kept with who and when, newest first, per booking, and recorded', () => {
    const s = unwrap(file(unwrap(addNote(st(), U.petr, T, 'b', '  Vjezd ze dvora ')), 'plan.pdf'));
    expect(attachmentsOf(s, 'b')).toMatchObject([
      { by: U.petr.id, on: T, file: { name: 'plan.pdf', size: MB, key: 'k' } },
      { by: U.petr.id, on: T, text: 'Vjezd ze dvora' },
    ]);
    expect(attachmentsOf(s, 'other')).toEqual([]);
    expect(events(s)).toEqual([
      ['attachment_added', ''],
      ['attachment_added', 'plan.pdf'],
    ]);
    expect(addNote(s, U.petr, T, 'b', '  ')).toMatchObject({ error: { code: 'validation' } });
    expect(addNote(s, U.petr, T, 'b', 'x'.repeat(5001)).ok).toBe(false);
  });

  it('the type comes from the extension; what can run code is refused', () => {
    expect(fileTypeOf('Foto.JPG')).toBe('image/jpeg');
    expect(fileTypeOf('smlouva.v2.pdf')).toBe('application/pdf');
    for (const bad of [
      'a.html',
      'a.svg',
      'a.exe',
      'a.js',
      'a.pdf.html',
      'pdf',
      '.pdf',
      'a.',
      'a.constructor',
      'a.__proto__',
    ]) {
      expect(fileTypeOf(bad)).toBeUndefined();
      expect(file(st(), bad)).toMatchObject({ error: { details: { field: 'type' } } });
    }
  });

  it('limits: one file, all files, their number', () => {
    expect(file(st(), 'a.pdf', ATTACHMENT_LIMITS.fileBytes).ok).toBe(true);
    expect(file(st(), 'a.pdf', ATTACHMENT_LIMITS.fileBytes + 1)).toMatchObject({
      error: { details: { field: 'size' } },
    });
    expect(file(st(), 'a.pdf', 0)).toMatchObject({ error: { details: { field: 'empty' } } });
    expect(file(st(), 'a.pdf', Number.NaN).ok).toBe(false);
    let s = st();
    for (let i = 0; i < 5; i += 1) s = unwrap(file(s, 'a.pdf', 10 * MB));
    expect(usedBytes(s, 'b')).toBe(ATTACHMENT_LIMITS.bookingBytes);
    expect(fileProblem(s, 'b', { name: 'a.pdf', size: 1 })).toBe('total');
    expect(fileProblem(s, 'other', { name: 'a.pdf', size: 1 })).toBeUndefined();
    let many = st();
    for (let i = 0; i < ATTACHMENT_LIMITS.files; i += 1) many = unwrap(file(many, 'a.pdf', 1));
    expect(file(many, 'a.pdf', 1)).toMatchObject({ error: { details: { field: 'count' } } });
    expect(addNote(many, U.petr, T, 'b', 'poznámky se nepočítají').ok).toBe(true);
    expect(file(st(), 'a.pdf', 1, U.petr, '').ok).toBe(false);
  });

  it('names lose folders and control characters, long ones keep the extension', () => {
    const name = (n: string) => unwrap(file(st(), n)).attachments[0]!.file!.name;
    expect(name('C:\\tajné\\plán sálu.pdf')).toBe('plán sálu.pdf');
    expect(name('../../a\u0000b.pdf')).toBe('ab.pdf');
    const long = name(`${'x'.repeat(300)}.pdf`);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith('.pdf')).toBe(true);
  });

  it('removed by who added it or by the Chief, and recorded', () => {
    const s = unwrap(file(st(), 'plan.pdf'));
    const a = s.attachments[0]!;
    for (const u of [U.lucie, U.martin, U.admin]) {
      expect(canRemoveAttachment(u, a)).toBe(false);
      expect(removeAttachment(s, u, T, a.id)).toMatchObject({ error: { code: 'forbidden' } });
    }
    for (const u of [U.petr, U.tomas]) {
      const r = unwrap(removeAttachment(s, u, T, a.id));
      expect(r.attachments).toEqual([]);
      expect(events(r).at(-1)).toEqual(['attachment_removed', 'plan.pdf']);
    }
    expect(removeAttachment(s, U.petr, T, 'nope')).toMatchObject({ error: { code: 'not_found' } });
  });
});
