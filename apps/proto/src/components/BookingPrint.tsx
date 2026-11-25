/**
 * Sheet of a pre-booking or order for the PM and the Chief: the list of gear, optionally with
 * indicative prices and with internal details (sources, shortages, reasons). Without internal
 * details it can be handed to the client.
 */
import {
  bookingPriceTotal,
  effectiveQty,
  eventDays,
  flattenNodes,
  linePriceDay,
  lineTree,
  resolveSourceWarehouse,
  type AppState,
  type Booking,
  type BookingLine,
  type LineAvailability,
  type LineConflict,
} from '@quix/core';
import { cs, fmtDate, fmtRange, fmtShort } from '../i18n/cs';
import { caseTypeName, itemName, lineName, warehouseName } from '../lib/names';
import { loanLine } from './Loans';
import { Bar, Paper, PaperHead, Signatures, usePrintTitle } from './print';

function Internal({
  s,
  b,
  line,
  a,
  conflict,
}: {
  s: AppState;
  b: Booking;
  line: BookingLine;
  a: LineAvailability | undefined;
  conflict: LineConflict | undefined;
}) {
  const t = line.target;
  const from = line.fromBookingId
    ? cs.editor.sourceFromBooking(
        s.bookings.find((x) => x.id === line.fromBookingId)?.eventName ?? '',
      )
    : 'external' in t
      ? cs.editor.externalFrom(t.external.supplier)
      : warehouseName(s, resolveSourceWarehouse(s, b, line));
  const orders = conflict?.colliding.filter((x) => x.type === 'order') ?? [];
  const loans = s.loans.filter((l) => conflict?.loanIds.includes(l.id));
  return (
    <span className="block text-[8.5pt] text-neutral-700">
      {cs.editor.source}: {from}
      {conflict && (
        <strong className="block">
          {cs.badge.red(conflict.short, 'caseTypeId' in t)} (
          {conflict.days.map((d) => fmtShort(d)).join(', ')})
          {orders.length > 0 &&
            `, ${cs.editor.print.heldBy(orders.map((x) => x.eventName).join(', '))}`}
          {loans.length > 0 &&
            `, ${cs.loans.alsoLoaned} ${loans.map((l) => loanLine(s, l)).join('; ')}`}
        </strong>
      )}
      {a?.breaksCase && (
        <span className="block">
          {cs.badge.breaksCase(caseTypeName(s, a.breaksCase.caseTypeId))}
        </span>
      )}
      {(['likely', 'possible'] as const).map((tier) => {
        const x = a?.[tier];
        return (
          x && (
            <span key={tier} className="block">
              {cs.badge[tier](x.short, 'caseTypeId' in t)} (
              {x.days.map((d) => fmtShort(d)).join(', ')},{' '}
              {x.bookingIds
                .map((id) => s.bookings.find((y) => y.id === id)?.eventName ?? '')
                .join(', ')}
              )
            </span>
          )
        );
      })}
      {line.overrideReason?.trim() && (
        <span className="block">{cs.editor.print.override(line.overrideReason.trim())}</span>
      )}
      {line.note?.trim() && <span className="block">{line.note.trim()}</span>}
    </span>
  );
}

export function BookingPrint({
  s,
  b,
  av,
  conflicts,
  openChoices,
  prices,
  internal,
  dirty,
}: {
  s: AppState;
  b: Booking;
  av: Map<string, LineAvailability>;
  conflicts: LineConflict[];
  /** Items whose "choose one" option is still open. */
  openChoices: string[];
  prices: boolean;
  internal: boolean;
  dirty: boolean;
}) {
  const kind = cs.bookingType[b.type];
  usePrintTitle(cs.editor.print.fileName(kind, b.eventName));
  const days = eventDays(b);
  const tree = lineTree(b);
  const all = tree.flatMap((g) => flattenNodes(g.roots));
  const grouped = tree.some((g) => g.group);
  const listed = ({ line }: { line: BookingLine }) =>
    line.status === 'ok' && effectiveQty(line) > 0;
  const rows = all.filter(listed);
  const refused = all.filter(({ line }) => line.status !== 'ok');
  const cell = 'border-b border-neutral-300 py-1 align-top';
  return (
    <Paper testId="booking-print">
      <PaperHead
        s={s}
        b={b}
        doc={cs.editor.print.docTitle}
        title={kind}
        dates={b.periods.map((p) =>
          cs.editor.print.period(
            fmtRange(p.eventFrom, p.eventTo),
            fmtRange(p.bookedFrom, p.bookedUntil),
          ),
        )}
      />
      {b.purposeMessage.trim() && (
        <p className="mb-2">
          <span className="font-semibold">{cs.editor.purpose}:</span> {b.purposeMessage.trim()}
        </p>
      )}
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-neutral-200 text-left text-[9pt]">
            <th className="w-12 px-1 py-0.5 text-right font-semibold">{cs.common.qty}</th>
            <th className="px-2 py-0.5 font-semibold">{cs.vratka.print.item}</th>
            {prices && (
              <>
                <th className="w-28 px-1 py-0.5 text-right font-semibold">
                  {cs.editor.print.perDay}
                </th>
                <th className="w-32 px-1 py-0.5 text-right font-semibold">
                  {cs.editor.print.sum(days)}
                </th>
              </>
            )}
          </tr>
        </thead>
        {tree.map((g) => {
          const part = flattenNodes(g.roots).filter(listed);
          if (part.length === 0) return null;
          return (
            <tbody key={g.group?.id ?? 'none'}>
              {grouped && (
                <tr className="break-after-avoid">
                  <td
                    colSpan={prices ? 3 : 2}
                    className="px-1 pb-0.5 pt-3 font-cond text-[12pt] font-bold"
                  >
                    {g.group?.name ?? cs.lines.noGroup}
                  </td>
                  {prices && (
                    <td className="whitespace-nowrap px-1 pb-0.5 pt-3 text-right font-semibold">
                      {cs.common.czk(
                        bookingPriceTotal(s, {
                          periods: b.periods,
                          lines: part.map((n) => n.line),
                        }),
                      )}
                    </td>
                  )}
                </tr>
              )}
              {part.map(({ line, depth }) => {
                const qty = effectiveQty(line);
                const day = linePriceDay(s, line);
                const t = line.target;
                const contents =
                  'caseTypeId' in t
                    ? (s.caseTypes.find((x) => x.id === t.caseTypeId)?.contents ?? [])
                    : [];
                return (
                  <tr key={line.id} className="break-inside-avoid">
                    <td className={`${cell} px-1 text-right font-bold`}>{qty}×</td>
                    <td className={`${cell} px-2`} style={{ paddingLeft: `${0.5 + depth}rem` }}>
                      <span className={depth === 0 ? 'font-semibold' : ''}>
                        {lineName(s, line)}
                      </span>
                      {'external' in t && ` (${cs.editor.externalTag})`}
                      {contents.length > 0 && (
                        <span className="block text-[8.5pt] text-neutral-600">
                          {contents.map((c) => `${c.qty}× ${itemName(s, c.itemId)}`).join(', ')}
                        </span>
                      )}
                      {internal && (
                        <Internal
                          s={s}
                          b={b}
                          line={line}
                          a={av.get(line.id)}
                          conflict={conflicts.find((c) => c.lineId === line.id)}
                        />
                      )}
                    </td>
                    {prices &&
                      ('external' in t ? (
                        <td className={`${cell} px-1 text-right text-[9pt]`} colSpan={2}>
                          {cs.editor.print.externalPrice}
                        </td>
                      ) : (
                        <>
                          <td className={`${cell} whitespace-nowrap px-1 text-right`}>
                            {cs.common.czk(day / qty)}
                          </td>
                          <td className={`${cell} whitespace-nowrap px-1 text-right`}>
                            {cs.common.czk(day * days)}
                          </td>
                        </>
                      ))}
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
      {rows.length === 0 && <p className="py-2">{cs.editor.print.empty}</p>}
      {prices && rows.length > 0 && (
        <div className="mt-2 flex break-inside-avoid items-baseline justify-between border-t-2 border-black pt-1">
          <span className="text-[9pt]">
            {cs.editor.priceTotal} ({cs.editor.priceHint(days)}). {cs.editor.print.notBinding}
          </span>
          <span className="whitespace-nowrap font-cond text-[15pt] font-bold">
            {cs.common.czk(bookingPriceTotal(s, b))}
          </span>
        </div>
      )}
      {internal && openChoices.length > 0 && (
        <p className="mt-3 text-[9pt] font-semibold">
          {cs.editor.print.openChoices(openChoices.join(', '))}
        </p>
      )}
      {internal && refused.length > 0 && (
        <section className="mt-3 break-inside-avoid">
          <Bar>{cs.editor.print.refused}</Bar>
          <ul className="text-[9pt]">
            {refused.map(({ line }) => (
              <li key={line.id}>
                {effectiveQty(line)}× {lineName(s, line)}:{' '}
                {line.status === 'missing' ? cs.editor.statusMissing : cs.editor.statusSubstituted}
                {line.note?.trim() && ` (${line.note.trim()})`}
              </li>
            ))}
          </ul>
        </section>
      )}
      {internal && (
        <Signatures
          labels={[cs.editor.print.askedBy, cs.editor.print.approvedBy, cs.common.date]}
        />
      )}
      <p className="mt-4 text-[8.5pt] text-neutral-600">
        {dirty && `${cs.editor.print.unsaved} `}
        {internal && `${cs.editor.print.internalNote} `}
        {b.confirmedOn && cs.editor.print.confirmedOn(fmtDate(b.confirmedOn))}
      </p>
    </Paper>
  );
}
