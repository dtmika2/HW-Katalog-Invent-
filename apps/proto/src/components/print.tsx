/** Shared parts of the paper versions (print / save as PDF through the browser). */
import { useEffect, type ReactNode } from 'react';
import type { AppState, Booking } from '@quix/core';
import { cs } from '../i18n/cs';
import { userName } from '../lib/names';

/** The document title is the file name the print dialog suggests; it is restored afterwards. */
export function usePrintTitle(title: string): void {
  useEffect(() => {
    let before: string | undefined;
    const on = () => {
      before = document.title;
      document.title = title.replace(/[\\/:*?"<>|]/g, ' ').trim();
    };
    const off = () => {
      if (before !== undefined) document.title = before;
      before = undefined;
    };
    globalThis.addEventListener('beforeprint', on);
    globalThis.addEventListener('afterprint', off);
    return () => {
      globalThis.removeEventListener('beforeprint', on);
      globalThis.removeEventListener('afterprint', off);
      off();
    };
  }, [title]);
}

export function PrintButton({ disabled = false }: { disabled?: boolean }) {
  return (
    <button
      type="button"
      className="btn"
      title={cs.print.buttonHint}
      disabled={disabled}
      onClick={() => globalThis.print()}
    >
      {cs.print.button}
    </button>
  );
}

/** A sheet only visible on paper. */
export function Paper({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className="hidden text-[10.5pt] text-black print:block">
      {children}
    </div>
  );
}

export const Box = () => (
  <span
    aria-hidden="true"
    className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 border border-black"
  />
);

/** Grey bar above a group of rows. */
export function Bar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`break-after-avoid bg-neutral-200 px-1 text-[9pt] font-semibold ${className}`}>
      {children}
    </p>
  );
}

/** Event, kind of document, dates, PM and client. */
export function PaperHead({
  s,
  b,
  doc,
  title,
  dates,
}: {
  s: AppState;
  b: Booking;
  doc: string;
  title: string;
  dates: string[];
}) {
  const client = s.clients.find((c) => c.id === b.clientId);
  return (
    <header className="mb-3 border-b-2 border-black pb-2">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-cond text-[18pt] font-bold leading-tight">{b.eventName}</p>
        <p className="shrink-0 text-[9pt]">{doc}</p>
      </div>
      <p className="font-cond text-[13pt] font-bold">{title}</p>
      <p className="text-[9pt]">{dates.join(' · ')}</p>
      <p className="text-[9pt]">
        {cs.common.pm}: {userName(s, b.pmId)}
        {client &&
          ` · ${cs.common.client}: ${[client.name, client.contactPerson, client.phone].filter(Boolean).join(', ')}`}
        {` · ${cs.status[b.status]}`}
      </p>
    </header>
  );
}

export function Signatures({ labels }: { labels: string[] }) {
  return (
    <footer className="mt-14 grid break-inside-avoid grid-cols-3 gap-6 text-[9pt]">
      {labels.map((x) => (
        <p key={x} className="border-t border-black pt-1">
          {x}
        </p>
      ))}
    </footer>
  );
}
