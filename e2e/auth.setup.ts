import { test as setup, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const authFile = path.join(__dirname, "../playwright/.auth/user.json");

/**
 * Authenticate via Clerk sign-in.
 * Saves session state so authenticated tests reuse the session.
 */
setup("authenticate via Clerk", async ({ page }) => {
  setup.setTimeout(60000);

  await page.goto("/");

  // Clerk renders a sign-in modal/page when unauthenticated
  // Wait for the Clerk sign-in form to appear
  await page.waitForSelector('input[name="identifier"]', { timeout: 15000 });

  // Fill email
  await page.locator('input[name="identifier"]').fill(
    process.env.E2E_EMAIL ?? "braunjory@gmail.com"
  );

  // Click continue
  await page.locator('button:has-text("Continue")').click();

  // Wait for password field
  await page.waitForSelector('input[name="password"]', { timeout: 10000 });

  // Fill password
  await page.locator('input[name="password"]').fill(
    process.env.E2E_PASSWORD ?? "Wrx7UB35t$"
  );

  // Click continue to sign in
  await page.locator('button:has-text("Continue")').click();

  // Wait for auth to complete — look for app shell indicators
  await expect(
    page
      .locator('text=CREATE NEW PIPE')
      .or(page.locator('text=SIGN OUT'))
      .or(page.locator('text=PIPE_OS'))
      .first()
  ).toBeVisible({ timeout: 30000 });

  // Save storage state
  await page.context().storageState({ path: authFile });
});
