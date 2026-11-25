/** Parts shared by the packing and the shipping screen. */
import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import type { AppState, PackLine, PromisedLine } from '@quix/core';
import { cs, fmtDate } from '../i18n/cs';
import { userName } from '../lib/names';

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

/** Deliveries that already left. */
export function Batches({ s, id }: { s: AppState; id: string }) {
  const shipments = s.shipments.filter((x) => x.bookingId === id);
  if (shipments.length === 0) return null;
  return (
    <section>
      <h2>{cs.packing.batches}</h2>
      <ul className="mt-1 text-sm">
        {shipments.map((sh) => (
          <li key={sh.id}>
            {cs.packing.batchRow(
              sh.label,
              fmtDate(sh.shippedOn),
              sh.lines.reduce((n, x) => n + x.qty, 0),
              userName(s, sh.userId),
            )}
          </li>
        ))}
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
