/** Cancelling a whole booking, taking it back, and the notes shown while and after it is cancelled. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  can,
  cancelBooking,
  cancelWay,
  firstEventDay,
  openCancelRequests,
  reopenBooking,
  reopenStage,
  requestBookingCancel,
  type Booking,
} from '@quix/core';
import { cs, fmtDate } from '../i18n/cs';
import { userName } from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';

/** "Zrušit akci": with a reason, directly or by asking the Chief. */
export function CancelBooking({ b, onDone }: { b: Booking; onDone: () => void }) {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const [reason, setReason] = useState<string | undefined>();
  const way = cancelWay(s, user, b);
  if (!way || (way === 'ask' && openCancelRequests(s, b).some((r) => r.booking))) return null;
  if (reason === undefined)
    return (
      <button type="button" className="btn btn-danger sm:ml-auto" onClick={() => setReason('')}>
        {way === 'ask' ? cs.cancelBooking.ask : cs.cancelBooking.button}
      </button>
    );
  return (
    <form
      className="panel basis-full space-y-2 border-bad/50 p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const failed =
          way === 'ask'
            ? run(
                (st) => requestBookingCancel(st, user, today, b.id, reason),
                cs.packing.cancel.askDone,
              )
            : run(
                (st) => cancelBooking(st, user, today, b.id, reason),
                way === 'unpack' ? cs.cancelBooking.startedOk : cs.cancelBooking.done,
              );
        if (failed) return;
        setReason(undefined);
        if (way !== 'ask') onDone();
      }}
    >
      <p>{cs.cancelBooking.text[b.type === 'order' && way === 'direct' ? 'order' : way]}</p>
      <label className="block">
        <span className="label">{cs.packing.cancel.reasonRequired}</span>
        <input
          className="input"
          autoFocus
          placeholder={cs.cancelBooking.reasonHint}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-danger" disabled={!reason.trim()}>
          {way === 'ask' ? cs.packing.cancel.askYes : cs.cancelBooking.yes}
        </button>
        <button type="button" className="btn" onClick={() => setReason(undefined)}>
          {cs.packing.cancel.keep}
        </button>
      </div>
    </form>
  );
}

/** Who cancelled the booking, when and why; before the event it can be taken back. */
export function CancelledNote({ b }: { b: Booking }) {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  if (!b.cancelled) return null;
  const to = reopenStage(b);
  const may =
    to &&
    can(user, 'cancel_booking', b) &&
    (to !== 'submitted' || user.role === 'chief') &&
    today < firstEventDay(b);
  return (
    <div
      data-testid="cancelled-note"
      className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-alu-line bg-alu px-3 py-2 text-sm"
    >
      <p>
        {cs.cancelBooking.note(
          fmtDate(b.cancelled.on),
          userName(s, b.cancelled.by),
          b.cancelled.reason,
        )}
      </p>
      {may && (
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {cs.cancelBooking.reopenTo(cs.status[to])}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              run((st) => reopenBooking(st, user, today, b.id), cs.cancelBooking.reopened)
            }
          >
            {cs.cancelBooking.reopen}
          </button>
        </span>
      )}
    </div>
  );
}

/** The event is cancelled, its gear still stands packed. */
export function CancelPendingNote({ b, link = false }: { b: Booking; link?: boolean }) {
  const s = useAppState();
  if (!b.cancelPending) return null;
  return (
    <p
      role="alert"
      data-testid="cancel-pending"
      className="mb-3 rounded border-2 border-bad bg-bad-light p-3 text-sm font-semibold text-bad"
    >
      {cs.cancelBooking.pending}{' '}
      <span className="font-normal">
        {cs.cancelBooking.pendingWhy(userName(s, b.cancelPending.by), b.cancelPending.reason)}
      </span>{' '}
      {link && (
        <Link to={`/packing/${b.id}`} className="underline">
          {cs.editor.actions.openPacking}
        </Link>
      )}
    </p>
  );
}
