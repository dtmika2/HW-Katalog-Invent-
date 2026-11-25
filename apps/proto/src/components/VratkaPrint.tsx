/**
 * Counting sheet for vratka: what left and is still to come back, by shelf, with empty fields.
 * The numbers are entered in the app afterwards.
 */
import type { AppState, Booking, ReturnSheetLine } from '@quix/core';
import { cs, fmtDate, fmtRange } from '../i18n/cs';
import {
  bookingSpan,
  caseNumber,
  eventSpan,
  itemName,
  locationPath,
  warehouseName,
} from '../lib/names';
import { Bar, Paper, PaperHead, Signatures, usePrintTitle } from './print';

interface SheetRow {
  key: string;
  line: ReturnSheetLine;
  caseId?: string;
  locationId: string;
}

const Blank = () => <td className="border border-neutral-400" />;

function Head() {
  return (
    <thead>
      <tr className="text-left text-[8.5pt]">
        <th className="w-14 py-0.5 font-semibold">{cs.vratka.print.left}</th>
        <th className="py-0.5 font-semibold">{cs.vratka.print.item}</th>
        <th className="w-16 py-0.5 font-semibold">{cs.vratka.print.returned}</th>
        <th className="w-20 py-0.5 font-semibold">{cs.vratka.print.damaged}</th>
        <th className="w-[32%] py-0.5 font-semibold">{cs.common.note}</th>
      </tr>
    </thead>
  );
}

const cell = 'break-inside-avoid border border-neutral-400 px-1.5 py-1 align-top';

function CountRows({ s, r }: { s: AppState; r: SheetRow }) {
  const { line, caseId } = r;
  if (!caseId) {
    const hints = [
      line.shipped !== line.outstanding &&
        cs.vratka.print.already(line.returned, line.transferred, line.shipped),
      line.suggestedIntoCaseId && cs.vratka.print.intoCase(caseNumber(s, line.suggestedIntoCaseId)),
    ].filter(Boolean);
    return (
      <tr>
        <td className={`${cell} text-right font-bold`}>{line.outstanding}×</td>
        <td className={cell}>
          <span className="font-semibold">{line.name}</span>
          {hints.length > 0 && (
            <span className="block text-[8.5pt] text-neutral-600">{hints.join(' · ')}</span>
          )}
        </td>
        <Blank />
        <Blank />
        <Blank />
      </tr>
    );
  }
  const left = line.shippedContents[caseId] ?? line.contents ?? [];
  const lacked = (line.contents ?? []).filter(
    (c) => (left.find((x) => x.itemId === c.itemId)?.qty ?? 0) < c.qty,
  );
  return (
    <>
      <tr>
        <td className={`${cell} text-right font-bold`}>1×</td>
        <td className={cell} colSpan={4}>
          <span className="font-semibold">{line.name}</span>{' '}
          {cs.packing.print.caseNo(caseNumber(s, caseId))}
          {lacked.length > 0 && (
            <span className="block text-[8.5pt] text-neutral-600">
              {cs.vratka.shippedShort(
                lacked
                  .map(
                    (c) =>
                      `${c.qty - (left.find((x) => x.itemId === c.itemId)?.qty ?? 0)}× ${itemName(s, c.itemId)}`,
                  )
                  .join(', '),
              )}
            </span>
          )}
        </td>
      </tr>
      {left.map((c) => (
        <tr key={c.itemId}>
          <td className={`${cell} text-right`}>{c.qty}×</td>
          <td className={`${cell} pl-5`}>{itemName(s, c.itemId)}</td>
          <Blank />
          <Blank />
          <Blank />
        </tr>
      ))}
    </>
  );
}

function Table({ s, rows }: { s: AppState; rows: SheetRow[] }) {
  return (
    <table className="mb-2 w-full table-fixed border-collapse">
      <Head />
      {/* one body per row or case, so a case never loses its number to the previous page */}
      {rows.map((r) => (
        <tbody key={r.key} className="break-inside-avoid">
          <CountRows s={s} r={r} />
        </tbody>
      ))}
    </table>
  );
}

export function VratkaPrint({
  s,
  b,
  sheet,
}: {
  s: AppState;
  b: Booking;
  sheet: ReturnSheetLine[];
}) {
  usePrintTitle(cs.vratka.print.fileName(b.eventName));
  const pending = sheet.filter((l) => l.outcome !== 'consumable' && l.outstanding > 0);
  const settled = sheet.filter((l) => l.outcome !== 'consumable' && l.outstanding === 0);
  const external = pending.filter((l) => l.kind === 'external');

  // warehouse → shelf → rows; a case goes to its own shelf
  const byWarehouse = new Map<string, Map<string, SheetRow[]>>();
  for (const line of pending) {
    if (line.kind === 'external') continue;
    const w = line.expectedReturnWarehouseId ?? '';
    const shelves = byWarehouse.get(w) ?? new Map<string, SheetRow[]>();
    byWarehouse.set(w, shelves);
    const add = (r: SheetRow) =>
      shelves.set(r.locationId, [...(shelves.get(r.locationId) ?? []), r]);
    const fallback = line.suggestedLocationId ?? '';
    if (line.kind === 'case')
      for (const caseId of line.pendingCaseIds) {
        const c = s.cases.find((x) => x.id === caseId);
        add({
          key: `${line.lineId}-${caseId}`,
          line,
          caseId,
          locationId: c && c.warehouseId === w ? c.locationId : fallback,
        });
      }
    else add({ key: line.lineId, line, locationId: fallback });
  }
  const warehouses = [...byWarehouse].sort((a, z) =>
    warehouseName(s, a[0]).localeCompare(warehouseName(s, z[0]), 'cs'),
  );

  const event = eventSpan(b);
  const span = bookingSpan(b);
  const batches = s.shipments
    .filter((x) => x.bookingId === b.id)
    .map((x) => `${x.label} (${fmtDate(x.shippedOn)})`);
  const head = (title: string) => (
    <PaperHead
      s={s}
      b={b}
      doc={cs.vratka.print.docTitle}
      title={title}
      dates={[
        cs.packing.print.event(fmtRange(event.from, event.to)),
        cs.packing.print.back(fmtDate(span.to)),
        cs.vratka.print.batches(batches.join(', ')),
      ]}
    />
  );

  const end = (
    <>
      <Bar className="mt-3">{cs.vratka.unexpected}</Bar>
      <table className="w-full table-fixed border-collapse">
        <tbody>
          {[0, 1, 2].map((i) => (
            <tr key={i} className="h-7">
              <td className="w-14 border border-neutral-400" />
              <td className="border border-neutral-400" />
              <td className="w-[32%] border border-neutral-400" />
            </tr>
          ))}
        </tbody>
      </table>
      <Signatures labels={[cs.vratka.print.handedBy, cs.packing.print.takenBy, cs.common.date]} />
      <p className="mt-4 text-[8.5pt] text-neutral-600">{cs.vratka.print.enterNote}</p>
    </>
  );

  return (
    <Paper testId="vratka-print">
      {warehouses.length === 0 && head(cs.vratka.print.title)}
      {warehouses.map(([w, shelves], i) => (
        <section key={w} className={i > 0 ? 'break-before-page' : ''}>
          {head(cs.vratka.print.into(warehouseName(s, w)))}
          {[...shelves]
            .sort((a, z) => locationPath(s, a[0]).localeCompare(locationPath(s, z[0]), 'cs'))
            .map(([loc, rows]) => (
              <div key={loc || 'none'}>
                <Bar>{loc ? locationPath(s, loc) : cs.packing.noLocation}</Bar>
                <Table s={s} rows={rows} />
              </div>
            ))}
        </section>
      ))}
      {external.length > 0 && (
        <section>
          <Bar className="mt-3">{cs.vratka.print.external}</Bar>
          <table className="w-full table-fixed border-collapse">
            <tbody>
              {external.map((l) => {
                const t = b.lines.find((x) => x.id === l.lineId)?.target;
                const ext = t && 'external' in t ? t.external : undefined;
                return (
                  <tr key={l.lineId}>
                    <td className={`${cell} w-14 text-right font-bold`}>{l.outstanding}×</td>
                    <td className={cell}>
                      <span className="font-semibold">{l.name}</span>
                      {ext && (
                        <span className="block text-[8.5pt] text-neutral-600">
                          {cs.vratka.print.supplier(ext.supplier, fmtDate(ext.returnDate))}
                        </span>
                      )}
                    </td>
                    <td className="w-16 border border-neutral-400" />
                    <td className="w-20 border border-neutral-400" />
                    <td className="w-[32%] border border-neutral-400" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      {pending.length === 0 && <p>{cs.vratka.nothingPending}</p>}
      {settled.length > 0 && (
        <section className="mt-3 text-[9pt]">
          <Bar>{cs.vratka.settled}</Bar>
          <p>
            {settled
              .map((l) => `${l.shipped}× ${l.name} (${cs.vratka.outcome[l.outcome]})`)
              .join('; ')}
          </p>
        </section>
      )}
      {pending.length > 0 && end}
    </Paper>
  );
}
