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

test('workspace and admin pages are accessible', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the sweep sets its own viewport sizes');
  test.setTimeout(180_000);
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

  await sweep(page, [
    '/onboarding',
    home,
    `${home}/admin`,
    `${home}/admin/staff`,
    `${home}/admin/roles`,
    managerRoles,
    `${home}/admin/settings`,
    `${home}/admin/audit`,
  ]);
});
