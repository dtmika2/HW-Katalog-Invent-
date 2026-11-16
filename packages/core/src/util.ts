import type { AppState, BookingLine, ExternalSpec, Id, LineTarget, Target } from './types';

// ---------------------------------------------------------------------------
// Results and typed errors

export type ErrorCode =
  | 'forbidden'
  | 'invalid_state'
  | 'not_found'
  | 'validation'
  | 'conflict_unacknowledged'
  | 'open_or_choices'
  | 'blocking_conflicts';

export interface DomainError {
  code: ErrorCode;
  message: string;
  /** Extra data, e.g. the blocking line ids. */
  details?: Record<string, unknown>;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export function err<T = never>(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): Result<T> {
  return { ok: false, error: details ? { code, message, details } : { code, message } };
}

/** Unwrap a result or throw (tests, fixtures and scenario builders). */
export function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

// ---------------------------------------------------------------------------
// Immutable updates

/**
 * Run `fn` on a deep copy of `state` and return the copy. Inputs are never mutated.
 * State is small (a few thousand records) so a structured clone per user action is cheap.
 */
export function produce<S, R = void>(state: S, fn: (draft: S) => R): { state: S; result: R } {
  const draft = structuredClone(state);
  const result = fn(draft);
  return { state: draft, result };
}

/** Next deterministic id for `prefix`, mutating `draft.counters`. */
export function nextId(draft: Pick<AppState, 'counters'>, prefix: string): Id {
  const n = (draft.counters[prefix] ?? 0) + 1;
  draft.counters[prefix] = n;
  return `${prefix}-${n}`;
}

// ---------------------------------------------------------------------------
// Targets

/** Stable key of a resource: `item:<id>` or `case:<id>`. */
export function targetKey(t: Target): string {
  return 'itemId' in t ? `item:${t.itemId}` : `case:${t.caseTypeId}`;
}

export function isExternal(t: LineTarget): t is { external: ExternalSpec } {
  return 'external' in t;
}

export function isItemTarget(t: LineTarget | Target): t is { itemId: Id } {
  return 'itemId' in t;
}

export function isCaseTarget(t: LineTarget | Target): t is { caseTypeId: Id } {
  return 'caseTypeId' in t;
}

/** Key for any line target; external lines get a per-line key. */
export function lineTargetKey(line: BookingLine): string {
  return isExternal(line.target) ? `ext:${line.id}` : targetKey(line.target);
}

/** Effective quantity of a line (manual override wins over the computed quantity). */
export function effectiveQty(line: BookingLine): number {
  return line.overriddenQty ?? line.qty;
}

/** True for lines that take part in holds, packing and conflicts. */
export function isActiveLine(line: BookingLine): boolean {
  return line.status === 'ok' && effectiveQty(line) > 0;
}

export function sum(values: readonly number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

export function uniq<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function groupBy<T>(values: readonly T[], key: (v: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const v of values) {
    const k = key(v);
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  }
  return m;
}
