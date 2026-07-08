import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test as setup, expect, type Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const authFile = path.join(__dirname, "../playwright/.auth/user.json");
const AUTH_GATE_TIMEOUT_MS = 45_000;

interface StorageStateCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
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

/**
 * Authenticate via Clerk sign-in using testing tokens.
 * @clerk/testing bypasses bot detection and device verification.
 */
setup("authenticate via Clerk", async ({ page }) => {
  setup.setTimeout(120000);

  // Inject Clerk testing token to bypass verification
  await setupClerkTestingToken({ page });

  await page.goto("/", { waitUntil: "domcontentloaded" });

  if (await getSessionCookie(page)) {
    await page.context().storageState({ path: authFile });
    return;
  }

  if (hasUsableSessionCookie()) {
    await page.context().storageState({ path: authFile });
    return;
  }

  // Step 1: Click the SIGN IN button on the custom gate
  const signInButton = page.getByTestId("auth-gate-sign-in");
  const alreadySignedIn = page.getByRole("button", { name: /sign out/i });
  const recruiterShell = page.getByRole("button", { name: /new interview/i }).first();
  const visibleState = async (locator: ReturnType<Page["locator"]>, state: string): Promise<string> => {
    await locator.waitFor({ state: "visible", timeout: AUTH_GATE_TIMEOUT_MS });
    return state;
  };
  const authState = await Promise.race([
    visibleState(signInButton, "auth-gate").catch(() => "missing"),
    visibleState(alreadySignedIn, "signed-in").catch(() => "missing"),
    visibleState(recruiterShell, "signed-in").catch(() => "missing"),
  ]);

  if (authState === "signed-in") {
    await page.context().storageState({ path: authFile });
    return;
  }

  await expect(signInButton).toBeVisible({ timeout: AUTH_GATE_TIMEOUT_MS });
  try {
    await signInButton.click({ timeout: 5_000 });
  } catch {
    // Fallback when overlays/animation keep the button from behaving like a normal click.
    await signInButton.dispatchEvent("click");
  }

  // Step 2: Clerk modal opens — fill email
  const emailInput = page.locator('input[name="identifier"]');
  await expect(emailInput).toBeVisible({ timeout: 15_000 });
  const email = process.env.E2E_EMAIL?.trim() || "e2e-test@pipe.dev";
  await emailInput.fill(email);

  // Step 3: Click continue
  await page.locator('button:has-text("Continue")').click();

  // Step 4: Fill password
  const passwordInput = page.locator('input[name="password"]');
  await expect(passwordInput).toBeVisible({ timeout: 10000 });
  const password = process.env.E2E_PASSWORD?.trim() || "PipeE2E_Test2026!";
  await passwordInput.fill(password);

  // Step 5: Submit
  await page.locator('button:has-text("Continue")').click();

  // Step 6: Wait for the auth artifact every authenticated test actually uses.
  await waitForSessionCookie(page, 30_000);

  // Save storage state
  await page.context().storageState({ path: authFile });
});
