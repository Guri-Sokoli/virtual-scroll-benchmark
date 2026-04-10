import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the virtual-scroll benchmark suite.
 *
 * Key design choices:
 * - Uses Chrome DevTools Protocol (CDP) for CPU throttling so that
 *   algorithmic differences become visible even on fast hardware.
 * - V-Sync limiting flags are REMOVED — we measure *real* frame timing
 *   rather than raw FPS counts, so disabling V-Sync is unnecessary.
 * - Single Chromium project for reproducibility.
 */
export default defineConfig({
  testDir: './tools/benchmark/tests',
  timeout: 600_000, // 10 min per test (full runs can be long)
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run start:benchmark:stable',
    url: 'http://localhost:4200',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
