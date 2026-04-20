import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * BDD: Match-Config Wizard + Per-Stage Chip (ADR-039 v1 slice)
 *
 * The wizard flow itself (Role Discovery → 5-step modal → /auto-build) involves
 * AI mocking that's out of scope for a single BDD. Instead this spec exercises
 * the user-visible artifact at the end of the chain: the per-stage match-config
 * chip on StageStepper, fed by the overview route's matchConfig field.
 *
 * The autoStageBuilder + guardrails + auto-build route are covered by Vitest
 * (workers/api/src/lib/match/__tests__/*).
 */

const API_BASE = "http://localhost:8787";
const APP_BASE = "http://localhost:5173";

interface SeedResult {
  pipelineId: string;
  stages: Array<{ id: string; title: string }>;
}

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState("networkidle");
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "__session");
  if (!sessionCookie) {
    throw new Error("[match-config-wizard] No __session cookie found");
  }
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
    data: { title: "Match Config Chip Test", status: "DRAFT", level: "Senior" },
  });
  expect(pipelineRes.status()).toBe(201);
  const { pipeline } = (await pipelineRes.json()) as { pipeline: { id: string } };

  const titles = ["Code Review", "Code Implementation"];
  const stages: Array<{ id: string; title: string }> = [];
  for (let i = 0; i < titles.length; i++) {
    const res = await request.post(
      `${API_BASE}/api/v1/pipelines/${pipeline.id}/stages`,
      { headers, data: { title: titles[i], order: i } },
    );
    expect(res.status()).toBe(201);
    const { stage } = (await res.json()) as { stage: { id: string; title: string } };
    stages.push({ id: stage.id, title: stage.title });
  }

  return { pipelineId: pipeline.id, stages };
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

/**
 * Builds an overview response payload that mirrors the production shape, with
 * matchConfig optionally injected so we can assert the chip path independently
 * of the auto-build route's repo/PR/issue prerequisites.
 */
function overviewResponse(
  seed: SeedResult,
  matchConfig: {
    matchPhilosophy: string | null;
    tolerance: string | null;
    stageLinkage: string | null;
    automationGranularity: string | null;
    hybridMixRatio: number | null;
  } | null,
) {
  return {
    pipeline: {
      id: seed.pipelineId,
      title: "Match Config Chip Test",
      level: "Senior",
      status: "DRAFT",
      creationMode: "BLANK",
      stageCount: seed.stages.length,
      candidateCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    stages: seed.stages.map((s, i) => ({
      id: s.id,
      title: s.title,
      pipelineId: seed.pipelineId,
      sortOrder: i,
      description: null,
      timeLimit: null,
      mode: null,
      challengeCount: 0,
      stageType: i === 0 ? "CODE_REVIEW" : "TECHNICAL",
      isScheduled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    candidates: [],
    interviews: [],
    matchConfig,
    roleContext: null,
  };
}

test.describe("Match-config chip on StageStepper", () => {
  let seed: SeedResult;
  let authToken: string;

  test.beforeEach(async ({ page, request }) => {
    await page.goto(`${APP_BASE}/`);
    authToken = await getAuthToken(page);
    seed = await seedPipeline(request, authToken);
  });

  test.afterEach(async ({ request }) => {
    await teardown(request, authToken, seed.pipelineId);
  });

  test("renders 'Match: …' chip per stage when matchConfig is present", async ({ page }) => {
    await page.route(
      `${API_BASE}/api/v1/pipelines/${seed.pipelineId}/overview`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            overviewResponse(seed, {
              matchPhilosophy: "tailored",
              tolerance: "strict",
              stageLinkage: "shared-repo",
              automationGranularity: "per-candidate",
              hybridMixRatio: null,
            }),
          ),
        });
      },
    );

    await page.goto(`${APP_BASE}/pipeline/${seed.pipelineId}`);
    await page.waitForLoadState("networkidle");

    const chips = page.locator('[data-testid="match-config-chip"]');
    await expect(chips).toHaveCount(seed.stages.length);

    // Every chip renders the same inherited summary string.
    const expected = "MATCH: TAILORED · STRICT · SHARED REPO";
    await expect(chips.nth(0)).toContainText(expected);
    await expect(chips.nth(1)).toContainText(expected);
  });

  test("clicking the chip opens the inheritance tooltip", async ({ page }) => {
    await page.route(
      `${API_BASE}/api/v1/pipelines/${seed.pipelineId}/overview`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            overviewResponse(seed, {
              matchPhilosophy: "hybrid",
              tolerance: "moderate",
              stageLinkage: "per-stage",
              automationGranularity: "per-candidate",
              hybridMixRatio: 0.6,
            }),
          ),
        });
      },
    );

    await page.goto(`${APP_BASE}/pipeline/${seed.pipelineId}`);
    await page.waitForLoadState("networkidle");

    const firstChip = page.locator('[data-testid="match-config-chip"]').first();
    await expect(firstChip).toContainText("MATCH: HYBRID · MODERATE · PER STAGE");

    // No tooltip until the user clicks.
    await expect(page.locator('[data-testid="match-config-tooltip"]')).toHaveCount(0);

    await firstChip.click();

    const tooltip = page.locator('[data-testid="match-config-tooltip"]').first();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(/inherited from role config/i);

    // Clicking again toggles the tooltip closed.
    await firstChip.click();
    await expect(page.locator('[data-testid="match-config-tooltip"]')).toHaveCount(0);
  });

  test("no chip renders when matchConfig is null", async ({ page }) => {
    await page.route(
      `${API_BASE}/api/v1/pipelines/${seed.pipelineId}/overview`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(overviewResponse(seed, null)),
        });
      },
    );

    await page.goto(`${APP_BASE}/pipeline/${seed.pipelineId}`);
    await page.waitForLoadState("networkidle");

    // Stage nodes still render…
    await expect(page.locator('[data-testid="stepper-stage"]')).toHaveCount(
      seed.stages.length,
    );
    // …but no chip when match config is absent.
    await expect(page.locator('[data-testid="match-config-chip"]')).toHaveCount(0);
  });
});
