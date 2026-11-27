/**
 * Domain types. They mirror the data model in `docs/concept.md` as plain TypeScript.
 * IDs are strings. Dates are calendar days (`IsoDate`).
 */
import type { IsoDate } from './dates';

export type { IsoDate };
export type Id = string;

// ---------------------------------------------------------------------------
// Users and permissions

export type Role = 'pm' | 'chief' | 'warehouse' | 'admin';

export interface Permissions {
  /** A trusted PM turns their own pre-booking into an order without the Chief. */
  canConfirmOwnOrders: boolean;
  /** Edit items, cases and connections. */
  canEditCatalogue: boolean;
  /** Change the status of service cases. */
  canManageService: boolean;
}

export interface User {
  id: Id;
  name: string;
  role: Role;
  perms: Permissions;
  active: boolean;
}

/** The pseudo user that runs nightly jobs. */
export const SYSTEM_USER_ID = 'system';

// ---------------------------------------------------------------------------
// Catalogue

export interface Warehouse {
  id: Id;
  name: string;
}

export interface Location {
  id: Id;
  warehouseId: Id;
  parentId?: Id;
  name: string;
  /** Human readable path, e.g. "Brod / Regál A / Police 2". */
  path: string;
}

export interface Category {
  id: Id;
  name: string;
  parentId?: Id;
  icon?: string;
  /** Colour key from the UI palette; subcategories inherit their parent's colour. */
  color?: string;
}

export interface Item {
  id: Id;
  name: string;
  manufacturer: string;
  model: string;
  categoryId: Id;
  /** Indicative rental price, CZK per day. */
  priceDay: number;
  /** False for consumables (gaffer tape, batteries): stock is reduced on shipping. */
  returnable: boolean;
  weightKg?: number;
  notes?: string;
  /** Data URLs or URLs; the first one is the thumbnail. */
  photos?: string[];
  archived: boolean;
  /** What part of a stage the item is, for the stage calculator. Sizes in millimetres. */
  stage?: StagePart;
}

export type StagePart =
  | { part: 'deck'; widthMm: number; depthMm: number }
  | { part: 'leg'; heightMm: number }
  | { part: 'rail' | 'skirt'; lengthMm: number }
  | { part: 'stairs' };

export interface ItemStock {
  itemId: Id;
  warehouseId: Id;
  qty: number;
  homeLocationId: Id;
}

export interface QtyLine {
  itemId: Id;
  qty: number;
}

/** Template of a flight case with its standard contents. */
export interface CaseType {
  id: Id;
  name: string;
  contents: QtyLine[];
  archived?: boolean;
}

/** One physical flight case. `contents` are the actual contents. */
export interface Case {
  id: Id;
  caseTypeId: Id;
  /** Case number, e.g. "AX9-02". */
  number: string;
  warehouseId: Id;
  locationId: Id;
  contents: QtyLine[];
  /** Day the case last became incomplete (start of the refill reminder clock). */
  incompleteSince?: IsoDate;
  archived?: boolean;
}

export type Target = { itemId: Id } | { caseTypeId: Id };
export type ConnectionKind = 'required' | 'check' | 'recommended';
export type QtyRule = 'per_piece' | 'per_n' | 'once_per_order';
export type GroupMode = 'and' | 'or';

/**
 * A link from one item to another item or case type.
 * Connections from the same item with the same `groupId` form a group. A group with
 * `parentGroupId` is a compound option inside its parent group (one level of nesting).
 */
export interface Connection {
  id: Id;
  fromItemId: Id;
  target: Target;
  kind: ConnectionKind;
  groupId?: string;
  groupMode?: GroupMode;
  parentGroupId?: string;
  rule: QtyRule;
  /** Divisor for `per_n`. */
  n?: number;
  qty: number;
}

export interface Client {
  id: Id;
  name: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  note?: string;
  /** No longer offered for new bookings. */
  archived?: boolean;
  createdBy?: Id;
  createdOn?: IsoDate;
}

// ---------------------------------------------------------------------------
// Bookings

export type BookingType = 'prebooking' | 'order';

export type BookingStatus =
  | 'tentative'
  | 'planned'
  | 'draft'
  | 'submitted'
  | 'confirmed'
  | 'packing'
  | 'packed'
  | 'shipped'
  | 'returning'
  | 'returned'
  | 'returned_with_issues'
  | 'closed'
  | 'expired'
  | 'cancelled';

/** A date noted by a PM, with or without gear: nobody but PMs and the Chief sees it. */
export const RESERVATION_STATUSES: readonly BookingStatus[] = ['tentative', 'planned'];
/** Stages the PM sets freely, before anybody is asked for anything. */
export const FREE_STAGES = ['tentative', 'planned', 'draft'] as const;
export type FreeStage = (typeof FREE_STAGES)[number];
/** Pre-bookings that can still become an order. */
export const PRE_STATUSES: readonly BookingStatus[] = [...FREE_STAGES, 'submitted'];
/** Finished one way or another: read-only, hold nothing. */
export const ARCHIVED_STATUSES: readonly BookingStatus[] = ['closed', 'expired', 'cancelled'];

export interface BookingPeriod {
  eventFrom: IsoDate;
  eventTo: IsoDate;
  bookedFrom: IsoDate;
  bookedUntil: IsoDate;
}

export interface ExternalSpec {
  name: string;
  itemId?: Id;
  supplier: string;
  pickup: IsoDate;
  returnDate: IsoDate;
  note?: string;
}

export type LineTarget = { itemId: Id } | { caseTypeId: Id } | { external: ExternalSpec };

export type LineOrigin = 'manual' | 'auto' | 'kit';
export type LineStatus = 'ok' | 'missing' | 'substituted';

/** The PM's own section of the list ("dekorace", "zkouška zvuku"). */
export interface BookingGroup {
  id: Id;
  name: string;
}

export interface BookingLine {
  id: Id;
  target: LineTarget;
  qty: number;
  sourceWarehouseId?: Id;
  /** Event-to-event transfer: pieces come from this booking instead of a warehouse. */
  fromBookingId?: Id;
  expectedReturnWarehouseId?: Id;
  origin: LineOrigin;
  /** For auto lines: the lines that caused this one. */
  parentLineIds: Id[];
  /** For auto lines created by an OR group: the group key and chosen option. */
  orGroupKey?: string;
  orChoice?: string;
  /** Manual override of an auto line's quantity, kept on recalculation. */
  overriddenQty?: number;
  status: LineStatus;
  /** "I have seen the conflict" for a red line. */
  conflictAck: boolean;
  /** Written reason that lets a short line be confirmed anyway. */
  overrideReason?: string;
  /** Written by a PM who may not decide: a proposal until accepted. */
  overrideProposedBy?: Id;
  overrideAcceptedBy?: Id;
  /** Reason for missing / substituted, or other remark shown to the PM. */
  note?: string;
  addedAfterShipping?: boolean;
  /** Taken to the event at the last minute, without approval. */
  late?: { by: Id; on: IsoDate; note?: string; reason?: string; charged?: boolean };
  /** Day pieces actually arrived from `fromBookingId`. */
  transferredOn?: IsoDate;
  /** Shown under this line (for auto lines: which of `parentLineIds`). */
  nestedUnder?: Id;
  /** Group of a top-level line; nested lines follow their parent. */
  groupId?: Id;
  /** Added from a check of this item: the count follows it until changed by hand. */
  followsCheck?: { fromItemId: Id; byHand?: boolean };
}

/** The warehouse asks the Chief to cancel after the event has begun. */
export interface CancelRequest {
  id: Id;
  /** The delivery to cancel; without it, the packing (or the booking, see `booking`). */
  shipmentId?: Id;
  /** The PM asks to cancel the whole booking. */
  booking?: true;
  by: Id;
  on: IsoDate;
  reason: string;
  /** What the warehouse confirmed as back (see `BackItem`). */
  confirmed: Id[];
}

export interface Booking {
  id: Id;
  type: BookingType;
  status: BookingStatus;
  eventName: string;
  clientId?: Id;
  purposeMessage: string;
  pmId: Id;
  createdAt: IsoDate;
  submittedAt?: IsoDate;
  confirmedBy?: Id;
  confirmedOn?: IsoDate;
  /** Global confirmation order; earlier confirmed orders have priority in conflict checks. */
  confirmSeq?: number;
  periods: BookingPeriod[];
  lines: BookingLine[];
  groups?: BookingGroup[];
  /** Warehouse used for lines that do not name a source. */
  defaultWarehouseId: Id;
  /** OR choices made by a person: group key → option key. */
  orChoices: Record<string, string>;
  /** Recommendation target keys dismissed on this booking. */
  dismissedRecommendations: string[];
  /** Check warnings dismissed by the Chief. */
  dismissedChecks: string[];
  /** Auto lines removed by the Chief: auto line id → reason. */
  suppressedAuto: Record<string, string>;
  returnedToPm?: { by: Id; on: IsoDate; reason: string };
  editedAfterShipping?: boolean;
  /** Why it is packed early although a confirmed order needs the gear in the meantime. */
  earlyPacking?: { by: Id; on: IsoDate; reason: string };
  cancelRequests?: CancelRequest[];
  /** Cancelled, but the warehouse has not confirmed yet that everything is unpacked. */
  cancelPending?: { by: Id; on: IsoDate; reason: string };
  /** Stage in which it expired. */
  expiredFrom?: BookingStatus;
  cancelled?: { by: Id; on: IsoDate; reason: string; from: BookingStatus };
  closedOn?: IsoDate;
}

// ---------------------------------------------------------------------------
// Shipping and returns

/** What the packer counted in one case before it left (who and when: the shipment). */
export interface CaseCheck {
  caseId: Id;
  /** Counted pieces per standard content line. */
  counts: QtyLine[];
  /** Pieces put in from loose stock while packing. */
  refilled?: QtyLine[];
  /** Required when the case leaves short. */
  reason?: string;
}

export interface ShipmentLine {
  lineId: Id;
  qty: number;
  /** Specific case numbers picked for a case-type line. */
  caseIds?: Id[];
  /** One check per case in `caseIds`. */
  caseChecks?: CaseCheck[];
  /** Loose pieces taken out of this case. */
  fromCaseId?: Id;
  /** Was promised and confirmed as part of this delivery, not packed in the warehouse. */
  deferred?: boolean;
}

/** Packed pieces, or promised ones (`deferred`) that come with the shipping. */
export type PackedLine = ShipmentLine;

/** One packing action; what it packed stands in the warehouse until it is shipped. */
export interface PackingRecord {
  id: Id;
  bookingId: Id;
  on: IsoDate;
  userId: Id;
  lines: PackedLine[];
}

export interface Shipment {
  id: Id;
  bookingId: Id;
  label: string;
  shippedOn: IsoDate;
  userId: Id;
  lines: ShipmentLine[];
  /** Created by an event-to-event transfer rather than a warehouse dispatch. */
  transferFromBookingId?: Id;
}

export type Condition = 'ok' | 'damaged' | 'needs_check';

export interface CaseContentReturn {
  itemId: Id;
  qty: number;
  damagedQty?: number;
}

export interface ReturnLine {
  lineId: Id;
  returnedQty: number;
  locationId?: Id;
  condition: Condition;
  /** Pieces among `returnedQty` in a non-OK condition; defaults to all of them. */
  damagedQty?: number;
  note?: string;
  transferredToBookingId?: Id;
  transferredQty?: number;
  returnedToSupplier?: boolean;
  intoCaseId?: Id;
  /** Case lines: which case came back and its counted contents. */
  caseId?: Id;
  caseContents?: CaseContentReturn[];
}

export interface UnexpectedItem {
  itemId?: Id;
  name?: string;
  qty: number;
  note: string;
}

export interface ReturnSession {
  id: Id;
  bookingId: Id;
  userId: Id;
  on: IsoDate;
  lines: ReturnLine[];
  unexpected: UnexpectedItem[];
}

// ---------------------------------------------------------------------------
// Conflicts, service, issues

export type ConflictStatus = 'new' | 'in_progress' | 'resolved';

export interface ConflictRecord {
  id: Id;
  bookingId: Id;
  lineId: Id;
  target: Target;
  warehouseId: Id;
  shortQty: number;
  days: IsoDate[];
  collidingBookingIds: Id[];
  status: ConflictStatus;
  /** 'override' — confirmed with a written reason; 'detected' — appeared later on a confirmed order. */
  source: 'override' | 'detected';
  overrideReason: string;
  /** Who proposed the reason and who accepted it, when they are two people. */
  proposedBy?: Id;
  acceptedBy?: Id;
  createdOn: IsoDate;
  resolution?: string;
  resolvedBy?: Id;
  resolvedOn?: IsoDate;
}

export type ServiceStatus =
  | 'reported'
  | 'in_progress'
  | 'external'
  | 'waiting_parts'
  | 'back_to_check'
  | 'fixed'
  | 'written_off';

export interface ServiceEvent {
  status: ServiceStatus;
  comment?: string;
  userId: Id;
  on: IsoDate;
}

export interface ServiceCase {
  id: Id;
  itemId: Id;
  warehouseId: Id;
  qty: number;
  reason: string;
  internal: boolean;
  repairShop?: string;
  responsibleUserId: Id;
  status: ServiceStatus;
  openedOn: IsoDate;
  expectedBack?: IsoDate;
  cost?: number;
  /** The flight case the pieces sit in, if any (the case is then not complete). */
  caseId?: Id;
  openedFromBookingId?: Id;
  events: ServiceEvent[];
}

export type IssueType = 'missing' | 'unexpected' | 'case_incomplete';
export type IssueResolutionKind = 'found' | 'written_off' | 'charged_to_client' | 'other';

export interface Issue {
  id: Id;
  type: IssueType;
  itemId?: Id;
  /** Free-text name for unexpected items not in the catalogue. */
  name?: string;
  qty: number;
  bookingId?: Id;
  lineId?: Id;
  caseId?: Id;
  warehouseId?: Id;
  note?: string;
  reportedBy: Id;
  reportedOn: IsoDate;
  resolutionKind?: IssueResolutionKind;
  resolution?: string;
  resolvedBy?: Id;
  archivedOn?: IsoDate;
}

/** An item taken without a reservation. */
export interface Loan {
  id: Id;
  itemId: Id;
  warehouseId: Id;
  qty: number;
  /** A user, or `borrowerName` for somebody without an account. */
  borrowerId?: Id;
  borrowerName?: string;
  recordedBy: Id;
  createdOn: IsoDate;
  from: IsoDate;
  /** Expected return, when given. */
  until?: IsoDate;
  /** Last day the pieces count as out; the nightly job moves it while the loan is undated or overdue. */
  heldUntil: IsoDate;
  /** The flight case the pieces were taken out of. */
  fromCaseId?: Id;
  note?: string;
  /** Why it was taken although an order needs it. */
  reason?: string;
  returnedOn?: IsoDate;
  returnedBy?: Id;
  /** Given up before it started. */
  cancelledOn?: IsoDate;
}

/** Derived, not stored: a case that must be brought back to full. */
export interface RefillTask {
  caseId: Id;
  missing: QtyLine[];
  since: IsoDate;
}

export interface StockTransfer {
  id: Id;
  itemId: Id;
  qty: number;
  fromWarehouseId: Id;
  toWarehouseId: Id;
  on: IsoDate;
  bookingId?: Id;
}

// ---------------------------------------------------------------------------
// Communication

export type NotificationType =
  | 'prebooking_submitted'
  | 'prebooking_returned'
  | 'order_confirmed'
  | 'conflict_overridden'
  | 'conflict_detected'
  | 'order_edited_after_packing'
  | 'upcoming_loading'
  | 'batch_shipped'
  | 'overdue_return'
  | 'returned_with_issues'
  | 'service_opened'
  | 'service_overdue'
  | 'service_fixed'
  | 'service_affects_order'
  | 'case_incomplete'
  | 'validation_waiting'
  | 'prebooking_expiring'
  | 'prebooking_expired'
  | 'external_not_returned'
  | 'conflict_unresolved'
  | 'case_shipped_short'
  | 'loan_overdue'
  | 'order_packed'
  | 'promised_missing'
  | 'shipping_cancelled'
  | 'cancel_requested'
  | 'cancel_decided'
  | 'reservation_affected'
  | 'booking_cancelled'
  | 'booking_reopened'
  | 'cancel_unpack'
  | 'gear_released'
  | 'transfer_lost'
  | 'shortage_solved'
  | 'late_item';

export type Params = Record<string, string | number>;

export interface Notification {
  id: Id;
  userId: Id;
  bookingId?: Id;
  type: NotificationType;
  /** Values for the UI template of `type`. */
  params: Params;
  /** English fallback text (logs, tests). The UI renders `type` + `params` in Czech. */
  text: string;
  on: IsoDate;
  read: boolean;
  highPriority?: boolean;
}

export type SystemEventType =
  | 'created'
  | 'stage_changed'
  | 'submitted'
  | 'returned_to_pm'
  | 'confirmed'
  | 'override'
  | 'shortage_solved'
  | 'late_item'
  | 'attachment_added'
  | 'attachment_removed'
  | 'packing_started'
  | 'packed'
  | 'unpacked'
  | 'batch_shipped'
  | 'packing_cancelled'
  | 'shipping_cancelled'
  | 'cancel_requested'
  | 'cancel_declined'
  | 'cancel_withdrawn'
  | 'cancel_started'
  | 'cancelled'
  | 'reopened'
  | 'shipped_without'
  | 'promised_arrived'
  | 'promised_closed'
  | 'lines_added_after_shipping'
  | 'edited'
  | 'return_session'
  | 'transfer_in'
  | 'transfer_out'
  | 'issue_resolved'
  | 'closed'
  | 'expired'
  | 'line_marked';

/** A note or a file added to a booking. */
export interface Attachment {
  id: Id;
  bookingId: Id;
  by: Id;
  on: IsoDate;
  text?: string;
  /** The contents are stored by the app under `key`. */
  file?: { name: string; size: number; key: string };
}

export interface Message {
  id: Id;
  bookingId: Id;
  authorId: Id;
  on: IsoDate;
  text?: string;
  event?: { type: SystemEventType; params: Params };
}

// ---------------------------------------------------------------------------
// Settings and whole state

export interface ReminderSettings {
  validationWaitingAfter: number;
  validationWaitingEvery: number;
  prebookingExpiryWarnBefore: number;
  loadingBefore: number;
  overdueReturnEvery: number;
  serviceOverdueEvery: number;
  externalNotReturnedEvery: number;
  caseIncompleteWarehouseAfter: number;
  caseIncompleteChiefAfter: number;
  conflictBefore: number;
}

export interface Settings {
  bufferBeforeDays: number;
  bufferAfterDays: number;
  /** How many days ahead an undated or overdue loan counts as out. */
  loanHorizonDays: number;
  /** Packing further ahead than this has to be activated and warns. */
  earlyPackingDays: number;
  reminders: ReminderSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  bufferBeforeDays: 1,
  bufferAfterDays: 1,
  loanHorizonDays: 7,
  earlyPackingDays: 7,
  reminders: {
    validationWaitingAfter: 2,
    validationWaitingEvery: 2,
    prebookingExpiryWarnBefore: 3,
    loadingBefore: 1,
    overdueReturnEvery: 2,
    serviceOverdueEvery: 3,
    externalNotReturnedEvery: 2,
    caseIncompleteWarehouseAfter: 2,
    caseIncompleteChiefAfter: 7,
    conflictBefore: 7,
  },
};

export interface AppState {
  users: User[];
  warehouses: Warehouse[];
  locations: Location[];
  categories: Category[];
  items: Item[];
  stock: ItemStock[];
  caseTypes: CaseType[];
  cases: Case[];
  connections: Connection[];
  clients: Client[];
  bookings: Booking[];
  packings: PackingRecord[];
  shipments: Shipment[];
  returnSessions: ReturnSession[];
  conflicts: ConflictRecord[];
  serviceCases: ServiceCase[];
  issues: Issue[];
  transfers: StockTransfer[];
  loans: Loan[];
  notifications: Notification[];
  messages: Message[];
  attachments: Attachment[];
  settings: Settings;
  /** Per-prefix counters for deterministic IDs. */
  counters: Record<string, number>;
  /** Reminder key → last day it fired (keeps daily jobs idempotent). */
  jobLog: Record<string, IsoDate>;
}

/** The parts of the state the connections engine needs. */
export type CatalogView = Pick<AppState, 'items' | 'caseTypes' | 'connections'>;
