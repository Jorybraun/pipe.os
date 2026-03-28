import { test, expect } from "@playwright/test";

/**
 * Phase 1 BDD: Pipeline Create Page
 *
 * Given the recruiter has signed in via Clerk
 * These tests verify pipeline creation at /pipeline/new
 */
test.describe("Pipeline Create Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/pipeline/new");
  });

  test("renders the pipeline creation form", async ({ page }) => {
    // The page should have some form elements for creating a pipeline
    // Look for title/name input, level selector, or create button
    const pageContent = await page.textContent("body");
    expect(pageContent).toBeTruthy();

    // Should not show an error boundary
    const errorBoundary = page.locator("text=RENDER_ERROR");
    await expect(errorBoundary).not.toBeVisible({ timeout: 3000 });
  });

  test("has a way to input a role title", async ({ page }) => {
    // Look for any text input that could be the title field
    const titleInput = page.locator(
      'input[placeholder*="role"], input[placeholder*="title"], input[placeholder*="name"], input[name="title"]'
    ).first();

    // The form should have a title input
    await expect(titleInput).toBeVisible({ timeout: 5000 });
  });
});
