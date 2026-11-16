import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  addDays,
  bookingPriceTotal,
  can,
  createBooking,
  diffDays,
  firstEventDay,
  periodWithBuffer,
  type AppState,
} from '@quix/core';
import { Field, PartlyShipped, StatusChip } from '../components/ui';
import { cs, fmtDate, fmtRange } from '../i18n/cs';
import { bookingSpan, clientName, userName } from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';

type Filter = 'active' | 'mine' | 'all';

export function Bookings() {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const [filter, setFilter] = useState<Filter>(user.role === 'pm' ? 'mine' : 'active');
  const list = s.bookings
    .filter((b) =>
      filter === 'mine'
        ? b.pmId === user.id
        : filter === 'active'
          ? !['closed', 'expired'].includes(b.status)
          : true,
    )
    .sort((a, b) => (bookingSpan(a).from < bookingSpan(b).from ? -1 : 1));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>{cs.bookings.title}</h1>
        <div className="flex gap-1" role="group">
          {(['active', 'mine', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`btn btn-sm ${filter === f ? 'btn-primary' : ''}`}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f === 'active'
                ? cs.bookings.filterActive
                : f === 'mine'
                  ? cs.bookings.filterMine
                  : cs.bookings.filterAll}
            </button>
          ))}
        </div>
      </div>
      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-alu-line text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">{cs.bookings.columns.event}</th>
              <th className="px-3 py-2 font-medium">{cs.bookings.columns.client}</th>
              <th className="px-3 py-2 font-medium">{cs.bookings.columns.pm}</th>
              <th className="px-3 py-2 font-medium">{cs.bookings.columns.dates}</th>
              <th className="px-3 py-2 font-medium">{cs.bookings.columns.state}</th>
              <th className="px-3 py-2 text-right font-medium">{cs.bookings.columns.price}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-alu-line">
            {list.map((b) => {
              const span = bookingSpan(b);
              const pre = b.type === 'prebooking' && ['draft', 'submitted'].includes(b.status);
              return (
                <tr key={b.id} className="hover:bg-alu/50">
                  <td className="px-3 py-2">
                    <Link
                      to={`/bookings/${b.id}`}
                      className="font-cond font-semibold hover:underline"
                    >
                      {b.eventName}
                    </Link>
                    {b.periods.length > 1 && (
                      <span className="ml-1 text-xs text-muted">×{b.periods.length}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{clientName(s, b.clientId)}</td>
                  <td className="px-3 py-2">{userName(s, b.pmId)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{fmtRange(span.from, span.to)}</td>
                  <td className="px-3 py-2">
                    <StatusChip status={b.status} /> <PartlyShipped s={s} b={b} />
                    {pre && (
                      <span className="ml-1 text-xs text-muted">
                        {cs.bookings.expiresIn(diffDays(today, firstEventDay(b)))}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {cs.common.czk(bookingPriceTotal(s, b))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function NewBooking() {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState(addDays(today, 14));
  const [to, setTo] = useState(addDays(today, 14));
  const [purpose, setPurpose] = useState('');
  const [wh, setWh] = useState(s.warehouses[0]?.id ?? '');
  const [pmId, setPmId] = useState(
    user.role === 'pm' ? user.id : (s.users.find((u) => u.role === 'pm')?.id ?? user.id),
  );
  if (!can(user, 'create_booking'))
    return <p className="text-sm text-muted">{cs.errors.forbidden}</p>;
  const pms = s.users.filter((u) => u.role === 'pm' && u.active);
  return (
    <form
      className="panel mx-auto max-w-2xl space-y-3 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        let newId = '';
        const err = run((st: AppState) => {
          const r = createBooking(st, user, today, {
            eventName: name,
            purposeMessage: purpose,
            periods: [periodWithBuffer(from, to < from ? from : to, st.settings)],
            defaultWarehouseId: wh,
            ...(clientId ? { clientId } : {}),
            ...(user.role === 'chief' ? { pmId } : {}),
          });
          if (!r.ok) return r;
          newId = r.value.bookingId;
          return { ok: true, value: r.value.state };
        });
        if (!err) navigate(`/bookings/${newId}`);
      }}
    >
      <h1>{cs.newBooking.title}</h1>
      <Field label={cs.newBooking.eventName} htmlFor="nb-name">
        <input
          id="nb-name"
          className="input"
          required
          placeholder={cs.newBooking.eventNameHint}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={cs.newBooking.eventFrom} htmlFor="nb-from">
          <input
            id="nb-from"
            type="date"
            className="input"
            required
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label={cs.newBooking.eventTo} htmlFor="nb-to">
          <input
            id="nb-to"
            type="date"
            className="input"
            required
            min={from}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>
      <p className="text-xs text-muted">
        {cs.newBooking.bufferHint(s.settings.bufferBeforeDays, s.settings.bufferAfterDays)}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={cs.common.client} htmlFor="nb-client">
          <select
            id="nb-client"
            className="input"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">{cs.common.none}</option>
            {s.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={cs.newBooking.warehouse} htmlFor="nb-wh">
          <select id="nb-wh" className="input" value={wh} onChange={(e) => setWh(e.target.value)}>
            {s.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {user.role === 'chief' && (
        <Field label={cs.newBooking.pmFor} htmlFor="nb-pm">
          <select
            id="nb-pm"
            className="input"
            value={pmId}
            onChange={(e) => setPmId(e.target.value)}
          >
            {pms.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={cs.newBooking.purpose} htmlFor="nb-purpose">
        <textarea
          id="nb-purpose"
          className="input"
          rows={2}
          placeholder={cs.newBooking.purposeHint}
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
        />
      </Field>
      <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
        {cs.newBooking.create}
      </button>
    </form>
  );
}

export function Notifications() {
  const s = useAppState();
  const user = useUser();
  const markAllRead = useProto((p) => p.markAllRead);
  const mine = s.notifications
    .filter((n) => n.userId === user.id)
    .slice()
    .reverse();
  const itemNameOf = (id: string | number | undefined) => s.items.find((i) => i.id === id)?.name;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1>{cs.notifications.title}</h1>
        <button type="button" className="btn btn-sm" onClick={markAllRead}>
          {cs.notifications.markAll}
        </button>
      </div>
      {mine.length === 0 ? (
        <p className="text-sm text-muted">{cs.notifications.empty}</p>
      ) : (
        <ul data-testid="notifications" className="panel divide-y divide-alu-line">
          {mine.map((n) => {
            const params = { ...n.params, itemName: itemNameOf(n.params.itemId) ?? '' };
            const text = cs.notifications.types[n.type](params);
            return (
              <li
                key={n.id}
                className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${n.read ? 'text-muted' : 'font-medium'}`}
              >
                <span className="w-24 shrink-0 text-xs text-muted">{fmtDate(n.on)}</span>
                {n.highPriority && (
                  <span className="rounded bg-bad px-1.5 text-xs text-white">
                    {cs.notifications.highPriority}
                  </span>
                )}
                {n.bookingId ? (
                  <Link to={`/bookings/${n.bookingId}`} className="hover:underline">
                    {text}
                  </Link>
                ) : (
                  <span>{text}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
