/** "Poznámky a přílohy" of a booking: notes, venue photos, plans, agreements. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  addFile,
  addNote,
  ATTACHMENT_LIMITS,
  attachmentsOf,
  canRemoveAttachment,
  FILE_TYPES,
  fileProblem,
  fileTypeOf,
  removeAttachment,
  usedBytes,
  type Attachment,
} from '@quix/core';
import { cs, fmtDate } from '../i18n/cs';
import { userName } from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';
import { deleteFile, getFile, putFile, shrinkPhoto } from '../store/files';
import { Section } from './ui';

/** Phones offer the camera because of the image types. */
const ACCEPT = [
  'image/jpeg',
  'image/png',
  'image/webp',
  ...Object.keys(FILE_TYPES).map((x) => `.${x}`),
].join(',');

/** Formats the browser shows in a picture element. */
const isPicture = (name: string) => /^image\/(jpeg|png|webp)$/.test(fileTypeOf(name) ?? '');

/** Never reused, unlike the numbered ids of demo data. */
const newKey = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function Attachments({ id, readOnly = false }: { id: string; readOnly?: boolean }) {
  const s = useAppState();
  const list = attachmentsOf(s, id);
  if (readOnly) {
    if (list.length === 0) return null;
    return (
      <details data-testid="attachments" className="panel p-3 print:hidden">
        <summary className="cursor-pointer text-sm font-medium">
          {cs.attachments.title} ({list.length})
        </summary>
        <List list={list} readOnly />
      </details>
    );
  }
  return (
    <div data-testid="attachments">
      <Section title={cs.attachments.title}>
        <AddForms id={id} />
        <List list={list} />
      </Section>
    </div>
  );
}

function AddForms({ id }: { id: string }) {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const toast = useProto((p) => p.toast);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const problemText = (name: string, p: NonNullable<ReturnType<typeof fileProblem>>) =>
    cs.attachments.problem[p](name);

  const add = async (files: File[]) => {
    setBusy(true);
    for (const file of files) {
      if (!fileTypeOf(file.name)) {
        toast('error', problemText(file.name, 'type'));
        continue;
      }
      const { name, blob } = await shrinkPhoto(file);
      const state = useProto.getState().state;
      const p = state && fileProblem(state, id, { name, size: blob.size });
      if (p) {
        toast('error', problemText(file.name, p));
        continue;
      }
      const key = newKey();
      try {
        await putFile(key, blob);
      } catch {
        toast('error', cs.attachments.notStored(file.name));
        continue;
      }
      const failed = run((st) => addFile(st, user, today, id, { name, size: blob.size, key }));
      if (failed) await deleteFile(key);
    }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!run((st) => addNote(st, user, today, id, note))) setNote('');
        }}
      >
        <textarea
          className="input"
          rows={2}
          maxLength={ATTACHMENT_LIMITS.noteLength}
          aria-label={cs.attachments.note}
          placeholder={cs.attachments.noteHint}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn" disabled={!note.trim()}>
            {cs.attachments.addNote}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? cs.attachments.adding : cs.attachments.addFiles}
          </button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept={ACCEPT}
            aria-label={cs.attachments.addFiles}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              // the same file can be picked again
              e.target.value = '';
              void add(files);
            }}
          />
        </div>
      </form>
      <p className="text-xs text-muted">
        {cs.attachments.limits(
          size(usedBytes(s, id)),
          size(ATTACHMENT_LIMITS.bookingBytes),
          size(ATTACHMENT_LIMITS.fileBytes),
        )}{' '}
        {cs.attachments.onlyHere}
      </p>
    </div>
  );
}

const size = (bytes: number): string =>
  bytes < 100 * 1024
    ? cs.attachments.kb(Math.ceil(bytes / 1024))
    : cs.attachments.mb(bytes / (1024 * 1024));

function List({ list, readOnly = false }: { list: Attachment[]; readOnly?: boolean }) {
  if (list.length === 0) return null;
  return (
    <ul className="mt-3 divide-y divide-alu-line border-t border-alu-line">
      {list.map((a) => (
        <Row key={a.id} a={a} readOnly={readOnly} />
      ))}
    </ul>
  );
}

function Row({ a, readOnly }: { a: Attachment; readOnly: boolean }) {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const [asking, setAsking] = useState(false);
  const remove = () => {
    const failed = run((st) => removeAttachment(st, user, today, a.id), cs.attachments.removed);
    if (!failed && a.file) void deleteFile(a.file.key);
  };
  return (
    <li
      data-testid="attachment"
      className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 text-sm"
    >
      <div className="min-w-0 flex-1 basis-60">
        {a.text && <p className="whitespace-pre-wrap break-words">{a.text}</p>}
        {a.file && <FileLink file={a.file} />}
        <p className="text-xs text-muted">
          {userName(s, a.by)}, {fmtDate(a.on)}
          {a.file && `, ${size(a.file.size)}`}
        </p>
      </div>
      {!readOnly &&
        canRemoveAttachment(user, a) &&
        (asking ? (
          <span className="flex gap-2">
            <button type="button" className="btn btn-sm btn-danger" onClick={remove}>
              {cs.attachments.removeYes}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setAsking(false)}>
              {cs.common.cancel}
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="text-xs text-muted underline"
            aria-label={cs.attachments.removeLabel(a.file?.name ?? cs.attachments.note)}
            onClick={() => setAsking(true)}
          >
            {cs.attachments.remove}
          </button>
        ))}
    </li>
  );
}

/** undefined = loading, null = not in this browser. */
function useFileUrl(file: NonNullable<Attachment['file']>): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>();
  useEffect(() => {
    let made: string | undefined;
    let live = true;
    void getFile(file.key).then((blob) => {
      if (!live) return;
      if (!blob) return setUrl(null);
      // opened as what its extension says, whatever the file claims to be
      const type = fileTypeOf(file.name) ?? 'application/octet-stream';
      made = URL.createObjectURL(new Blob([blob], { type }));
      setUrl(made);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [file.key, file.name]);
  return url;
}

function FileLink({ file }: { file: NonNullable<Attachment['file']> }) {
  const url = useFileUrl(file);
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  if (url === undefined) return <p className="font-medium">{file.name}</p>;
  if (url === null)
    return (
      <p>
        <span className="font-medium">{file.name}</span>{' '}
        <span className="text-xs text-warn">{cs.attachments.missing}</span>
      </p>
    );
  if (isPicture(file.name) && !broken)
    return (
      <>
        <button
          type="button"
          className="flex items-center gap-3 text-left"
          aria-label={cs.attachments.enlarge(file.name)}
          onClick={() => setOpen(true)}
        >
          <img
            src={url}
            alt=""
            className="h-16 w-20 shrink-0 rounded border border-alu-line object-cover"
            onError={() => setBroken(true)}
          />
          <span className="break-all font-medium underline">{file.name}</span>
        </button>
        {open && (
          <Enlarged title={file.name} onClose={() => setOpen(false)}>
            <img src={url} alt={file.name} className="max-h-[82vh] max-w-full object-contain" />
            <a href={url} download={file.name} className="btn mt-2">
              {cs.attachments.download}
            </a>
          </Enlarged>
        )}
      </>
    );
  const pdf = fileTypeOf(file.name) === 'application/pdf';
  return (
    <a
      href={url}
      className="break-all font-medium underline"
      {...(pdf ? { target: '_blank', rel: 'noopener' } : { download: file.name })}
    >
      {file.name}
    </a>
  );
}

function Enlarged({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement;
    button.current?.focus();
    return () => {
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="enlarged"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink/80 p-3 print:hidden"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <button ref={button} type="button" className="btn mb-2 self-end" onClick={onClose}>
        {cs.common.close}
      </button>
      {children}
    </div>
  );
}
