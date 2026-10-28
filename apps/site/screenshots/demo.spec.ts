import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { createWorkspace, uniqueSlug } from '../../demo/e2e/helpers';

const OUT = join(import.meta.dirname, '..', 'public', 'screenshots');

/** Saves the viewport as an optimised PNG (palette-quantised, well under 300 KB). */
async function capture(page: Page, file: string) {
  await page.evaluate(() => document.fonts.ready);
  const raw = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const png = await sharp(raw)
    .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 })
    .toBuffer();
  await sharp(png).toFile(join(OUT, file));
  console.log(`${file}: ${Math.round(png.length / 1024)} KB`);
}

test('capture demo screenshots with sample data', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const home = await createWorkspace(
    page,
    // Shown on the home page, so keep it readable; the suffix keeps each run a new owner.
    `owner.${Date.now().toString(36)}@savannah-lodge.test`,
    'Savannah Lodge',
    uniqueSlug('lodge'),
  );
  const main = page.getByRole('main');

  await page.getByRole('button', { name: 'Load sample data' }).click();
  await expect(page.getByText('Sample data loaded.')).toBeVisible();
  await page.goto(home);
  await expect(main.getByText('Bottled water')).toBeVisible();
  await capture(page, 'workspace-home.png');

  await page.goto(`${home}/admin/roles`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await capture(page, 'admin-roles.png');

  await page.goto(`${home}/bookings`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await capture(page, 'bookings.png');

  await page.goto(`${home}/invoices`);
  await page.getByRole('link', { name: 'INV-00001' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('INV-00001');
  await capture(page, 'invoice.png');

  await page.goto(`${home}/orders`);
  await main.getByRole('link', { name: 'All', exact: true }).click();
  await expect(page).toHaveURL(/[?&]status=all\b/);
  await expect(main.getByText('Room service')).toBeVisible();
  await expect(main.getByRole('link', { name: /Counter/ })).toBeVisible();
  await capture(page, 'orders.png');

  await page.goto(`${home}/inventory`);
  await expect(main.getByText('Bottled water').first()).toBeVisible();
  await capture(page, 'inventory.png');

  await page.goto(`${home}/reports`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Top items sold' })).toBeVisible();
  await capture(page, 'reports.png');
});
