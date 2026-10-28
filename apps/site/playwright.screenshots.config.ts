import { defineConfig, devices } from '@playwright/test';

/**
 * Captures the demo app screenshots shown on the landing page. Run by hand,
 * never in CI: it needs the local Supabase stack and a built demo app. See
 * README.md ("Screenshots").
 */
const PORT = 3000;

export default defineConfig({
  testDir: './screenshots',
  workers: 1,
  reporter: 'list',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    // Must match site_url in supabase/config.toml so magic links land on this server.
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  },
  webServer: {
    command: 'pnpm --filter @kitto/demo start',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      MPESA_ENV: 'mock',
      MPESA_CALLBACK_BASE_URL: `http://localhost:${PORT}`,
    },
  },
});
