import { defineConfig } from '@playwright/test';

// PW_CHROME: optional path to a local Chromium when Playwright's own browser is not installed.
const exe = process.env.PW_CHROME;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5181',
    launchOptions: exe ? { executablePath: exe } : {},
  },
  webServer: {
    command: 'node ../../node_modules/vite/bin/vite.js --port 5181 --strictPort',
    cwd: 'apps/proto',
    url: 'http://localhost:5181',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
