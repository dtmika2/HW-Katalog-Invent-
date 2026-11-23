/** Display helpers that turn ids into names (data, not UI strings). */
import {
  diffDays,
  firstBookedFrom,
  lastBookedUntil,
  type AppState,
  type Booking,
  type BookingLine,
  type Target,
} from '@quix/core';

export const itemName = (s: AppState, id: string): string =>
  s.items.find((i) => i.id === id)?.name ?? id;
export const caseTypeName = (s: AppState, id: string): string =>
  s.caseTypes.find((t) => t.id === id)?.name ?? id;
export const userName = (s: AppState, id: string | undefined): string =>
  (id && s.users.find((u) => u.id === id)?.name) || '';
export const clientName = (s: AppState, id: string | undefined): string =>
  (id && s.clients.find((c) => c.id === id)?.name) || '';
export const warehouseName = (s: AppState, id: string | undefined): string =>
  (id && s.warehouses.find((w) => w.id === id)?.name) || '';
export const locationPath = (s: AppState, id: string | undefined): string =>
  (id && s.locations.find((l) => l.id === id)?.path) || '';
export const caseNumber = (s: AppState, id: string): string =>
  s.cases.find((c) => c.id === id)?.number ?? id;

export function targetName(s: AppState, t: Target): string {
  return 'itemId' in t ? itemName(s, t.itemId) : caseTypeName(s, t.caseTypeId);
}

export function lineName(s: AppState, l: BookingLine): string {
  if ('external' in l.target) return l.target.external.name;
  return targetName(s, l.target);
}

/** Category of a line: the item's own; a case takes it from its primary item (first standard content). */
export function lineCategoryId(s: AppState, l: BookingLine): string | undefined {
  if ('external' in l.target) return undefined;
  const t = l.target;
  const itemId =
    'itemId' in t ? t.itemId : s.caseTypes.find((x) => x.id === t.caseTypeId)?.contents[0]?.itemId;
  return s.items.find((i) => i.id === itemId)?.categoryId;
}

export const isCaseLine = (l: BookingLine): boolean => 'caseTypeId' in l.target;

export function bookingSpan(b: Booking): { from: string; to: string } {
  return { from: firstBookedFrom(b), to: lastBookedUntil(b) };
}

export function eventSpan(b: Booking): { from: string; to: string } {
  return {
    from: b.periods.reduce((m, p) => (p.eventFrom < m ? p.eventFrom : m), '9999-12-31'),
    to: b.periods.reduce((m, p) => (p.eventTo > m ? p.eventTo : m), '0000-01-01'),
  };
}

export const ageDays = (from: string, today: string): number => Math.max(0, diffDays(from, today));
