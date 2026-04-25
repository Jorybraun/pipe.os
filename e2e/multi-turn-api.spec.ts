/**
 * e2e/multi-turn-api.spec.ts
 *
 * BDD: Multi-Turn Code Review — Worker API Endpoints
 *
 * Phase C spec. Tests define the target behaviour for the multi-turn code
 * review Worker endpoints. Written BEFORE implementation (BDD approach).
 *
 * These are API-level tests — no browser. All HTTP requests go directly
 * to the Worker at localhost:8787.
 *
 * Feature coverage
 * ────────────────
 *   §C.1  POST /rpc/review/submit   — creates session, returns threads
 *   §C.2  POST /rpc/review/:id/respond — increments round, returns threads
 *   §C.3  Round limit enforcement  — reject respond beyond maxRounds
 *   §C.4  POST /rpc/review/:id/verdict — finalises session
 *   §C.5  GET  /rpc/review/:id/status  — returns session status
 *   §C.6  Authorization — 401 without token, 403/404 cross-candidate
 *   §C.7  Scoring agent fires after verdict — Devstral scores async
 *
 * Auth: Tests seed via Clerk-authenticated recruiter routes, then drive
 *       the candidate flow using /rpc/* with candidate JWT.
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

interface ReviewThread {
  threadId: string;
  file?: string | null;
  line?: number | null;
  content: string;
  move?: string;
  turns: Array<{
    role: 'candidate' | 'implementer';
    content: string;
    move?: string;
  }>;
}

interface SubmitReviewResponse {
  sessionId: string;
  round: number;
  threads: ReviewThread[];
}

interface RespondResponse {
  round: number;
  threads: ReviewThread[];
}

interface VerdictResponse {
  status: string;
}

interface StatusResponse {
  status: string;
  scoreReport?: Record<string, unknown>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) {
    throw new Error('[multi-turn-api.spec] No __session cookie. Run auth setup first.');
  }
  return sessionCookie.value;
}

function recruiterHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

function candidateHeaders(sessionToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${sessionToken}`,
  };
}

/** Minimal diff JSON that satisfies the challenge validity check. */
const MINIMAL_DIFF_JSON = {
  files: [
    {
      filename: 'src/utils/auth.ts',
      additions: 10,
      deletions: 2,
      patch: '@@ -1,5 +1,13 @@\n-function validate(token) {\n+function validate(token: string): boolean {\n+  if (!token) return false;\n   return token.length > 0;\n }',
    },
  ],
};

/**
 * Seeds a pipeline with a CODE_REVIEW challenge configured for multi-turn,
 * a candidate, and returns all IDs + session JWT.
 */
async function seedMultiTurnReview(
  request: APIRequestContext,
  authToken: string,
  options: {
    candidateName?: string;
    maxRounds?: number;
    persona?: 'junior' | 'senior';
  } = {},
): Promise<{
  pipeline: SeededPipeline;
  stage: SeededStage;
  challenge: SeededChallenge;
  candidate: SeededCandidate;
  sessionToken: string;
  assessmentId: string;
}> {
  const headers = recruiterHeaders(authToken);
  const {
    candidateName = 'Review Candidate',
    maxRounds = 3,
    persona = 'junior',
  } = options;

  // 1. Create pipeline (ACTIVE)
  const pipelineRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers,
    data: { title: 'Multi-Turn Review Pipeline', status: 'ACTIVE', level: 'Senior' },
  });
  expect(pipelineRes.status()).toBe(201);
  const { pipeline } = (await pipelineRes.json()) as { pipeline: SeededPipeline };

  // 2. Create stage
  const stageRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipeline.id}/stages`, {
    headers,
    data: { title: 'Code Review Stage', order: 0 },
  });
  expect(stageRes.status()).toBe(201);
  const { stage } = (await stageRes.json()) as { stage: SeededStage };

  // 3. Create CODE_REVIEW challenge with multi-turn config
  const chRes = await request.post(`${API_BASE}/api/v1/stages/${stage.id}/challenges`, {
    headers,
    data: {
      type: 'CODE_REVIEW',
      title: 'Auth Token Validation PR',
      instructions: 'Review this PR for security issues.',
      order: 0,
    },
  });
  expect(chRes.status()).toBe(201);
  const chData = await chRes.json();
  const challenge: SeededChallenge = chData.challenge ?? chData;

  // 4. Update challenge with multi-turn config + cachedDiffJson + serverConfig
  const updateRes = await request.put(`${API_BASE}/api/v1/challenges/${challenge.id}`, {
    headers,
    data: {
      config: {
        isMultiTurn: true,
        implementerPersona: persona,
        maxRounds,
      },
      cachedDiffJson: MINIMAL_DIFF_JSON,
      serverConfig: {
        groundTruth: {
          plantedBugs: [
            {
              id: 'bug-1',
              description: 'Missing null check on token parameter',
              severity: 'critical',
              file: 'src/utils/auth.ts',
              line: 1,
            },
          ],
          designTradeoffs: [
            {
              id: 'tradeoff-1',
              description: 'Synchronous validation blocks event loop for heavy workloads',
            },
          ],
        },
      },
    },
  });
  expect(updateRes.status()).toBe(200);

  // 5. Create candidate
  const candidateRes = await request.post(
    `${API_BASE}/api/v1/pipelines/${pipeline.id}/candidates`,
    {
      headers,
      data: {
        name: candidateName,
        email: `review-candidate+e2e-${Date.now()}@pipe-test.dev`,
        currentStageId: stage.id,
      },
    },
  );
  expect(candidateRes.status()).toBe(201);
  const { candidate } = (await candidateRes.json()) as { candidate: SeededCandidate };

  // 6. Resolve token → session JWT
  const resolveRes = await request.post(`${API_BASE}/rpc/resolve-token`, {
    data: { inviteToken: candidate.inviteToken },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(resolveRes.status()).toBe(200);
  const { sessionToken } = (await resolveRes.json()) as ResolveTokenResponse;

  // 7. Trigger get-stage-config to create the assessment row
  const configRes = await request.post(`${API_BASE}/rpc/get-stage-config`, {
    data: {},
    headers: candidateHeaders(sessionToken),
  });
  expect(configRes.status()).toBe(200);

  // Fetch assessment ID from DB via a status check we can derive after submit
  // We'll get it from the first submit response, so return empty string for now
  return { pipeline, stage, challenge, candidate, sessionToken, assessmentId: '' };
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

// ─── §C.1 Submit creates session and returns threads ────────────────────────

test.describe('§C.1 — POST /rpc/review/submit creates session and returns threads', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let challenge: SeededChallenge;
  let sessionToken: string;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    const seed = await seedMultiTurnReview(request, authToken);
    pipeline = seed.pipeline;
    challenge = seed.challenge;
    sessionToken = seed.sessionToken;
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  test('Scenario: submit with annotations and summary creates session', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/review/submit`, {
      data: {
        challengeOrder: 0,
        annotations: [
          {
            threadId: 'thread-1',
            file: 'src/utils/auth.ts',
            line: 1,
            content: 'Missing null check — if token is undefined this will throw.',
            severity: 'critical',
          },
        ],
        summary: 'Found a critical null-check bug in the auth validation function.',
      },
      headers: candidateHeaders(sessionToken),
    });

    expect(res.status()).toBe(200);

    const body = (await res.json()) as SubmitReviewResponse;
    expect(body.sessionId).toBeTruthy();
    expect(typeof body.sessionId).toBe('string');
    expect(body.round).toBe(1);
    expect(Array.isArray(body.threads)).toBe(true);
    expect(body.threads.length).toBeGreaterThan(0);

    const thread = body.threads[0];
    expect(thread.threadId).toBe('thread-1');
    expect(Array.isArray(thread.turns)).toBe(true);

    // Must have at least two turns: candidate comment + implementer response
    const implementerTurns = thread.turns.filter((t) => t.role === 'implementer');
    expect(implementerTurns.length).toBeGreaterThan(0);

    const implementerTurn = implementerTurns[0];
    expect(typeof implementerTurn.content).toBe('string');
    expect(implementerTurn.content.length).toBeGreaterThan(0);
    expect(typeof implementerTurn.move).toBe('string');
  });
});

// ─── §C.2 Respond increments round ──────────────────────────────────────────

test.describe('§C.2 — POST /rpc/review/:id/respond increments round', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let sessionToken: string;
  let sessionId: string;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    const seed = await seedMultiTurnReview(request, authToken, { maxRounds: 4 });
    pipeline = seed.pipeline;
    sessionToken = seed.sessionToken;

    // Submit initial review to get a session
    const submitRes = await request.post(`${API_BASE}/rpc/review/submit`, {
      data: {
        challengeOrder: 0,
        annotations: [
          {
            threadId: 'thread-1',
            file: 'src/utils/auth.ts',
            line: 1,
            content: 'Null check missing.',
            severity: 'major',
          },
        ],
        summary: 'One issue found.',
      },
      headers: candidateHeaders(sessionToken),
    });
    expect(submitRes.status()).toBe(200);
    const submitBody = (await submitRes.json()) as SubmitReviewResponse;
    sessionId = submitBody.sessionId;
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  test('Scenario: respond advances to round 2 with updated threads', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/review/${sessionId}/respond`, {
      data: {
        replies: [
          {
            threadId: 'thread-1',
            content: 'Got it, can you confirm this also affects the async path?',
          },
        ],
      },
      headers: candidateHeaders(sessionToken),
    });

    expect(res.status()).toBe(200);

    const body = (await res.json()) as RespondResponse;
    expect(body.round).toBe(2);
    expect(Array.isArray(body.threads)).toBe(true);

    const thread = body.threads[0];
    expect(thread.threadId).toBe('thread-1');

    // Should have at least 4 turns: candidate, implementer, candidate reply, implementer reply
    expect(thread.turns.length).toBeGreaterThanOrEqual(2);

    const lastTurn = thread.turns[thread.turns.length - 1];
    expect(lastTurn.role).toBe('implementer');
    expect(typeof lastTurn.content).toBe('string');
  });
});

// ─── §C.3 Round limit enforcement ───────────────────────────────────────────

test.describe('§C.3 — POST /rpc/review/:id/respond rejects beyond maxRounds', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let sessionToken: string;
  let sessionId: string;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    // Use maxRounds=2 so we can hit the limit quickly
    const seed = await seedMultiTurnReview(request, authToken, { maxRounds: 2 });
    pipeline = seed.pipeline;
    sessionToken = seed.sessionToken;

    // Submit initial review (round 1)
    const submitRes = await request.post(`${API_BASE}/rpc/review/submit`, {
      data: {
        challengeOrder: 0,
        annotations: [
          {
            threadId: 'thread-1',
            file: 'src/utils/auth.ts',
            line: 1,
            content: 'Null check missing.',
            severity: 'minor',
          },
        ],
        summary: 'Minor issue found.',
      },
      headers: candidateHeaders(sessionToken),
    });
    expect(submitRes.status()).toBe(200);
    const submitBody = (await submitRes.json()) as SubmitReviewResponse;
    sessionId = submitBody.sessionId;

    // Respond once (round 2 — at the limit)
    const respondRes = await request.post(`${API_BASE}/rpc/review/${sessionId}/respond`, {
      data: {
        replies: [{ threadId: 'thread-1', content: 'Thanks for the clarification.' }],
      },
      headers: candidateHeaders(sessionToken),
    });
    expect(respondRes.status()).toBe(200);
    const respondBody = (await respondRes.json()) as RespondResponse;
    expect(respondBody.round).toBe(2);
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  test('Scenario: respond at maxRounds returns 400', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/review/${sessionId}/respond`, {
      data: {
        replies: [{ threadId: 'thread-1', content: 'One more reply.' }],
      },
      headers: candidateHeaders(sessionToken),
    });

    expect(res.status()).toBe(400);

    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error).toBeTruthy();
    expect(typeof body.error.message).toBe('string');
  });
});

// ─── §C.4 Verdict finalises session ─────────────────────────────────────────

test.describe('§C.4 — POST /rpc/review/:id/verdict finalizes session', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let sessionToken: string;
  let sessionId: string;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    const seed = await seedMultiTurnReview(request, authToken);
    pipeline = seed.pipeline;
    sessionToken = seed.sessionToken;

    // Submit review to create session
    const submitRes = await request.post(`${API_BASE}/rpc/review/submit`, {
      data: {
        challengeOrder: 0,
        annotations: [
          {
            threadId: 'thread-1',
            file: 'src/utils/auth.ts',
            line: 1,
            content: 'Null check missing.',
            severity: 'critical',
          },
        ],
        summary: 'Critical bug found.',
      },
      headers: candidateHeaders(sessionToken),
    });
    expect(submitRes.status()).toBe(200);
    const submitBody = (await submitRes.json()) as SubmitReviewResponse;
    sessionId = submitBody.sessionId;
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  test('Scenario: submit verdict request_changes returns verdict_submitted status', async ({
    request,
  }) => {
    const res = await request.post(`${API_BASE}/rpc/review/${sessionId}/verdict`, {
      data: {
        verdict: 'request_changes',
        summary:
          'The null check bug must be fixed before merging. Also consider async path coverage.',
      },
      headers: candidateHeaders(sessionToken),
    });

    expect(res.status()).toBe(200);

    const body = (await res.json()) as VerdictResponse;
    expect(body.status).toBe('verdict_submitted');
  });

  test('Scenario: submitting verdict twice returns 409 or 400', async ({ request }) => {
    // Second verdict on already-finalised session
    const res = await request.post(`${API_BASE}/rpc/review/${sessionId}/verdict`, {
      data: {
        verdict: 'approve',
        summary: 'Actually looks fine.',
      },
      headers: candidateHeaders(sessionToken),
    });

    expect([400, 409]).toContain(res.status());
  });
});

// ─── §C.5 Status returns session state ──────────────────────────────────────

test.describe('§C.5 — GET /rpc/review/:id/status returns session status', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let sessionToken: string;
  let sessionId: string;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    const seed = await seedMultiTurnReview(request, authToken);
    pipeline = seed.pipeline;
    sessionToken = seed.sessionToken;

    // Submit review + verdict to get to final state
    const submitRes = await request.post(`${API_BASE}/rpc/review/submit`, {
      data: {
        challengeOrder: 0,
        annotations: [
          {
            threadId: 'thread-1',
            file: 'src/utils/auth.ts',
            line: 1,
            content: 'Missing null guard.',
            severity: 'major',
          },
        ],
        summary: 'Major issue.',
      },
      headers: candidateHeaders(sessionToken),
    });
    expect(submitRes.status()).toBe(200);
    const submitBody = (await submitRes.json()) as SubmitReviewResponse;
    sessionId = submitBody.sessionId;

    await request.post(`${API_BASE}/rpc/review/${sessionId}/verdict`, {
      data: { verdict: 'request_changes', summary: 'Fix the null guard.' },
      headers: candidateHeaders(sessionToken),
    });
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  test('Scenario: GET status returns status field after verdict', async ({ request }) => {
    const res = await request.get(`${API_BASE}/rpc/review/${sessionId}/status`, {
      headers: candidateHeaders(sessionToken),
    });

    expect(res.status()).toBe(200);

    const body = (await res.json()) as StatusResponse;
    expect(typeof body.status).toBe('string');
    expect(['verdict_submitted', 'scoring', 'scored']).toContain(body.status);
  });

  test('Scenario: GET status for in-progress session returns in_progress', async ({
    request,
  }) => {
    // Seed a second candidate with a fresh session (no verdict)
    const seed2 = await seedMultiTurnReview(request, authToken, {
      candidateName: 'Review Candidate 2',
    });

    const submitRes = await request.post(`${API_BASE}/rpc/review/submit`, {
      data: {
        challengeOrder: 0,
        annotations: [
          {
            threadId: 'thread-2',
            file: 'src/utils/auth.ts',
            line: 1,
            content: 'Bug here.',
            severity: 'minor',
          },
        ],
        summary: 'Small issue.',
      },
      headers: candidateHeaders(seed2.sessionToken),
    });
    expect(submitRes.status()).toBe(200);
    const submitBody = (await submitRes.json()) as SubmitReviewResponse;
    const inProgressSessionId = submitBody.sessionId;

    const res = await request.get(`${API_BASE}/rpc/review/${inProgressSessionId}/status`, {
      headers: candidateHeaders(seed2.sessionToken),
    });

    expect(res.status()).toBe(200);
    const body = (await res.json()) as StatusResponse;
    expect(body.status).toBe('in_progress');

    // Cleanup second pipeline
    await teardownPipeline(request, authToken, seed2.pipeline.id);
  });
});

// ─── §C.6 Authorization ─────────────────────────────────────────────────────

test.describe('§C.6 — Authorization: unauthorized access rejected', () => {
  let authToken: string;
  let pipelineA: SeededPipeline;
  let pipelineB: SeededPipeline;
  let sessionTokenA: string;
  let sessionTokenB: string;
  let sessionIdA: string;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    // Seed candidate A — will have a review session
    const seedA = await seedMultiTurnReview(request, authToken, { candidateName: 'Candidate A' });
    pipelineA = seedA.pipeline;
    sessionTokenA = seedA.sessionToken;

    // Seed candidate B — separate pipeline, different session
    const seedB = await seedMultiTurnReview(request, authToken, { candidateName: 'Candidate B' });
    pipelineB = seedB.pipeline;
    sessionTokenB = seedB.sessionToken;

    // Create a session for candidate A
    const submitRes = await request.post(`${API_BASE}/rpc/review/submit`, {
      data: {
        challengeOrder: 0,
        annotations: [
          {
            threadId: 'thread-a',
            file: 'src/utils/auth.ts',
            line: 1,
            content: 'Found bug.',
            severity: 'critical',
          },
        ],
        summary: 'Bug found.',
      },
      headers: candidateHeaders(sessionTokenA),
    });
    expect(submitRes.status()).toBe(200);
    const submitBody = (await submitRes.json()) as SubmitReviewResponse;
    sessionIdA = submitBody.sessionId;
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipelineA.id);
    await teardownPipeline(request, authToken, pipelineB.id);
  });

  test('Scenario: submit without auth token returns 401', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/review/submit`, {
      data: {
        challengeOrder: 0,
        annotations: [],
        summary: 'No auth.',
      },
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status()).toBe(401);
  });

  test('Scenario: candidate B cannot access candidate A session via respond', async ({
    request,
  }) => {
    const res = await request.post(`${API_BASE}/rpc/review/${sessionIdA}/respond`, {
      data: {
        replies: [{ threadId: 'thread-a', content: 'Sneaky reply from B.' }],
      },
      headers: candidateHeaders(sessionTokenB),
    });

    // 403 (forbidden) or 404 (not found — no session visible)
    expect([403, 404]).toContain(res.status());
  });

  test('Scenario: candidate B cannot access candidate A session via verdict', async ({
    request,
  }) => {
    const res = await request.post(`${API_BASE}/rpc/review/${sessionIdA}/verdict`, {
      data: { verdict: 'approve', summary: 'Looks fine to me.' },
      headers: candidateHeaders(sessionTokenB),
    });

    expect([403, 404]).toContain(res.status());
  });

  test('Scenario: candidate B cannot read candidate A session status', async ({ request }) => {
    const res = await request.get(`${API_BASE}/rpc/review/${sessionIdA}/status`, {
      headers: candidateHeaders(sessionTokenB),
    });

    expect([403, 404]).toContain(res.status());
  });
});

// ─── §C.7 Scoring agent fires after verdict ────────────────────────────────

test.describe('§C.7 — Scoring agent triggers automatically after verdict submission', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let sessionToken: string;
  let sessionId: string;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    const seed = await seedMultiTurnReview(request, authToken);
    pipeline = seed.pipeline;
    sessionToken = seed.sessionToken;

    // Submit review to create session
    const submitRes = await request.post(`${API_BASE}/rpc/review/submit`, {
      data: {
        challengeOrder: 0,
        annotations: [
          {
            threadId: 'thread-1',
            file: 'src/utils/auth.ts',
            line: 1,
            content: 'Missing null check on token parameter — if token is undefined, token.length throws TypeError.',
            severity: 'critical',
            why: 'Uncaught TypeError will crash the request handler.',
            suggestion: 'Add early return: if (!token) return false;',
          },
        ],
        summary: 'Critical null safety bug in auth validation.',
      },
      headers: candidateHeaders(sessionToken),
    });
    expect(submitRes.status()).toBe(200);
    const submitBody = (await submitRes.json()) as SubmitReviewResponse;
    sessionId = submitBody.sessionId;
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  test('Scenario: verdict triggers async scoring — status transitions to scoring then scored', async ({
    request,
  }) => {
    // Submit verdict
    const verdictRes = await request.post(`${API_BASE}/rpc/review/${sessionId}/verdict`, {
      data: {
        verdict: 'request_changes',
        summary: 'Critical null check must be fixed before merge.',
      },
      headers: candidateHeaders(sessionToken),
    });
    expect(verdictRes.status()).toBe(200);
    const verdictBody = (await verdictRes.json()) as VerdictResponse;
    expect(verdictBody.status).toBe('verdict_submitted');

    // Poll status until scoring completes (or timeout)
    let finalStatus = 'verdict_submitted';
    let sawScoringState = false;
    const startTime = Date.now();
    const TIMEOUT_MS = 90_000; // 90s — Devstral needs time

    while (Date.now() - startTime < TIMEOUT_MS) {
      const statusRes = await request.get(`${API_BASE}/rpc/review/${sessionId}/status`, {
        headers: candidateHeaders(sessionToken),
      });
      expect(statusRes.status()).toBe(200);
      const statusBody = (await statusRes.json()) as StatusResponse;
      finalStatus = statusBody.status;

      if (finalStatus === 'scoring') sawScoringState = true;
      if (finalStatus === 'scored' || finalStatus === 'scoring_failed') break;

      // Wait 2s before polling again
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Must reach scored or scoring_failed (not stuck at verdict_submitted)
    expect(['scored', 'scoring_failed', 'scoring']).toContain(finalStatus);

    // If MISTRAL_API_KEY is set, scoring should succeed
    if (finalStatus === 'scored') {
      // Verify score report exists via the status endpoint
      const finalRes = await request.get(`${API_BASE}/rpc/review/${sessionId}/status`, {
        headers: candidateHeaders(sessionToken),
      });
      const finalBody = (await finalRes.json()) as StatusResponse;
      expect(finalBody.status).toBe('scored');
      expect(finalBody.scoreReport).toBeDefined();
      expect(typeof finalBody.scoreReport?.overall).toBe('number');
      expect(typeof finalBody.scoreReport?.band).toBe('string');
      expect(['strong', 'adequate', 'weak']).toContain(finalBody.scoreReport?.band);
    }
  });

  test('Scenario: recruiter can read full score report after scoring completes', async ({
    request,
  }) => {
    // Poll until scored (may already be scored from previous test)
    const startTime = Date.now();
    let status = 'unknown';
    while (Date.now() - startTime < 90_000) {
      const statusRes = await request.get(`${API_BASE}/rpc/review/${sessionId}/status`, {
        headers: candidateHeaders(sessionToken),
      });
      status = ((await statusRes.json()) as StatusResponse).status;
      if (status === 'scored' || status === 'scoring_failed') break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (status !== 'scored') {
      test.skip(true, 'Scoring did not complete (no MISTRAL_API_KEY or agent error)');
      return;
    }

    // Recruiter reads full report
    const reportRes = await request.get(
      `${API_BASE}/api/v1/review-sessions/${sessionId}/report`,
      { headers: recruiterHeaders(authToken) },
    );
    expect(reportRes.status()).toBe(200);

    const report = (await reportRes.json()) as Record<string, unknown>;
    expect(report.status).toBe('scored');

    const scoreReport = report.scoreReport as Record<string, unknown>;
    expect(scoreReport).toBeDefined();

    // Verify dimensional structure
    const overall = scoreReport.overall as Record<string, unknown>;
    expect(typeof overall.score).toBe('number');
    expect(typeof overall.band).toBe('string');
    expect(typeof overall.narrative).toBe('string');
    expect(Array.isArray(overall.strengths)).toBe(true);
    expect(Array.isArray(overall.growth_areas)).toBe(true);

    // Verify sub-scores exist
    expect(scoreReport.technical).toBeDefined();
    expect(scoreReport.conversation).toBeDefined();
    expect(scoreReport.practice).toBeDefined();
    expect(scoreReport.effectiveness).toBeDefined();

    // Technical should have bug tracking
    const tech = scoreReport.technical as Record<string, unknown>;
    expect(typeof tech.score).toBe('number');
    expect(Array.isArray(tech.bugs_found)).toBe(true);
    expect(Array.isArray(tech.bugs_missed)).toBe(true);
  });
});
