# QUIX HW — Claude Code instructions

Source of truth: `docs/concept.md` (the HW Catalogue concept). Current work plan: `docs/plan.md`
(Batch 1: domain core + fixtures + browser prototypes, no backend). Work milestone by milestone.

## Commands

All tool binaries are invoked as `node node_modules/<tool>/...` in npm scripts, because the
repository path contains `&`, which breaks npm's Windows `.cmd` shims. Do not use `npx` here.

- `npm run typecheck` · `npm test` · `npm run lint` · `npm run build` — the quality gate
- `npm run dev` — prototype app (Vite)
- `npm run coverage` — core coverage
- `npm run format` — Prettier write

## Working rules

**Autonomy**
- Never stop to ask the user. When something is ambiguous, pick the option most consistent with `docs/concept.md`, write it to `DECISIONS.md` (date, question, choice, why), and continue.
- If something is truly blocked (a tool cannot be installed, a test cannot be made to pass after three honest attempts), write it to `BLOCKERS.md` with what you tried, and move on to the next independent task. Come back to blockers at the end.
- Work milestone by milestone, in order. Within a milestone, tasks can be done in any order.

**Scope guardrails**
- No backend, no database server, no Supabase, no auth provider, no cloud service, no API keys, no paid packages. Everything runs locally with `npm`.
- All data is in memory in the browser, seeded from the fixtures package. `localStorage` may persist prototype state, with a visible "Obnovit demo data" (reset) button.
- Do not build features listed under "Later phases" in the concept, except where the plan says so.
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
