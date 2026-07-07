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
const videoRoomBase = process.env.VIDEO_ROOM_BASE || "http://localhost:5175";
const isRemote = !appBase.includes("localhost") || !apiBase.includes("localhost") || !videoRoomBase.includes("localhost");
const basicAuthUser = process.env.PIPE_APP_DEV_BASIC_AUTH_USER
  || process.env.APP_DEV_BASIC_AUTH_USER
  || process.env.PIPE_DEV_BASIC_AUTH_USER
  || process.env.DEV_BASIC_AUTH_USER
  || "";
const basicAuthPassword = process.env.PIPE_APP_DEV_BASIC_AUTH_PASSWORD
  || process.env.APP_DEV_BASIC_AUTH_PASSWORD
  || process.env.PIPE_DEV_BASIC_AUTH_PASSWORD
  || process.env.DEV_BASIC_AUTH_PASSWORD
  || "";

function localPort(baseUrl: string, fallback: string): string {
  try {
    return new URL(baseUrl).port || fallback;
  } catch {
    return fallback;
  }
}

const appPort = localPort(appBase, "5173");
const apiPort = localPort(apiBase, "8787");
const videoRoomPort = localPort(videoRoomBase, "5175");

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
    ...(isRemote && basicAuthUser && basicAuthPassword
      ? { httpCredentials: { username: basicAuthUser, password: basicAuthPassword } }
      : {}),
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
            command: `cd workers/api && npx wrangler dev --port ${apiPort} --enable-containers=false`,
            url: `${apiBase}/api/health`,
            reuseExistingServer: true,
            timeout: 120000,
          },
          {
            command: `VITE_API_URL=${apiBase} VITE_API_BASE_URL=${apiBase} npm run dev -- --port ${appPort}`,
            url: appBase,
            reuseExistingServer: true,
            timeout: 60000,
          },
          {
            command: `cd apps/video-room && VITE_API_BASE_URL=${apiBase} npm run dev -- --host 127.0.0.1 --port ${videoRoomPort}`,
            url: videoRoomBase,
            reuseExistingServer: true,
            timeout: 60000,
          },
        ],
      }),
});
