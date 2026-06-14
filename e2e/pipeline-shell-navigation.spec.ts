import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { API_BASE, APP_BASE } from './env';

/**
 * BDD: Pipeline Overview Shell Navigation
 *
 * The /pipeline/:id route becomes a shell: header row, stage stepper, and a
 * container card that swaps between an insights panel (root) and a stage
 * detail panel (when a stage is selected). The Kanban view moves to its own
 * /pipeline/:id/kanban route reached via a VIEW_KANBAN button.
 *
 * These specs define the target behaviour and will fail until the redesign
 * ships (OverviewPage → PipelineShellPage split).
 */

interface SeedResult {
  pipelineId: string;
  stageIds: string[];
}

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState("networkidle");
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "__session");
  if (!sessionCookie) {
    throw new Error("[pipeline-shell-navigation] No __session cookie found");
  }
  return sessionCookie.value;
}

async function seedPipeline(
  request: APIRequestContext,
  authToken: string,
  stageTitles: string[],
): Promise<SeedResult> {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
  };

  const pipelineRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers,
    data: { title: "Shell Nav Test", status: "DRAFT", level: "Senior" },
  });
  expect(pipelineRes.status()).toBe(201);
  const { pipeline } = (await pipelineRes.json()) as { pipeline: { id: string } };

  const stageIds: string[] = [];
  for (let i = 0; i < stageTitles.length; i++) {
    const res = await request.post(
      `${API_BASE}/api/v1/pipelines/${pipeline.id}/stages`,
      { headers, data: { title: stageTitles[i], order: i } },
    );
    expect(res.status()).toBe(201);
    const { stage } = (await res.json()) as { stage: { id: string } };
    stageIds.push(stage.id);
  }

  return { pipelineId: pipeline.id, stageIds };
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

test.describe("Pipeline shell navigation", () => {
  let seed: SeedResult;
  let authToken: string;

  test.beforeEach(async ({ page, request }) => {
    await page.goto(`${APP_BASE}/`);
    authToken = await getAuthToken(page);
    seed = await seedPipeline(request, authToken, ["Screen", "Onsite"]);
    await page.goto(`${APP_BASE}/pipeline/${seed.pipelineId}`);
  });

  test.afterEach(async ({ request }) => {
    await teardown(request, authToken, seed.pipelineId);
  });

  test("index route renders shell with stepper and insights panel", async ({ page }) => {
    await page.waitForLoadState("networkidle");

    // Header with pipeline title.
    await expect(page.locator("h1")).toContainText("Shell Nav Test", { timeout: 10_000 });

    // Stepper with home node + one node per stage.
    const stepper = page.locator('[data-testid="stage-stepper"]');
    await expect(stepper).toBeVisible({ timeout: 10_000 });
    await expect(stepper.locator('[data-testid="stepper-home"]')).toBeVisible();
    await expect(stepper.locator('[data-testid="stepper-stage"]')).toHaveCount(2);

    // Insights panel visible (not the kanban board).
    await expect(page.locator('[data-testid="insights-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="kanban-board"]')).toHaveCount(0);
  });

  test("clicking a stage node swaps panel to stage detail", async ({ page }) => {
    await page.waitForLoadState("networkidle");

    const firstStageNode = page
      .locator('[data-testid="stepper-stage"]')
      .first();
    await firstStageNode.click();

    await expect(page).toHaveURL(
      new RegExp(`/pipeline/${seed.pipelineId}/stage/${seed.stageIds[0]}`),
    );
    await expect(page.locator('[data-testid="stage-panel"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="insights-panel"]')).toHaveCount(0);
  });

  test("clicking home node returns to insights", async ({ page }) => {
    await page.goto(
      `${APP_BASE}/pipeline/${seed.pipelineId}/stage/${seed.stageIds[0]}`,
    );
    await page.waitForLoadState("networkidle");

    await page.locator('[data-testid="stepper-home"]').click();
    await expect(page).toHaveURL(new RegExp(`/pipeline/${seed.pipelineId}$`));
    await expect(page.locator('[data-testid="insights-panel"]')).toBeVisible();
  });

  test("VIEW_KANBAN button navigates to kanban route", async ({ page }) => {
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /view[_ ]?kanban/i }).click();

    await expect(page).toHaveURL(
      new RegExp(`/pipeline/${seed.pipelineId}/kanban$`),
    );
    await expect(page.locator('[data-testid="kanban-board"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="stage-card"]')).toHaveCount(2);
  });
});
