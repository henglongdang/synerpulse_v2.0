import { expect, test } from '@playwright/test';
import { dialog, register, signIn, signOut, uniqueEmail } from './helpers';

/**
 * The core journey from the brief: register → set up the household → enter financial information →
 * the dashboard updates → navigate → refresh → sign out and back in → data persists.
 */
test('new household: onboarding, first entry, persistence across refresh and sign-in', async ({ page }) => {
  const email = uniqueEmail('owner');
  await register(page, 'Avery Stone', email);

  // Household
  await expect(page.getByRole('heading', { name: 'Name your household' })).toBeVisible();
  await page.getByLabel('Household name').fill('Stone family');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Accounts
  await expect(page.getByRole('heading', { name: 'Add the accounts you share' })).toBeVisible();
  await page.getByRole('button', { name: 'Add account' }).click();
  await dialog(page).getByLabel('Account name').fill('Joint checking');
  await dialog(page).getByLabel('Current balance').fill('2500');
  await dialog(page).getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByText('Joint checking', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  // Income (variable income with a conservative floor)
  await page.getByRole('button', { name: 'Add income' }).click();
  await dialog(page).getByLabel('Income source').fill('Design contracts');
  await dialog(page).getByLabel('Amount').fill('3000');
  await dialog(page).getByLabel('How often').selectOption('monthly');
  await dialog(page).getByLabel('This income varies').check();
  await dialog(page).getByLabel('In a slow period, at least').fill('1200');
  await dialog(page).getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Design contracts', { exact: true })).toBeVisible();
  await expect(page.getByText('$3,000', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  // Spend: pick categories and limits
  await page.getByRole('button', { name: 'Groceries' }).click();
  await page.getByRole('button', { name: 'Dining out' }).click();
  await page.getByRole('textbox', { name: 'Groceries' }).fill('600');
  await page.getByRole('textbox', { name: 'Dining out' }).fill('150');
  await expect(page.getByText('$750 of $3,000 income')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  // Goals (skip) → Confirm
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('heading', { name: /That.s your plan/ })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('heading', { name: 'Great! Your budget is all set.' })).toBeVisible();
  await page.getByRole('button', { name: 'Go to dashboard' }).click();

  // Dashboard reflects real data
  await expect(page.locator('.hero-figure').first()).toHaveText('$2,500.00');
  await expect(page.getByText('of $750')).toBeVisible();

  // Enter spending
  await page.getByRole('button', { name: 'Add entry' }).click();
  await dialog(page).getByLabel('Amount').fill('54.20');
  await dialog(page).getByLabel('Description').fill('Weekly groceries');
  await dialog(page).getByLabel('Category').selectOption({ label: 'Groceries' });
  await dialog(page).getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByText('Saved to the ledger')).toBeVisible();

  // Dashboard updates: net worth and budget
  await expect(page.locator('.hero-figure').first()).toHaveText('$2,445.80');
  await expect(page.getByRole('region', { name: /month.s budget/ }).getByText('$54', { exact: true })).toBeVisible();

  // Navigate → ledger shows the entry; refresh keeps it
  await page.getByRole('link', { name: 'Spend' }).first().click();
  const row = page.getByRole('row', { name: /Weekly groceries/ });
  await expect(row).toContainText('−$54.20');
  await page.reload();
  await expect(page.getByRole('row', { name: /Weekly groceries/ })).toBeVisible();

  // Sign out and back in
  await signOut(page);
  await signIn(page, email, 'correct horse battery');
  await page.goto('/ledger');
  await expect(page.getByRole('row', { name: /Weekly groceries/ })).toContainText('Groceries');

  // Planner: the paper's evaluation task — simulate a 30% income drop
  await page.getByRole('link', { name: 'Planner' }).first().click();
  await expect(page.getByText('How this is calculated')).toBeVisible();
  await expect(page.getByText(/Design contracts: \$3,000\.00 monthly/)).toBeVisible();
  await page.getByRole('button', { name: /Income drops 30%/ }).click();
  await expect(page.getByText('With your changes')).toBeVisible();
  await expect(page.getByText('Income changes')).toBeVisible();
  await expect(page.getByText('−30%')).toBeVisible();
});

test('validation errors are shown next to the field', async ({ page }) => {
  await register(page, 'Val Idation', 'not-an-email');
  await expect(page.getByText('Enter a valid email address')).toBeVisible();
  await page.getByLabel('Email').fill(uniqueEmail('v'));
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Password must be at least 10 characters')).toBeVisible();
});
