# Decisions

Ambiguities resolved during implementation. Format: date — question → choice (why).

- 2026-11-16 — **npm scripts on a path with `&`.** The repository folder name contains `&`, which breaks npm's Windows `.cmd` shims (`npx`, `node_modules/.bin`). → All scripts call tool entry points directly (`node ../../node_modules/typescript/bin/tsc`, etc.). Works identically on Linux/macOS. (Renaming the folder would also fix it, but that is the user's call.)
- 2026-11-16 — **What does "build" mean for source-only packages?** `core` and `fixtures` are consumed as TypeScript source by Vite/Vitest. → `core` build emits `dist/` with declarations (useful for the Batch 2 server); `fixtures` build is a strict no-emit compile of `src`. (Keeps one tsconfig per package; no project-reference plumbing.)
- 2026-11-16 — **Router.** `HashRouter` in the prototype so the static build works from any folder or static host without rewrite rules.
