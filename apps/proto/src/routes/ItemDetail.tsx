import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  addDays,
  can,
  caseMissing,
  caseTypesContaining,
  isCaseComplete,
  isOpenService,
  looseStock,
  openServiceCase,
  usedBy,
  type AppState,
  type Connection,
} from '@quix/core';
import { AvailabilityCalendar } from '../components/AvailabilityCalendar';
import { CaseLabel, Empty, Field, Section } from '../components/ui';
import { cs, fmtDate } from '../i18n/cs';
import { itemName, locationPath, targetName, userName } from '../lib/names';
import { useAppState, useProto, useToday, useUser } from '../store';
import { CaseEditor, ItemEditPanels } from './ItemEdit';

function ConnectionList({ s, list, from }: { s: AppState; list: Connection[]; from: boolean }) {
  if (list.length === 0) return <Empty>{cs.catalog.noConnections}</Empty>;
  const kinds = ['required', 'check', 'recommended'] as const;
  return (
    <div className="space-y-3">
      {kinds.map((k) => {
        const conns = list.filter((c) => c.kind === k);
        if (conns.length === 0) return null;
        return (
          <div key={k}>
            <h3 className="text-sm font-semibold">{cs.catalog.kind[k]}</h3>
            <ul className="mt-1 space-y-0.5 text-sm">
              {conns.map((c) => (
                <li key={c.id}>
                  {from ? (
                    'itemId' in c.target ? (
                      <Link className="underline" to={`/items/${c.target.itemId}`}>
                        {targetName(s, c.target)}
                      </Link>
                    ) : (
                      <Link className="underline" to={`/case-types/${c.target.caseTypeId}`}>
                        {targetName(s, c.target)}
                      </Link>
                    )
                  ) : (
                    <Link className="underline" to={`/items/${c.fromItemId}`}>
                      {itemName(s, c.fromItemId)}
                    </Link>
                  )}
                  <span className="ml-2 text-xs text-muted">
                    {cs.catalog.rule(c.rule, c.n, c.qty)}
                    {c.groupMode === 'or' || c.parentGroupId ? ` · ${cs.catalog.groupOr}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function FaultForm({ itemId }: { itemId: string }) {
  const s = useAppState();
  const user = useUser();
  const today = useToday();
  const run = useProto((p) => p.run);
  const stocked = s.stock.filter((x) => x.itemId === itemId && x.qty > 0);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState('');
  const [wh, setWh] = useState(stocked[0]?.warehouseId ?? '');
  const [back, setBack] = useState(addDays(today, 14));
  const [caseId, setCaseId] = useState('');
  const cases = s.cases.filter(
    (c) => c.warehouseId === wh && !c.archived && c.contents.some((x) => x.itemId === itemId),
  );
  if (!open) {
    return (
      <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
        {cs.catalog.reportFault}
      </button>
    );
  }
  return (
    <form
      className="panel grid gap-2 p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const err = run((st) => {
          const r = openServiceCase(st, user, today, {
            itemId,
            warehouseId: wh,
            qty,
            reason,
            expectedBack: back,
            ...(caseId ? { caseId } : {}),
          });
          return r.ok ? { ok: true, value: r.value.state } : r;
        }, cs.catalog.faultDone);
        if (!err) {
          setOpen(false);
          setReason('');
        }
      }}
    >
      <Field label={cs.catalog.faultQty} htmlFor="f-qty">
        <input
          id="f-qty"
          type="number"
          min={1}
          className="input"
          value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
        />
      </Field>
      <Field label={cs.catalog.faultWarehouse} htmlFor="f-wh">
        <select id="f-wh" className="input" value={wh} onChange={(e) => setWh(e.target.value)}>
          {stocked.map((x) => (
            <option key={x.warehouseId} value={x.warehouseId}>
              {s.warehouses.find((w) => w.id === x.warehouseId)?.name}
            </option>
          ))}
        </select>
      </Field>
      {cases.length > 0 && (
        <Field label={cs.catalog.faultCase} htmlFor="f-case">
          <select
            id="f-case"
            className="input"
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
          >
            <option value="">{cs.catalog.faultNoCase}</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.number}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={cs.catalog.faultReason} htmlFor="f-reason">
        <input
          id="f-reason"
          className="input"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <Field label={cs.catalog.faultExpected} htmlFor="f-back">
        <input
          id="f-back"
          type="date"
          className="input"
          value={back}
          onChange={(e) => setBack(e.target.value)}
        />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={!reason.trim()}>
          {cs.catalog.faultSubmit}
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          {cs.common.cancel}
        </button>
      </div>
    </form>
  );
}

export function ItemDetail() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const s = useAppState();
  const today = useToday();
  const user = useUser();
  const item = s.items.find((i) => i.id === id);
  if (!item) return <Empty>{cs.errors.not_found}</Empty>;
  const stock = s.stock.filter((x) => x.itemId === id);
  const services = s.serviceCases.filter((sc) => sc.itemId === id);
  const types = caseTypesContaining(s, id);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded border border-alu-line bg-white text-xs text-muted">
          {item.photos?.[0] ? (
            <img src={item.photos[0]} alt={item.name} className="h-full w-full object-cover" />
          ) : (
            cs.catalog.noPhoto
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">
            {item.manufacturer} · {item.model} ·{' '}
            {s.categories.find((c) => c.id === item.categoryId)?.name}
          </p>
          <h1>{item.name}</h1>
          <p className="mt-1 text-sm">
            {cs.catalog.perDay(cs.common.czk(item.priceDay))}
            {item.weightKg !== undefined && (
              <span className="ml-3 text-muted">{cs.catalog.weight(item.weightKg)}</span>
            )}
            {!item.returnable && <span className="ml-3 text-warn">{cs.catalog.consumable}</span>}
          </p>
          {item.notes && <p className="mt-1 text-sm text-muted">{item.notes}</p>}
        </div>
        <FaultForm itemId={id} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title={cs.catalog.stock}>
          <ul className="space-y-2 text-sm">
            {stock.map((st) => {
              const oos = services
                .filter((sc) => sc.warehouseId === st.warehouseId && isOpenService(sc))
                .reduce((n, sc) => n + sc.qty, 0);
              const loose = looseStock(s, id, st.warehouseId);
              return (
                <li key={st.warehouseId}>
                  <span className="font-semibold">
                    {cs.catalog.stockSplit(
                      s.warehouses.find((w) => w.id === st.warehouseId)?.name ?? '',
                      st.qty,
                    )}
                  </span>
                  {oos > 0 && (
                    <span className="ml-2 text-xs text-bad">{cs.catalog.inService(oos)}</span>
                  )}
                  <span className="block text-xs text-muted">
                    {locationPath(s, st.homeLocationId)}
                  </span>
                  {types.length > 0 && (
                    <span className="block text-xs text-muted">
                      {cs.catalog.looseVsCases(loose, st.qty - loose)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {types.length > 0 && (
            <p className="mt-3 text-sm">
              {cs.catalog.caseIn('')}
              {types.map((t) => (
                <Link key={t.id} to={`/case-types/${t.id}`} className="ml-1 underline">
                  {t.name}
                </Link>
              ))}
            </p>
          )}
        </Section>
        <Section title={cs.catalog.connectionsOut}>
          <ConnectionList s={s} list={s.connections.filter((c) => c.fromItemId === id)} from />
        </Section>
        <Section title={cs.catalog.connectionsIn}>
          <ConnectionList s={s} list={usedBy(s, { itemId: id })} from={false} />
        </Section>
      </div>

      {can(user, 'edit_catalogue') && <ItemEditPanels item={item} />}

      <Section title={cs.catalog.calendar}>
        <AvailabilityCalendar
          s={s}
          target={{ itemId: id }}
          today={today}
          initialMonth={params.get('month') ?? undefined}
        />
      </Section>

      <Section title={cs.catalog.serviceHistory}>
        {services.length === 0 ? (
          <Empty>{cs.common.empty}</Empty>
        ) : (
          <ul className="space-y-1 text-sm">
            {services.map((sc) => (
              <li key={sc.id}>
                <Link to="/service" className="underline">
                  {sc.qty}× {sc.reason}
                </Link>{' '}
                <span className="text-xs text-muted">
                  {cs.service.status[sc.status]} · {fmtDate(sc.openedOn)} ·{' '}
                  {userName(s, sc.responsibleUserId)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export function CaseTypeDetail() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const s = useAppState();
  const today = useToday();
  const user = useUser();
  const t = s.caseTypes.find((x) => x.id === id);
  if (!t) return <Empty>{cs.errors.not_found}</Empty>;
  const cases = s.cases.filter((c) => c.caseTypeId === id && !c.archived);
  return (
    <div className="space-y-4">
      <h1>
        {t.name} <CaseLabel>{cs.editor.caseTag}</CaseLabel>
      </h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={cs.catalog.contents}>
          <ul className="text-sm">
            {t.contents.map((c) => (
              <li key={c.itemId}>
                {c.qty}×{' '}
                <Link to={`/items/${c.itemId}`} className="underline">
                  {itemName(s, c.itemId)}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
        <Section title={cs.catalog.caseList}>
          <ul className="space-y-1 text-sm" data-testid="case-list">
            {cases.map((c) => {
              const missing = caseMissing(s, c);
              const complete = isCaseComplete(s, c);
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-2">
                  <CaseLabel>{c.number}</CaseLabel>
                  <span className="text-xs text-muted">{locationPath(s, c.locationId)}</span>
                  {complete ? (
                    <span className="text-xs text-ok">{cs.catalog.complete}</span>
                  ) : (
                    <span className="text-xs text-bad">
                      {cs.catalog.incomplete(
                        missing.length
                          ? missing.map((m) => `${m.qty}× ${itemName(s, m.itemId)}`).join(', ')
                          : cs.calendar.legendService,
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      </div>
      {can(user, 'edit_catalogue') && <CaseEditor type={t} />}
      <Section title={cs.catalog.calendar}>
        <AvailabilityCalendar
          s={s}
          target={{ caseTypeId: id }}
          today={today}
          initialMonth={params.get('month') ?? undefined}
        />
      </Section>
    </div>
  );
}
