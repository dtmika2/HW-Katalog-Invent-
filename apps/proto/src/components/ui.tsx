import type { ReactNode } from 'react';
import {
  remainingToShip,
  type AppState,
  type Booking,
  type BookingStatus,
  type LineAvailability,
} from '@quix/core';
import { cs } from '../i18n/cs';
import { useProto } from '../store';

const STATUS_STYLE: Record<BookingStatus, string> = {
  draft: 'bg-alu text-ink-soft border-alu-line',
  submitted: 'bg-warn-light text-warn border-warn/40',
  confirmed: 'bg-tape-light text-tape-dark border-tape/30',
  packing: 'bg-tape text-white border-tape',
  shipped: 'bg-ink text-white border-ink',
  returning: 'bg-ink-soft text-white border-ink-soft',
  returned: 'bg-ok-light text-ok border-ok/30',
  returned_with_issues: 'bg-bad-light text-bad border-bad/40',
  closed: 'bg-white text-muted border-alu-line',
  expired: 'bg-white text-muted border-alu-line line-through',
};

export function StatusChip({ status }: { status: BookingStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {cs.status[status]}
    </span>
  );
}

/** Availability as a strip of tape: green / amber / red with the short count. */
export function AvailabilityBadge({
  a,
  isCase,
  caseName,
}: {
  a: LineAvailability | undefined;
  isCase: boolean;
  caseName?: string;
}) {
  if (!a || a.badge === 'none') return null;
  let text: string;
  let cls: string;
  if (a.badge === 'red') {
    text = cs.badge.red(a.short, isCase);
    cls = 'bg-bad text-white';
  } else if (a.badge === 'amber') {
    text = a.breaksCase ? cs.badge.breaksCase(caseName ?? '') : cs.badge.amber;
    cls = 'bg-warn text-white';
  } else {
    text = cs.badge.green;
    cls = 'bg-ok text-white';
  }
  return (
    <span
      data-testid="badge"
      data-badge={a.badge}
      className={`inline-block -skew-x-6 px-2 py-0.5 text-xs font-semibold ${cls}`}
      title={cs.badge.free(a.minFree)}
    >
      <span className="inline-block skew-x-6">{text}</span>
    </span>
  );
}

export function CaseLabel({ children }: { children: ReactNode }) {
  return <span className="case-label">{children}</span>;
}

export function Field({
  label,
  children,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

export function Toasts() {
  const toasts = useProto((p) => p.toasts);
  const dismiss = useProto((p) => p.dismissToast);
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto rounded border px-3 py-2 text-left text-sm shadow-sm ${
            t.kind === 'error'
              ? 'border-bad bg-bad-light text-bad'
              : 'border-ok bg-ok-light text-ok'
          }`}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}

/** "část odvezena, zbývá N ks" while an order is still being packed but a batch has left. */
export function PartlyShipped({ s, b }: { s: AppState; b: Booking }) {
  if (b.status !== 'packing' && b.status !== 'shipped') return null;
  const left = remainingToShip(s, b.id);
  const anyOut = s.shipments.some((x) => x.bookingId === b.id && !x.transferFromBookingId);
  if (!anyOut || left === 0) return null;
  return (
    <span data-testid="partly-shipped" className="text-xs font-semibold text-warn">
      {cs.warehouseUi.partlyShipped(left)}
    </span>
  );
}
