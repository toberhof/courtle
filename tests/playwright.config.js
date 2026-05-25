import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  fullyParallel: false, // Run sequentially to avoid SQLite write locking
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0, // No retries locally to fail faster
  workers: 1, // Single worker since SQLite is a file-based DB
  reporter: 'html',
  timeout: 15 * 1000, // 15 seconds max per test (default is 30s)
  expect: {
    timeout: 5 * 1000, // 5 seconds max for individual assertions
  },
  use: {
    baseURL: 'http://127.0.0.1:8081',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 5000, // 5 seconds limit for clicks/fills (default 30s)
    navigationTimeout: 5000, // 5 seconds limit for page transitions (default 30s)
    locale: 'de-DE', // Force German locale to align with test assertions
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['iPhone 14'] }, // Test iOS mobile layout
    },
    {
      name: 'galaxy-s24',
      use: { ...devices['Galaxy S24'] }, // Test Android mobile layout
    },
  ],

  // Automatically spin up the isolated Docker test container before running E2E tests
  webServer: {
    command: 'docker compose -f ../docker-compose.test.yml up --build',
    url: 'http://127.0.0.1:8081',
    reuseExistingServer: false,
    timeout: 120 * 1000, // 2 minutes to allow image build if needed
  },
});
