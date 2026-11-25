/**
 * Public API of the QUIX HW domain core.
 *
 * Pure TypeScript: no React, no DOM, no I/O, no clock. "Today" is always a parameter. Actions
 * take the whole `AppState` and return a new one (inputs are never mutated) wrapped in a
 * `Result` with a typed error.
 *
 * Modules:
 * - `dates` — calendar-day helpers on `YYYY-MM-DD` strings.
 * - `catalog` — lookups, stock per warehouse, loose vs. in-case stock, case completeness.
 * - `expansion` — connections engine (`expand`): required AND/OR groups, quantity rules,
 *   recursion with cycle detection, overrides, check warnings, recommendations.
 * - `availability` — holds, per-day item/case availability, line badges, calendars.
 * - `conflicts` — detection, conflict records (override / detected), resolution.
 * - `lifecycle` — booking state machine, permissions, pure booking edits for the editor.
 * - `shipping` — packing list, batches, lines added after shipping.
 * - `returns` — vratka sheet and sessions: outcomes, transfers, cases, unexpected items.
 * - `cases` — refill ("Doplnit case") tasks.
 * - `service` — service cases and their status flow.
 * - `issues` — pending issues list and resolution.
 * - `jobs` — `runDailyJobs(state, today)`: expiries and reminders.
 * - `clients` — light client records: add, edit, archive, look-alike names.
 * - `notifications` — in-app notifications and the booking thread.
 */
import { DEFAULT_SETTINGS, type AppState } from './types';

export const CORE_VERSION = '0.1.0';

export * from './types';
export * from './dates';
export * from './util';
export * from './catalog';
export * from './expansion';
export * from './availability';
export * from './conflicts';
export * from './lifecycle';
export * from './clients';
export * from './shipping';
export * from './returns';
export * from './cases';
export * from './service';
export * from './issues';
export * from './jobs';
export * from './notifications';

/** An empty state with default settings. */
export function emptyState(): AppState {
  return {
    users: [],
    warehouses: [],
    locations: [],
    categories: [],
    items: [],
    stock: [],
    caseTypes: [],
    cases: [],
    connections: [],
    clients: [],
    bookings: [],
    shipments: [],
    returnSessions: [],
    conflicts: [],
    serviceCases: [],
    issues: [],
    transfers: [],
    notifications: [],
    messages: [],
    settings: structuredClone(DEFAULT_SETTINGS),
    counters: {},
    jobLog: {},
  };
}
export * from './catalog/edit';
