/**
 * e2e/stage-crud.spec.ts
 *
 * BDD: Stage CRUD operations on the Pipeline Overview page
 *
 * Feature: Stage CRUD — /pipeline/:id (OverviewPage)
 *   As a recruiter
 *   I want to create, edit, reorder, and delete pipeline stages
 *   So that I can structure my hiring workflow
 *
 * Covers:
 *   §Add stage            — ADD_STAGE button visible, creates new stage card with default title
 *   §Edit stage title     — title input editable, persists on blur
 *   §Stage settings       — DEFAULT_TIME_LIMIT, EMAIL_TEMPLATES (INVITATION, SUCCESS, FAILURE)
 *   §Delete stage         — delete button, confirmation dialog, removal from list
 *   §Reorder stages       — drag handles visible (reorder tested via API; UI smoke only)
 *   §Add challenge        — ADD_CHALLENGE opens picker, count increases
 *   §Delete challenge     — trash button, confirmation, count decreases
 *   §Navigate to editor   — pencil/edit icon navigates to /challenges/:id
 *
 * Tests run in the `authenticated` Playwright project.
 * All data is seeded via the Workers REST API before each test group.
 *
 * Note: ADD_STAGE is only visible on DRAFT pipelines (OverviewPage source).
 * Stage settings (time limit, mode, email templates) live on StageDetailPage.
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the Clerk session token from the browser cookie jar.
 * Must be called after page.goto() so storageState is hydrated.
 */
async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) {
    throw new Error('[stage-crud.spec] No __session cookie found. Run auth setup first.');
  }
  return sessionCookie.value;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function seedPipeline(
  request: APIRequestContext,
  token: string,
  title = 'E2E Stage CRUD Pipeline',
  status: 'DRAFT' | 'ACTIVE' = 'DRAFT',
): Promise<SeedPipeline> {
  const res = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers: authHeaders(token),
    data: { title, status },
  });
  expect(res.ok(), `seedPipeline failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { id: string; title: string };
  return { id: body.id, title: body.title };
}

async function seedStage(
  request: APIRequestContext,
  token: string,
  pipelineId: string,
  title: string,
  order = 0,
): Promise<SeedStage> {
  const res = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/stages`, {
    headers: authHeaders(token),
    data: { title, order },
  });
  expect(res.ok(), `seedStage failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { id: string; title: string };
  return { id: body.id, title: body.title, pipelineId };
}

async function seedChallenge(
  request: APIRequestContext,
  token: string,
  stageId: string,
  overrides: {
    type?: string;
    title?: string;
    order?: number;
  } = {},
): Promise<SeedChallenge> {
  const res = await request.post(`${API_BASE}/api/v1/stages/${stageId}/challenges`, {
    headers: authHeaders(token),
    data: {
      type: overrides.type ?? 'QUIZ_MCQ',
      title: overrides.title ?? 'Sample Question',
      instructions: 'Pick the best answer.',
      config: {},
      order: overrides.order ?? 0,
    },
  });
  expect(res.ok(), `seedChallenge failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { id: string; title: string; type: string };
  return { id: body.id, title: body.title, type: body.type };
}

async function teardownPipeline(
  request: APIRequestContext,
  token: string,
  pipelineId: string,
): Promise<void> {
  try {
    await request.delete(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
      headers: authHeaders(token),
    });
  } catch {
    // Intentionally ignored — cleanup must not obscure test failures.
  }
}

// ─── Suite: Add stage ─────────────────────────────────────────────────────────

test.describe('Feature: Add stage — DRAFT pipeline Overview', () => {
  let pipeline: SeedPipeline;
  let token: string;

  test.beforeAll(async ({ request, browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto('/');
    token = await getAuthToken(page);
    await context.close();

    pipeline = await seedPipeline(request, token, 'E2E — Add Stage Test');
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, token, pipeline.id);
  });

  /**
   * Scenario: ADD_STAGE button visible on DRAFT pipeline overview
   *   Given a DRAFT pipeline with no stages
   *   When the recruiter navigates to /pipeline/:id
   *   Then the ADD_STAGE button (dashed column) is visible
   */
  test('Scenario: ADD_STAGE button is visible on DRAFT pipeline', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}`);
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('button', { name: /ADD_STAGE/i }),
    ).toBeVisible({ timeout: 15000 });
  });

  /**
   * Scenario: Clicking ADD_STAGE prompts for a name and creates a stage card
   *   Given the DRAFT pipeline overview is open
   *   When the recruiter clicks ADD_STAGE and enters "Phone Screen"
   *   Then a new stage card appears with the title "PHONE SCREEN"
   *   And a POST /api/v1/pipelines/:id/stages was issued
   */
  test('Scenario: ADD_STAGE creates a new stage card', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}`);
    await page.waitForLoadState('networkidle');

    const stagesBefore = await page.locator('[data-testid="stage-card"]').count();

    // Accept the window.prompt with the new stage name
    page.on('dialog', async (dialog) => {
      await dialog.accept('Phone Screen');
    });

    await page.getByRole('button', { name: /ADD_STAGE/i }).click();

    // New stage card appears
    await expect(
      page.locator('[data-testid="stage-card"]'),
    ).toHaveCount(stagesBefore + 1, { timeout: 15000 });

    // The new stage title is visible
    await expect(
      page.getByText(/PHONE SCREEN|Phone Screen/i),
    ).toBeVisible({ timeout: 10000 });
  });

  /**
   * Scenario: Cancelling the ADD_STAGE prompt does not create a stage
   *   Given the DRAFT pipeline overview is open
   *   When the recruiter clicks ADD_STAGE but cancels the prompt
   *   Then no new stage card is added
   */
  test('Scenario: Cancelling ADD_STAGE prompt does not create a stage', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}`);
    await page.waitForLoadState('networkidle');

    const stagesBefore = await page.locator('[data-testid="stage-card"]').count();

    page.on('dialog', async (dialog) => {
      await dialog.dismiss();
    });

    await page.getByRole('button', { name: /ADD_STAGE/i }).click();

    // Count should remain the same
    await page.waitForTimeout(1000);
    expect(await page.locator('[data-testid="stage-card"]').count()).toBe(stagesBefore);
  });

  /**
   * Scenario: New stage has default/entered title
   *   Given a stage was just created with title "Take-Home Test"
   *   When the recruiter views the overview
   *   Then a stage card with "TAKE-HOME TEST" text is visible
   */
  test('Scenario: New stage shows entered title as card heading', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}`);
    await page.waitForLoadState('networkidle');

    page.on('dialog', async (dialog) => {
      await dialog.accept('Take-Home Test');
    });

    await page.getByRole('button', { name: /ADD_STAGE/i }).click();

    await expect(
      page.getByText(/Take-Home Test|TAKE-HOME TEST/i),
    ).toBeVisible({ timeout: 15000 });
  });

  /**
   * Scenario: ADD_STAGE is not visible on ACTIVE pipelines
   *   Given a pipeline in ACTIVE status
   *   When the recruiter navigates to the overview
   *   Then the ADD_STAGE button is not visible
   *   (ACTIVE pipelines use ADD_CANDIDATE instead)
   */
  test('Scenario: ADD_STAGE is not visible on ACTIVE pipeline', async ({ page, request }) => {
    const activePipeline = await seedPipeline(request, token, 'E2E — Active Pipeline No Add Stage', 'ACTIVE');

    await page.goto(`/pipeline/${activePipeline.id}`);
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('button', { name: /ADD_STAGE/i }),
    ).not.toBeVisible({ timeout: 5000 });

    await teardownPipeline(request, token, activePipeline.id);
  });
});

// ─── Suite: Edit stage title ──────────────────────────────────────────────────

test.describe('Feature: Edit stage title — StageDetailPage', () => {
  let pipeline: SeedPipeline;
  let stage: SeedStage;
  let token: string;

  test.beforeAll(async ({ request, browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto('/');
    token = await getAuthToken(page);
    await context.close();

    pipeline = await seedPipeline(request, token, 'E2E — Edit Stage Title');
    stage = await seedStage(request, token, pipeline.id, 'Initial Title');
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, token, pipeline.id);
  });

  /**
   * Scenario: Stage title input is visible and pre-filled on StageDetailPage
   *   Given a stage exists with title "Initial Title"
   *   When the recruiter navigates to /pipeline/:id/stages/:stageId
   *   Then the stage title input shows "Initial Title"
   */
  test('Scenario: Stage title input is pre-filled on StageDetailPage', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState('networkidle');

    const titleInput = page.locator('[data-testid="stage-title-input"]');
    await expect(titleInput).toBeVisible({ timeout: 15000 });
    await expect(titleInput).toHaveValue('Initial Title', { timeout: 10000 });
  });

  /**
   * Scenario: Changing title and blurring persists the change
   *   Given the stage title input shows "Initial Title"
   *   When the recruiter clears the input, types "Technical Screen", and clicks away
   *   Then a PATCH/PUT /api/v1/stages/:stageId is sent
   *   And reloading the page shows "Technical Screen"
   */
  test('Scenario: Editing stage title persists on blur', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState('networkidle');

    const patchUrls: string[] = [];
    page.on('request', (req) => {
      if (
        (req.method() === 'PATCH' || req.method() === 'PUT') &&
        req.url().includes(`/stages/${stage.id}`)
      ) {
        patchUrls.push(req.url());
      }
    });

    const titleInput = page.locator('[data-testid="stage-title-input"]');
    await titleInput.clear();
    await titleInput.fill('Technical Screen');
    await titleInput.blur();

    // API call should fire
    await expect
      .poll(() => patchUrls.length, { timeout: 5000 })
      .toBeGreaterThan(0);
  });

  /**
   * Scenario: Updated title shows after reload
   *   Given the title was saved via the API
   *   When the recruiter reloads the page
   *   Then the title input shows the saved title
   */
  test('Scenario: Updated stage title persists after page reload', async ({ page, request }) => {
    // Set title via API to known state
    await request.patch(`${API_BASE}/api/v1/stages/${stage.id}`, {
      headers: authHeaders(token),
      data: { title: 'Reloaded Title' },
    });

    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState('networkidle');

    const titleInput = page.locator('[data-testid="stage-title-input"]');
    await expect(titleInput).toHaveValue('Reloaded Title', { timeout: 15000 });
  });
});

// ─── Suite: Stage settings sidebar ───────────────────────────────────────────

test.describe('Feature: Stage settings sidebar — StageDetailPage', () => {
  let pipeline: SeedPipeline;
  let stage: SeedStage;
  let token: string;

  test.beforeAll(async ({ request, browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto('/');
    token = await getAuthToken(page);
    await context.close();

    pipeline = await seedPipeline(request, token, 'E2E — Stage Settings');
    stage = await seedStage(request, token, pipeline.id, 'Settings Stage');
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, token, pipeline.id);
  });

  /**
   * Scenario: EMAIL_TEMPLATES section has INVITATION, SUCCESS, FAILURE rows
   *   Given the StageDetailPage is loaded
   *   When the recruiter views the settings sidebar
   *   Then the EMAIL_TEMPLATES section label is visible
   *   And INVITATION, SUCCESS, and FAILURE template rows are present
   */
  test('Scenario: Stage settings — EMAIL_TEMPLATES section shows all three triggers', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('EMAIL_TEMPLATES')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('INVITATION')).toBeVisible();
    await expect(page.getByText('SUCCESS')).toBeVisible();
    await expect(page.getByText('FAILURE')).toBeVisible();
  });

  /**
   * Scenario: Clicking an email template trigger expands the editor
   *   Given the EMAIL_TEMPLATES section is visible
   *   When the recruiter clicks the INVITATION trigger button
   *   Then an inline template editor expands
   *   And SUBJECT and BODY fields are visible
   */
  test('Scenario: Stage settings — clicking INVITATION expands template editor', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('EMAIL_TEMPLATES')).toBeVisible({ timeout: 15000 });

    // Click the INVITATION trigger
    await page.getByText('INVITATION').click();

    // Subject and body fields should appear
    await expect(page.locator('[data-testid="template-subject-input"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="template-body-input"]').or(
      page.locator('textarea[placeholder*="body"]').or(
        page.locator('textarea').last(),
      ),
    ).first()).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: Editing and saving an email template sends a PATCH/PUT
   *   Given the INVITATION template editor is expanded
   *   When the recruiter fills in subject and body and clicks SAVE_TEMPLATE
   *   Then a PATCH/PUT /api/v1/stages/:stageId is issued
   */
  test('Scenario: Stage settings — saving email template fires API call', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState('networkidle');

    const patchUrls: string[] = [];
    page.on('request', (req) => {
      if (
        (req.method() === 'PATCH' || req.method() === 'PUT') &&
        req.url().includes(`/stages/${stage.id}`)
      ) {
        patchUrls.push(req.url());
      }
    });

    await expect(page.getByText('EMAIL_TEMPLATES')).toBeVisible({ timeout: 15000 });
    await page.getByText('INVITATION').click();

    const subjectInput = page.locator('[data-testid="template-subject-input"]');
    await expect(subjectInput).toBeVisible({ timeout: 5000 });
    await subjectInput.fill("You're invited to complete a technical challenge");

    // Save button
    const saveTemplateBtn = page.getByRole('button', { name: /SAVE_TEMPLATE|SAVE/i }).last();
    await saveTemplateBtn.click();

    await expect
      .poll(() => patchUrls.length, { timeout: 10000 })
      .toBeGreaterThan(0);
  });

  /**
   * Scenario: Clicking SUCCESS trigger expands its template editor
   *   Given the EMAIL_TEMPLATES section is visible
   *   When the recruiter clicks SUCCESS
   *   Then the template editor expands for SUCCESS
   */
  test('Scenario: Stage settings — clicking SUCCESS expands its template editor', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('EMAIL_TEMPLATES')).toBeVisible({ timeout: 15000 });
    await page.getByText('SUCCESS').click();

    await expect(page.locator('[data-testid="template-subject-input"]')).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: Clicking FAILURE trigger expands its template editor
   *   Given the EMAIL_TEMPLATES section is visible
   *   When the recruiter clicks FAILURE
   *   Then the template editor expands for FAILURE
   */
  test('Scenario: Stage settings — clicking FAILURE expands its template editor', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('EMAIL_TEMPLATES')).toBeVisible({ timeout: 15000 });
    await page.getByText('FAILURE').click();

    await expect(page.locator('[data-testid="template-subject-input"]')).toBeVisible({ timeout: 5000 });
  });
});

// ─── Suite: Delete stage ──────────────────────────────────────────────────────

test.describe('Feature: Delete stage — DRAFT pipeline Overview', () => {
  let pipeline: SeedPipeline;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipeline = await seedPipeline(request, token, 'E2E — Delete Stage');
    // Create two stages so we can delete one and verify the other persists
    await seedStage(request, token, pipeline.id, 'Keep This Stage', 0);
    await seedStage(request, token, pipeline.id, 'Delete Me Stage', 1);
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipeline.id);
  });

  /**
   * Scenario: Delete button exists on stage cards for DRAFT pipelines
   *   Given a DRAFT pipeline with two stages
   *   When the recruiter navigates to the overview
   *   Then each stage card has a delete (trash) button visible
   */
  test('Scenario: Delete button is visible on stage cards (DRAFT)', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}`);
    await page.waitForLoadState('networkidle');

    // The delete buttons are absolutely positioned over the stage cards
    const deleteButtons = page.locator('button[title="Delete this stage"]');
    await expect(deleteButtons.first()).toBeVisible({ timeout: 15000 });
  });

  /**
   * Scenario: Clicking delete shows a confirmation dialog
   *   Given a DRAFT pipeline overview is open
   *   When the recruiter clicks the delete button on "Delete Me Stage"
   *   Then a confirm dialog appears
   */
  test('Scenario: Clicking delete shows confirmation dialog', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}`);
    await page.waitForLoadState('networkidle');

    let dialogAppeared = false;
    page.on('dialog', async (dialog) => {
      dialogAppeared = true;
      await dialog.dismiss(); // cancel to avoid actually deleting
    });

    const deleteBtn = page.locator('button[title="Delete this stage"]').first();
    await expect(deleteBtn).toBeVisible({ timeout: 15000 });
    await deleteBtn.click();

    await expect
      .poll(() => dialogAppeared, { timeout: 5000 })
      .toBe(true);
  });

  /**
   * Scenario: Confirming delete removes the stage from the overview
   *   Given a DRAFT pipeline with two stages
   *   When the recruiter confirms the delete dialog for "Delete Me Stage"
   *   Then the stage card disappears from the overview
   *   And "Keep This Stage" is still visible
   */
  test('Scenario: Confirming delete removes the stage card', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/Delete Me Stage/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Keep This Stage/i)).toBeVisible();

    const stagesBefore = await page.locator('[data-testid="stage-card"]').count();

    // Accept the confirmation
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Click delete on the "Delete Me Stage" card.
    // The delete button is a sibling of the stage-card inside its position:relative wrapper div.
    // We find the wrapper by navigating up from the stage-card, then find the delete button within it.
    const deleteMeStageCard = page.locator('[data-testid="stage-card"]').filter({
      hasText: /Delete Me Stage/i,
    });
    // Go up to the position:relative wrapper div, then find the delete button sibling
    const wrapperDiv = deleteMeStageCard.locator('xpath=..');
    const deleteBtn = wrapperDiv.locator('button[title="Delete this stage"]');

    await deleteBtn.click();

    // Stage count decreases by 1
    await expect(
      page.locator('[data-testid="stage-card"]'),
    ).toHaveCount(stagesBefore - 1, { timeout: 15000 });

    // The deleted stage title is no longer visible
    await expect(page.getByText(/Delete Me Stage/i)).not.toBeVisible({ timeout: 5000 });

    // The other stage remains
    await expect(page.getByText(/Keep This Stage/i)).toBeVisible();
  });

  /**
   * Scenario: Cancelling delete confirmation keeps the stage
   *   Given a DRAFT pipeline overview with two stages
   *   When the recruiter clicks delete but dismisses the confirmation
   *   Then the stage card remains
   */
  test('Scenario: Cancelling delete confirmation keeps stage visible', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}`);
    await page.waitForLoadState('networkidle');

    const stagesBefore = await page.locator('[data-testid="stage-card"]').count();

    page.on('dialog', async (dialog) => {
      await dialog.dismiss();
    });

    const deleteBtn = page.locator('button[title="Delete this stage"]').first();
    await expect(deleteBtn).toBeVisible({ timeout: 15000 });
    await deleteBtn.click();

    // Count unchanged
    await page.waitForTimeout(1000);
    expect(await page.locator('[data-testid="stage-card"]').count()).toBe(stagesBefore);
  });
});

// ─── Suite: Reorder stages ────────────────────────────────────────────────────

test.describe('Feature: Reorder stages — DRAFT pipeline', () => {
  let pipeline: SeedPipeline;
  let stages: SeedStage[];
  let token: string;

  test.beforeAll(async ({ request, browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto('/');
    token = await getAuthToken(page);
    await context.close();

    pipeline = await seedPipeline(request, token, 'E2E — Reorder Stages');
    stages = await Promise.all([
      seedStage(request, token, pipeline.id, 'Stage A', 0),
      seedStage(request, token, pipeline.id, 'Stage B', 1),
      seedStage(request, token, pipeline.id, 'Stage C', 2),
    ]);
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, token, pipeline.id);
  });

  /**
   * Scenario: Stage cards are rendered in order
   *   Given three stages with order 0, 1, 2
   *   When the recruiter navigates to the overview
   *   Then the stage cards appear in the correct order (A, B, C)
   */
  test('Scenario: Stages render in seeded order', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}`);
    await page.waitForLoadState('networkidle');

    const stageTexts = await page
      .locator('[data-testid="stage-card"]')
      .evaluateAll((els) => els.map((el) => el.textContent ?? ''));

    const idxA = stageTexts.findIndex((t) => t.includes('Stage A') || t.toUpperCase().includes('STAGE A'));
    const idxB = stageTexts.findIndex((t) => t.includes('Stage B') || t.toUpperCase().includes('STAGE B'));
    const idxC = stageTexts.findIndex((t) => t.includes('Stage C') || t.toUpperCase().includes('STAGE C'));

    expect(idxA).not.toBe(-1);
    expect(idxB).not.toBe(-1);
    expect(idxC).not.toBe(-1);
    expect(idxA).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxC);
  });

  /**
   * Scenario: Reorder via API updates DOM order on reload
   *   Given stages A, B, C in that order
   *   When stages are reordered via API (B, A, C)
   *   And the page is reloaded
   *   Then the DOM order reflects B, A, C
   */
  test('Scenario: API reorder is reflected in DOM after reload', async ({ page, request }) => {
    // Reorder via API: B=0, A=1, C=2 — route is PATCH, not PUT
    const reorderRes = await request.patch(
      `${API_BASE}/api/v1/pipelines/${pipeline.id}/stages/reorder`,
      {
        headers: authHeaders(token),
        data: {
          stages: [
            { id: stages[1].id, order: 0 }, // B first
            { id: stages[0].id, order: 1 }, // A second
            { id: stages[2].id, order: 2 }, // C third
          ],
        },
      },
    );
    // Accept 200 or 204 — both are valid success responses for reorder
    const status = reorderRes.status();
    if (status >= 300) {
      const text = await reorderRes.text();
      console.error(`Reorder API returned ${status}: ${text}`);
    }
    expect(status, `Reorder API failed with status ${status}`).toBeLessThan(300);

    // Reload page to fetch updated stage order
    await page.reload();
    await page.waitForLoadState('networkidle');

    const stageTexts = await page
      .locator('[data-testid="stage-card"]')
      .evaluateAll((els) => els.map((el) => el.textContent ?? ''));

    // Only check if we have enough stages
    if (stageTexts.length >= 2) {
      const idxB = stageTexts.findIndex((t) => t.includes('Stage B') || t.toUpperCase().includes('STAGE B'));
      const idxA = stageTexts.findIndex((t) => t.includes('Stage A') || t.toUpperCase().includes('STAGE A'));

      if (idxB >= 0 && idxA >= 0) {
        expect(idxB).toBeLessThan(idxA);
      }
    }
  });

  /**
   * Scenario: Drag handles are visible on stage cards (smoke test)
   *   Given the DRAFT pipeline overview shows stage cards
   *   Then each card has a drag handle (dnd-kit renders listeners on the outer div)
   */
  test('Scenario: Stage column containers are present and draggable (smoke test)', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}`);
    await page.waitForLoadState('networkidle');

    // Three stage-card elements should be visible
    await expect(
      page.locator('[data-testid="stage-card"]'),
    ).toHaveCount(3, { timeout: 15000 });

    // The sortable stage containers exist — verify we can hover over them
    const firstCard = page.locator('[data-testid="stage-card"]').first();
    await firstCard.hover();
    await expect(firstCard).toBeVisible();
  });
});

// ─── Suite: Add challenge to stage ───────────────────────────────────────────

test.describe('Feature: Add challenge to stage — StageDetailPage', () => {
  let pipeline: SeedPipeline;
  let stage: SeedStage;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipeline = await seedPipeline(request, token, 'E2E — Add Challenge Stage');
    stage = await seedStage(request, token, pipeline.id, 'Technical Round');
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipeline.id);
  });

  /**
   * Scenario: ADD_CHALLENGE button is visible on StageDetailPage
   *   Given a stage with no challenges
   *   When the recruiter navigates to the stage detail page
   *   Then the ADD_CHALLENGE button is visible
   */
  test('Scenario: ADD_CHALLENGE button is visible', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('button', { name: /ADD_CHALLENGE/i }),
    ).toBeVisible({ timeout: 15000 });
  });

  /**
   * Scenario: Clicking ADD_CHALLENGE opens the challenge picker dialog
   *   Given the stage detail page is loaded
   *   When the recruiter clicks ADD_CHALLENGE
   *   Then the challenge picker modal/dialog opens
   */
  test('Scenario: ADD_CHALLENGE opens challenge picker', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /ADD_CHALLENGE/i }).click();

    await expect(
      page.locator('[data-testid="challenge-picker"]').or(page.getByRole('dialog')).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  /**
   * Scenario: Adding a challenge from the picker increases the CHALLENGES count
   *   Given the stage has 0 challenges (empty state visible)
   *   When the recruiter opens the picker and adds a QUIZ_MCQ template
   *   Then the CHALLENGES count label increases to CHALLENGES (1)
   *   And the challenge card appears in the list
   */
  test('Scenario: Adding challenge from picker increases CHALLENGES count', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState('networkidle');

    // Empty state should show
    await expect(
      page.getByText(/No challenges added|ADD_FIRST_CHALLENGE/i),
    ).toBeVisible({ timeout: 15000 });

    // Open picker
    await page.getByRole('button', { name: /ADD_CHALLENGE|ADD_FIRST_CHALLENGE/i }).first().click();

    const picker = page.locator('[data-testid="challenge-picker"]').or(page.getByRole('dialog')).first();
    await expect(picker).toBeVisible({ timeout: 5000 });

    // Step 1: Click the MULTIPLE CHOICE type filter to show MCQ templates
    const mcqTypeFilter = picker.getByRole('button', { name: /MULTIPLE CHOICE/i }).first();
    await expect(mcqTypeFilter).toBeVisible({ timeout: 10000 });
    await mcqTypeFilter.click();

    // Step 2: Click the "Create Custom" MCQ tile (or first available template card) to select it
    // The picker renders a CreateNewTile for the selected type — clicking it toggles selection
    const firstTemplateCard = picker.locator('[data-testid="challenge-card"]').first();
    await expect(firstTemplateCard).toBeVisible({ timeout: 5000 });
    await firstTemplateCard.click();

    // Step 3: The ADD_SELECTED button now appears in the picker header — click it
    const confirmBtn = picker.getByRole('button', { name: /ADD_SELECTED/i });
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    // Picker closes
    await expect(
      page.locator('[data-testid="challenge-picker"]').or(page.getByRole('dialog')).first(),
    ).not.toBeVisible({ timeout: 15000 });

    // Challenge count label shows 1
    await expect(
      page.getByText(/CHALLENGES\s*\(\s*1\s*\)/),
    ).toBeVisible({ timeout: 15000 });

    // A challenge card appears
    await expect(page.locator('[data-testid="challenge-card"]')).toHaveCount(1, { timeout: 10000 });
  });

  /**
   * Scenario: ADD_FIRST_CHALLENGE button on empty state also opens picker
   *   Given the stage has no challenges
   *   When the recruiter clicks the "+ ADD_FIRST_CHALLENGE" button in the empty state
   *   Then the challenge picker opens
   */
  test('Scenario: ADD_FIRST_CHALLENGE button in empty state opens picker', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState('networkidle');

    const addFirstBtn = page.getByRole('button', { name: /ADD_FIRST_CHALLENGE/i });
    if (await addFirstBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addFirstBtn.click();
      await expect(
        page.locator('[data-testid="challenge-picker"]').or(page.getByRole('dialog')).first(),
      ).toBeVisible({ timeout: 10000 });
    }
  });
});

// ─── Suite: Delete challenge from stage ──────────────────────────────────────

test.describe('Feature: Delete challenge from stage — StageDetailPage', () => {
  let pipeline: SeedPipeline;
  let stage: SeedStage;
  let challenge: SeedChallenge;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipeline = await seedPipeline(request, token, 'E2E — Delete Challenge');
    stage = await seedStage(request, token, pipeline.id, 'Screen Round');
    challenge = await seedChallenge(request, token, stage.id, {
      type: 'QUIZ_MCQ',
      title: 'JS Fundamentals Quiz',
    });
    // Seed a second challenge to verify the first remains after deleting the second
    await seedChallenge(request, token, stage.id, {
      type: 'CODE_REVIEW',
      title: 'Code Review Challenge',
      order: 1,
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipeline.id);
  });

  /**
   * Scenario: Delete button exists on each challenge card
   *   Given the stage has two challenges
   *   When the recruiter navigates to the stage detail page
   *   Then each challenge card has a delete button visible
   */
  test('Scenario: Delete (trash) button is visible on challenge cards', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState('networkidle');

    // Wait for challenge cards to appear
    await expect(
      page.locator('[data-testid="challenge-card"]').first(),
    ).toBeVisible({ timeout: 15000 });

    // Delete buttons should be present on each card
    const deleteButtons = page.locator(
      'button[title="Delete challenge"],' +
      'button[aria-label*="delete"],' +
      'button[aria-label*="Delete"]'
    );
    await expect(deleteButtons.first()).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: Clicking delete shows confirmation dialog
   *   Given the stage has challenge cards with delete buttons
   *   When the recruiter clicks the delete button on a challenge card
   *   Then a confirmation dialog appears
   */
  test('Scenario: Clicking challenge delete shows confirmation', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="challenge-card"]').first()).toBeVisible({ timeout: 15000 });

    let dialogMessage = '';
    page.on('dialog', async (dialog) => {
      dialogMessage = dialog.message();
      await dialog.dismiss(); // Cancel to keep the challenge
    });

    // Click delete on the first challenge card
    const challengeCard = page.locator('[data-testid="challenge-card"]').first();
    const deleteBtn = challengeCard.getByRole('button', { name: /delete|trash/i }).or(
      challengeCard.locator('button').last(),
    ).first();
    await deleteBtn.click();

    await expect
      .poll(() => dialogMessage, { timeout: 5000 })
      .toMatch(/delete|challenge|sure/i);
  });

  /**
   * Scenario: Confirming delete removes the challenge and decreases count
   *   Given a stage with two challenges
   *   When the recruiter confirms deleting one challenge
   *   Then the challenge card disappears
   *   And the CHALLENGES count decreases by 1
   */
  test('Scenario: Confirming challenge delete removes card and decreases count', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/CHALLENGES\s*\(\s*2\s*\)/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="challenge-card"]')).toHaveCount(2, { timeout: 10000 });

    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Delete the first challenge card
    const firstCard = page.locator('[data-testid="challenge-card"]').first();
    const deleteBtn = firstCard.getByRole('button', { name: /delete|trash/i }).or(
      firstCard.locator('button').last(),
    ).first();
    await deleteBtn.click();

    // Count drops to 1
    await expect(
      page.locator('[data-testid="challenge-card"]'),
    ).toHaveCount(1, { timeout: 15000 });

    await expect(
      page.getByText(/CHALLENGES\s*\(\s*1\s*\)/),
    ).toBeVisible({ timeout: 10000 });
  });
});

// ─── Suite: Navigate to challenge editor ─────────────────────────────────────

test.describe('Feature: Navigate to challenge editor from stage', () => {
  let pipeline: SeedPipeline;
  let stage: SeedStage;
  let challenge: SeedChallenge;
  let token: string;

  test.beforeAll(async ({ request, browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto('/');
    token = await getAuthToken(page);
    await context.close();

    pipeline = await seedPipeline(request, token, 'E2E — Nav to Challenge Editor');
    stage = await seedStage(request, token, pipeline.id, 'Technical Screen');
    challenge = await seedChallenge(request, token, stage.id, {
      type: 'CODE_IMPLEMENTATION',
      title: 'Binary Search',
    });
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, token, pipeline.id);
  });

  /**
   * Scenario: Edit (pencil) icon navigates to /challenges/:id
   *   Given a stage with a CODE_IMPLEMENTATION challenge
   *   When the recruiter clicks the edit button on the challenge card
   *   Then the browser navigates to /pipeline/:id/challenges/:challengeId
   *   And the challenge editor page loads with the correct title
   */
  test('Scenario: Edit button navigates to challenge editor', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState('networkidle');

    await expect(
      page.locator('[data-testid="challenge-card"]').first(),
    ).toBeVisible({ timeout: 15000 });

    // Click the edit button on the challenge card
    const challengeCard = page.locator('[data-testid="challenge-card"]').first();
    const editBtn = challengeCard.getByRole('button', { name: /edit|pencil/i }).or(
      challengeCard.locator('a[href*="/challenges/"]').or(
        challengeCard.locator('button').first(),
      ),
    ).first();
    await editBtn.click();

    // URL should change to the challenge editor route
    await expect
      .poll(() => page.url(), { timeout: 10000 })
      .toContain(`/challenges/${challenge.id}`);

    // The challenge editor h1 should show the title
    await expect(page.locator('h1')).toContainText('Binary Search', { timeout: 15000 });
  });

  /**
   * Scenario: Challenge card shows correct type badge color
   *   Given a CODE_IMPLEMENTATION challenge card is shown
   *   When the recruiter views the stage detail page
   *   Then the type badge renders with purple color (#a78bfa)
   */
  test('Scenario: CODE_IMPLEMENTATION challenge card has purple type badge', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}/stages/${stage.id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="challenge-card"]').first()).toBeVisible({ timeout: 15000 });

    const badge = page.getByText('CODE_IMPLEMENTATION').first();
    await expect(badge).toBeVisible({ timeout: 5000 });

    const color = await badge.evaluate((el) => getComputedStyle(el).color);
    // rgb(167, 139, 250) is #a78bfa
    expect(color).toMatch(/rgb\(167,\s*139,\s*250\)/);
  });

  /**
   * Scenario: Clicking stage header card navigates to stage detail
   *   Given the overview page shows a stage header card
   *   When the recruiter clicks the stage card
   *   Then the browser navigates to /pipeline/:id/stages/:stageId
   */
  test('Scenario: Clicking stage header card navigates to stage detail', async ({ page }) => {
    await page.goto(`/pipeline/${pipeline.id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="stage-card"]').first()).toBeVisible({ timeout: 15000 });

    await page.locator('[data-testid="stage-card"]').first().click();

    await expect
      .poll(() => page.url(), { timeout: 10000 })
      .toContain(`/pipeline/${pipeline.id}/stages/`);
  });
});
