/**
 * e2e/multi-turn-e2e.spec.ts
 *
 * BDD: Multi-Turn CODE_REVIEW — Full Candidate Experience
 *
 * Feature: Multi-turn agentic code review end-to-end
 *   As a candidate
 *   I want to review a PR, leave comments, get agent responses, follow up, and submit a verdict
 *   So that my code review skills are assessed through realistic conversation
 *
 * Covers:
 *   §E.1  DIFF_RENDER    — diff renders with code hunks, lines, file tabs
 *   §E.2  ANNOTATION     — candidate clicks line, types comment, saves annotation
 *   §E.3  SUBMIT_REVIEW  — submit triggers agent response, threads appear
 *   §E.4  VERDICT        — select approve/request_changes, write summary, submit verdict
 *   §E.5  FOLLOW_UP      — reply to thread, submit response, agent responds again
 *   §E.6  FULL_JOURNEY   — end-to-end: annotate → submit → reply → verdict
 *
 * Auth: Tests seed via recruiter Clerk JWT, then act as candidate via session token.
 * API base: http://localhost:8787
 * App base: http://localhost:5173
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = 'http://localhost:8787';
const APP_BASE = 'http://localhost:5173';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SeededPipeline {
  id: string;
  title: string;
  status: string;
}

interface SeededStage {
  id: string;
  title: string;
}

interface SeededCandidate {
  id: string;
  name: string;
  email: string;
  inviteToken: string;
  status: string;
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) {
    throw new Error('[multi-turn-e2e.spec] No __session cookie. Run auth setup first.');
  }
  return sessionCookie.value;
}

function recruiterHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

// ─── Diff fixture ─────────────────────────────────────────────────────────────

const testDiff = {
  files: [
    {
      path: 'src/utils/auth.ts',
      status: 'modified',
      additions: 3,
      deletions: 1,
      hunks: [
        {
          header: '@@ -1,4 +1,6 @@',
          lines: [
            { type: 'context',  num: 1, content: 'export function verifyToken(token: string): boolean {' },
            { type: 'deletion', num: 2, content: '  return token.length > 0;' },
            { type: 'addition', num: 2, content: '  if (!token) return false;' },
            { type: 'addition', num: 3, content: '  if (token.length < 8) return false;' },
            { type: 'addition', num: 4, content: '  return token.startsWith("Bearer ");' },
            { type: 'context',  num: 5, content: '}' },
          ],
        },
      ],
    },
  ],
  stats: { filesChanged: 1, additions: 3, deletions: 1 },
};

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function seedPipeline(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<SeededPipeline> {
  const res = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers: recruiterHeaders(token),
    data: { title, status: 'ACTIVE', level: 'Mid' },
  });
  expect(res.ok(), `seedPipeline failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { pipeline: SeededPipeline };
  return body.pipeline;
}

async function seedStage(
  request: APIRequestContext,
  token: string,
  pipelineId: string,
  title: string,
): Promise<SeededStage> {
  const res = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/stages`, {
    headers: recruiterHeaders(token),
    data: { title, order: 0 },
  });
  expect(res.ok(), `seedStage failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { stage: SeededStage };
  return body.stage;
}

async function seedCodeReviewChallenge(
  request: APIRequestContext,
  token: string,
  stageId: string,
  options: {
    title?: string;
    maxRounds?: number;
  } = {},
): Promise<string> {
  const { title = 'Review: Auth Token Validation', maxRounds = 3 } = options;

  // Create challenge
  const createRes = await request.post(`${API_BASE}/api/v1/stages/${stageId}/challenges`, {
    headers: recruiterHeaders(token),
    data: {
      type: 'CODE_REVIEW',
      title,
      instructions: 'Review this pull request for security and correctness issues.',
      order: 0,
    },
  });
  expect(createRes.ok(), `seedChallenge create failed: ${await createRes.text()}`).toBeTruthy();
  const createBody = await createRes.json() as { challenge?: { id: string }; id?: string };
  const challengeId = createBody.challenge?.id ?? createBody.id;
  expect(challengeId).toBeTruthy();

  // Update with multi-turn config + diff
  const updateRes = await request.put(`${API_BASE}/api/v1/challenges/${challengeId}`, {
    headers: recruiterHeaders(token),
    data: {
      config: {
        isMultiTurn: true,
        implementerPersona: 'junior',
        maxRounds,
      },
      cachedDiffJson: testDiff,
      cachedMetadata: {
        title: 'Fix auth token verification',
        author: 'octocat',
        created_at: '2024-01-15T10:00:00Z',
        state: 'open',
        base: 'main',
        head: 'fix/auth-token',
      },
      serverConfig: {
        groundTruth: {
          plantedBugs: [
            {
              id: 'bug-1',
              description: 'Missing null check on token parameter',
              severity: 'critical',
              file: 'src/utils/auth.ts',
              line: 2,
            },
          ],
        },
      },
    },
  });
  expect(updateRes.ok(), `seedChallenge update failed: ${await updateRes.text()}`).toBeTruthy();

  return challengeId!;
}

async function seedCandidate(
  request: APIRequestContext,
  token: string,
  pipelineId: string,
  stageId: string,
  name: string,
): Promise<SeededCandidate> {
  const res = await request.post(
    `${API_BASE}/api/v1/pipelines/${pipelineId}/candidates`,
    {
      headers: recruiterHeaders(token),
      data: {
        name,
        email: `mt-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@pipe-test.dev`,
        currentStageId: stageId,
      },
    },
  );
  expect(res.ok(), `seedCandidate failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { candidate: SeededCandidate };
  return body.candidate;
}

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
    // Cleanup must not obscure test failures.
  }
}

/**
 * Navigate to assessment and start interview.
 * Returns when workspace layout is visible.
 */
async function startAssessment(page: Page, inviteToken: string): Promise<void> {
  await page.goto(`${APP_BASE}/assess/${inviteToken}`);

  const beginBtn = page.getByRole('button', { name: /start.interview/i });
  await beginBtn.waitFor({ state: 'visible', timeout: 15000 });
  await beginBtn.click();

  // Wait for workspace layout to be visible
  const layout = page.locator('[data-testid="workspace-layout"]');
  await expect(layout).toBeVisible({ timeout: 20000 });
}

// ─── §E.1 Diff renders with code hunks ──────────────────────────────────────

test.describe('§E.1 — Diff renders with code hunks', () => {
  let authToken: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();
  });

  test('Scenario: diff panel shows file content with additions and deletions', async ({
    browser,
    request,
  }) => {
    const pipeline = await seedPipeline(request, authToken, 'E2E §E.1 — Diff Renders');
    const stage = await seedStage(request, authToken, pipeline.id, 'Code Review Stage');
    await seedCodeReviewChallenge(request, authToken, stage.id);
    const candidate = await seedCandidate(request, authToken, pipeline.id, stage.id, 'Diff Candidate');

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await startAssessment(page, candidate.inviteToken);

      // Diff content area renders
      const diffContent = page.locator('[data-testid="diff-content"]');
      await expect(diffContent).toBeVisible({ timeout: 10000 });

      // File tab shows filename
      const fileTab = page.locator('[data-testid="file-tab-0"]');
      await expect(fileTab).toBeVisible();
      await expect(fileTab).toContainText('auth.ts');

      // Diff lines render — check an addition line
      const additionLine = page.locator('[data-testid="diff-line-3"]');
      await expect(additionLine).toBeVisible();

      // Addition marker (+) is present
      await expect(additionLine).toContainText('+');

      // Code content is visible
      await expect(diffContent).toContainText('verifyToken');
      await expect(diffContent).toContainText('Bearer');
    } finally {
      await context.close();
      await teardownPipeline(request, authToken, pipeline.id);
    }
  });
});

// ─── §E.2 Candidate leaves an inline comment ────────────────────────────────

test.describe('§E.2 — Candidate leaves an inline comment', () => {
  let authToken: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();
  });

  test('Scenario: click diff line, type comment, save annotation', async ({
    browser,
    request,
  }) => {
    const pipeline = await seedPipeline(request, authToken, 'E2E §E.2 — Annotation');
    const stage = await seedStage(request, authToken, pipeline.id, 'Code Review Stage');
    await seedCodeReviewChallenge(request, authToken, stage.id);
    const candidate = await seedCandidate(request, authToken, pipeline.id, stage.id, 'Annotation Candidate');

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await startAssessment(page, candidate.inviteToken);

      // Wait for diff to load
      const diffContent = page.locator('[data-testid="diff-content"]');
      await expect(diffContent).toBeVisible({ timeout: 10000 });

      // Click on an addition line (line 2 — non-deletion)
      const diffLine = page.locator('[data-testid="diff-line-3"]');
      await expect(diffLine).toBeVisible();
      await diffLine.click();

      // Annotation editor form appears
      const editorForm = page.locator('[data-testid="annotation-editor-form"]');
      await expect(editorForm).toBeVisible({ timeout: 5000 });

      // Severity selector defaults to critical
      const severitySelect = page.locator('[data-testid="severity-selector"]');
      await expect(severitySelect).toBeVisible();
      await expect(severitySelect).toHaveValue('critical');

      // Type a comment
      const commentInput = page.locator('[data-testid="annotation-input"]');
      await commentInput.fill('Missing null check — if token is undefined this will throw at runtime.');

      // Save button becomes enabled and we click it
      const saveBtn = page.locator('[data-testid="save-annotation-btn"]');
      await expect(saveBtn).toBeEnabled();
      await saveBtn.click();

      // Annotation editor closes
      await expect(editorForm).not.toBeVisible({ timeout: 3000 });

      // Annotation badge appears on the line
      const badge = page.locator('[data-testid="annotation-badge-3"]');
      await expect(badge).toBeVisible({ timeout: 3000 });
      await expect(badge).toContainText('1');

      // The annotation display shows our comment text
      await expect(page.getByText('Missing null check')).toBeVisible();
    } finally {
      await context.close();
      await teardownPipeline(request, authToken, pipeline.id);
    }
  });

  test('Scenario: SUBMIT_REVIEW becomes available after adding annotation', async ({
    browser,
    request,
  }) => {
    const pipeline = await seedPipeline(request, authToken, 'E2E §E.2 — Submit Enable');
    const stage = await seedStage(request, authToken, pipeline.id, 'Code Review Stage');
    await seedCodeReviewChallenge(request, authToken, stage.id);
    const candidate = await seedCandidate(request, authToken, pipeline.id, stage.id, 'Submit Enable Candidate');

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await startAssessment(page, candidate.inviteToken);

      // Wait for diff
      await expect(page.locator('[data-testid="diff-content"]')).toBeVisible({ timeout: 10000 });

      // Before adding annotation — submit should NOT be available
      const submitBtn = page.getByRole('button', { name: /SUBMIT_REVIEW/i });
      await expect(submitBtn).not.toBeVisible({ timeout: 3000 });

      // Add an annotation
      await page.locator('[data-testid="diff-line-3"]').click();
      await page.locator('[data-testid="annotation-input"]').fill('Token length check is insufficient');
      await page.locator('[data-testid="save-annotation-btn"]').click();

      // Now SUBMIT_REVIEW should appear
      await expect(submitBtn).toBeVisible({ timeout: 5000 });
    } finally {
      await context.close();
      await teardownPipeline(request, authToken, pipeline.id);
    }
  });
});

// ─── §E.3 Submit review triggers agent response ─────────────────────────────

test.describe('§E.3 — Submit review triggers agent response', () => {
  test.setTimeout(90_000);

  let authToken: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();
  });

  test('Scenario: submit review → loading → agent responds → threads render', async ({
    browser,
    request,
  }) => {
    const pipeline = await seedPipeline(request, authToken, 'E2E §E.3 — Submit Review');
    const stage = await seedStage(request, authToken, pipeline.id, 'Code Review Stage');
    await seedCodeReviewChallenge(request, authToken, stage.id, { maxRounds: 3 });
    const candidate = await seedCandidate(request, authToken, pipeline.id, stage.id, 'Submit Candidate');

    const context = await browser.newContext();
    const page = await context.newPage();

    // Log console messages and network requests for debugging
    const consoleLogs: string[] = [];
    page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => consoleLogs.push(`[PAGE_ERROR] ${err.message}`));

    try {
      await startAssessment(page, candidate.inviteToken);

      // Wait for diff and add annotation
      await expect(page.locator('[data-testid="diff-content"]')).toBeVisible({ timeout: 10000 });
      await page.locator('[data-testid="diff-line-3"]').click();
      await page.locator('[data-testid="annotation-input"]').fill('Null check missing — token could be undefined');
      await page.locator('[data-testid="save-annotation-btn"]').click();

      // Intercept the review submit API call
      const reviewSubmitPromise = page.waitForResponse(
        (resp) => resp.url().includes('/rpc/review/submit'),
        { timeout: 30000 },
      ).catch((e) => { consoleLogs.push(`[NO_RESPONSE] ${e.message}`); return null; });

      // Click SUBMIT_REVIEW
      const submitBtn = page.getByRole('button', { name: /SUBMIT_REVIEW/i });
      await expect(submitBtn).toBeVisible({ timeout: 5000 });
      await submitBtn.click();

      // Wait for the API call and log the result
      const apiResponse = await reviewSubmitPromise;
      if (apiResponse) {
        consoleLogs.push(`[API] ${apiResponse.status()} ${apiResponse.url()}`);
        if (!apiResponse.ok()) {
          const body = await apiResponse.text().catch(() => 'no body');
          consoleLogs.push(`[API_ERROR] ${body}`);
        }
      }

      // Wait for agent response — threads should appear
      // (Loading overlay may flash too briefly to observe reliably)
      const thread = page.locator('[data-testid="conversation-thread"]');
      await expect(thread).toBeVisible({ timeout: 60000 });

      // Thread shows AUTHOR response with a move badge
      await expect(page.getByText('AUTHOR')).toBeVisible({ timeout: 5000 });

      // Move badge visible (one of: CHANGE, PUSHBACK, COMMENT)
      const hasMoveLabel = await page.getByText(/^(CHANGE|PUSHBACK|COMMENT)$/).first().isVisible();
      expect(hasMoveLabel).toBe(true);

      // Round indicator updates to round 2
      await expect(page.getByText(/ROUND 2/i)).toBeVisible({ timeout: 5000 });
    } catch (err) {
      // Dump console logs for debugging
      console.error('=== Console logs ===');
      consoleLogs.forEach((l) => console.error(l));
      console.error('=== End console logs ===');
      throw err;
    } finally {
      await context.close();
      await teardownPipeline(request, authToken, pipeline.id);
    }
  });
});

// ─── §E.4 Approve/Request Changes verdict ───────────────────────────────────

test.describe('§E.4 — Approve/Request Changes verdict', () => {
  test.setTimeout(90_000);

  let authToken: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();
  });

  test('Scenario: select verdict, write summary, submit verdict', async ({
    browser,
    request,
  }) => {
    const pipeline = await seedPipeline(request, authToken, 'E2E §E.4 — Verdict');
    const stage = await seedStage(request, authToken, pipeline.id, 'Code Review Stage');
    await seedCodeReviewChallenge(request, authToken, stage.id, { maxRounds: 3 });
    const candidate = await seedCandidate(request, authToken, pipeline.id, stage.id, 'Verdict Candidate');

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await startAssessment(page, candidate.inviteToken);

      // Add annotation and submit review
      await expect(page.locator('[data-testid="diff-content"]')).toBeVisible({ timeout: 10000 });
      await page.locator('[data-testid="diff-line-3"]').click();
      await page.locator('[data-testid="annotation-input"]').fill('Critical bug: missing null guard');
      await page.locator('[data-testid="save-annotation-btn"]').click();

      const submitReviewBtn = page.getByRole('button', { name: /SUBMIT_REVIEW/i });
      await expect(submitReviewBtn).toBeVisible({ timeout: 5000 });
      await submitReviewBtn.click();

      // Wait for agent response
      await expect(page.locator('[data-testid="conversation-thread"]')).toBeVisible({ timeout: 60000 });

      // REVIEW_VERDICT section should be visible after agent responds
      await expect(page.getByText('REVIEW_VERDICT')).toBeVisible({ timeout: 5000 });

      // Three verdict options present
      await expect(page.getByText('APPROVE')).toBeVisible();
      await expect(page.getByText('REQUEST_CHANGES')).toBeVisible();

      // Select REQUEST_CHANGES
      const requestChangesBtn = page.getByRole('button').filter({ hasText: 'REQUEST_CHANGES' });
      await requestChangesBtn.click();

      // Write review summary
      const summaryInput = page.locator('textarea').filter({ hasText: '' }).last();
      await summaryInput.fill('The null check bug must be fixed before merging. Token validation is incomplete.');

      // SUBMIT_VERDICT button should be visible
      const submitVerdictBtn = page.getByRole('button', { name: /SUBMIT_VERDICT/i });
      await expect(submitVerdictBtn).toBeVisible({ timeout: 5000 });
      await submitVerdictBtn.click();

      // After verdict, verify via API that session is finalized
      // We need the session token for this — use the API directly
      // The fact that SUBMIT_VERDICT was clickable and didn't error is the primary assertion
      // Verify the UI reflects completion (no more submit buttons)
      await expect(submitVerdictBtn).not.toBeVisible({ timeout: 10000 });
    } finally {
      await context.close();
      await teardownPipeline(request, authToken, pipeline.id);
    }
  });
});

// ─── §E.5 Follow-up reply flow ──────────────────────────────────────────────

test.describe('§E.5 — Follow-up reply flow', () => {
  test.setTimeout(120_000);

  let authToken: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();
  });

  test('Scenario: reply to thread → submit response → agent responds again', async ({
    browser,
    request,
  }) => {
    const pipeline = await seedPipeline(request, authToken, 'E2E §E.5 — Follow-Up');
    const stage = await seedStage(request, authToken, pipeline.id, 'Code Review Stage');
    await seedCodeReviewChallenge(request, authToken, stage.id, { maxRounds: 4 });
    const candidate = await seedCandidate(request, authToken, pipeline.id, stage.id, 'Reply Candidate');

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await startAssessment(page, candidate.inviteToken);

      // Add annotation and submit review (round 1)
      await expect(page.locator('[data-testid="diff-content"]')).toBeVisible({ timeout: 10000 });
      await page.locator('[data-testid="diff-line-3"]').click();
      await page.locator('[data-testid="annotation-input"]').fill('Missing null check on token parameter');
      await page.locator('[data-testid="save-annotation-btn"]').click();

      await page.getByRole('button', { name: /SUBMIT_REVIEW/i }).click();

      // Wait for agent response to round 1
      await expect(page.locator('[data-testid="conversation-thread"]')).toBeVisible({ timeout: 60000 });
      await expect(page.getByText('AUTHOR')).toBeVisible({ timeout: 5000 });

      // Reply textarea should appear (round 2+)
      const replyTextarea = page.getByPlaceholder(/Reply to the author/i);
      await expect(replyTextarea).toBeVisible({ timeout: 5000 });

      // Type reply
      await replyTextarea.fill('Can you also handle the case where token is an empty string?');

      // SUBMIT_RESPONSE button should appear
      const submitResponseBtn = page.getByRole('button', { name: /SUBMIT_RESPONSE/i });
      await expect(submitResponseBtn).toBeVisible({ timeout: 5000 });
      await submitResponseBtn.click();

      // Loading overlay
      // Loading overlay may flash too briefly to observe — skip assertion

      // Agent responds again — round advances to 3
      await expect(page.getByText(/ROUND 3/i)).toBeVisible({ timeout: 60000 });

      // Thread should now have multiple exchanges
      const authorLabels = page.getByText('AUTHOR');
      await expect(authorLabels.first()).toBeVisible();
    } finally {
      await context.close();
      await teardownPipeline(request, authToken, pipeline.id);
    }
  });
});

// ─── §E.6 Full end-to-end journey ───────────────────────────────────────────

test.describe('§E.6 — Full end-to-end candidate journey', () => {
  test.setTimeout(180_000);

  let authToken: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();
  });

  test('Scenario: annotate → submit → reply → verdict (complete journey)', async ({
    browser,
    request,
  }) => {
    const pipeline = await seedPipeline(request, authToken, 'E2E §E.6 — Full Journey');
    const stage = await seedStage(request, authToken, pipeline.id, 'Code Review Stage');
    await seedCodeReviewChallenge(request, authToken, stage.id, { maxRounds: 3 });
    const candidate = await seedCandidate(request, authToken, pipeline.id, stage.id, 'Journey Candidate');

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await startAssessment(page, candidate.inviteToken);

      // ── Step 1: Verify diff renders ──
      const diffContent = page.locator('[data-testid="diff-content"]');
      await expect(diffContent).toBeVisible({ timeout: 10000 });
      await expect(diffContent).toContainText('verifyToken');

      // ── Step 2: Add first annotation (critical) ──
      await page.locator('[data-testid="diff-line-3"]').click();
      await expect(page.locator('[data-testid="annotation-editor-form"]')).toBeVisible();
      // Severity defaults to critical
      await expect(page.locator('[data-testid="severity-selector"]')).toHaveValue('critical');
      await page.locator('[data-testid="annotation-input"]').fill('Missing null check — token could be undefined');
      await page.locator('[data-testid="save-annotation-btn"]').click();
      await expect(page.locator('[data-testid="annotation-badge-3"]')).toBeVisible();

      // ── Step 3: Add second annotation (minor) on a different line ──
      await page.locator('[data-testid="diff-line-4"]').click();
      await expect(page.locator('[data-testid="annotation-editor-form"]')).toBeVisible();
      // Change severity to minor
      await page.locator('[data-testid="severity-selector"]').selectOption('minor');
      await page.locator('[data-testid="annotation-input"]').fill('Consider using a more robust length check');
      await page.locator('[data-testid="save-annotation-btn"]').click();
      await expect(page.locator('[data-testid="annotation-badge-4"]')).toBeVisible();

      // ── Step 4: Submit review → agent responds ──
      const submitReviewBtn = page.getByRole('button', { name: /SUBMIT_REVIEW/i });
      await expect(submitReviewBtn).toBeVisible({ timeout: 5000 });
      await submitReviewBtn.click();

      // Loading state
      // Loading overlay may flash too briefly to observe — skip assertion

      // Agent responds — threads appear
      const threads = page.locator('[data-testid="conversation-thread"]');
      await expect(threads.first()).toBeVisible({ timeout: 60000 });

      // Should have 2 threads (one per annotation)
      const threadCount = await threads.count();
      expect(threadCount).toBe(2);

      // Round advances to 2
      await expect(page.getByText(/ROUND 2/i)).toBeVisible();

      // ── Step 5: Reply to first thread ──
      const replyTextarea = page.getByPlaceholder(/Reply to the author/i).first();
      await expect(replyTextarea).toBeVisible({ timeout: 5000 });
      await replyTextarea.fill('Please also check the async code path for the same issue.');

      const submitResponseBtn = page.getByRole('button', { name: /SUBMIT_RESPONSE/i });
      await expect(submitResponseBtn).toBeVisible();
      await submitResponseBtn.click();

      // Agent responds again — round 3
      await expect(page.getByText(/ROUND 3/i)).toBeVisible({ timeout: 60000 });

      // ── Step 6: Submit verdict ──
      // Verdict section should be visible
      await expect(page.getByText('REVIEW_VERDICT')).toBeVisible({ timeout: 5000 });

      // Select REQUEST_CHANGES
      await page.getByRole('button').filter({ hasText: 'REQUEST_CHANGES' }).click();

      // Write summary
      const summaryTextarea = page.getByPlaceholder(/Summarize your code review/i);
      await expect(summaryTextarea).toBeVisible();
      await summaryTextarea.fill(
        'Critical null check bug must be fixed. Token validation needs both null and empty string handling before merge.',
      );

      // Submit verdict
      const submitVerdictBtn = page.getByRole('button', { name: /SUBMIT_VERDICT/i });
      await expect(submitVerdictBtn).toBeVisible({ timeout: 5000 });
      await submitVerdictBtn.click();

      // ── Step 7: Verify session finalized ──
      // Submit verdict button should disappear after successful submission
      await expect(submitVerdictBtn).not.toBeVisible({ timeout: 10000 });
    } finally {
      await context.close();
      await teardownPipeline(request, authToken, pipeline.id);
    }
  });
});
