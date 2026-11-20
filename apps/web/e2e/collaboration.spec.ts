import { expect, test } from '@playwright/test';
import { dialog, register, uniqueEmail } from './helpers';

test('invite a contributor, edit + comment with @mention, owner sees notification and history', async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await register(owner, 'Olivia Owner', uniqueEmail('olivia'));
  await owner.getByLabel('Household name').fill('Shared flat');
  await owner.getByRole('button', { name: 'Continue' }).click();
  await owner.getByRole('button', { name: 'Finish later' }).click();
  await expect(owner.getByText('Finish setting up Shared flat.')).toBeVisible();

  // Account + invitation
  await owner.goto('/household?tab=accounts');
  await owner.getByRole('button', { name: 'Add account' }).click();
  await dialog(owner).getByLabel('Account name').fill('House kitty');
  await dialog(owner).getByLabel('Current balance').fill('400');
  await dialog(owner).getByRole('button', { name: 'Add account' }).click();
  await expect(owner.getByText('Added House kitty')).toBeVisible();
  await owner.goto('/household');
  await owner.getByRole('button', { name: 'Invite' }).click();
  await dialog(owner).getByRole('button', { name: 'Create invitation' }).click();
  const link = await dialog(owner).getByLabel('Invitation link').inputValue();
  expect(link).toContain('/invite/');
  await dialog(owner).getByRole('button', { name: 'Done' }).click();

  // Member accepts via the link
  const memberCtx = await browser.newContext();
  const member = await memberCtx.newPage();
  await member.goto(new URL(link).pathname);
  await expect(member.getByRole('heading', { name: 'Join Shared flat' })).toBeVisible();
  await member.getByRole('button', { name: 'Create an account to join' }).click();
  await member.getByLabel('Your name').fill('Casey Contributor');
  await member.getByLabel('Email').fill(uniqueEmail('casey'));
  await member.getByLabel('Password').fill('correct horse battery');
  await member.getByRole('button', { name: 'Create account' }).click();
  await member.getByRole('button', { name: 'Accept and join' }).click();
  await expect(member.getByText('Shared flat · shared accounts')).toBeVisible();

  // Owner logs an entry; member edits it and comments with a mention
  await owner.goto('/ledger');
  await owner.getByRole('button', { name: 'Add entry' }).click();
  await dialog(owner).getByLabel('Amount').fill('38');
  await dialog(owner).getByLabel('Description').fill('Cleaning supplies');
  await dialog(owner).getByRole('button', { name: 'Save entry' }).click();
  await expect(owner.getByText('Saved to the ledger')).toBeVisible();

  await member.goto('/ledger');
  await member.getByRole('button', { name: 'Cleaning supplies' }).click();
  await member.getByRole('button', { name: 'Edit' }).click();
  await dialog(member).getByLabel('Amount').fill('41.50');
  await dialog(member).getByRole('button', { name: 'Save changes' }).click();
  await expect(member.getByText(/a new version was added/)).toBeVisible();
  await member.getByRole('button', { name: '@Olivia' }).click();
  await member.getByLabel('Write a comment').pressSequentially('can we split this?');
  await member.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(member.getByText('@Olivia can we split this?')).toBeVisible();

  // Owner is notified and can read the version history
  await owner.goto('/notifications');
  const note = owner.getByText(/Casey Contributor mentioned you on .Cleaning supplies./);
  await expect(note).toBeVisible();
  await note.click();
  await owner.getByRole('tab', { name: /History/ }).click();
  await expect(owner.getByText('amount:')).toBeVisible();
  await expect(owner.getByText('−$41.50').first()).toBeVisible();

  await ownerCtx.close();
  await memberCtx.close();
});

test('viewers can read and comment but cannot add or edit entries', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('liam@sample.synerpulse.test');
  await page.getByLabel('Password').fill('synerpulse-demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Liam');
  await expect(page.getByRole('button', { name: 'Add entry' })).toHaveCount(0);
  await page.goto('/ledger');
  await page.getByRole('row').nth(1).click();
  await expect(page.getByText('Viewers can read and comment.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
});
