import { expect, test, type Page } from '@playwright/test';
import { createWorkspace, expectNoSideScroll, uniqueEmail, uniqueSlug } from './helpers';

const here = (page: Page) =>
  page
    .url()
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]!;

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const onHand = (page: Page) => page.getByTestId('on-hand');
const stock = (page: Page) => page.getByRole('region', { name: 'Stock' });

test('inventory: items, suppliers, purchases, adjustments, transfers, low stock', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const home = await createWorkspace(
    page,
    uniqueEmail('owner'),
    'Mara Bar & Grill',
    uniqueSlug('mara'),
  );

  // Every workspace starts with a default location; add a bar.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Inventory' })
    .click();
  await expect(page.getByText('No items yet')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Inventory' })
    .getByRole('link', { name: 'Locations' })
    .click();
  await expect(page.getByRole('list', { name: 'Locations' })).toContainText('Main store');
  await page.getByLabel('Name', { exact: true }).fill('Bar');
  await page.getByRole('button', { name: 'Add location' }).click();
  await expect(page.getByText('Location added.')).toBeVisible();

  await page.goto(`${home}/inventory/suppliers`);
  await page.getByLabel('Name', { exact: true }).fill('Kenya Breweries');
  await page.getByLabel('Phone').fill('0711 000 111');
  await page.getByRole('button', { name: 'Add supplier' }).click();
  await expect(page.getByText('Supplier added.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kenya Breweries' })).toBeVisible();

  // A stocked item: low at 10 or fewer.
  await page.goto(`${home}/inventory`);
  await page.getByRole('link', { name: 'New item' }).click();
  await page.getByLabel('Name').fill('Tusker lager');
  await page.getByLabel('SKU').fill('TUS-500');
  await page.getByLabel('Unit').fill('bottle');
  await page.getByLabel('Cost (KES)').fill('180');
  await page.getByLabel('Price (KES)').fill('300');
  await page.getByLabel('Reorder level').fill('10');
  await expectNoSideScroll(page);
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByText('Item added.')).toBeVisible();
  await expect(h1(page)).toHaveText('Tusker lager');
  await expect(onHand(page)).toHaveText('0 bottle');
  const item = here(page);

  // The same SKU can't be used twice.
  await page.goto(`${home}/inventory/items/new`);
  await page.getByLabel('Name').fill('Another lager');
  await page.getByLabel('SKU').fill('TUS-500');
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByText('Another item already uses that SKU.')).toBeVisible();

  // Receive a purchase of 24 at a new cost.
  await page.goto(`${home}/inventory/purchases`);
  await page.getByRole('link', { name: 'New purchase' }).click();
  await page.getByLabel('Supplier').selectOption({ label: 'Kenya Breweries' });
  await page.getByLabel('Reference').fill('DN-2041');
  await page.getByRole('button', { name: 'Start purchase' }).click();
  await expect(page.getByText('Purchase started.', { exact: false })).toBeVisible();
  await page
    .getByLabel('Item', { exact: true })
    .selectOption({ label: 'Tusker lager · TUS-500 (bottle)' });
  await page.getByLabel('Quantity').fill('24');
  await page.getByLabel('Unit cost (KES)').fill('170');
  await page.getByRole('button', { name: 'Add line' }).click();
  await expect(page.getByText('Line added.')).toBeVisible();
  await page.getByLabel('Update item costs').check();
  await page.getByRole('button', { name: 'Receive into stock' }).click();
  await expect(page.getByText('Purchase received. Stock is updated.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add line' })).toHaveCount(0);
  await expectNoSideScroll(page);

  await page.goto(item);
  await expect(onHand(page)).toHaveText('24 bottle');
  await expect(page.getByLabel('Cost (KES)')).toHaveValue(/^170(\.00)?$/);

  // Adjust: a write-off needs enough stock.
  await page.getByRole('link', { name: 'Adjust stock' }).click();
  await page.getByLabel('Location').selectOption({ label: 'Main store' });
  await page.getByLabel('Change').fill('-100');
  await page.getByLabel('Reason').fill('Broken');
  await page.getByRole('button', { name: 'Adjust stock' }).click();
  await expect(
    page.getByText('There is not enough stock for that. Receive or adjust stock first.'),
  ).toBeVisible();
  await page
    .getByLabel('Item', { exact: true })
    .selectOption({ label: 'Tusker lager · TUS-500 (bottle)' });
  await page.getByLabel('Location').selectOption({ label: 'Main store' });
  await page.getByLabel('Change').fill('-3');
  await page.getByLabel('Reason').fill('Broken');
  await page.getByRole('button', { name: 'Adjust stock' }).click();
  await expect(page.getByText('Stock adjusted.')).toBeVisible();
  await expect(onHand(page)).toHaveText('21 bottle');

  // Transfer: both sides or neither.
  await page.getByRole('link', { name: 'Move stock' }).click();
  await page.getByLabel('From').selectOption({ label: 'Main store' });
  await page.getByLabel('To', { exact: true }).selectOption({ label: 'Bar' });
  await page.getByLabel('Quantity').fill('50');
  await page.getByRole('button', { name: 'Move stock' }).click();
  await expect(
    page.getByText('There is not enough stock for that. Receive or adjust stock first.'),
  ).toBeVisible();
  await page
    .getByLabel('Item', { exact: true })
    .selectOption({ label: 'Tusker lager · TUS-500 (bottle)' });
  await page.getByLabel('From').selectOption({ label: 'Main store' });
  await page.getByLabel('To', { exact: true }).selectOption({ label: 'Bar' });
  await page.getByLabel('Quantity').fill('12');
  await page.getByLabel('Note', { exact: true }).fill('Friday night');
  await page.getByRole('button', { name: 'Move stock' }).click();
  await expect(page.getByText('Stock moved.')).toBeVisible();
  await expect(onHand(page)).toHaveText('21 bottle');
  await expect(stock(page)).toContainText(/Main store\s*9 bottle/);
  await expect(stock(page)).toContainText(/Bar\s*12 bottle/);

  // Not low yet; a count at the bar brings it to the reorder level.
  await page.goto(`${home}/inventory/low`);
  await expect(page.getByText('Nothing is low')).toBeVisible();
  await page.goto(`${home}/inventory/adjust?item=${item.split('/').pop()}`);
  await page.getByLabel('Location').selectOption({ label: 'Bar' });
  await page.getByLabel('Change').fill('-11');
  await page.getByLabel('Reason').fill('Stock count');
  await page.getByRole('button', { name: 'Adjust stock' }).click();
  await expect(page.getByText('Stock adjusted.')).toBeVisible();
  await expect(onHand(page)).toHaveText('10 bottle');
  await expect(stock(page).getByText('Low stock')).toBeVisible();

  await page.goto(`${home}/inventory/low`);
  await expect(page.getByRole('link', { name: 'Tusker lager' })).toBeVisible();
  await expectNoSideScroll(page);
  await page.goto(home);
  await expect(page.getByRole('list', { name: 'Items low on stock' })).toContainText(
    'Tusker lager',
  );

  // The ledger keeps every movement.
  await page.goto(`${home}/inventory/movements`);
  const ledger = page.getByRole('table');
  await expect(ledger.getByRole('row')).toHaveCount(6); // header + purchase, adjust, 2 transfer, count
  await expect(ledger).toContainText('Broken');
  await expect(ledger).toContainText('Stock count');
  await expectNoSideScroll(page);
});
