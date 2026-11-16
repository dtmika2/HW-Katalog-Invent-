# Dev plan — Batch 1: domain core + prototypes (no backend, no paid services)

Nov 16, 2026 · for Claude Code · source of truth: `docs/concept.md` (the HW Catalogue concept)

## How to use this plan

1. Create an empty folder (git repository), put two files in it:
   - `docs/concept.md` — the concept document (`HW-catalogue-concept.md`)
   - `docs/plan.md` — this file
2. Start Claude Code in that folder with permissions that allow editing files and running `npm`, `npx`, `node` and `git` without asking (auto-accept edits plus allowed shell commands, ideally inside a container or VM).
3. Give it one prompt:

   > Read `docs/plan.md` and `docs/concept.md`. Execute the plan from Milestone 0 to the end, autonomously, following the "Working rules" section. Do not stop to ask me questions.

The batch ends with a running prototype app, a tested domain package and `REPORT.md` with a demo script for the checkpoint with the Chief and a PM.

---

## Working rules (copy this section into `CLAUDE.md` in Milestone 0)

**Autonomy**
- Never stop to ask the user. When something is ambiguous, pick the option most consistent with `docs/concept.md`, write it to `DECISIONS.md` (date, question, choice, why), and continue.
- If something is truly blocked (a tool cannot be installed, a test cannot be made to pass after three honest attempts), write it to `BLOCKERS.md` with what you tried, and move on to the next independent task. Come back to blockers at the end.
- Work milestone by milestone, in order. Within a milestone, tasks can be done in any order.

**Scope guardrails**
- No backend, no database server, no Supabase, no auth provider, no cloud service, no API keys, no paid packages. Everything runs locally with `npm`.
- All data is in memory in the browser, seeded from the fixtures package. `localStorage` may persist prototype state, with a visible "Obnovit demo data" (reset) button.
- Do not build features listed under "Later phases" in the concept, except where this plan says so.
- UI text is Czech. All UI strings live in `apps/proto/src/i18n/cs.ts`; no hard-coded Czech strings in components. Code, identifiers, comments, tests and docs are in English.

**Quality gate (run after every task, must be green before committing)**
- `npm run typecheck` — TypeScript strict, no `any` in `packages/core`.
- `npm test` — Vitest.
- `npm run lint` — ESLint + Prettier check.
- `npm run build` — all workspaces build.

**Git**
- Commit after each completed task with a message `M<milestone>.<task>: <summary>`. Never rewrite history. Tag each finished milestone `m0`, `m1`, …

**Design of the core**
- `packages/core` is pure TypeScript: no React, no DOM, no I/O, no `Date.now()`. "Today" is always a parameter. Functions take state and return new state or results; no mutation of inputs.
- Dates are calendar days as ISO strings `YYYY-MM-DD` (type `IsoDate`), handled by small helpers in `core/src/dates.ts` (add days, compare, iterate range inclusive). No time zones in Batch 1.
- Every rule from the concept that core implements has at least one test named after the rule.

---

## Tech stack (fixed — don't revisit)

| Concern | Choice |
| --- | --- |
| Repo | npm workspaces monorepo, Node 20+ |
| Language | TypeScript 5, `strict: true` |
| Tests | Vitest; React Testing Library for components |
| E2E smoke | Playwright, **optional**: if browser download fails, skip it and note in `BLOCKERS.md` |
| App | React 18 + Vite + React Router |
| State in app | Zustand store wrapping core state and actions |
| Styling | Tailwind CSS; mobile-first for warehouse screens |
| Excel import (M5) | SheetJS (`xlsx`) community build from npm |
| Random data | Seeded PRNG (own `mulberry32`), so fixtures are deterministic |

## Repository layout

```
/docs/concept.md, /docs/plan.md
/CLAUDE.md, /DECISIONS.md, /BLOCKERS.md, /REPORT.md
/packages/core/src/
    types.ts            all domain types
    dates.ts
    catalog/            lookups, stock per warehouse, loose vs in-case stock
    expansion/          connections engine
    availability/       per-day item and case availability
    conflicts/          detection, acknowledgement, override records, resolution
    lifecycle/          booking state machine + permission checks
    shipping/           packing and batches
    returns/            vratka sessions, outcomes, transfers, unexpected items
    cases/              completeness, refill tasks
    service/            service cases and status flow
    issues/             pending issues list
    jobs/               runDailyJobs(state, today) → notifications + expiries
    notifications/
    index.ts            public API
/packages/core/test/   one file per module + scenarios.test.ts
/packages/fixtures/src/
    generate.ts         seeded generator → AppState
    catalog-data.ts     hand-written realistic items, case types, connections
    scenarios/          gala-dinner.ts, conflict-chain.ts, transfer.ts, …
/apps/proto/src/
    i18n/cs.ts, store/, routes/, components/
```

---

## Domain model in core (types to implement)

Mirror the concept's data model, as plain TypeScript types (IDs are strings):

- `User { id, name, role: 'pm'|'chief'|'warehouse'|'admin', perms: { canConfirmOwnOrders, canEditCatalogue, canManageService } }`
- `Warehouse` (Brod, Karlák), `Location { id, warehouseId, parentId?, name, path }`, `Category { id, name, parentId? }`
- `Item { id, name, manufacturer, model, categoryId, priceDay, returnable, weightKg?, notes?, archived }`
- `ItemStock { itemId, warehouseId, qty, homeLocationId }`
- `CaseType { id, name, contents: { itemId, qty }[] }`
- `Case { id, caseTypeId, number, warehouseId, locationId, contents: { itemId, qty }[] }` (actual contents)
- `Connection { id, fromItemId, target: { itemId } | { caseTypeId }, kind: 'required'|'check'|'recommended', groupId?, groupMode?: 'and'|'or', parentGroupId?, rule: 'per_piece'|'per_n'|'once_per_order', n?, qty }`
- `Client`, `Booking { id, type: 'prebooking'|'order', status, eventName, clientId, purposeMessage, pmId, confirmedBy?, createdAt, submittedAt?, periods: BookingPeriod[], lines: BookingLine[] }`
- `BookingPeriod { eventFrom, eventTo, bookedFrom, bookedUntil }`
- `BookingLine { id, target: { itemId } | { caseTypeId } | { external: { name, itemId?, supplier, pickup, returnDate, note } }, qty, sourceWarehouseId?, fromBookingId?, expectedReturnWarehouseId?, origin: 'manual'|'auto'|'kit', parentLineIds: string[], orGroupKey?, orChoice?, overriddenQty?, status: 'ok'|'missing'|'substituted', conflictAck: boolean, overrideReason? }`
- `Shipment { id, bookingId, label, shippedOn, userId, lines: { lineId, qty, caseIds?: string[], fromCaseId?: string }[] }`
- `ReturnSession { id, bookingId, userId, on, lines: ReturnLine[] }`, `ReturnLine { lineId, returnedQty, locationId, condition: 'ok'|'damaged'|'needs_check', note?, transferredToBookingId?, transferredQty?, returnedToSupplier?, intoCaseId? }`
- `ConflictRecord { id, bookingId, lineId, target, shortQty, days: IsoDate[], collidingBookingIds, status: 'new'|'in_progress'|'resolved', overrideReason, resolution?, resolvedBy? }`
- `ServiceCase { id, itemId, warehouseId, qty, reason, internal, repairShop?, responsibleUserId, status: 'reported'|'in_progress'|'external'|'waiting_parts'|'back_to_check'|'fixed'|'written_off', expectedBack?, cost?, events: { status, comment?, userId, on }[] }`
- `Issue { id, type: 'missing'|'unexpected'|'case_incomplete', itemId, qty, bookingId?, caseId?, reportedBy, resolution?, archivedOn? }`
- `RefillTask { caseId, missing: { itemId, qty }[], since: IsoDate }` (derived, not stored)
- `Notification { id, userId, bookingId?, type, text, on, read }`
- `AppState` = all of the above + `settings` (buffers, reminder timings from the concept).

---

## Exact rules for the tricky parts (implement exactly this)

### Availability per day (per warehouse and total)

For item `i`, warehouse `w`, day `d`:

- `total(i,w)` = `ItemStock.qty`
- `outOfService(i,w,d)` = sum of `qty` of service cases for `i,w` whose status is not `fixed`/`written_off` (they block from open day until closed; in projections, open cases block all future days)
- `hardHeld(i,w,d)` = sum over **orders** (type `order`, status from confirmed up to and including vratka; "returned with issues" holds only the missing qty) of line quantities sourced from `w` whose booked period contains `d`. Case lines contribute their case type's standard contents × qty. External lines contribute nothing. Lines with `fromBookingId` are held by the source booking until its transfer, then by the target (no gap).
- `softHeld(i,w,d)` = same, for submitted, non-expired pre-bookings
- `free = total − outOfService − hardHeld`; badge: `green` if `free − requested ≥ 0` and `free − softHeld − requested ≥ 0`; `amber` if only the first holds; `red` otherwise, showing `short = requested − free`.
- A booking being edited never counts against itself.
- The badge for a line is the **worst day** over all its booked periods.

### Case availability

- `looseStock(i,w)` = `total(i,w)` − sum of `i` in actual contents of all cases in `w`.
- A case is **complete** if actual contents equal its type's standard contents.
- For case type `t`, warehouse `w`, day `d`:
  - `completeCases` = complete cases of `t` in `w` not marked as held by service (a case whose contents include out-of-service pieces is not complete)
  - `caseHeld` = sum of case-line quantities of `t` in hard-held orders on `d`
  - `broken` = cases that loose-item demand forces open: for each item `i` in `t`'s contents, `overflow_i = max(0, looseHeldDemand(i,w,d) − looseStock(i,w))`; `broken = max_i ceil(overflow_i / perCase_i)`, where `looseHeldDemand` is the hard-held demand for `i` from loose-item lines only
  - `caseFree = completeCases − caseHeld − broken`
- A case line is short when `caseFree − requested < 0`. A loose line that would push some case type's `caseFree` below zero on a day where whole cases are booked shows an **amber "rozbije case"** warning (not red), naming the order that booked the cases.

### Connections expansion

`expand(manualLines, catalog, previous?) → { lines, openOrChoices, checkWarnings, recommendations }`

1. Start from manual lines (items or case types; a case type counts as its contents for connection purposes *and* the case itself may have connections defined on any contained item).
2. BFS over required connections. For each parent line × connection compute the quantity by rule: `per_piece` → `parentQty × qty`; `per_n` → `ceil(parentQty / n) × qty`; `once_per_order` → `qty`.
3. Sum per target across all parents. For `once_per_order`, take the **max** across parents instead of the sum (shared groups: all moving heads → one desk).
4. Recurse into the targets' own required connections with the summed quantity. Detect cycles (visited set per path); stop and record a warning, never loop.
5. OR groups: produce one `openOrChoice` per (parent line, group). Preselect the first option whose availability is green for the whole period, else the first option. Respect an existing `orChoice` from `previous`.
6. Nested groups: an OR group's option may itself be an AND group (one level deep only).
7. Each auto line carries `parentLineIds`. Recalculation keeps `overriddenQty` lines and marks them `overridden`; if all parents disappear, the auto line is removed unless it was overridden (then it becomes manual with a note).
8. Check connections: for each, if none of the listed targets appear on the order (after expansion), emit a `checkWarning` with one-click candidates. Never added automatically.
9. Recommendations: collected for all lines, deduplicated, excluding items already on the order and items dismissed on this booking.

### Conflicts and confirmation

- `detectConflicts(booking, state)` → short lines (items and case types) with worst day, short qty and colliding bookings (orders and pre-bookings holding the item on those days, with PM and dates).
- `submitPrebooking` fails if any red line has `conflictAck === false`.
- `confirm(booking, user, state, today)`:
  - Permission: Chief, or PM with `canConfirmOwnOrders` for their own booking; otherwise error.
  - All OR choices must be closed.
  - For each short line: it must be external, or have `overrideReason` (non-empty) → creates a `ConflictRecord` (status `new`) and notifications to the Chief and the PMs of the colliding orders. Otherwise confirmation fails with the list of blocking lines.
- `recomputeConflictRecords(state)` runs after every state change: a record becomes `resolved` automatically when the line is no longer short; it can also be closed manually by the Chief with a resolution text. Records are never deleted.

### Lifecycle

Implement the state machine from the concept as a transition table; every action checks the role/permission and the current state and returns a typed error otherwise. Actions: `submit`, `returnToPm`, `confirm`, `startPacking`, `ship(batch)`, `addLinesAfterShipping`, `recordReturnSession`, `resolveIssue`, `close`, `expire` (job only).

### Returns

- The return screen lists **shipped** quantities (sum of shipment lines), not ordered ones.
- Each return line requires an explicit count (default 0), location, condition and confirmation; a note is required when short or damaged.
- Outcome per line: complete / short (open as missing → Issue) / damaged or needs_check (→ ServiceCase with status `reported`) / transferred (to booking B: closed on A, appears on B as shipped) / returned to supplier (external) / consumable (skipped).
- A case card offers "Kompletní dle standardu" for one case at a time.
- Pieces shipped with `fromCaseId` are suggested back to that case (`intoCaseId` prefilled). If not returned into it, the case stays incomplete → refill task.
- Booking goes to `returned` when every shipped line has an outcome, `returned_with_issues` if any line is missing.

### Daily jobs

`runDailyJobs(state, today)` → `{ state, notifications }`, idempotent for the same day, implementing the reminder table in the concept (pre-booking expiry and reminders, upcoming loading, overdue return, service overdue, external not returned, incomplete case 2/7 days, unresolved conflict, validation waiting).

---

## Fixture dataset (packages/fixtures)

Deterministic (seed `2027`), realistic for a Czech AV rental company. "Today" for the demo is **2027-04-20**.

- **Users (8):** Chief (Tomáš), 3 PMs (Jana Nováková — `canConfirmOwnOrders`, Petr Dvořák, Lucie Malá), 3 warehouse (Martin, Ondra, Karel — `canManageService`), 1 admin.
- **Warehouses:** Brod, Karlák; each with 2–3 sections, racks and shelves (~40 locations).
- **Categories:** Audio, Světla, Video a projekce, LED obrazovky, Rigging a konstrukce, Elektrodistribuce, Kabeláž, Stage, Ostatní — with 2–4 subcategories each.
- **Items (~150), hand-written in `catalog-data.ts`:** real-sounding models (Robe LEDBeam 150, Astera AX9 PowerPAR, Astera AX1, Chauvet Rogue, Shure ULXD, Allen & Heath dLive/SQ, DiGiCo, d&b E-series, Epson projectors, LED panels 2.9 mm, Prolyte truss, PowerCON / DMX / CAT cables, clamps, safety ropes, distros, gaffer tape as consumable…). Prices 50–6 000 Kč/day. Stock split between Brod and Karlák.
- **Case types (~12) and cases (~30):** e.g. "AX9 case" (8× AX9, 8× charger plate, 1× PSU) × 3, "Stagebox case", "LEDBeam case 4×", "ULXD case 4ch". At least 2 cases start incomplete.
- **Connections (~80):** cover every kind and rule: required AND, required OR (clamp OR floor stand), nested group, per_n (DMX splitter per 8), once_per_order (desk), shared desk across fixture types, a cycle (to test detection), check groups for power cables, recommendations.
- **Clients (10)**, **bookings (~30)** across March–June 2027 in every state, some multi-period, some mixed-warehouse, one planned event-to-event transfer, two with external lines, one returned with issues, two expired pre-bookings.
- **Service cases (5)** in different statuses, one overdue.
- **Scenarios** (each a function that builds state and is used both in tests and in the app's scenario switcher):
  - `galaDinner` — the concept's model scenario (AX9 case conflict with "Firemní den", PM Jana Nováková, external rental, two shipment batches, short power cable, one AX9 to service).
  - `conflictChain` — three overlapping bookings on LEDBeams with soft and hard holds.
  - `transfer` — A → B transfer without a gap.
  - `caseBreaking` — loose bookings that would break cases booked whole by another order.

---

## Milestones

### M0 — Scaffold (tag `m0`)

1. Init npm workspaces, TypeScript strict configs, ESLint, Prettier, Vitest, scripts `typecheck|test|lint|build|dev`.
2. Create `CLAUDE.md` (Working rules above + a short pointer to this plan), empty `DECISIONS.md`, `BLOCKERS.md`.
3. Empty packages `core`, `fixtures`, app `proto` (Vite + React + Tailwind + Router) that renders "QUIX HW" home.

**Done when:** all four quality-gate commands pass; `npm run dev` serves the app.

### M1 — Domain core (tag `m1`)

Implement modules in this order, each with tests before moving on: `dates` → `types` → `catalog` → `expansion` → `availability` (items, then cases) → `conflicts` → `lifecycle` (+ permissions) → `shipping` → `returns` → `cases` (refill tasks) → `service` → `issues` → `jobs` → `notifications`.

**Required tests (minimum; name them after the rule):**

- Expansion: per_piece (10 lights → 10 clamps); per_n rounding (10 → 2 splitters); once_per_order capped across parents (LEDBeam + Rogue → one desk); recursion (desk → its power cable); cycle detected without infinite loop; OR preselects first green option; OR keeps previous choice; nested OR(AND) group; open OR blocks confirm; parent qty lowered → auto lines recalculated; parent removed → auto lines removed; override kept on recalculation; check warning when no cable present, gone when one is added; recommendations deduped and dismissed ones hidden; case-type line expands connections of its contents.
- Availability: buffer days included; booking never counts against itself; multi-period booking holds only its periods; pre-booking soft only (amber); expired pre-booking ignored; service case blocks and is not auto-released after expected date; mixed warehouses computed separately and in total; "returned with issues" holds only missing qty; transfer A → B holds without a gap; external lines not counted; worst-day badge across the period.
- Cases: complete/incomplete detection; loose stock excludes in-case pieces; case line reserves contents; `broken` formula; "rozbije case" amber warning; case with out-of-service piece is not complete.
- Conflicts & lifecycle: submit blocked without acknowledgement; confirm blocked on short line; confirm allowed with override reason → ConflictRecord + notifications; external line resolves shortage; PM without permission cannot confirm; PM with permission confirms own booking but not someone else's; conflict auto-resolves when the other order shrinks; Chief manual resolution; every illegal transition returns a typed error.
- Shipping & returns: two batches; lines added after shipping → back to packing + high-priority notification; return lists shipped not ordered; default 0, note required when short/damaged; short → Issue and `returned_with_issues`; damaged → ServiceCase; partial transfer 6 of 10 to B; return to other warehouse moves stock; unexpected item → Issue; consumables skipped; multiple return sessions; piece suggested back into its case; case not refilled → refill task.
- Service: status flow incl. written_off lowering stock; fixed releases stock; overdue detection.
- Jobs: every reminder in the concept's timing table fires on the right day and only once per day; pre-booking expires on the event's first day.
- `scenarios.test.ts`: run `galaDinner` end to end through the public API and assert the final state matches the concept's model scenario step by step.

**Done when:** all tests green, core coverage ≥ 90 % lines (`vitest --coverage`), public API documented with TSDoc in `index.ts`.

### M2 — Fixtures (tag `m2`)

Implement the dataset and scenarios above. Add `fixtures` tests: data is internally consistent (all references resolve, stock ≥ case contents, no negative availability on "today" except where a scenario intends it), generator is deterministic.

### M3 — Prototype 1A: order editor (tag `m3`)

App shell: role switcher (pick a user from fixtures; UI adapts to role/permissions), scenario switcher, "simulated today" date picker with a "Spustit noční úlohy" button (runs `runDailyJobs`), notification bell, reset button. All screens in Czech.

Screens:
- **Pre-booking / order editor**: event info, client, purpose message, booked periods with default buffer; search and add items or case types; auto lines nested under parents with "auto" tag and "pro: LEDBeam ×10" hint; OR choice chips; check warnings with one-click add; recommendation panel ("Mohlo by se hodit") with dismiss; availability badge on every line (green/amber/red, short count, "rozbije case"); conflict panel with colliding bookings (event, PM, dates, state); acknowledgement checkbox; mark line missing / substituted / external (external form); override with reason; running indicative price total; Submit / Return to PM / Confirm according to permissions; booking thread showing system events.
- **Dashboard (Chief / PM)**: validation queue, my bookings, open conflict records, pending issues.

**Acceptance (write as component tests where practical, and as Playwright smoke if available):**
1. Load `galaDinner`, log in as Petr (PM), create the Gala Dinner pre-booking, add 2× AX9 case, digital desk and stagebox case → required accessories appear nested; power cable check warning appears; AX9 case line is red "chybí 1 case", conflict panel names "Firemní den" with PM Jana Nováková and its dates.
2. Submit is disabled until the conflict is acknowledged.
3. As Tomáš (Chief): mark 8× AX9 as external → line no longer blocks; confirm succeeds; order appears in calendar data as hard hold.
4. As Jana (PM with permission): confirm own booking with an override reason in a scenario where it collides with one of Petr's orders → conflict record "Nový" visible on Chief dashboard; Petr gets a notification.
5. As Lucie (PM without permission): no Confirm button.
6. Changing LEDBeam quantity 10 → 4 recalculates clamps and splitters live, keeps an overridden cable count.

### M4 — Prototype 1B: availability calendar (tag `m4`)

- **Item calendar** on an item detail page: month grid, each day "volné / celkem", warehouse filter (Brod / Karlák / vše), soft holds striped, service grey; click a day → list of bookings and service cases holding it (event, PM, dates, state).
- **Case type calendar**: same for complete cases free.
- **Event calendar**: bookings as bars per day/week, coloured by state, filter by PM and state.
- Editing a booking in 1A and returning to the calendar shows recomputed numbers.

**Acceptance:** in `conflictChain`, the LEDBeam calendar shows the exact free counts asserted in a test; clicking the worst day lists all three bookings; a service case opened from the item page immediately lowers the counts and is still blocking after its expected-back date.

### M5 — Independent prototypes (tags `m5a`…`m5d`, any order)

Each uses the same app shell and core; each has 2–4 acceptance tests.

- **5a Catalogue editor:** table view with inline editing and validation; card view; categories; case types with standard contents and cases with actual contents; connection builder (target, kind, group, rule) with "used by" reverse list; **"Vyzkoušet"** preview (type "LEDBeam ×10" → expanded list); completeness indicator and "potřebuje doplnit" filter; Excel template download and import (SheetJS) with a row-level error report; archive instead of delete. Photo upload stores a data URL in memory (no storage service).
- **5b Packing (mobile layout):** per-warehouse flat list grouped by location; cases as one line with contents; pick case numbers; record `fromCaseId` for loose pieces taken out of a case; tick lines; ship in batches with label ("Dodávka 1"); lines added after shipping appear as a new batch with a high-priority banner.
- **5c Vratka (mobile layout):** per-line cards with photo, stepper starting at 0, location, condition, note; case cards with "Kompletní dle standardu"; suggestion to return into the source case; transfer to another booking (partial); returned to supplier for external; unexpected item; multiple sessions; result screen showing issues and service cases created.
- **5d Service & cases:** service case list and detail with status flow, responsible person, expected back, overdue badge, history; warehouse dashboard with today's packing, expected returns, gear waiting for check, open service cases, incomplete cases with "Doplnit case" action and age.

### M6 — Wrap-up (tag `batch-1`)

1. Re-run the full quality gate; fix anything red.
2. Resolve or document all entries in `BLOCKERS.md`.
3. Write `REPORT.md`:
   - what was built, per milestone, with test counts and coverage
   - every entry from `DECISIONS.md`, highlighted where it deviates from or extends the concept
   - how to run (`npm install`, `npm run dev`, `npm test`)
   - **demo script for the checkpoint** (15–20 minutes): the Gala Dinner walk-through as Petr → Tomáš → Martin, then `conflictChain` and `caseBreaking`, then the calendar
   - list of questions for the Chief and PMs that came up during implementation
   - what Batch 2 (Supabase backend, locally) will need from the core API
4. Do **not** start Batch 2.

---

## Out of scope for Batch 1

Supabase or any backend, real auth, file storage, e-mail/push, QR scanning, PDF export, kits page, spot stock checks, technical specs and attachments, commercial pricing (discounts, commissions, quotes), serial numbers, offline mode, deployment.
