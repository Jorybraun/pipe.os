/**
 * e2e/multi-turn-config.spec.ts
 *
 * BDD: Multi-turn code review configuration in the challenge editor
 *
 * Feature: Multi-Turn Code Review Configuration
 *   As a recruiter
 *   I want to configure multi-turn code review challenges
 *   So that candidates have a realistic back-and-forth review conversation
 *
 * Covers:
 *   §DETAILS tab (CODE_REVIEW)  — MULTI_TURN toggle, IMPLEMENTER_PERSONA dropdown,
 *                                 MAX_ROUNDS input visibility and enabled/disabled state
 *   §Enable flow               — enabling toggle unlocks persona + rounds fields
 *   §Persistence               — config persists after save + reload
 *   §Non-CODE_REVIEW gate      — CODE_IMPLEMENTATION does not show multi-turn config
 *
 * Projects: authenticated (playwright.config.ts)
 * API base: http://localhost:8787
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = 'http://localhost:8787';

// ─── Auth helper ──────────────────────────────────────────────────────────────

/**
 * Extract the Clerk session token from the browser cookie jar.
 * Must be called after page.goto() so storageState is hydrated.
 */
async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) {
    throw new Error('[multi-turn-config.spec] No __session cookie found. Run auth setup first.');
  }
  return sessionCookie.value;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function seedPipeline(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  const res = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers: authHeaders(token),
    data: { title, status: 'DRAFT' },
  });
  expect(res.ok(), `seedPipeline failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { id: string };
  return body.id;
}

async function seedStage(
  request: APIRequestContext,
  token: string,
  pipelineId: string,
  title: string,
): Promise<string> {
  const res = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/stages`, {
    headers: authHeaders(token),
    data: { title, order: 0 },
  });
  expect(res.ok(), `seedStage failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { id: string };
  return body.id;
}

async function seedCodeReviewChallenge(
  request: APIRequestContext,
  token: string,
  stageId: string,
  overrides: {
    title?: string;
    config?: Record<string, unknown>;
  } = {},
): Promise<string> {
  const res = await request.post(`${API_BASE}/api/v1/stages/${stageId}/challenges`, {
    headers: authHeaders(token),
    data: {
      type: 'CODE_REVIEW',
      title: overrides.title ?? 'Review: Auth Bug',
      instructions: 'Find the bug in this pull request.',
      config: overrides.config ?? {},
      serverConfig: {},
      order: 0,
    },
  });
  expect(res.ok(), `seedCodeReviewChallenge failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { id: string };
  return body.id;
}

async function seedCodeImplChallenge(
  request: APIRequestContext,
  token: string,
  stageId: string,
): Promise<string> {
  const res = await request.post(`${API_BASE}/api/v1/stages/${stageId}/challenges`, {
    headers: authHeaders(token),
    data: {
      type: 'CODE_IMPLEMENTATION',
      title: 'FizzBuzz',
      instructions: 'Write FizzBuzz.',
      config: {
        language: 'javascript',
        mode: 'backend',
        files: {
          '/solution.js': {
            content: 'function solution(n) { return null; }',
            language: 'javascript',
          },
        },
        sampleTestFiles: {},
      },
      serverConfig: {
        hiddenTestFiles: {
          '/solution.test.js': {
            content: "const { solution } = require('./solution'); test('x', () => {});",
            language: 'javascript',
          },
        },
      },
      order: 0,
    },
  });
  expect(res.ok(), `seedCodeImplChallenge failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { id: string };
  return body.id;
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

// ─── Suite: Multi-turn config visibility ─────────────────────────────────────

test.describe('Feature: Multi-turn config — CODE_REVIEW DETAILS tab', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId = await seedPipeline(request, token, 'E2E — Multi-turn config');
    stageId = await seedStage(request, token, pipelineId, 'Code Review Stage');
    challengeId = await seedCodeReviewChallenge(request, token, stageId, {
      title: 'Review: Session Fixation',
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: CODE_REVIEW challenge shows multi-turn config in DETAILS tab
   *   Given a CODE_REVIEW challenge exists
   *   When the recruiter navigates to the challenge editor
   *   Then the DETAILS tab is active
   *   And the MULTI_TURN toggle is visible
   *   And the IMPLEMENTER_PERSONA dropdown is visible but disabled
   *   And the MAX_ROUNDS input is visible but disabled
   */
  test('Scenario: CODE_REVIEW DETAILS tab shows multi-turn config controls', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Review: Session Fixation', { timeout: 15000 });

    // MULTI_TURN toggle
    const toggle = page.getByTestId('multi-turn-toggle');
    await expect(toggle).toBeVisible({ timeout: 5000 });

    // IMPLEMENTER_PERSONA dropdown — exists and disabled
    const personaSelect = page.getByTestId('implementer-persona-select');
    await expect(personaSelect).toBeVisible();
    await expect(personaSelect).toBeDisabled();

    // MAX_ROUNDS input — exists and disabled
    const maxRoundsInput = page.getByTestId('max-rounds-input');
    await expect(maxRoundsInput).toBeVisible();
    await expect(maxRoundsInput).toBeDisabled();
  });

  /**
   * Scenario: Enabling multi-turn unlocks persona and max rounds
   *   Given the DETAILS tab is active with multi-turn disabled
   *   When the recruiter enables the MULTI_TURN toggle
   *   Then the persona dropdown becomes enabled
   *   And the max rounds input becomes enabled with default value 4
   */
  test('Scenario: enabling MULTI_TURN toggle unlocks persona and max rounds', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Review: Session Fixation', { timeout: 15000 });

    const toggle = page.getByTestId('multi-turn-toggle');
    await expect(toggle).toBeVisible({ timeout: 5000 });

    // Before enabling — controls are disabled
    await expect(page.getByTestId('implementer-persona-select')).toBeDisabled();
    await expect(page.getByTestId('max-rounds-input')).toBeDisabled();

    // Enable the toggle
    await toggle.click();

    // After enabling — controls are enabled
    await expect(page.getByTestId('implementer-persona-select')).toBeEnabled();
    await expect(page.getByTestId('max-rounds-input')).toBeEnabled();

    // Default max rounds value is 4
    await expect(page.getByTestId('max-rounds-input')).toHaveValue('4');
  });

  /**
   * Scenario: Multi-turn config persists on save
   *   Given multi-turn is enabled with persona "senior" and max rounds 3
   *   When the recruiter saves the challenge
   *   And reloads the page
   *   Then the toggle is ON
   *   And persona shows "senior"
   *   And max rounds shows 3
   */
  test('Scenario: multi-turn config persists after save and reload', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Review: Session Fixation', { timeout: 15000 });

    // Enable multi-turn
    const toggle = page.getByTestId('multi-turn-toggle');
    await expect(toggle).toBeVisible({ timeout: 5000 });
    await toggle.click();

    // Set persona to senior
    const personaSelect = page.getByTestId('implementer-persona-select');
    await expect(personaSelect).toBeEnabled();
    await personaSelect.selectOption('senior');

    // Set max rounds to 3
    const maxRoundsInput = page.getByTestId('max-rounds-input');
    await expect(maxRoundsInput).toBeEnabled();
    await maxRoundsInput.fill('3');

    // Save
    const saveButton = page.getByTestId('save-changes-button');
    await saveButton.click();
    await expect(page.getByText('SAVED')).toBeVisible({ timeout: 10000 });

    // Reload
    await page.reload();
    await expect(page.locator('h1')).toContainText('Review: Session Fixation', { timeout: 15000 });

    // Verify persisted state
    const reloadedToggle = page.getByTestId('multi-turn-toggle');
    await expect(reloadedToggle).toBeVisible({ timeout: 5000 });
    await expect(reloadedToggle).toBeChecked();

    await expect(page.getByTestId('implementer-persona-select')).toHaveValue('senior');
    await expect(page.getByTestId('max-rounds-input')).toHaveValue('3');
  });
});

// ─── Suite: Non-CODE_REVIEW does not show multi-turn config ──────────────────

test.describe('Feature: Multi-turn config — non-CODE_REVIEW exclusion', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId = await seedPipeline(request, token, 'E2E — Multi-turn exclusion');
    stageId = await seedStage(request, token, pipelineId, 'Coding Stage');
    challengeId = await seedCodeImplChallenge(request, token, stageId);
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: Non-CODE_REVIEW challenges do not show multi-turn config
   *   Given a CODE_IMPLEMENTATION challenge exists
   *   When the recruiter navigates to the challenge editor
   *   And views the DETAILS tab
   *   Then the MULTI_TURN toggle is NOT visible
   */
  test('Scenario: CODE_IMPLEMENTATION DETAILS tab has no multi-turn config', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('FizzBuzz', { timeout: 15000 });

    // Multi-turn controls must not appear for non-CODE_REVIEW
    await expect(page.getByTestId('multi-turn-toggle')).not.toBeVisible();
    await expect(page.getByTestId('implementer-persona-select')).not.toBeVisible();
    await expect(page.getByTestId('max-rounds-input')).not.toBeVisible();
  });
});
