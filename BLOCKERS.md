# Blockers

## Resolved / worked around

- **npm `.cmd` shims break on this folder path** (it contains `&`). `npx …` and `node_modules/.bin` fail on Windows.
  *Worked around:* all scripts call tool entry points with `node` (see DECISIONS.md). Renaming the folder to one without `&` would also fix it.
- **Playwright browser download did not finish.** `playwright install chromium` (Chromium 1148 for `@playwright/test` 1.49.1) stalled for over an hour and was stopped.
  *Worked around:* `playwright.config.ts` and `scripts/shot.mjs` accept `PW_CHROME`, a path to any local Chromium. The 2 E2E smoke tests pass with the Chromium 1234 already on this machine:
  `PW_CHROME="%LOCALAPPDATA%\ms-playwright\chromium-1234\chrome-win64\chrome.exe" npm run e2e`.
  On a machine where `npx playwright install chromium` works, no variable is needed. E2E is not part of the quality gate.

## Open

None.
