import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { API_BASE, APP_BASE } from './env';

/**
 * BDD: New Stage Form
 *
 * Creating a stage moves from the purple icon type-picker column in the Kanban
 * to a dedicated sub-route /pipeline/:id/new-stage rendering a simple, clean
 * form with a plain <select> for stage type. On submit, redirects to the new
 * stage panel.
 */

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState("networkidle");
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "__session");
  if (!sessionCookie) throw new Error("[new-stage-form] No __session cookie found");
  return sessionCookie.value;
}

async function seedPipeline(
  request: APIRequestContext,
  authToken: string,
): Promise<string> {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
  };
  const res = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers,
    data: { title: "New Stage Form Test", status: "DRAFT", level: "Senior" },
  });
  expect(res.status()).toBe(201);
  const { pipeline } = (await res.json()) as { pipeline: { id: string } };
  return pipeline.id;
}

async function teardown(
  request: APIRequestContext,
  authToken: string,
  pipelineId: string,
): Promise<void> {
  await request.delete(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
}

test.describe("New stage form", () => {
  let pipelineId: string;
  let authToken: string;

  test.beforeEach(async ({ page, request }) => {
    await page.goto(`${APP_BASE}/`);
    authToken = await getAuthToken(page);
    pipelineId = await seedPipeline(request, authToken);
    await page.goto(`${APP_BASE}/pipeline/${pipelineId}`);
  });

  test.afterEach(async ({ request }) => {
    await teardown(request, authToken, pipelineId);
  });

  test("clicking ADD_STAGE in stepper navigates to the new-stage form route", async ({ page }) => {
    await page.waitForLoadState("networkidle");

    await page.locator('[data-testid="stepper-add-stage"]').click();
    await expect(page).toHaveURL(new RegExp(`/pipeline/${pipelineId}/new-stage$`));
  });

  test("form renders with a plain select for type and a name input", async ({ page }) => {
    await page.goto(`${APP_BASE}/pipeline/${pipelineId}/new-stage`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator('[data-testid="new-stage-form"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="new-stage-name"]')).toBeVisible();

    const select = page.locator('[data-testid="new-stage-type"]');
    await expect(select).toBeVisible();
    await expect(select).toHaveJSProperty("tagName", "SELECT");

    // No fancy purple icon buttons from the old picker.
    await expect(page.locator('[data-testid="stage-type-icon-button"]')).toHaveCount(0);
  });

  test("submitting the form creates a stage and redirects to its panel", async ({ page }) => {
    await page.goto(`${APP_BASE}/pipeline/${pipelineId}/new-stage`);
    await page.waitForLoadState("networkidle");

    await page.locator('[data-testid="new-stage-name"]').fill("Phone Screen");
    await page
      .locator('[data-testid="new-stage-type"]')
      .selectOption({ index: 0 });

    await page.locator('[data-testid="new-stage-submit"]').click();

    await expect(page).toHaveURL(
      new RegExp(`/pipeline/${pipelineId}/stage/[a-zA-Z0-9-]+$`),
      { timeout: 10_000 },
    );
    await expect(page.locator('[data-testid="stage-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="stepper-stage"]')).toHaveCount(1);
  });

  test("cancel returns to pipeline insights", async ({ page }) => {
    await page.goto(`${APP_BASE}/pipeline/${pipelineId}/new-stage`);
    await page.waitForLoadState("networkidle");

    await page.locator('[data-testid="new-stage-cancel"]').click();
    await expect(page).toHaveURL(new RegExp(`/pipeline/${pipelineId}$`));
    await expect(page.locator('[data-testid="insights-panel"]')).toBeVisible();
  });
});
