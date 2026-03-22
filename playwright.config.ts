import { defineConfig, devices } from "@playwright/test";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load environment variables from .env.local
 */
dotenv.config({ path: path.resolve(__dirname, ".env.local") });

/**
 * Path to store the authenticated storage state
 */
export const STORAGE_STATE = path.join(__dirname, "playwright/.auth/user.json");

/**
 * Playwright configuration for E2E tests
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./e2e",

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : undefined,

  // Reporter to use
  reporter: "html",

  // Shared settings for all the projects below
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL: "http://localhost:5174",

    // Collect trace when retrying the failed test
    trace: "on-first-retry",

    // Screenshot on failure
    screenshot: "only-on-failure",
  },

  // Configure projects for major browsers
  projects: [
    // Setup project
    {
      name: "auth_setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Use prepared auth state
        storageState: STORAGE_STATE,
      },
      dependencies: ["auth_setup"],
    },

    // {
    //   name: 'firefox',
    //   use: {
    //     ...devices['Desktop Firefox'],
    //     storageState: STORAGE_STATE,
    //   },
    //   dependencies: ['setup'],
    // },

    // {
    //   name: 'webkit',
    //   use: {
    //     ...devices['Desktop Safari'],
    //     storageState: STORAGE_STATE,
    //   },
    //   dependencies: ['setup'],
    // },
  ],

  // Run your local dev server before starting the tests
  webServer: {
    command: "npm run dev -- --port 5174",
    url: "http://localhost:5174",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
