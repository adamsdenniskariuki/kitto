import { expect, test, type Page } from '@playwright/test';
import { createWorkspace, expectNoSideScroll, uniqueEmail, uniqueSlug } from './helpers';

const here = (page: Page) =>
  page
    .url()
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]!;

async function addCustomer(page: Page, home: string, name: string) {
  await page.goto(`${home}/customers/new`);
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Add customer' }).click();
  await expect(page.getByText('Customer added.')).toBeVisible();
  return here(page);
}

async function fillLine(
  page: Page,
  n: number,
  description: string,
  qty: string,
  price: string,
  tax = '0',
) {
  await page.getByLabel(`Line ${n} description`).fill(description);
  await page.getByLabel(`Line ${n} quantity`).fill(qty);
  await page.getByLabel(`Line ${n} unit price (KES)`).fill(price);
  await page.getByLabel(`Line ${n} tax %`).fill(tax);
}

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });

test('billing: invoice with lines, issue, part payment, M-Pesa mock, PDF', async ({ page }) => {
  test.setTimeout(120_000);
  const home = await createWorkspace(
    page,
    uniqueEmail('owner'),
    'Lakeside Lodge',
    uniqueSlug('lake'),
  );
  const customer = await addCustomer(page, home, 'Wanjiru Kamau');

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Invoices' })
    .click();
  await expect(page.getByText('No invoices yet')).toBeVisible();

  // Two lines, one taxed: 2 x 4,500 + 16% = 10,440, plus 2 x 500 = 11,440.
  await page.getByRole('link', { name: 'New invoice' }).click();
  await page.getByLabel('Customer').selectOption({ label: 'Wanjiru Kamau' });
  await fillLine(page, 1, 'Room night', '2', '4,500', '16');
  await page.getByRole('button', { name: 'Add line' }).click();
  await fillLine(page, 2, 'Breakfast', '2', '500');
  await expect(page.getByText('11,440.00').first()).toBeVisible();
  await expectNoSideScroll(page);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await expect(h1(page)).toContainText('Draft invoice');
  await expect(page.getByTestId('invoice-total')).toContainText('11,440.00');
  const invoice = here(page);

  await page.getByRole('button', { name: 'Issue invoice' }).click();
  await expect(page.getByText('Issued and numbered.')).toBeVisible();
  await expect(h1(page)).toContainText('INV-00001');
  await expect(h1(page)).toContainText('Issued');

  // More than the balance is refused; a part payment is fine.
  await page.locator('#f-amount').fill('20000');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('That is more than the balance due.')).toBeVisible();
  await page.locator('#f-amount').fill('4,000');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Payment recorded.')).toBeVisible();
  await expect(h1(page)).toContainText('Part paid');
  await expect(page.getByTestId('invoice-balance')).toContainText('7,440.00');
  await expect(page.getByRole('button', { name: 'Void' })).toHaveCount(0);

  // The rest by M-Pesa: mock mode posts a successful callback a second later.
  await page.getByLabel("Customer's M-Pesa number").fill('0712 345 678');
  await expect(page.locator('#f-mpesa-amount')).toHaveValue('7440');
  await page.getByRole('button', { name: 'Send M-Pesa request' }).click();
  await expect(page.getByText('Payment request sent.', { exact: false })).toBeVisible();
  const requests = page.getByRole('list', { name: 'M-Pesa requests' });
  await expect(async () => {
    await page.reload();
    await expect(h1(page)).toContainText('Paid', { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByTestId('invoice-balance')).toContainText('0.00');
  await expect(requests.getByText('Paid', { exact: true })).toBeVisible();
  await expect(requests.getByText(/^KTO/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Record a payment' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send M-Pesa request' })).toHaveCount(0);
  await expectNoSideScroll(page);

  // The PDF is served to members only.
  const pdf = await page.request.get(`${invoice}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

  // The customer's page lists it.
  await page.goto(customer);
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'INV-00001' })).toBeVisible();
});

test('billing: quote to invoice, gapless numbers, voiding, cancelled M-Pesa', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const home = await createWorkspace(page, uniqueEmail('owner'), 'Rift Motors', uniqueSlug('rift'));
  await addCustomer(page, home, 'Kiprop Chebet');

  // A quote is numbered separately and shows as "Sent" once issued.
  await page.goto(`${home}/invoices/new?kind=quote`);
  await expect(h1(page)).toHaveText('New quote');
  await page.getByLabel('Customer').selectOption({ label: 'Kiprop Chebet' });
  await fillLine(page, 1, 'Service package', '1', '12,000');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Issue quote' }).click();
  await expect(h1(page)).toContainText('QUO-00001');
  await expect(h1(page)).toContainText('Sent');
  await expect(page.getByRole('heading', { name: 'Record a payment' })).toHaveCount(0);
  const quote = here(page);

  await page.getByRole('button', { name: 'Accept and convert to invoice' }).click();
  await expect(page.getByText('Quote accepted.', { exact: false })).toBeVisible();
  await expect(h1(page)).toContainText('Draft invoice');
  await expect(page.getByTestId('invoice-total')).toContainText('12,000.00');
  await expect(page.getByRole('link', { name: 'View quote' })).toHaveAttribute('href', quote);
  await page.getByRole('button', { name: 'Issue invoice' }).click();
  await expect(h1(page)).toContainText('INV-00001');
  const first = here(page);

  // Converting twice is not offered.
  await page.goto(quote);
  await expect(h1(page)).toContainText('Accepted');
  await expect(page.getByRole('button', { name: 'Accept and convert to invoice' })).toHaveCount(0);

  // Void keeps the number used; the next invoice is INV-00002.
  await page.goto(first);
  await page.getByLabel('Reason for voiding').fill('Wrong customer');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Void' }).click();
  await expect(page.getByText('Voided. The number stays used.')).toBeVisible();
  await expect(h1(page)).toContainText('Void');
  await expect(page.getByText('Wrong customer')).toBeVisible();

  await page.goto(`${home}/invoices/new`);
  await fillLine(page, 1, 'Oil change', '1', '3,500');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Issue invoice' }).click();
  await expect(h1(page)).toContainText('INV-00002');

  // A cancelled M-Pesa prompt records nothing.
  await page.getByLabel("Customer's M-Pesa number").fill('0712 341 032');
  await page.getByRole('button', { name: 'Send M-Pesa request' }).click();
  await expect(page.getByText('Payment request sent.', { exact: false })).toBeVisible();
  const requests = page.getByRole('list', { name: 'M-Pesa requests' });
  await expect(async () => {
    await page.reload();
    await expect(requests.getByText('Cancelled', { exact: true })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(h1(page)).toContainText('Issued');
  await expect(page.getByTestId('invoice-balance')).toContainText('3,500.00');

  // The list filters by type.
  await page.goto(`${home}/invoices`);
  await expect(page.getByRole('link', { name: /^(INV|QUO)-/ })).toHaveCount(3);
  await page
    .getByRole('navigation', { name: 'Document type' })
    .getByRole('link', { name: 'Quotes' })
    .click();
  await expect(page.getByRole('link', { name: /^(INV|QUO)-/ })).toHaveText(['QUO-00001']);

  // Signed-out visitors get no PDF.
  const anon = await browser.newContext();
  const res = await anon.request.get(`${first}/pdf`, { maxRedirects: 0 });
  expect(res.headers()['content-type'] ?? '').not.toContain('application/pdf');
  await anon.close();
});

test('billing: a reservation can be invoiced from its page', async ({ page }) => {
  test.setTimeout(120_000);
  const home = await createWorkspace(
    page,
    uniqueEmail('owner'),
    'Coast Villas',
    uniqueSlug('coast'),
  );
  await addCustomer(page, home, 'Fatuma Ali');

  await page.goto(`${home}/bookings/resources`);
  await page.getByLabel('Name').fill('Villa 3');
  await page.getByLabel(/^Rate/).fill('9,000');
  await page.getByLabel('Charged').selectOption({ label: 'per night' });
  await page.getByRole('button', { name: 'Add resource' }).click();
  await expect(page.getByText('Resource added.')).toBeVisible();
  const resourceId = here(page).split('/').pop()!;
  await page.goto(`${home}/bookings/new?resource=${resourceId}&day=2030-02-04`);
  await page.getByLabel('Starts').fill('2030-02-04T14:00');
  await page.getByLabel('Ends').fill('2030-02-05T10:00');
  await page.getByLabel('Customer').selectOption({ label: 'Fatuma Ali' });
  await page.getByRole('button', { name: 'Book', exact: true }).click();
  await expect(page.getByText('Reservation made.')).toBeVisible();
  const reservation = here(page);

  await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
  await expect(page.getByText('Not invoiced yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Create invoice' }).click();
  await expect(page.getByText('Invoice ready.', { exact: false })).toBeVisible();
  await expect(h1(page)).toContainText('Draft invoice');
  await expect(page.getByTestId('invoice-total')).toContainText('9,000.00');
  await expect(page.getByRole('link', { name: 'Reservation' })).toHaveAttribute(
    'href',
    reservation,
  );
  await expect(page.getByRole('link', { name: 'Fatuma Ali' })).toBeVisible();

  // Back on the reservation, it is listed and can't be invoiced twice.
  await page.goto(reservation);
  await expect(page.getByRole('link', { name: 'Draft invoice' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create invoice' })).toHaveCount(0);
});
