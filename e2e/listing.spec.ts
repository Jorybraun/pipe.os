import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { API_BASE } from './env';

/**
 * Phase 1 BDD: Listing Page
 *
 * Tests the pipeline listing at / including pipeline cards,
 * sidebar stats, status filters, search, and delete.
 *
 * NOTE: These tests assume the authenticated user may have existing
 * pipelines. Tests use unique seeded titles to isolate assertions.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState("networkidle");
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "__session");
  if (!sessionCookie) {
    throw new Error("No __session cookie found. Run auth.setup.ts first.");
  }
  return sessionCookie.value;
}

async function seedPipeline(
  request: APIRequestContext,
  authToken: string,
  options: {
    title?: string;
    status?: "DRAFT" | "ACTIVE";
    candidateCount?: number;
  } = {},
): Promise<{ id: string; title: string; status: string }> {
  const { title = "E2E Test Pipeline", status = "DRAFT", candidateCount = 0 } = options;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
  };

  const pipelineRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers,
    data: { title, status, level: "Senior" },
  });
  expect(pipelineRes.status()).toBe(201);
  const body = (await pipelineRes.json()) as { pipeline: { id: string; title: string; status: string } };
  const pipeline = body.pipeline;

  // Create a stage so we can add candidates
  const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipeline.id}/stages`, {
    headers,
    data: { title: "Technical Screen", order: 0 },
  });
  expect(stageRes.status()).toBe(201);
  const { stage } = (await stageRes.json()) as { stage: { id: string } };

  // Seed candidates if requested
  for (let i = 0; i < candidateCount; i++) {
    const candidateRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipeline.id}/candidates`, {
      headers,
      data: {
        name: `Candidate ${i + 1}`,
        email: `c${i + 1}+${Date.now()}@pipe-test.dev`,
        currentStageId: stage.id,
      },
    });
    expect(candidateRes.status()).toBe(201);
  }

  return pipeline;
}

async function teardownPipeline(
  request: APIRequestContext,
  authToken: string,
  pipelineId: string,
): Promise<void> {
  const res = await request.delete(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (res.status() !== 204 && res.status() !== 404) {
    console.warn(`[teardown] Unexpected status ${res.status()} deleting ${pipelineId}`);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Listing Page — navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("CREATE NEW PIPE button navigates to /pipeline/new", async ({ page }) => {
    const createButton = page.locator('text=CREATE NEW PIPE');
    await expect(createButton).toBeVisible({ timeout: 10000 });
    await createButton.click();
    await expect(page).toHaveURL(/\/pipeline\/new/);
  });

  test("SIGN OUT button is visible", async ({ page }) => {
    await expect(page.locator("text=SIGN OUT")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Listing Page — with seeded pipelines", () => {
  const seededIds: string[] = [];

  test.afterEach(async ({ request, page }) => {
    const authToken = await getAuthToken(page);
    await Promise.all(seededIds.map((id) => teardownPipeline(request, authToken, id)));
    seededIds.length = 0;
  });

  test("displays seeded pipeline with correct title, status and candidate count", async ({ page, request }) => {
    const authToken = await getAuthToken(page);
    const uniqueTitle = `E2E Display ${Date.now()}`;
    const pipeline = await seedPipeline(request, authToken, {
      title: uniqueTitle,
      status: "ACTIVE",
      candidateCount: 2,
    });
    seededIds.push(pipeline.id);

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Title visible in listing
    await expect(page.locator(`text=${uniqueTitle}`)).toBeVisible({ timeout: 10000 });

    // Candidate count rendered as "02" in RoleCard
    const card = page.locator("text=" + uniqueTitle).locator("xpath=../../../../..");
    await expect(card.locator("text=/\\b02\\b/")).toBeVisible({ timeout: 5000 });
  });

  test("filters by status", async ({ page, request }) => {
    const authToken = await getAuthToken(page);
    const uniqueActive = `E2E Active ${Date.now()}`;
    const uniqueDraft = `E2E Draft ${Date.now()}`;
    const active = await seedPipeline(request, authToken, { title: uniqueActive, status: "ACTIVE" });
    const draft = await seedPipeline(request, authToken, { title: uniqueDraft, status: "DRAFT" });
    seededIds.push(active.id, draft.id);

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Both visible initially
    await expect(page.locator(`text=${uniqueActive}`)).toBeVisible();
    await expect(page.locator(`text=${uniqueDraft}`)).toBeVisible();

    // Click ACTIVE filter in sidebar (exact match to avoid "Total Active Roles")
    await page.locator("aside").getByText("ACTIVE", { exact: true }).click();
    await page.waitForTimeout(300);

    await expect(page.locator(`text=${uniqueActive}`)).toBeVisible();
    await expect(page.locator(`text=${uniqueDraft}`)).not.toBeVisible();

    // Click DRAFT filter
    await page.locator("aside").getByText("DRAFT", { exact: true }).click();
    await page.waitForTimeout(300);

    await expect(page.locator(`text=${uniqueDraft}`)).toBeVisible();
    await expect(page.locator(`text=${uniqueActive}`)).not.toBeVisible();
  });

  test("searches by title", async ({ page, request }) => {
    const authToken = await getAuthToken(page);
    const uniqueFrontend = `E2E Frontend ${Date.now()}`;
    const uniqueBackend = `E2E Backend ${Date.now()}`;
    const frontend = await seedPipeline(request, authToken, { title: uniqueFrontend });
    const backend = await seedPipeline(request, authToken, { title: uniqueBackend });
    seededIds.push(frontend.id, backend.id);

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const searchInput = page.locator('input[placeholder="SEARCH_BY_TITLE..."]');
    await searchInput.fill(uniqueFrontend);
    await page.waitForTimeout(300);

    await expect(page.locator(`text=${uniqueFrontend}`)).toBeVisible();
    await expect(page.locator(`text=${uniqueBackend}`)).not.toBeVisible();
  });

  test("deletes a pipeline via card menu", async ({ page, request }) => {
    const authToken = await getAuthToken(page);
    const uniqueTitle = `E2E Delete ${Date.now()}`;
    const pipeline = await seedPipeline(request, authToken, { title: uniqueTitle });
    seededIds.push(pipeline.id);

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Confirm pipeline is visible
    await expect(page.locator(`text=${uniqueTitle}`)).toBeVisible();

    // Find the card containing our pipeline and click its actions menu
    const card = page.locator("text=" + uniqueTitle).locator("xpath=../../../../..");
    const actionsBtn = card.locator('button[aria-label="Pipeline actions"]');
    await actionsBtn.click();

    // Accept the browser confirm dialog
    page.on("dialog", (dialog) => dialog.accept());
    await page.locator("text=DELETE").first().click();

    // Wait for the card to disappear
    await expect(page.locator(`text=${uniqueTitle}`)).not.toBeVisible({ timeout: 10000 });
  });
});
