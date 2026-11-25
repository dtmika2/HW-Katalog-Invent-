/** Parts shared by the packing and the shipping screen. */
import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  can,
  cancelPacking,
  cancelShipment,
  canCancelShipment,
  orderProgress,
  packedInHouse,
  type AppState,
  type PackLine,
  type PromisedLine,
} from '@quix/core';
import { cs, fmtDate } from '../i18n/cs';
import { userName } from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';

export const promisedRow = (p: Pick<PromisedLine, 'qty' | 'name' | 'from'>): string =>
  `${p.qty}× ${p.name}${p.from ? ` (${p.from})` : ''}`;

/** "Balení" and "Odvoz" of one order. */
export function DeliveryTabs({ id, ready }: { id: string; ready: number }) {
  const tab = ({ isActive }: { isActive: boolean }) =>
    `btn flex-1 ${isActive ? 'btn-primary' : ''}`;
  return (
    <nav className="flex gap-2" aria-label={cs.shipping.tabs}>
      <NavLink to={`/packing/${id}`} className={tab}>
        {cs.shipping.tabPacking}
      </NavLink>
      <NavLink to={`/shipping/${id}`} className={tab}>
        {cs.shipping.tabShipping(ready)}
      </NavLink>
    </nav>
  );
}

/** Why own pieces are short and promised from elsewhere. */
export function PromiseReasons({ l }: { l: PackLine }) {
  return (
    <>
      {l.conflicts.map((c, i) => (
        <span key={i} className="block text-xs text-warn">
          {cs.packing.conflict(c.short, c.colliding.join(', '), c.reason)}
        </span>
      ))}
    </>
  );
}

/** Last step before a van is recorded: its label, and what is promised but not on board. */
export function ShipConfirm({
  defaultLabel,
  missing,
  button,
  onShip,
  onCancel,
}: {
  defaultLabel: string;
  missing: PromisedLine[];
  button: string;
  onShip: (label: string, note: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  return (
    <form
      data-testid="ship-confirm"
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onShip(label.trim() || defaultLabel, note);
      }}
    >
      <label className="block">
        <span className="label">{cs.packing.label}</span>
        <input
          className="input"
          autoFocus
          placeholder={defaultLabel}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      {missing.length > 0 && (
        <div className="rounded border border-warn/40 bg-warn-light p-3 text-sm">
          <p className="font-semibold">{cs.shipping.without}</p>
          <ul className="list-disc pl-5">
            {missing.map((p) => (
              <li key={p.lineId}>{promisedRow(p)}</li>
            ))}
          </ul>
          <label className="mt-2 block">
            <span className="label">{cs.shipping.withoutNote}</span>
            <input
              className="input"
              placeholder={cs.shipping.withoutNoteHint}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <p className="mt-1 text-xs text-muted">{cs.shipping.withoutHint}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary min-h-12 flex-1 text-base">
          {button}
        </button>
        <button type="button" className="btn min-h-12" onClick={onCancel}>
          {cs.common.cancel}
        </button>
      </div>
    </form>
  );
}

/** Asks before undoing something, with an optional reason for the conversation. */
export function CancelConfirm({
  text,
  yes,
  onYes,
  onNo,
}: {
  text: string;
  yes: string;
  onYes: (reason: string) => void;
  onNo: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <form
      role="alertdialog"
      aria-label={text}
      className="my-2 space-y-2 rounded border border-bad/40 bg-bad-light p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        onYes(reason);
      }}
    >
      <p>{text}</p>
      <label className="block">
        <span className="label">{cs.packing.cancel.reason}</span>
        <input
          className="input"
          autoFocus
          placeholder={cs.packing.cancel.reasonHint}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-danger">
          {yes}
        </button>
        <button type="button" className="btn" onClick={onNo}>
          {cs.packing.cancel.keep}
        </button>
      </div>
    </form>
  );
}

/** "Zrušit balení": everything still here is unpacked. */
export function CancelPacking({ id }: { id: string }) {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const [asking, setAsking] = useState(false);
  const b = s.bookings.find((x) => x.id === id);
  if (!b || !can(user, 'pack') || !['packing', 'packed', 'shipped'].includes(b.status)) return null;
  const gone = s.shipments.some((x) => x.bookingId === id && !x.transferFromBookingId);
  const here = b.lines.reduce(
    (n, l) => n + packedInHouse(s, id, l.id).reduce((x, e) => x + e.qty, 0),
    0,
  );
  if (gone && here === 0 && orderProgress(s, b).promised === 0) return null;
  if (!asking)
    return (
      <button type="button" className="btn btn-danger" onClick={() => setAsking(true)}>
        {cs.packing.cancel.button}
      </button>
    );
  return (
    <CancelConfirm
      text={gone ? cs.packing.cancel.askPartly(here) : cs.packing.cancel.ask(here)}
      yes={cs.packing.cancel.yes}
      onYes={(reason) => {
        if (!run((st) => cancelPacking(st, user, today, id, reason), cs.packing.cancel.done))
          setAsking(false);
      }}
      onNo={() => setAsking(false)}
    />
  );
}

/** Deliveries that already left; one recorded by mistake can be taken back until the vratka. */
export function Batches({ s, id }: { s: AppState; id: string }) {
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const [asking, setAsking] = useState<string | undefined>();
  const shipments = s.shipments.filter((x) => x.bookingId === id);
  if (shipments.length === 0) return null;
  return (
    <section data-testid="batches">
      <h2>{cs.packing.batches}</h2>
      <ul className="mt-1 space-y-1 text-sm">
        {shipments.map((sh) => {
          const count = sh.lines.reduce((n, x) => n + x.qty, 0);
          return (
            <li key={sh.id}>
              <span className="flex flex-wrap items-center gap-x-3">
                {cs.packing.batchRow(
                  sh.label,
                  fmtDate(sh.shippedOn),
                  count,
                  userName(s, sh.userId),
                )}
                {can(user, 'ship') && canCancelShipment(s, sh.id) && (
                  <button
                    type="button"
                    className="text-xs underline"
                    aria-label={`${cs.packing.cancel.shipButton}: ${sh.label}`}
                    onClick={() => setAsking(sh.id)}
                  >
                    {cs.packing.cancel.shipButton}
                  </button>
                )}
              </span>
              {asking === sh.id && (
                <CancelConfirm
                  text={cs.packing.cancel.shipAsk(sh.label, count)}
                  yes={cs.packing.cancel.shipYes}
                  onYes={(reason) => {
                    const err = run(
                      (st) => cancelShipment(st, user, today, sh.id, reason),
                      cs.packing.cancel.shipDone,
                    );
                    if (!err) setAsking(undefined);
                  }}
                  onNo={() => setAsking(undefined)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Link back to the booking with the state of the order. */
export function BackToBooking({ id }: { id: string }) {
  return (
    <Link to={`/bookings/${id}`} className="text-sm underline">
      {cs.common.back}
    </Link>
  );
}
