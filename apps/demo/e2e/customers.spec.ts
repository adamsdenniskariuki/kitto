import { expect, test } from '@playwright/test';
import { createWorkspace, expectNoSideScroll, uniqueEmail, uniqueSlug } from './helpers';

test('customers: add, search, tag, note, archive and delete', async ({ page }) => {
  const home = await createWorkspace(
    page,
    uniqueEmail('owner'),
    'Coast Lodge',
    uniqueSlug('coast'),
  );

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Customers' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Customers' })).toBeVisible();
  await expect(page.getByText('No customers yet')).toBeVisible();

  // Add a customer; the phone is stored in international form.
  await page.getByRole('link', { name: 'New customer' }).click();
  await page.getByLabel('Name').fill('Wanjiku Kamau');
  await page.getByLabel('Phone').fill('0712 345 678');
  await page.getByLabel('Email').fill('wanjiku@example.com');
  await page.getByLabel('Tags').fill('VIP, corporate');
  await page.getByRole('button', { name: 'Add customer' }).click();
  await expect(page.getByText('Customer added.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: /Wanjiku Kamau/ })).toBeVisible();
  await expect(page.getByLabel('Phone')).toHaveValue('+254712345678');
  await expect(page.getByLabel('Tags')).toHaveValue('corporate, vip');
  await expectNoSideScroll(page);
  const detail = page
    .url()
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]!;

  // The same phone, typed differently, belongs to someone already.
  await page.goto(`${home}/customers/new`);
  await page.getByLabel('Name').fill('Someone Else');
  await page.getByLabel('Phone').fill('+254 712 345678');
  await page.getByRole('button', { name: 'Add customer' }).click();
  await expect(page.getByText('Another customer already has that phone number.')).toBeVisible();

  // Search by name and by local phone digits; filter by tag.
  await page.goto(`${home}/customers`);
  const search = page.getByRole('searchbox', { name: 'Search customers' });
  await search.fill('kamau');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('rowheader', { name: 'Wanjiku Kamau' })).toBeVisible();
  await search.fill('0712345678');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('rowheader', { name: 'Wanjiku Kamau' })).toBeVisible();
  await search.fill('nobody-here');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('No matching customers')).toBeVisible();
  await page.goto(`${home}/customers?tag=vip`);
  await expect(page.getByRole('rowheader', { name: 'Wanjiku Kamau' })).toBeVisible();

  // Notes.
  await page.goto(detail);
  await page.getByLabel('Add a note').fill('Prefers a sea-view room.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Note added.')).toBeVisible();
  await expect(page.getByText('Prefers a sea-view room.')).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete note' }).click();
  await expect(page.getByText('Note deleted.')).toBeVisible();
  await expect(page.getByText('No notes yet.')).toBeVisible();

  // Archive hides the customer from the list until "Include archived".
  await page.getByRole('button', { name: 'Archive customer' }).click();
  await expect(page.getByText(/Customer archived/)).toBeVisible();
  await page.goto(`${home}/customers`);
  await expect(page.getByRole('rowheader', { name: /Wanjiku Kamau/ })).toHaveCount(0);
  await page.getByLabel('Include archived').check();
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('rowheader', { name: /Wanjiku Kamau/ })).toBeVisible();

  // A customer with no history can be deleted outright.
  await page.goto(detail);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete customer' }).click();
  await expect(page.getByText('Customer deleted.')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${home}/customers\\?notice=deleted$`));
  expect((await page.goto(detail))?.status()).toBe(404);
});
