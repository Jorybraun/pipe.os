/**
 * e2e/stage-detail.spec.ts
 *
 * BDD: Stage Detail Page — /pipeline/:id/stages/:stageId
 *
 * These tests define the TARGET behaviour after Phase 2 of the Cloudflare
 * Workers migration.  They are written before the implementation and are
 * expected to fail until the Cloudflare API and migrated UI are complete.
 *
 * All data is seeded via the Workers REST API before each test group and torn
 * down afterwards.  No Amplify / AppSync calls are made from tests.
 *
 * Feature coverage
 * ────────────────
 *   §2.4  Add challenge to stage (template library + GitHub PR)
 *   §2.5  Configure challenge settings (title, instructions, save)
 *   §Stage display   Title, description, challenge list, badge colours, count
 *   §Stage settings  Time limit, mode toggle (ASYNC / LIVE_VIDEO)
 *   §Email templates INVITATION / SUCCESS / FAILURE template save
 *   §Challenge reorder  Drag-and-drop (skipped — manual testing only)
 *   §Delete challenge   Confirm dialog, removal from list
 *
 * Projects: authenticated  (playwright.config.ts)
 * API base:  http://localhost:8787
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { API_BASE } from './env';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SeedPipeline {
  id: string;
  title: string;
}

interface SeedStage {
  id: string;
  title: string;
  pipelineId: string;
}

interface SeedChallenge {
  id: string;
  title: string;
  type: string;
  stageId: string;
  order: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Return the Clerk session token stored in Playwright's auth state so we can
 * attach it to direct API calls made from request fixtures.
 *
 * Clerk persists its session as a cookie named `__session`. We extract it from
 * the browser context's cookie jar to authenticate Worker API seeding calls.
 */
async function getAuthToken(page: Page): Promise<string> {
  // Wait for Clerk JS to refresh the session token (the stored JWT may be
  // expired). networkidle ensures the async token refresh has completed.
  await page.waitForLoadState("networkidle");

  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "__session");
  if (!sessionCookie) {
    throw new Error(
      "No __session cookie found. Make sure the auth_setup project ran first.",
    );
  }
  return sessionCookie.value;
}

/**
 * Seed a pipeline via the Worker API.
 * Returns the created pipeline's id and title.
 */
async function seedPipeline(
  request: APIRequestContext,
  token: string,
  title = "E2E Test Pipeline",
): Promise<SeedPipeline> {
  const res = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title, status: "DRAFT" },
  });
  expect(res.status(), `POST /pipelines failed: ${await res.text()}`).toBe(201);
  const body = await res.json();
  return { id: body.id as string, title: body.title as string };
}

/**
 * Seed a stage inside the given pipeline.
 */
async function seedStage(
  request: APIRequestContext,
  token: string,
  pipelineId: string,
  title = "Technical Screen",
): Promise<SeedStage> {
  const res = await request.post(
    `${API_BASE}/api/v1/pipelines/${pipelineId}/stages`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { title, order: 0 },
    },
  );
  expect(res.status(), `POST /stages failed: ${await res.text()}`).toBe(201);
  const body = await res.json();
  return {
    id: body.id as string,
    title: body.title as string,
    pipelineId,
  };
}

/**
 * Seed a challenge inside the given stage.
 */
async function seedChallenge(
  request: APIRequestContext,
  token: string,
  stageId: string,
  overrides: Partial<{
    type: string;
    title: string;
    instructions: string;
    config: Record<string, unknown>;
    order: number;
  }> = {},
): Promise<SeedChallenge> {
  const payload = {
    type: "QUIZ_MCQ",
    title: "Sample Question",
    instructions: "Pick the best answer.",
    config: {},
    order: 0,
    ...overrides,
  };
  const res = await request.post(
    `${API_BASE}/api/v1/stages/${stageId}/challenges`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: payload,
    },
  );
  expect(res.status(), `POST /challenges failed: ${await res.text()}`).toBe(201);
  const body = await res.json();
  return {
    id: body.id as string,
    title: body.title as string,
    type: body.type as string,
    stageId,
    order: body.order as number,
  };
}

/**
 * Delete a pipeline (cascades stages + challenges).
 * Used in afterAll cleanup.  Failures are swallowed so they never mask real
 * test failures.
 */
async function teardownPipeline(
  request: APIRequestContext,
  token: string,
  pipelineId: string,
): Promise<void> {
  try {
    await request.delete(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Intentionally ignored — cleanup should not obscure test failures.
  }
}

// ─── Suite: Stage Detail Display ─────────────────────────────────────────────

test.describe("Feature: Stage Detail — display", () => {
  let pipeline: SeedPipeline;
  let stage: SeedStage;
  let challenges: SeedChallenge[];
  let token: string;

  test.beforeAll(async ({ request, browser }) => {
    // Acquire a page solely to extract the Clerk token from auth state.
    const context = await browser.newContext({
      storageState: "playwright/.auth/user.json",
    });
    const page = await context.newPage();
    await page.goto("/");
    token = await getAuthToken(page);
    await context.close();

    pipeline = await seedPipeline(request, token, "Display Test Pipeline");
    stage = await seedStage(request, token, pipeline.id, "Screen Round");
    challenges = await Promise.all([
      seedChallenge(request, token, stage.id, {
        type: "CODE_REVIEW",
        title: "Review the PR",
        order: 0,
      }),
      seedChallenge(request, token, stage.id, {
        type: "CODE_IMPLEMENTATION",
        title: "Implement Binary Search",
        order: 1,
      }),
      seedChallenge(request, token, stage.id, {
        type: "QUIZ_MCQ",
        title: "JavaScript Fundamentals",
        order: 2,
      }),
    ]);
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, token, pipeline.id);
  });

  test("Scenario: page displays stage title", async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await expect(
      page.getByText("Screen Round"),
    ).toBeVisible({ timeout: 15000 });
  });

  test("Scenario: page shows challenge count", async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    // SubTitle renders "CHALLENGES (3)"
    await expect(
      page.getByText(/CHALLENGES\s*\(\s*3\s*\)/),
    ).toBeVisible({ timeout: 15000 });
  });

  test("Scenario: challenges are listed in order", async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState("networkidle");

    const titles = await page
      .locator('[data-testid="challenge-card"]')
      .evaluateAll((els) => els.map((el) => el.textContent ?? ""));

    // All three challenge titles must appear, in insertion order.
    expect(
      titles.some((t) => t.includes("Review the PR")),
    ).toBe(true);
    expect(
      titles.some((t) => t.includes("Implement Binary Search")),
    ).toBe(true);
    expect(
      titles.some((t) => t.includes("JavaScript Fundamentals")),
    ).toBe(true);

    // The first visible challenge title (by DOM order) should be the lowest
    // order value.  We find each title's index and assert order.
    const reviewIdx = titles.findIndex((t) => t.includes("Review the PR"));
    const implIdx = titles.findIndex((t) => t.includes("Implement Binary Search"));
    const quizIdx = titles.findIndex((t) => t.includes("JavaScript Fundamentals"));
    expect(reviewIdx).toBeLessThan(implIdx);
    expect(implIdx).toBeLessThan(quizIdx);
  });

  test("Scenario: CODE_REVIEW challenge displays blue type badge", async ({
    page,
  }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState("networkidle");

    // The badge text is the type label — ChallengeCard strips "QUIZ_" prefix but
    // CODE_REVIEW stays as-is.
    const badge = page.getByText("CODE_REVIEW").first();
    await expect(badge).toBeVisible({ timeout: 15000 });
    // Colour is applied as inline `color` style — verify the hex matches design
    // system spec: #60a5fa (blue).
    const color = await badge.evaluate(
      (el) => getComputedStyle(el).color,
    );
    // rgb(96, 165, 250) is #60a5fa
    expect(color).toMatch(/rgb\(96,\s*165,\s*250\)/);
  });

  test("Scenario: CODE_IMPLEMENTATION challenge displays purple type badge", async ({
    page,
  }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState("networkidle");

    const badge = page.getByText("CODE_IMPLEMENTATION").first();
    await expect(badge).toBeVisible({ timeout: 15000 });
    // rgb(167, 139, 250) is #a78bfa (purple)
    const color = await badge.evaluate(
      (el) => getComputedStyle(el).color,
    );
    expect(color).toMatch(/rgb\(167,\s*139,\s*250\)/);
  });

  test("Scenario: empty stage shows ADD_FIRST_CHALLENGE prompt", async ({
    page,
    request,
  }) => {
    const emptyStage = await seedStage(
      request,
      token,
      pipeline.id,
      "Empty Stage",
    );
    await page.goto(`/pipeline/${pipeline.id}/stages/${emptyStage.id}`);

    await expect(
      page.getByText(/No challenges added to this stage yet/),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("button", { name: /ADD_FIRST_CHALLENGE/ }),
    ).toBeVisible();

    // Cleanup the extra stage
    await request.delete(`${API_BASE}/api/v1/stages/${emptyStage.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  });
});

// ─── Suite: §2.4 Add Challenge to Stage ──────────────────────────────────────

test.describe("Feature: §2.4 Add challenge to stage", () => {
  let pipeline: SeedPipeline;
  let stage: SeedStage;
  let token: string;

  test.beforeAll(async ({ request, browser }) => {
    const context = await browser.newContext({
      storageState: "playwright/.auth/user.json",
    });
    const page = await context.newPage();
    await page.goto("/");
    token = await getAuthToken(page);
    await context.close();

    pipeline = await seedPipeline(request, token, "Add Challenge Test Pipeline");
    stage = await seedStage(request, token, pipeline.id, "Technical Screen");
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, token, pipeline.id);
  });

  test("Scenario: ADD_CHALLENGE button opens challenge picker", async ({
    page,
  }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await expect(page.getByRole("button", { name: /ADD_CHALLENGE/ })).toBeVisible(
      { timeout: 15000 },
    );
    await page.getByRole("button", { name: /ADD_CHALLENGE/ }).click();

    // ChallengePicker dialog must become visible
    await expect(
      page.locator('[data-testid="challenge-picker"]').or(
        page.getByRole("dialog"),
      ).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("Scenario: adding a CODE_IMPLEMENTATION template from library creates challenge and updates list", async ({
    page,
  }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState("networkidle");

    // Record challenge count before add
    const before = await page
      .locator('[data-testid="challenge-card"]')
      .count();

    // Open picker
    await page.getByRole("button", { name: /ADD_CHALLENGE/ }).click();

    // Wait for picker content to render
    const picker = page
      .locator('[data-testid="challenge-picker"]')
      .or(page.getByRole("dialog"))
      .first();
    await expect(picker).toBeVisible({ timeout: 5000 });

    // Filter / select first CODE_IMPLEMENTATION template
    // The picker renders a list of templates with type badges.
    const codeImplTemplate = picker
      .getByText("CODE_IMPLEMENTATION")
      .first();
    await expect(codeImplTemplate).toBeVisible({ timeout: 10000 });

    // Click the template to select it
    await codeImplTemplate.click();

    // Confirm the selection — picker may have an "ADD" or confirm button
    const confirmBtn = picker
      .getByRole("button", { name: /ADD|CONFIRM|SELECT/i })
      .first();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // Picker should close
    await expect(
      page.locator('[data-testid="challenge-picker"]').or(
        page.getByRole("dialog"),
      ).first(),
    ).not.toBeVisible({ timeout: 10000 });

    // Challenge list should have grown by 1
    await expect(
      page.locator('[data-testid="challenge-card"]'),
    ).toHaveCount(before + 1, { timeout: 15000 });

    // Worker API: verify the challenge was persisted
    const stageRes = await page.request.get(
      `${API_BASE}/api/v1/stages/${stage.id}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    expect(stageRes.status()).toBe(200);
    const stageData = await stageRes.json();
    const newChallenge = stageData.challenges?.find(
      (c: { type: string }) => c.type === "CODE_IMPLEMENTATION",
    );
    expect(newChallenge).toBeDefined();
    expect(newChallenge.stageId ?? newChallenge.stage_id).toBe(stage.id);
    expect(newChallenge.order).toBe(before); // order = previous count
  });

  test("Scenario: Add CODE_REVIEW challenge from GitHub PR", async ({
    page,
  }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState("networkidle");

    const before = await page
      .locator('[data-testid="challenge-card"]')
      .count();

    await page.getByRole("button", { name: /ADD_CHALLENGE/ }).click();

    const picker = page
      .locator('[data-testid="challenge-picker"]')
      .or(page.getByRole("dialog"))
      .first();
    await expect(picker).toBeVisible({ timeout: 5000 });

    // Switch to "GitHub PR" tab / mode inside the picker
    const ghTab = picker.getByRole("tab", { name: /GitHub|PR/i }).or(
      picker.getByRole("button", { name: /GitHub|PR/i }),
    ).first();
    await expect(ghTab).toBeVisible({ timeout: 5000 });
    await ghTab.click();

    // Fill repo URL and PR number
    const repoInput = picker.getByPlaceholder(/repo|github\.com/i).first();
    await expect(repoInput).toBeVisible({ timeout: 5000 });
    await repoInput.fill("https://github.com/facebook/react");

    const prInput = picker.getByPlaceholder(/PR|number|#/i).first();
    await expect(prInput).toBeVisible({ timeout: 5000 });
    await prInput.fill("30000");

    // Fetch / confirm — target the FETCH button adjacent to the PR number input
    const fetchBtn = picker.locator('button', { hasText: /^FETCH$/ }).first();
    await fetchBtn.click();

    // Picker should eventually close after successful creation
    await expect(
      page.locator('[data-testid="challenge-picker"]').or(
        page.getByRole("dialog"),
      ).first(),
    ).not.toBeVisible({ timeout: 20000 });

    // A new CODE_REVIEW card appears in the list
    await expect(
      page.locator('[data-testid="challenge-card"]'),
    ).toHaveCount(before + 1, { timeout: 15000 });

    // Worker API: challenge should have github_repo_url and github_pr_number
    const stageRes = await page.request.get(
      `${API_BASE}/api/v1/stages/${stage.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const stageData = await stageRes.json();
    const prChallenge = stageData.challenges?.find(
      (c: { type: string; github_repo_url?: string }) =>
        c.type === "CODE_REVIEW" && c.github_repo_url,
    );
    expect(prChallenge).toBeDefined();
    expect(prChallenge.github_repo_url).toContain("github.com/facebook/react");
    expect(prChallenge.github_pr_number).toBe(30000);
  });
});

// ─── Suite: §2.5 Configure Challenge Settings ────────────────────────────────

test.describe("Feature: §2.5 Configure challenge settings", () => {
  let pipeline: SeedPipeline;
  let stage: SeedStage;
  let challenge: SeedChallenge;
  let token: string;

  test.beforeAll(async ({ request, browser }) => {
    const context = await browser.newContext({
      storageState: "playwright/.auth/user.json",
    });
    const page = await context.newPage();
    await page.goto("/");
    token = await getAuthToken(page);
    await context.close();

    pipeline = await seedPipeline(request, token, "Challenge Settings Pipeline");
    stage = await seedStage(request, token, pipeline.id, "Config Stage");
    challenge = await seedChallenge(request, token, stage.id, {
      type: "QUIZ_MCQ",
      title: "Original Title",
      instructions: "Original instructions.",
      order: 0,
    });
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, token, pipeline.id);
  });

  test("Scenario: recruiter edits challenge title and instructions, saves persists changes", async ({
    page,
  }) => {
    // Navigate to the challenge editor
    await page.goto(
      `/pipeline/${pipeline.id}/challenges/${challenge.id}`,
    );
    await page.waitForLoadState("networkidle");

    // Title field
    const titleInput = page
      .getByRole("textbox", { name: /title/i })
      .or(page.locator('input[placeholder*="title" i]'))
      .or(page.locator('[data-testid="challenge-title-input"]'))
      .first();
    await expect(titleInput).toBeVisible({ timeout: 15000 });
    await titleInput.triple_click?.();
    await titleInput.selectText?.().catch(() => null);
    await titleInput.fill("Updated Title");

    // Instructions field
    const instructionsInput = page
      .getByRole("textbox", { name: /instructions/i })
      .or(page.locator('textarea[placeholder*="instructions" i]'))
      .or(page.locator('[data-testid="challenge-instructions-input"]'))
      .first();
    await expect(instructionsInput).toBeVisible({ timeout: 5000 });
    await instructionsInput.fill("Updated instructions text.");

    // Save
    const saveBtn = page
      .getByRole("button", { name: /SAVE/i })
      .first();
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();

    // Success indicator
    await expect(
      page
        .getByText(/saved|success/i)
        .or(page.locator('[data-testid="save-success"]'))
        .first(),
    ).toBeVisible({ timeout: 10000 });

    // Reload and verify persistence
    await page.reload();
    await page.waitForLoadState("networkidle");

    const titleAfterReload = page
      .getByRole("textbox", { name: /title/i })
      .or(page.locator('input[placeholder*="title" i]'))
      .or(page.locator('[data-testid="challenge-title-input"]'))
      .first();
    await expect(titleAfterReload).toHaveValue("Updated Title", {
      timeout: 15000,
    });

    // Worker API: confirm D1 was updated
    const apiRes = await page.request.get(
      `${API_BASE}/api/v1/challenges/${challenge.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(apiRes.status()).toBe(200);
    const apiData = await apiRes.json();
    expect(apiData.title).toBe("Updated Title");
    expect(apiData.instructions).toBe("Updated instructions text.");
  });
});

// ─── Suite: Stage Settings ────────────────────────────────────────────────────

test.describe("Feature: Stage settings", () => {
  let pipeline: SeedPipeline;
  let stage: SeedStage;
  let token: string;

  test.beforeAll(async ({ request, browser }) => {
    const context = await browser.newContext({
      storageState: "playwright/.auth/user.json",
    });
    const page = await context.newPage();
    await page.goto("/");
    token = await getAuthToken(page);
    await context.close();

    pipeline = await seedPipeline(request, token, "Stage Settings Pipeline");
    stage = await seedStage(request, token, pipeline.id, "Settings Stage");
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, token, pipeline.id);
  });

  test("Scenario: recruiter updates stage title inline and it persists", async ({
    page,
  }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState("networkidle");

    // The stage title is an inline <input> at the top of the page
    const titleInput = page
      .locator('input[placeholder="Stage Title"]')
      .or(page.locator('[data-testid="stage-title-input"]'))
      .first();
    await expect(titleInput).toBeVisible({ timeout: 15000 });
    await titleInput.fill("Renamed Stage Title");
    // Trigger the onBlur save
    await titleInput.blur();

    // Give the Worker PATCH call time to complete
    await page.waitForTimeout(1500);

    // Verify via API
    const res = await page.request.get(
      `${API_BASE}/api/v1/stages/${stage.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("Renamed Stage Title");
  });

  test("Scenario: recruiter sets time limit and it persists", async ({
    page,
  }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState("networkidle");

    // Time limit is a number <input> labelled "DEFAULT_TIME_LIMIT (MINS)"
    const timeLimitInput = page
      .locator('input[type="number"][placeholder="Untimed"]')
      .or(page.locator('[data-testid="stage-time-limit-input"]'))
      .first();
    await expect(timeLimitInput).toBeVisible({ timeout: 15000 });
    await timeLimitInput.fill("45");
    // The current implementation saves on the change event; trigger blur too.
    await timeLimitInput.blur();

    await page.waitForTimeout(1500);

    const res = await page.request.get(
      `${API_BASE}/api/v1/stages/${stage.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.time_limit ?? data.timeLimit).toBe(45);
  });

  test("Scenario: STAGE_SETTINGS section is visible in sidebar", async ({
    page,
  }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await expect(page.getByText("STAGE_SETTINGS")).toBeVisible({
      timeout: 15000,
    });
  });

  test("Scenario: ASYNC mode is the default selected mode", async ({
    page,
  }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState("networkidle");

    // STAGE_MODE toggle is only rendered when FEATURE_FLAG_LIVE_VIDEO is enabled.
    // We check for the toggle if it is present; skip silently if not.
    const asyncBtn = page.getByRole("button", { name: /^ASYNC$/ }).first();
    const isModeVisible = await asyncBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (!isModeVisible) {
      test.skip(
        true,
        "STAGE_MODE toggle not visible — FEATURE_FLAG_LIVE_VIDEO is disabled",
      );
      return;
    }

    // ASYNC button should appear visually active (white background / colour)
    const asyncStyle = await asyncBtn.evaluate(
      (el) => getComputedStyle(el).background,
    );
    expect(asyncStyle).not.toBe("transparent");
  });
});

// ─── Suite: Email Notification Templates ──────────────────────────────────────

test.describe("Feature: Email notification templates", () => {
  let pipeline: SeedPipeline;
  let stage: SeedStage;
  let token: string;

  test.beforeAll(async ({ request, browser }) => {
    const context = await browser.newContext({
      storageState: "playwright/.auth/user.json",
    });
    const page = await context.newPage();
    await page.goto("/");
    token = await getAuthToken(page);
    await context.close();

    pipeline = await seedPipeline(request, token, "Email Templates Pipeline");
    stage = await seedStage(request, token, pipeline.id, "Notification Stage");
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, token, pipeline.id);
  });

  test("Scenario: EMAIL_TEMPLATES section is visible with three trigger rows", async ({
    page,
  }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await expect(page.getByText("EMAIL_TEMPLATES")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("INVITATION")).toBeVisible();
    await expect(page.getByText("SUCCESS")).toBeVisible();
    await expect(page.getByText("FAILURE")).toBeVisible();
  });

  test("Scenario: recruiter saves INVITATION email template and it persists", async ({
    page,
  }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState("networkidle");

    // Expand the INVITATION row
    await page.getByRole("button", { name: /INVITATION/i }).click();

    // Fill subject
    const subjectInput = page.locator('input').filter({ hasText: "" }).nth(1);
    // The subject input is within the expanded section — use a more robust selector
    const subjectField = page
      .locator('[data-testid="template-subject-input"]')
      .or(page.locator('label:has-text("SUBJECT") + input'))
      .or(page.locator('input').nth(1))
      .first();
    await expect(subjectField).toBeVisible({ timeout: 5000 });
    await subjectField.fill("You have been invited to interview");

    // Fill body
    const bodyField = page
      .locator('[data-testid="template-body-input"]')
      .or(page.locator('label:has-text("BODY") + textarea'))
      .or(page.locator('textarea').first())
      .first();
    await expect(bodyField).toBeVisible({ timeout: 5000 });
    await bodyField.fill(
      "<p>Hi {{name}}, you are invited to complete the {{pipelineName}} assessment.</p>",
    );

    // Save
    await page.getByRole("button", { name: /SAVE_TEMPLATE/i }).click();

    // Success: the edit panel collapses (editingTemplate becomes null)
    await expect(
      page.getByRole("button", { name: /SAVE_TEMPLATE/i }),
    ).not.toBeVisible({ timeout: 10000 });

    // A filled-template indicator (green dot ●) should appear next to INVITATION
    await expect(page.getByText("●")).toBeVisible({ timeout: 5000 });

    // Reload to verify the template was persisted
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /INVITATION/i }).click();

    const subjectAfterReload = page
      .locator('[data-testid="template-subject-input"]')
      .or(page.locator('label:has-text("SUBJECT") + input'))
      .first();
    await expect(subjectAfterReload).toHaveValue(
      "You have been invited to interview",
      { timeout: 10000 },
    );

    // Worker API: verify templates are stored in D1
    const res = await page.request.get(
      `${API_BASE}/api/v1/stages/${stage.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status()).toBe(200);
    const data = await res.json();
    const templates: Array<{ trigger: string; subject: string; body: string }> =
      typeof data.notification_templates === "string"
        ? JSON.parse(data.notification_templates)
        : (data.notification_templates ?? []);
    const inviteTemplate = templates.find((t) => t.trigger === "INVITATION");
    expect(inviteTemplate).toBeDefined();
    expect(inviteTemplate!.subject).toBe("You have been invited to interview");
  });

  test("Scenario: cancel button closes the template editor without saving", async ({
    page,
  }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /SUCCESS/i }).click();

    const bodyField = page
      .locator('textarea')
      .first();
    await expect(bodyField).toBeVisible({ timeout: 5000 });
    await bodyField.fill("This should not be saved.");

    await page.getByRole("button", { name: /CANCEL/i }).click();

    // Editor should be gone
    await expect(
      page.getByRole("button", { name: /SAVE_TEMPLATE/i }),
    ).not.toBeVisible({ timeout: 5000 });

    // The body text we typed must not appear in the API response
    const res = await page.request.get(
      `${API_BASE}/api/v1/stages/${stage.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await res.json();
    const templates: Array<{ trigger: string; body: string }> =
      typeof data.notification_templates === "string"
        ? JSON.parse(data.notification_templates)
        : (data.notification_templates ?? []);
    const successTemplate = templates.find((t) => t.trigger === "SUCCESS");
    expect(successTemplate?.body ?? "").not.toContain("This should not be saved");
  });
});

// ─── Suite: Delete Challenge ──────────────────────────────────────────────────

test.describe("Feature: Delete challenge", () => {
  let pipeline: SeedPipeline;
  let stage: SeedStage;
  let challengeToDelete: SeedChallenge;
  let token: string;

  test.beforeAll(async ({ request, browser }) => {
    const context = await browser.newContext({
      storageState: "playwright/.auth/user.json",
    });
    const page = await context.newPage();
    await page.goto("/");
    token = await getAuthToken(page);
    await context.close();

    pipeline = await seedPipeline(request, token, "Delete Challenge Pipeline");
    stage = await seedStage(request, token, pipeline.id, "Delete Stage");
  });

  test.beforeEach(async ({ request }) => {
    // Recreate the challenge before every test so each scenario starts clean.
    challengeToDelete = await seedChallenge(request, token, stage.id, {
      type: "QUIZ_MCQ",
      title: "Challenge To Delete",
      order: 0,
    });
  });

  test.afterEach(async ({ request }) => {
    // Clean up the challenge if it survived (e.g. dismissed confirm dialog test).
    try {
      await request.delete(`${API_BASE}/api/v1/challenges/${challengeToDelete.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Already deleted — ignore
    }
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, token, pipeline.id);
  });

  test("Scenario: delete button triggers confirm dialog", async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Challenge To Delete")).toBeVisible({
      timeout: 15000,
    });

    // Handle the window.confirm dialog — accept it.
    page.once("dialog", (dialog) => dialog.accept());

    // Click the Trash2 delete button on the challenge card.
    // ChallengeCard renders a <button> with a Trash2 icon but no text label,
    // so we target it by its position relative to the challenge card.
    const card = page
      .locator('[data-testid="challenge-card"]')
      .filter({ hasText: "Challenge To Delete" });
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.getByRole("button").last().click();

    // After confirmation, the card should disappear from the list.
    await expect(
      page.getByText("Challenge To Delete"),
    ).not.toBeVisible({ timeout: 10000 });
  });

  test("Scenario: dismissed confirm dialog leaves challenge in list", async ({
    page,
  }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Challenge To Delete")).toBeVisible({
      timeout: 15000,
    });

    // Dismiss the dialog (cancel the delete).
    page.once("dialog", (dialog) => dialog.dismiss());

    const card = page
      .locator('[data-testid="challenge-card"]')
      .filter({ hasText: "Challenge To Delete" });
    await card.getByRole("button").last().click();

    // Challenge should still be visible.
    await expect(
      page.getByText("Challenge To Delete"),
    ).toBeVisible({ timeout: 5000 });
  });

  test("Scenario: deleted challenge is removed from Worker API", async ({
    page,
    request,
  }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState("networkidle");

    // Delete via UI
    page.once("dialog", (dialog) => dialog.accept());
    const card = page
      .locator('[data-testid="challenge-card"]')
      .filter({ hasText: "Challenge To Delete" });
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.getByRole("button").last().click();
    await expect(page.getByText("Challenge To Delete")).not.toBeVisible({
      timeout: 10000,
    });

    // Worker API should return 404 for the deleted challenge
    const res = await request.get(
      `${API_BASE}/api/v1/challenges/${challengeToDelete.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status()).toBe(404);
  });
});

// ─── Suite: Challenge Reorder (drag-and-drop) ─────────────────────────────────

test.describe("Feature: Challenge reorder (drag-and-drop)", () => {
  let pipeline: SeedPipeline;
  let stage: SeedStage;
  let challenges: SeedChallenge[];
  let token: string;

  test.beforeAll(async ({ request, browser }) => {
    const context = await browser.newContext({
      storageState: "playwright/.auth/user.json",
    });
    const page = await context.newPage();
    await page.goto("/");
    token = await getAuthToken(page);
    await context.close();

    pipeline = await seedPipeline(request, token, "Reorder Pipeline");
    stage = await seedStage(request, token, pipeline.id, "Reorder Stage");
    challenges = await Promise.all([
      seedChallenge(request, token, stage.id, { title: "Challenge Alpha", order: 0 }),
      seedChallenge(request, token, stage.id, { title: "Challenge Beta", order: 1 }),
      seedChallenge(request, token, stage.id, { title: "Challenge Gamma", order: 2 }),
    ]);
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, token, pipeline.id);
  });

  // Drag-and-drop requires real pointer events that are difficult to simulate
  // reliably in headless Playwright.  These tests are skipped until a helper
  // (e.g. playwright-dnd) is added or we implement keyboard-based reorder.
  test.skip(
    true,
    "TODO: drag-and-drop reorder — requires pointer simulation or keyboard DnD support",
  );

  test("Scenario: drag challenge to new position updates order", async ({
    page,
  }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState("networkidle");

    const cards = page.locator('[data-testid="challenge-card"]');
    await expect(cards).toHaveCount(3, { timeout: 15000 });

    // TODO: Drag "Challenge Gamma" (index 2) above "Challenge Alpha" (index 0)
    // using @dnd-kit keyboard sensor or a custom drag helper.
    //
    // Expected result:
    //   - UI updates immediately to [Gamma, Alpha, Beta]
    //   - PATCH /api/v1/stages/:stageId/challenges/reorder is sent with:
    //       [{ id: gamma.id, order: 0 }, { id: alpha.id, order: 1 }, { id: beta.id, order: 2 }]
    //   - Reload confirms the new order is persisted.
    throw new Error("Not implemented — see TODO above");
  });

  test("Scenario: order persists after page reload", async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState("networkidle");

    // TODO: After a drag reorder, reload and verify order is maintained.
    throw new Error("Not implemented — see TODO above");
  });
});
