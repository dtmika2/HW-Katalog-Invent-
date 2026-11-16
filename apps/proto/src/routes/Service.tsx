import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  can,
  isOpenService,
  isServiceOverdue,
  setServiceStatus,
  type ServiceCase,
  type ServiceStatus,
} from '@quix/core';
import { CaseLabel, Empty, Field, Section } from '../components/ui';
import { cs, fmtDate } from '../i18n/cs';
import { caseNumber, itemName, userName, warehouseName } from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';

/** Status flow: Nahlášeno → Řeší se → V externím servisu / Čeká na díly → Vráceno – ke kontrole → Opraveno (or Odepsáno). */
const NEXT: Record<ServiceStatus, ServiceStatus[]> = {
  reported: ['in_progress', 'external', 'written_off'],
  in_progress: ['external', 'waiting_parts', 'back_to_check', 'fixed', 'written_off'],
  external: ['back_to_check', 'waiting_parts', 'written_off'],
  waiting_parts: ['in_progress', 'back_to_check', 'written_off'],
  back_to_check: ['fixed', 'in_progress', 'written_off'],
  fixed: [],
  written_off: [],
};

function Detail({ sc }: { sc: ServiceCase }) {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const [comment, setComment] = useState('');
  const [cost, setCost] = useState(sc.cost !== undefined ? String(sc.cost) : '');
  const [expected, setExpected] = useState(sc.expectedBack ?? '');
  const [responsible, setResponsible] = useState(sc.responsibleUserId);
  const may = can(user, 'manage_service') || sc.responsibleUserId === user.id;
  const b = sc.openedFromBookingId
    ? s.bookings.find((x) => x.id === sc.openedFromBookingId)
    : undefined;
  return (
    <section className="panel p-4" data-testid="service-detail">
      <h2>
        {sc.qty}× {itemName(s, sc.itemId)}
      </h2>
      <p className="text-sm text-muted">
        {warehouseName(s, sc.warehouseId)} · {cs.serviceUi.opened(fmtDate(sc.openedOn))}
        {sc.caseId && <> · {cs.serviceUi.inCase(caseNumber(s, sc.caseId))}</>}
        {b && (
          <>
            {' · '}
            <Link to={`/bookings/${b.id}`} className="underline">
              {cs.serviceUi.fromBooking(b.eventName)}
            </Link>
          </>
        )}
      </p>
      <p className="mt-2 text-sm">
        <span className="text-muted">{cs.serviceUi.reason}:</span> {sc.reason}
      </p>
      <p className="text-sm">
        {sc.internal ? cs.serviceUi.internal : cs.serviceUi.external(sc.repairShop ?? '')}
      </p>
      <p className="mt-2 font-cond text-lg font-bold">{cs.service.status[sc.status]}</p>
      {isServiceOverdue(sc, today) && (
        <p className="text-sm font-semibold text-bad">{cs.serviceUi.overdue}</p>
      )}
      {may && isOpenService(sc) && (
        <div className="mt-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label={cs.serviceUi.responsible} htmlFor="sv-resp">
              <select
                id="sv-resp"
                className="input"
                value={responsible}
                onChange={(e) => setResponsible(e.target.value)}
              >
                {s.users
                  .filter((u) => u.role !== 'pm')
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={cs.serviceUi.expected} htmlFor="sv-exp">
              <input
                id="sv-exp"
                type="date"
                className="input"
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
              />
            </Field>
            <Field label={cs.serviceUi.cost} htmlFor="sv-cost">
              <input
                id="sv-cost"
                type="number"
                min={0}
                className="input"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </Field>
          </div>
          <Field label={cs.serviceUi.comment} htmlFor="sv-comment">
            <input
              id="sv-comment"
              className="input"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>
          <p className="text-xs text-muted">{cs.serviceUi.fixedHint}</p>
          <div className="flex flex-wrap gap-2">
            {NEXT[sc.status].map((st) => (
              <button
                key={st}
                type="button"
                className={`btn btn-sm ${st === 'fixed' ? 'btn-primary' : st === 'written_off' ? 'btn-danger' : ''}`}
                onClick={() => {
                  const err = run((x) =>
                    setServiceStatus(x, user, today, sc.id, st, {
                      ...(comment.trim() ? { comment: comment.trim() } : {}),
                      ...(cost !== '' ? { cost: Number(cost) } : {}),
                      ...(expected ? { expectedBack: expected } : {}),
                      ...(responsible !== sc.responsibleUserId
                        ? { responsibleUserId: responsible }
                        : {}),
                    }),
                  );
                  if (!err) setComment('');
                }}
              >
                {cs.serviceUi.move(cs.service.status[st])}
              </button>
            ))}
          </div>
        </div>
      )}
      <h3 className="mt-4 text-sm font-semibold">{cs.serviceUi.history}</h3>
      <ol className="mt-1 space-y-1 text-sm">
        {sc.events.map((ev, i) => (
          <li key={i}>
            <span className="text-xs text-muted">{fmtDate(ev.on)}</span>{' '}
            {cs.service.status[ev.status]} — {userName(s, ev.userId)}
            {ev.comment && <span className="text-muted">: {ev.comment}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Service() {
  const s = useAppState();
  const today = useToday();
  const [all, setAll] = useState(false);
  const list = s.serviceCases.filter((sc) => all || isOpenService(sc));
  const [sel, setSel] = useState<string | undefined>(list[0]?.id);
  const selected = s.serviceCases.find((x) => x.id === sel);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1>{cs.serviceUi.title}</h1>
        <div className="flex gap-1">
          <button
            type="button"
            aria-pressed={!all}
            className={`btn btn-sm ${!all ? 'btn-primary' : ''}`}
            onClick={() => setAll(false)}
          >
            {cs.serviceUi.open}
          </button>
          <button
            type="button"
            aria-pressed={all}
            className={`btn btn-sm ${all ? 'btn-primary' : ''}`}
            onClick={() => setAll(true)}
          >
            {cs.serviceUi.all}
          </button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        {list.length === 0 ? (
          <Empty>{cs.serviceUi.empty}</Empty>
        ) : (
          <ul className="panel divide-y divide-alu-line" data-testid="service-list">
            {list.map((sc) => (
              <li key={sc.id}>
                <button
                  type="button"
                  onClick={() => setSel(sc.id)}
                  aria-current={sel === sc.id}
                  className={`w-full px-3 py-2 text-left text-sm ${sel === sc.id ? 'bg-tape-light' : 'hover:bg-alu'}`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {sc.qty}× {itemName(s, sc.itemId)}
                    </span>
                    {sc.caseId && <CaseLabel>{caseNumber(s, sc.caseId)}</CaseLabel>}
                    {isServiceOverdue(sc, today) && (
                      <span className="rounded bg-bad px-1.5 text-xs text-white">
                        {cs.serviceUi.overdue}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted">
                    {cs.service.status[sc.status]} · {userName(s, sc.responsibleUserId)} ·{' '}
                    {fmtDate(sc.expectedBack)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected ? (
          <Detail key={selected.id} sc={selected} />
        ) : (
          <Section title={cs.serviceUi.title}>
            <Empty>{cs.serviceUi.select}</Empty>
          </Section>
        )}
      </div>
    </div>
  );
}
