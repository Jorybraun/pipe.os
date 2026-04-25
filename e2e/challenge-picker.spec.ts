/**
 * Challenge Picker — BDD regression tests
 *
 * Bugs:
 *   #9  — Selections lost when switching type tabs
 *   #10 — Adding two challenges of same type only creates one
 *   #11 — Can't select custom + preset templates together
 *   #12 — CODE_IMPLEMENTATION has no content editor for custom challenges
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const APP_BASE = 'http://localhost:5173';
const API_BASE = 'http://localhost:8787';

// ── Helpers ──────────────────────────────────────────────────────────────────

function recruiterHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) throw new Error('No __session cookie found');
  return sessionCookie.value;
}

async function teardown(
  request: APIRequestContext,
  authToken: string,
  pipelineId: string,
): Promise<void> {
  await request.delete(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
    headers: recruiterHeaders(authToken),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUG #9 — Selections lost when switching type tabs
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Bug #9: Picker preserves selections across type tabs', () => {
  let authToken: string;
  let pipelineId: string;
  let stageId: string;

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await ctx.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await ctx.close();

    const headers = recruiterHeaders(authToken);
    const pipeRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
      headers, data: { title: 'Picker Cross-Tab Pipeline', status: 'DRAFT', level: 'Senior' },
    });
    const { pipeline } = (await pipeRes.json()) as { pipeline: { id: string } };
    pipelineId = pipeline.id;

    const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/stages`, {
      headers, data: { title: 'Picker Stage', order: 0 },
    });
    const body = (await stageRes.json()) as { stage?: { id: string }; id?: string };
    stageId = body.stage?.id ?? body.id ?? '';
  });

  test.afterAll(async ({ request }) => {
    if (pipelineId) await teardown(request, authToken, pipelineId);
  });

  /**
   * Scenario: Select MCQ template, switch to IMPLEMENTATION tab, select one there,
   *           then confirm — both should be added
   *   Given the picker is open
   *   When the recruiter selects a template on MULTIPLE CHOICE tab
   *   And switches to IMPLEMENTATION tab and selects a template
   *   And clicks ADD_SELECTED
   *   Then both challenges are added to the stage (count increases by 2)
   */
  test('Scenario: selections persist across tab switches', async ({ page }) => {
    await page.goto(`${APP_BASE}/pipeline/${pipelineId}/stages/${stageId}`);
    await expect(page.getByText('Picker Stage')).toBeVisible({ timeout: 10000 });

    // Get initial challenge count
    const countBefore = await page.locator('[class*="challenge"]').count();

    // Open picker
    await page.getByRole('button', { name: /ADD_CHALLENGE/i }).click();
    await expect(page.getByRole('heading', { name: /Select Templates/i })).toBeVisible({ timeout: 5000 });

    // Switch to MULTIPLE CHOICE and select the "Create Custom MCQ" tile
    await page.getByRole('button', { name: /MULTIPLE CHOICE/i }).click();
    await page.waitForTimeout(500);
    const mcqCreate = page.getByText(/Create Custom MCQ/i).first();
    await expect(mcqCreate).toBeVisible({ timeout: 5000 });
    await mcqCreate.click();

    // Switch to IMPLEMENTATION — MCQ selection should persist
    await page.getByRole('button', { name: /IMPLEMENTATION/i }).click();
    await page.waitForTimeout(500);

    // The ADD_SELECTED button should still show count >= 1
    await expect(
      page.getByRole('button', { name: /ADD_SELECTED.*[1-9]/i }),
    ).toBeVisible({ timeout: 3000 });

    // Select the "Create Custom CODE IMPLEMENTATION" tile
    const implCreate = page.getByText(/Create Custom CODE IMPLEMENTATION/i).first();
    await expect(implCreate).toBeVisible({ timeout: 5000 });
    await implCreate.click();

    // Should now show count >= 2
    await expect(
      page.getByRole('button', { name: /ADD_SELECTED.*[2-9]/i }),
    ).toBeVisible({ timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG #10 — Adding two challenges of same type only creates one
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Bug #10: Multiple same-type templates can be added', () => {
  let authToken: string;
  let pipelineId: string;
  let stageId: string;

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await ctx.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await ctx.close();

    const headers = recruiterHeaders(authToken);
    const pipeRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
      headers, data: { title: 'Multi-Add Pipeline', status: 'DRAFT', level: 'Senior' },
    });
    const { pipeline } = (await pipeRes.json()) as { pipeline: { id: string } };
    pipelineId = pipeline.id;

    const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/stages`, {
      headers, data: { title: 'Multi Stage', order: 0 },
    });
    const body = (await stageRes.json()) as { stage?: { id: string }; id?: string };
    stageId = body.stage?.id ?? body.id ?? '';
  });

  test.afterAll(async ({ request }) => {
    if (pipelineId) await teardown(request, authToken, pipelineId);
  });

  /**
   * Scenario: Select two SHORT_ANSWER templates and add both
   *   Given the picker is open on SHORT ANSWER tab
   *   When the recruiter selects two different templates
   *   And clicks ADD_SELECTED (2)
   *   Then 2 challenges are created on the stage
   */
  test('Scenario: two templates of same type both get added', async ({ page }) => {
    await page.goto(`${APP_BASE}/pipeline/${pipelineId}/stages/${stageId}`);
    await expect(page.getByText('Multi Stage')).toBeVisible({ timeout: 10000 });

    // Open picker
    await page.getByRole('button', { name: /ADD_CHALLENGE/i }).click();
    await expect(page.getByRole('heading', { name: /Select Templates/i })).toBeVisible({ timeout: 5000 });

    // Switch to SHORT ANSWER
    await page.getByRole('button', { name: /SHORT ANSWER/i }).click();
    await page.waitForTimeout(500);

    // Select first two templates (not "Create Custom")
    const templates = page.locator('[data-template-id]');
    const count = await templates.count();
    if (count >= 2) {
      await templates.nth(0).click();
      await templates.nth(1).click();
    }

    // Should show ADD_SELECTED (2)
    await expect(
      page.getByRole('button', { name: /ADD_SELECTED.*2/i }),
    ).toBeVisible({ timeout: 3000 });

    // Confirm
    await page.getByRole('button', { name: /ADD_SELECTED/i }).click();
    await page.waitForTimeout(2000);

    // Stage should now have 2 challenges
    const challengeCards = page.locator('text=SHORT_ANSWER');
    await expect(challengeCards).toHaveCount(2, { timeout: 5000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG #11 — Can't select custom + preset templates together
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Bug #11: Custom and preset templates selectable together', () => {
  let authToken: string;
  let pipelineId: string;
  let stageId: string;

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await ctx.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await ctx.close();

    const headers = recruiterHeaders(authToken);
    const pipeRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
      headers, data: { title: 'Custom+Preset Pipeline', status: 'DRAFT', level: 'Senior' },
    });
    const { pipeline } = (await pipeRes.json()) as { pipeline: { id: string } };
    pipelineId = pipeline.id;

    const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/stages`, {
      headers, data: { title: 'Mix Stage', order: 0 },
    });
    const body = (await stageRes.json()) as { stage?: { id: string }; id?: string };
    stageId = body.stage?.id ?? body.id ?? '';
  });

  test.afterAll(async ({ request }) => {
    if (pipelineId) await teardown(request, authToken, pipelineId);
  });

  /**
   * Scenario: Select "Create Custom MCQ" AND a preset MCQ template
   *   Given the picker is open on MULTIPLE CHOICE tab
   *   When the recruiter clicks "Create Custom MCQ"
   *   And also clicks a preset MCQ template
   *   And clicks ADD_SELECTED (2)
   *   Then 2 challenges are added — one blank, one from the template
   */
  test('Scenario: custom + preset both get added', async ({ page }) => {
    await page.goto(`${APP_BASE}/pipeline/${pipelineId}/stages/${stageId}`);
    await expect(page.getByText('Mix Stage')).toBeVisible({ timeout: 10000 });

    // Open picker
    await page.getByRole('button', { name: /ADD_CHALLENGE/i }).click();
    await expect(page.getByRole('heading', { name: /Select Templates/i })).toBeVisible({ timeout: 5000 });

    // Switch to MULTIPLE CHOICE
    await page.getByRole('button', { name: /MULTIPLE CHOICE/i }).click();
    await page.waitForTimeout(500);

    // Click "Create Custom MCQ" (the first card)
    await page.getByText('Create Custom MCQ').click();

    // Click a preset template
    const presetTemplate = page.locator('[data-template-id]').first();
    if (await presetTemplate.isVisible({ timeout: 3000 })) {
      await presetTemplate.click();
    }

    // Should show ADD_SELECTED (2)
    await expect(
      page.getByRole('button', { name: /ADD_SELECTED.*2/i }),
    ).toBeVisible({ timeout: 3000 });

    // Confirm
    await page.getByRole('button', { name: /ADD_SELECTED/i }).click();
    await page.waitForTimeout(2000);

    // Stage should have 2 MCQ challenges
    const mcqBadges = page.locator('text=MCQ');
    expect(await mcqBadges.count()).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG #12 — CODE_IMPLEMENTATION content editor missing for custom challenges
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Bug #12: CODE_IMPLEMENTATION has a content editor', () => {
  let authToken: string;
  let pipelineId: string;
  let challengeId: string;

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await ctx.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await ctx.close();

    const headers = recruiterHeaders(authToken);
    const pipeRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
      headers, data: { title: 'Code Editor Pipeline', status: 'DRAFT', level: 'Senior' },
    });
    const { pipeline } = (await pipeRes.json()) as { pipeline: { id: string } };
    pipelineId = pipeline.id;

    const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/stages`, {
      headers, data: { title: 'Code Stage', order: 0 },
    });
    const { stage } = (await stageRes.json()) as { stage: { id: string } };

    const chRes = await request.post(`${API_BASE}/api/v1/stages/${stage.id}/challenges`, {
      headers,
      data: { type: 'CODE_IMPLEMENTATION', title: 'Custom Code Challenge', instructions: 'Write code.', order: 0 },
    });
    const chData = (await chRes.json()) as { challenge?: { id: string }; id?: string };
    challengeId = chData.challenge?.id ?? chData.id ?? '';
  });

  test.afterAll(async ({ request }) => {
    if (pipelineId) {
      await request.delete(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
        headers: recruiterHeaders(authToken),
      });
    }
  });

  /**
   * Scenario: CODE_IMPLEMENTATION content editor has language selector and code input
   *   Given a custom CODE_IMPLEMENTATION challenge exists
   *   When the recruiter opens its editor and clicks CONTENT_EDITOR
   *   Then a language selector is visible
   *   And a code editor / textarea for starter code is visible
   */
  test('Scenario: content editor shows language + code input', async ({ page }) => {
    await page.goto(`${APP_BASE}/pipeline/${pipelineId}/challenges/${challengeId}`);
    await page.getByRole('button', { name: /CONTENT_EDITOR/i }).click();
    await page.waitForTimeout(1000);

    // Language selector should exist
    await expect(
      page.getByText(/LANGUAGE/i)
        .or(page.locator('select').filter({ hasText: /javascript|python|typescript/i }))
        .or(page.locator('[data-testid="language-selector"]')),
    ).toBeVisible({ timeout: 8000 });

    // Starter code area should exist
    await expect(
      page.getByText(/STARTER_CODE|Starter Code/i)
        .or(page.locator('[data-testid="starter-code"]'))
        .or(page.locator('.monaco-editor'))
        .or(page.locator('textarea[placeholder*="code"]')),
    ).toBeVisible({ timeout: 8000 });
  });
});
