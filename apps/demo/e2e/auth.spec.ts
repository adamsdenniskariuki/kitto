import { expect, test } from '@playwright/test';
import { createWorkspace, signIn, uniqueEmail, uniqueSlug } from './helpers';

test('signed-out visitors are sent to sign in, then back where they were going', async ({
  page,
}) => {
  await page.goto('/t/somewhere/admin');
  await expect(page).toHaveURL(/\/login\?next=%2Ft%2Fsomewhere%2Fadmin$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('a bad sign-in link shows a friendly error', async ({ page }) => {
  await page.goto('/auth/confirm?token_hash=nope&type=email');
  await expect(page).toHaveURL(/\/login\?error=link$/);
  await expect(page.getByText('invalid or has expired')).toBeVisible();
});

test('sign up, create a workspace, sign out and back in', async ({ page }) => {
  const email = uniqueEmail('owner');
  const slug = uniqueSlug('acme');
  const home = await createWorkspace(page, email, 'Acme Hotel', slug);

  // Home "/" returns a signed-in user to their workspace.
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`${home}$`));
  await expect(page.getByText('Your role', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await page.goto(home);
  await expect(page).toHaveURL(/\/login\?next=/);

  await signIn(page, email, home);
  await expect(page).toHaveURL(new RegExp(`${home}$`));
});

test('workspace addresses are unique', async ({ page }) => {
  const slug = uniqueSlug('dup');
  await createWorkspace(page, uniqueEmail('first'), 'First', slug);
  await page.goto('/onboarding');
  await page.getByLabel('Business name').fill('Second');
  await page.getByLabel('Web address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByText(/already taken|already exists/i)).toBeVisible();
});
