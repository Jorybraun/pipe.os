/**
 * Bug Regression Tests — BDD scenarios that reproduce confirmed bugs.
 *
 * These tests MUST fail before the fix is applied, then pass after.
 * Each test is tagged with the bug number from the QA session (2026-03-29).
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

interface SeededData {
  pipelineId: string;
  stageId: string;
  challengeIds: string[];
  candidateInviteToken: string;
  candidateId: string;
}

async function seedPipelineWithMCQ(
  request: APIRequestContext,
  authToken: string,
): Promise<SeededData> {
  const headers = recruiterHeaders(authToken);

  // 1. Create pipeline
  const pipeRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers,
    data: { title: 'Bug Regression Pipeline', status: 'ACTIVE', level: 'Senior' },
  });
  const { pipeline } = (await pipeRes.json()) as { pipeline: { id: string } };

  // 2. Create stage
  const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipeline.id}/stages`, {
    headers,
    data: { title: 'Regression Stage', order: 0 },
  });
  const { stage } = (await stageRes.json()) as { stage: { id: string } };

  // 3. Create one MCQ challenge with content
  const chRes = await request.post(`${API_BASE}/api/v1/stages/${stage.id}/challenges`, {
    headers,
    data: {
      type: 'QUIZ_MCQ',
      title: 'Regression MCQ',
      instructions: 'Pick the correct answer.',
      order: 0,
      config: {
        questionPrompt: 'What is 2+2?',
        options: [
          { id: 'a', text: '3' },
          { id: 'b', text: '4' },
          { id: 'c', text: '5' },
        ],
      },
      serverConfig: { correctOptionId: 'b' },
    },
  });
  const chData = (await chRes.json()) as { challenge?: { id: string }; id?: string };
  const challengeId = chData.challenge?.id ?? chData.id ?? '';

  // 4. Create candidate
  const candRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipeline.id}/candidates`, {
    headers,
    data: { name: 'Regression Candidate', email: 'regression@test.com', currentStageId: stage.id },
  });
  const { candidate } = (await candRes.json()) as {
    candidate: { id: string; inviteToken: string };
  };

  return {
    pipelineId: pipeline.id,
    stageId: stage.id,
    challengeIds: [challengeId],
    candidateInviteToken: candidate.inviteToken,
    candidateId: candidate.id,
  };
}

async function teardown(request: APIRequestContext, authToken: string, pipelineId: string): Promise<void> {
  await request.delete(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
    headers: recruiterHeaders(authToken),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUG #13 (P0) — Final submit shows success but fails silently (INVALID_TOKEN)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Bug #13: Assessment final submit must actually complete', () => {
  let authToken: string;
  let seed: SeededData;
  let seed2InviteToken: string;

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({
      storageState: 'playwright/.auth/user.json',
    });
    const page = await ctx.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await ctx.close();

    seed = await seedPipelineWithMCQ(request, authToken);

    // Create a second candidate for scenario 2 (the first gets consumed by scenario 1)
    const candRes = await request.post(`${API_BASE}/api/v1/pipelines/${seed.pipelineId}/candidates`, {
      headers: recruiterHeaders(authToken),
      data: { name: 'Bug13 Scenario2', email: 'bug13s2@test.com' },
    });
    const candBody = (await candRes.json()) as { candidate: { inviteToken: string } };
    seed2InviteToken = candBody.candidate.inviteToken;
  });

  test.afterAll(async ({ request }) => {
    if (seed?.pipelineId) {
      await teardown(request, authToken, seed.pipelineId);
    }
  });

  /**
   * Scenario: /rpc/submit-status endpoint must exist and mark candidate COMPLETED
   *   Given a candidate has resolved their token and has a valid session JWT
   *   When the frontend POSTs to /rpc/submit-status with { status: 'COMPLETED' }
   *   Then the response status should be 200 (not 404)
   *   And the candidate status in D1 should be 'COMPLETED'
   */
  test('Scenario: /rpc/submit-status endpoint exists and marks candidate COMPLETED', async ({
    request,
  }) => {
    // Resolve token → get session JWT
    const resolveRes = await request.post(`${API_BASE}/rpc/resolve-token`, {
      data: { inviteToken: seed.candidateInviteToken },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resolveRes.status()).toBe(200);
    const { sessionToken } = (await resolveRes.json()) as { sessionToken: string };
    expect(sessionToken).toBeTruthy();

    // Submit the one challenge first
    const submitRes = await request.post(`${API_BASE}/rpc/submit-challenge-response`, {
      data: { order: 0, submission: { answers: { current: 'b' } } },
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
    });
    expect(submitRes.status()).toBe(200);

    // Now call submit-status — THIS IS THE BUG: returns 404 because route doesn't exist
    const statusRes = await request.post(`${API_BASE}/rpc/submit-status`, {
      data: { status: 'COMPLETED' },
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
    });

    // Must be 200, not 404
    expect(statusRes.status()).toBe(200);

    const statusBody = (await statusRes.json()) as { success: boolean };
    expect(statusBody.success).toBe(true);
  });

  /**
   * Scenario: Frontend must NOT show success if submit-status fails
   *   Given the candidate completes all challenges
   *   When the final submission RPC fails
   *   Then the UI must show an error, not the success screen
   */
  test('Scenario: UI must not show success when submit-status fails', async ({ page }) => {
    // Listen for console errors BEFORE navigating
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(`${APP_BASE}/assess/${seed2InviteToken}`);
    await expect(page.getByText(/ready to begin/i)).toBeVisible({ timeout: 10000 });

    // Intercept submit-status to force a 500 failure
    await page.route('**/rpc/submit-status', (route) => {
      void route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Forced test failure' } }),
      });
    });

    // Start assessment
    await page.getByRole('button', { name: /START_INTERVIEW/i }).click();
    await page.waitForTimeout(2000);

    // The MCQ options are styled divs inside the assessment — click the first one
    const optionCard = page.locator('[style*="border-radius"]').filter({ hasText: /\w+/ }).first();
    if (await optionCard.isVisible({ timeout: 5000 })) {
      await optionCard.click();
    }

    // Click FINAL_SUBMIT (single-challenge stage, so this is the final button)
    const finalBtn = page.getByRole('button', { name: /FINAL_SUBMIT|NEXT_CHALLENGE/i });
    await finalBtn.click();
    await page.waitForTimeout(5000);

    // After the fix: when submit-status returns 500, the error propagates
    // through useAssessment and the UI should NOT show the success screen.
    // Instead it should show an error state or stay on the challenge.
    const successVisible = await page.getByText(/submitted/i).isVisible().catch(() => false);
    const errorVisible = await page.getByText(/error|failed|something went wrong/i).isVisible().catch(() => false);

    // With the fix applied, either:
    // 1. Error is shown to the user (best case), OR
    // 2. Success is NOT shown (minimum requirement)
    // The bug was: success shown despite backend failure
    expect(successVisible && !errorVisible, 'Success shown despite backend failure — error was swallowed').toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG #8 (P1) — Pipeline "..." menu buttons non-functional
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Bug #8: Pipeline context menu must have actions', () => {
  let authToken: string;
  let pipelineId: string;

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({
      storageState: 'playwright/.auth/user.json',
    });
    const page = await ctx.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await ctx.close();

    // Seed a pipeline
    const res = await request.post(`${API_BASE}/api/v1/pipelines`, {
      headers: recruiterHeaders(authToken),
      data: { title: 'Menu Test Pipeline', status: 'DRAFT', level: 'Senior' },
    });
    const { pipeline } = (await res.json()) as { pipeline: { id: string } };
    pipelineId = pipeline.id;
  });

  test.afterAll(async ({ request }) => {
    if (pipelineId) {
      await teardown(request, authToken, pipelineId);
    }
  });

  /**
   * Scenario: Clicking "..." on a pipeline card shows a context menu with Delete
   *   Given a pipeline exists in the listing
   *   When the recruiter clicks the "..." button
   *   Then a dropdown menu appears with at least a "Delete" option
   */
  test('Scenario: ... menu opens with Delete action', async ({ page }) => {
    await page.goto(APP_BASE);
    await expect(page.getByText('Menu Test Pipeline')).toBeVisible({ timeout: 10000 });

    // The "Pipeline actions" button is the first one on the page since
    // "Menu Test Pipeline" is at the top of the listing (most recently created).
    // Use nth(0) to target the first card's action button.
    const menuBtn = page.locator('button[aria-label="Pipeline actions"]').nth(0);
    await menuBtn.click();

    // A dropdown/popover with "DELETE" should appear (role="menuitem" in RoleCard)
    const deleteOption = page.getByRole('menuitem', { name: /delete/i }).or(
      page.locator('[role="menu"]').getByText(/delete/i),
    );
    await expect(deleteOption).toBeVisible({ timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG #4 (P1) — Adding MCQ option wipes previous option text
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Bug #4: MCQ option text preserved when adding new option', () => {
  let authToken: string;
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({
      storageState: 'playwright/.auth/user.json',
    });
    const page = await ctx.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await ctx.close();

    const headers = recruiterHeaders(authToken);

    const pipeRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
      headers,
      data: { title: 'MCQ Option Bug Pipeline', status: 'DRAFT', level: 'Senior' },
    });
    const { pipeline } = (await pipeRes.json()) as { pipeline: { id: string } };
    pipelineId = pipeline.id;

    const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/stages`, {
      headers,
      data: { title: 'MCQ Stage', order: 0 },
    });
    const { stage } = (await stageRes.json()) as { stage: { id: string } };
    stageId = stage.id;

    const chRes = await request.post(`${API_BASE}/api/v1/stages/${stageId}/challenges`, {
      headers,
      data: { type: 'QUIZ_MCQ', title: 'Option Bug MCQ', instructions: 'Test', order: 0 },
    });
    const chData = (await chRes.json()) as { challenge?: { id: string }; id?: string };
    challengeId = chData.challenge?.id ?? chData.id ?? '';
  });

  test.afterAll(async ({ request }) => {
    if (pipelineId) await teardown(request, authToken, pipelineId);
  });

  /**
   * Scenario: Typing in Option A, then clicking + ADD_OPTION, must preserve Option A text
   *   Given the recruiter is editing an MCQ challenge content
   *   And Option A is visible and the recruiter types "First answer"
   *   When the recruiter clicks + ADD_OPTION
   *   Then Option A text should still be "First answer"
   */
  test('Scenario: option text preserved after adding new option', async ({ page }) => {
    await page.goto(
      `${APP_BASE}/pipeline/${pipelineId}/challenges/${challengeId}`,
    );

    // Switch to content editor
    await page.getByRole('button', { name: /CONTENT_EDITOR/i }).click();

    // Add first option
    await page.getByRole('button', { name: /ADD_OPTION/i }).click();
    await page.waitForTimeout(500);

    // Type into Option A
    const optionA = page.locator('input[placeholder="Option A text..."]');
    await optionA.fill('First answer');
    expect(await optionA.inputValue()).toBe('First answer');

    // Add another option
    await page.getByRole('button', { name: /ADD_OPTION/i }).click();
    await page.waitForTimeout(500);

    // Option A should STILL have "First answer"
    const optionAAfter = page.locator('input[placeholder="Option A text..."]');
    expect(await optionAAfter.inputValue()).toBe('First answer');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG #6 (P2) — No validation error on empty pipeline name
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Bug #6: Pipeline creation validates required name', () => {
  /**
   * Scenario: Submitting empty name shows validation error
   *   Given the recruiter is on /pipeline/new
   *   When they click CREATE PIPELINE without entering a name
   *   Then a validation error should be visible
   *   And no pipeline should be created
   */
  test('Scenario: empty name shows validation error', async ({ page }) => {
    await page.goto(`${APP_BASE}/pipeline/new`);
    await expect(page.getByText('Create a Pipeline')).toBeVisible({ timeout: 10000 });

    // Track API calls — should NOT create a pipeline
    let createCalled = false;
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/pipelines') && req.method() === 'POST') {
        createCalled = true;
      }
    });

    // Wait for the form to fully render, then click CREATE without filling name
    await expect(page.getByRole('button', { name: /CREATE PIPELINE/i })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /CREATE PIPELINE/i }).click({ force: true });
    await page.waitForTimeout(1000);

    // Should still be on the create page (not redirected)
    await expect(page).toHaveURL(/\/pipeline\/new/);

    // Should show some validation feedback (error message, red border, etc.)
    const hasError = await page
      .locator('[class*="error"], [data-error], [aria-invalid="true"], .text-red')
      .first()
      .isVisible()
      .catch(() => false);
    const hasErrorText = await page
      .getByText(/required|cannot be empty|enter a name/i)
      .isVisible()
      .catch(() => false);

    expect(hasError || hasErrorText).toBe(true);

    // API should not have been called
    expect(createCalled).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG #5 (P2) — No save confirmation toast in challenge editor
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Bug #5: Challenge editor shows save confirmation', () => {
  let authToken: string;
  let pipelineId: string;
  let challengeId: string;

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({
      storageState: 'playwright/.auth/user.json',
    });
    const page = await ctx.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await ctx.close();

    const headers = recruiterHeaders(authToken);

    const pipeRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
      headers,
      data: { title: 'Save Toast Pipeline', status: 'DRAFT', level: 'Senior' },
    });
    const { pipeline } = (await pipeRes.json()) as { pipeline: { id: string } };
    pipelineId = pipeline.id;

    const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/stages`, {
      headers,
      data: { title: 'Toast Stage', order: 0 },
    });
    const { stage } = (await stageRes.json()) as { stage: { id: string } };

    const chRes = await request.post(`${API_BASE}/api/v1/stages/${stage.id}/challenges`, {
      headers,
      data: { type: 'QUIZ_MCQ', title: 'Toast Test MCQ', instructions: 'Test', order: 0 },
    });
    const chData = (await chRes.json()) as { challenge?: { id: string }; id?: string };
    challengeId = chData.challenge?.id ?? chData.id ?? '';
  });

  test.afterAll(async ({ request }) => {
    if (pipelineId) await teardown(request, authToken, pipelineId);
  });

  /**
   * Scenario: Clicking SAVE_CHANGES shows a success toast/indicator
   *   Given the recruiter edits a challenge title
   *   When they click SAVE_CHANGES
   *   Then a success indicator (toast, message, or button state change) appears
   */
  test('Scenario: save shows visible confirmation', async ({ page }) => {
    await page.goto(`${APP_BASE}/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.getByText('CHALLENGE_EDITOR')).toBeVisible({ timeout: 10000 });

    // Edit the title
    const titleInput = page.locator('input').filter({ hasText: /Toast Test MCQ/ }).or(
      page.getByRole('textbox').first(),
    );
    await titleInput.clear();
    await titleInput.fill('Updated Title');

    // Click save and immediately watch for confirmation (3-second window)
    await page.getByRole('button', { name: /SAVE_CHANGES/i }).click();

    // The SAVED indicator appears briefly after save — use data-testid for reliability
    await expect(
      page.locator('[data-testid="save-success"]').or(page.getByText(/^SAVED$/)),
    ).toBeVisible({ timeout: 10000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG #11 (P1) — Empty challenges (no content) shown to candidates
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Bug #11: Empty challenges must not be served to candidates', () => {
  let authToken: string;
  let pipelineId: string;
  let stageId: string;
  let candidateInviteToken: string;

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({
      storageState: 'playwright/.auth/user.json',
    });
    const page = await ctx.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await ctx.close();

    const headers = recruiterHeaders(authToken);

    // Create pipeline + stage
    const pipeRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
      headers,
      data: { title: 'Empty Challenge Pipeline', status: 'ACTIVE', level: 'Senior' },
    });
    const { pipeline } = (await pipeRes.json()) as { pipeline: { id: string } };
    pipelineId = pipeline.id;

    const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/stages`, {
      headers,
      data: { title: 'Bug11 Stage', order: 0 },
    });
    const { stage } = (await stageRes.json()) as { stage: { id: string } };
    stageId = stage.id;

    // Add an EMPTY MCQ challenge (no config, no question)
    await request.post(`${API_BASE}/api/v1/stages/${stageId}/challenges`, {
      headers,
      data: { type: 'QUIZ_MCQ', title: 'Empty MCQ', instructions: '', order: 0 },
    });

    // Add a VALID MCQ challenge (has question + options + correct answer)
    await request.post(`${API_BASE}/api/v1/stages/${stageId}/challenges`, {
      headers,
      data: {
        type: 'QUIZ_MCQ',
        title: 'Valid MCQ',
        instructions: 'Pick one',
        order: 1,
        config: {
          question: 'What is 2+2?',
          options: [
            { id: 'a', text: '3' },
            { id: 'b', text: '4' },
          ],
        },
        serverConfig: { correctOptionId: 'b' },
      },
    });

    // Create candidate
    const candRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/candidates`, {
      headers,
      data: { name: 'Bug11 Candidate', email: 'bug11@test.com' },
    });
    const { candidate } = (await candRes.json()) as { candidate: { inviteToken: string } };
    candidateInviteToken = candidate.inviteToken;
  });

  test.afterAll(async ({ request }) => {
    if (pipelineId) await teardown(request, authToken, pipelineId);
  });

  /**
   * Scenario: Stage config should only include challenges with content
   *   Given a stage has one empty MCQ and one valid MCQ
   *   When a candidate resolves their token and fetches stage config
   *   Then the stage config should list only 1 challenge (the valid one)
   */
  test('Scenario: empty challenges filtered from candidate stage config', async ({ request }) => {
    // Resolve token
    const resolveRes = await request.post(`${API_BASE}/rpc/resolve-token`, {
      data: { inviteToken: candidateInviteToken },
    });
    expect(resolveRes.ok()).toBe(true);
    const { sessionToken } = (await resolveRes.json()) as { sessionToken: string };

    // Get stage config
    const stageRes = await request.post(`${API_BASE}/rpc/get-stage-config`, {
      headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      data: {},
    });
    expect(stageRes.ok()).toBe(true);
    const stageConfig = (await stageRes.json()) as {
      challenges: Array<{ type: string; order: number }>;
    };

    // Should only have 1 challenge (the valid one), not 2
    expect(stageConfig.challenges.length).toBe(1);
    expect(stageConfig.challenges[0].type).toBe('QUIZ_MCQ');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG #12 (P1) — Duplicate challenges allowed in the same stage
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Bug #12: Duplicate sort_order challenges get unique ordering', () => {
  let authToken: string;
  let pipelineId: string;
  let stageId: string;

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({
      storageState: 'playwright/.auth/user.json',
    });
    const page = await ctx.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await ctx.close();

    const headers = recruiterHeaders(authToken);

    const pipeRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
      headers,
      data: { title: 'Duplicate Challenge Pipeline', status: 'ACTIVE', level: 'Senior' },
    });
    const { pipeline } = (await pipeRes.json()) as { pipeline: { id: string } };
    pipelineId = pipeline.id;

    const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/stages`, {
      headers,
      data: { title: 'Bug12 Stage', order: 0 },
    });
    const { stage } = (await stageRes.json()) as { stage: { id: string } };
    stageId = stage.id;
  });

  test.afterAll(async ({ request }) => {
    if (pipelineId) await teardown(request, authToken, pipelineId);
  });

  /**
   * Scenario: Adding two challenges with the same order should not create duplicates
   *   Given a stage exists
   *   When two challenges are added both with order: 0
   *   Then they should have distinct sort_order values (0 and 1)
   */
  test('Scenario: duplicate sort_order is resolved server-side', async ({ request }) => {
    const headers = recruiterHeaders(authToken);

    // Add first challenge with order 0
    const res1 = await request.post(`${API_BASE}/api/v1/stages/${stageId}/challenges`, {
      headers,
      data: { type: 'QUIZ_MCQ', title: 'First MCQ', instructions: 'Q1', order: 0 },
    });
    expect(res1.status()).toBe(201);
    const ch1 = (await res1.json()) as { order: number };

    // Add second challenge also with order 0
    const res2 = await request.post(`${API_BASE}/api/v1/stages/${stageId}/challenges`, {
      headers,
      data: { type: 'QUIZ_MCQ', title: 'Second MCQ', instructions: 'Q2', order: 0 },
    });
    expect(res2.status()).toBe(201);
    const ch2 = (await res2.json()) as { order: number };

    // The two challenges should have different sort orders
    expect(ch1.order).not.toBe(ch2.order);
  });
});
