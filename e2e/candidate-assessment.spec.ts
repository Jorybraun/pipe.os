/**
 * e2e/candidate-assessment.spec.ts
 *
 * BDD: Candidate Assessment Flow — Token Resolution → Challenge Display
 *
 * Phase 3 Cloudflare migration spec. These tests define the TARGET behavior
 * for the candidate-facing assessment flow: a candidate opens an invite link,
 * resolves their token to a session, and sees their first challenge.
 *
 * These tests are written BEFORE the implementation (BDD approach) and will
 * fail until the /rpc/* Worker routes and assessment UI are complete.
 *
 * Feature coverage
 * ────────────────
 *   §3.1  Token resolution — invite token → JWT session
 *   §3.2  Stage config — session → current stage + challenge list
 *   §3.3  Challenge loading — order index → challenge content
 *   §3.4  E2E flow — open link → see welcome → begin → see challenge
 *
 * Auth: Tests seed data via recruiter Clerk JWT (authenticated project),
 *       then use the /rpc/* routes as an unauthenticated candidate.
 *
 * API base: http://localhost:8787
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// ─── Constants ──────────────────────────────────────────────────────────────

const API_BASE = 'http://localhost:8787';
const APP_BASE = 'http://localhost:5173';

// ─── Types ──────────────────────────────────────────────────────────────────

interface SeededPipeline {
  id: string;
  title: string;
  status: string;
}

interface SeededStage {
  id: string;
  title: string;
}

interface SeededChallenge {
  id: string;
  type: string;
  title: string;
}

interface SeededCandidate {
  id: string;
  name: string;
  email: string;
  inviteToken: string;
  status: string;
}

interface ResolveTokenResponse {
  id: string;
  pipelineId: string;
  status: string;
  name: string | null;
  sessionToken: string;
}

interface StageConfigResponse {
  isComplete: boolean;
  stageTitle?: string;
  mode?: string;
  timeLimit?: number | null;
  challenges?: Array<{ type: string; order: number }>;
  currentIndex?: number;
  error?: string;
}

interface ChallengeResponse {
  type?: string;
  title?: string;
  instructions?: string;
  config?: unknown;
  cachedDiffJson?: unknown;
  githubPrTitle?: string;
  githubPrNumber?: number;
  githubRepoUrl?: string;
  error?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) {
    throw new Error('[candidate-assessment.spec] No __session cookie. Run auth setup first.');
  }
  return sessionCookie.value;
}

function recruiterHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Seeds a complete pipeline with stages, challenges, and a candidate.
 * Returns all IDs needed for the candidate assessment flow tests.
 */
async function seedAssessmentPipeline(
  request: APIRequestContext,
  authToken: string,
  options: {
    candidateName?: string;
    candidateEmail?: string;
    challengeTypes?: string[];
  } = {},
): Promise<{
  pipeline: SeededPipeline;
  stage: SeededStage;
  challenges: SeededChallenge[];
  candidate: SeededCandidate;
}> {
  const headers = recruiterHeaders(authToken);
  const {
    candidateName = 'Test Candidate',
    candidateEmail = `candidate+e2e-${Date.now()}@pipe-test.dev`,
    challengeTypes = ['QUIZ_MCQ', 'QUIZ_SHORT_ANSWER'],
  } = options;

  // 1. Create pipeline (ACTIVE so candidates can be invited)
  const pipelineRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers,
    data: { title: 'Assessment E2E Pipeline', status: 'ACTIVE', level: 'Senior' },
  });
  expect(pipelineRes.status()).toBe(201);
  const { pipeline } = (await pipelineRes.json()) as { pipeline: SeededPipeline };

  // 2. Create stage
  const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipeline.id}/stages`, {
    headers,
    data: { title: 'Technical Screen', order: 0 },
  });
  expect(stageRes.status()).toBe(201);
  const { stage } = (await stageRes.json()) as { stage: SeededStage };

  // 3. Create challenges
  const challenges: SeededChallenge[] = [];
  for (let i = 0; i < challengeTypes.length; i++) {
    const chRes = await request.post(`${API_BASE}/api/v1/stages/${stage.id}/challenges`, {
      headers,
      data: {
        type: challengeTypes[i],
        title: `Challenge ${i + 1} (${challengeTypes[i]})`,
        instructions: `Instructions for challenge ${i + 1}`,
        order: i,
      },
    });
    expect(chRes.status()).toBe(201);
    const chData = await chRes.json();
    challenges.push(chData.challenge ?? chData);
  }

  // 4. Create candidate
  const candidateRes = await request.post(
    `${API_BASE}/api/v1/pipelines/${pipeline.id}/candidates`,
    {
      headers,
      data: {
        name: candidateName,
        email: candidateEmail,
        currentStageId: stage.id,
      },
    },
  );
  expect(candidateRes.status()).toBe(201);
  const { candidate } = (await candidateRes.json()) as { candidate: SeededCandidate };

  return { pipeline, stage, challenges, candidate };
}

async function teardownPipeline(
  request: APIRequestContext,
  authToken: string,
  pipelineId: string,
): Promise<void> {
  await request.delete(`${API_BASE}/api/v1/pipelines/${pipelineId}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
}

// ─── §3.1 Token Resolution ──────────────────────────────────────────────────

test.describe('§3.1 — Token resolution (invite token → JWT session)', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let candidate: SeededCandidate;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    const seed = await seedAssessmentPipeline(request, authToken);
    pipeline = seed.pipeline;
    candidate = seed.candidate;
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  test('Scenario: valid invite token resolves to session with JWT', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/resolve-token`, {
      data: { inviteToken: candidate.inviteToken },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(200);

    const body = (await res.json()) as ResolveTokenResponse;
    expect(body.sessionToken).toBeTruthy();
    expect(body.pipelineId).toBe(pipeline.id);
    expect(body.name).toBe('Test Candidate');
    expect(body.status).toBe('IN_PROGRESS');
  });

  test('Scenario: already-claimed token is rejected', async ({ request }) => {
    // First call claims the token
    const first = await request.post(`${API_BASE}/rpc/resolve-token`, {
      data: { inviteToken: candidate.inviteToken },
      headers: { 'Content-Type': 'application/json' },
    });
    // Token was claimed in the previous test (or this one if running alone)
    // Either way, a second resolve should fail
    const second = await request.post(`${API_BASE}/rpc/resolve-token`, {
      data: { inviteToken: candidate.inviteToken },
      headers: { 'Content-Type': 'application/json' },
    });
    // Should be 404 (token now starts with CLAIMED::) or 409 (concurrent claim)
    expect([404, 409]).toContain(second.status());
  });

  test('Scenario: nonexistent token returns 404', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/resolve-token`, {
      data: { inviteToken: 'does-not-exist-token-xyz' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(404);
  });

  test('Scenario: empty token returns 400', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/resolve-token`, {
      data: { inviteToken: '' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(400);
  });

  test('Scenario: missing token field returns 400', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/resolve-token`, {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(400);
  });
});

// ─── §3.2 Stage Config ─────────────────────────────────────────────────────

test.describe('§3.2 — Stage config (session → current stage + challenges)', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let stage: SeededStage;
  let challenges: SeededChallenge[];
  let sessionToken: string;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    const seed = await seedAssessmentPipeline(request, authToken, {
      challengeTypes: ['QUIZ_MCQ', 'QUIZ_SHORT_ANSWER'],
    });
    pipeline = seed.pipeline;
    stage = seed.stage;
    challenges = seed.challenges;

    // Resolve token to get a session JWT
    const res = await request.post(`${API_BASE}/rpc/resolve-token`, {
      data: { inviteToken: seed.candidate.inviteToken },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as ResolveTokenResponse;
    sessionToken = body.sessionToken;
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  test('Scenario: get-stage-config returns current stage with challenge list', async ({
    request,
  }) => {
    const res = await request.post(`${API_BASE}/rpc/get-stage-config`, {
      data: {},
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
    });
    expect(res.status()).toBe(200);

    const body = (await res.json()) as StageConfigResponse;
    expect(body.isComplete).toBe(false);
    expect(body.stageTitle).toBe('Technical Screen');
    expect(body.challenges).toHaveLength(2);
    expect(body.challenges![0].type).toBe('QUIZ_MCQ');
    expect(body.challenges![0].order).toBe(0);
    expect(body.challenges![1].type).toBe('QUIZ_SHORT_ANSWER');
    expect(body.challenges![1].order).toBe(1);
    expect(body.currentIndex).toBe(0);
  });

  test('Scenario: get-stage-config without auth returns 401', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/get-stage-config`, {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(401);
  });

  test('Scenario: get-stage-config with invalid JWT returns 401', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/get-stage-config`, {
      data: {},
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid.jwt.token',
      },
    });
    expect(res.status()).toBe(401);
  });
});

// ─── §3.3 Challenge Loading ────────────────────────────────────────────────

test.describe('§3.3 — Challenge loading (order → challenge content)', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let challenges: SeededChallenge[];
  let sessionToken: string;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    const seed = await seedAssessmentPipeline(request, authToken, {
      challengeTypes: ['QUIZ_MCQ', 'CODE_IMPLEMENTATION'],
    });
    pipeline = seed.pipeline;
    challenges = seed.challenges;

    // Resolve token to get session
    const res = await request.post(`${API_BASE}/rpc/resolve-token`, {
      data: { inviteToken: seed.candidate.inviteToken },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as ResolveTokenResponse;
    sessionToken = body.sessionToken;
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  test('Scenario: get-challenge returns challenge content by order index', async ({
    request,
  }) => {
    const res = await request.post(`${API_BASE}/rpc/get-challenge`, {
      data: { order: 0 },
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
    });
    expect(res.status()).toBe(200);

    const body = (await res.json()) as ChallengeResponse;
    expect(body.type).toBe('QUIZ_MCQ');
    expect(body.title).toBe('Challenge 1 (QUIZ_MCQ)');
    expect(body.instructions).toBeTruthy();
    // Must NOT expose internal IDs
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('stageId');
    expect(body).not.toHaveProperty('stage_id');
  });

  test('Scenario: get-challenge returns second challenge at order 1', async ({
    request,
  }) => {
    const res = await request.post(`${API_BASE}/rpc/get-challenge`, {
      data: { order: 1 },
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
    });
    expect(res.status()).toBe(200);

    const body = (await res.json()) as ChallengeResponse;
    expect(body.type).toBe('CODE_IMPLEMENTATION');
    expect(body.title).toBe('Challenge 2 (CODE_IMPLEMENTATION)');
  });

  test('Scenario: get-challenge with out-of-bounds order returns error', async ({
    request,
  }) => {
    const res = await request.post(`${API_BASE}/rpc/get-challenge`, {
      data: { order: 99 },
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
    });
    // Should return 404 or a response with error field
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as ChallengeResponse;
      expect(body.error).toBeTruthy();
    }
  });

  test('Scenario: get-challenge without auth returns 401', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/get-challenge`, {
      data: { order: 0 },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(401);
  });

  test('Scenario: get-challenge with negative order returns error', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/get-challenge`, {
      data: { order: -1 },
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
    });
    expect([400, 422]).toContain(res.status());
  });

  test('Scenario: challenge response never exposes ground truth', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/get-challenge`, {
      data: { order: 0 },
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
    });
    expect(res.status()).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('serverConfig');
    expect(body).not.toHaveProperty('server_config');
    expect(body).not.toHaveProperty('groundTruth');
    expect(body).not.toHaveProperty('ground_truth');
    expect(body).not.toHaveProperty('groundTruthAnnotations');
    expect(body).not.toHaveProperty('ground_truth_annotations');
  });
});

// ─── §3.4 E2E UI Flow ──────────────────────────────────────────────────────

test.describe('§3.4 — E2E: candidate opens invite link and sees challenge', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let candidate: SeededCandidate;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    const seed = await seedAssessmentPipeline(request, authToken, {
      candidateName: 'Jane Doe',
      challengeTypes: ['QUIZ_MCQ'],
    });
    pipeline = seed.pipeline;
    candidate = seed.candidate;
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  test('Scenario: candidate navigates to /assess/:token and sees welcome screen', async ({
    browser,
  }) => {
    // Use a fresh context (no Clerk session — candidate is unauthenticated)
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${APP_BASE}/assess/${candidate.inviteToken}`);

    // Should see welcome/loading screen — token resolution happens automatically
    // After resolution, candidate should see either:
    // - A welcome screen with "Begin Assessment" button, OR
    // - The first challenge directly
    const welcomeOrChallenge = page
      .getByRole('button', { name: /begin|start/i })
      .or(page.getByText(/welcome|assessment/i))
      .or(page.locator('[data-testid="challenge-view"]'));

    await expect(welcomeOrChallenge.first()).toBeVisible({ timeout: 15000 });

    await context.close();
  });

  test('Scenario: candidate clicks Begin and sees first challenge', async ({ browser }) => {
    // Seed a fresh candidate since the previous test claimed the token
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    const token = await getAuthToken(page);

    const freshSeed = await seedAssessmentPipeline(
      page.context().request,
      token,
      { candidateName: 'Begin Flow Candidate', challengeTypes: ['QUIZ_MCQ'] },
    );

    await context.close();

    // Now act as candidate in a fresh, unauthenticated context
    const candidateCtx = await browser.newContext();
    const candidatePage = await candidateCtx.newPage();

    await candidatePage.goto(`${APP_BASE}/assess/${freshSeed.candidate.inviteToken}`);

    // Wait for welcome screen
    const beginBtn = candidatePage.getByRole('button', { name: /begin|start/i });
    const hasBeginBtn = await beginBtn.isVisible({ timeout: 10000 }).catch(() => false);

    if (hasBeginBtn) {
      await beginBtn.click();
    }

    // Should see challenge content
    const challengeContent = candidatePage
      .getByText(/challenge|instructions|question/i)
      .or(candidatePage.locator('[data-testid="challenge-view"]'))
      .or(candidatePage.locator('[data-testid="assessment-challenge"]'));

    await expect(challengeContent.first()).toBeVisible({ timeout: 15000 });

    await candidateCtx.close();

    // Cleanup the extra pipeline
    const cleanupCtx = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const cleanupPage = await cleanupCtx.newPage();
    await cleanupPage.goto(APP_BASE);
    const cleanupToken = await getAuthToken(cleanupPage);
    await teardownPipeline(cleanupPage.context().request, cleanupToken, freshSeed.pipeline.id);
    await cleanupCtx.close();
  });

  test('Scenario: invalid token shows error message', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${APP_BASE}/assess/totally-invalid-token-xyz`);

    // Should show error — "Invalid or expired link" or similar
    const errorMessage = page
      .getByText(/invalid|expired|not found/i)
      .or(page.locator('[data-testid="token-error"]'));

    await expect(errorMessage.first()).toBeVisible({ timeout: 15000 });

    await context.close();
  });

  test('Scenario: completed candidate is blocked from retaking', async ({ browser, request }) => {
    // Seed a candidate, then mark them as COMPLETED via recruiter API
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    const token = await getAuthToken(page);

    const seed = await seedAssessmentPipeline(page.context().request, token, {
      candidateName: 'Completed Candidate',
      challengeTypes: ['QUIZ_MCQ'],
    });

    // Mark candidate as COMPLETED
    await request.patch(`${API_BASE}/api/v1/candidates/${seed.candidate.id}`, {
      headers: recruiterHeaders(token),
      data: { status: 'COMPLETED' },
    });

    await context.close();

    // Try to access as candidate
    const candidateCtx = await browser.newContext();
    const candidatePage = await candidateCtx.newPage();

    // The token may or may not still work for navigation,
    // but the assessment should be blocked
    await candidatePage.goto(`${APP_BASE}/assess/${seed.candidate.inviteToken}`);

    const blocked = candidatePage
      .getByText(/assessment completed|already completed|already submitted/i)
      .or(candidatePage.getByText(/invalid|expired/i))
      .or(candidatePage.locator('[data-testid="assessment-completed"]'));

    await expect(blocked.first()).toBeVisible({ timeout: 15000 });

    await candidateCtx.close();

    // Cleanup
    const cleanupCtx = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const cleanupPage = await cleanupCtx.newPage();
    await cleanupPage.goto(APP_BASE);
    const cleanupToken = await getAuthToken(cleanupPage);
    await teardownPipeline(cleanupPage.context().request, cleanupToken, seed.pipeline.id);
    await cleanupCtx.close();
  });
});

// ─── §3.5 API Contract Tests ────────────────────────────────────────────────

test.describe('§3.5 — API contract: resolve-token → get-stage-config → get-challenge', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let candidate: SeededCandidate;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    const seed = await seedAssessmentPipeline(request, authToken, {
      challengeTypes: ['CODE_IMPLEMENTATION', 'QUIZ_MCQ'],
    });
    pipeline = seed.pipeline;
    candidate = seed.candidate;
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  test('Scenario: full API flow — resolve → config → challenge', async ({ request }) => {
    // Step 1: Resolve token
    const resolveRes = await request.post(`${API_BASE}/rpc/resolve-token`, {
      data: { inviteToken: candidate.inviteToken },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resolveRes.status()).toBe(200);
    const { sessionToken } = (await resolveRes.json()) as ResolveTokenResponse;
    expect(sessionToken).toBeTruthy();

    const candidateHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    };

    // Step 2: Get stage config
    const configRes = await request.post(`${API_BASE}/rpc/get-stage-config`, {
      data: {},
      headers: candidateHeaders,
    });
    expect(configRes.status()).toBe(200);
    const config = (await configRes.json()) as StageConfigResponse;
    expect(config.isComplete).toBe(false);
    expect(config.challenges).toBeTruthy();
    expect(config.challenges!.length).toBeGreaterThan(0);
    expect(config.currentIndex).toBe(0);

    // Step 3: Get first challenge
    const challengeRes = await request.post(`${API_BASE}/rpc/get-challenge`, {
      data: { order: config.currentIndex! },
      headers: candidateHeaders,
    });
    expect(challengeRes.status()).toBe(200);
    const challenge = (await challengeRes.json()) as ChallengeResponse;
    expect(challenge.type).toBe('CODE_IMPLEMENTATION');
    expect(challenge.title).toBeTruthy();
    expect(challenge.instructions).toBeTruthy();
  });

  test('Scenario: session token includes candidate and pipeline context', async ({
    request,
  }) => {
    // Seed a fresh candidate for this test
    const seed = await seedAssessmentPipeline(request, authToken, {
      candidateName: 'JWT Context Candidate',
      challengeTypes: ['QUIZ_MCQ'],
    });

    const resolveRes = await request.post(`${API_BASE}/rpc/resolve-token`, {
      data: { inviteToken: seed.candidate.inviteToken },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resolveRes.status()).toBe(200);
    const body = (await resolveRes.json()) as ResolveTokenResponse;

    // The JWT should be a valid token (3 dot-separated base64 segments)
    const parts = body.sessionToken.split('.');
    expect(parts).toHaveLength(3);

    // Decode the payload (middle part) — should contain sub (candidateId) and pid (pipelineId)
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    expect(payload.sub).toBe(seed.candidate.id);
    expect(payload.pid).toBe(seed.pipeline.id);

    // Cleanup
    await teardownPipeline(request, authToken, seed.pipeline.id);
  });

  test('Scenario: expired session token returns 401', async ({ request }) => {
    // Craft a clearly invalid/expired token
    const expiredToken =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0Iiwicm9sZSI6ImNhbmRpZGF0ZSIsImV4cCI6MH0.invalid';

    const res = await request.post(`${API_BASE}/rpc/get-stage-config`, {
      data: {},
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${expiredToken}`,
      },
    });
    expect(res.status()).toBe(401);
  });
});
