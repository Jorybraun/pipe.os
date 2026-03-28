import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test as setup, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const authFile = path.join(__dirname, "../playwright/.auth/user.json");

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
  const signInButton = page.locator('button:has-text("SIGN IN")');
  await expect(signInButton).toBeVisible({ timeout: 15000 });
  await signInButton.click();

  // Step 2: Clerk modal opens — fill email
  const emailInput = page.locator('input[name="identifier"]');
  await expect(emailInput).toBeVisible({ timeout: 15000 });
  await emailInput.fill(process.env.E2E_EMAIL ?? "e2e-test@pipe.dev");

  // Step 3: Click continue
  await page.locator('button:has-text("Continue")').click();

  // Step 4: Fill password
  const passwordInput = page.locator('input[name="password"]');
  await expect(passwordInput).toBeVisible({ timeout: 10000 });
  await passwordInput.fill(process.env.E2E_PASSWORD ?? "PipeE2E_Test2026!");

  // Step 5: Submit
  await page.locator('button:has-text("Continue")').click();

  // Step 6: Wait for app shell
  await expect(
    page
      .locator('text=CREATE NEW PIPE')
      .or(page.locator('text=SIGN OUT'))
      .first()
  ).toBeVisible({ timeout: 30000 });

  // Save storage state
  await page.context().storageState({ path: authFile });
});
