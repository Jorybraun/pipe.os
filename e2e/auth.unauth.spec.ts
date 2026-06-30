import { test, expect } from "@playwright/test";
import { API_BASE, IS_REMOTE } from './env';

const AUTH_GATE_TIMEOUT_MS = 45_000;

/**
 * Phase 1 BDD: Authentication
 *
 * Tests that unauthenticated users are redirected to Clerk sign-in
 * and that deployed Worker API rejects unauthenticated requests.
 */
test.describe("Unauthenticated access", () => {
  test("shows sign-in gate on /", async ({ page }) => {
    await page.goto("/");
    const signInButton = page.getByTestId("auth-gate-sign-in");
    await expect(signInButton).toBeVisible({ timeout: AUTH_GATE_TIMEOUT_MS });
  });

  test("shows sign-in gate on /pipeline/new", async ({ page }) => {
    await page.goto("/pipeline/new");
    const signInButton = page.getByTestId("auth-gate-sign-in");
    await expect(signInButton).toBeVisible({ timeout: AUTH_GATE_TIMEOUT_MS });
  });

  test("Worker API returns 401 without auth header on non-bypass deployments", async ({ request }) => {
    test.skip(!IS_REMOTE, 'Local Worker dev intentionally enables DEV_AUTH_BYPASS in .dev.vars.');

    const response = await request.get(`${API_BASE}/api/v1/pipelines`);
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});
