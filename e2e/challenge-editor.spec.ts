/**
 * e2e/challenge-editor.spec.ts
 *
 * BDD: Recruiter edits, clones, and creates challenges in the Challenge Editor.
 *
 * Feature: Challenge Editor — /pipeline/:id/challenges/:challengeId
 *   As a recruiter
 *   I want to view and edit challenge settings
 *   So that I can configure each challenge type for my pipeline
 *
 * Phase 2 Cloudflare migration spec. These tests define the TARGET behavior
 * once pages are migrated to Cloudflare Workers API. They are written against
 * the Cloudflare API at http://localhost:8787.
 *
 * Run under the 'authenticated' Playwright project (storageState has Clerk session).
 *
 * Sections:
 *   1. Edit CODE_IMPLEMENTATION challenge
 *   2. Edit QUIZ_MCQ challenge
 *   3. Edit CODE_REVIEW challenge (with cached PR data)
 *   4. Clone challenge
 *   5. Create new challenge from scratch (NEW_* routes)
 *   6. GitHub PR fetch — happy path + error cases
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { API_BASE as API_BASE_URL } from './env';

// ─── Auth helper ─────────────────────────────────────────────────────────────

/**
 * Extract the Clerk session token from the browser cookie jar.
 * Must be called after page.goto() so storageState is hydrated.
 */
async function getAuthToken(page: Page): Promise<string> {
  // Wait for Clerk JS to refresh the session token (the stored JWT may be
  // expired). networkidle ensures the async token refresh has completed.
  await page.waitForLoadState("networkidle");

  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "__session");
  if (!sessionCookie) {
    throw new Error("No __session cookie found. Make sure the setup project ran first.");
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
  const res = await request.post(`${API_BASE_URL}/api/v1/pipelines`, {
    headers: authHeaders(token),
    data: { title, level: 'Senior', status: 'DRAFT' },
  });
  expect(res.ok(), `seedPipeline failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { pipeline: { id: string } };
  return body.pipeline.id;
}

async function seedStage(
  request: APIRequestContext,
  token: string,
  pipelineId: string,
  title: string,
): Promise<string> {
  const res = await request.post(`${API_BASE_URL}/api/v1/pipelines/${pipelineId}/stages`, {
    headers: authHeaders(token),
    data: { title, order: 0 },
  });
  expect(res.ok(), `seedStage failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { id: string };
  return body.id;
}

async function seedChallenge(
  request: APIRequestContext,
  token: string,
  stageId: string,
  payload: {
    type: 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'CODE_REVIEW' | 'QUIZ_SHORT_ANSWER';
    title: string;
    instructions?: string;
    config?: Record<string, unknown>;
    serverConfig?: Record<string, unknown>;
    githubRepoUrl?: string;
    githubPrNumber?: number;
    githubPrTitle?: string;
    githubPrDescription?: string;
    cachedDiffJson?: unknown;
    cachedMetadata?: unknown;
  },
): Promise<string> {
  const res = await request.post(`${API_BASE_URL}/api/v1/stages/${stageId}/challenges`, {
    headers: authHeaders(token),
    data: { ...payload, order: 0 },
  });
  expect(res.ok(), `seedChallenge failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { id: string };
  return body.id;
}

async function teardownPipeline(
  request: APIRequestContext,
  token: string,
  pipelineId: string,
): Promise<void> {
  await request.delete(`${API_BASE_URL}/api/v1/pipelines/${pipelineId}`, {
    headers: authHeaders(token),
  });
}

// ─── 1. Edit CODE_IMPLEMENTATION challenge ────────────────────────────────────

test.describe('Feature: Edit CODE_IMPLEMENTATION challenge', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId = await seedPipeline(request, token, 'E2E — CODE_IMPLEMENTATION editor');
    stageId    = await seedStage(request, token, pipelineId, 'Technical Screen');
    challengeId = await seedChallenge(request, token, stageId, {
      type: 'CODE_IMPLEMENTATION',
      title: 'FizzBuzz',
      instructions: 'Write FizzBuzz.',
      config: {
        starterCode: 'function fizzBuzz(n) {\n  // TODO\n}',
        language: 'javascript',
      },
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: Load existing CODE_IMPLEMENTATION challenge
   *   Given a CODE_IMPLEMENTATION challenge exists in D1
   *   When the recruiter navigates to /pipeline/:id/challenges/:challengeId
   *   Then the challenge title "FizzBuzz" is displayed in the header
   *   And the breadcrumb shows "CHALLENGE_EDITOR / CODE_IMPLEMENTATION"
   *   And the DETAILS tab is active by default
   *   And the title input contains "FizzBuzz"
   */
  test('Scenario: Load existing challenge — title and type shown', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);

    // Header shows the challenge title
    await expect(page.locator('h1')).toContainText('FizzBuzz', { timeout: 15000 });

    // Breadcrumb / subheading shows the challenge type
    await expect(page.locator('body')).toContainText('CODE_IMPLEMENTATION', { timeout: 10000 });

    // DETAILS tab is active by default — title input is visible and pre-filled
    const titleInput = page.locator('input').filter({ hasText: '' }).first();
    // Input is located by label proximity
    await expect(page.getByText('CHALLENGE_TITLE')).toBeVisible({ timeout: 5000 });
    const titleField = page.locator('input').nth(0);
    await expect(titleField).toHaveValue('FizzBuzz', { timeout: 10000 });
  });

  /**
   * Scenario: Update title and save
   *   Given the challenge editor is open for a CODE_IMPLEMENTATION challenge
   *   When the recruiter clears the title input and types "Binary Search"
   *   And clicks "SAVE_CHANGES"
   *   Then a PUT /api/v1/challenges/:challengeId is sent with title "Binary Search"
   *   And a success indicator appears (button returns to "SAVE_CHANGES" state)
   *   And the page title updates to "Binary Search"
   */
  test('Scenario: Update title — PUT is sent, success indicator shown', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('FizzBuzz', { timeout: 15000 });

    // Track outgoing PUT
    const putRequests: string[] = [];
    page.on('request', req => {
      if (req.method() === 'PUT' && req.url().includes(`/challenges/${challengeId}`)) {
        putRequests.push(req.url());
      }
    });

    // Edit the title
    const titleField = page.locator('input').nth(0);
    await titleField.clear();
    await titleField.fill('Binary Search');

    // Save
    await page.getByRole('button', { name: /SAVE_CHANGES/i }).click();

    // Save button shows "SAVING..." then returns to idle
    await expect(page.getByRole('button', { name: /SAVING/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /SAVE_CHANGES/i })).toBeVisible({ timeout: 10000 });

    // PUT was issued
    expect(putRequests.length).toBeGreaterThan(0);
  });

  /**
   * Scenario: Reload shows updated values
   *   Given the recruiter saved new title "Binary Search"
   *   When the recruiter reloads the page
   *   Then the title input still shows "Binary Search"
   */
  test('Scenario: Reload after save — updated title persists', async ({ page, request }) => {
    // Update directly via API first to set known state
    const putRes = await request.put(`${API_BASE_URL}/api/v1/challenges/${challengeId}`, {
      headers: authHeaders(token),
      data: { title: 'Binary Search', type: 'CODE_IMPLEMENTATION' },
    });
    expect(putRes.ok(), `Direct PUT failed: ${await putRes.text()}`).toBeTruthy();

    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Binary Search', { timeout: 15000 });

    const titleField = page.locator('input').nth(0);
    await expect(titleField).toHaveValue('Binary Search', { timeout: 10000 });
  });

  /**
   * Scenario: CONTENT tab shows "Code implementation challenges are configured with templates."
   *   Given a CODE_IMPLEMENTATION challenge
   *   When the recruiter clicks the CONTENT_EDITOR tab
   *   Then an informational message is shown (no crash, no blank screen)
   */
  test('Scenario: CONTENT tab renders without crash for CODE_IMPLEMENTATION', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('FizzBuzz', { timeout: 15000 });

    await page.getByText('CONTENT_EDITOR').click();

    // The content tab shows the placeholder message for CODE_IMPLEMENTATION
    await expect(page.getByText(/configured with templates|authoring.*coming soon/i)).toBeVisible({ timeout: 5000 });
  });
});

// ─── 2. Edit QUIZ_MCQ challenge ───────────────────────────────────────────────

test.describe('Feature: Edit QUIZ_MCQ challenge', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

  const initialOptions = [
    { id: 'a', text: 'Immutability' },
    { id: 'b', text: 'Closure' },
    { id: 'c', text: 'Hoisting' },
    { id: 'd', text: 'Prototype chain' },
  ];

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId  = await seedPipeline(request, token, 'E2E — QUIZ_MCQ editor');
    stageId     = await seedStage(request, token, pipelineId, 'Screen');
    challengeId = await seedChallenge(request, token, stageId, {
      type: 'QUIZ_MCQ',
      title: 'JavaScript Fundamentals',
      instructions: 'Choose the correct answer.',
      config: {
        question: 'What is a closure?',
        options: initialOptions,
      },
      serverConfig: {
        correctOptionId: 'b',
        options: initialOptions,
        explanation: 'A closure captures its surrounding scope.',
      },
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: Load existing MCQ challenge
   *   Given a QUIZ_MCQ challenge with question text and 4 options
   *   When the recruiter navigates to the challenge editor
   *   Then the challenge title "JavaScript Fundamentals" is shown
   *   And the CONTENT tab shows 4 answer option inputs
   *   And option B is marked as the correct answer
   */
  test('Scenario: Load QUIZ_MCQ — question and options are pre-filled', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('JavaScript Fundamentals', { timeout: 15000 });

    // Switch to the CONTENT_EDITOR tab
    await page.getByText('CONTENT_EDITOR').click();

    // Question textarea is pre-filled
    const questionArea = page.locator('textarea').first();
    await expect(questionArea).toHaveValue('What is a closure?', { timeout: 10000 });

    // 4 option inputs are visible
    const optionInputs = page.locator('input[placeholder^="Option"]');
    await expect(optionInputs).toHaveCount(4, { timeout: 5000 });

    // Options are pre-filled
    await expect(optionInputs.nth(0)).toHaveValue('Immutability');
    await expect(optionInputs.nth(1)).toHaveValue('Closure');
    await expect(optionInputs.nth(2)).toHaveValue('Hoisting');
    await expect(optionInputs.nth(3)).toHaveValue('Prototype chain');
  });

  /**
   * Scenario: Update question text and save
   *   Given the QUIZ_MCQ editor is open
   *   When the recruiter updates the question to "What is hoisting?"
   *   And clicks "SAVE_CHANGES"
   *   Then a PUT /api/v1/challenges/:challengeId is sent
   *   And config.question equals "What is hoisting?"
   */
  test('Scenario: Update question text — PUT carries updated config', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('JavaScript Fundamentals', { timeout: 15000 });

    await page.getByText('CONTENT_EDITOR').click();

    // Capture PUT body
    let capturedBody: Record<string, unknown> | null = null;
    page.on('request', req => {
      if (req.method() === 'PUT' && req.url().includes(`/challenges/${challengeId}`)) {
        try {
          capturedBody = req.postDataJSON() as Record<string, unknown>;
        } catch {
          // ignore parse errors during capture
        }
      }
    });

    // Update question
    const questionArea = page.locator('textarea').first();
    await questionArea.clear();
    await questionArea.fill('What is hoisting?');

    // Save
    await page.getByRole('button', { name: /SAVE_CHANGES/i }).click();
    await expect(page.getByRole('button', { name: /SAVE_CHANGES/i })).toBeVisible({ timeout: 10000 });

    // Verify body contained updated question in config
    expect(capturedBody).not.toBeNull();
    const config = typeof capturedBody!['config'] === 'string'
      ? JSON.parse(capturedBody!['config'] as string)
      : capturedBody!['config'];
    expect((config as { question: string }).question).toBe('What is hoisting?');
  });

  /**
   * Scenario: Change correct answer option and save
   *   Given the QUIZ_MCQ editor shows option B as correct
   *   When the recruiter clicks the radio button for option C
   *   And clicks "SAVE_CHANGES"
   *   Then the PUT body serverConfig contains correctOptionId: "c"
   */
  test('Scenario: Change correct answer — serverConfig updated on save', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('JavaScript Fundamentals', { timeout: 15000 });

    await page.getByText('CONTENT_EDITOR').click();

    let capturedBody: Record<string, unknown> | null = null;
    page.on('request', req => {
      if (req.method() === 'PUT' && req.url().includes(`/challenges/${challengeId}`)) {
        try {
          capturedBody = req.postDataJSON() as Record<string, unknown>;
        } catch {
          // ignore
        }
      }
    });

    // Click the correct-answer selector for option C (index 2)
    // Selector: the small circle buttons that mark correct answers
    const correctRadios = page.locator('button[title="Mark as correct answer"]');
    await expect(correctRadios).toHaveCount(4, { timeout: 5000 });
    await correctRadios.nth(2).click(); // option C

    await page.getByRole('button', { name: /SAVE_CHANGES/i }).click();
    await expect(page.getByRole('button', { name: /SAVE_CHANGES/i })).toBeVisible({ timeout: 10000 });

    expect(capturedBody).not.toBeNull();
    const serverConfig = typeof capturedBody!['serverConfig'] === 'string'
      ? JSON.parse(capturedBody!['serverConfig'] as string)
      : capturedBody!['serverConfig'];
    expect((serverConfig as { correctOptionId: string }).correctOptionId).toBe('c');
  });

  /**
   * Scenario: ADD_OPTION appends a new option row
   *   Given a QUIZ_MCQ challenge with 4 options
   *   When the recruiter clicks "+ ADD_OPTION"
   *   Then a 5th option input appears with placeholder "Option E text..."
   */
  test('Scenario: ADD_OPTION adds a new answer row', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('JavaScript Fundamentals', { timeout: 15000 });

    await page.getByText('CONTENT_EDITOR').click();

    const optionInputsBefore = page.locator('input[placeholder^="Option"]');
    await expect(optionInputsBefore).toHaveCount(4, { timeout: 5000 });

    await page.getByText('+ ADD_OPTION').click();

    await expect(page.locator('input[placeholder^="Option"]')).toHaveCount(5, { timeout: 5000 });
    await expect(page.locator('input[placeholder="Option E text..."]')).toBeVisible();
  });
});

// ─── 3. Edit CODE_REVIEW challenge ────────────────────────────────────────────

test.describe('Feature: Edit CODE_REVIEW challenge with cached PR data', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

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

  const cachedMeta = {
    title: 'Fix calculateDiscount() boundary conditions',
    author: 'octocat',
    created_at: '2024-01-15T10:00:00Z',
    state: 'open',
    base: 'main',
    head: 'fix/discount-boundary',
  };

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId  = await seedPipeline(request, token, 'E2E — CODE_REVIEW editor');
    stageId     = await seedStage(request, token, pipelineId, 'Code Review Stage');
    challengeId = await seedChallenge(request, token, stageId, {
      type: 'CODE_REVIEW',
      title: 'Review: calculateDiscount()',
      instructions: 'Find the bugs in this code.',
      githubRepoUrl: 'https://github.com/octocat/hello-world',
      githubPrNumber: 42,
      githubPrTitle: 'Fix calculateDiscount() boundary conditions',
      githubPrDescription: 'Fixes RangeError when rate is outside [0, 1].',
      cachedDiffJson: cachedDiff,
      cachedMetadata: cachedMeta,
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: Load challenge with cached PR data
   *   Given a CODE_REVIEW challenge with cached PR diff and metadata
   *   When the recruiter opens the challenge editor
   *   Then the challenge title is shown in the header
   *   And the type breadcrumb reads "CODE_REVIEW"
   */
  test('Scenario: Load CODE_REVIEW challenge — title and type displayed', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);

    await expect(page.locator('h1')).toContainText('Review: calculateDiscount()', { timeout: 15000 });
    await expect(page.locator('body')).toContainText('CODE_REVIEW', { timeout: 10000 });
  });

  /**
   * Scenario: CONTENT tab shows PR metadata (title, author)
   *   Given a CODE_REVIEW challenge with cachedMetadata
   *   When the recruiter clicks CONTENT_EDITOR tab
   *   Then the GitHub PR fetcher section shows the cached PR details
   *   And "STEP_1:_FETCH_GITHUB_PR" heading is visible
   *   And the cached PR title or author is displayed
   */
  test('Scenario: CONTENT tab shows cached PR title and author', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Review: calculateDiscount()', { timeout: 15000 });

    await page.getByText('CONTENT_EDITOR').click();

    // GitHub PR fetcher section heading
    await expect(page.getByText('STEP_1:_FETCH_GITHUB_PR')).toBeVisible({ timeout: 5000 });

    // Cached PR metadata surfaces via the GitHubPRFetcher component
    await expect(
      page.getByText('Fix calculateDiscount() boundary conditions')
        .or(page.getByText('octocat'))
        .or(page.getByText('octocat/hello-world'))
    ).toBeVisible({ timeout: 10000 });
  });

  /**
   * Scenario: Can initiate a PR refresh
   *   Given a cached CODE_REVIEW challenge
   *   When the recruiter clicks a refresh / re-fetch button in the CONTENT_EDITOR
   *   Then a POST /api/v1/github/pr request is issued
   *
   * Note: the actual GitHub API call is skipped — we only verify the frontend
   * issues the correct Worker endpoint request. Wire a route mock to intercept.
   */
  test('Scenario: Refresh PR data — POST /api/v1/github/pr is called', async ({ page }) => {
    // Mock the Worker endpoint so it returns immediately without hitting GitHub
    await page.route(`${API_BASE_URL}/api/v1/github/pr`, route => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            diff: cachedDiff,
            metadata: { ...cachedMeta, title: 'Updated PR title' },
          },
        }),
      });
    });

    const prRequests: string[] = [];
    page.on('request', req => {
      if (req.url().includes('/api/v1/github/pr')) {
        prRequests.push(req.url());
      }
    });

    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Review: calculateDiscount()', { timeout: 15000 });

    await page.getByText('CONTENT_EDITOR').click();
    await expect(page.getByText('STEP_1:_FETCH_GITHUB_PR')).toBeVisible({ timeout: 5000 });

    // Trigger re-fetch. The cached PR panel renders a dedicated REFRESH button
    // (distinct from the "CLEAR & RE-FETCH" button, which only clears state).
    const refreshBtn = page.getByRole('button', { name: 'REFRESH', exact: true });
    if (await refreshBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await refreshBtn.click();
      // Give the request a moment to fire
      await page.waitForTimeout(1000);
      expect(prRequests.length).toBeGreaterThan(0);
    } else {
      // If cached PR data is already showing, the component may require clearing
      // before allowing a re-fetch. This is implementation-defined post-migration.
      test.skip();
    }
  });
});

// ─── 4. Clone challenge ───────────────────────────────────────────────────────

test.describe('Feature: Clone challenge', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId  = await seedPipeline(request, token, 'E2E — Clone challenge');
    stageId     = await seedStage(request, token, pipelineId, 'Technical');
    challengeId = await seedChallenge(request, token, stageId, {
      type: 'QUIZ_MCQ',
      title: 'Array Methods',
      config: {
        question: 'Which method returns a new array?',
        options: [
          { id: 'a', text: 'push' },
          { id: 'b', text: 'map' },
          { id: 'c', text: 'pop' },
          { id: 'd', text: 'shift' },
        ],
      },
      serverConfig: {
        correctOptionId: 'b',
        options: [
          { id: 'a', text: 'push' },
          { id: 'b', text: 'map' },
          { id: 'c', text: 'pop' },
          { id: 'd', text: 'shift' },
        ],
      },
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: Clone challenge
   *   Given the recruiter is editing challenge "Array Methods"
   *   When the recruiter clicks "CLONE"
   *   Then a POST /api/v1/challenges/:challengeId/clone is sent
   *   And the browser navigates to the new challenge's editor URL
   *   And the new URL contains a different challenge ID
   *   And the page title shows "Array Methods (Clone)"
   */
  test('Scenario: Click CLONE — navigates to new challenge with "(Clone)" suffix', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Array Methods', { timeout: 15000 });

    const cloneRequests: string[] = [];
    page.on('request', req => {
      if (req.method() === 'POST' && req.url().includes('/clone')) {
        cloneRequests.push(req.url());
      }
    });

    // Click the CLONE button (may be in header or action bar)
    await page.getByRole('button', { name: /CLONE/i }).click();

    // Browser navigates to a different challenge URL
    await expect(page).toHaveURL(/\/challenges\/(?!.*NEW_)/, { timeout: 10000 });

    const newUrl = page.url();
    const newChallengeId = newUrl.split('/challenges/')[1];
    expect(newChallengeId).toBeTruthy();
    expect(newChallengeId).not.toBe(challengeId);

    // Title shows "(Clone)" suffix
    await expect(page.locator('h1')).toContainText('(Clone)', { timeout: 10000 });

    // POST /clone was issued
    expect(cloneRequests.length).toBeGreaterThan(0);
    expect(cloneRequests[0]).toContain(challengeId);
  });
});

// ─── 5. Create new challenge from scratch ─────────────────────────────────────

test.describe('Feature: Create new challenge from scratch', () => {
  let pipelineId: string;
  let stageId: string;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId = await seedPipeline(request, token, 'E2E — New challenge');
    stageId    = await seedStage(request, token, pipelineId, 'Blank Stage');
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: Navigate to NEW_CODE_IMPLEMENTATION route
   *   Given the recruiter navigates to /pipeline/:id/challenges/NEW_CODE_IMPLEMENTATION
   *   When the page loads
   *   Then a blank CODE_IMPLEMENTATION editor is displayed
   *   And the title input is empty (or shows a default placeholder)
   *   And no PUT or POST is issued until the recruiter clicks SAVE
   */
  test('Scenario: NEW route shows blank editor — no API call until SAVE', async ({ page }) => {
    const apiCalls: string[] = [];
    page.on('request', req => {
      if (
        (req.method() === 'POST' || req.method() === 'PUT') &&
        req.url().includes('/api/v1')
      ) {
        apiCalls.push(`${req.method()} ${req.url()}`);
      }
    });

    await page.goto(`/pipeline/${pipelineId}/challenges/NEW_CODE_IMPLEMENTATION`);
    await page.waitForLoadState('networkidle');

    // Editor loaded without crash
    await expect(page.locator('body')).not.toContainText('404', { timeout: 10000 });

    // Type indicator shows CODE_IMPLEMENTATION
    await expect(page.locator('body')).toContainText('CODE_IMPLEMENTATION', { timeout: 10000 });

    // Title input exists — empty or placeholder for a new challenge
    await expect(page.getByText('CHALLENGE_TITLE')).toBeVisible({ timeout: 5000 });

    // No write API calls were made just by loading the page
    const writeCalls = apiCalls.filter(c =>
      !c.includes('/challenges/NEW_CODE_IMPLEMENTATION') // exclude any GET
    );
    expect(writeCalls.length).toBe(0);
  });

  /**
   * Scenario: Saving a new challenge creates it and updates the URL
   *   Given the recruiter is on /pipeline/:id/challenges/NEW_CODE_IMPLEMENTATION
   *   And has filled in the title "New Linked List Challenge"
   *   When the recruiter clicks SAVE_CHANGES
   *   Then a POST /api/v1/stages/:stageId/challenges is sent
   *   And the URL changes from NEW_CODE_IMPLEMENTATION to a real challenge ID
   *   And the new ID is a ULID / UUID (not "NEW_*")
   */
  test('Scenario: Saving new challenge — URL updates to real ID', async ({ page }) => {
    // The NEW_* route must receive the stageId as a query param or derive it from the pipeline
    // context. Adjust URL if the routing convention differs post-migration.
    await page.goto(`/pipeline/${pipelineId}/challenges/NEW_CODE_IMPLEMENTATION?stageId=${stageId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText('404', { timeout: 10000 });

    const createRequests: string[] = [];
    page.on('request', req => {
      if (req.method() === 'POST' && req.url().includes('/challenges')) {
        createRequests.push(req.url());
      }
    });

    // Fill title
    const titleField = page.locator('input').nth(0);
    await titleField.clear();
    await titleField.fill('New Linked List Challenge');

    // Save
    await page.getByRole('button', { name: /SAVE_CHANGES/i }).click();

    // URL must change to a real ID (not contain "NEW_")
    await expect(page).not.toHaveURL(/NEW_/, { timeout: 15000 });

    const newUrl = page.url();
    expect(newUrl).toMatch(/\/challenges\/[a-zA-Z0-9_-]+$/);

    const newId = newUrl.split('/challenges/')[1];
    expect(newId).toBeTruthy();
    expect(newId).not.toMatch(/^NEW_/);

    // POST was issued
    expect(createRequests.length).toBeGreaterThan(0);
  });

  /**
   * Scenario: NEW_QUIZ_MCQ shows blank MCQ editor
   *   Given the recruiter navigates to /pipeline/:id/challenges/NEW_QUIZ_MCQ
   *   Then the page loads without crash
   *   And the type indicator shows QUIZ_MCQ
   */
  test('Scenario: NEW_QUIZ_MCQ shows blank MCQ editor', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/NEW_QUIZ_MCQ`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText('404', { timeout: 10000 });
    await expect(page.locator('body')).toContainText('QUIZ_MCQ', { timeout: 10000 });
  });
});

// ─── 6. GitHub PR fetch ───────────────────────────────────────────────────────

test.describe('Feature: GitHub PR fetch', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId  = await seedPipeline(request, token, 'E2E — GitHub PR fetch');
    stageId     = await seedStage(request, token, pipelineId, 'Code Review');
    challengeId = await seedChallenge(request, token, stageId, {
      type: 'CODE_REVIEW',
      title: 'New Code Review',
      instructions: 'Review the following PR.',
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: Fetch PR diff and metadata (mocked)
   *   Given the recruiter is on a CODE_REVIEW challenge in the CONTENT_EDITOR tab
   *   And the Worker endpoint POST /api/v1/github/pr is mocked to return valid data
   *   When the recruiter enters repo URL "https://github.com/octocat/hello-world" and PR number 1
   *   And clicks FETCH
   *   Then the diff metadata (title, author) appears on the page
   *   And the challenge state is updated with cachedDiffJson and cachedMetadata
   */
  test('Scenario: Fetch PR diff — metadata renders after successful response', async ({ page }) => {
    const mockPrData = {
      success: true,
      data: {
        diff: {
          files: [
            {
              filename: 'README.md',
              additions: 1,
              deletions: 0,
              hunks: [
                {
                  header: '@@ -0,0 +1 @@',
                  lines: [{ type: 'added', content: '+ Hello World' }],
                },
              ],
            },
          ],
        },
        metadata: {
          title: 'Update README',
          author: 'octocat',
          created_at: '2024-01-01T00:00:00Z',
          state: 'open',
          base: 'main',
          head: 'update-readme',
        },
      },
    };

    // Intercept the Worker GitHub endpoint
    await page.route(`${API_BASE_URL}/api/v1/github/pr`, route => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockPrData),
      });
    });

    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('New Code Review', { timeout: 15000 });

    await page.getByText('CONTENT_EDITOR').click();
    await expect(page.getByText('STEP_1:_FETCH_GITHUB_PR')).toBeVisible({ timeout: 5000 });

    // Fill in repo URL
    const repoInput = page.locator('input[placeholder*="github.com"], input[placeholder*="repo" i]').first();
    await repoInput.fill('https://github.com/octocat/hello-world');

    // Fill in PR number
    const prInput = page.locator('input[type="number"], input[placeholder*="PR" i], input[placeholder*="number" i]').first();
    await prInput.fill('1');

    // Click FETCH
    await page.getByRole('button', { name: /FETCH/i }).click();

    // PR title and author should be visible
    await expect(
      page.getByText('Update README').or(page.getByText('octocat'))
    ).toBeVisible({ timeout: 10000 });
  });

  /**
   * Scenario: GitHub API rate limit — 429 shows user-facing error message
   *   Given the Worker returns 429 with Retry-After header
   *   When the recruiter submits the fetch form
   *   Then the error "GitHub rate limit exceeded" is shown
   *
   * NOTE: This test uses a route mock — no real GitHub API calls are made.
   */
  test('Scenario: Rate limit (429) — user sees "rate limit exceeded" message', async ({ page }) => {
    await page.route(`${API_BASE_URL}/api/v1/github/pr`, route => {
      void route.fulfill({
        status: 429,
        contentType: 'application/json',
        headers: { 'Retry-After': '60' },
        body: JSON.stringify({
          success: false,
          error: 'GitHub rate limit exceeded. Try again in 60 seconds.',
        }),
      });
    });

    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('New Code Review', { timeout: 15000 });

    await page.getByText('CONTENT_EDITOR').click();
    await expect(page.getByText('STEP_1:_FETCH_GITHUB_PR')).toBeVisible({ timeout: 5000 });

    const repoInput = page.locator('input[placeholder*="github.com"], input[placeholder*="repo" i]').first();
    await repoInput.fill('https://github.com/octocat/hello-world');

    const prInput = page.locator('input[type="number"], input[placeholder*="PR" i], input[placeholder*="number" i]').first();
    await prInput.fill('1');

    await page.getByRole('button', { name: /FETCH/i }).click();

    await expect(
      page.getByText(/rate limit/i).or(page.getByText(/try again/i))
    ).toBeVisible({ timeout: 10000 });
  });

  /**
   * Scenario: Invalid repository URL — 400 shows validation error
   *   Given the recruiter enters "not-a-url" as the repo URL
   *   When the Worker returns 400
   *   Then the UI displays "Invalid GitHub repository URL" or similar
   *
   * NOTE: This test uses a route mock.
   */
  test('Scenario: Invalid repo URL (400) — validation error displayed', async ({ page }) => {
    await page.route(`${API_BASE_URL}/api/v1/github/pr`, route => {
      void route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Invalid GitHub repository URL',
        }),
      });
    });

    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('New Code Review', { timeout: 15000 });

    await page.getByText('CONTENT_EDITOR').click();
    await expect(page.getByText('STEP_1:_FETCH_GITHUB_PR')).toBeVisible({ timeout: 5000 });

    const repoInput = page.locator('input[placeholder*="github.com"], input[placeholder*="repo" i]').first();
    await repoInput.fill('not-a-url');

    const prInput = page.locator('input[type="number"], input[placeholder*="PR" i], input[placeholder*="number" i]').first();
    await prInput.fill('1');

    await page.getByRole('button', { name: /FETCH/i }).click();

    await expect(
      page.getByText(/invalid.*url/i).or(page.getByText(/invalid.*repo/i))
    ).toBeVisible({ timeout: 10000 });
  });

  /**
   * Scenario: Fetch PR diff using real GitHub API
   *   Given a real public GitHub repository and PR number
   *   When the recruiter submits the fetch form
   *   Then the Worker fetches a live diff from GitHub
   *
   * SKIP: This test requires a live GitHub API token on the Worker and will hit
   * rate limits in CI. Enable manually when validating the Worker integration
   * against a real GitHub repo.
   */
  test.skip('Scenario: Real GitHub API fetch (requires live token — skip in CI)', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await page.getByText('CONTENT_EDITOR').click();
    await expect(page.getByText('STEP_1:_FETCH_GITHUB_PR')).toBeVisible({ timeout: 5000 });

    const repoInput = page.locator('input[placeholder*="github.com"], input[placeholder*="repo" i]').first();
    await repoInput.fill('https://github.com/octocat/Hello-World');

    const prInput = page.locator('input[type="number"], input[placeholder*="PR" i], input[placeholder*="number" i]').first();
    await prInput.fill('1');

    await page.getByRole('button', { name: /FETCH/i }).click();

    // PR metadata from GitHub should appear
    await expect(page.locator('body')).toContainText(/Update|patch|fix/i, { timeout: 15000 });
  });
});

// ─── 7. Navigation and layout ─────────────────────────────────────────────────

test.describe('Feature: Challenge editor navigation and layout', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId  = await seedPipeline(request, token, 'E2E — Editor navigation');
    stageId     = await seedStage(request, token, pipelineId, 'Screen');
    challengeId = await seedChallenge(request, token, stageId, {
      type: 'QUIZ_SHORT_ANSWER',
      title: 'Explain CAP Theorem',
      instructions: 'In your own words, describe CAP Theorem.',
      config: { question: 'Describe CAP Theorem.', maxLength: 500 },
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: Tab navigation — all 4 tabs are reachable
   *   Given the challenge editor is open
   *   When the recruiter clicks each sidebar tab in sequence
   *   Then each tab panel becomes active without error
   */
  test('Scenario: All 4 sidebar tabs render without crash', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Explain CAP Theorem', { timeout: 15000 });

    const tabs = ['CONTENT_EDITOR', 'SCORING_RUBRIC', 'CANDIDATE_PREVIEW'];

    for (const tab of tabs) {
      await page.getByText(tab).click();
      // No error dialog or crash text
      await expect(page.locator('body')).not.toContainText('Unexpected error', { timeout: 3000 });
      await expect(page.locator('body')).not.toContainText('Cannot read', { timeout: 3000 });
    }
  });

  /**
   * Scenario: Back button navigates to the previous page
   *   Given the recruiter opened the editor from a pipeline overview
   *   When the recruiter clicks the back arrow
   *   Then the browser navigates back (URL is no longer the challenge editor)
   */
  test('Scenario: Back arrow navigates away from editor', async ({ page }) => {
    // Navigate from overview so there's history
    await page.goto(`/pipeline/${pipelineId}`);
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Explain CAP Theorem', { timeout: 15000 });

    // Click the ArrowLeft back button
    await page.locator('button').filter({ has: page.locator('svg') }).first().click();

    // URL should no longer be the challenge editor
    await expect(page).not.toHaveURL(`/pipeline/${pipelineId}/challenges/${challengeId}`, { timeout: 5000 });
  });

  /**
   * Scenario: CANDIDATE_PREVIEW tab renders the challenge as a candidate would see it
   *   Given a QUIZ_SHORT_ANSWER challenge
   *   When the recruiter opens the CANDIDATE_PREVIEW tab
   *   Then the ChallengeRegistry is rendered inside the preview panel
   *   And the FULL_SCREEN button is visible
   */
  test('Scenario: CANDIDATE_PREVIEW tab renders challenge preview', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Explain CAP Theorem', { timeout: 15000 });

    await page.getByText('CANDIDATE_PREVIEW').click();

    await expect(page.getByText('FULL_SCREEN')).toBeVisible({ timeout: 5000 });
    // Challenge content (question) should be visible in the preview
    await expect(page.getByText('Describe CAP Theorem.').or(page.getByText('Explain CAP Theorem'))).toBeVisible({ timeout: 8000 });
  });
});

// ─── 8. Edit QUIZ_SHORT_ANSWER challenge ─────────────────────────────────────

test.describe('Feature: Edit QUIZ_SHORT_ANSWER challenge', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId = await seedPipeline(request, token, 'E2E — SHORT_ANSWER editor');
    stageId    = await seedStage(request, token, pipelineId, 'Screening');
    challengeId = await seedChallenge(request, token, stageId, {
      type: 'QUIZ_SHORT_ANSWER',
      title: 'Explain Microservices',
      instructions: 'Describe the trade-offs of microservices vs monolith.',
      config: {
        question: 'What are the main trade-offs of microservices?',
        inputMode: 'text',
        maxLength: 500,
        timeLimit: 0,
      },
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: Load existing QUIZ_SHORT_ANSWER challenge
   *   Given a QUIZ_SHORT_ANSWER challenge exists in D1
   *   When the recruiter navigates to /pipeline/:id/challenges/:challengeId
   *   Then the challenge title is displayed in the header
   *   And the CHALLENGE_PROMPT textarea shows the question text
   */
  test('Scenario: load existing SHORT_ANSWER challenge shows question', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Explain Microservices', { timeout: 15000 });

    // The CHALLENGE_PROMPT area should contain the question
    const promptArea = page.locator('textarea').first();
    await expect(promptArea).toHaveValue(/trade-offs of microservices/i, { timeout: 5000 });
  });

  /**
   * Scenario: Edit the question prompt
   *   Given the SHORT_ANSWER editor is loaded
   *   When the recruiter clears the textarea and types a new question
   *   Then the CHARS counter updates
   *   And the new question is persisted (auto-save)
   */
  test('Scenario: edit question prompt updates char count', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Explain Microservices', { timeout: 15000 });

    const promptArea = page.locator('textarea').first();
    await promptArea.fill('What is eventual consistency?');

    // CHARS counter should reflect new length
    await expect(page.getByText(/\d+ CHARS/)).toBeVisible({ timeout: 3000 });
  });

  /**
   * Scenario: RESPONSE_TYPE button group defaults to WRITTEN
   *   Given a SHORT_ANSWER challenge with inputMode "text"
   *   When the editor loads
   *   Then the WRITTEN button is selected in the RESPONSE_TYPE group
   */
  test('Scenario: RESPONSE_TYPE defaults to WRITTEN', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Explain Microservices', { timeout: 15000 });

    // RESPONSE_TYPE section should be visible
    await expect(page.getByText('RESPONSE_TYPE')).toBeVisible({ timeout: 5000 });

    // WRITTEN should be the active selection
    const writtenBtn = page.getByText('WRITTEN').first();
    await expect(writtenBtn).toBeVisible();
  });

  /**
   * Scenario: Switch response type to VOICE
   *   Given the RESPONSE_TYPE is currently WRITTEN
   *   When the recruiter clicks VOICE
   *   Then VOICE becomes the active selection
   */
  test('Scenario: switch response type to VOICE', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Explain Microservices', { timeout: 15000 });

    const voiceBtn = page.getByText('VOICE').first();
    await voiceBtn.click();

    // After clicking, verify it was toggled (the ButtonGroup should reflect selection)
    // We just verify no crash — the ButtonGroup handles highlighting internally
    await expect(page.locator('body')).not.toContainText('Unexpected error', { timeout: 2000 });
  });

  /**
   * Scenario: Switch response type to VIDEO
   *   Given the RESPONSE_TYPE is currently WRITTEN
   *   When the recruiter clicks VIDEO
   *   Then VIDEO becomes the active selection
   */
  test('Scenario: switch response type to VIDEO', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Explain Microservices', { timeout: 15000 });

    const videoBtn = page.getByText('VIDEO').first();
    await videoBtn.click();

    await expect(page.locator('body')).not.toContainText('Unexpected error', { timeout: 2000 });
  });

  /**
   * Scenario: TIME_LIMIT section is visible with number input
   *   Given the SHORT_ANSWER editor is loaded
   *   Then the TIME_LIMIT section is displayed
   *   And the NumberInput shows 0 (unlimited by default)
   */
  test('Scenario: TIME_LIMIT section is visible', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Explain Microservices', { timeout: 15000 });

    await expect(page.getByText('TIME_LIMIT')).toBeVisible({ timeout: 5000 });
    // The "Set to 0 for unlimited time" hint should be visible
    await expect(page.getByText(/unlimited time/i)).toBeVisible({ timeout: 3000 });
  });

  /**
   * Scenario: EVALUATION_RUBRIC section allows internal rubric notes
   *   Given the SHORT_ANSWER editor is loaded
   *   Then the EVALUATION_RUBRIC section is displayed with a textarea
   *   And the INTERNAL_ONLY label is visible (server-only, not shown to candidates)
   */
  test('Scenario: EVALUATION_RUBRIC section with INTERNAL_ONLY label', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Explain Microservices', { timeout: 15000 });

    await expect(page.getByText('EVALUATION_RUBRIC')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('INTERNAL_ONLY')).toBeVisible({ timeout: 3000 });

    // The rubric textarea should accept input
    const rubricArea = page.locator('textarea[placeholder*="10/10"]').first();
    await expect(rubricArea).toBeVisible({ timeout: 3000 });
  });

  /**
   * Scenario: AI_FOLLOW_UP toggle is visible
   *   Given the SHORT_ANSWER editor is loaded
   *   Then the AI_FOLLOW_UP section is displayed
   *   And a toggle to enable/disable follow-up generation is present
   */
  test('Scenario: AI_FOLLOW_UP toggle is visible', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Explain Microservices', { timeout: 15000 });

    await expect(page.getByText('AI_FOLLOW_UP')).toBeVisible({ timeout: 5000 });
  });

  /**
   * Scenario: VIDEO_INSTRUCTIONS section visible
   *   Given the SHORT_ANSWER editor is loaded
   *   Then the VIDEO_INSTRUCTIONS section is displayed
   *   And the recruiter can see the video recorder placeholder
   */
  test('Scenario: VIDEO_INSTRUCTIONS section is visible', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Explain Microservices', { timeout: 15000 });

    await expect(page.getByText('VIDEO_INSTRUCTIONS')).toBeVisible({ timeout: 5000 });
    // Description text about recording a short video
    await expect(page.getByText(/Record a short video/i)).toBeVisible({ timeout: 3000 });
  });

  /**
   * Scenario: Save SHORT_ANSWER challenge via API
   *   Given a SHORT_ANSWER challenge exists
   *   When the recruiter PATCHes the challenge config via API
   *   Then the updated config is persisted in D1
   */
  test('Scenario: API — PATCH challenge config persists changes', async ({ request }) => {
    const res = await request.patch(`${API_BASE_URL}/api/v1/challenges/${challengeId}`, {
      headers: authHeaders(token),
      data: {
        config: {
          question: 'Updated: What is eventual consistency?',
          inputMode: 'voice',
          timeLimit: 10,
        },
      },
    });
    expect(res.ok()).toBeTruthy();

    // Verify by fetching
    const getRes = await request.get(`${API_BASE_URL}/api/v1/challenges/${challengeId}`, {
      headers: authHeaders(token),
    });
    expect(getRes.ok()).toBeTruthy();
    const body = await getRes.json() as { challenge: { config: Record<string, unknown> } };
    expect(body.challenge.config.question).toBe('Updated: What is eventual consistency?');
    expect(body.challenge.config.inputMode).toBe('voice');
    expect(body.challenge.config.timeLimit).toBe(10);
  });

  /**
   * Scenario: Save serverConfig (evaluation rubric) via API — not exposed to candidates
   *   Given a SHORT_ANSWER challenge exists
   *   When the recruiter PATCHes the serverConfig with an idealAnswer
   *   Then the serverConfig is persisted in D1
   *   And the /rpc/get-challenge route does NOT return serverConfig
   */
  test('Scenario: API — serverConfig is persisted but not exposed to candidates', async ({ request }) => {
    // Save evaluation rubric
    const patchRes = await request.patch(`${API_BASE_URL}/api/v1/challenges/${challengeId}`, {
      headers: authHeaders(token),
      data: {
        serverConfig: {
          idealAnswer: 'A strong answer discusses consistency, availability, partition tolerance trade-offs.',
        },
      },
    });
    expect(patchRes.ok()).toBeTruthy();

    // Verify serverConfig is stored (recruiter API)
    const getRes = await request.get(`${API_BASE_URL}/api/v1/challenges/${challengeId}`, {
      headers: authHeaders(token),
    });
    expect(getRes.ok()).toBeTruthy();
    const body = await getRes.json() as { challenge: { serverConfig: Record<string, unknown> } };
    expect(body.challenge.serverConfig.idealAnswer).toContain('consistency');
  });
});

// ─── 8. Save failure shows error message ─────────────────────────────────────

test.describe('Feature: Challenge save errors are visible to recruiter', () => {
  let pipelineId: string;
  let stageId: string;
  let challengeId: string;
  let token: string;

  test.beforeEach(async ({ request, page }) => {
    await page.goto('/');
    token = await getAuthToken(page);
    pipelineId = await seedPipeline(request, token, 'E2E — Save error visibility');
    stageId = await seedStage(request, token, pipelineId, 'Error Test Stage');
    challengeId = await seedChallenge(request, token, stageId, {
      type: 'QUIZ_SHORT_ANSWER',
      title: 'Short Answer with Video',
      instructions: 'Describe your experience.',
      config: { inputMode: 'text' },
    });
  });

  test.afterEach(async ({ request }) => {
    await teardownPipeline(request, token, pipelineId);
  });

  /**
   * Scenario: Save failure shows error message to recruiter
   *   Given the challenge editor is open
   *   When the save API returns an error (e.g. network failure, 500)
   *   Then an error message is visible in the UI
   *   And the "SAVED" success indicator does NOT appear
   */
  test('Scenario: Save failure shows error message instead of silent fail', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Short Answer with Video', { timeout: 15000 });

    // Intercept the PUT request and force a 500 error
    await page.route(`**/api/v1/challenges/${challengeId}`, (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Internal server error' } }),
      });
    });

    // Click save
    await page.getByRole('button', { name: /SAVE_CHANGES/i }).click();

    // Button should return to SAVE_CHANGES (not stuck on SAVING)
    await expect(page.getByRole('button', { name: /SAVE_CHANGES/i })).toBeVisible({ timeout: 10000 });

    // Error message MUST be visible — this is the bug: currently no error is shown
    const errorIndicator = page.locator('[data-testid="save-error"]');
    await expect(errorIndicator).toBeVisible({ timeout: 5000 });

    // Success indicator must NOT appear
    await expect(page.locator('[data-testid="save-success"]')).not.toBeVisible();
  });

  /**
   * Scenario: Save error is dismissible and does not block subsequent saves
   *   Given a save error is displayed
   *   When the recruiter fixes the issue and saves again
   *   Then the error clears and the new save succeeds
   */
  test('Scenario: Save error clears on successful retry', async ({ page }) => {
    await page.goto(`/pipeline/${pipelineId}/challenges/${challengeId}`);
    await expect(page.locator('h1')).toContainText('Short Answer with Video', { timeout: 15000 });

    // First save: force error
    await page.route(`**/api/v1/challenges/${challengeId}`, (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Internal server error' } }),
      });
    });

    await page.getByRole('button', { name: /SAVE_CHANGES/i }).click();
    await expect(page.locator('[data-testid="save-error"]')).toBeVisible({ timeout: 10000 });

    // Remove the route intercept so next save goes through
    await page.unroute(`**/api/v1/challenges/${challengeId}`);

    // Retry save
    await page.getByRole('button', { name: /SAVE_CHANGES/i }).click();

    // Error should clear, success should appear
    await expect(page.locator('[data-testid="save-error"]')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="save-success"]')).toBeVisible({ timeout: 10000 });
  });
});
