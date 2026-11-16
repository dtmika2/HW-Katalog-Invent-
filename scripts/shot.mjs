// Usage: node shot.mjs <outPrefix> <path> [user] [width]  — screenshots the running dev app.
import { chromium } from '@playwright/test';

const [, , out, path = '/', user = 'u-petr', width = '1400', scenario = ''] = process.argv;
// PW_CHROME: optional path to a local Chromium when the headless shell is not installed
const exe = process.env.PW_CHROME;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: Number(width), height: 1000 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5180/#/');
await page.waitForSelector('#ctl-user', { timeout: 30000 });
if (scenario) {
  await page.selectOption('#ctl-scenario', scenario);
  await page.waitForSelector('#ctl-user', { timeout: 30000 });
}
await page.selectOption('#ctl-user', user);
await page.goto(`http://localhost:5180/#${path}`);
await page.waitForTimeout(600);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('ok', out);
