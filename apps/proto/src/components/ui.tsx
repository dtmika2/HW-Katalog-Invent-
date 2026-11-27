import type { ReactNode } from 'react';
import {
  remainingToShip,
  type AppState,
  type Booking,
  type BookingStatus,
  type LineAvailability,
  type NotificationLevel,
} from '@quix/core';
import { cs } from '../i18n/cs';
import { useProto } from '../store';

const STATUS_STYLE: Record<BookingStatus, string> = {
  tentative: 'bg-white text-ink-soft border-dashed border-muted',
  planned: 'bg-white text-ink-soft border-muted',
  draft: 'bg-alu text-ink-soft border-alu-line',
  submitted: 'bg-warn-light text-warn border-warn/40',
  confirmed: 'bg-tape-light text-tape-dark border-tape/30',
  packing: 'bg-tape text-white border-tape',
  packed: 'bg-tape-dark text-white border-tape-dark',
  shipped: 'bg-ink text-white border-ink',
  returning: 'bg-ink-soft text-white border-ink-soft',
  returned: 'bg-ok-light text-ok border-ok/30',
  returned_with_issues: 'bg-bad-light text-bad border-bad/40',
  closed: 'bg-white text-muted border-alu-line',
  expired: 'bg-white text-muted border-alu-line line-through',
  cancelled: 'bg-alu text-muted border-alu-line line-through',
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

/** Notification colours: vibrant for what matters, tame for the rest; read ones fade. */
export const LEVEL_STYLE: Record<
  NotificationLevel,
  { row: string; rowRead: string; chip: string; chipRead: string; bell: string }
> = {
  urgent: {
    row: 'border-l-bad bg-bad-light font-semibold',
    rowRead: 'border-l-bad/30',
    chip: 'border-bad bg-bad text-white',
    chipRead: 'border-bad/40 bg-white text-bad',
    bell: 'bg-bad text-white',
  },
  attention: {
    row: 'border-l-warn-bright bg-warn-light/50 font-medium',
    rowRead: 'border-l-warn-bright/40',
    chip: 'border-warn-bright bg-warn-light text-ink',
    chipRead: 'border-warn-bright/60 bg-white text-ink-soft',
    bell: 'bg-warn-bright text-ink',
  },
  info: {
    row: 'border-l-alu-line bg-white font-medium',
    rowRead: 'border-l-alu',
    chip: 'border-alu-line bg-alu text-ink-soft',
    chipRead: 'border-alu-line bg-white text-muted',
    bell: 'bg-ink-soft text-white',
  },
};

export function LevelChip({ level, read = false }: { level: NotificationLevel; read?: boolean }) {
  const st = LEVEL_STYLE[level];
  return (
    <span
      className={`inline-block w-20 shrink-0 rounded border px-1.5 text-center text-xs font-medium ${read ? st.chipRead : st.chip}`}
    >
      {cs.notifications.level[level]}
    </span>
  );
}

/** Availability as a strip of tape: the worst tier with the short count. */
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
    text =
      a.breaksCase || !a.likely
        ? cs.badge.breaksCase(caseName ?? '')
        : cs.badge.likely(a.likely.short, isCase);
    cls = 'bg-warn text-white';
  } else if (a.badge === 'possible') {
    text = cs.badge.possible(a.possible?.short ?? 0, isCase);
    cls = 'bg-alu text-ink-soft ring-1 ring-inset ring-muted';
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

/**
 * Background tints for panels, so a page with many panels (the booking editor) can be read at
 * a glance. Kept light so text, inputs and status colours stay readable.
 */
export const PANEL_TONE = {
  white: '',
  green: 'border-emerald-200 bg-emerald-50',
  gray: 'border-slate-300 bg-slate-100',
  red: 'border-red-300 bg-red-100',
  blue: 'border-sky-200 bg-sky-50',
  yellow: 'border-yellow-300 bg-yellow-50',
  pink: 'border-pink-200 bg-pink-50',
  purple: 'border-violet-200 bg-violet-50',
} as const;
export type PanelTone = keyof typeof PANEL_TONE;

export function Section({
  title,
  children,
  actions,
  tone = 'white',
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  tone?: PanelTone;
}) {
  return (
    <section className={`panel p-4 ${PANEL_TONE[tone]}`} data-tone={tone}>
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
      className="pointer-events-none fixed right-4 top-4 sm:bottom-4 sm:top-auto z-50 flex max-w-sm flex-col gap-2"
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
  if (!['packing', 'packed', 'shipped'].includes(b.status)) return null;
  const left = remainingToShip(s, b.id);
  const anyOut = s.shipments.some((x) => x.bookingId === b.id && !x.transferFromBookingId);
  if (!anyOut || left === 0) return null;
  return (
    <span data-testid="partly-shipped" className="text-xs font-semibold text-warn">
      {cs.warehouseUi.partlyShipped(left)}
    </span>
  );
}
