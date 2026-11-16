# Decisions

Ambiguities resolved during implementation. Format: date — question → choice (why).

- 2026-11-16 — **npm scripts on a path with `&`.** The repository folder name contains `&`, which breaks npm's Windows `.cmd` shims (`npx`, `node_modules/.bin`). → All scripts call tool entry points directly (`node ../../node_modules/typescript/bin/tsc`, etc.). Works identically on Linux/macOS. (Renaming the folder would also fix it, but that is the user's call.)
- 2026-11-16 — **What does "build" mean for source-only packages?** `core` and `fixtures` are consumed as TypeScript source by Vite/Vitest. → `core` build emits `dist/` with declarations (useful for the Batch 2 server); `fixtures` build is a strict no-emit compile of `src`. (Keeps one tsconfig per package; no project-reference plumbing.)
- 2026-11-16 — **Router.** `HashRouter` in the prototype so the static build works from any folder or static host without rewrite rules.

## M1 — domain core

- 2026-11-16 — **When is an OR choice "open"?** The concept says the editor preselects the first option with enough stock *and* that confirmation is blocked while an OR choice is open. → An OR group is **open only when no person chose and no option is available**; then the first option is shown provisionally and confirmation is blocked until someone picks. A preselected (available) option counts as decided. A person's choice is stored per booking (`orChoices`) and always wins; a previous preselection is kept while it stays available. (Avoids forcing a click on every OR group while still never confirming an unavailable mount.)
- 2026-11-16 — **Who is short when two confirmed orders collide?** → Orders have a confirmation sequence (`confirmSeq`); a confirmed order is evaluated only against orders confirmed **before** it. The later (overriding) order carries the conflict; the earlier one is not flagged. Drafts and pre-bookings are evaluated against all orders. (One conflict record per collision instead of two.)
- 2026-11-16 — **Conflicts that appear after confirmation** (service case opened, an order edited) → `recomputeConflictRecords` creates a `detected` conflict record (status *Nový*) on confirmed/packing orders that became short, notifying the Chief and PMs. Records resolve automatically when availability covers the line again.
- 2026-11-16 — **Lines without a source warehouse** → served from the booking's `defaultWarehouseId` if it stocks the item/case, else from the first warehouse that does. Splitting a line across warehouses is an explicit editor action (`splitLine`).
- 2026-11-16 — **External rental of a case-type shortage** → becomes an external line of the case type's primary item (first standard content) × pieces per case, e.g. "8× Astera AX9" for one AX9 case, matching the concept's Gala scenario. Accessories are assumed to come with the rented gear.
- 2026-11-16 — **One auto line per target.** Auto lines have stable ids `auto:item:<id>` / `auto:case:<id>` and sum all parents; once-per-order contributions take the max. A manual line of the same item stays a separate line.
- 2026-11-16 — **Line status Missing / Substituted** → such lines are inactive: they do not hold stock, are not packed and do not block confirmation.
- 2026-11-16 — **Missing pieces in vratka** → an `Issue` (type `missing`) is created as soon as a confirmed return line is short, and updated/archived by later sessions. Open missing issues hold stock (from the booking start, with no end) until resolved, which implements "returned with issues holds only the missing pieces, until resolved".
- 2026-11-16 — **Returned vs. closed** → a booking with every line settled goes to `returned` (stock free); `close` is an explicit Chief/warehouse action that makes it read-only. With open missing issues it is `returned_with_issues` and becomes `returned` when the last issue is resolved.
- 2026-11-16 — **Case lines in vratka** are confirmed one case at a time (one return entry per case number). A whole case not returned is a `missing` issue that holds the case and its contents. Event-to-event transfers are supported for loose-item lines only in Batch 1.
- 2026-11-16 — **Damaged pieces** → loose damaged pieces are not put back into a case (the case stays incomplete → refill task). A damaged piece counted inside a returned case stays in the case, and the service case references the case, so the case is not complete until the service case closes.
- 2026-11-16 — **Event-to-event transfer windows** → a line on B with `fromBookingId = A` is held from the day after A's last booked day (or from the actual handover day once it happens) until B ends. The handed-over pieces stop counting on A. No gap, no double count.
- 2026-11-16 — **Indicative price total** = Σ line day price × **event days** (not booked days with buffers). Case types are priced as the sum of their contents.
- 2026-11-16 — **Incomplete case reminders** (2 / 7 days) are skipped while the case or pieces taken from it are out on an active order; the clock restarts on the vratka day.
- 2026-11-16 — **Notification and thread texts** → core stores `type` + `params` and an English fallback `text`; the UI renders Czech from `cs.ts`. Keeps all Czech strings in one file.
- 2026-11-16 — **Lines added after shipping** → Chief only (the warehouse cannot create orders). The order goes back to `packing`; new lines and their auto accessories are flagged `addedAfterShipping`.

## M2 — fixtures

- 2026-11-16 — **How are fixture bookings built?** → Not as hand-written records: a small builder drives every booking through the real core API (create → lines → submit → confirm → pack → ship → vratka → close) with past dates up to "today" (2027-04-20). Shipments, return sessions, issues and conflict records are therefore always consistent with the rules; a fixture that would violate a rule fails the build.
- 2026-11-16 — **Connections count** → 144 instead of ~80: helper groups (power/DMX checks, shared desk OR group, hang-or-stand nested group) are expanded per fixture type. More coverage, same rule set.
- 2026-11-16 — **Scenario `galaDinner`** → the base data holds "Firemní den" (PM Jana Nováková, one AX9 case on 23–25 Apr). The Gala pre-booking itself is created by Petr during the demo (acceptance test 1); `GALA_STEPS` replays the full walk-through in tests. Brod has two AX9 cases and Karlák's AX9-03 starts incomplete, so the Gala is short exactly one case.
- 2026-11-16 — **"Affected order in May"** (concept step 9) → *Květnový festival* (PM Jana) books both Brod AX9 cases; the service case on AX9-02 makes it short and notifies its PM.
- 2026-11-16 — **Scenario `transfer`** → the base data already contains the planned TechConf → "Letní noc – warm-up" transfer (8 LEDBeams), so the scenario is the base state focused on those bookings.
- 2026-11-16 — **Scenario `caseBreaking`** → uses AX1, whose loose stock is zero (all 32 in four cases, one incomplete). With complete cases only, the plan's `broken` formula can never push `caseFree` below zero for a line that is green at item level, so the demo needs an incomplete case.
- 2026-11-16 — **Filler bookings** → 8 small PRNG bookings (seed 2027) avoid LEDBeams, AX1/AX9 and cases so the scenario numbers stay exact.
- 2026-11-16 — **Demo notifications** → notifications older than today are marked read; tonight's job (run for 2027-04-20) leaves fresh, unread reminders for the bell.

## M3 — prototype 1A

- 2026-11-16 — **Editor model** → the editor keeps a working copy of the booking and applies the core's pure edit functions (`addLine`, `setLineQty`, `chooseOr`, `coverWithExternal`, …) live; *Uložit / Odeslat / Potvrdit* store it through `saveBooking` and the lifecycle actions. Badges, conflicts, checks and recommendations are recomputed on every change.
- 2026-11-16 — **Override vs. external in the UI** → anyone who may confirm (Chief, PM with `canConfirmOwnOrders` on own booking) sees the override-reason field; only the Chief sees "Pokrýt externím pronájmem" and the Missing / Substituted markers, matching the concept's role table.
- 2026-11-16 — **Planned transfer source** → the line's source dropdown offers other orders that end within 14 days before this booking and contain the same item ("z akce …").
- 2026-11-16 — **Fonts** → IBM Plex Sans / Plex Sans Condensed bundled via `@fontsource` (no CDN at runtime).
- 2026-11-16 — **Screenshots** → `scripts/shot.mjs` (Playwright) captures pages of the running dev server for visual review; `PW_CHROME` may point at a local Chromium.
