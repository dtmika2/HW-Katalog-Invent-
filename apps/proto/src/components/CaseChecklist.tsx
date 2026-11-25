/** Checklist of one case at packing: every content line is ticked or counted, never all at once. */
import { useId } from 'react';
import { checkShort, looseInHouse, type AppState, type CaseCheck, type QtyLine } from '@quix/core';
import { cs } from '../i18n/cs';
import { caseNumber, itemName } from '../lib/names';
import { CaseLabel } from './ui';

export interface LineCheck {
  /** Ticked as written. */
  ok: boolean;
  /** Counted instead, because it did not match. */
  count?: number;
  refill: number;
}

/** What the packer entered for one case. */
export interface CaseDraft {
  lines: Record<string, LineCheck>;
  reason: string;
}

export const emptyDraft = (): CaseDraft => ({ lines: {}, reason: '' });

const lineOf = (d: CaseDraft, itemId: string): LineCheck =>
  d.lines[itemId] ?? { ok: false, refill: 0 };

/** The check sent to core. */
export function toCheck(caseId: string, contents: QtyLine[], d: CaseDraft): CaseCheck {
  const refilled = contents
    .map((c) => ({ itemId: c.itemId, qty: lineOf(d, c.itemId).refill }))
    .filter((c) => c.qty > 0);
  return {
    caseId,
    counts: contents.map((c) => ({ itemId: c.itemId, qty: lineOf(d, c.itemId).count ?? c.qty })),
    ...(refilled.length > 0 ? { refilled } : {}),
    ...(d.reason.trim() ? { reason: d.reason.trim() } : {}),
  };
}

/** True when every line is ticked or counted and a short case has its reason. */
export function isChecked(s: AppState, caseId: string, contents: QtyLine[], d: CaseDraft): boolean {
  return (
    contents.every((c) => {
      const l = lineOf(d, c.itemId);
      return l.ok || l.count !== undefined;
    }) &&
    (checkShort(s, toCheck(caseId, contents, d)).length === 0 || !!d.reason.trim())
  );
}

export function CaseChecklist({
  s,
  caseId,
  contents,
  value,
  onChange,
}: {
  s: AppState;
  caseId: string;
  contents: QtyLine[];
  value: CaseDraft;
  onChange: (d: CaseDraft) => void;
}) {
  const uid = useId();
  const number = caseNumber(s, caseId);
  const warehouseId = s.cases.find((c) => c.id === caseId)?.warehouseId ?? '';
  const setLine = (itemId: string, l: LineCheck) =>
    onChange({ ...value, lines: { ...value.lines, [itemId]: l } });
  const counted = contents.every((c) => {
    const l = lineOf(value, c.itemId);
    return l.ok || l.count !== undefined;
  });
  const short = counted ? checkShort(s, toCheck(caseId, contents, value)) : [];
  const done = isChecked(s, caseId, contents, value);
  return (
    <fieldset
      data-testid={`check-${caseId}`}
      className={`mt-2 rounded border p-3 ${done ? 'border-ok' : 'border-alu-line'}`}
    >
      <legend className="flex items-center gap-2 px-1 text-sm font-semibold">
        {cs.packing.check.title} <CaseLabel>{number}</CaseLabel>
        {done && <span className="text-xs font-medium text-ok">{cs.packing.check.done}</span>}
      </legend>
      <ul className="space-y-2">
        {contents.map((c) => {
          const l = lineOf(value, c.itemId);
          const wrong = l.count !== undefined;
          const loose = looseInHouse(s, c.itemId, warehouseId);
          const lacking = wrong ? c.qty - (l.count ?? 0) : 0;
          return (
            <li key={c.itemId} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <label className="flex min-h-11 flex-1 items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-6 w-6 shrink-0"
                    aria-label={`${number}: ${c.qty}× ${itemName(s, c.itemId)}`}
                    disabled={wrong}
                    checked={l.ok}
                    onChange={(e) => setLine(c.itemId, { ok: e.target.checked, refill: 0 })}
                  />
                  <span>
                    <strong className="font-cond text-base">{c.qty}×</strong>{' '}
                    {itemName(s, c.itemId)}
                  </span>
                </label>
                <button
                  type="button"
                  className="btn btn-sm min-h-11"
                  aria-label={`${wrong ? cs.packing.check.undo : cs.packing.check.wrong}: ${number}, ${itemName(s, c.itemId)}`}
                  onClick={() =>
                    setLine(
                      c.itemId,
                      wrong ? { ok: false, refill: 0 } : { ok: false, count: c.qty - 1, refill: 0 },
                    )
                  }
                >
                  {wrong ? cs.packing.check.undo : cs.packing.check.wrong}
                </button>
              </div>
              {wrong && (
                <div className="ml-9 mt-1 flex flex-wrap items-end gap-3 rounded bg-warn-light p-2">
                  <label>
                    <span className="label">{cs.packing.check.counted(c.qty)}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      className="input h-11 w-20"
                      min={0}
                      max={c.qty}
                      value={l.count}
                      onChange={(e) => {
                        const n = Math.min(c.qty, Math.max(0, Number(e.target.value) || 0));
                        setLine(c.itemId, {
                          ok: false,
                          count: n,
                          refill: Math.min(l.refill, c.qty - n),
                        });
                      }}
                    />
                  </label>
                  {lacking > 0 &&
                    (loose > 0 ? (
                      <label>
                        <span className="label">{cs.packing.check.refill(loose)}</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          className="input h-11 w-20"
                          min={0}
                          max={Math.min(lacking, loose)}
                          value={l.refill}
                          onChange={(e) =>
                            setLine(c.itemId, {
                              ...l,
                              refill: Math.min(
                                lacking,
                                loose,
                                Math.max(0, Number(e.target.value) || 0),
                              ),
                            })
                          }
                        />
                      </label>
                    ) : (
                      <span className="pb-2 text-xs text-muted">{cs.packing.check.noLoose}</span>
                    ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {short.length > 0 && (
        <div className="mt-3 rounded border border-bad bg-bad-light p-2 text-sm">
          <p className="font-semibold text-bad">
            {cs.packing.check.short(
              short.map((x) => `${x.qty}× ${itemName(s, x.itemId)}`).join(', '),
            )}
          </p>
          <p className="text-xs">{cs.packing.check.shortHint}</p>
          <label className="mt-2 block" htmlFor={`${uid}-reason`}>
            <span className="label">{cs.packing.check.reason}</span>
            <input
              id={`${uid}-reason`}
              className="input"
              value={value.reason}
              onChange={(e) => onChange({ ...value, reason: e.target.value })}
            />
          </label>
        </div>
      )}
    </fieldset>
  );
}
