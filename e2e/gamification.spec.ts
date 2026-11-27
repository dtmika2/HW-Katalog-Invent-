import { expect, test } from '@playwright/test';

test('Sklad: a careful vratka shows its points next to the meter, and the profile explains them', async ({
  page,
}) => {
  await page.goto('/#/');
  await page.locator('#ctl-scenario').selectOption('transfer');
  await page.locator('#ctl-user').selectOption('u-martin');
  await expect(page.getByTestId('xp-line')).toBeEmpty();

  await page.goto('/#/vratka/bk-techconf');
  const card = page
    .locator('[data-testid^="ret-"]')
    .filter({ hasText: 'Robe LEDBeam 150' })
    .first();
  await card.getByRole('spinbutton', { name: /Vráceno kusů/ }).fill('2');
  await card.getByText('Poškozeno').click();
  await card.getByLabel('Z toho poškozeno').fill('1');
  await card.getByLabel('Poznámka').fill('Jeden kus nejde tilt, prasklý kryt motoru');
  await card.getByRole('checkbox', { name: /Potvrzuji tento řádek/ }).check();
  await page.getByRole('button', { name: /Zapsat vratku \(1/ }).click();

  // the points appear next to the meter, with the reason, and the care is noticed
  await expect(page.getByTestId('xp-line')).toContainText(
    /\+\d+ · Vratka – TechConf 2027 \(pečlivě\)/,
  );
  await expect(page.getByTestId('xp-pending')).toBeVisible();

  // the profile explains them
  await page.getByTestId('xp').getByRole('link').click();
  const row = page.getByTestId('history-row').filter({ hasText: 'nové' }).first();
  await expect(row).toContainText('Vratka – TechConf 2027');
  await expect(row).toContainText('Popsané poškození');
  await expect(page.getByTestId('xp-pending')).toHaveCount(0);
});

test('Chief: the team page shows everyone by name, with the work of the last three months', async ({
  page,
}) => {
  await page.goto('/#/');
  await page.locator('#ctl-scenario').selectOption('base');
  await page.locator('#ctl-user').selectOption('u-tomas');
  await page.getByRole('link', { name: 'Tým', exact: true }).click();
  const cards = page.locator('[data-testid^="team-card-"]');
  await expect(cards.first()).toContainText('Jana Nováková');
  await expect(page.getByTestId('team-card-u-martin')).toContainText('Poslední tři měsíce');
  await expect(page.getByText(/nejde o pořadí/)).toBeVisible();
});
