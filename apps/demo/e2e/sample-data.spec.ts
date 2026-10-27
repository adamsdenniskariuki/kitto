import { expect, test } from '@playwright/test';
import { createWorkspace, uniqueEmail, uniqueSlug } from './helpers';

test('an owner loads sample data into an empty workspace', async ({ page }) => {
  test.setTimeout(120_000);
  const home = await createWorkspace(page, uniqueEmail('sample'), 'Sample Inn', uniqueSlug('smp'));
  const main = page.getByRole('main');

  // Module cards explain each module and link to its pages.
  const modules = page.getByRole('region', { name: 'Get started' });
  for (const title of ['Bookings', 'Orders', 'Inventory', 'Customers', 'Invoices', 'Reports']) {
    await expect(modules.getByRole('heading', { level: 3, name: title })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Load sample data' }).click();
  await expect(page.getByText('Sample data loaded.')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${home}\\?notice=sample_loaded$`));
  // Offered only while the workspace is empty.
  await expect(page.getByRole('button', { name: 'Load sample data' })).toHaveCount(0);
  // Bottled water was bought below its reorder level.
  await expect(main.getByText('Bottled water')).toBeVisible();

  await page.goto(`${home}/customers`);
  for (const name of ['Achieng Otieno', 'Brian Kamau', 'Wanjiru Mwangi']) {
    await expect(main.getByRole('link', { name })).toBeVisible();
  }

  await page.goto(`${home}/bookings/resources`);
  for (const name of ['Room 101', 'Room 102', 'Meeting room']) {
    await expect(main.getByRole('link', { name })).toBeVisible();
  }

  await page.goto(`${home}/inventory/low`);
  await expect(main.getByRole('link', { name: /Bottled water/ })).toBeVisible();

  await page.goto(`${home}/orders`);
  await expect(main.getByText('Room service')).toBeVisible();
  await expect(main.getByText('Counter')).toBeVisible();

  await page.goto(`${home}/invoices`);
  await page.getByRole('link', { name: 'INV-00001' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('INV-00001');
  await expect(main.getByText('Part paid').first()).toBeVisible();
  // Two nights at 4,500 plus room service (2 × 300 + 2 × 800), less a 4,500 deposit.
  await expect(main.getByRole('row', { name: /Cash .*4,500\.00/ })).toBeVisible();
  await expect(main.getByText('Balance due: 6700')).toBeVisible();
});

test('a workspace with data is not offered sample data', async ({ page }) => {
  const home = await createWorkspace(page, uniqueEmail('busy'), 'Busy Inn', uniqueSlug('busy'));
  await page.goto(`${home}/customers/new`);
  await page.getByLabel('Name').fill('Existing Customer');
  await page.getByRole('button', { name: 'Add customer' }).click();
  await expect(page.getByText('Customer added.')).toBeVisible();
  await page.goto(home);
  await expect(page.getByRole('heading', { level: 3, name: 'Customers' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load sample data' })).toHaveCount(0);
});
