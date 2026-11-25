/** Parts shared by the packing and the shipping screen. */
import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  approveCancel,
  can,
  cancelLocked,
  cancelPacking,
  cancelShipment,
  canCancelShipment,
  declineCancel,
  openCancelRequests,
  orderProgress,
  packedInHouse,
  packingBackItems,
  requestCancel,
  requestLabel,
  shipmentBackItems,
  withdrawCancel,
  type AppState,
  type BackItem,
  type Booking,
  type CancelInput,
  type CancelRequest,
  type PackLine,
  type PromisedLine,
} from '@quix/core';
import { cs, fmtDate } from '../i18n/cs';
import { caseNumber, userName } from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';
import { CaseLabel } from './ui';

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

/**
 * Before undoing something: everything is confirmed as back one by one (a light vratka, without
 * "tick all"), and a reason goes to the conversation. Once the event has begun it is required.
 */
function CancelConfirm({
  text,
  yes,
  items,
  started,
  bookingId,
  onYes,
  onNo,
}: {
  text: string;
  yes: string;
  items: BackItem[];
  started: boolean;
  bookingId: string;
  onYes: (input: CancelInput) => void;
  onNo?: () => void;
}) {
  const s = useAppState();
  const [reason, setReason] = useState('');
  const [back, setBack] = useState<Set<string>>(new Set());
  const b = s.bookings.find((x) => x.id === bookingId);
  const left = items.filter((i) => !back.has(i.key)).length;
  const toggle = (key: string) => {
    const next = new Set(back);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setBack(next);
  };
  return (
    <form
      role="alertdialog"
      aria-label={text}
      className="my-2 space-y-2 rounded border border-bad/40 bg-bad-light p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        onYes({ confirmed: [...back], reason });
      }}
    >
      <p>{text}</p>
      {items.length > 0 && (
        <fieldset>
          <legend className="font-semibold">{cs.packing.cancel.back}</legend>
          <ul className="mt-1 max-h-[45vh] space-y-1 overflow-y-auto">
            {items.map((i) => {
              const label = i.caseId
                ? `${i.name} ${caseNumber(s, i.caseId)}`
                : `${i.qty}× ${i.name}`;
              return (
                <li key={i.key}>
                  <label className="flex min-h-10 items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-6 w-6 shrink-0"
                      aria-label={cs.packing.cancel.backItem(label)}
                      checked={back.has(i.key)}
                      onChange={() => toggle(i.key)}
                    />
                    <span>
                      {i.caseId ? (
                        <>
                          {i.name} <CaseLabel>{caseNumber(s, i.caseId)}</CaseLabel>
                        </>
                      ) : (
                        <>
                          <strong className="font-cond">{i.qty}×</strong> {i.name}
                        </>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-xs">
            {left > 0 && `${cs.packing.cancel.missing(left)} `}
            {s.shipments.some((x) => x.bookingId === bookingId) && (
              <Link to={`/vratka/${bookingId}`} className="underline">
                {cs.packing.cancel.notBack}
              </Link>
            )}
          </p>
        </fieldset>
      )}
      {started && <p className="font-medium text-bad">{cs.packing.cancel.lockedChief}</p>}
      {/* a cancelled event has its reason already */}
      {!b?.cancelPending && (
        <label className="block">
          <span className="label">
            {started ? cs.packing.cancel.reasonRequired : cs.packing.cancel.reason}
          </span>
          <input
            className="input"
            placeholder={cs.packing.cancel.reasonHint}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="btn btn-danger"
          disabled={left > 0 || (started && !reason.trim())}
        >
          {yes}
        </button>
        {onNo && (
          <button type="button" className="btn" onClick={onNo}>
            {cs.packing.cancel.keep}
          </button>
        )}
      </div>
    </form>
  );
}

/** Requests of the warehouse to cancel: the Chief decides, who asked can take it back. */
export function CancelRequests({ id }: { id: string }) {
  const s = useAppState();
  const b = s.bookings.find((x) => x.id === id);
  const open = b ? openCancelRequests(s, b) : [];
  if (!b || open.length === 0) return null;
  return (
    <ul data-testid="cancel-requests" className="space-y-2">
      {open.map((r) => (
        <RequestRow key={r.id} b={b} r={r} />
      ))}
    </ul>
  );
}

function RequestRow({ b, r }: { b: Booking; r: CancelRequest }) {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const [reason, setReason] = useState<string | undefined>();
  const items = r.shipmentId ? shipmentBackItems(s, r.shipmentId) : packingBackItems(s, b);
  const done = r.booking ? cs.packing.cancel.bookingApproved : cs.packing.cancel.approved;
  const back = items.filter((i) => r.confirmed.includes(i.key));
  return (
    <li className="space-y-1 rounded border border-warn/40 bg-warn-light p-3 text-sm">
      <p className="font-semibold">
        {r.booking
          ? cs.packing.cancel.requestBooking
          : cs.packing.cancel.request(requestLabel(s, r))}
      </p>
      <p>{cs.packing.cancel.requestBy(userName(s, r.by), fmtDate(r.on), r.reason)}</p>
      {back.length > 0 && (
        <p className="text-xs text-muted">
          {cs.packing.cancel.requestBack(
            back
              .map((i) => (i.caseId ? caseNumber(s, i.caseId) : `${i.qty}× ${i.name}`))
              .join(', '),
          )}
        </p>
      )}
      {can(user, 'cancel_after_start') ? (
        reason === undefined ? (
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => run((st) => approveCancel(st, user, today, b.id, r.id), done)}
            >
              {cs.packing.cancel.approve}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setReason('')}>
              {cs.packing.cancel.decline}
            </button>
          </div>
        ) : (
          <form
            className="flex flex-wrap items-end gap-2 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                (st) => declineCancel(st, user, today, b.id, r.id, reason),
                cs.packing.cancel.declined,
              );
            }}
          >
            <label className="min-w-52 flex-1">
              <span className="label">{cs.packing.cancel.declineReason}</span>
              <input
                className="input"
                autoFocus
                placeholder={cs.packing.cancel.declineHint}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button type="submit" className="btn" disabled={!reason.trim()}>
              {cs.packing.cancel.declineYes}
            </button>
            <button type="button" className="btn" onClick={() => setReason(undefined)}>
              {cs.common.cancel}
            </button>
          </form>
        )
      ) : (
        <p className="flex flex-wrap items-center gap-3 text-xs">
          {cs.packing.cancel.waiting}
          {r.by === user.id && (
            <button
              type="button"
              className="underline"
              onClick={() =>
                run(
                  (st) => withdrawCancel(st, user, today, b.id, r.id),
                  cs.packing.cancel.withdrawn,
                )
              }
            >
              {cs.packing.cancel.withdraw}
            </button>
          )}
        </p>
      )}
    </li>
  );
}

/** Button and form of the warehouse asking the Chief to cancel. */
function AskChief({
  b,
  shipmentId,
  label = '',
  items,
}: {
  b: Booking;
  shipmentId?: string;
  label?: string;
  items: BackItem[];
}) {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const [asking, setAsking] = useState(false);
  if (openCancelRequests(s, b).some((r) => !r.booking && r.shipmentId === shipmentId)) return null;
  if (!asking)
    return (
      <button
        type="button"
        className={shipmentId ? 'text-xs underline' : 'btn'}
        aria-label={shipmentId ? cs.packing.cancel.askLabel(label) : cs.packing.cancel.askPacking}
        onClick={() => setAsking(true)}
      >
        {shipmentId ? cs.packing.cancel.askChief : cs.packing.cancel.askPacking}
      </button>
    );
  return (
    <CancelConfirm
      text={cs.packing.cancel.askText(label)}
      yes={cs.packing.cancel.askYes}
      items={items}
      started
      bookingId={b.id}
      onYes={(input) => {
        const err = run(
          (st) =>
            requestCancel(st, user, today, b.id, {
              ...(shipmentId ? { shipmentId } : {}),
              confirmed: input.confirmed,
              reason: input.reason ?? '',
            }),
          cs.packing.cancel.askDone,
        );
        if (!err) setAsking(false);
      }}
      onNo={() => setAsking(false)}
    />
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
  if (!b || !can(user, 'cancel_delivery') || !['packing', 'packed', 'shipped'].includes(b.status))
    return null;
  const gone = s.shipments.some((x) => x.bookingId === id && !x.transferFromBookingId);
  const here = b.lines.reduce(
    (n, l) => n + packedInHouse(s, id, l.id).reduce((x, e) => x + e.qty, 0),
    0,
  );
  if (gone && here === 0 && orderProgress(s, b).promised === 0) return null;
  if (b.cancelPending)
    return (
      <CancelConfirm
        text={cs.cancelBooking.unpackText}
        yes={cs.cancelBooking.unpackYes}
        items={packingBackItems(s, b)}
        started={false}
        bookingId={id}
        onYes={(input) =>
          run((st) => cancelPacking(st, user, today, id, input), cs.cancelBooking.unpackDone)
        }
      />
    );
  const started = cancelLocked(b, today);
  if (started && !can(user, 'cancel_after_start'))
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted">{cs.packing.cancel.locked}</p>
        <AskChief b={b} items={packingBackItems(s, b)} />
      </div>
    );
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
      items={packingBackItems(s, b)}
      started={started}
      bookingId={id}
      onYes={(input) => {
        if (!run((st) => cancelPacking(st, user, today, id, input), cs.packing.cancel.done))
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
  const b = s.bookings.find((x) => x.id === id);
  if (!b || shipments.length === 0) return null;
  const started = cancelLocked(b, today);
  const may = can(user, 'cancel_delivery') && (!started || can(user, 'cancel_after_start'));
  const locked =
    can(user, 'cancel_delivery') && !may && shipments.some((x) => canCancelShipment(s, x.id));
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
                {may && canCancelShipment(s, sh.id) && (
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
              {!may && can(user, 'cancel_delivery') && canCancelShipment(s, sh.id) && (
                <AskChief
                  b={b}
                  shipmentId={sh.id}
                  label={sh.label}
                  items={shipmentBackItems(s, sh.id)}
                />
              )}
              {asking === sh.id && (
                <CancelConfirm
                  text={cs.packing.cancel.shipAsk(sh.label, count)}
                  yes={cs.packing.cancel.shipYes}
                  items={shipmentBackItems(s, sh.id)}
                  started={started}
                  bookingId={id}
                  onYes={(input) => {
                    const err = run(
                      (st) => cancelShipment(st, user, today, sh.id, input),
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
      {locked && (
        <p className="mt-1 text-sm text-muted">
          {cs.packing.cancel.locked}{' '}
          <Link to={`/vratka/${id}`} className="underline">
            {cs.issues.openVratka}
          </Link>
        </p>
      )}
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
