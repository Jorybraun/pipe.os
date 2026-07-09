import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { test as setup, expect, type Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const authFile = path.join(__dirname, "../playwright/.auth/user.json");
const AUTH_GATE_TIMEOUT_MS = 45_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;

interface StorageStateCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
}

type AuthSurface = "signed-in" | "signed-out";

function authStatusFromContext(page: Page): {
  signOut: { count: () => Promise<number> };
  signIn: { count: () => Promise<number> };
  recruiterShell: { count: () => Promise<number> };
} {
  return {
    signOut: page.getByRole("button", { name: /sign out/i }),
    signIn: page.getByTestId("auth-gate-sign-in"),
    recruiterShell: page.getByRole("button", { name: /new interview/i }).first(),
  };
}

async function waitForAuthSurface(page: Page, timeoutMs: number): Promise<AuthSurface> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { signOut, signIn, recruiterShell } = authStatusFromContext(page);
    if ((await signOut.count()) > 0 || (await recruiterShell.count()) > 0) {
      return "signed-in";
    }
    if (await signIn.count() > 0) {
      return "signed-out";
    }
    await page.waitForTimeout(250);
  }
  return "signed-out";
}

async function ensureAuthenticatedUi(page: Page): Promise<void> {
  const status = await waitForAuthSurface(page, AUTH_CHECK_TIMEOUT_MS);
  if (status === "signed-in") {
    return;
  }

  try {
    await signInWithClerkTestingEmail(page);
  } catch {
    // The helper may throw if already authenticated (e.g. stale cookies restored).
    const postSignInStatus = await waitForAuthSurface(page, AUTH_CHECK_TIMEOUT_MS / 2);
    if (postSignInStatus === "signed-in") {
      return;
    }

    const signInButton = page.getByRole("button", { name: /sign in/i }).or(page.getByTestId("auth-gate-sign-in"));
    await expect(signInButton).toBeVisible({ timeout: AUTH_GATE_TIMEOUT_MS });
    try {
      await signInButton.click({ timeout: 5_000 });
    } catch {
      await signInButton.dispatchEvent("click");
    }

    const emailInput = page.locator('input[name="identifier"]');
    await expect(emailInput).toBeVisible({ timeout: 15_000 });
    const email = process.env.E2E_EMAIL?.trim() || "e2e-test@pipe.dev";
    await emailInput.fill(email);
    await page.locator('button:has-text("Continue")').click();

    const password = process.env.E2E_PASSWORD?.trim() || "PipeE2E_Test2026!";
    const passwordInput = page.locator('input[name="password"]');
    await expect(passwordInput).toBeVisible({ timeout: 10_000 });
    await passwordInput.fill(password);
    await page.locator('button:has-text("Continue")').click();
  }

  const finalStatus = await waitForAuthSurface(page, AUTH_CHECK_TIMEOUT_MS);
  if (finalStatus !== "signed-in") {
    throw new Error("[auth.setup] Clerk session is not active after sign-in attempt.");
  }
}

function hasUsableSessionCookie(): boolean {
  if (!fs.existsSync(authFile)) {
    return false;
  }

  try {
    const state = JSON.parse(fs.readFileSync(authFile, "utf-8")) as {
      cookies?: StorageStateCookie[];
    };
    const session = state.cookies?.find((cookie) => cookie.name === "__session" && cookie.value.length > 0);
    if (!session) return false;

    if (typeof session.expires === "number" && session.expires > 0) {
      const now = Date.now() / 1000;
      if (session.expires < now) {
        return false;
      }
    }

    return true;
  } catch (error) {
    console.warn("[auth.setup] Could not read existing auth fixture:", error);
    return false;
  }
}

async function getSessionCookie(page: Page): Promise<string | null> {
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === "__session" && cookie.value.length > 0);
  return sessionCookie?.value ?? null;
}

async function waitForSessionCookie(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sessionCookie = await getSessionCookie(page);
    if (sessionCookie) {
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("[auth.setup] Clerk session cookie was not issued after sign-in.");
}

async function signInWithClerkTestingEmail(page: Page): Promise<void> {
  const email = process.env.E2E_EMAIL?.trim() || "e2e-test@pipe.dev";
  await clerk.signIn({
    page,
    emailAddress: email,
    setupClerkTestingTokenOptions: {
      debug: process.env.NODE_ENV === "development",
    },
  });
}

/**
 * Authenticate via Clerk sign-in using testing tokens.
 * @clerk/testing bypasses bot detection and device verification.
 */
setup("authenticate via Clerk", async ({ page }) => {
  setup.setTimeout(120000);

  // Inject Clerk testing token to bypass verification
  await setupClerkTestingToken({ page });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("domcontentloaded");

  const currentStatus = await waitForAuthSurface(page, AUTH_CHECK_TIMEOUT_MS);
  if (currentStatus === "signed-in") {
    await page.context().storageState({ path: authFile });
    return;
  }

  if (hasUsableSessionCookie()) {
    try {
      const state = JSON.parse(fs.readFileSync(authFile, "utf-8")) as {
        cookies?: StorageStateCookie[];
      };
      if (state.cookies?.length) {
        await page.context().addCookies(state.cookies);
        await page.waitForTimeout(500);
      }
      const restoredStatus = await waitForAuthSurface(page, AUTH_CHECK_TIMEOUT_MS);
      if (restoredStatus === "signed-in") {
        await page.context().storageState({ path: authFile });
        return;
      }
    } catch (error) {
      console.warn("[auth.setup] Failed to restore auth fixture:", error);
    }
  }

  await ensureAuthenticatedUi(page);

  // Step 6: Wait for the auth artifact every authenticated test actually uses.
  await waitForSessionCookie(page, 30_000);

  // Save storage state
  await page.context().storageState({ path: authFile });
});
