/**
 * Small DSL that drives bookings through the real core API with past dates, so every
 * shipment, return, issue and conflict record in the fixtures is consistent with the rules.
 */
import {
  ackConflict,
  addDays,
  addLine,
  closeBooking,
  completeAsStandard,
  confirmBooking,
  createBooking,
  detectConflicts,
  expireBooking,
  firstEventDay,
  homeLocationId,
  newLine,
  nextLineId,
  packingList,
  periodWithBuffer,
  recordReturnSession,
  returnSheet,
  saveBooking,
  setLineSource,
  setOverrideReason,
  shipBatch,
  startPacking,
  submitPrebooking,
  unwrap,
  type AppState,
  type Booking,
  type ExternalSpec,
  type Id,
  type IsoDate,
  type ReturnLineInput,
  type ShipmentLine,
  type User,
} from '@quix/core';

export type Stage =
  | 'draft'
  | 'submitted'
  | 'expired'
  | 'confirmed'
  | 'packing'
  | 'shipped'
  | 'returning'
  | 'returned'
  | 'returned_with_issues'
  | 'closed';

export type LineSpec =
  | { item: Id; qty: number; from?: 'brod' | 'karlak'; fromBooking?: Id }
  | { caseType: Id; qty: number; from?: 'brod' | 'karlak' }
  | { external: Omit<ExternalSpec, 'pickup' | 'returnDate'>; qty: number };

export interface BookingSpec {
  id: Id;
  name: string;
  pm: Id;
  client: Id;
  purpose: string;
  /** Event ranges; buffers come from settings. */
  periods: [IsoDate, IsoDate][];
  warehouse?: 'brod' | 'karlak';
  lines: LineSpec[];
  stage: Stage;
  /** Override reason for short lines at confirmation (by target key, e.g. `item:ledbeam150`). */
  overrides?: Record<string, string>;
  /** Item lines (by item id) that are shipped in a second batch the next day. */
  secondBatch?: Id[];
  /** Return adjustments by item id: returned count, damaged pieces, note. */
  returns?: Record<Id, { returned?: number; damaged?: number; note: string }>;
  /** Lines (by item/case type id) returned in the first session when stage is `returning`. */
  returnedFirst?: Id[];
  /** Thread messages: [author, text]. */
  messages?: [Id, string][];
}

const WAREHOUSE = { brod: 'wh-brod', karlak: 'wh-karlak' } as const;

export class Builder {
  constructor(
    public state: AppState,
    private readonly today: IsoDate,
  ) {}

  user(id: Id): User {
    const u = this.state.users.find((x) => x.id === id);
    if (!u) throw new Error(`user ${id}`);
    return u;
  }

  private at(d: IsoDate): IsoDate {
    if (d > this.today) throw new Error(`Fixture step on ${d} is after today ${this.today}`);
    return d;
  }

  /** The earlier of `d` and `cap` (default: today). */
  private upTo(d: IsoDate, cap: IsoDate = this.today): IsoDate {
    return d < cap ? d : cap;
  }

  private get(id: Id): Booking {
    const b = this.state.bookings.find((x) => x.id === id);
    if (!b) throw new Error(`booking ${id}`);
    return b;
  }

  private put(b: Booking): void {
    this.state = {
      ...this.state,
      bookings: this.state.bookings.map((x) => (x.id === b.id ? b : x)),
    };
  }

  /** Create and advance one booking to its stage. */
  book(spec: BookingSpec): void {
    const s = this.state;
    const periods = spec.periods.map(([f, t]) => periodWithBuffer(f, t, s.settings));
    const first = periods.reduce(
      (m, p) => (p.bookedFrom < m ? p.bookedFrom : m),
      periods[0]!.bookedFrom,
    );
    const lastUntil = periods.reduce(
      (m, p) => (p.bookedUntil > m ? p.bookedUntil : m),
      periods[0]!.bookedUntil,
    );
    const created = this.upTo(addDays(first, -21), addDays(this.today, -4));
    const pm = this.user(spec.pm);
    const chief = this.user('u-tomas');
    const wh = this.user('u-martin');

    this.state = unwrap(
      createBooking(this.state, pm, this.at(created), {
        id: spec.id,
        eventName: spec.name,
        clientId: spec.client,
        purposeMessage: spec.purpose,
        periods,
        defaultWarehouseId: WAREHOUSE[spec.warehouse ?? 'brod'],
      }),
    ).state;

    // Lines
    let b = this.get(spec.id);
    for (const l of spec.lines) {
      if ('external' in l) {
        const ext: ExternalSpec = { ...l.external, pickup: first, returnDate: lastUntil };
        b = { ...b, lines: [...b.lines, newLine({ external: ext }, l.qty, nextLineId(b))] };
        continue;
      }
      const target = 'item' in l ? { itemId: l.item } : { caseTypeId: l.caseType };
      const before = new Set(b.lines.map((x) => x.id));
      if ('item' in l && l.fromBooking) {
        const line = newLine(target, l.qty, nextLineId(b));
        b = setLineSource(this.state, { ...b, lines: [...b.lines, line] }, line.id, {
          fromBookingId: l.fromBooking,
        });
        continue;
      }
      b = addLine(this.state, b, target, l.qty);
      if (l.from) {
        const added = b.lines.find((x) => !before.has(x.id) && x.origin === 'manual');
        if (added) b = setLineSource(this.state, b, added.id, { warehouseId: WAREHOUSE[l.from] });
      }
    }
    this.state = unwrap(saveBooking(this.state, pm, this.at(created), b));
    for (const [author, text] of spec.messages ?? []) {
      this.state = {
        ...this.state,
        messages: [
          ...this.state.messages,
          {
            id: `msg-fx-${this.state.messages.length + 1}`,
            bookingId: spec.id,
            authorId: author,
            on: created,
            text,
          },
        ],
      };
    }
    if (spec.stage === 'draft') return;

    // Submit (acknowledging conflicts) unless the PM confirms directly.
    const submitDay = addDays(created, 1);
    if (spec.stage === 'expired' || spec.stage === 'submitted' || !pm.perms.canConfirmOwnOrders) {
      let cur = this.get(spec.id);
      for (const c of detectConflicts(this.state, cur)) cur = ackConflict(cur, c.lineId);
      this.put(cur);
      this.state = unwrap(submitPrebooking(this.state, pm, this.upTo(submitDay), spec.id));
    }
    if (spec.stage === 'submitted') return;
    if (spec.stage === 'expired') {
      this.state = unwrap(
        expireBooking(this.state, this.at(firstEventDay(this.get(spec.id))), spec.id),
      );
      return;
    }

    // Confirm (with override reasons where given).
    let cur = this.get(spec.id);
    for (const c of detectConflicts(this.state, cur)) {
      const line = cur.lines.find((x) => x.id === c.lineId);
      const key =
        line && !('external' in line.target)
          ? 'itemId' in line.target
            ? `item:${line.target.itemId}`
            : `case:${line.target.caseTypeId}`
          : '';
      const reason = spec.overrides?.[key];
      if (!reason) throw new Error(`Fixture ${spec.id}: unexpected conflict on ${key}`);
      cur = setOverrideReason(cur, c.lineId, reason);
    }
    this.put(cur);
    const confirmer = pm.perms.canConfirmOwnOrders ? pm : chief;
    this.state = unwrap(
      confirmBooking(this.state, confirmer, this.upTo(addDays(created, 3)), spec.id),
    );
    if (spec.stage === 'confirmed') return;

    this.state = unwrap(startPacking(this.state, wh, this.upTo(addDays(first, -1)), spec.id));
    if (spec.stage === 'packing') return;

    // Ship: everything not coming by transfer, optionally in two batches.
    const pl = packingList(this.state, spec.id);
    if (!pl) throw new Error('packing list');
    const batch1: ShipmentLine[] = [];
    const batch2: ShipmentLine[] = [];
    const busy = new Set<Id>();
    const lines = [
      ...pl.byWarehouse.flatMap((w) => w.groups.flatMap((g) => g.lines)),
      ...pl.external,
    ];
    for (const pline of lines) {
      if (pline.remaining <= 0) continue;
      const entry: ShipmentLine = { lineId: pline.lineId, qty: pline.remaining };
      if (pline.kind === 'case') {
        const free = (pline.candidateCases ?? []).filter(
          (c) => c.complete && !c.busy && !busy.has(c.caseId),
        );
        entry.caseIds = free.slice(0, pline.remaining).map((c) => c.caseId);
        entry.caseIds.forEach((c) => busy.add(c));
        if (entry.caseIds.length < pline.remaining)
          throw new Error(`Fixture ${spec.id}: not enough complete cases`);
      }
      if (pline.itemId && spec.secondBatch?.includes(pline.itemId)) batch2.push(entry);
      else batch1.push(entry);
    }
    this.state = unwrap(
      shipBatch(this.state, wh, this.at(first), spec.id, { label: 'Dodávka 1', lines: batch1 }),
    );
    if (batch2.length > 0) {
      this.state = unwrap(
        shipBatch(this.state, wh, this.at(addDays(first, 1)), spec.id, {
          label: 'Dodávka 2',
          lines: batch2,
        }),
      );
    }
    if (spec.stage === 'shipped') return;

    // Vratka.
    const sheet = returnSheet(this.state, spec.id);
    const entries: ReturnLineInput[] = [];
    for (const l of sheet) {
      if (l.outcome !== 'pending' || l.consumable) continue;
      const key = l.itemId ?? l.caseTypeId ?? '';
      if (spec.stage === 'returning' && !(spec.returnedFirst ?? []).includes(key)) continue;
      if (l.kind === 'external') {
        entries.push({
          lineId: l.lineId,
          returnedQty: l.outstanding,
          confirmed: true,
          condition: 'ok',
          returnedToSupplier: true,
        });
        continue;
      }
      const loc = l.suggestedLocationId ?? this.state.locations[0]!.id;
      if (l.kind === 'case') {
        for (const caseId of l.pendingCaseIds)
          entries.push(completeAsStandard(this.state, l.lineId, caseId, loc));
        continue;
      }
      const adj = l.itemId ? spec.returns?.[l.itemId] : undefined;
      const returned = adj?.returned ?? l.outstanding;
      const e: ReturnLineInput = {
        lineId: l.lineId,
        returnedQty: returned,
        confirmed: true,
        condition: adj?.damaged ? 'damaged' : 'ok',
        locationId: loc,
      };
      if (adj?.damaged) e.damagedQty = adj.damaged;
      if (adj?.note) e.note = adj.note;
      if (l.suggestedIntoCaseId) e.intoCaseId = l.suggestedIntoCaseId;
      entries.push(e);
    }
    this.state = unwrap(
      recordReturnSession(this.state, wh, this.at(lastUntil), spec.id, { lines: entries }),
    );
    if (spec.stage !== 'closed') return;
    this.state = unwrap(closeBooking(this.state, chief, this.at(addDays(lastUntil, 1)), spec.id));
  }

  /** Home shelf of an item in a warehouse (for tests and service cases). */
  home(itemId: Id, w: 'brod' | 'karlak'): Id | undefined {
    return homeLocationId(this.state, itemId, WAREHOUSE[w]);
  }
}
