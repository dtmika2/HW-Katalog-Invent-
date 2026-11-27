# Dev plan — Gamification: experience, levels and badges

Nov 27, 2026 · for Claude Code · source of truth: `docs/concept.md` · working rules: `CLAUDE.md`

## Why

A system like this works only if people use it, and use it properly. If entering a vratka carefully
or writing a note on a reservation gives nothing back, people stop doing it, and however good the
system is, it stops working.

Gamification gives that something back, quietly:

1. **Incentive.** Careful, complete work in the system is acknowledged right away and adds up to
   levels, titles and badges that people can be a little proud of.
2. **Proof of work.** Each employee gets a record of what they did in the system, over any period.
   They can show it to management, and the Chief can see the team's activity at a glance. People
   should like it because it works for them; it is not a surveillance tool.

## Principles (non-negotiable)

1. **The catalogue does not change.** No existing screen, action, rule, state field or
   notification is changed for gamification. It only *reads* records the system already keeps.
   If an action leaves no record of who did it and when, it does not earn points (see
   "Not counted").
2. **Derived, never stored.** Points are computed by a pure function from `AppState`:
   `computeLedger(state) → LedgerEntry[]`. There is no stored score, so it cannot drift, cannot be
   edited, and anyone can see why each point was given. If a record is undone (*Vybalit*,
   *Zrušit odvoz*), the points go with it.
3. **Passive and out of the way.** No overlays, toasts, confetti, sounds or pop-ups on the screen
   being worked on. Everything lives in one dedicated place: a small XP meter in the header, plus
   the profile page. New points show up next to the meter, with the reason.
4. **Formal and subtle.** The tone stays professional: titles are work grades, badges are small
   monochrome marks in the app's palette, and the text is short and plain.
5. **Never negative.** Points are only ever added. Quality is rewarded with bonuses; nothing is
   punished, and no entry is ever shown as a penalty.
6. **Never reward harm to the process.** No points for overriding conflicts, for cancelling, for
   editing for the sake of it, or for volume alone. Text earns points only above a minimum length
   and within daily caps.
7. **Honest about its limits.** The profile says plainly that points show *recorded work in the
   system*, not all work (carrying a 60 kg case leaves no record). Management should read it as
   one signal, not the whole picture.

## Scope guardrails (on top of `CLAUDE.md`)

- Everything new lives in `packages/core/src/gamification/` (pure) and new app files: an
  `XpMeter` component, profile and team routes, a store hook, and a `cs.gamification` section.
  The only edits to existing files are: export from `core/src/index.ts`, mount `XpMeter` in
  `Layout.tsx`, add routes and nav links, add i18n strings.
- **No new fields in `AppState`.** Gamification preferences (on/off, "seen up to") live in their
  own `localStorage` key (`quix-gamification`), apart from the prototype state. *Obnovit demo
  data* clears it too.
- No module outside `gamification/` may import from it (enforced with ESLint
  `no-restricted-imports`), so the catalogue can never come to depend on it.
- **Branch:** all work happens on `feature/gamification`, never on `main`. It is merged only after
  the team (Chief, PMs, warehouse) has tried it and agreed. Until then, `main` stays deployable
  without it. Merge `main` into the branch now and then, so it does not fall behind; never rebase
  (history is not rewritten).
- Commits: `G<milestone>.<task>: <summary>`. Tag finished milestones `g1`, `g2`, … on the branch.

---

## What earns points

Points are attributed to the person on the record (`userId`, `by`, `reportedBy`, `resolvedBy`,
`authorId` …). If a record has no person field, the matching booking-thread event (`Message.event`,
`authorId`) is used. Events by `SYSTEM_USER_ID` never earn points.

Each base entry can carry **quality bonuses**: separate ledger lines linked to it, each with its own
short reason, so the profile can say *why* something was worth more.

Values below are the **starting table**. Milestone G3 calibrates them against the demo data. The
table is data (`rules.ts`), not code spread across functions.

### Warehouse: packing and shipping

| Rule id | Source record | Base | Quality bonuses |
| --- | --- | --- | --- |
| `pack.record` | `PackingRecord` (userId, on) | 5 + 1 per packed line (max +20) | — |
| `pack.caseChecked` | each `CaseCheck` with a count for every standard line | 2 per case | +3 when the case was refilled from loose stock (`refilled`) instead of leaving short |
| `pack.onTime` | order fully packed before the first booked day | 5 per order | — |
| `ship.delivery` | `Shipment` (not a transfer) | 10 | +1 per promised line confirmed (`deferred`), max +5 |
| `ship.transfer` | `Shipment` with `transferFromBookingId` | 8 | — |
| `cancel.unpackConfirmed` | warehouse's one-by-one confirmation in a `CancelRequest` / cancel unpack | 5 | — |

### Warehouse: vratka ("the more careful, the more points")

| Rule id | Source record | Base | Quality bonuses |
| --- | --- | --- | --- |
| `vratka.session` | `ReturnSession` (userId, on) | 10 + 1 per line (max +25) | see below |
| `vratka.caseCounted` | `ReturnLine.caseContents` counted per content line | — | +2 per case |
| `vratka.damageDescribed` | line with `condition ≠ ok` **and** a `note` of ≥ 10 characters | — | +3 per line |
| `vratka.unexpectedRecorded` | `UnexpectedItem` with a note | — | +3 each |
| `vratka.onTime` | session on or before `bookedUntil` + `bufferAfterDays` | — | +5 per session |
| `vratka.closed` | the session that brought the booking to *Uzavřená* | — | +10 |

Note: the return shelf is **pre-filled** (`suggestedLocationId`), so "a location is filled in" is
not a sign of care and earns nothing. Every quality bonus must come from something the person had
to write or count. Milestone G0 checks each bonus against the screen.

### Reporting problems (everyone)

| Rule id | Source record | Base | Quality bonuses |
| --- | --- | --- | --- |
| `report.service` | `ServiceCase` opened (first event's userId) | 8 | +5 to the reporter when it ends *Opraveno* or *Odepsáno* ("the report was right") |
| `report.issue` | `Issue` reported (missing, case incomplete) — not ones created automatically by vratka | 4 | — |
| `service.progress` | `ServiceEvent` by the responsible person | 3 (max 5 per case) | — |
| `service.fixed` | status *Opraveno* | 10 | +5 when on or before `expectedBack` |
| `issue.resolved` | `Issue.resolvedBy` with a written `resolution` | 6 | — |

### Project managers: bookings

| Rule id | Source record | Base | Quality bonuses |
| --- | --- | --- | --- |
| `booking.reservation` | booking created as a date reservation (`created` event) | 3 | — |
| `booking.submitted` | `submittedAt` | 10 | +10 when ≥ 14 days before the event, +15 when ≥ 30 days; +3 for a purpose message of ≥ 40 characters; +2 when a client is set |
| `booking.firstTime` | approved without `returnedToPm` | — | +5 ("approved the first time") |
| `booking.organised` | at least one PM group (`groups`) on an approved order | — | +3 |
| `booking.shortageSolved` | `shortage_solved` event / rental or other-warehouse line solving a conflict | 8 | — |
| `booking.completed` | the PM's booking reaches *Uzavřená* | 10 | — |

### Chief: decisions

| Rule id | Source record | Base | Quality bonuses |
| --- | --- | --- | --- |
| `chief.approved` | `confirmedBy` / `confirmedOn` — **not** a PM approving their own order | 10 | +5 within 2 days of `submittedAt` |
| `chief.returned` | `returnedToPm` with a reason | 5 | — |
| `chief.conflictResolved` | `ConflictRecord.resolvedBy` with a written `resolution` | 10 | — |
| `chief.overrideDecided` | `acceptedBy` on a proposed override | 4 | — |
| `chief.cancelDecided` | approve / decline of a `CancelRequest` | 5 | — |
| `client.created` | `Client.createdBy` / `createdOn` | 3 | — |

### Communication (everyone)

| Rule id | Source record | Base | Limits |
| --- | --- | --- | --- |
| `talk.message` | `Message` with `text` ≥ 15 characters | 2 | at most 3 per booking per day and 10 per day |
| `talk.reply` | a message within 1 day of another person's message in the same thread | +1 | same caps |
| `talk.note` | `Attachment` with `text` ≥ 15 characters | 3 | at most 5 per day |
| `talk.file` | `Attachment` with a file (photo, document) | 4 | at most 5 per day |

### Loans

| Rule id | Source record | Base | Quality bonuses |
| --- | --- | --- | --- |
| `loan.recorded` | `Loan.recordedBy` with an `until` date | 2 | — |
| `loan.returnedOnTime` | `returnedOn ≤ until`, to the borrower | 3 | — |
| `loan.returnedFor` | `returnedBy` ≠ borrower | 2 | — |

### Not counted (and why)

- **Catalogue editing** (items, connections, cases, categories): the system keeps no record of who
  edited what and when. Adding one would change the catalogue, so it is left out. It goes on the
  list for the backend phase, when an audit log arrives with Supabase.
- **Conflict overrides and acknowledgements**: rewarding them would encourage going over conflicts.
- **Cancellations, edits, unpacking on one's own initiative**: they are part of the work, but
  rewarding them rewards churn.
- **Logging in, page views, time in the app**: they are not work.
- **Streaks**: people have days off and holidays, and a broken streak feels like a punishment.

---

## Levels and titles

**Curve.** Total XP needed for level *L*: `xpFor(L) = round10(15 · (L − 1)^2.4)`.

| Level | Total XP | Roughly, for an active warehouse employee (~1 500 XP/month, to be confirmed in G3) |
| --- | --- | --- |
| 2 | 20 | first packing |
| 5 | 420 | first ~2 weeks |
| 10 | 2 930 | ~2 months |
| 15 | 8 450 | ~6 months |
| 20 | 17 580 | ~1 year |
| 30 | 48 510 | ~3 years |
| 40 | 98 770 | ~5 years |

Fast early levels make it feel alive; later levels slow down so they stay worth something.
There is no cap.

**Titles** are work grades. Czech words that are gender-neutral in workplace use, so they need no
gender field:

| Levels | Title (`cs.gamification.titles`) |
| --- | --- |
| 1–4 | Junior |
| 5–9 | Medior |
| 10–14 | Senior |
| 15–19 | Specialista |
| 20–24 | Expert |
| 25–29 | Garant |
| 30–39 | Pilíř týmu |
| 40+ | Legenda |

Shown as *"Senior II · Sklad"*: title, the step within its tier as a Roman numeral, and the role.
Each new tier is the "something to be proud of" moment: it shows once next to the meter and is
dated on the profile.

## Badges

Badges are earned from the ledger and state, never awarded by hand. Most have three steps:
**bronze / silver / gold**. They are small monochrome line icons; the step shows only as the
outline's tone. Locked badges show their progress ("34 / 50"), so it is clear what comes next.

| Badge (`cs`) | For | Steps |
| --- | --- | --- |
| První krok | first packing, first vratka, first pre-booking, first report (one each, one-off) | — |
| Pečlivá vratka | vratky with every quality bonus that applied to them | 10 / 50 / 200 |
| Kompletní casy | cases checked line by line at packing | 25 / 150 / 500 |
| Plný case | cases refilled instead of leaving short | 5 / 25 / 100 |
| S předstihem | pre-bookings submitted ≥ 14 days ahead | 5 / 25 / 100 |
| Napoprvé | pre-bookings approved without being returned | 5 / 25 / 100 |
| Bystré oko | reports confirmed by service (*Opraveno* / *Odepsáno*) | 3 / 15 / 50 |
| Dílna | service cases brought to *Opraveno* as the responsible person | 5 / 25 / 100 |
| Řešitel | conflicts and shortages solved with a written resolution | 5 / 25 / 100 |
| Kronika | bookings with a note, a file or a message of one's own | 10 / 50 / 200 |
| Most mezi akcemi | event-to-event transfers | 3 / 15 / 50 |
| Vráceno včas | loans returned on time | 5 / 25 / 100 |
| Velká akce | a vratka of a booking with ≥ 100 lines, closed in one session | one-off |
| Obě skladiště | packed or received gear in both Brod and Karlák | one-off |

Badge definitions are data (`badges.ts`: id, steps, a predicate over the ledger), so new ones can be
added without touching the UI.

---

## Where it shows (UI)

### XP meter (header, next to the bell)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ QUIX HW   Rezervace  Kalendář  Katalog …       Senior II  ▰▰▰▰▰▱▱▱  🔔  │
│                                       +18 · Vratka Gala Dinner (pečlivě) │
└──────────────────────────────────────────────────────────────────────────┘
```

- Title, a thin progress bar to the next level, and the XP numbers in its `title` tooltip. A click
  opens the profile.
- **New points appear only here**, in a line under the bar: `+18 · Vratka Gala Dinner (pečlivě)`.
  Several at once combine: `+32 · 3 záznamy`. The line fades after ~8 s and leaves a small
  "+N dnes" label until the profile is opened. It sits in the normal page flow, never over
  content, and uses `aria-live="polite"`. With `prefers-reduced-motion` it does not fade.
- A level-up or a new badge shows the same way (`Nová úroveň: Senior III`,
  `Nový odznak: Kompletní casy – stříbro`), plus a small dot on the meter until the profile is
  opened.
- On phones (packing and vratka screens) the meter shrinks to the title and a thin bar, and the
  points line wraps under the header. It never takes room from the work area.

**How "new" is known.** Ledger entries have stable ids built from their source record
(`vratka.session:ret-12`, `vratka.caseCounted:ret-12:case-7`). The hook compares the current
ledger with the ids already seen by this user, stored in `quix-gamification`. The first time a user
is shown (or after switching user in the prototype), everything is marked as seen, so the whole
history is never announced as new.

### Profile (`/profil`, `/profil/:userId`)

- **Header:** name, role, title, level, bar, total XP, XP this month.
- **Badges:** a grid of earned badges (with the date) and locked ones (with progress).
- **Activity:** this month and earlier months by category (*Balení, Odvozy, Vratky, Hlášení,
  Servis, Rezervace, Schvalování, Komunikace, Výpůjčky*). Both **counts** ("12 vratek") and
  points: counts are what management understands.
- **History ("Proč mám body"):** ledger entries newest first, each with its reason, quality
  bonuses indented under it, and a link to the booking, case or service case. Entries new since
  the last visit are marked.
- **Přehled pro vedení:** pick a period, then print / save as PDF with the existing print approach
  (as on packing lists). One page: counts per category, notable bonuses, badges earned in the
  period. This is the "proof of work" document an employee can bring to a review.
- Footnote: *Body ukazují práci zaznamenanou v systému, ne veškerou práci.*

### Team (`/tym`, Chief and Admin)

- One card per person: title, level, XP this month and the last 3 months, counts per category,
  badges. Sorted **by name**, with **no ranking numbers and no leaderboard**. The goal is to make
  work visible, not to make colleagues compete.
- Each card links to the full profile.

### Visibility

| What | Self | Colleagues | Chief / Admin |
| --- | --- | --- | --- |
| Level, title, badges | ✓ | ✓ | ✓ |
| Activity counts, history, PDF | ✓ | — | ✓ |

### Jak se počítají body

The *Vysvětlivky* window gets a tab (or the profile a section) generated from `rules.ts`: every
rule, its points, its bonuses and its limits. Transparency is what keeps it fair and liked. Like
the stage texts, it is a `Record<RuleId, …>`, so a rule cannot exist without an explanation.

---

## Core design

```
packages/core/src/gamification/
    types.ts      RuleId, LedgerEntry, LevelInfo, BadgeDef, BadgeProgress, ActivityCategory
    rules.ts      the points table as data: base, bonuses, caps, category, per-rule source
    ledger.ts     computeLedger(state): LedgerEntry[]  — sorted by date, then id
    sources/      one small extractor per area: packing.ts, shipping.ts, vratka.ts,
                  reports.ts, bookings.ts, chief.ts, talk.ts, loans.ts
    caps.ts       daily and per-booking caps applied after extraction (deterministic order)
    levels.ts     xpFor(level), levelFor(xp): { level, tier, step, xpIntoLevel, xpToNext }
    badges.ts     BADGES (data) + badgeProgress(ledger, state, userId)
    summary.ts    userSummary(ledger, userId, from, to): counts and XP per category, per month
    index.ts
packages/core/test/gamification/   one file per source + levels, badges, caps, summary
```

```ts
interface LedgerEntry {
  id: string;            // stable, built from the source record
  userId: Id;
  on: IsoDate;
  ruleId: RuleId;
  points: number;        // always > 0
  category: ActivityCategory;
  parentId?: string;     // quality bonus → its base entry
  bookingId?: Id;
  params: Params;        // for the Czech text: event name, counts, …
}
```

- Pure, deterministic, no `Date.now()`: the dates come from the records. "This month" is computed
  from `today`, passed in as everywhere else.
- O(records). In the app it is memoised on the state object (`useLedger()`), so it runs once per
  state change. With the backend this becomes a view or a nightly materialisation; the function
  stays the definition.
- **Start date (for production):** an optional `countFrom: IsoDate` argument, so a real launch can
  start everybody at zero while the demo counts the whole fixture history.

---

## Milestones

### G0: Audit and decisions

1. For every rule in the tables above, confirm in code that the source record exists and carries
   the person and date as assumed. Mark any rule that does not hold as dropped, with the reason.
2. **Quality-signal audit:** for every bonus, confirm on the screen that the person has to type,
   count or choose it, not that it is pre-filled or automatic. Example: the vratka shelf is
   pre-filled, so it is excluded. Issues created automatically by vratka or packing are not
   counted as reports.
3. Write the decisions in `DECISIONS.md`: derived ledger, no penalties, no leaderboard, neutral
   titles, separate `localStorage` key, catalogue editing not counted.

### G1: Ledger in core

1. Types, `rules.ts`, and `computeLedger` with the **warehouse** sources (packing, shipping,
   vratka with bonuses).
2. **Reports and service** sources.
3. **PM and Chief** sources (including "not for approving one's own order").
4. **Communication and loans** sources, plus `caps.ts`.
5. Tests: one per rule, named after it (`vratka.damageDescribed gives +3 per damaged line with a
   note`). Plus: entries never have points ≤ 0; ids are unique and stable across two runs;
   `SYSTEM_USER_ID` earns nothing; undoing a packing removes its entries; **every existing core
   action returns exactly the same state as before** (gamification adds exports only); an ESLint
   rule stops imports of `gamification/` from outside.

### G2: Levels, titles, badges

1. `levels.ts` with the curve and tiers; tests at the boundaries (level 4 → 5 changes the tier).
2. `badges.ts` with the catalogue above and progress; tests for each badge and step.
3. `summary.ts`: per-month and per-category counts and XP; tests.

### G3: Calibration on demo data

1. `scripts/xp-report.ts` (run with `node`): ledger over every fixture scenario. It prints XP per
   user, per role, per month, and the top 10 rules by share of XP.
2. Tune `rules.ts` so that:
   - a month of typical work gives each role a similar XP (within ±25 %), so roles are equally
     rewarded;
   - no single rule gives more than ~30 % of a person's XP;
   - communication stays below ~15 %, so it supports the work without replacing it.
3. A snapshot test of the per-role totals, so a later rule change that skews the balance is
   visible in review. Record the final weights and the reasons in `DECISIONS.md`.

### G4: XP meter and points line

1. `useLedger()`, `useXpFeed()` (the seen-ids diff, the `quix-gamification` key, reset with
   *Obnovit demo data*).
2. The `XpMeter` component in `Layout.tsx` next to the bell, desktop and phone layouts; the
   points line, level-up and badge messages; reduced motion; `aria-live`.
3. Component tests: an action that creates a vratka shows `+N · …` next to the meter and nowhere
   else; switching user does not announce old history.

### G5: Profile

1. The `/profil` route: header, badges grid, activity by month and category, history with links.
2. *Přehled pro vedení*: period picker and a print / save-as-PDF page.
3. A *Jak se počítají body* section generated from `rules.ts`.
4. Tests: history explains every point; the PDF lists the right period.

### G6: Team and visibility

1. The `/tym` route for Chief and Admin: cards sorted by name, no ranking.
2. Colleague profile view: level, title and badges only.
3. Preference in `quix-gamification`: *Zobrazovat úrovně a body*. Off hides the meter for that
   user (the ledger still exists, so turning it back on loses nothing).

### G7: Acceptance and report

1. Playwright: sign in as Sklad → do a vratka with a damaged line and a note → see `+N` with
   "pečlivě" next to the meter → open the profile → the entry and its bonus are in the history.
   As the Chief: open *Tým*.
2. Add a "Gamifikace" section to `REPORT.md` with a demo script for the Chief and a PM.

---

## Acceptance criteria

- No existing core test changes, and no existing screen behaves differently. The diff to existing
  files is limited to: index export, `Layout.tsx` mount, routes and nav, `cs.ts`.
- Every point on a profile can be traced to a record by a link and a reason.
- Nothing about points appears anywhere except the header meter, the profile, the team page and
  the explanation window.
- With demo data, every user has a sensible level, at least one badge and a history on the first
  load.
- All UI strings are in `cs.gamification`, and the gate is green.

## Decided by default (change before G1 if you disagree)

- **No leaderboard.** The team page is alphabetical. A ranking turns acknowledgement into
  competition and is the fastest way to make people dislike it.
- **Colleagues see level, title and badges**, not the detail. The detail is for the person and
  management.
- **Retroactive in the demo**, `countFrom` for a real launch.
- **Undo removes points**, shown neutrally (the entry just is not in the history any more), never
  as a minus.
- **Only individuals are scored.** Team totals ("this month we did 48 vratek") could be a nice
  later addition to the warehouse dashboard, but they would change an existing screen, so they
  are left out.
