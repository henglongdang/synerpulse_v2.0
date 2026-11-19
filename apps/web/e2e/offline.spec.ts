import { expect, test } from '@playwright/test';
import { dialog, signIn } from './helpers';

test('entries added offline are kept apart, then sync once and only once', async ({ page, context }) => {
  await signIn(page);
  await page.goto('/ledger');
  // Warm the form's account and category lists while online.
  await page.getByRole('button', { name: 'Add entry' }).click();
  await expect(dialog(page).getByLabel('Account')).toBeEnabled();
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();

  await context.setOffline(true);
  await expect(page.getByText(/offline\. Showing the last loaded data/)).toBeVisible();
  await page.getByRole('button', { name: 'Add entry' }).click();
  await dialog(page).getByLabel('Amount').fill('12.34');
  await dialog(page).getByLabel('Description').fill('Farmers market (offline)');
  await dialog(page).getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByRole('heading', { name: 'Saved on this device' })).toBeVisible();
  await expect(page.getByText(/Waiting to sync/)).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText('1 offline entry synced')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Saved on this device' })).toHaveCount(0);
  await page.getByLabel('Search description, merchant or notes').fill('Farmers market');
  await expect(page.getByRole('row', { name: /Farmers market \(offline\)/ })).toHaveCount(1);
});
