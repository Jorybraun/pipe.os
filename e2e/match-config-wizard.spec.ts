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

import { API_BASE, APP_BASE } from './env';

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
      stageType: i === 0 ? "CODE_REVIEW" : "SCREENING",
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

    // Chip shows philosophy + tolerance (linkage is shown in the gate panel, not the chip).
    const expected = "MATCH: TAILORED · STRICT";
    await expect(chips.nth(0)).toContainText(expected);
    await expect(chips.nth(1)).toContainText(expected);
  });

  test("clicking the chip navigates to the gate config page", async ({ page }) => {
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
    await expect(firstChip).toContainText("MATCH: HYBRID · MODERATE");

    await firstChip.click();
    await page.waitForLoadState("networkidle");

    // Navigated to the gate tab for the first stage.
    await expect(page).toHaveURL(
      new RegExp(`/pipeline/${seed.pipelineId}/stage/${seed.stages[0].id}/gate`),
    );

    // Gate tab content shows match config details.
    const gateContent = page.locator('[data-testid="stage-tab-content-gate"]');
    await expect(gateContent).toBeVisible();
    await expect(gateContent).toContainText(/hybrid/i);
    // Per-stage linkage is also shown on the full gate page.
    await expect(gateContent).toContainText(/per.?stage/i);
  });

  test("gate connector circle navigates to the gate config page", async ({ page }) => {
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

    const gateConnector = page.locator('[data-testid="stage-gate-connector"]').first();
    await expect(gateConnector).toBeVisible();
    await gateConnector.click();
    await page.waitForLoadState("networkidle");

    // Navigated to the gate tab for the first stage.
    await expect(page).toHaveURL(
      new RegExp(`/pipeline/${seed.pipelineId}/stage/${seed.stages[0].id}/gate`),
    );

    // Gate page shows match philosophy.
    const gateContent = page.locator('[data-testid="stage-tab-content-gate"]');
    await expect(gateContent).toBeVisible();
    await expect(gateContent).toContainText(/tailored/i);
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

  test("surfaces auto-build WARN guardrails as a dismissible banner", async ({ page }) => {
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

    // Navigate with warnings in router state (mirrors the path taken by
    // RoleDiscoveryPage.handleWizardComplete after a successful /auto-build
    // response that includes a non-empty `warnings` array).
    await page.goto(`${APP_BASE}/pipeline/${seed.pipelineId}`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(
      ({ id }) => {
        window.history.pushState(
          {
            usr: {
              autoBuildWarnings: [
                {
                  code: "W-NO-NON-NEGOTIABLE-SKILLS",
                  severity: "warn",
                  message:
                    "no skills marked non-negotiable — repo match will fall back to persona.mustHaveSkills as soft constraints",
                },
              ],
            },
          },
          "",
          `/pipeline/${id}`,
        );
        window.dispatchEvent(new PopStateEvent("popstate"));
      },
      { id: seed.pipelineId },
    );

    const banner = page.locator('[data-testid="auto-build-warnings-banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("AUTO_BUILD_WARNINGS");
    await expect(banner).toContainText("W-NO-NON-NEGOTIABLE-SKILLS");

    // Dismiss and confirm it's gone.
    await page.locator('[data-testid="auto-build-warnings-dismiss"]').click();
    await expect(
      page.locator('[data-testid="auto-build-warnings-banner"]'),
    ).toHaveCount(0);
  });
});
