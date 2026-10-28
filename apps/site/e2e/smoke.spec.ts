import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { DOC_PAGES, PAGES, trackErrors, waitForDiagrams } from './helpers';

const REPO = 'https://github.com/adamsdenniskariuki/kitto';

test('landing page shows the key sections', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page).toHaveTitle(/Kitto/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('blocks');

  for (const name of [
    'One framework, many businesses',
    'Eleven packages, two kinds',
    'Need something new? Generate it.',
    'The rules live in the database',
    'Run it locally in minutes',
  ]) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }

  const useCases = page.locator('#use-cases');
  for (const name of [/Hotel/, /Car dealership/, /Garage/]) {
    await expect(useCases.getByRole('heading', { level: 3, name })).toBeVisible();
  }

  const modules = page.locator('#modules');
  for (const name of [
    'core',
    'auth',
    'ui',
    'admin',
    'customers',
    'booking',
    'billing',
    'mpesa',
    'inventory',
    'orders',
    'reports',
  ]) {
    await expect(modules.getByRole('heading', { level: 4, name: `@kitto/${name}` })).toBeVisible();
  }

  await expect(page.locator('#generator')).toContainText('pnpm create-kitto-module');
  await expect(page.locator('#architecture figure')).toContainText('Supabase');

  // The live demo is not deployed yet: a note, never a link.
  await expect(page.getByText('Live demo: coming soon')).toBeVisible();
  await expect(page.getByRole('link', { name: /demo/i })).toHaveCount(0);

  await expect(page.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute('href', REPO);
  await expect(
    page
      .getByRole('contentinfo')
      .getByRole('link', { name: /madebyfavor/i })
      .first(),
  ).toHaveAttribute('href', 'https://madebyfavor.com');

  expect(errors).toEqual([]);
});

for (const doc of DOC_PAGES) {
  test(`doc page ${doc.path} renders`, async ({ page }) => {
    const errors = trackErrors(page);
    const response = await page.goto(doc.path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(doc.title);
    await expect(page.locator('.prose h2').first()).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Docs' }).locator('[aria-current="page"]'),
    ).toHaveAttribute('href', doc.path);
    if ((await page.locator('.mermaid[data-source]').count()) > 0) await waitForDiagrams(page);
    expect(errors).toEqual([]);
  });
}

test('mermaid diagrams render as labelled SVG and follow the theme', async ({ page }) => {
  const errors = trackErrors(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/docs/architecture/');
  await waitForDiagrams(page);

  const first = page.locator('.mermaid[data-source]').first();
  await expect(first).toHaveAttribute('role', 'img');
  await expect(first).toHaveAttribute('aria-label', /^Diagram: /);
  await expect(first).toHaveAttribute('data-rendered', 'light');
  await expect(first.locator('svg')).toBeVisible();

  await page.getByRole('button', { name: 'Dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(first).toHaveAttribute('data-rendered', 'dark');
  await expect(first.locator('svg')).toBeVisible();
  expect(errors).toEqual([]);
});

test('theme choice persists across pages without a flash', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Dark mode' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/docs/setup/', { waitUntil: 'commit' });
  // The inline head script sets the theme before first paint.
  await page.waitForSelector('html[data-theme="dark"]', { state: 'attached' });
  await expect(page.getByRole('button', { name: 'Dark mode' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('dark system preference is respected', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('desktop navigation reaches the docs', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('link', { name: 'Docs' }).click();
  await expect(page).toHaveURL(/\/docs\/$/);
  await expect(nav.getByRole('link', { name: 'Docs' })).toHaveAttribute('aria-current', 'page');

  await page
    .getByRole('link', { name: /Tutorial/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/docs\/tutorial\/$/);
  await page
    .getByRole('navigation', { name: 'Previous and next' })
    .getByRole('link', { name: /Architecture/ })
    .click();
  await expect(page).toHaveURL(/\/docs\/architecture\/$/);
});

test('mobile menu opens, closes and navigates', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Menu' });
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link', { name: 'Docs' })).toBeHidden();

  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(nav.getByRole('link', { name: 'Docs' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(nav.getByRole('link', { name: 'Docs' })).toBeHidden();

  await menu.click();
  await nav.getByRole('link', { name: 'Tutorial' }).click();
  await expect(page).toHaveURL(/\/docs\/tutorial\/$/);
});

test('skip link moves focus to the main content', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await skip.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();
});

test('every internal link and anchor resolves', async ({ page, request }) => {
  const checked = new Map<string, Set<string>>();
  for (const path of PAGES) {
    await page.goto(path);
    const hrefs = await page
      .locator('a[href]')
      .evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href));
    for (const href of hrefs) {
      const url = new URL(href);
      if (url.origin !== new URL(page.url()).origin) continue;
      const anchors = checked.get(url.pathname) ?? new Set<string>();
      if (url.hash) anchors.add(decodeURIComponent(url.hash.slice(1)));
      checked.set(url.pathname, anchors);
    }
  }

  const broken: string[] = [];
  for (const [pathname, anchors] of checked) {
    const response = await request.get(pathname);
    if (!response.ok()) {
      broken.push(`${pathname} -> ${response.status()}`);
      continue;
    }
    const html = await response.text();
    for (const anchor of anchors) {
      if (!html.includes(`id="${anchor}"`)) broken.push(`${pathname}#${anchor}`);
    }
  }
  expect(broken).toEqual([]);
  expect(checked.size).toBeGreaterThanOrEqual(PAGES.length);
});

test('unknown pages get the 404 page', async ({ request }) => {
  const response = await request.get('/no-such-page/');
  expect(response.status()).toBe(404);
  expect(await response.text()).toContain('Page not found');
});

test('the build includes the custom domain CNAME', () => {
  const cname = readFileSync(join(import.meta.dirname, '..', 'dist', 'CNAME'), 'utf8');
  expect(cname.trim()).toBe('kitto.madebyfavor.com');
});
