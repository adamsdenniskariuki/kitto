import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PAGES, expectNoSideScroll, useTheme, waitForDiagrams } from './helpers';

/**
 * WCAG 2.1 A/AA with axe-core on every page at 360 px, in light and dark,
 * plus a check that nothing scrolls sideways.
 */
for (const theme of ['light', 'dark'] as const) {
  for (const path of PAGES) {
    test(`a11y: ${path} at 360px, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await useTheme(page, theme);
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if ((await page.locator('.mermaid[data-source]').count()) > 0) await waitForDiagrams(page);

      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        violations.map(
          (v) =>
            `${v.id} (${v.impact}): ${v.nodes
              .slice(0, 5)
              .map((n) => n.target.join(' '))
              .join(' | ')}`,
        ),
      ).toEqual([]);
      await expectNoSideScroll(page);
    });
  }
}
