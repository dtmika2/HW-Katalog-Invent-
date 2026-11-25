/** Choosing case numbers for a case line and checking the contents of each. */
import type { AppState, PackLine } from '@quix/core';
import { cs } from '../i18n/cs';
import { CaseChecklist, emptyDraft, isChecked, toCheck, type CaseDraft } from './CaseChecklist';
import { CaseLabel } from './ui';

export interface CasePicks {
  caseIds: string[];
  /** Checklists by case id; a case that is deselected starts over. */
  checks: Record<string, CaseDraft>;
}

export const noCases = (): CasePicks => ({ caseIds: [], checks: {} });

/** First free complete cases, as a start; the person can change them. */
export const firstFreeCases = (l: PackLine, n: number): string[] =>
  (l.candidateCases ?? [])
    .filter((c) => c.complete && !c.busy)
    .slice(0, n)
    .map((c) => c.caseId);

export const withCases = (p: CasePicks, caseIds: string[]): CasePicks => ({
  caseIds,
  checks: Object.fromEntries(Object.entries(p.checks).filter(([id]) => caseIds.includes(id))),
});

export const uncheckedCases = (s: AppState, l: PackLine, p: CasePicks): string[] =>
  p.caseIds.filter((c) => !isChecked(s, c, l.contents ?? [], p.checks[c] ?? emptyDraft()));

export const caseChecksOf = (l: PackLine, p: CasePicks) =>
  p.caseIds.map((c) => toCheck(c, l.contents ?? [], p.checks[c] ?? emptyDraft()));

export function CasePicker({
  s,
  l,
  limit,
  value,
  onChange,
}: {
  s: AppState;
  l: PackLine;
  limit: number;
  value: CasePicks;
  onChange: (p: CasePicks) => void;
}) {
  return (
    <>
      <fieldset className="mt-2">
        <legend className="label">{cs.packing.pickCases}</legend>
        <div className="flex flex-wrap gap-2">
          {(l.candidateCases ?? []).map((c) => {
            const on = value.caseIds.includes(c.caseId);
            return (
              <label
                key={c.caseId}
                className={`flex items-center gap-1 rounded border px-2 py-1 text-sm ${on ? 'border-tape bg-tape-light' : 'border-alu-line'}`}
              >
                <input
                  type="checkbox"
                  disabled={c.busy || !c.complete}
                  checked={on}
                  onChange={(e) =>
                    onChange(
                      withCases(
                        value,
                        e.target.checked
                          ? [...value.caseIds, c.caseId].slice(-limit)
                          : value.caseIds.filter((x) => x !== c.caseId),
                      ),
                    )
                  }
                />
                <CaseLabel>{c.number}</CaseLabel>
                {c.busy && (
                  <span className="text-xs text-muted">
                    {c.place?.place === 'packed'
                      ? cs.packing.casePacked(
                          s.bookings.find((b) => b.id === c.place?.bookingId)?.eventName ?? '',
                        )
                      : cs.packing.caseBusy}
                  </span>
                )}
                {!c.complete && !c.busy && (
                  <span className="text-xs text-bad">{cs.packing.caseIncomplete}</span>
                )}
              </label>
            );
          })}
        </div>
      </fieldset>
      {value.caseIds.map((caseId) => (
        <CaseChecklist
          key={caseId}
          s={s}
          caseId={caseId}
          contents={l.contents ?? []}
          value={value.checks[caseId] ?? emptyDraft()}
          onChange={(d) => onChange({ ...value, checks: { ...value.checks, [caseId]: d } })}
        />
      ))}
    </>
  );
}
