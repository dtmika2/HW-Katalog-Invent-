# Batch 1 report — domain core + prototypes

Nov 16, 2026 · plan: `docs/plan.md` · concept: `docs/concept.md`

Batch 1 is finished: a tested domain package, a realistic demo dataset with scenarios, and a browser prototype covering the order editor, availability calendars, catalogue editor, packing, vratka and service. There is no backend and nothing paid; everything runs locally with `npm`.

## How to run

```bash
npm install
npm run dev        # prototype at http://localhost:5173 (Vite prints the port)
npm test           # all unit and component tests
bash scripts/gate.sh   # typecheck + test + lint + build, stops at first failure
npm run coverage   # core coverage
npm run e2e        # optional browser smoke test (see BLOCKERS.md for PW_CHROME)
```

Node 20+ is required. The repository folder name contains `&`, so scripts call tools via `node …` instead of `npx` (works the same on Linux/macOS).

In the app, the grey bar at the top is the prototype control panel: **Přihlášen jako** (switch user and role), **Scénář** (load a scenario), **Simulované dnes** (default 20 Apr 2027), **Spustit noční úlohy** (runs the nightly job for that day) and **Obnovit demo data** (reset). State is kept in `localStorage` between reloads.

## What was built

| Milestone | Tag | What | Tests |
| --- | --- | --- | --- |
| M0 scaffold | `m0` | npm workspaces, strict TS, ESLint + Prettier, Vitest, Vite + React + Tailwind + Router | — |
| M1 domain core | `m1` | `packages/core`: dates, types, catalogue, connections engine, availability (items, cases, holds, calendars), conflicts and conflict records, lifecycle + permissions, shipping, vratka, cases/refill, service, issues, daily jobs, notifications. Pure functions, no I/O, "today" is always a parameter | 140 at tag; **147 now**, **97.0 % lines**, 85.7 % branches |
| M2 fixtures | `m2` | `packages/fixtures`: 8 users, 2 warehouses / 42 locations, 35 categories (9 top-level + 26 sub), 150 items, 12 case types, 32 cases (2 incomplete), 144 connections, 10 clients, 31 bookings in every state (built through the core API), 5 service cases (1 overdue). Scenarios `galaDinner`, `conflictChain`, `transfer`, `caseBreaking` | 17 |
| M3 prototype 1A | `m3` | App shell, dashboards (Chief, PM, warehouse), bookings list, new pre-booking, order editor (nested auto lines, OR choices, check warnings, recommendations, badges, conflict panel, acknowledgement, override, external rental, missing/substituted, warehouse split, price total, thread), notification centre | 6 acceptance |
| M4 prototype 1B | `m4` | Item page with month calendar (free / total, warehouse filter, soft holds striped, service bar, click a day → who holds it), case-type calendar, event calendar (bars by state, PM/state filters), fault reporting (optionally inside a specific case) | 6 acceptance |
| M5a catalogue editor | `m5a` | Core catalogue edit actions; table with inline editing and validation, completeness + "potřebuje doplnit", bulk edit, card view, connection builder with "used by", "Vyzkoušet", Excel template / import with row-level errors / export, photo upload (data URL), case contents, archive instead of delete | 7 core + 5 acceptance |
| M5b packing | `m5b` | Phone layout: per warehouse, grouped by shelf, cases with contents, case-number picking, "taken from case", batches with labels, high-priority banner for lines added after shipping | 2 acceptance |
| M5c vratka | `m5c` | Phone layout: stepper from 0, per-line confirmation, location, condition, damaged count, note rules, case cards with "Kompletní dle standardu", into-case suggestion, partial transfer to another order, returned to supplier, unexpected items, multiple sessions, result screen | 2 acceptance |
| M5d service & cases | `m5d` | Service list/detail with status flow, responsible person, expected date, overdue badge, history; warehouse dashboard with packing, returns, gear to check, service, incomplete cases with "Doplnit case" and age | 2 acceptance |
| M6 wrap-up | `batch-1` | Playwright smoke tests, this report | 2 E2E |

Totals: **187 automated tests** (147 core, 17 fixtures, 23 UI acceptance) and 2 browser smoke tests. All four quality-gate commands pass.

Every rule in the plan's "Required tests" list has a test named after it (`packages/core/test/*.test.ts`). `scenarios.test.ts` runs the concept's Gala Dinner end to end through the public API, and the fixtures test replays it on the full dataset.

## Decisions (from DECISIONS.md)

**⚠ marks a deviation from, or an extension of, the concept.** The full list with reasons is in `DECISIONS.md`.

- ⚠ **When an OR choice counts as "open".** The engine preselects the first option that is free for the whole period. A group is "open", and so blocks confirmation, only when no option is free and nobody has chosen. A person's choice always wins.
- ⚠ **Priority between confirmed orders.** When two confirmed orders collide, the one confirmed later carries the conflict. Each confirmed order is checked only against orders confirmed before it, which gives one conflict record per collision instead of two.
- ⚠ **Conflicts that appear later** (a service case is opened, an order is edited) create a `detected` conflict record (*Nový*) on the affected confirmed order. The Chief and the PMs are notified, and the record resolves automatically once the line is covered again.
- **Default source warehouse.** A line without a source is served from the booking's default warehouse if that warehouse stocks it, otherwise from the other one. Splitting a line across warehouses is a single button in the conflict panel.
- ⚠ **External rental of a case.** Covering a short case type externally creates an external line for the case's primary item × pieces per case, e.g. "8× Astera AX9". This matches the concept's Gala scenario; the accessories are assumed to come with the rented gear.
- **Missing and Substituted lines** do not hold stock, are not packed and do not block confirmation.
- ⚠ **Missing pieces in vratka** become an issue as soon as a confirmed line is short. The issue holds stock with no end date until the Chief resolves it. Later sessions that return the pieces archive the issue automatically.
- ⚠ **Returned vs. closed.** A booking with every line settled becomes `returned` (stock free again). `close` is a separate action that makes it read-only.
- **Case returns** are confirmed one case at a time. A whole case that doesn't come back is a missing issue that holds the case and its contents. Transfers between events are for loose items only in Batch 1.
- **Damaged pieces.** Loose damaged pieces are not put back into a case, so the case stays incomplete and a refill task appears. A damaged piece counted inside a returned case stays in the case, and the service case is linked to it.
- **Transfer windows.** On B, a line coming from A is held from the day after A ends (or from the actual handover day). There is no gap and no double count.
- ⚠ **Price total** = day price × **event days** (not the booked days with buffers). A case type is priced as the sum of its contents.
- **Incomplete-case reminders** are paused while the case, or pieces taken from it, are out on an active order. The clock restarts on the vratka day.
- **Lines added after shipping** can be added by the Chief only.
- **Fixtures are built through the core API** with past dates, so every shipment, return and conflict record obeys the rules.
- ⚠ **`caseBreaking` uses an incomplete case.** With only complete cases, the plan's `broken` formula can never make `caseFree` negative for a line that is green at item level. The amber "rozbije case" warning therefore needs an incomplete case (or pieces in service) to appear.
- **Catalogue editing actions live in core** (`catalog/edit.ts`) so Batch 2 can reuse them on the server. Imports apply the valid rows and report the invalid ones by row and column.
- Notifications and thread events are stored as `type` + parameters and rendered in Czech from `apps/proto/src/i18n/cs.ts`, which holds every UI string.

## Demo script for the checkpoint (≈ 20 min)

Prepare: `npm run dev`, open the app, click **Obnovit demo data**, scenario **Gala Dinner (modelový scénář)**, simulated today **20. 4. 2027**.

**1. Gala Dinner as Petr Dvořák (PM), 6 min**
1. *Přihlášen jako* → Petr. The dashboard shows his bookings. Click **Nová předrezervace**: name "Gala Dinner", event 24. 4. 2027, client Hotel Grand. Point out the default buffer of 23.–25. 4.
2. Search "AX9 case", set quantity 2 and add it. Add "dLive S5000" and "Stagebox case".
3. Show the desk power cable, CAT cable and router appearing nested under the desk, tagged *auto* with "pro: … ×1". Show the *Máš aspoň jeden z těchto?* panel for PowerCON cables (one-click add) and *Mohlo by se hodit*.
4. The AX9 case line is red, **Chybí 1 case**. The conflict panel names *Firemní den — Jana Nováková, 23.–25. 4.* **Odeslat ke schválení** is disabled. Tick "Viděl(a) jsem konflikt" and submit.

**2. Validation as Tomáš Král (Chief), 4 min**
5. Switch to Tomáš. The dashboard shows Gala Dinner in *Čeká na schválení*. Open it, use **Pokrýt externím pronájmem** with 1 case and supplier "Astera Rent CZ". An external line "8× Astera AX9 PowerPAR" appears and the conflict is gone. **Potvrdit objednávku**.
6. Optional: change LEDBeam quantities on another order and watch the accessories recalculate. Raise a cable count by hand and show that it stays marked *ručně upraveno*.

**3. Warehouse as Martin Svoboda, 5 min**
7. Switch to Martin. The warehouse dashboard lists the Gala under packing; open **Balit**. Show the list grouped by shelf, the AX9 case as one line with its contents, and picking case number AX9-02. Ship batch "Dodávka 1" with the cases, then "Dodávka 2" with the rest. Petr gets a notification after each batch.
8. Open **Vratka**. Counts start at 0. Use **Kompletní dle standardu** on each case, return the external AX9 to the supplier, and leave the desk power cable at 0 with the note "Zůstal v sále". Submit: the result shows the missing cable and the status *Vráceno s problémy*. Tomáš sees it in *Nevyřešené problémy* and resolves it with a note.
9. On the item page for Astera AX9, use **Nahlásit závadu** for 1 piece, *V casu* AX9-02. That case is no longer complete, so *Květnový festival* (May, both Brod AX9 cases) turns short; its PM Jana is notified and the Chief sees a new conflict. On **Servis**, Karel moves the case to *Opraveno*; the conflict resolves itself.

**4. Conflict chain, 3 min**
10. Scenario **Řetěz konfliktů**, user Tomáš. Open the *Robe LEDBeam 150* item page, June, filter **Brod**. Show 6 / 16, then −2 / 16 on 9.–10. 6., and striped days for the soft pre-booking. Click 10. 6.: all three bookings with PM, dates and state.
11. Switch to Jana and open *Firemní párty Horizont*. She can confirm her own booking but must write an override reason. Afterwards the Chief dashboard shows the conflict as **Nový**, and Petr has a notification.

**5. Case breaking and calendars, 2 min**
12. Scenario **Rozdělení obsahu casu (AX1)**, user Lucie. Open *Křest alba*: 6 loose AX1 show the amber **Rozdělí obsah casu** warning, naming *Výstava designu*. Lucie has no Confirm button.
13. Open **Kalendář** (event bars by state, PM filter) and a case-type calendar (complete cases free per day).

## Gamifikace (branch `feature/gamification`, not merged)

Plan: `docs/gamification-plan.md` · decisions: `DECISIONS.md` (entries "Gamification …") · tags `g0`–`g7`.

A quiet layer of points, levels and badges over the catalogue. It only **reads** what the system already records. No existing screen, action or rule changed, and points are never stored: `computeLedger(state)` derives them, and every point can be traced to a record. It stays on its branch until the Chief, the PMs and the warehouse have tried it and agree.

| Milestone | Tag | What | Tests |
| --- | --- | --- | --- |
| G0 audit | `g0` | every rule checked against code and screens; mandatory fields are base work, bonuses only for what is voluntary | — |
| G1 ledger | `g1` | 41 rules (packing, shipping, vratka, reports, service, PMs, Chief, communication, loans); base points from booking-thread events, which survive cancelling | 72 |
| G2 levels, badges | `g2` | level curve set from the measured pace (level 10 in ~3.5 months, level 20 in ~1 year at the demo's ~150 XP a month), titles Junior … Legenda, 18 badges, activity summary | 22 |
| G3 calibration | `g3` | `npm run xp-report`; roles within ±25 % of each other, communication one weekly budget (4 b.), guarded by a test and a snapshot | 3 |
| G4 meter | `g4` | title and bar beside the bell; new points appear only there, once, with the reason | 6 UI |
| G5 profile | `g5` | badges, activity in words, "Proč mám body", one-page overview for management (print / PDF), "Jak se počítají body" | 8 UI |
| G6 team | `g6` | Tým sorted by name with no ranking; colleagues see levels and badges, the Chief sees the work; off switch | 8 UI |
| G7 acceptance | `g7` | 2 browser tests (careful vratka → points → profile; Chief's Tým) and this section | 2 E2E |

Totals for the branch: **119 automated tests** (89 core, 8 fixtures, 22 UI) and 2 browser tests, on top of the existing suite. The quality gate passes.

### Demo script (≈ 10 min)

1. **Scénář → Transfer, Přihlášen jako → Martin (Sklad).** Point at the header: his title (a work grade such as "Senior III") with a thin bar beside the bell. That's all there is on the screen.
2. Open the vratka of **TechConf 2027**. On the LEDBeam line enter 2 pieces, mark **Poškozeno**, 1 damaged, and write a real note ("Jeden kus nejde tilt, prasklý kryt motoru"). Confirm the line and save. Under the meter: **"+N · Vratka – TechConf 2027 (pečlivě)"**. Nothing pops up over the work; the line fades after a few seconds and **+N** stays on the meter.
3. Click the meter → **profile**. The newest row is marked *nové* and lists **Popsané poškození** as a bonus: a description that helps service earns more than the one-word note the system requires. Show the badges (earned with dates, others in progress), the activity in words (e.g. "11 vratek, z toho 11 včas …"), and **Proč mám body**, where every point has a reason.
4. **Přehled pro vedení:** pick a period → *Tisk / uložit PDF*. One page an employee can bring to a review. It ends with "Body ukazují práci zaznamenanou v systému, ne veškerou práci."
5. Open **Jak se počítají body**: every rule with its points, generated from the same table the system counts with.
6. **Přihlášen jako → Tomáš (Šéf techniky) → Tým.** One card per person, by name, with points and work over the last three months. **There's no ranking** (say why: it should feel like recognition, not competition). *Celý profil* opens an employee's profile and overview.
7. **Přihlášen jako → Petr (PM) → Tým.** Colleagues see only levels and badges. On *Můj profil*, **Zobrazovat úrovně a body** switches it all off for people who don't want it; points keep counting, and the Chief still sees them.

### Questions for the team

- Are the titles right (Junior, Medior, Senior, Specialista, Expert, Garant, Pilíř týmu, Legenda)?
- Should colleagues see each other's levels and badges at all, or only the Chief?
- Are the weights fair for your role? (`npm run xp-report` shows them on the demo; the real team's pace will set the level curve after launch.)
- When the real system starts, should everyone start at zero (`countFrom`) or count the history entered so far?

## Questions for the Chief and PMs

1. **OR choices**: is it fine that the system picks the first free option (clamp before floor stand), or must the Chief confirm every choice?
2. **Who wins a collision**: should the earlier-confirmed order always keep the gear and the later one carry the conflict?
3. **External rental of a whole case**: do we rent the lights only, or the whole case with chargers? Should the external line be the case or the pieces?
4. **Price total**: per event day as now, per booked day, or with a multi-day discount?
5. **Missing pieces**: should an unresolved missing issue keep blocking stock indefinitely, or should it be written off automatically after N days?
6. **Closing**: who closes a returned order, the warehouse or only the Chief?
7. **Damaged piece inside a case**: does it stay in the case (case incomplete until repaired) or is it always pulled out?
8. **Incomplete cases**: may the warehouse ship an incomplete case with a note, or must it always be refilled first?
9. **Lighting desk choice**: today each fixture type picks its own desk option. Should the desk be chosen once per order?
10. **Lines added after shipping**: Chief only, or may the PM add them too?
11. **Default warehouse**: per booking (as now), per PM or per client?
12. Still open from the concept: who enters the initial catalogue, and which categories go first?

## What Batch 2 (Supabase locally) needs from the core API

- **State slices instead of the whole state.** Core actions take and return a full `AppState`. On the server we need a loader that builds a partial state for one action: the booking, overlapping bookings for the affected items and case types, stock, cases, open service cases and open issues. The core functions stay as they are.
- **Reservations table.** `bookingHolds()` defines exactly what each booking holds (resource, warehouse, quantity, date range, hard or soft, loose or in-case, open missing issues). Batch 2 should write these rows into `reservations` on every state change. The confirm RPC then locks the item rows and re-checks `free = total − outOfService − hardHeld` per day in SQL, mirroring `itemDay` / `caseDay` and the `confirmSeq` priority rule.
- **Same code in browser and server.** `expand`, `recalcBooking`, `evaluateBooking`, `detectConflicts` and the lifecycle guards are pure. They run in the browser for instant badges and in an Edge Function for the authoritative result.
- **IDs and time.** Replace the `counters` with UUIDs. "Today" comes from the server clock in Europe/Prague.
- **Permissions** (`can()` and the role presets) must be mirrored in RLS policies and in the RPCs. Typed `DomainError` codes map to HTTP errors.
- **Nightly job.** `runDailyJobs(state, today)` is idempotent through `jobLog`; under pg_cron, `jobLog` becomes a table keyed by reminder key.
- **Notifications and thread events** are already plain rows (`type`, `params`), ready for the `notifications` and `messages` tables. The audit log comes from database triggers.
- **Catalogue edit and import** (`catalog/edit.ts`) become RPCs. The browser keeps parsing Excel with SheetJS.

Batch 2 has not been started.
