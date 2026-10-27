import { expect, test, type Browser } from '@playwright/test';
import {
  createWorkspace,
  expectNoSideScroll,
  magicLinkFor,
  uniqueEmail,
  uniqueSlug,
} from './helpers';

async function freshPage(browser: Browser) {
  const context = await browser.newContext();
  return context.newPage();
}

test('owner invites staff; staff join with the right role and no admin access', async ({
  page,
  browser,
}) => {
  const slug = uniqueSlug('hotel');
  const home = await createWorkspace(page, uniqueEmail('owner'), 'Lakeside Hotel', slug);

  // Invite a front-desk member.
  const staffEmail = uniqueEmail('staff');
  await page.goto(`${home}/admin/staff`);
  await expect(page.getByRole('heading', { level: 1, name: 'Staff' })).toBeVisible();
  await expectNoSideScroll(page);
  const sentAt = new Date(Date.now() - 1000);
  await page.getByLabel('Email').fill(staffEmail);
  await page.getByLabel('Role', { exact: true }).selectOption({ label: 'Front desk' });
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('Invitation sent.')).toBeVisible();
  await expect(page.getByRole('rowheader', { name: staffEmail })).toBeVisible();

  // The invitee follows the email link, which signs them in and lands on the invitation.
  const staff = await freshPage(browser);
  await staff.goto(await magicLinkFor(staffEmail, sentAt));
  await expect(staff.getByRole('heading', { name: "You're invited" })).toBeVisible();
  await staff.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(staff).toHaveURL(new RegExp(`${home}$`));
  await expect(staff.getByText('Your role is Front desk.')).toBeVisible();

  // Front desk has no admin permissions: no Admin link, and the pages 404.
  await expect(staff.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  for (const path of [
    '/admin',
    '/admin/staff',
    '/admin/roles',
    '/admin/settings',
    '/admin/audit',
  ]) {
    const res = await staff.goto(`${home}${path}`);
    expect(res?.status(), path).toBe(404);
  }

  // The owner now sees the new member, and the audit log recorded the join.
  await page.reload();
  await expect(page.getByRole('rowheader', { name: new RegExp(staffEmail) })).toBeVisible();
  await page.goto(`${home}/admin/audit?table=tenant_members`);
  await expect(page.getByText(`by ${staffEmail}`).first()).toBeVisible();
  await staff.context().close();
});

test('people outside a workspace get a 404, not its data', async ({ page, browser }) => {
  const home = await createWorkspace(
    page,
    uniqueEmail('owner'),
    'Private Co',
    uniqueSlug('private'),
  );

  const outsider = await freshPage(browser);
  await createWorkspace(outsider, uniqueEmail('other'), 'Other Co', uniqueSlug('other'));
  for (const path of ['', '/admin', '/admin/staff', '/admin/audit']) {
    const res = await outsider.goto(`${home}${path}`);
    expect(res?.status(), path || '/').toBe(404);
    await expect(outsider.getByText('Private Co')).toHaveCount(0);
  }
  await outsider.context().close();
});

test('the last owner cannot demote themselves', async ({ page }) => {
  const email = uniqueEmail('owner');
  const home = await createWorkspace(page, email, 'Solo Shop', uniqueSlug('solo'));
  await page.goto(`${home}/admin/staff`);
  await page.getByLabel(`Role for ${email}`).selectOption({ label: 'Viewer' });
  await page
    .getByRole('row', { name: new RegExp(email) })
    .getByRole('button', { name: 'Save' })
    .click();
  await expect(page.getByText(/at least one active owner/i)).toBeVisible();
  await expect(page.getByLabel(`Role for ${email}`)).toHaveValue(/.+/);
  await page.goto(`${home}/admin`);
  await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
});

test('custom roles and settings', async ({ page }) => {
  const home = await createWorkspace(page, uniqueEmail('owner'), 'Auto Yard', uniqueSlug('auto'));

  await page.goto(`${home}/admin/roles`);
  await page.getByLabel('Name').fill('Night auditor');
  await page.getByLabel('Key').fill('night_auditor');
  await page.getByRole('button', { name: 'Create role' }).click();
  await expect(page.getByText('Role created.')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Night auditor/ })).toBeVisible();
  await page.getByRole('checkbox', { name: /audit\.view/ }).check();
  await page.getByRole('button', { name: 'Save permissions' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /audit\.view/ })).toBeChecked();

  await page.goto(`${home}/admin/settings`);
  await page.getByLabel('Business name').fill('Auto Yard Ltd');
  await page.getByLabel('Theme').selectOption({ label: 'Forest' });
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(page.getByLabel('Business name')).toHaveValue('Auto Yard Ltd');

  await page.goto(`${home}/admin/audit?table=tenants`);
  const entry = page.getByRole('main').locator('details').first();
  await expect(async () => {
    if ((await entry.getAttribute('open')) === null) await entry.locator('summary').click();
    await expect(entry.getByRole('cell', { name: 'Auto Yard Ltd' })).toBeVisible({
      timeout: 1_000,
    });
  }).toPass();
});
