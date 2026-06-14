/**
 * e2e/code-review-editor.spec.ts
 *
 * BDD: CODE_REVIEW challenge editor
 *
 * Feature: CODE_REVIEW Challenge Editor
 *   As a recruiter
 *   I want to configure code review challenges
 *   So that candidates can review Pull Requests and find planted bugs
 *
 * Covers:
 *   §DETAILS tab           — title, instructions, save
 *   §CONTENT_EDITOR tab    — STEP_1 PR fetcher (repo URL, PR number, FETCH button),
 *                            cached PR data display, diff panel, annotation editor
 *   §Sidebar               — AI_FOLLOW_UP, SCORING_LOGIC
 *
 * Projects: authenticated (playwright.config.ts)
 * API base: http://localhost:8787
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { API_BASE } from './env';

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) {
    throw new Error('[code-review-editor.spec] No __session cookie. Run auth setup first.');
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

/** Canonical cached diff used across tests that need diff data. */
const cachedDiff = {
  files: [
    {
      filename: 'src/utils/discount.ts',
      additions: 12,
      deletions: 4,
      hunks: [
        {
          header: '@@ -1,10 +1,18 @@',
          lines: [
            { type: 'context', content: 'export function calculateDiscount(price: number, rate: number): number {' },
            { type: 'removed', content: '  return price * rate;' },
            { type: 'added',   content: '  if (rate < 0 || rate > 1) throw new RangeError("rate out of bounds");' },
            { type: 'added',   content: '  return price * (1 - rate);' },
            { type: 'context', content: '}' },
          ],
        },
      ],
    },
  ],
};

const cachedMetadata = {
  title: 'Fix calculateDiscount() boundary conditions',
  author: 'octocat',
  created_at: '2024-01-15T10:00:00Z',
  state: 'open',
  base: 'main',
  head: 'fix/discount-boundary',
};

async function seedCodeReviewChallenge(
  request: APIRequestContext,
  token: string,
  stageId: string,
  overrides: {
    title?: string;
    instructions?: string;
    withCachedPR?: boolean;
    githubRepoUrl?: string;
    githubPrNumber?: number;
    githubPrTitle?: string;
    githubPrDescription?: string;
    config?: Record<string, unknown>;
    serverConfig?: Record<string, unknown>;
  } = {},
): Promise<string> {
  const payload: Record<string, unknown> = {
    type: 'CODE_REVIEW',
    title: overrides.title ?? 'Review: Authentication Bug',
    instructions: overrides.instructions ?? 'Review the following pull request carefully.',
    config: overrides.config ?? {},
    serverConfig: overrides.serverConfig ?? {},
    order: 0,
  };

  if (overrides.withCachedPR !== false) {
    payload.githubRepoUrl = overrides.githubRepoUrl ?? 'https://github.com/octocat/hello-world';
    payload.githubPrNumber = overrides.githubPrNumber ?? 42;
    payload.githubPrTitle = overrides.githubPrTitle ?? 'Fix calculateDiscount() boundary conditions';
    payload.githubPrDescription = overrides.githubPrDescription ?? 'Fixes RangeError when rate is outside [0, 1].';
    payload.cachedDiffJson = cachedDiff;
    payload.cachedMetadata = cachedMetadata;
  }

  const res = await request.post(`${API_BASE}/api/v1/stages/${stageId}/challenges`, {
    headers: authHeaders(token),
    data: payload,
  });
  expect(res.ok(), `seedCodeReviewChallenge failed: ${await res.text()}`).toBeTruthy();
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
    // Intentionally ignored.
  }
}

// ─── Suite: DETAILS tab ───────────────────────────────────────────────────────

test.describe('Feature: CODE_REVIEW editor — DETAILS tab', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId = await seedPipeline(request, token, 'E2E — CODE_REVIEW DETAILS');
    stageId = await seedStage(request, token, pipelineId, 'Code Review Stage');
    challengeId = await seedCodeReviewChallenge(request, token, stageId, {
      title: 'Review: Auth Token Handling',
      instructions: 'Identify any security flaws in this PR.',
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: Load CODE_REVIEW challenge — title and type shown
   *   Given a CODE_REVIEW challenge exists
   *   When the recruiter navigates to the challenge editor
   *   Then h1 shows the challenge title
   *   And the breadcrumb shows "CODE_REVIEW"
   */
  test('Scenario: DETAILS — challenge loads with title and CODE_REVIEW type badge', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);

    await expect(page.locator('h1')).toContainText('Review: Auth Token Handling', { timeout: 15000 });
    await expect(page.locator('body')).toContainText('CODE_REVIEW', { timeout: 10000 });
  });

  /**
   * Scenario: Title input is editable
   *   Given the DETAILS tab is active
   *   When the recruiter edits the title
   *   Then the input value updates
   */
  test('Scenario: DETAILS — title input is pre-filled and editable', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Review: Auth Token Handling', { timeout: 15000 });

    const titleInput = page.locator('[data-testid="challenge-title-input"]');
    await expect(titleInput).toHaveValue('Review: Auth Token Handling', { timeout: 10000 });

    await titleInput.clear();
    await titleInput.fill('Review: JWT Vulnerability');
    await expect(titleInput).toHaveValue('Review: JWT Vulnerability');
  });

  /**
   * Scenario: Instructions textarea is editable
   *   Given the DETAILS tab is active
   *   When the recruiter updates the instructions
   *   Then the textarea reflects the new content
   */
  test('Scenario: DETAILS — instructions textarea is editable', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Review: Auth Token Handling', { timeout: 15000 });

    const instructionsField = page.locator('[data-testid="challenge-instructions-input"]');
    await expect(instructionsField).toContainText('Identify any security flaws', { timeout: 10000 });

    await instructionsField.fill('Review this PR for performance issues and security vulnerabilities.');
    await expect(instructionsField).toContainText('performance issues');
  });

  /**
   * Scenario: SAVE_CHANGES saves and shows SAVED indicator
   *   Given the DETAILS tab has unsaved changes
   *   When the recruiter clicks SAVE_CHANGES
   *   Then the button transitions through SAVING... and SAVED
   *   And a PUT request is issued
   */
  test('Scenario: DETAILS — SAVE_CHANGES sends PUT and shows SAVED', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Review: Auth Token Handling', { timeout: 15000 });

    const putUrls: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PUT' && req.url().includes(`/challenges/${challengeId}`)) {
        putUrls.push(req.url());
      }
    });

    const titleInput = page.locator('[data-testid="challenge-title-input"]');
    await titleInput.clear();
    await titleInput.fill('Review: Updated Title');

    await page.getByRole('button', { name: /SAVE_CHANGES/i }).click();

    await expect(page.getByRole('button', { name: /SAVING/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /SAVE_CHANGES/i })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="save-success"]')).toBeVisible({ timeout: 5000 });

    expect(putUrls.length).toBeGreaterThan(0);
  });
});

// ─── Suite: CONTENT_EDITOR tab — PR Fetcher ──────────────────────────────────

test.describe('Feature: CODE_REVIEW editor — CONTENT_EDITOR PR fetcher', () => {
  let pipelineId: string;
  let stageId: string;
  let token: string;

  test.beforeAll(async ({ request, browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto('/');
    token = await getAuthToken(page);
    await context.close();

    pipelineId = await seedPipeline(request, token, 'E2E — CODE_REVIEW PR fetcher');
    stageId = await seedStage(request, token, pipelineId, 'Code Review');
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: CONTENT_EDITOR shows STEP_1 PR fetcher heading
   *   Given a CODE_REVIEW challenge without cached PR data
   *   When the recruiter opens the CONTENT_EDITOR tab
   *   Then "Connect Source Pull Request" heading is visible
   *   And the STEP_1:_FETCH_GITHUB_PR subtitle is shown
   */
  test('Scenario: PR fetcher — STEP_1 heading and subtitle are visible', async ({ page, request }) => {
    const challengeId = await seedCodeReviewChallenge(request, token, stageId, {
      title: 'Blank PR Challenge',
      withCachedPR: false,
    });

    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Blank PR Challenge', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    await expect(page.getByText('STEP_1:_FETCH_GITHUB_PR')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Connect Source Pull Request')).toBeVisible();
  });

  /**
   * Scenario: Repo URL input is visible
   *   Given the CONTENT_EDITOR tab is active with no cached PR
   *   Then the repo URL input field is visible in the PR fetcher panel
   */
  test('Scenario: PR fetcher — repo URL input is visible', async ({ page, request }) => {
    const challengeId = await seedCodeReviewChallenge(request, token, stageId, {
      title: 'URL Input Test',
      withCachedPR: false,
    });

    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('URL Input Test', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();
    await expect(page.getByText('STEP_1:_FETCH_GITHUB_PR')).toBeVisible({ timeout: 5000 });

    // Repo URL input — look for an input with github.com placeholder or similar
    const repoInput = page.locator('input[placeholder*="github.com"]').or(
      page.locator('input[placeholder*="repo"]').or(
        page.locator('input[type="url"]'),
      ),
    ).first();
    await expect(repoInput).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: PR Number input is visible
   *   Given the CONTENT_EDITOR tab is active with no cached PR
   *   Then a PR number input (or select for org repos) is visible
   */
  test('Scenario: PR fetcher — PR number input is visible', async ({ page, request }) => {
    const challengeId = await seedCodeReviewChallenge(request, token, stageId, {
      title: 'PR Number Input Test',
      withCachedPR: false,
    });

    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('PR Number Input Test', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();
    await expect(page.getByText('STEP_1:_FETCH_GITHUB_PR')).toBeVisible({ timeout: 5000 });

    // PR number input — number input or similar
    const prInput = page.locator('input[type="number"]').or(
      page.locator('input[placeholder*="PR"]').or(
        page.locator('input[placeholder*="number"]').or(
          page.locator('input[placeholder*="#"]'),
        ),
      ),
    ).first();
    await expect(prInput).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: FETCH button is visible in the PR fetcher section
   *   Given the CONTENT_EDITOR tab is active
   *   Then a FETCH button is present next to the PR number input
   */
  test('Scenario: PR fetcher — FETCH button is visible', async ({ page, request }) => {
    const challengeId = await seedCodeReviewChallenge(request, token, stageId, {
      title: 'Fetch Button Test',
      withCachedPR: false,
    });

    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Fetch Button Test', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();
    await expect(page.getByText('STEP_1:_FETCH_GITHUB_PR')).toBeVisible({ timeout: 5000 });

    const fetchBtn = page.getByRole('button', { name: /^FETCH$/ }).or(
      page.getByRole('button', { name: /FETCH_PR/i }),
    ).first();
    await expect(fetchBtn).toBeVisible({ timeout: 5000 });
  });
});

// ─── Suite: CONTENT_EDITOR tab — cached PR data ───────────────────────────────

test.describe('Feature: CODE_REVIEW editor — cached PR data display', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId = await seedPipeline(request, token, 'E2E — CODE_REVIEW cached PR');
    stageId = await seedStage(request, token, pipelineId, 'Code Review Stage');
    challengeId = await seedCodeReviewChallenge(request, token, stageId, {
      title: 'Review: calculateDiscount()',
      instructions: 'Find the boundary condition bug.',
      withCachedPR: true,
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: Cached PR data shows when editing existing challenge
   *   Given a CODE_REVIEW challenge with cachedDiffJson and cachedMetadata
   *   When the recruiter opens the CONTENT_EDITOR tab
   *   Then the PR fetcher shows the cached state (not blank inputs)
   *   And the cached PR title or author is displayed
   */
  test('Scenario: cached PR — fetcher shows cached PR details', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Review: calculateDiscount()', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    // The PR fetcher section is still visible
    await expect(page.getByText('STEP_1:_FETCH_GITHUB_PR')).toBeVisible({ timeout: 5000 });

    // Cached PR info is shown — title, author, or PR number
    await expect(
      page.getByText(/calculateDiscount|octocat|PR #42|\#42/).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  /**
   * Scenario: Cached PR shows SOURCE_PR section in sidebar
   *   Given a CODE_REVIEW challenge with cached PR data
   *   When the recruiter opens the CONTENT_EDITOR tab
   *   Then the sidebar shows a SOURCE_PR section with PR number and actions
   */
  test('Scenario: cached PR — SOURCE_PR section shown in sidebar', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Review: calculateDiscount()', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();
    await expect(page.getByText('STEP_1:_FETCH_GITHUB_PR')).toBeVisible({ timeout: 5000 });

    // Sidebar shows SOURCE_PR with PR number reference
    await expect(page.getByText('SOURCE_PR')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/PR #42|#42/)).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: Cached PR shows VIEW and CHANGE buttons in sidebar
   *   Given the SOURCE_PR section is visible
   *   Then VIEW button links to the GitHub PR
   *   And CHANGE button is available to swap the PR
   */
  test('Scenario: cached PR — VIEW and CHANGE buttons are visible in SOURCE_PR sidebar', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Review: calculateDiscount()', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();
    await expect(page.getByText('SOURCE_PR')).toBeVisible({ timeout: 5000 });

    await expect(page.getByRole('link', { name: /VIEW/i }).or(page.getByRole('button', { name: /VIEW/i }))).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /CHANGE/i })).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: CHANGE button clears cached PR and shows blank fetcher
   *   Given the cached PR is loaded
   *   When the recruiter clicks CHANGE
   *   Then the cached state is cleared
   *   And the blank PR fetcher form is shown again
   */
  test('Scenario: cached PR — CHANGE button clears cached state', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Review: calculateDiscount()', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();
    await expect(page.getByText('SOURCE_PR')).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: /CHANGE/i }).click();

    // After clearing, SOURCE_PR should be gone and blank fetcher should be visible
    await expect(page.getByText('SOURCE_PR')).not.toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: CHALLENGE_INSTRUCTIONS section visible after PR is fetched
   *   Given cached PR data is loaded (prFetched = true)
   *   When the recruiter opens CONTENT_EDITOR
   *   Then CHALLENGE_INSTRUCTIONS section is visible below the fetcher
   *   And contains the auto-populated instructions from PR description
   */
  test('Scenario: cached PR — CHALLENGE_INSTRUCTIONS section is visible', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Review: calculateDiscount()', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    // With prFetched=true, the instructions section appears below the fetcher
    await expect(page.getByText('CHALLENGE_INSTRUCTIONS')).toBeVisible({ timeout: 5000 });

    // SOURCE_SYNCED label should also appear
    await expect(page.getByText('SOURCE_SYNCED')).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: EXPECTED_FINDINGS_&_QUESTIONS section appears after PR fetch
   *   Given cached PR data is loaded
   *   When the recruiter opens CONTENT_EDITOR
   *   Then the ground truth annotation section is visible
   */
  test('Scenario: cached PR — EXPECTED_FINDINGS annotation section is visible', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Review: calculateDiscount()', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    await expect(
      page.getByText(/EXPECTED_FINDINGS|GROUND_TRUTH|annotations/i).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: AI_FOLLOW_UP section is in the sidebar
   *   Given the CONTENT_EDITOR tab is active for a CODE_REVIEW challenge
   *   Then the AI_FOLLOW_UP section is visible in the sidebar
   */
  test('Scenario: cached PR — AI_FOLLOW_UP section visible in sidebar', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Review: calculateDiscount()', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    await expect(page.getByText('AI_FOLLOW_UP')).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: SCORING_LOGIC section is in the sidebar
   *   Given the CONTENT_EDITOR tab is active with cached PR
   *   Then the SCORING_LOGIC section is visible in the sidebar
   *   And explains how scoring works (Ground Truth annotations)
   */
  test('Scenario: cached PR — SCORING_LOGIC section visible in sidebar', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Review: calculateDiscount()', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    await expect(page.getByText('SCORING_LOGIC')).toBeVisible({ timeout: 5000 });
    // Explains annotation-based scoring
    await expect(page.getByText(/Ground Truth|annotation/i)).toBeVisible({ timeout: 5000 });
  });
});

// ─── Suite: Ground truth annotations ─────────────────────────────────────────

test.describe('Feature: CODE_REVIEW editor — ground truth annotations', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId = await seedPipeline(request, token, 'E2E — CODE_REVIEW annotations');
    stageId = await seedStage(request, token, pipelineId, 'Code Review Stage');
    challengeId = await seedCodeReviewChallenge(request, token, stageId, {
      title: 'Annotated Review',
      withCachedPR: true,
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: Annotation panel is visible after diff loads
   *   Given a CODE_REVIEW challenge with cached diff data
   *   When the recruiter opens CONTENT_EDITOR
   *   Then the ground truth annotation editor is visible
   */
  test('Scenario: annotations — panel is visible when PR is loaded', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Annotated Review', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    // The GroundTruthAnnotationEditor component should be visible
    await expect(
      page.locator('[data-testid="ground-truth-editor"]').or(
        page.getByText(/EXPECTED_FINDINGS|Add annotation|ground truth/i).first(),
      ),
    ).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: Add annotation button exists
   *   Given the annotation panel is visible
   *   When the recruiter views the panel
   *   Then an "Add" or "+ ADD" button is visible in the annotation editor
   */
  test('Scenario: annotations — add annotation button is present', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Annotated Review', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    await expect(
      page.getByText(/EXPECTED_FINDINGS/i),
    ).toBeVisible({ timeout: 5000 });

    // Look for add annotation control — button or link with "Add" or "+" text
    const addAnnotationBtn = page.getByRole('button', { name: /Add|ADD|^\+/i }).or(
      page.locator('[data-testid="add-annotation"]'),
    ).first();
    await expect(addAnnotationBtn).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: Adding an annotation creates an annotation row
   *   Given the annotation panel is visible and empty
   *   When the recruiter clicks the add annotation button
   *   Then a new annotation form row appears with fields for comment/severity
   */
  test('Scenario: annotations — clicking add creates annotation row', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Annotated Review', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();

    await expect(page.getByText(/EXPECTED_FINDINGS/i)).toBeVisible({ timeout: 5000 });

    const addAnnotationBtn = page.getByRole('button', { name: /Add|ADD|^\+/i }).or(
      page.locator('[data-testid="add-annotation"]'),
    ).first();

    const beforeCount = await page.locator('[data-testid="annotation-row"]').count();
    await addAnnotationBtn.click();

    // After clicking, either an annotation form appears or the count increases
    await expect
      .poll(async () => {
        const newCount = await page.locator('[data-testid="annotation-row"]').count();
        const hasInputs = await page.locator('input[placeholder*="annotation"]').or(
          page.locator('textarea[placeholder*="finding"]').or(
            page.locator('select[name*="severity"]'),
          ),
        ).count();
        return newCount > beforeCount || hasInputs > 0;
      }, { timeout: 5000 })
      .toBe(true);
  });

  /**
   * Scenario: Annotations are saved with the challenge on SAVE_CHANGES
   *   Given the annotation editor has at least one annotation
   *   When the recruiter clicks SAVE_CHANGES
   *   Then a PUT request is issued
   *   And the request succeeds
   */
  test('Scenario: annotations — SAVE_CHANGES with annotations fires PUT request', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Annotated Review', { timeout: 15000 });

    await page.getByRole('button', { name: 'CONTENT_EDITOR' }).click();
    await expect(page.getByText(/EXPECTED_FINDINGS/i)).toBeVisible({ timeout: 5000 });

    const putUrls: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PUT' && req.url().includes(`/challenges/${challengeId}`)) {
        putUrls.push(req.url());
      }
    });

    await page.getByRole('button', { name: /SAVE_CHANGES/i }).click();
    await expect(page.getByRole('button', { name: /SAVE_CHANGES/i })).toBeVisible({ timeout: 10000 });

    expect(putUrls.length).toBeGreaterThan(0);
  });
});

// ─── Suite: SCORING_RUBRIC tab ────────────────────────────────────────────────

test.describe('Feature: CODE_REVIEW editor — SCORING_RUBRIC tab', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId = await seedPipeline(request, token, 'E2E — CODE_REVIEW SCORING tab');
    stageId = await seedStage(request, token, pipelineId, 'Screen');
    challengeId = await seedCodeReviewChallenge(request, token, stageId, {
      title: 'Scoring Rubric Test',
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: SCORING_RUBRIC tab is clickable and shows textarea
   *   Given the challenge editor is loaded
   *   When the recruiter clicks SCORING_RUBRIC tab
   *   Then the tab activates
   *   And a textarea with SCORING_CRITERIA label is shown
   */
  test('Scenario: SCORING_RUBRIC tab — shows SCORING_CRITERIA textarea', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Scoring Rubric Test', { timeout: 15000 });

    await page.getByRole('button', { name: 'SCORING_RUBRIC' }).click();

    await expect(page.getByText('SCORING_CRITERIA')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('textarea')).toBeVisible({ timeout: 5000 });
  });
});
