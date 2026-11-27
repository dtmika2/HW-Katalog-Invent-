/** "Spočítat pódium": decks, legs, skirts, rails and stairs for a size in millimetres. */
import { useMemo, useState } from 'react';
import {
  addStage,
  parseStageSize,
  planStage,
  stageParts,
  type Booking,
  type StageInput,
  type StageLayout,
} from '@quix/core';
import { cs } from '../i18n/cs';
import { itemName } from '../lib/names';
import { useAppState, useProto } from '../store';
import { Field } from './ui';

export function StagePlanner({
  booking,
  onAdd,
}: {
  /** The booking as edited (with its auto lines). */
  booking: Booking;
  onAdd: (b: Booking) => void;
}) {
  const s = useAppState();
  const [open, setOpen] = useState(false);
  const parts = useMemo(() => stageParts(s), [s]);
  if (parts.decks.length === 0) return null;
  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          {cs.stagePlan.button}
        </button>
        <span className="text-xs text-muted">{cs.stagePlan.hint}</span>
      </div>
    );
  return <PlannerForm booking={booking} onAdd={onAdd} onClose={() => setOpen(false)} />;
}

const mm = (l: { widthMm: number; depthMm: number }) => cs.stagePlan.mm(l.widthMm, l.depthMm);

function PlannerForm({
  booking,
  onAdd,
  onClose,
}: {
  booking: Booking;
  onAdd: (b: Booking) => void;
  onClose: () => void;
}) {
  const s = useAppState();
  const toast = useProto((p) => p.toast);
  const parts = useMemo(() => stageParts(s), [s]);
  const [text, setText] = useState('');
  const [deckId, setDeckId] = useState(parts.decks[0]?.id ?? '');
  const [legId, setLegId] = useState(parts.legs[0]?.id ?? '');
  const [skirt, setSkirt] = useState(parts.skirts.length > 0);
  const [rail, setRail] = useState(false);
  const [stairs, setStairs] = useState(parts.stairs.length > 0 ? 1 : 0);
  const [round, setRound] = useState<'up' | 'down'>('up');

  const size = parseStageSize(text);
  const input: StageInput | undefined = size && {
    ...size,
    deckId,
    ...(legId ? { legId } : {}),
    skirt,
    rail,
    stairs,
    round,
  };
  const plan = useMemo(
    () => (input ? planStage(s, booking, input) : undefined),
    // the input object is new on every render; its parts are what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, booking, size?.widthMm, size?.depthMm, deckId, legId, skirt, rail, stairs, round],
  );
  const deck = parts.decks.find((d) => d.id === deckId);
  const short = plan?.needs.some((n) => n.qty + n.onBooking > n.free);

  return (
    <section data-testid="stage-planner" className="panel space-y-3 p-4">
      <h2>{cs.stagePlan.title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={cs.stagePlan.size} htmlFor="sp-size">
          <input
            id="sp-size"
            className="input"
            autoFocus
            inputMode="numeric"
            placeholder={cs.stagePlan.sizeHint}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setRound('up');
            }}
          />
          {text.trim() && !size && <p className="mt-1 text-xs text-bad">{cs.stagePlan.sizeBad}</p>}
        </Field>
        {parts.decks.length > 1 && (
          <Field label={cs.stagePlan.deck} htmlFor="sp-deck">
            <select
              id="sp-deck"
              className="input"
              value={deckId}
              onChange={(e) => setDeckId(e.target.value)}
            >
              {parts.decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={cs.stagePlan.legs} htmlFor="sp-legs">
          <select
            id="sp-legs"
            className="input"
            value={legId}
            onChange={(e) => setLegId(e.target.value)}
          >
            {parts.legs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
            <option value="">{cs.stagePlan.noLegs}</option>
          </select>
        </Field>
        <Field label={cs.stagePlan.stairs} htmlFor="sp-stairs">
          <input
            id="sp-stairs"
            className="input w-24"
            type="number"
            min={0}
            max={20}
            value={stairs}
            disabled={parts.stairs.length === 0}
            onChange={(e) => setStairs(Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {parts.skirts.length > 0 && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={skirt} onChange={(e) => setSkirt(e.target.checked)} />
            {cs.stagePlan.skirt}
          </label>
        )}
        {parts.rails.length > 0 && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={rail} onChange={(e) => setRail(e.target.checked)} />
            {cs.stagePlan.rail}
          </label>
        )}
      </div>

      {plan && deck && (
        <div data-testid="stage-result" className="space-y-3 border-t border-alu-line pt-3">
          {plan.other ? (
            <fieldset className="space-y-1 text-sm">
              <legend className="mb-1">{cs.stagePlan.notExact(mm(deck.stage))}</legend>
              {(round === 'up' ? [plan.layout, plan.other] : [plan.other, plan.layout]).map(
                (l, i) => (
                  <label key={i} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="sp-round"
                      checked={(i === 0) === (round === 'up')}
                      onChange={() => setRound(i === 0 ? 'up' : 'down')}
                    />
                    {(i === 0 ? cs.stagePlan.bigger : cs.stagePlan.smaller)(mm(l), l.decks)}
                  </label>
                ),
              )}
            </fieldset>
          ) : (
            <p className="text-sm font-medium">
              {cs.stagePlan.exact(mm(plan.layout), plan.layout.decks)}
            </p>
          )}
          <Drawing layout={plan.layout} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1 pr-2 font-medium">{cs.stagePlan.col.item}</th>
                  <th className="py-1 pr-2 text-right font-medium">{cs.stagePlan.col.qty}</th>
                  <th className="py-1 pr-2 text-right font-medium">{cs.stagePlan.col.free}</th>
                  <th className="py-1 font-medium">{cs.stagePlan.col.state}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-alu-line">
                {plan.needs.map((n) => {
                  const missing = n.qty + n.onBooking - n.free;
                  return (
                    <tr key={n.itemId} data-testid="stage-need">
                      <td className="py-1 pr-2">
                        {itemName(s, n.itemId)}
                        {(n.auto || n.onBooking > 0) && (
                          <span className="block text-xs text-muted">
                            {[
                              n.auto && cs.stagePlan.auto,
                              n.onBooking > 0 && cs.stagePlan.onBooking(n.onBooking),
                            ]
                              .filter(Boolean)
                              .join(', ')}
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-2 text-right font-medium">{n.qty}</td>
                      <td className="py-1 pr-2 text-right">{n.free}</td>
                      <td
                        className={`py-1 text-xs font-medium ${missing > 0 ? 'text-bad' : 'text-ok'}`}
                      >
                        {missing > 0 ? cs.stagePlan.short(missing) : cs.stagePlan.enough}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {short && (
            <div className="space-y-2 rounded border border-warn/40 bg-warn-light p-3 text-sm">
              {plan.fits ? (
                <p className="flex flex-wrap items-center gap-2">
                  <span>{cs.stagePlan.fits(mm(plan.fits), plan.fits.decks)}</span>
                  {plan.fits.decks < plan.layout.decks && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setText(`${plan.fits!.widthMm}*${plan.fits!.depthMm}`);
                        setRound('up');
                      }}
                    >
                      {cs.stagePlan.useFits}
                    </button>
                  )}
                </p>
              ) : (
                plan.layout.decks > 0 &&
                plan.needs[0]!.qty + plan.needs[0]!.onBooking > plan.needs[0]!.free && (
                  <p>{cs.stagePlan.noneFree}</p>
                )
              )}
              <p className="text-xs">{cs.stagePlan.shortHint}</p>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!plan || !input}
          onClick={() => {
            if (!plan || !input) return;
            onAdd(addStage(s, booking, input, cs.stagePlan.group(mm(plan.layout))));
            toast('ok', cs.stagePlan.added);
            onClose();
          }}
        >
          {cs.stagePlan.add}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {cs.common.close}
        </button>
      </div>
    </section>
  );
}

/** Top view of the decks; the front (towards the audience) is at the bottom. */
function Drawing({ layout }: { layout: StageLayout }) {
  const pad = Math.max(layout.widthMm, layout.depthMm) * 0.02;
  return (
    <figure className="space-y-1">
      <svg
        role="img"
        aria-label={`${cs.stagePlan.plan}: ${mm(layout)}`}
        viewBox={`${-pad} ${-pad} ${layout.widthMm + 2 * pad} ${layout.depthMm + 2 * pad}`}
        className="mx-auto block max-h-56 w-full max-w-md"
        preserveAspectRatio="xMidYMid meet"
      >
        {layout.rects.map((r, i) => (
          <rect
            key={i}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.d}
            className="fill-alu-dark stroke-ink"
            strokeWidth={pad / 2}
          />
        ))}
        <line
          x1={0}
          x2={layout.widthMm}
          y1={layout.depthMm + pad / 2}
          y2={layout.depthMm + pad / 2}
          className="stroke-tape"
          strokeWidth={pad}
        />
      </svg>
      <figcaption className="text-center text-xs text-muted">
        {mm(layout)} · <span className="text-tape">{cs.stagePlan.front}</span>
      </figcaption>
    </figure>
  );
}
