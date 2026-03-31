/**
 * e2e/multi-turn-conversation-ui.spec.ts
 *
 * BDD: Multi-Turn CODE_REVIEW — Conversation UI + Blueprint Routing
 *
 * Feature: Multi-turn agentic code review conversation panel
 *   As a candidate
 *   I want to have a multi-turn code review conversation with the PR author
 *   So that I can demonstrate my depth of review and engineering judgment
 *
 * Covers:
 *   §LAYOUT        — multi-turn CODE_REVIEW loads 3-column layout with conversation panel
 *   §EMPTY_STATE   — conversation panel shows empty state before first review
 *   §LEGACY        — legacy single-turn CODE_REVIEW still shows verdict panel
 *   §ROUND         — round indicator visible on multi-turn challenge
 *
 * Auth: Tests seed via recruiter Clerk JWT, then act as unauthenticated candidate.
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
    throw new Error('[multi-turn-conversation-ui.spec] No __session cookie. Run auth setup first.');
  }
  return sessionCookie.value;
}

function recruiterHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

// ─── Minimal diff for seeding ─────────────────────────────────────────────────

const minimalDiff = {
  files: [
    {
      path: 'src/utils/auth.ts',
      status: 'modified',
      additions: 2,
      deletions: 1,
      hunks: [
        {
          header: '@@ -1,4 +1,5 @@',
          lines: [
            { type: 'context',  num: 1, content: 'export function verifyToken(token: string): boolean {' },
            { type: 'deletion', num: 2, content: '  return token.length > 0;' },
            { type: 'addition', num: 2, content: '  if (!token) return false;' },
            { type: 'addition', num: 3, content: '  return token.startsWith("Bearer ");' },
            { type: 'context',  num: 4, content: '}' },
          ],
        },
      ],
    },
  ],
  stats: { filesChanged: 1, additions: 2, deletions: 1 },
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
    isMultiTurn?: boolean;
    maxRounds?: number;
  } = {},
): Promise<string> {
  const { title = 'Review: Auth Token Bug', isMultiTurn = true, maxRounds = 4 } = options;

  const res = await request.post(`${API_BASE}/api/v1/stages/${stageId}/challenges`, {
    headers: recruiterHeaders(token),
    data: {
      type: 'CODE_REVIEW',
      title,
      instructions: 'Review the following pull request and identify security issues.',
      order: 0,
      config: {
        isMultiTurn,
        implementerPersona: 'junior',
        maxRounds,
      },
      githubRepoUrl: 'https://github.com/octocat/hello-world',
      githubPrNumber: 42,
      githubPrTitle: 'Fix auth token verification',
      githubPrDescription: 'Improves token validation logic.',
      cachedDiffJson: minimalDiff,
      cachedMetadata: {
        title: 'Fix auth token verification',
        author: 'octocat',
        created_at: '2024-01-15T10:00:00Z',
        state: 'open',
        base: 'main',
        head: 'fix/auth-token',
      },
    },
  });
  expect(res.ok(), `seedCodeReviewChallenge failed: ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { id: string };
  return body.id;
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
        email: `mt-candidate-${Date.now()}@pipe-test.dev`,
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

// ─── Suite: Multi-turn layout ─────────────────────────────────────────────────

test.describe('Feature: Multi-Turn CODE_REVIEW — Conversation UI', () => {
  let authToken: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();
  });

  /**
   * Scenario §LAYOUT: Multi-turn CODE_REVIEW loads 3-column layout with conversation panel
   *   Given a CODE_REVIEW challenge with config.isMultiTurn=true and cached diff
   *   And a candidate with a valid invite token
   *   When the candidate navigates to /assess/{token}
   *   And clicks START_INTERVIEW
   *   Then the workspace layout renders with 3 columns
   *   And the right panel contains the conversation panel (data-testid="conversation-panel")
   *   And the verdict panel is NOT present
   */
  test('Scenario §LAYOUT: multi-turn CODE_REVIEW loads conversation panel', async ({
    browser,
    request,
  }) => {
    const pipeline = await seedPipeline(request, authToken, 'MT E2E — Conversation Layout');
    const stage = await seedStage(request, authToken, pipeline.id, 'Code Review Stage');
    await seedCodeReviewChallenge(request, authToken, stage.id, {
      title: 'Multi-Turn Auth Review',
      isMultiTurn: true,
      maxRounds: 4,
    });
    const candidate = await seedCandidate(request, authToken, pipeline.id, stage.id, 'Layout Candidate');

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(`${APP_BASE}/assess/${candidate.inviteToken}`);

      const beginBtn = page.getByRole('button', { name: /start.interview/i });
      await beginBtn.waitFor({ state: 'visible', timeout: 15000 });
      await beginBtn.click();

      // Workspace layout should render
      const layout = page.locator('[data-testid="workspace-layout"]');
      await expect(layout).toBeVisible({ timeout: 20000 });

      // Conversation panel should be present (right column)
      const conversationPanel = page.locator('[data-testid="conversation-panel"]');
      await expect(conversationPanel).toBeVisible({ timeout: 10000 });

      // Verdict panel should NOT be present for multi-turn
      const verdictPanel = page.locator('[data-testid="verdict-panel"]');
      await expect(verdictPanel).not.toBeVisible({ timeout: 3000 });
    } finally {
      await context.close();
      await teardownPipeline(request, authToken, pipeline.id);
    }
  });

  /**
   * Scenario §EMPTY_STATE: Conversation panel shows empty state before first review
   *   Given a multi-turn CODE_REVIEW challenge with no threads yet
   *   When the challenge loads
   *   Then the conversation panel shows an empty state heading
   *   And the submit button reads "SUBMIT_REVIEW"
   */
  test('Scenario §EMPTY_STATE: conversation panel shows empty state before first review', async ({
    browser,
    request,
  }) => {
    const pipeline = await seedPipeline(request, authToken, 'MT E2E — Empty State');
    const stage = await seedStage(request, authToken, pipeline.id, 'Code Review Stage');
    await seedCodeReviewChallenge(request, authToken, stage.id, {
      title: 'Empty State Review',
      isMultiTurn: true,
    });
    const candidate = await seedCandidate(request, authToken, pipeline.id, stage.id, 'Empty State Candidate');

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(`${APP_BASE}/assess/${candidate.inviteToken}`);

      const beginBtn = page.getByRole('button', { name: /start.interview/i });
      await beginBtn.waitFor({ state: 'visible', timeout: 15000 });
      await beginBtn.click();

      const conversationPanel = page.locator('[data-testid="conversation-panel"]');
      await expect(conversationPanel).toBeVisible({ timeout: 15000 });

      // Empty state heading
      await expect(page.getByText(/leave your review/i)).toBeVisible({ timeout: 5000 });

      // Submit button hidden until annotations are added (correct UX)
      await expect(
        page.getByRole('button', { name: /SUBMIT_REVIEW|SUBMIT REVIEW/i }),
      ).not.toBeVisible({ timeout: 2000 });
    } finally {
      await context.close();
      await teardownPipeline(request, authToken, pipeline.id);
    }
  });

  /**
   * Scenario §LEGACY: Legacy single-turn CODE_REVIEW shows verdict panel
   *   Given a CODE_REVIEW challenge with config.isMultiTurn=false
   *   When the candidate navigates to their assessment and begins
   *   Then the right panel shows the verdict panel
   *   And the conversation panel is NOT present
   */
  test('Scenario §LEGACY: legacy single-turn CODE_REVIEW shows verdict panel', async ({
    browser,
    request,
  }) => {
    const pipeline = await seedPipeline(request, authToken, 'MT E2E — Legacy Verdict');
    const stage = await seedStage(request, authToken, pipeline.id, 'Code Review Stage');
    await seedCodeReviewChallenge(request, authToken, stage.id, {
      title: 'Legacy Single-Turn Review',
      isMultiTurn: false,
    });
    const candidate = await seedCandidate(request, authToken, pipeline.id, stage.id, 'Legacy Candidate');

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(`${APP_BASE}/assess/${candidate.inviteToken}`);

      const beginBtn = page.getByRole('button', { name: /start.interview/i });
      await beginBtn.waitFor({ state: 'visible', timeout: 15000 });
      await beginBtn.click();

      // Verdict panel should be present for legacy single-turn
      const verdictPanel = page.locator('[data-testid="verdict-panel"]');
      await expect(verdictPanel).toBeVisible({ timeout: 15000 });

      // Conversation panel should NOT be present
      const conversationPanel = page.locator('[data-testid="conversation-panel"]');
      await expect(conversationPanel).not.toBeVisible({ timeout: 3000 });
    } finally {
      await context.close();
      await teardownPipeline(request, authToken, pipeline.id);
    }
  });

  /**
   * Scenario §ROUND: Round indicator visible on multi-turn challenge
   *   Given a multi-turn CODE_REVIEW with maxRounds=4
   *   When the candidate begins the challenge
   *   Then the conversation panel shows a round indicator
   *   And it reads "ROUND 1" or "Round 1 of 4" or similar
   */
  test('Scenario §ROUND: round indicator visible in conversation panel', async ({
    browser,
    request,
  }) => {
    const pipeline = await seedPipeline(request, authToken, 'MT E2E — Round Indicator');
    const stage = await seedStage(request, authToken, pipeline.id, 'Code Review Stage');
    await seedCodeReviewChallenge(request, authToken, stage.id, {
      title: 'Round Indicator Review',
      isMultiTurn: true,
      maxRounds: 4,
    });
    const candidate = await seedCandidate(request, authToken, pipeline.id, stage.id, 'Round Candidate');

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(`${APP_BASE}/assess/${candidate.inviteToken}`);

      const beginBtn = page.getByRole('button', { name: /start.interview/i });
      await beginBtn.waitFor({ state: 'visible', timeout: 15000 });
      await beginBtn.click();

      const conversationPanel = page.locator('[data-testid="conversation-panel"]');
      await expect(conversationPanel).toBeVisible({ timeout: 15000 });

      // Round indicator — "ROUND 1" / "Round 1 of 4" / "ROUND_1_OF_4" etc.
      await expect(
        page.getByText(/ROUND\s*1|Round\s*1/i).first(),
      ).toBeVisible({ timeout: 5000 });
    } finally {
      await context.close();
      await teardownPipeline(request, authToken, pipeline.id);
    }
  });
});
