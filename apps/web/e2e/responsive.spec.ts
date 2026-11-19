import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

const PAGES = ['/', '/ledger', '/ledger?view=breakdown', '/budget', '/planner', '/household', '/household?tab=accounts', '/activity', '/notifications', '/settings'];

test('every page fits the screen without horizontal scrolling', async ({ page }, info) => {
  await signIn(page);
  const width = page.viewportSize()!.width;
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} overflows by ${overflow}px on ${info.project.name}`).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `e2e/.artifacts/screens/${info.project.name}${path.replace(/[/?=&]/g, '_')}.png`, fullPage: true });
  }
  if (width < 768) {
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await expect(page.locator('.sidebar')).toBeHidden();
  } else {
    await expect(page.locator('.sidebar')).toBeVisible();
  }
});

test('the add-entry sheet fits the device and has touch-sized controls', async ({ page }) => {
  await signIn(page);
  const width = page.viewportSize()!.width;
  await page.getByRole('button', { name: 'Add entry' }).filter({ visible: true }).first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(width);
  const save = sheet.getByRole('button', { name: 'Save entry' });
  expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});
