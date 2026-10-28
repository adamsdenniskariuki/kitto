import { defineConfig } from 'vitest/config';

// Unit tests only; the Playwright specs in e2e/ and screenshots/ run separately.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
