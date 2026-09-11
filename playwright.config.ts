import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright E2E test configuration.
 * Tests live in tests/e2e/ and tests/private-games/ and require the Next.js dev server running on port 3000.
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./tests",
  /* e2e specs live in tests/e2e/ plus tests/private-games/ (excludable namespace) */
  testMatch: "**/*.spec.ts",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use */
  reporter: "html",
  use: {
    /* Base URL so tests can use relative paths like page.goto('/sign-in') */
    baseURL: "http://localhost:3000",
    /* Collect trace when retrying the failed test */
    trace: "on-first-retry",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  /* Run the Next.js dev server before starting the tests */
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
})
