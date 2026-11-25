import { expect, test } from '@playwright/test';

test('Gala Dinner: Petr creates the pre-booking and sees the AX9 case conflict', async ({
  page,
}) => {
  await page.goto('/#/');
  await page.locator('#ctl-user').selectOption('u-petr');
  await page.getByRole('link', { name: 'Nová předrezervace' }).first().click();
  await page.getByLabel('Název akce').fill('Gala Dinner');
  await page.getByLabel('Akce od').fill('2027-04-24');
  await page.getByLabel('Akce do').fill('2027-04-24');
  await page.getByRole('button', { name: 'Vytvořit předrezervaci' }).click();
  await page.getByLabel('Počet').fill('2');
  await page.getByLabel('Hledat položku nebo case…').fill('AX9 case');
  await page.getByRole('option', { name: /AX9 case/ }).click();
  await expect(page.getByTestId('badge').first()).toHaveText('Chybí 1 case');
  await expect(page.getByTestId('conflict-panel')).toContainText('Firemní den — Jana Nováková');
  await expect(page.getByRole('button', { name: 'Potvrdit ke schválení' })).toBeDisabled();
});

test('conflictChain: LEDBeam calendar shows the over-booked days', async ({ page }) => {
  await page.goto('/#/');
  await page.locator('#ctl-scenario').selectOption('conflictChain');
  await page.goto('/#/items/ledbeam150?month=2027-06-01');
  await page.getByRole('button', { name: 'Brod', exact: true }).click();
  await expect(page.getByTestId('day-2027-06-10')).toContainText('-2 / 16');
  await page.getByTestId('day-2027-06-10').click();
  await expect(page.getByTestId('holder')).toHaveCount(3);
});
