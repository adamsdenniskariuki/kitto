import type { Page } from '@playwright/test';

export const DOC_PAGES = [
  { path: '/docs/overview/', title: 'Kitto' },
  { path: '/docs/setup/', title: /setup/i },
  { path: '/docs/tutorial/', title: /tutorial/i },
  { path: '/docs/architecture/', title: /architecture/i },
  { path: '/docs/learning/', title: /learning/i },
] as const;

export const PAGES = ['/', '/docs/', ...DOC_PAGES.map((d) => d.path)];

/** Fails the test on uncaught errors or console errors. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

/** Sets the stored theme before any page script runs. */
export async function useTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((value) => localStorage.setItem('kitto-theme', value), theme);
}

/** The page must not scroll sideways (the 360 px check). */
export async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 1) throw new Error(`Page scrolls sideways by ${overflow}px on ${page.url()}`);
}

/** Waits for every mermaid block on the page to be drawn, and fails if any could not be. */
export async function waitForDiagrams(page: Page) {
  const blocks = page.locator('.mermaid[data-source]');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.mermaid[data-source]')].every((el) =>
        el.hasAttribute('data-rendered'),
      ),
    null,
    { timeout: 20_000 },
  );
  const failed = await blocks.evaluateAll((els) =>
    els
      .filter((el) => el.getAttribute('data-rendered') === 'error' || !el.querySelector('svg'))
      .map((el) => el.getAttribute('data-label')),
  );
  if (failed.length > 0) throw new Error(`Diagrams failed to render: ${failed.join(', ')}`);
}
