/**
 * e2e/standalone-code-review-mvp.spec.ts
 *
 * BDD: Standalone CODE_REVIEW MVP — Full E2E skeleton
 *
 * Route under test:
 *   1. Recruiter: /schedule → INVITE CANDIDATE → select CODE_REVIEW
 *   2. Candidate: /assess/:token
 *   3. Recruiter: /candidates/:id → CONTEXT
 *
 * Product slice: recruiter invites a person to a standalone code-review
 * challenge outside any pipeline or role → candidate opens /assess/:token →
 * candidate provides resume/profile evidence → PIPE builds living context →
 * PIPE matches to a real reviewable PR or waits safely → candidate submits
 * review → recruiter sees context graph and source-backed result.
 *
 * These tests are written BEFORE the implementation is complete (BDD approach)
 * and will fail until the full standalone path is wired end-to-end.
 *
 * Invariants asserted:
 *   - No generic repo / smallest-PR / fabricated evidence fallback
 *   - Missing evidence → explicit WAITING_FOR_MATCH, not a fake challenge
 *   - Every match links to source evidence
 *   - Ground truth never leaks to candidate
 *
 * Auth: Recruiter authenticated via Clerk storageState.
 *       Candidate uses /rpc/* with custom session JWT (no sign-in).
 *
 * API base: http://localhost:8787
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { API_BASE, APP_BASE } from './env';

// ─── Types ──────────────────────────────────────────────────────────────────

interface StandaloneCandidate {
  id: string;
  name: string;
  email: string;
  inviteToken: string;
  status: string;
  interviewType: string | null;
  pipelineId: null;
}

interface ResolveTokenResponse {
  id: string;
  pipelineId: string | null;
  status: string;
  name: string | null;
  sessionToken: string;
}

interface StageConfigResponse {
  isComplete: boolean;
  stageId?: string;
  stageTitle?: string;
  mode?: string;
  timeLimit?: number | null;
  challenges?: Array<{ type: string; order: number; title?: string }>;
  upcoming?: Array<{ type: string; title?: string }>;
  currentIndex?: number;
}

interface ChallengeResponse {
  id?: string;
  type?: string;
  title?: string;
  instructions?: string;
  config?: unknown;
  cachedDiffJson?: unknown;
  githubPrTitle?: string;
  githubPrNumber?: number;
  githubRepoUrl?: string;
  githubPrDescription?: string | null;
  error?: { code: string; message: string };
}

interface SeedStandaloneReviewFixtureResponse {
  ok: boolean;
  fixtureId: string;
  repoUrl: string;
  prNumber: number;
  packetId: string;
  candidateSourceSpanIds: string[];
  repoSourceSpanIds: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) {
    throw new Error('[standalone-code-review-mvp.spec] No __session cookie. Run auth setup first.');
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

/**
 * Create a standalone candidate via POST /api/v1/candidates with
 * interviewType: CODE_REVIEW — no pipeline, no stage.
 */
async function createStandaloneCodeReviewCandidate(
  request: APIRequestContext,
  authToken: string,
  options: { name?: string; email?: string } = {},
): Promise<StandaloneCandidate> {
  const {
    name = 'E2E Standalone Candidate',
    email = `standalone+e2e-${Date.now()}@pipe-test.dev`,
  } = options;

  const res = await request.post(`${API_BASE}/api/v1/candidates`, {
    headers: recruiterHeaders(authToken),
    data: {
      name,
      email,
      interviewType: 'CODE_REVIEW',
      skipEmail: true,
    },
  });
  expect(res.status()).toBe(201);

  const body = (await res.json()) as { candidate: StandaloneCandidate };
  return body.candidate;
}

/**
 * Resolve a candidate invite token → session JWT via /rpc/resolve-token.
 */
async function resolveToken(
  request: APIRequestContext,
  inviteToken: string,
): Promise<ResolveTokenResponse> {
  const res = await request.post(`${API_BASE}/rpc/resolve-token`, {
    data: { inviteToken },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as ResolveTokenResponse;
}

async function seedStandaloneReviewMatchFixture(
  request: APIRequestContext,
  authToken: string,
  candidate: StandaloneCandidate,
): Promise<SeedStandaloneReviewFixtureResponse> {
  const suffix = candidate.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toLowerCase();
  const conceptKey = `term:e2e-source-backed-${suffix}`;
  const conceptLabel = `e2e source backed ${suffix}`;
  const repoUrl = `https://github.com/pipe/e2e-source-backed-${suffix}`;
  const prNumber = 42;
  const res = await request.post(`${API_BASE}/api/v1/internal/e2e/standalone-review-match-fixture`, {
    headers: recruiterHeaders(authToken),
    data: {
      fixtureId: `standalone-review-match-${suffix}`,
      candidateId: candidate.id,
      concepts: [
        {
          canonicalKey: conceptKey,
          namespace: 'term',
          label: conceptLabel,
        },
      ],
      candidateEvidence: [
        {
          exactText: `Implemented ${conceptLabel} idempotency with source-backed evidence.`,
          predicate: 'implemented',
          narrative: `Candidate implemented ${conceptLabel} idempotency.`,
          conceptKeys: [conceptKey],
          evidenceLevel: 'implemented',
          strength: 1,
          confidence: 1,
        },
        {
          exactText: `Validated ${conceptLabel} retry behavior with tests.`,
          predicate: 'validated',
          narrative: `Candidate validated ${conceptLabel} retry behavior.`,
          conceptKeys: [conceptKey],
          evidenceLevel: 'validated',
          strength: 1,
          confidence: 1,
        },
      ],
      repo: {
        githubUrl: repoUrl,
        fullName: `pipe/e2e-source-backed-${suffix}`,
        primaryLanguage: 'TypeScript',
        description: 'Source-backed deterministic E2E fixture repository.',
      },
      pullRequest: {
        number: prNumber,
        title: 'Review source-backed retry idempotency',
        author: 'pipe-e2e',
        baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        headSha: 'dddddddddddddddddddddddddddddddddddddddd',
        mergedAt: '2026-06-14T08:00:00.000Z',
      },
      repoSpans: [
        {
          key: 'implementation',
          path: 'src/retry-idempotency.ts',
          exactText: `Implement ${conceptLabel} idempotency for reviewable retry events.`,
          artifactType: 'source',
          lineStart: 10,
          lineEnd: 10,
        },
        {
          key: 'validation',
          path: 'src/retry-idempotency.test.ts',
          exactText: `Validate ${conceptLabel} retry behavior with deterministic tests.`,
          artifactType: 'test',
          lineStart: 22,
          lineEnd: 22,
        },
      ],
      demands: [
        {
          id: 'implementation-demand',
          family: 'source-backed:e2e-implementation',
          narrative: `Review implemented ${conceptLabel} idempotency.`,
          conceptKeys: [conceptKey],
          sourceSpanKeys: ['implementation'],
          weight: 0.5,
        },
        {
          id: 'validation-demand',
          family: 'source-backed:e2e-validation',
          narrative: `Review validated ${conceptLabel} retry behavior.`,
          conceptKeys: [conceptKey],
          sourceSpanKeys: ['validation'],
          weight: 0.5,
        },
      ],
    },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as SeedStandaloneReviewFixtureResponse;
  expect(body.ok).toBe(true);
  expect(body.repoUrl).toBe(repoUrl);
  expect(body.prNumber).toBe(prNumber);
  expect(body.candidateSourceSpanIds.length).toBeGreaterThan(0);
  expect(body.repoSourceSpanIds.length).toBeGreaterThan(0);
  return body;
}

// ─── §MVP.1 Recruiter creates standalone CODE_REVIEW invite ─────────────────

test.describe('§MVP.1 — Recruiter creates standalone CODE_REVIEW invite', () => {
  let authToken: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();
  });

  test('POST /api/v1/candidates with interviewType CODE_REVIEW creates pipeline-free candidate', async ({ request }) => {
    const candidate = await createStandaloneCodeReviewCandidate(request, authToken);

    expect(candidate.id).toBeTruthy();
    expect(candidate.inviteToken).toBeTruthy();
    expect(candidate.status).toBe('INVITED');
    expect(candidate.interviewType).toBe('CODE_REVIEW');
    expect(candidate.pipelineId).toBeNull();
  });

  test('scheduled_interviews row exists with correct shape', async ({ request }) => {
    const candidate = await createStandaloneCodeReviewCandidate(request, authToken);

    // Verify via the GET candidate profile endpoint that the interview exists
    const profileRes = await request.get(`${API_BASE}/api/v1/candidates/${candidate.id}`, {
      headers: recruiterHeaders(authToken),
    });
    expect(profileRes.status()).toBe(200);

    const profile = await profileRes.json() as Record<string, unknown>;
    const interviews = profile.scheduledInterviews as Array<{
      interviewType: string;
      pipelineId: string | null;
      stageId: string | null;
      status: string;
    }> | undefined;

    // The candidate profile should expose scheduled interviews
    expect(interviews).toBeDefined();
    expect(interviews).toHaveLength(1);
    expect(interviews![0].interviewType).toBe('CODE_REVIEW');
    expect(interviews![0].pipelineId).toBeNull();
    expect(interviews![0].stageId).toBeNull();
    expect(interviews![0].status).toBe('INVITED');
  });

  test('UI flow: /schedule → INVITE CANDIDATE → CODE_REVIEW', async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();

    await page.goto(`${APP_BASE}/schedule`);
    await page.waitForLoadState('networkidle');

    // Click INVITE CANDIDATE button
    const inviteBtn = page.locator('button:has-text("INVITE CANDIDATE")');
    await expect(inviteBtn).toBeVisible({ timeout: 10000 });
    await inviteBtn.click();

    // Modal should open
    const modal = page.locator('text=INVITE CANDIDATE').first();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Fill NAME
    const nameInput = page.locator('input[placeholder="Jane Smith"]');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('E2E Code Review Test');

    // Fill EMAIL
    const emailInput = page.locator('input[placeholder="jane@example.com"]');
    await expect(emailInput).toBeVisible();
    await emailInput.fill(`standalone-ui+${Date.now()}@pipe-test.dev`);

    // Select CODE_REVIEW interview type
    const codeReviewBtn = page.locator('button:has-text("CODE_REVIEW")');
    await expect(codeReviewBtn).toBeVisible();
    await codeReviewBtn.click();

    // Send invite
    const sendBtn = page.locator('button:has-text("SEND INVITE")');
    await expect(sendBtn).toBeVisible();
    await sendBtn.click();

    // Expect success confirmation
    await expect(page.locator('text=INVITE SENT')).toBeVisible({ timeout: 10000 });

    await context.close();
  });
});

// ─── §MVP.2 Candidate token resolution (standalone) ─────────────────────────

test.describe('§MVP.2 — Candidate token resolution for standalone invite', () => {
  let authToken: string;
  let candidate: StandaloneCandidate;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    candidate = await createStandaloneCodeReviewCandidate(request, authToken);
  });

  test('resolve-token returns null pipelineId for standalone candidate', async ({ request }) => {
    const session = await resolveToken(request, candidate.inviteToken);

    expect(session.sessionToken).toBeTruthy();
    expect(session.id).toBe(candidate.id);
    expect(session.pipelineId).toBeNull();
    expect(session.status).toBe('IN_PROGRESS');
  });
});

// ─── §MVP.3 Candidate stage config — intake before code review ──────────────

test.describe('§MVP.3 — Standalone candidate sees intake before code review', () => {
  let authToken: string;
  let candidate: StandaloneCandidate;
  let sessionToken: string;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    candidate = await createStandaloneCodeReviewCandidate(request, authToken);
    const session = await resolveToken(request, candidate.inviteToken);
    sessionToken = session.sessionToken;
  });

  test('get-stage-config serves INTAKE mode with CODE_REVIEW upcoming', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/get-stage-config`, {
      headers: candidateHeaders(sessionToken),
      data: {},
    });
    expect(res.status()).toBe(200);

    const config = (await res.json()) as StageConfigResponse;
    expect(config.isComplete).toBe(false);
    expect(config.mode).toBe('INTAKE');

    // Should list INTAKE as current challenge
    expect(config.challenges).toBeDefined();
    expect(config.challenges!.length).toBeGreaterThanOrEqual(1);
    expect(config.challenges![0].type).toBe('INTAKE');

    // Should advertise CODE_REVIEW as upcoming
    expect(config.upcoming).toBeDefined();
    expect(config.upcoming!.length).toBeGreaterThanOrEqual(1);
    expect(config.upcoming!.some((u) => u.type === 'CODE_REVIEW')).toBe(true);
  });

  test('get-challenge order=0 returns INTAKE content', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/get-challenge`, {
      headers: candidateHeaders(sessionToken),
      data: { order: 0 },
    });
    expect(res.status()).toBe(200);

    const challenge = (await res.json()) as ChallengeResponse;
    expect(challenge.type).toBe('INTAKE');
    expect(challenge.title).toBeTruthy();
  });
});

// ─── §MVP.4 No generic/fallback challenge — fail-closed matching ────────────

test.describe('§MVP.4 — Deterministic matching: no generic/smallest-PR fallback', () => {
  let authToken: string;
  let candidate: StandaloneCandidate;
  let sessionToken: string;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    candidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'Unmatchable Candidate',
      email: `unmatchable+e2e-${Date.now()}@pipe-test.dev`,
    });
    const session = await resolveToken(request, candidate.inviteToken);
    sessionToken = session.sessionToken;

    // Submit minimal resume so candidate passes intake but has thin evidence.
    // This must not be enough to select a reviewable PR.
    const intakeRes = await request.post(`${API_BASE}/rpc/submit-challenge-response`, {
      headers: candidateHeaders(sessionToken),
      data: {
        order: 0,
        submission: {
          resumeText: 'Minimal resume with no relevant technical background.',
        },
      },
    });
    expect(intakeRes.status()).toBe(200);
    const intakeBody = await intakeRes.json() as { success?: boolean; message?: string };
    expect(intakeBody.success).toBe(true);
    expect(intakeBody.message).toBe('INTAKE submission received');
  });

  test('candidate with thin evidence sees WAITING_FOR_MATCH, not a generic PR', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/get-challenge`, {
      headers: candidateHeaders(sessionToken),
      data: { order: 0 },
    });
    expect(res.status()).toBe(200);

    const challenge = (await res.json()) as ChallengeResponse;

    expect(challenge.type).toBe('WAITING_FOR_MATCH');
    expect(challenge.githubPrNumber).toBeUndefined();
    expect(challenge.githubRepoUrl).toBeUndefined();
    expect(challenge.cachedDiffJson).toBeUndefined();
    expect(challenge.title).toBe('Building your personalized challenge');
  });

  test('WAITING_FOR_MATCH challenge never exposes ground truth', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/get-challenge`, {
      headers: candidateHeaders(sessionToken),
      data: { order: 0 },
    });
    const body = await res.text();

    // Ground truth, scoring rubrics, planted bugs must never appear in response
    expect(body).not.toContain('groundTruth');
    expect(body).not.toContain('plantedBugs');
    expect(body).not.toContain('scoringRubric');
    expect(body).not.toContain('correctAnswer');
  });
});

// ─── §MVP.5 Candidate assessment UI — /assess/:token ────────────────────────

test.describe('§MVP.5 — Candidate opens /assess/:token for standalone code review', () => {
  let authToken: string;
  let candidate: StandaloneCandidate;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    candidate = await createStandaloneCodeReviewCandidate(request, authToken);
  });

  test('candidate lands on intake with resume upload when no evidence exists', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${APP_BASE}/assess/${candidate.inviteToken}`);
    await page.waitForLoadState('networkidle');

    // Should see intake/upload UI — not a direct code review
    // Verify presence of resume upload or intake protocol indicator
    const hasIntake = await page
      .locator('text=/upload|resume|cv|profile/i')
      .first()
      .isVisible({ timeout: 15000 })
      .catch(() => false);

    expect(hasIntake).toBe(true);

    // Must NOT immediately show a code review diff
    const hasDiff = await page
      .locator('[data-testid="diff-panel"], .diff-panel, text=/@@.*@@/')
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    expect(hasDiff).toBe(false);

    await context.close();
  });
});

// ─── §MVP.6 Matched path — CODE_REVIEW with real PR ─────────────────────────

test.describe('§MVP.6 — Matched candidate receives real CODE_REVIEW challenge', () => {
  let authToken: string;
  let candidate: StandaloneCandidate;
  let sessionToken: string;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    candidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'Matched Code Review Candidate',
      email: `matched+e2e-${Date.now()}@pipe-test.dev`,
    });
    const session = await resolveToken(request, candidate.inviteToken);
    sessionToken = session.sessionToken;
  });

  test('after evidence + matching, get-challenge returns CODE_REVIEW with PR metadata', async ({ request }) => {
    // This test requires the full pipeline: intake → living context → match.
    // The candidate submits text-based evidence via submit-challenge-response,
    // which triggers ingestion and deterministic matching.

    // Step 1: Submit resume/profile evidence via the challenge-response intake path
    const intakeRes = await request.post(`${API_BASE}/rpc/submit-challenge-response`, {
      headers: candidateHeaders(sessionToken),
      data: {
        order: 0,
        submission: {
          resumeText: 'Senior software engineer with 8 years of TypeScript, React, and Node.js experience. Built large-scale frontend applications. Expert in component architecture, state management, and performance optimization. Contributed to open-source UI libraries.',
          githubHandle: 'e2e-test-user',
        },
      },
    });
    // Intake must be accepted
    expect([200, 201]).toContain(intakeRes.status());

    const intakeBody = await intakeRes.json() as { success?: boolean };
    expect(intakeBody.success).toBe(true);

    const fixture = await seedStandaloneReviewMatchFixture(request, authToken, candidate);

    // Step 2: Get challenge — source-backed candidate evidence and repo packet must match deterministically.
    const challengeRes = await request.post(`${API_BASE}/rpc/get-challenge`, {
      headers: candidateHeaders(sessionToken),
      data: { order: 0 },
    });
    expect(challengeRes.status()).toBe(200);

    const challenge = (await challengeRes.json()) as ChallengeResponse;

    expect(challenge.type).toBe('CODE_REVIEW');
    expect(challenge.githubPrNumber).toBe(fixture.prNumber);
    expect(challenge.githubRepoUrl).toBe(fixture.repoUrl);
    expect(challenge.githubRepoUrl).toMatch(/^https:\/\/github\.com\//);
    expect(challenge.cachedDiffJson).toBeTruthy();
    expect(challenge.githubPrTitle).toBe('Review source-backed retry idempotency');
    expect(challenge.title).toBeTruthy();

    const diff = challenge.cachedDiffJson as { files?: Array<{ filename?: string; hunks?: unknown[] }> };
    expect(Array.isArray(diff.files)).toBe(true);
    expect(diff.files!.map((file) => file.filename)).toEqual([
      'src/retry-idempotency.test.ts',
      'src/retry-idempotency.ts',
    ]);
    expect(diff.files!.every((file) => Array.isArray(file.hunks) && file.hunks.length > 0)).toBe(true);

    const raw = JSON.stringify(challenge);
    expect(raw).not.toContain('groundTruth');
    expect(raw).not.toContain('plantedBugs');
    expect(raw).not.toContain('scoringRubric');

    const profileRes = await request.get(`${API_BASE}/api/v1/candidates/${candidate.id}`, {
      headers: recruiterHeaders(authToken),
    });
    expect(profileRes.status()).toBe(200);
    const profile = await profileRes.json() as {
      standaloneReviewMatch?: {
        matchStatus?: string;
        repoUrl?: string | null;
        prNumber?: number | null;
        prUrl?: string | null;
        packetId?: string;
        evidence?: Array<{
          candidateSourceRefs?: unknown[];
          challengeSourceRefs?: unknown[];
          sharedConcepts?: string[];
        }>;
        gaps?: string[];
        diagnostics?: {
          recalledPacketIds?: string[];
          evaluatedChallenges?: Array<{ challengeId?: string; eligible?: boolean }>;
        };
      };
    };
    const match = profile.standaloneReviewMatch;
    expect(match).toBeDefined();
    expect(match!.matchStatus).toBe('MATCHED');
    expect(match!.repoUrl).toBe(fixture.repoUrl);
    expect(match!.prNumber).toBe(fixture.prNumber);
    expect(match!.prUrl).toBe(`${fixture.repoUrl}/pull/${fixture.prNumber}`);
    expect(match!.evidence?.length).toBeGreaterThan(0);
    expect(match!.evidence!.every((entry) =>
      Array.isArray(entry.candidateSourceRefs)
      && entry.candidateSourceRefs.length > 0
      && Array.isArray(entry.challengeSourceRefs)
      && entry.challengeSourceRefs.length > 0
      && Array.isArray(entry.sharedConcepts)
      && entry.sharedConcepts.length > 0
    )).toBe(true);
    expect(match!.gaps ?? []).toEqual([]);
    expect(match!.diagnostics?.recalledPacketIds).toContain(fixture.packetId);
    expect(match!.diagnostics?.evaluatedChallenges?.some((entry) =>
      entry.challengeId === fixture.packetId && entry.eligible === true
    )).toBe(true);
  });
});

// ─── §MVP.7 Code review submission (standalone) ─────────────────────────────

test.describe('§MVP.7 — Candidate submits standalone code review', () => {
  let authToken: string;
  let candidate: StandaloneCandidate;
  let sessionToken: string;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    candidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'Submitting Reviewer',
      email: `reviewer+e2e-${Date.now()}@pipe-test.dev`,
    });
    const session = await resolveToken(request, candidate.inviteToken);
    sessionToken = session.sessionToken;
  });

  test('submit-challenge-response accepts standalone CODE_REVIEW submission and completes the interview', async ({ request }) => {
    // Submit a code review response for the standalone interview.
    const submitRes = await request.post(`${API_BASE}/rpc/submit-challenge-response`, {
      headers: candidateHeaders(sessionToken),
      data: {
        order: 0,
        submission: {
          type: 'CODE_REVIEW',
          verdict: 'REQUEST_CHANGES',
          summary: 'The PR introduces a search feature but has a critical debounce issue. Every keystroke triggers a network request which will overwhelm the API.',
          comments: [
            {
              file: 'src/pages/Search.tsx',
              line: 43,
              category: 'functionality',
              severity: 'blocking',
              what: 'No debounce on search input — fires request per keystroke',
              why: 'Creates N requests for N characters typed',
              suggestion: 'Add 300ms debounce with AbortController',
            },
          ],
        },
      },
    });

    // Expect success — the submission should persist
    expect([200, 201]).toContain(submitRes.status());

    const body = await submitRes.json() as Record<string, unknown>;
    // Submission should not leak scoring info
    expect(JSON.stringify(body)).not.toContain('groundTruth');
    expect(body.success).toBe(true);

    const profileRes = await request.get(`${API_BASE}/api/v1/candidates/${candidate.id}`, {
      headers: recruiterHeaders(authToken),
    });
    expect(profileRes.status()).toBe(200);

    const profile = await profileRes.json() as Record<string, unknown>;
    const interviews = profile.scheduledInterviews as Array<{
      interviewType: string;
      status: string;
    }> | undefined;

    expect(interviews).toBeDefined();
    const codeReview = interviews!.find((i) => i.interviewType === 'CODE_REVIEW');
    expect(codeReview).toBeDefined();
    expect(codeReview!.status).toBe('COMPLETED');
  });
});

// ─── §MVP.8 Recruiter views candidate context graph ─────────────────────────

test.describe('§MVP.8 — Recruiter inspects standalone candidate context + result', () => {
  let authToken: string;
  let candidate: StandaloneCandidate;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    candidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'Context Graph Candidate',
      email: `context+e2e-${Date.now()}@pipe-test.dev`,
    });
  });

  test('GET /api/v1/candidates/:id/living-context returns source-backed graph', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v1/candidates/${candidate.id}/living-context`, {
      headers: recruiterHeaders(authToken),
    });
    expect(res.status()).toBe(200);

    const graph = await res.json() as Record<string, unknown>;

    // Living context endpoint should return structured data
    // (will fail until living context is populated after intake)
    expect(graph).toBeDefined();
  });

  test('recruiter profile page shows CONTEXT tab for standalone candidate', async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();

    await page.goto(`${APP_BASE}/candidates/${candidate.id}`);
    await page.waitForLoadState('networkidle');

    // CONTEXT tab should exist
    const contextTab = page.locator('button:has-text("CONTEXT")');
    await expect(contextTab).toBeVisible({ timeout: 10000 });

    // Click CONTEXT tab
    await contextTab.click();

    // Living context graph component should render
    await expect(page.locator('[data-testid="living-context-graph"]')).toBeVisible({ timeout: 10000 });

    await context.close();
  });

  test('recruiter sees source-backed pending match state in CONTEXT tab before intake', async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();

    await page.goto(`${APP_BASE}/candidates/${candidate.id}`);
    await page.getByRole('button', { name: 'CONTEXT' }).click();

    const matchPanel = page.getByLabel('Standalone code review match');
    await expect(matchPanel).toContainText('Standalone CODE_REVIEW match');
    await expect(matchPanel).toContainText('PENDING INTAKE');
    await expect(matchPanel).toContainText(
      'Waiting for candidate resume/profile evidence before matching to a PR.',
    );
    await expect(matchPanel).toContainText('Candidate has not submitted source evidence yet.');

    await context.close();
  });

  test('recruiter API exposes pending standalone match without fabricated PR data', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v1/candidates/${candidate.id}`, {
      headers: recruiterHeaders(authToken),
    });
    expect(res.status()).toBe(200);

    const profile = await res.json() as Record<string, unknown>;

    const standaloneReviewMatch = profile.standaloneReviewMatch as {
      interviewId?: string;
      interviewStatus?: string;
      matchStatus?: string;
      repoUrl?: string | null;
      prNumber?: number | null;
      prTitle?: string | null;
      score?: number | null;
      summary?: string;
      evidence?: Array<{
        candidateSourceRefs?: unknown[];
        challengeSourceRefs?: unknown[];
      }>;
      gaps?: string[];
      submitted?: boolean;
      submission?: unknown;
    } | null;

    expect(standaloneReviewMatch).toBeDefined();
    expect(standaloneReviewMatch).not.toBeNull();
    expect(standaloneReviewMatch!.matchStatus).toBe('PENDING_INTAKE');
    expect(standaloneReviewMatch!.interviewStatus).toBe('INVITED');
    expect(standaloneReviewMatch!.repoUrl).toBeNull();
    expect(standaloneReviewMatch!.prNumber).toBeNull();
    expect(standaloneReviewMatch!.score).toBeNull();
    expect(standaloneReviewMatch!.submitted).toBe(false);
    expect(standaloneReviewMatch!.submission).toBeNull();
  });

  test('pending match explanation reports missing candidate evidence without naked scores', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v1/candidates/${candidate.id}`, {
      headers: recruiterHeaders(authToken),
    });
    expect(res.status()).toBe(200);

    const profile = await res.json() as Record<string, unknown>;

    const standaloneReviewMatch = profile.standaloneReviewMatch as {
      evidence?: Array<{
        candidateSourceRefs?: unknown[];
        challengeSourceRefs?: unknown[];
        sharedConcepts?: string[];
      }>;
      gaps?: string[];
      summary?: string;
      score?: number | null;
      diagnostics?: {
        recalledPacketIds?: unknown[];
        excludedPackets?: unknown[];
        evaluatedChallenges?: unknown[];
      };
    } | null;

    expect(standaloneReviewMatch).toBeDefined();
    expect(standaloneReviewMatch).not.toBeNull();
    expect(standaloneReviewMatch!.summary).toBe(
      'Waiting for candidate resume/profile evidence before matching to a PR.',
    );
    expect(standaloneReviewMatch!.evidence).toEqual([]);
    expect(standaloneReviewMatch!.gaps).toContain('Candidate has not submitted source evidence yet.');
    expect(standaloneReviewMatch!.score).toBeNull();
    expect(standaloneReviewMatch!.diagnostics?.recalledPacketIds).toEqual([]);
    expect(standaloneReviewMatch!.diagnostics?.excludedPackets).toEqual([]);
    expect(standaloneReviewMatch!.diagnostics?.evaluatedChallenges).toEqual([]);
  });
});
