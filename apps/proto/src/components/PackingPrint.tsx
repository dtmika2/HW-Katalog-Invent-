/**
 * Paper version of the packing list. Only visible in print, where the browser offers
 * "Save as PDF"; no PDF library is needed.
 */
import { useEffect, type ReactNode } from 'react';
import type { AppState, Booking, PackingList, PackLine } from '@quix/core';
import { cs, fmtDate, fmtRange } from '../i18n/cs';
import {
  bookingSpan,
  caseNumber,
  eventSpan,
  itemName,
  locationPath,
  userName,
  warehouseName,
} from '../lib/names';

const Box = () => (
  <span
    aria-hidden="true"
    className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 border border-black"
  />
);

function Row({ children, qty, done }: { children: ReactNode; qty: string; done?: boolean }) {
  return (
    <li className="flex break-inside-avoid items-start gap-2 border-b border-neutral-300 py-1">
      <Box />
      <span className="w-10 shrink-0 text-right font-bold">{qty}</span>
      <span className={`min-w-0 flex-1 ${done ? 'text-neutral-500' : ''}`}>{children}</span>
    </li>
  );
}

function Hints({ l }: { l: PackLine }) {
  return (
    <span className="block text-[9pt] text-neutral-600">
      {[
        l.forHint.length > 0 &&
          cs.editor.forHint(l.forHint.map((h) => `${h.name} ×${h.qty}`).join(', ')),
        l.consumable && cs.packing.consumable,
        l.shipped > 0 && cs.packing.print.alreadyOut(l.shipped, l.qty),
      ]
        .filter(Boolean)
        .join(' · ')}
    </span>
  );
}

/** One block per physical case, so its contents can be ticked box by box. */
function CaseRows({ s, l, ids }: { s: AppState; l: PackLine; ids: string[] }) {
  return (
    <>
      {Array.from({ length: l.qty }, (_, i) => (
        <Row key={i} qty="1×" done={i < l.shipped}>
          <span className="font-semibold">{l.name}</span>{' '}
          {cs.packing.print.caseNo(ids[i] ? caseNumber(s, ids[i]) : '')}
          <ul className="ml-1 mt-0.5">
            {(l.contents ?? []).map((c) => (
              <li key={c.itemId} className="flex items-start gap-2">
                <Box />
                <span>
                  {c.qty}× {itemName(s, c.itemId)}
                </span>
              </li>
            ))}
          </ul>
          {i === 0 && <Hints l={l} />}
        </Row>
      ))}
    </>
  );
}

export function PackingPrint({
  s,
  b,
  list,
  pickedCases,
}: {
  s: AppState;
  b: Booking;
  list: PackingList;
  /** Case numbers chosen on the screen, not shipped yet. */
  pickedCases: Record<string, string[]>;
}) {
  // The document title is the suggested file name in the print dialog.
  useEffect(() => {
    let before: string | undefined;
    const on = () => {
      before = document.title;
      document.title = cs.packing.print
        .fileName(b.eventName)
        .replace(/[\\/:*?"<>|]/g, ' ')
        .trim();
    };
    const off = () => {
      if (before !== undefined) document.title = before;
      before = undefined;
    };
    globalThis.addEventListener('beforeprint', on);
    globalThis.addEventListener('afterprint', off);
    return () => {
      globalThis.removeEventListener('beforeprint', on);
      globalThis.removeEventListener('afterprint', off);
      off();
    };
  }, [b.eventName]);

  const client = s.clients.find((c) => c.id === b.clientId);
  const event = eventSpan(b);
  const span = bookingSpan(b);
  const caseIds = (l: PackLine) => [
    ...s.shipments
      .filter((x) => x.bookingId === b.id)
      .flatMap((x) => x.lines.filter((y) => y.lineId === l.lineId).flatMap((y) => y.caseIds ?? [])),
    ...(pickedCases[l.lineId] ?? []),
  ];
  const row = (l: PackLine) =>
    l.kind === 'case' ? (
      <CaseRows key={l.lineId} s={s} l={l} ids={caseIds(l)} />
    ) : (
      <Row key={l.lineId} qty={`${l.qty}×`} done={l.remaining === 0}>
        <span className="font-semibold">{l.name}</span>
        <Hints l={l} />
      </Row>
    );
  const head = (title: string) => (
    <header className="mb-3 border-b-2 border-black pb-2">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-cond text-[18pt] font-bold leading-tight">{b.eventName}</p>
        <p className="shrink-0 text-[9pt]">{cs.packing.print.docTitle}</p>
      </div>
      <p className="font-cond text-[13pt] font-bold">{title}</p>
      <p className="text-[9pt]">
        {cs.packing.print.event(fmtRange(event.from, event.to))} ·{' '}
        {cs.packing.print.loading(fmtDate(span.from))} · {cs.packing.print.back(fmtDate(span.to))}
      </p>
      <p className="text-[9pt]">
        {cs.common.pm}: {userName(s, b.pmId)}
        {client &&
          ` · ${cs.common.client}: ${[client.name, client.contactPerson, client.phone].filter(Boolean).join(', ')}`}
        {` · ${cs.status[b.status]}`}
      </p>
    </header>
  );
  const sign = (
    <footer className="mt-14 grid break-inside-avoid grid-cols-3 gap-6 text-[9pt]">
      {[cs.packing.print.handedBy, cs.packing.print.takenBy, cs.common.date].map((x) => (
        <p key={x} className="border-t border-black pt-1">
          {x}
        </p>
      ))}
    </footer>
  );
  const extra = list.external.length > 0 || list.transfers.length > 0;
  return (
    <div data-testid="packing-print" className="hidden text-[10.5pt] text-black print:block">
      {list.byWarehouse.map((w, i) => (
        <section key={w.warehouseId} className={i > 0 ? 'break-before-page' : ''}>
          {head(cs.packing.warehouse(warehouseName(s, w.warehouseId)))}
          {w.groups.map((g) => (
            <div key={g.locationId ?? 'none'} className="mb-2">
              <p className="break-after-avoid bg-neutral-200 px-1 text-[9pt] font-semibold">
                {g.locationId ? locationPath(s, g.locationId) : cs.packing.noLocation}
              </p>
              <ul>{g.lines.map(row)}</ul>
            </div>
          ))}
          {sign}
        </section>
      ))}
      {extra && (
        <section className={list.byWarehouse.length > 0 ? 'mt-6 break-inside-avoid' : ''}>
          {list.byWarehouse.length === 0 && head(cs.packing.print.outside)}
          {list.external.length > 0 && (
            <>
              <p className="bg-neutral-200 px-1 text-[9pt] font-semibold">{cs.packing.external}</p>
              <ul>{list.external.map(row)}</ul>
            </>
          )}
          {list.transfers.length > 0 && (
            <>
              <p className="mt-2 bg-neutral-200 px-1 text-[9pt] font-semibold">
                {cs.packing.transfers}
              </p>
              <ul>
                {list.transfers.map((l) => (
                  <Row key={l.lineId} qty={`${l.qty}×`}>
                    {l.name} —{' '}
                    {cs.packing.transferFrom(
                      s.bookings.find((x) => x.id === l.fromBookingId)?.eventName ?? '',
                    )}
                  </Row>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
