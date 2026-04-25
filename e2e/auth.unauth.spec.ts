import { test, expect } from "@playwright/test";

/**
 * Phase 1 BDD: Authentication
 *
 * Tests that unauthenticated users are redirected to Clerk sign-in
 * and that the Worker API rejects unauthenticated requests.
 */
test.describe("Unauthenticated access", () => {
  test("shows sign-in gate on /", async ({ page }) => {
    await page.goto("/");
    // ClerkAuthGate shows "RECRUITER ACCESS" with a SIGN IN button
    const signInButton = page.locator('button:has-text("SIGN IN")');
    await expect(signInButton).toBeVisible({ timeout: 15000 });
  });

  test("shows sign-in gate on /pipeline/new", async ({ page }) => {
    await page.goto("/pipeline/new");
    const signInButton = page.locator('button:has-text("SIGN IN")');
    await expect(signInButton).toBeVisible({ timeout: 15000 });
  });

  test("Worker API returns 401 without auth header", async ({ request }) => {
    const response = await request.get("http://localhost:8787/api/v1/pipelines");
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});
