import { expect, test, type Page } from '@playwright/test';
import { createWorkspace, expectNoSideScroll, uniqueEmail, uniqueSlug } from './helpers';

const here = (page: Page) =>
  page
    .url()
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]!;

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const lines = (page: Page) => page.getByRole('table', { name: 'Order lines' });

/** Add a stocked item with a price, and count some into the default location. */
async function addStockedItem(page: Page, home: string, name: string, price: string, qty: string) {
  await page.goto(`${home}/inventory/items/new`);
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Price (KES)').fill(price);
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByText('Item added.')).toBeVisible();
  const item = here(page);
  await page.getByRole('link', { name: 'Adjust stock' }).click();
  await page.getByLabel('Location').selectOption({ label: 'Main store' });
  await page.getByLabel('Change').fill(qty);
  await page.getByLabel('Reason').fill('Opening count');
  await page.getByRole('button', { name: 'Adjust stock' }).click();
  await expect(page.getByText('Stock adjusted.')).toBeVisible();
  return item;
}

async function openOrder(page: Page, home: string, label: string) {
  await page.goto(`${home}/orders/new`);
  await page.getByLabel('Table or label').fill(label);
  await page.getByRole('button', { name: 'Open order' }).click();
  await expect(page.getByText('Order opened.', { exact: false })).toBeVisible();
  return here(page);
}

async function addItemLine(page: Page, item: string, qty: string) {
  await page.getByLabel('Item', { exact: true }).selectOption({ label: `${item} (each)` });
  await page.getByLabel('Quantity').fill(qty);
  await page.getByRole('button', { name: 'Add line' }).click();
  await expect(page.getByText('Line added.')).toBeVisible();
}

async function setStatus(page: Page, button: string, notice: string) {
  await page.getByRole('button', { name: button }).click();
  await expect(page.getByText(notice, { exact: false })).toBeVisible();
}

async function cancelOrder(page: Page, reason: string) {
  await page.getByLabel('Reason for cancelling').fill(reason);
  page.once('dialog', (d) => void d.accept());
  await setStatus(page, 'Cancel order', 'Order cancelled.');
}

async function expectOnHand(page: Page, item: string, text: string) {
  await page.goto(item);
  await expect(page.getByTestId('on-hand')).toHaveText(text);
}

test('orders: lines, send takes stock, no negative stock, fulfil, bill, cancel returns stock', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const home = await createWorkspace(
    page,
    uniqueEmail('owner'),
    'Savannah Restaurant',
    uniqueSlug('sav'),
  );
  const soda = await addStockedItem(page, home, 'Soda', '100', '5');

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Orders' })
    .click();
  await expect(page.getByText('No orders')).toBeVisible();

  // Table 4: two sodas, corkage (free text) and a mistake that is removed.
  const order = await openOrder(page, home, 'Table 4');
  await expect(h1(page)).toHaveText('Order #1 · Table 4');
  await addItemLine(page, 'Soda', '2');
  await page.getByLabel('Description').fill('Corkage');
  await page.getByLabel('Unit price (KES)').fill('150');
  await page.getByRole('button', { name: 'Add line' }).click();
  await expect(lines(page).getByRole('rowheader', { name: 'Corkage' })).toBeVisible();
  await page.getByLabel('Description').fill('Wrong dish');
  await page.getByLabel('Unit price (KES)').fill('999');
  await page.getByRole('button', { name: 'Add line' }).click();
  await expect(lines(page).getByRole('rowheader', { name: 'Wrong dish' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Wrong dish' }).click();
  await expect(page.getByText('Line removed.')).toBeVisible();
  // A free-text line needs a price.
  await page.getByLabel('Description').fill('Mystery');
  await page.getByRole('button', { name: 'Add line' }).click();
  await expect(page.getByText('Enter a price for a line without an item.')).toBeVisible();
  await expect(lines(page).getByRole('row')).toHaveCount(3);
  await expect(page.getByTestId('order-total')).toContainText('350.00');
  await expectNoSideScroll(page);

  // Sending takes the stock and locks the lines.
  await setStatus(page, 'Send order', 'Order sent. Stock has been taken.');
  await expect(page.getByRole('heading', { name: 'Add a line' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await expectOnHand(page, soda, '3 each');

  // More than is in stock: the order stays open and nothing is taken.
  const greedy = await openOrder(page, home, 'Table 9');
  await addItemLine(page, 'Soda', '10');
  await page.getByRole('button', { name: 'Send order' }).click();
  await expect(
    page.getByText('There is not enough stock to send this order.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('Open', { exact: true })).toBeVisible();
  await cancelOrder(page, 'Changed their mind');
  await expect(page.getByText('Changed their mind')).toBeVisible();
  await expectOnHand(page, soda, '3 each');

  // Fulfil, then bill it: the invoice links back and paying it pays the order.
  await page.goto(order);
  await expect(page.getByRole('button', { name: 'Cancel order' })).toBeVisible();
  await setStatus(page, 'Mark fulfilled', 'Order fulfilled.');
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark paid' })).toBeVisible();
  await page.getByRole('button', { name: 'Create invoice' }).click();
  await expect(page.getByText('Invoice ready. Review it and issue it.')).toBeVisible();
  await expect(page.getByTestId('invoice-total')).toContainText('350.00');
  await page.getByRole('button', { name: 'Issue invoice' }).click();
  await expect(page.getByText('Issued and numbered.')).toBeVisible();
  await page.locator('#f-amount').fill('350');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Payment recorded.')).toBeVisible();
  await page.goto(order);
  await expect(
    page.getByRole('region', { name: 'Summary' }).getByText('Paid').first(),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Invoice', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Next step' })).toHaveCount(0);

  // Cancelling a sent order returns its stock.
  const sent = await openOrder(page, home, 'Bar');
  await addItemLine(page, 'Soda', '2');
  await setStatus(page, 'Send order', 'Order sent.');
  await expectOnHand(page, soda, '1 each');
  await page.goto(sent);
  await cancelOrder(page, 'Spilt');
  await expectOnHand(page, soda, '3 each');

  // The ledger shows the sale and the return against their orders.
  await page.goto(`${home}/inventory/movements?item=${soda.split('/').pop()}`);
  // Opening count, the sale for #1, and the sale and return for #3.
  await expect(page.getByRole('row')).toHaveCount(5);
  await expect(page.getByRole('table').locator('a[href*="/orders/"]')).toHaveCount(3);

  // The list filters by status.
  await page.goto(`${home}/orders?status=cancelled`);
  await expect(page.getByRole('link', { name: 'Order #2 · Table 9' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Order #3 · Bar' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Order #1 · Table 4' })).toHaveCount(0);
  await expect(greedy).toContain('/orders/');
});

test('orders: charge an order to a reservation and bill it with the stay', async ({ page }) => {
  test.setTimeout(150_000);
  const home = await createWorkspace(
    page,
    uniqueEmail('owner'),
    'Baobab Lodge',
    uniqueSlug('baobab'),
  );
  const soda = await addStockedItem(page, home, 'Soda', '100', '10');

  await page.goto(`${home}/customers/new`);
  await page.getByLabel('Name').fill('Amina Hassan');
  await page.getByRole('button', { name: 'Add customer' }).click();
  await expect(page.getByText('Customer added.')).toBeVisible();
  await page.goto(`${home}/bookings/resources`);
  await page.getByLabel('Name').fill('Room 7');
  await page.getByRole('button', { name: 'Add resource' }).click();
  await expect(page.getByText('Resource added.')).toBeVisible();
  const resource = here(page).split('/').pop()!;
  await page.getByRole('button', { name: 'Add hours' }).click();
  await expect(page.getByText('Opening hours added.')).toBeVisible();
  await page.goto(`${home}/bookings/new?resource=${resource}&day=2030-01-14`);
  await page.getByLabel('Customer').selectOption({ label: 'Amina Hassan' });
  await page.getByRole('button', { name: 'Book', exact: true }).click();
  await expect(page.getByText('Reservation made.')).toBeVisible();
  const reservation = here(page);
  await expect(page.getByText('No orders charged to this reservation.')).toBeVisible();

  // Room service, charged to the room.
  await page.getByRole('link', { name: 'Charge an order to this reservation' }).click();
  await expect(page.getByLabel('Charge to reservation')).not.toHaveValue('');
  await page.getByLabel('Table or label').fill('Room service');
  await page.getByRole('button', { name: 'Open order' }).click();
  await expect(page.getByText('Order opened.', { exact: false })).toBeVisible();
  const order = here(page);
  await addItemLine(page, 'Soda', '3');
  await setStatus(page, 'Send order', 'Order sent.');
  // Paid with the reservation's invoice, not on its own.
  await expect(page.getByRole('button', { name: 'Mark fulfilled' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark paid' })).toHaveCount(0);
  await page.getByRole('link', { name: /Room 7/ }).click();
  await expect(page).toHaveURL(new RegExp(`${reservation}$`));

  const charged = page.getByRole('region', { name: 'Orders' });
  await expect(charged.getByRole('link', { name: 'Order #1 · Room service' })).toBeVisible();
  await expect(page.getByTestId('reservation-orders-total')).toContainText('300.00');
  await expectNoSideScroll(page);

  // The reservation's invoice includes the order, which is then on that invoice.
  await page.getByRole('button', { name: 'Create invoice' }).click();
  await expect(page.getByText('Invoice ready. Review it and issue it.')).toBeVisible();
  await expect(page.getByText('Order #1 · Soda')).toBeVisible();
  await expect(page.getByTestId('invoice-total')).toContainText('300.00');
  await page.goto(order);
  await expect(page.getByRole('link', { name: 'Invoice', exact: true })).toBeVisible();
  await expectOnHand(page, soda, '7 each');

  // The customer's page lists the order too.
  await page.goto(`${home}/customers`);
  await page.getByRole('link', { name: 'Amina Hassan' }).click();
  await expect(page.getByRole('region', { name: 'Orders' })).toContainText('Room service');
});
