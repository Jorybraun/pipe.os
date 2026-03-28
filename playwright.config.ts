import { defineConfig, devices } from "@playwright/test";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, ".env.local") });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  timeout: 30_000,

  use: {
    baseURL: "http://localhost:5173",
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
      testIgnore: /\.unauth\.spec\.ts/,
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

  webServer: [
    {
      command: "cd workers/api && npx wrangler dev --port 8787",
      url: "http://localhost:8787/health",
      reuseExistingServer: true,
      timeout: 120000,
      stdout: "pipe",
    },
    {
      command: "curl -sf http://localhost:5173 >/dev/null 2>&1 || npm run dev -- --port 5173",
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 60000,
    },
  ],
});
