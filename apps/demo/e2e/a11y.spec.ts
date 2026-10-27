import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createWorkspace, expectNoSideScroll, uniqueEmail, uniqueSlug } from './helpers';

/**
 * Accessibility and layout sweep: each page at phone, tablet and desktop
 * widths, in light and dark, checked with axe-core against WCAG 2.1 A/AA and
 * for sideways scrolling.
 */
const WIDTHS = [360, 768, 1440] as const;
const SCHEMES = ['light', 'dark'] as const;

async function sweep(page: Page, paths: string[]) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of SCHEMES) {
      await page.emulateMedia({ colorScheme });
      for (const path of paths) {
        const where = `${path} at ${width}px, ${colorScheme}`;
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 }).first(), where).toBeVisible();
        const { violations } = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        expect
          .soft(
            violations.map(
              (v) =>
                `${v.id} (${v.impact}): ${v.nodes
                  .slice(0, 3)
                  .map((n) => n.target.join(' '))
                  .join(' | ')}`,
            ),
            where,
          )
          .toEqual([]);
        if (width === 360) await expectNoSideScroll(page);
      }
    }
  }
}

test('public pages are accessible', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the sweep sets its own viewport sizes');
  await sweep(page, ['/', '/login', '/login?error=link', '/does-not-exist']);
});

test('a new workspace, before and after sample data, is accessible', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the sweep sets its own viewport sizes');
  test.setTimeout(300_000);
  const home = await createWorkspace(page, uniqueEmail('a11y-new'), 'Fresh Inn', uniqueSlug('new'));
  await sweep(page, [home]);
  await page.goto(home);
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await expect(page.getByText('Sample data loaded.')).toBeVisible();
  await sweep(page, [home, `${home}/bookings`, `${home}/inventory/low`, `${home}/reports`]);
});

test('workspace and admin pages are accessible', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the sweep sets its own viewport sizes');
  test.setTimeout(900_000);
  const home = await createWorkspace(
    page,
    uniqueEmail('a11y'),
    'Accessible Inn',
    uniqueSlug('a11y'),
  );
  // Create a pending invitation and a custom role so tables and editors have content.
  await page.goto(`${home}/admin/staff`);
  await page.getByLabel('Email').fill(uniqueEmail('invitee'));
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('Invitation sent.')).toBeVisible();
  await page.goto(`${home}/admin/roles`);
  await page.getByRole('link', { name: /Manager/ }).click();
  const managerRoles = page.url().replace(/^https?:\/\/[^/]+/, '');

  // A customer, a resource with hours and a reservation, so module pages have content.
  await page.goto(`${home}/customers/new`);
  await page.getByLabel('Name').fill('Achieng Otieno');
  await page.getByLabel('Tags').fill('vip');
  await page.getByRole('button', { name: 'Add customer' }).click();
  await expect(page.getByText('Customer added.')).toBeVisible();
  const customer = page
    .url()
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]!;
  await page.goto(`${home}/bookings/resources`);
  await page.getByLabel('Name').fill('Room 1');
  await page.getByRole('button', { name: 'Add resource' }).click();
  await expect(page.getByText('Resource added.')).toBeVisible();
  const resource = page
    .url()
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]!;
  await page.getByRole('button', { name: 'Add hours' }).click();
  await expect(page.getByText('Opening hours added.')).toBeVisible();
  await page.goto(`${home}/bookings/new?resource=${resource.split('/').pop()}&day=2030-01-14`);
  await page.getByLabel('Customer').selectOption({ label: 'Achieng Otieno' });
  await page.getByRole('button', { name: 'Book', exact: true }).click();
  await expect(page.getByText('Reservation made.')).toBeVisible();
  const reservation = page
    .url()
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]!;

  // An issued, part-paid invoice (payment, M-Pesa and line tables) and a draft.
  await page.goto(`${home}/invoices/new?customer=${customer.split('/').pop()}`);
  await page.getByLabel('Line 1 description').fill('Room night');
  await page.getByLabel('Line 1 unit price (KES)').fill('4,500');
  await page.getByLabel('Line 1 tax %').fill('16');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  const draft = page
    .url()
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]!;
  await page.goto(`${home}/invoices/new`);
  await page.getByLabel('Line 1 description').fill('Dinner');
  await page.getByLabel('Line 1 unit price (KES)').fill('1,200');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Issue invoice' }).click();
  await expect(page.getByText('Issued and numbered.')).toBeVisible();
  await page.locator('#f-amount').fill('200');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Payment recorded.')).toBeVisible();
  await page.getByLabel("Customer's M-Pesa number").fill('0712 341 032');
  await page.getByRole('button', { name: 'Send M-Pesa request' }).click();
  await expect(page.getByText('Payment request sent.', { exact: false })).toBeVisible();
  const invoice = page
    .url()
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]!;

  // Inventory: a second location, a supplier, an item low on stock and a received purchase.
  await page.goto(`${home}/inventory/locations`);
  await page.getByLabel('Name', { exact: true }).fill('Bar');
  await page.getByRole('button', { name: 'Add location' }).click();
  await expect(page.getByText('Location added.')).toBeVisible();
  await page.goto(`${home}/inventory/suppliers`);
  await page.getByLabel('Name', { exact: true }).fill('Kenya Breweries');
  await page.getByRole('button', { name: 'Add supplier' }).click();
  await expect(page.getByText('Supplier added.')).toBeVisible();
  await page.getByRole('link', { name: 'Kenya Breweries' }).click();
  const supplier = page
    .url()
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]!;
  await page.goto(`${home}/inventory/items/new`);
  await page.getByLabel('Name').fill('Tusker lager');
  await page.getByLabel('SKU').fill('TUS-500');
  await page.getByLabel('Unit').fill('bottle');
  await page.getByLabel('Price (KES)').fill('300');
  await page.getByLabel('Reorder level').fill('10');
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByText('Item added.')).toBeVisible();
  const item = page
    .url()
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]!;
  await page.goto(`${home}/inventory/purchases/new`);
  await page.getByLabel('Supplier').selectOption({ label: 'Kenya Breweries' });
  await page.getByRole('button', { name: 'Start purchase' }).click();
  await expect(page.getByText('Purchase started.', { exact: false })).toBeVisible();
  await page
    .getByLabel('Item', { exact: true })
    .selectOption({ label: 'Tusker lager · TUS-500 (bottle)' });
  await page.getByLabel('Quantity').fill('6');
  await page.getByLabel('Unit cost (KES)').fill('170');
  await page.getByRole('button', { name: 'Add line' }).click();
  await expect(page.getByText('Line added.')).toBeVisible();
  await page.getByRole('button', { name: 'Receive into stock' }).click();
  await expect(page.getByText('Purchase received. Stock is updated.')).toBeVisible();
  const purchase = page
    .url()
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]!;

  // An order charged to the reservation, with a line, sent to take stock.
  await page.goto(`${home}/orders/new?reservation=${reservation.split('/').pop()}`);
  await page.getByLabel('Table or label').fill('Room service');
  await page.getByRole('button', { name: 'Open order' }).click();
  await expect(page.getByText('Order opened.', { exact: false })).toBeVisible();
  await page
    .getByLabel('Item', { exact: true })
    .selectOption({ label: 'Tusker lager · TUS-500 (bottle)' });
  await page.getByLabel('Quantity').fill('2');
  await page.getByRole('button', { name: 'Add line' }).click();
  await expect(page.getByText('Line added.')).toBeVisible();
  const order = page
    .url()
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]!;
  await page.getByRole('button', { name: 'Send order' }).click();
  await expect(page.getByText('Order sent.', { exact: false })).toBeVisible();

  await sweep(page, [
    '/onboarding',
    home,
    `${home}/admin`,
    `${home}/admin/staff`,
    `${home}/admin/roles`,
    managerRoles,
    `${home}/admin/settings`,
    `${home}/admin/audit`,
    `${home}/customers`,
    `${home}/customers/new`,
    customer,
    `${home}/bookings?day=2030-01-14`,
    `${home}/bookings/new?day=2030-01-14&resource=${resource.split('/').pop()}`,
    reservation,
    `${home}/bookings/resources`,
    resource,
    `${home}/invoices`,
    `${home}/invoices/new`,
    `${home}/invoices/new?kind=quote`,
    invoice,
    draft,
    `${draft}/edit`,
    `${home}/inventory`,
    `${home}/inventory/low`,
    `${home}/inventory/items/new`,
    item,
    `${home}/inventory/suppliers`,
    supplier,
    `${home}/inventory/locations`,
    `${home}/inventory/purchases`,
    `${home}/inventory/purchases/new`,
    purchase,
    `${home}/inventory/movements`,
    `${home}/inventory/adjust`,
    `${home}/inventory/transfer`,
    `${home}/orders`,
    `${home}/orders/new`,
    order,
    `${home}/reports`,
    `${home}/reports?from=2030-01-01&to=2030-01-31`,
  ]);
});
