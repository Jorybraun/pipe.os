import { defineConfig, devices } from "@playwright/test";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, ".env.local") });
dotenv.config({ path: path.resolve(__dirname, ".env") });

const appBase = process.env.APP_BASE || "http://localhost:5173";
const apiBase = process.env.API_BASE || "http://localhost:8787";
const isRemote = !appBase.includes("localhost");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  timeout: 30_000,
  globalSetup: "./e2e/global.setup.ts",

  use: {
    baseURL: appBase,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
  },

  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "authenticated",
      testIgnore: /\.(unauth|global)\..*\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: path.join(__dirname, "playwright/.auth/user.json"),
      },
      dependencies: ["setup"],
    },
    {
      name: "unauthenticated",
      testMatch: /\.unauth\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: { cookies: [], origins: [] },
      },
    },
  ],

  // Skip local webServer startup when running against a remote deployment
  ...(isRemote
    ? {}
    : {
        webServer: [
          {
            command: "cd workers/api && npx wrangler dev --port 8787",
            url: `${apiBase}/health`,
            reuseExistingServer: true,
            timeout: 120000,
          },
          {
            command: "npm run dev -- --port 5173",
            url: appBase,
            reuseExistingServer: true,
            timeout: 60000,
          },
        ],
      }),
});
