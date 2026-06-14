import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { API_BASE, APP_BASE } from './env';

/**
 * BDD: Stage Panel Tabs
 *
 * The stage detail surface becomes a nested panel under /pipeline/:id/stage/:stageId
 * with three routed tabs: Challenges (index), Candidates, Configure.
 *
 * The old two-column layout with the right panel (email templates, time limit,
 * raw insights) is removed entirely. Stage configuration moves from the
 * ?config=<stageId> side panel into the Configure tab.
 */

interface SeedResult {
  pipelineId: string;
  stageId: string;
}

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState("networkidle");
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "__session");
  if (!sessionCookie) throw new Error("[stage-panel-tabs] No __session cookie found");
  return sessionCookie.value;
}

async function seedPipeline(
  request: APIRequestContext,
  authToken: string,
): Promise<SeedResult> {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
  };

  const pipelineRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers,
    data: { title: "Stage Tabs Test", status: "DRAFT", level: "Senior" },
  });
  expect(pipelineRes.status()).toBe(201);
  const { pipeline } = (await pipelineRes.json()) as { pipeline: { id: string } };

  const stageRes = await request.post(
    `${API_BASE}/api/v1/pipelines/${pipeline.id}/stages`,
    { headers, data: { title: "Technical Screen", order: 0 } },
  );
  expect(stageRes.status()).toBe(201);
  const { stage } = (await stageRes.json()) as { stage: { id: string } };

  return { pipelineId: pipeline.id, stageId: stage.id };
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

test.describe("Stage panel tabs", () => {
  let seed: SeedResult;
  let authToken: string;

  test.beforeEach(async ({ page, request }) => {
    await page.goto(`${APP_BASE}/`);
    authToken = await getAuthToken(page);
    seed = await seedPipeline(request, authToken);
    await page.goto(
      `${APP_BASE}/pipeline/${seed.pipelineId}/stage/${seed.stageId}`,
    );
  });

  test.afterEach(async ({ request }) => {
    await teardown(request, authToken, seed.pipelineId);
  });

  test("stage panel renders with Challenges tab active by default", async ({ page }) => {
    await page.waitForLoadState("networkidle");

    await expect(page.locator('[data-testid="stage-panel"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="stage-tab-challenges"]')).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(page.locator('[data-testid="stage-tab-content-challenges"]')).toBeVisible();
  });

  test("clicking Candidates tab updates URL and content", async ({ page }) => {
    await page.waitForLoadState("networkidle");

    await page.locator('[data-testid="stage-tab-candidates"]').click();

    await expect(page).toHaveURL(
      new RegExp(
        `/pipeline/${seed.pipelineId}/stage/${seed.stageId}/candidates`,
      ),
    );
    await expect(page.locator('[data-testid="stage-tab-content-candidates"]')).toBeVisible();
  });

  test("clicking Configure tab renders stage config inline", async ({ page }) => {
    await page.waitForLoadState("networkidle");

    await page.locator('[data-testid="stage-tab-configure"]').click();

    await expect(page).toHaveURL(
      new RegExp(
        `/pipeline/${seed.pipelineId}/stage/${seed.stageId}/configure`,
      ),
    );
    await expect(page.locator('[data-testid="stage-tab-content-configure"]')).toBeVisible();
  });

  test("removed right panel is not in the DOM", async ({ page }) => {
    await page.waitForLoadState("networkidle");

    // Email template + stage settings panel are gone.
    await expect(page.getByText(/email[_ ]?template/i)).toHaveCount(0);
    await expect(page.getByText(/invitation[_ ]?email/i)).toHaveCount(0);
    await expect(page.getByText(/time[_ ]?limit/i)).toHaveCount(0);
  });
});
