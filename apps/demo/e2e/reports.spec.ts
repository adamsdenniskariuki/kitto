import { expect, test, type Page } from '@playwright/test';
import { createWorkspace, expectNoSideScroll, uniqueEmail, uniqueSlug } from './helpers';

const revenue = (page: Page) => page.getByRole('group', { name: 'Revenue figures' });
const stat = (page: Page, label: string) =>
  revenue(page)
    .locator('.card')
    .filter({ has: page.getByText(label, { exact: true }) });

test('reports: revenue KPIs follow invoices and payments, and the period filter works', async ({
  page,
}) => {
  const home = await createWorkspace(
    page,
    uniqueEmail('owner'),
    'Savannah Cafe',
    uniqueSlug('savannah'),
  );

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Reports' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
  await expect(page.getByText('(30 days, Africa/Nairobi time)', { exact: false })).toBeVisible();
  await expect(stat(page, 'Collected')).toContainText('0.00');
  await expect(page.getByText('No payments in this period.')).toBeVisible();
  for (const name of ['Revenue', 'Payments by method', 'Receivables aging', 'Bookings']) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  await expect(page.getByRole('img', { name: 'Invoiced and collected per day' })).toBeVisible();
  await expectNoSideScroll(page);

  // Issue an invoice for 1,000 and take 400 in cash.
  await page.goto(`${home}/invoices/new`);
  await page.getByLabel('Line 1 description').fill('Catering');
  await page.getByLabel('Line 1 unit price (KES)').fill('1,000');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Issue invoice' }).click();
  await expect(page.getByText('Issued and numbered.')).toBeVisible();
  await page.locator('#f-amount').fill('400');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Payment recorded.')).toBeVisible();

  // The home page summary and the reports reflect it.
  await page.goto(home);
  const kpi = page.getByRole('region', { name: 'Last 30 days' });
  await expect(kpi).toContainText('400.00');
  await expect(kpi).toContainText('600.00');
  await kpi.getByRole('link', { name: 'Open reports' }).click();

  await expect(stat(page, 'Invoiced')).toContainText('1,000.00');
  await expect(stat(page, 'Collected')).toContainText('400.00');
  await expect(stat(page, 'Outstanding')).toContainText('600.00');
  await expect(stat(page, 'Overdue')).toContainText('0.00');
  const methods = page.getByRole('img', { name: 'Share of payments by method' });
  await expect(methods).toBeVisible();
  await expect(page.getByRole('table', { name: 'Share of payments by method' })).toContainText(
    'Cash',
  );
  await expectNoSideScroll(page);

  // An earlier period has none of it; the dates go in the URL, not the payment.
  await page.getByLabel('From', { exact: true }).fill('2025-01-01');
  await page.getByLabel('To', { exact: true }).fill('2025-01-31');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page).toHaveURL(/\?from=2025-01-01&to=2025-01-31$/);
  await expect(page.getByText('(31 days, Africa/Nairobi time)', { exact: false })).toBeVisible();
  await expect(stat(page, 'Collected')).toContainText('0.00');
  await expect(stat(page, 'Outstanding')).toContainText('600.00');

  // A long period is charted per week; a nonsense one is corrected.
  await page.getByRole('link', { name: 'Last 365 days' }).click();
  await expect(page.getByRole('img', { name: 'Invoiced and collected per week' })).toBeVisible();
  await expect(stat(page, 'Collected')).toContainText('400.00');
  await page.goto(`${home}/reports?from=2025-02-30&to=2020-01-01`);
  await expect(page.getByText("That period wasn't valid", { exact: false })).toBeVisible();
});
