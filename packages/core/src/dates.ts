/**
 * Calendar-day helpers. Dates are ISO strings `YYYY-MM-DD`; there are no time zones in Batch 1.
 * Internally a day is converted to a UTC midnight timestamp only for arithmetic.
 */

/** A calendar day as `YYYY-MM-DD`. */
export type IsoDate = string;

const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `value` is a real calendar day in `YYYY-MM-DD` form. */
export function isIsoDate(value: string): boolean {
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return fromUtcMs(ms) === value;
}

function toUtcMs(d: IsoDate): number {
  const m = ISO_RE.exec(d);
  if (!m) throw new Error(`Invalid IsoDate: ${d}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `d` shifted by `n` days (negative allowed). */
export function addDays(d: IsoDate, n: number): IsoDate {
  return fromUtcMs(toUtcMs(d) + n * DAY_MS);
}

/** Number of days from `a` to `b` (`b − a`). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

/** −1, 0 or 1. ISO strings compare lexicographically, which equals chronological order. */
export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const isBefore = (a: IsoDate, b: IsoDate): boolean => a < b;
export const isAfter = (a: IsoDate, b: IsoDate): boolean => a > b;
export const minDate = (a: IsoDate, b: IsoDate): IsoDate => (a < b ? a : b);
export const maxDate = (a: IsoDate, b: IsoDate): IsoDate => (a > b ? a : b);

/** True when `d` lies in `[from, to]` (inclusive). */
export function inRange(d: IsoDate, from: IsoDate, to: IsoDate): boolean {
  return d >= from && d <= to;
}

/** True when the inclusive ranges `[aFrom, aTo]` and `[bFrom, bTo]` share at least one day. */
export function rangesOverlap(aFrom: IsoDate, aTo: IsoDate, bFrom: IsoDate, bTo: IsoDate): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

/** Every day from `from` to `to` inclusive; empty when `to < from`. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  if (to < from) return out;
  let ms = toUtcMs(from);
  const end = toUtcMs(to);
  while (ms <= end) {
    out.push(fromUtcMs(ms));
    ms += DAY_MS;
  }
  return out;
}

/** First day of the month containing `d`. */
export function startOfMonth(d: IsoDate): IsoDate {
  return `${d.slice(0, 7)}-01`;
}

/** Last day of the month containing `d`. */
export function endOfMonth(d: IsoDate): IsoDate {
  const [y, m] = [Number(d.slice(0, 4)), Number(d.slice(5, 7))];
  return fromUtcMs(Date.UTC(y, m, 0));
}

/** The same day-of-month `n` months later, clamped to the month's length. Returns the 1st when used with startOfMonth. */
export function addMonths(d: IsoDate, n: number): IsoDate {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7)) - 1 + n;
  const day = Number(d.slice(8, 10));
  const first = Date.UTC(y, m, 1);
  const last = Date.UTC(y, m + 1, 0);
  const lastDay = new Date(last).getUTCDate();
  return fromUtcMs(first + (Math.min(day, lastDay) - 1) * DAY_MS);
}

/** Day of week, Monday = 0 … Sunday = 6. */
export function weekday(d: IsoDate): number {
  return (new Date(toUtcMs(d)).getUTCDay() + 6) % 7;
}
