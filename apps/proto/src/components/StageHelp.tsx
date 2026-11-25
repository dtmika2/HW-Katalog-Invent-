/**
 * "Vysvětlivky": every stage of a booking, who moves it on, what it holds, and the ways back.
 * A window over the page, not a page of its own, so unsaved edits underneath stay.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { BookingStatus } from '@quix/core';
import { cs } from '../i18n/cs';
import { StatusChip } from './ui';

const GROUPS: { key: keyof typeof cs.stages.groups; stages: BookingStatus[] }[] = [
  { key: 'prebooking', stages: ['draft', 'submitted', 'expired'] },
  { key: 'order', stages: ['confirmed', 'packing', 'packed', 'shipped'] },
  { key: 'vratka', stages: ['returning', 'returned_with_issues', 'returned', 'closed'] },
];

/** The usual way of a booking, without detours. */
const FLOW: BookingStatus[] = [
  'draft',
  'submitted',
  'confirmed',
  'packing',
  'packed',
  'shipped',
  'returning',
  'returned',
  'closed',
];

function Window({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const before = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      // the only thing to focus besides the scrolling text
      e.preventDefault();
      closeButton.current?.focus();
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      box.current?.scrollBy({ top: e.key === 'PageDown' ? 400 : -400 });
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      box.current?.scrollBy({ top: e.key === 'ArrowDown' ? 60 : -60 });
    }
  };

  let n = 0;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-3 print:hidden"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={onKeyDown}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="stage-help"
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-md bg-white shadow-lg"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-alu-line bg-white px-4 py-3">
          <h2 id={titleId}>{cs.stages.title}</h2>
          <button ref={closeButton} type="button" className="btn" onClick={onClose}>
            {cs.common.close}
          </button>
        </div>
        <div className="space-y-6 p-4">
          <section>
            <h3 className="mb-2 text-sm font-semibold">{cs.stages.flow}</h3>
            <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
              {FLOW.map((st, i) => (
                <li key={st} className="flex items-center gap-1.5">
                  {i > 0 && (
                    <span aria-hidden="true" className="text-muted">
                      →
                    </span>
                  )}
                  <StatusChip status={st} />
                </li>
              ))}
            </ol>
          </section>

          {GROUPS.map((g) => (
            <section key={g.key}>
              <h3 className="mb-2 font-cond text-lg font-bold">{cs.stages.groups[g.key]}</h3>
              <ol className="divide-y divide-alu-line rounded border border-alu-line">
                {g.stages.map((st) => {
                  n += 1;
                  const x = cs.stages.info[st];
                  return (
                    <li
                      key={st}
                      data-testid={`stage-${st}`}
                      className="grid gap-x-4 gap-y-1 p-3 text-sm md:grid-cols-[11rem_1fr]"
                    >
                      <div className="flex items-center gap-2 self-start">
                        <span className="w-5 text-right text-xs text-muted">{n}.</span>
                        <StatusChip status={st} />
                      </div>
                      <div className="space-y-1">
                        <p className="font-medium">{x.means}</p>
                        <p>
                          <span className="text-muted">{cs.stages.next}</span> {x.next}
                        </p>
                        <p>
                          <span className="text-muted">{cs.stages.holds}</span> {x.holds}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}

          <section data-testid="stage-back">
            <h3 className="mb-2 font-cond text-lg font-bold">{cs.stages.backTitle}</h3>
            <ul className="divide-y divide-alu-line rounded border border-alu-line">
              {cs.stages.back.map((x) => (
                <li
                  key={`${x.from.join()}-${x.to.join()}`}
                  className="grid gap-x-4 gap-y-1 p-3 text-sm md:grid-cols-[18rem_1fr] md:items-center"
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    {x.from.map((st) => (
                      <StatusChip key={st} status={st} />
                    ))}
                    <span aria-label={cs.stages.arrow} role="img" className="text-muted">
                      →
                    </span>
                    {x.to.map((st) => (
                      <StatusChip key={st} status={st} />
                    ))}
                  </span>
                  <span>{x.how}</span>
                </li>
              ))}
            </ul>
          </section>

          <section data-testid="stage-notes">
            <h3 className="mb-1 font-cond text-lg font-bold">{cs.stages.notesTitle}</h3>
            <p className="mb-2 text-sm text-muted">{cs.stages.notesHint}</p>
            <dl className="divide-y divide-alu-line rounded border border-alu-line text-sm">
              {cs.stages.notes.map((x) => (
                <div
                  key={x.name}
                  className="grid gap-x-4 gap-y-1 p-3 md:grid-cols-[18rem_1fr] md:items-center"
                >
                  <dt className="font-medium">{x.name}</dt>
                  <dd>{x.means}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Button that opens the explanations. */
export function StageHelpButton({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {cs.stages.button}
      </button>
      {open && <Window onClose={() => setOpen(false)} />}
    </>
  );
}
