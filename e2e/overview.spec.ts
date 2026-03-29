import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Phase 2 BDD: Pipeline Overview Page
 *
 * Tests the /pipeline/:id kanban view — stages, candidates, and
 * recruiter actions (add stage, invite candidate, delete stage).
 *
 * These tests define target behaviour for the Cloudflare Workers migration.
 * They are written before the implementation (TDD / BDD approach) and will
 * fail until the Worker API routes and migrated OverviewPage are shipped.
 *
 * All tests run in the `authenticated` project (Clerk storageState loaded by
 * the `setup` project via auth.setup.ts).
 */

// ─── Configuration ─────────────────────────────────────────────────────────────

const API_BASE = "http://localhost:8787";
const APP_BASE = "http://localhost:5173";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SeededPipeline {
  id: string;
  title: string;
  status: "DRAFT" | "ACTIVE";
}

interface SeededStage {
  id: string;
  title: string;
  sortOrder: number;
}

interface SeededCandidate {
  id: string;
  name: string;
  email: string;
  inviteToken: string;
  currentStageId: string;
  status: string;
}

interface SeedResult {
  pipeline: SeededPipeline;
  stages: SeededStage[];
  candidates: SeededCandidate[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return the Clerk session token stored in Playwright's auth state so we can
 * attach it to direct API calls made from request fixtures.
 *
 * Clerk persists its session as a cookie named `__session`. We extract it from
 * the browser context's cookie jar to authenticate Worker API seeding calls.
 *
 * Must be called after `page.goto()` so the storage state is hydrated.
 */
async function getAuthToken(page: Page): Promise<string> {
  // Wait for Clerk JS to refresh the session token (the stored JWT may be
  // expired). networkidle ensures the async token refresh has completed.
  await page.waitForLoadState("networkidle");

  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "__session");
  if (!sessionCookie) {
    throw new Error(
      "[overview.spec] No __session cookie found. Make sure the auth_setup project ran first.",
    );
  }
  return sessionCookie.value;
}

/**
 * Seeds a test pipeline with stages and candidates via the Worker API.
 * Returns IDs needed to navigate and assert in tests.
 *
 * Uses Playwright's `request` context which does NOT carry browser cookies —
 * it requires an explicit Authorization header.
 *
 * @param request - Playwright APIRequestContext
 * @param authToken - Clerk JWT obtained from the browser context
 * @param options.status - pipeline status; default DRAFT
 * @param options.stageCount - number of stages to create; default 2
 * @param options.candidateCount - number of candidates to create; default 0
 */
async function seedPipeline(
  request: APIRequestContext,
  authToken: string,
  options: {
    title?: string;
    status?: "DRAFT" | "ACTIVE";
    stageCount?: number;
    candidateCount?: number;
    stageTitles?: string[];
  } = {},
): Promise<SeedResult> {
  const {
    title = "E2E Test Pipeline",
    status = "DRAFT",
    stageCount = 2,
    candidateCount = 0,
    stageTitles,
  } = options;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
  };

  // 1. Create the pipeline.
  const pipelineRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers,
    data: { title, status, level: "Senior" },
  });
  expect(pipelineRes.status()).toBe(201);
  const { pipeline: pipelineData } = await pipelineRes.json() as {
    pipeline: { id: string; title: string; status: string };
  };

  const pipeline: SeededPipeline = {
    id: pipelineData.id,
    title: pipelineData.title,
    status: status,
  };

  // 2. Create stages.
  const stages: SeededStage[] = [];
  const defaultTitles = ["Technical Screen", "Final Round", "Culture Fit"];

  for (let i = 0; i < stageCount; i++) {
    const stageTitle = stageTitles?.[i] ?? defaultTitles[i] ?? `Stage ${i + 1}`;
    const stageRes = await request.post(
      `${API_BASE}/api/v1/pipelines/${pipeline.id}/stages`,
      {
        headers,
        data: { title: stageTitle, order: i },
      },
    );
    expect(stageRes.status()).toBe(201);
    const { stage: stageData } = await stageRes.json() as {
      stage: { id: string; title: string; sortOrder: number };
    };
    stages.push({
      id: stageData.id,
      title: stageData.title,
      sortOrder: stageData.sortOrder,
    });
  }

  // 3. Create candidates (only if requested, and pipeline must have at least 1 stage).
  const candidates: SeededCandidate[] = [];

  if (candidateCount > 0 && stages.length > 0) {
    for (let i = 0; i < candidateCount; i++) {
      // Distribute candidates across stages round-robin.
      const targetStage = stages[i % stages.length]!;
      const candidateRes = await request.post(
        `${API_BASE}/api/v1/pipelines/${pipeline.id}/candidates`,
        {
          headers,
          data: {
            name: `Candidate ${i + 1}`,
            email: `candidate${i + 1}+e2e-${Date.now()}@pipe-test.dev`,
            currentStageId: targetStage.id,
          },
        },
      );
      expect(candidateRes.status()).toBe(201);
      const { candidate: candidateData } = await candidateRes.json() as {
        candidate: {
          id: string;
          name: string;
          email: string;
          inviteToken: string;
          currentStageId: string;
          status: string;
        };
      };
      candidates.push(candidateData);
    }
  }

  return { pipeline, stages, candidates };
}

/**
 * Deletes a pipeline and all its children via the Worker API.
 * Called in afterEach / afterAll to keep the database clean.
 */
async function teardownPipeline(
  request: APIRequestContext,
  authToken: string,
  pipelineId: string,
): Promise<void> {
  await request.delete(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
}

// ─── Test Suites ──────────────────────────────────────────────────────────────

test.describe("2.1 — Pipeline overview: populated pipeline", () => {
  let seed: SeedResult;
  let authToken: string;

  test.beforeEach(async ({ page, request }) => {
    // Navigate first so storageState is hydrated into the browser context.
    await page.goto(`${APP_BASE}/`);
    authToken = await getAuthToken(page);

    seed = await seedPipeline(request, authToken, {
      title: "Senior Frontend Engineer",
      status: "DRAFT",
      stageCount: 2,
      candidateCount: 3,
    });

    await page.goto(`${APP_BASE}/pipeline/${seed.pipeline.id}`);
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, authToken, seed.pipeline.id);
  });

  test("displays the pipeline title", async ({ page }) => {
    // The page header should show the pipeline title prominently.
    await expect(page.locator("text=Senior Frontend Engineer")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("renders the correct number of stage columns", async ({ page }) => {
    // Two stage header cards should be visible — one per seeded stage.
    const stageCards = page.locator('[data-testid="stage-card"]');
    await expect(stageCards).toHaveCount(2, { timeout: 10_000 });
  });

  test("stage columns appear in sorted order", async ({ page }) => {
    const stageCards = page.locator('[data-testid="stage-card"]');
    await expect(stageCards).toHaveCount(2, { timeout: 10_000 });

    // Stage titles appear inside the cards — verify order matches seed order.
    await expect(stageCards.nth(0)).toContainText("TECHNICAL SCREEN", {
      ignoreCase: true,
    });
    await expect(stageCards.nth(1)).toContainText("FINAL ROUND", {
      ignoreCase: true,
    });
  });

  test("candidate cards show name, email and status", async ({ page }) => {
    // Wait for at least one candidate card to appear.
    const firstCandidateText = `CANDIDATE 1`;
    await expect(page.locator(`text=${firstCandidateText}`)).toBeVisible({
      timeout: 10_000,
    });

    // Verify email and status are rendered somewhere on the page.
    await expect(
      page.locator("text=candidate1").or(page.locator(`text=INVITED`)).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("candidates are placed in their correct stage columns", async ({
    page,
  }) => {
    // The overview response places candidates by currentStageId.
    // Candidate 1 was seeded into stages[0]. Verify the page structure reflects this.
    // We find the first stage column and check it contains a candidate card.
    const firstStageColumn = page
      .locator('[data-testid="stage-card"]')
      .first()
      .locator("../.."); // SortableStage column div (skip position:relative wrapper)

    await expect(firstStageColumn.locator("text=CANDIDATE 1")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("page loads within an acceptable time (performance smoke test)", async ({
    page,
  }) => {
    const startMs = Date.now();
    await page.goto(`${APP_BASE}/pipeline/${seed.pipeline.id}`);
    // Wait for stage cards to appear — this is the first meaningful paint signal.
    await page.locator('[data-testid="stage-card"]').first().waitFor({
      state: "visible",
      timeout: 5_000,
    });
    const elapsed = Date.now() - startMs;
    // Soft assertion — log a warning rather than failing CI if slightly over.
    if (elapsed > 2000) {
      console.warn(
        `[overview.spec] Overview page took ${elapsed}ms (target <500ms from API, <2000ms including navigation)`,
      );
    }
    // Hard limit: page must show content within 5 seconds of navigation.
    expect(elapsed).toBeLessThan(5_000);
  });
});

test.describe("2.1b — Pipeline overview: empty pipeline", () => {
  let seed: SeedResult;
  let authToken: string;

  test.beforeEach(async ({ page, request }) => {
    await page.goto(`${APP_BASE}/`);
    authToken = await getAuthToken(page);

    // Pipeline with 0 stages and 0 candidates.
    seed = await seedPipeline(request, authToken, {
      title: "Empty Draft Pipeline",
      status: "DRAFT",
      stageCount: 0,
      candidateCount: 0,
    });

    await page.goto(`${APP_BASE}/pipeline/${seed.pipeline.id}`);
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, authToken, seed.pipeline.id);
  });

  test("shows no stage cards when pipeline has 0 stages", async ({ page }) => {
    // Stage cards should not be present.
    const stageCards = page.locator('[data-testid="stage-card"]');
    await expect(stageCards).toHaveCount(0, { timeout: 10_000 });
  });

  test("ADD_STAGE button is visible on empty DRAFT pipeline", async ({
    page,
  }) => {
    await expect(page.locator("text=ADD_STAGE")).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("2.2 — Add stage to pipeline", () => {
  let seed: SeedResult;
  let authToken: string;

  test.beforeEach(async ({ page, request }) => {
    await page.goto(`${APP_BASE}/`);
    authToken = await getAuthToken(page);

    seed = await seedPipeline(request, authToken, {
      title: "Stage Management Pipeline",
      status: "DRAFT",
      stageCount: 1,
    });

    await page.goto(`${APP_BASE}/pipeline/${seed.pipeline.id}`);
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, authToken, seed.pipeline.id);
  });

  test("ADD_STAGE button is visible for DRAFT pipeline", async ({ page }) => {
    await expect(page.locator("text=ADD_STAGE")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("clicking ADD_STAGE opens a prompt and creates a new stage column", async ({
    page,
  }) => {
    // The current implementation uses window.prompt. Handle the dialog.
    page.on("dialog", async (dialog) => {
      await dialog.accept("Technical Screen");
    });

    await page.locator("text=ADD_STAGE").click();

    // After dismissing the prompt, a new stage column should appear.
    // Previously had 1 stage — now expect 2.
    await expect(page.locator('[data-testid="stage-card"]')).toHaveCount(2, {
      timeout: 10_000,
    });

    // The new stage title should be visible (use .nth(1) since the seeded stage
    // also has a "Technical Screen" title — we check that count grew to 2).
    await expect(page.locator("text=TECHNICAL SCREEN").nth(1)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("ADD_STAGE button is NOT visible for ACTIVE pipeline", async ({
    page,
    request,
  }) => {
    // Create a separate active pipeline for this check.
    const activeSeed = await seedPipeline(request, authToken, {
      title: "Active Pipeline — No Add Stage",
      status: "ACTIVE",
      stageCount: 1,
    });

    try {
      await page.goto(`${APP_BASE}/pipeline/${activeSeed.pipeline.id}`);
      // ADD_STAGE should not be rendered for ACTIVE pipelines.
      await expect(page.locator("text=ADD_STAGE")).not.toBeVisible({
        timeout: 5_000,
      });
    } finally {
      await teardownPipeline(request, authToken, activeSeed.pipeline.id);
    }
  });

  test("new stage persists after page reload", async ({ page }) => {
    page.on("dialog", async (dialog) => {
      await dialog.accept("Persistent Stage");
    });

    await page.locator("text=ADD_STAGE").click();
    await expect(page.locator("text=PERSISTENT STAGE")).toBeVisible({
      timeout: 10_000,
    });

    // Reload and verify persistence.
    await page.reload();
    await expect(page.locator("text=PERSISTENT STAGE")).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("2.3 — Stage reorder via drag-and-drop", () => {
  let seed: SeedResult;
  let authToken: string;

  test.beforeEach(async ({ page, request }) => {
    await page.goto(`${APP_BASE}/`);
    authToken = await getAuthToken(page);

    seed = await seedPipeline(request, authToken, {
      title: "Reorder Test Pipeline",
      status: "DRAFT",
      stageCount: 3,
      stageTitles: ["Screen", "Technical", "Final"],
    });

    await page.goto(`${APP_BASE}/pipeline/${seed.pipeline.id}`);
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, authToken, seed.pipeline.id);
  });

  test.skip(
    "drag stage to new position and verify updated order — requires pointer drag simulation",
    async ({ page }) => {
      // TODO: Implement drag-and-drop via page.dragAndDrop() or mouse.move() sequences.
      // @dnd-kit uses PointerSensor with an activationConstraint of 8px,
      // so the drag must travel at least 8px before it activates.
      //
      // Steps:
      // 1. Find the drag handle of the 3rd stage ("Final").
      // 2. Drag it to a position before the 2nd stage ("Technical").
      // 3. Release.
      // 4. Assert order is now ["Screen", "Final", "Technical"].
      // 5. Verify the PATCH /api/v1/pipelines/:id/stages/reorder call was made.
      // 6. Reload and assert the order persists from D1.
      //
      // Skipped because reliable cross-platform drag-and-drop in Playwright
      // requires fine-tuned coordinate offsets that depend on the rendered
      // column width — these should be set up once the migrated UI is stable.
    },
  );

  test.skip(
    "reorder failure reverts to original order",
    async () => {
      // TODO: Intercept the PATCH /api/v1/pipelines/:id/stages/reorder request,
      // return a 500 response, and assert the UI reverts to the original order
      // and displays an error notification.
    },
  );

  test("stages render in ascending sortOrder", async ({ page }) => {
    // This is a non-drag test that confirms the initial seeded order is respected.
    const stageCards = page.locator('[data-testid="stage-card"]');
    await expect(stageCards).toHaveCount(3, { timeout: 10_000 });

    await expect(stageCards.nth(0)).toContainText("SCREEN", {
      ignoreCase: true,
    });
    await expect(stageCards.nth(1)).toContainText("TECHNICAL", {
      ignoreCase: true,
    });
    await expect(stageCards.nth(2)).toContainText("FINAL", {
      ignoreCase: true,
    });
  });
});

test.describe("2.5 — Publish pipeline (DRAFT → ACTIVE)", () => {
  let seed: SeedResult;
  let authToken: string;

  test.beforeEach(async ({ page, request }) => {
    await page.goto(`${APP_BASE}/`);
    authToken = await getAuthToken(page);
  });

  test.afterEach(async ({ request }) => {
    if (seed?.pipeline?.id) {
      await teardownPipeline(request, authToken, seed.pipeline.id);
    }
  });

  test("PUBLISH_PIPELINE button is visible on DRAFT pipeline with stages", async ({
    page,
    request,
  }) => {
    seed = await seedPipeline(request, authToken, {
      title: "Draft Publish Test",
      status: "DRAFT",
      stageCount: 1,
    });
    await page.goto(`${APP_BASE}/pipeline/${seed.pipeline.id}`);

    await expect(page.locator("text=PUBLISH_PIPELINE")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("PUBLISH_PIPELINE button is NOT visible on ACTIVE pipeline", async ({
    page,
    request,
  }) => {
    seed = await seedPipeline(request, authToken, {
      title: "Active No Publish",
      status: "ACTIVE",
      stageCount: 1,
    });
    await page.goto(`${APP_BASE}/pipeline/${seed.pipeline.id}`);

    // Wait for page to load by checking for the ADD_CANDIDATE button (ACTIVE pipeline).
    await expect(page.locator("text=ADD_CANDIDATE")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("text=PUBLISH_PIPELINE")).not.toBeVisible();
  });

  test("clicking PUBLISH_PIPELINE changes status to ACTIVE and shows ADD_CANDIDATE", async ({
    page,
    request,
  }) => {
    seed = await seedPipeline(request, authToken, {
      title: "Publish Flow Test",
      status: "DRAFT",
      stageCount: 2,
    });
    await page.goto(`${APP_BASE}/pipeline/${seed.pipeline.id}`);

    // Status badge should show DRAFT.
    await expect(page.locator('[data-testid="pipeline-status-badge"]')).toContainText(
      "DRAFT",
      { timeout: 10_000 },
    );

    // Click publish.
    await page.locator("text=PUBLISH_PIPELINE").click();

    // Status badge should update to ACTIVE.
    await expect(page.locator('[data-testid="pipeline-status-badge"]')).toContainText(
      "ACTIVE",
      { timeout: 10_000 },
    );

    // PUBLISH button should be gone, ADD_CANDIDATE should appear.
    await expect(page.locator("text=PUBLISH_PIPELINE")).not.toBeVisible();
    await expect(page.locator("text=ADD_CANDIDATE")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("status badge shows DRAFT on draft pipeline", async ({
    page,
    request,
  }) => {
    seed = await seedPipeline(request, authToken, {
      title: "Badge Draft Test",
      status: "DRAFT",
      stageCount: 1,
    });
    await page.goto(`${APP_BASE}/pipeline/${seed.pipeline.id}`);

    await expect(page.locator('[data-testid="pipeline-status-badge"]')).toContainText(
      "DRAFT",
      { timeout: 10_000 },
    );
  });

  test("status badge shows ACTIVE on active pipeline", async ({
    page,
    request,
  }) => {
    seed = await seedPipeline(request, authToken, {
      title: "Badge Active Test",
      status: "ACTIVE",
      stageCount: 1,
    });
    await page.goto(`${APP_BASE}/pipeline/${seed.pipeline.id}`);

    await expect(page.locator('[data-testid="pipeline-status-badge"]')).toContainText(
      "ACTIVE",
      { timeout: 10_000 },
    );
  });

  test("API contract: PATCH /api/v1/pipelines/:id updates status", async ({
    request,
  }) => {
    seed = await seedPipeline(request, authToken, {
      title: "PATCH Contract Test",
      status: "DRAFT",
      stageCount: 1,
    });

    const res = await request.patch(
      `${API_BASE}/api/v1/pipelines/${seed.pipeline.id}`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
        data: { status: "ACTIVE" },
      },
    );

    expect(res.status()).toBe(200);

    const body = await res.json() as {
      id: string;
      status: string;
      title: string;
    };
    expect(body.id).toBe(seed.pipeline.id);
    expect(body.status).toBe("ACTIVE");
  });

  test("API contract: PATCH rejects DRAFT→ACTIVE with 0 stages", async ({
    request,
  }) => {
    seed = await seedPipeline(request, authToken, {
      title: "No Stages Pipeline",
      status: "DRAFT",
      stageCount: 0,
    });

    const res = await request.patch(
      `${API_BASE}/api/v1/pipelines/${seed.pipeline.id}`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
        data: { status: "ACTIVE" },
      },
    );

    expect(res.status()).toBe(422);
  });
});

test.describe("2.6 — Invite candidate", () => {
  let seed: SeedResult;
  let authToken: string;

  test.beforeEach(async ({ page, request }) => {
    await page.goto(`${APP_BASE}/`);
    authToken = await getAuthToken(page);

    // Candidates can only be added to ACTIVE pipelines.
    seed = await seedPipeline(request, authToken, {
      title: "Active Invite Pipeline",
      status: "ACTIVE",
      stageCount: 2,
    });

    await page.goto(`${APP_BASE}/pipeline/${seed.pipeline.id}`);
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, authToken, seed.pipeline.id);
  });

  test("ADD_CANDIDATE button is visible on ACTIVE pipeline", async ({
    page,
  }) => {
    await expect(page.locator("text=ADD_CANDIDATE")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("ADD_CANDIDATE button is NOT visible on DRAFT pipeline", async ({
    page,
    request,
  }) => {
    const draftSeed = await seedPipeline(request, authToken, {
      title: "Draft — No Add Candidate",
      status: "DRAFT",
      stageCount: 1,
    });

    try {
      await page.goto(`${APP_BASE}/pipeline/${draftSeed.pipeline.id}`);
      await expect(page.locator("text=ADD_CANDIDATE")).not.toBeVisible({
        timeout: 5_000,
      });
    } finally {
      await teardownPipeline(request, authToken, draftSeed.pipeline.id);
    }
  });

  test("clicking ADD_CANDIDATE opens the intake modal", async ({ page }) => {
    await page.locator("text=ADD_CANDIDATE").click();

    // The CandidateIntakeModal renders with header text "CREATE_NEW_CANDIDATE".
    await expect(page.locator("text=CREATE_NEW_CANDIDATE")).toBeVisible({
      timeout: 10_000,
    });

    // FULL_NAME and EMAIL_ADDRESS field labels should be visible.
    await expect(page.locator("text=FULL_NAME")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator("text=EMAIL_ADDRESS")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("submitting the intake form creates a candidate in the first stage", async ({
    page,
  }) => {
    await page.locator("text=ADD_CANDIDATE").click();

    // Fill in the candidate's name using the TextInput under FULL_NAME label.
    // The inputs don't have name attributes in CandidateIntakeModal — target
    // via placeholder text.
    const nameInput = page.locator('input[placeholder="E.g. John Doe"]');
    const emailInput = page.locator('input[placeholder="john@example.com"]');

    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill("Jane Doe");
    await emailInput.fill("jane.doe.e2e@pipe-test.dev");

    // Submit the form.
    await page.locator("text=INITIATE_INTAKE").click();

    // Modal should close and the candidate card should appear on the board.
    // The modal closes on success (step === BASIC, no file → onSuccess fires).
    await expect(page.locator("text=CREATE_NEW_CANDIDATE")).not.toBeVisible({
      timeout: 10_000,
    });

    // Candidate name should now be visible in the kanban board (uppercase).
    await expect(page.locator("text=JANE DOE")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("new candidate appears with INVITED status", async ({ page }) => {
    await page.locator("text=ADD_CANDIDATE").click();

    const nameInput = page.locator('input[placeholder="E.g. John Doe"]');
    const emailInput = page.locator('input[placeholder="john@example.com"]');
    await nameInput.fill("Bob Smith");
    await emailInput.fill("bob.smith.e2e@pipe-test.dev");
    await page.locator("text=INITIATE_INTAKE").click();

    // Wait for modal to close.
    await expect(page.locator("text=CREATE_NEW_CANDIDATE")).not.toBeVisible({
      timeout: 10_000,
    });

    // The candidate card status indicator shows INVITED.
    await expect(page.locator("text=INVITED").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("candidate card shows a copy invite link button", async ({ page }) => {
    await page.locator("text=ADD_CANDIDATE").click();

    const nameInput = page.locator('input[placeholder="E.g. John Doe"]');
    const emailInput = page.locator('input[placeholder="john@example.com"]');
    await nameInput.fill("Copy Link Test");
    await emailInput.fill("copylink.e2e@pipe-test.dev");
    await page.locator("text=INITIATE_INTAKE").click();

    await expect(page.locator("text=CREATE_NEW_CANDIDATE")).not.toBeVisible({
      timeout: 10_000,
    });

    // The copy button (title="Copy assessment link") should be present on the new card.
    await expect(
      page.locator('[title="Copy assessment link"]').first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("copy button writes an /assess/ URL to the clipboard", async ({
    page,
    context,
  }) => {
    // Grant clipboard permissions.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // Wait for ADD_CANDIDATE to be visible before clicking.
    await expect(page.locator("text=ADD_CANDIDATE")).toBeVisible({
      timeout: 10_000,
    });
    await page.locator("text=ADD_CANDIDATE").click();

    const nameInput = page.locator('input[placeholder="E.g. John Doe"]');
    const emailInput = page.locator('input[placeholder="john@example.com"]');
    await nameInput.fill("Clipboard Test");
    await emailInput.fill("clipboard.e2e@pipe-test.dev");
    await page.locator("text=INITIATE_INTAKE").click();

    await expect(page.locator("text=CREATE_NEW_CANDIDATE")).not.toBeVisible({
      timeout: 10_000,
    });

    // Click the copy button.
    await page.locator('[title="Copy assessment link"]').first().click();

    // Clipboard content should contain /assess/.
    const clipboardText = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(clipboardText).toContain("/assess/");
  });
});

test.describe("2.7 — Candidate status across stages", () => {
  let seed: SeedResult;
  let authToken: string;

  test.beforeEach(async ({ page, request }) => {
    await page.goto(`${APP_BASE}/`);
    authToken = await getAuthToken(page);

    seed = await seedPipeline(request, authToken, {
      title: "Multi-Stage Candidate Pipeline",
      status: "ACTIVE",
      stageCount: 2,
      candidateCount: 2,
    });

    await page.goto(`${APP_BASE}/pipeline/${seed.pipeline.id}`);
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, authToken, seed.pipeline.id);
  });

  test("candidate placed in stage 1 appears in stage 1 column", async ({
    page,
  }) => {
    // Candidate 1 is seeded into stages[0] (round-robin: index 0 % 2 = 0).
    // The first stage column should contain "CANDIDATE 1".
    const firstStageColumn = page
      .locator('[data-testid="stage-card"]')
      .first()
      .locator("../.."); // SortableStage column div (skip position:relative wrapper)

    await expect(firstStageColumn.locator("text=CANDIDATE 1")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("candidate placed in stage 2 appears in stage 2 column", async ({
    page,
  }) => {
    // Candidate 2 is seeded into stages[1] (round-robin: index 1 % 2 = 1).
    const secondStageColumn = page
      .locator('[data-testid="stage-card"]')
      .nth(1)
      .locator("../.."); // SortableStage column div (skip position:relative wrapper)

    await expect(secondStageColumn.locator("text=CANDIDATE 2")).toBeVisible({
      timeout: 10_000,
    });
  });

  test.skip(
    "dragging candidate to different stage sends PATCH and moves the card",
    async () => {
      // TODO: Same drag-and-drop implementation note as 2.3.
      // Steps:
      // 1. Drag Candidate 1's card from stage column 1 to stage column 2.
      // 2. Assert PATCH /api/v1/candidates/:id is called with { currentStageId: stages[1].id }.
      // 3. Assert "CANDIDATE 1" is now visible in the second stage column.
    },
  );
});

test.describe("2.8 — Delete stage from pipeline", () => {
  let seed: SeedResult;
  let authToken: string;

  test.beforeEach(async ({ page, request }) => {
    await page.goto(`${APP_BASE}/`);
    authToken = await getAuthToken(page);

    seed = await seedPipeline(request, authToken, {
      title: "Delete Stage Pipeline",
      status: "DRAFT",
      stageCount: 3,
      stageTitles: ["Screen", "Technical", "Final"],
    });

    await page.goto(`${APP_BASE}/pipeline/${seed.pipeline.id}`);
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, authToken, seed.pipeline.id);
  });

  test("delete buttons are visible on DRAFT pipeline stage cards", async ({
    page,
  }) => {
    // The Trash2 delete button is positioned absolutely on each stage card.
    // Its title attribute is "Delete this stage".
    await expect(page.locator('[data-testid="stage-card"]')).toHaveCount(3, {
      timeout: 10_000,
    });

    const deleteButtons = page.locator('[title="Delete this stage"]');
    await expect(deleteButtons).toHaveCount(3, { timeout: 5_000 });
  });

  test("confirming delete removes the stage column", async ({ page }) => {
    await expect(page.locator('[data-testid="stage-card"]')).toHaveCount(3, {
      timeout: 10_000,
    });

    // Accept the confirmation dialog automatically.
    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    // Click the delete button on the first stage card.
    const firstDeleteButton = page
      .locator('[title="Delete this stage"]')
      .first();
    await firstDeleteButton.click();

    // Should now have 2 stage cards.
    await expect(page.locator('[data-testid="stage-card"]')).toHaveCount(2, {
      timeout: 10_000,
    });
  });

  test("cancelling delete dialog keeps the stage", async ({ page }) => {
    await expect(page.locator('[data-testid="stage-card"]')).toHaveCount(3, {
      timeout: 10_000,
    });

    // Dismiss (cancel) the confirmation dialog.
    page.on("dialog", async (dialog) => {
      await dialog.dismiss();
    });

    const firstDeleteButton = page
      .locator('[title="Delete this stage"]')
      .first();
    await firstDeleteButton.click();

    // Stage count should remain 3.
    await expect(page.locator('[data-testid="stage-card"]')).toHaveCount(3, {
      timeout: 5_000,
    });
  });

  test("delete persists after page reload", async ({ page }) => {
    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    await page
      .locator('[title="Delete this stage"]')
      .first()
      .click();

    await expect(page.locator('[data-testid="stage-card"]')).toHaveCount(2, {
      timeout: 10_000,
    });

    await page.reload();

    // Reloading should still show 2 stages (persisted in D1).
    await expect(page.locator('[data-testid="stage-card"]')).toHaveCount(2, {
      timeout: 10_000,
    });
  });

  test("delete buttons are NOT visible on ACTIVE pipeline", async ({
    page,
    request,
  }) => {
    const activeSeed = await seedPipeline(request, authToken, {
      title: "Active — No Delete",
      status: "ACTIVE",
      stageCount: 2,
    });

    try {
      await page.goto(`${APP_BASE}/pipeline/${activeSeed.pipeline.id}`);
      await expect(page.locator('[data-testid="stage-card"]')).toHaveCount(2, {
        timeout: 10_000,
      });

      // Delete buttons must not be rendered on ACTIVE pipelines.
      await expect(
        page.locator('[title="Delete this stage"]'),
      ).toHaveCount(0, { timeout: 5_000 });
    } finally {
      await teardownPipeline(request, authToken, activeSeed.pipeline.id);
    }
  });
});

test.describe("Worker API contract — /api/v1/pipelines/:id/overview", () => {
  let seed: SeedResult;
  let authToken: string;

  test.beforeEach(async ({ page, request }) => {
    await page.goto(`${APP_BASE}/`);
    authToken = await getAuthToken(page);

    seed = await seedPipeline(request, authToken, {
      title: "API Contract Pipeline",
      status: "ACTIVE",
      stageCount: 2,
      candidateCount: 2,
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, authToken, seed.pipeline.id);
  });

  test("GET overview returns pipeline, stages, candidates and interviews", async ({
    request,
  }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/pipelines/${seed.pipeline.id}/overview`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      },
    );

    expect(res.status()).toBe(200);

    const body = await res.json() as {
      pipeline: { id: string; title: string; status: string };
      stages: Array<{ id: string; title: string; sortOrder: number }>;
      candidates: Array<{
        id: string;
        name: string;
        email: string;
        status: string;
        currentStageId: string;
        inviteToken: string;
      }>;
      interviews: unknown[];
    };

    // Pipeline shape.
    expect(body.pipeline.id).toBe(seed.pipeline.id);
    expect(body.pipeline.title).toBe("API Contract Pipeline");
    expect(body.pipeline.status).toBe("ACTIVE");

    // Stages.
    expect(body.stages).toHaveLength(2);
    expect(body.stages[0]).toMatchObject({
      id: expect.any(String),
      title: expect.any(String),
      sortOrder: expect.any(Number),
    });

    // Candidates.
    expect(body.candidates).toHaveLength(2);
    expect(body.candidates[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      email: expect.any(String),
      status: expect.any(String),
      currentStageId: expect.any(String),
      inviteToken: expect.any(String),
    });

    // Interviews array present (may be empty).
    expect(Array.isArray(body.interviews)).toBe(true);
  });

  test("GET overview returns 401 without auth token", async ({ playwright }) => {
    const unauthRequest = await playwright.request.newContext();
    try {
      const res = await unauthRequest.get(
        `${API_BASE}/api/v1/pipelines/${seed.pipeline.id}/overview`,
      );
      expect(res.status()).toBe(401);
    } finally {
      await unauthRequest.dispose();
    }
  });

  test("GET overview returns 404 for non-existent pipeline", async ({
    request,
  }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/pipelines/nonexistent-id-000/overview`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      },
    );
    expect(res.status()).toBe(404);
  });

  test("POST stage creates a stage with correct pipelineId and sortOrder", async ({
    request,
  }) => {
    const res = await request.post(
      `${API_BASE}/api/v1/pipelines/${seed.pipeline.id}/stages`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        data: { title: "Contract Test Stage", sortOrder: 99 },
      },
    );

    expect(res.status()).toBe(201);
    const body = await res.json() as {
      stage: { id: string; pipelineId: string; title: string; sortOrder: number };
    };
    expect(body.stage.pipelineId).toBe(seed.pipeline.id);
    expect(body.stage.title).toBe("Contract Test Stage");
    expect(body.stage.sortOrder).toBe(99);
  });

  test("POST candidate creates a candidate with an inviteToken", async ({
    request,
  }) => {
    const firstStageId = seed.stages[0]!.id;
    const res = await request.post(
      `${API_BASE}/api/v1/pipelines/${seed.pipeline.id}/candidates`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        data: {
          name: "Token Test",
          email: "tokentest.e2e@pipe-test.dev",
          currentStageId: firstStageId,
        },
      },
    );

    expect(res.status()).toBe(201);
    const body = await res.json() as {
      candidate: {
        id: string;
        name: string;
        email: string;
        inviteToken: string;
        status: string;
      };
    };
    expect(body.candidate.name).toBe("Token Test");
    expect(body.candidate.inviteToken).toBeTruthy();
    expect(body.candidate.status).toBe("INVITED");
  });

  test("DELETE stage cascade-deletes and returns 204", async ({ request }) => {
    // Create a disposable stage to delete without touching the seeded stages.
    const createRes = await request.post(
      `${API_BASE}/api/v1/pipelines/${seed.pipeline.id}/stages`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        data: { title: "Disposable Stage", sortOrder: 50 },
      },
    );
    const { stage } = await createRes.json() as { stage: { id: string } };

    const deleteRes = await request.delete(
      `${API_BASE}/api/v1/stages/${stage.id}`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      },
    );
    expect(deleteRes.status()).toBe(204);

    // Verify it no longer appears in the overview.
    const overviewRes = await request.get(
      `${API_BASE}/api/v1/pipelines/${seed.pipeline.id}/overview`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      },
    );
    const overview = await overviewRes.json() as {
      stages: Array<{ id: string }>;
    };
    const stageIds = overview.stages.map((s) => s.id);
    expect(stageIds).not.toContain(stage.id);
  });

  test("PATCH stages/reorder updates sortOrder values atomically", async ({
    request,
  }) => {
    const [stageA, stageB] = seed.stages;
    if (!stageA || !stageB) {
      test.skip();
      return;
    }

    // Swap the order of the two seeded stages.
    const reorderRes = await request.patch(
      `${API_BASE}/api/v1/pipelines/${seed.pipeline.id}/stages/reorder`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        data: {
          stages: [
            { id: stageA.id, sortOrder: 1 },
            { id: stageB.id, sortOrder: 0 },
          ],
        },
      },
    );
    expect(reorderRes.status()).toBe(200);

    // Verify the new order is reflected in the overview.
    const overviewRes = await request.get(
      `${API_BASE}/api/v1/pipelines/${seed.pipeline.id}/overview`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      },
    );
    const overview = await overviewRes.json() as {
      stages: Array<{ id: string; sortOrder: number }>;
    };

    const reorderedA = overview.stages.find((s) => s.id === stageA.id);
    const reorderedB = overview.stages.find((s) => s.id === stageB.id);
    expect(reorderedA?.sortOrder).toBe(1);
    expect(reorderedB?.sortOrder).toBe(0);
  });
});
