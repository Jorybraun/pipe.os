import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test as setup, expect, type Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const authFile = path.join(__dirname, "../playwright/.auth/user.json");
const AUTH_GATE_TIMEOUT_MS = 45_000;

async function waitForSessionCookie(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cookies = await page.context().cookies();
    if (cookies.some((cookie) => cookie.name === "__session" && cookie.value.length > 0)) {
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
  setup.setTimeout(60000);

  // Inject Clerk testing token to bypass verification
  await setupClerkTestingToken({ page });

  await page.goto("/");

  // Step 1: Click the SIGN IN button on the custom gate
  const signInButton = page.getByTestId("auth-gate-sign-in");
  await expect(signInButton).toBeVisible({ timeout: AUTH_GATE_TIMEOUT_MS });
  await signInButton.click();

  // Step 2: Clerk modal opens — fill email
  const emailInput = page.locator('input[name="identifier"]');
  await expect(emailInput).toBeVisible({ timeout: 15000 });
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
