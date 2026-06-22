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

    // Submit minimal resume so candidate passes intake but has thin evidence
    const intakeRes = await request.post(`${API_BASE}/rpc/submit-challenge-response`, {
      headers: candidateHeaders(sessionToken),
      data: {
        order: 0,
        submission: {
          resumeText: 'Minimal resume with no relevant technical background.',
        },
      },
    });
    // Intake submission may succeed or return a specific status —
    // either way we proceed to check the matching behavior
    expect([200, 201, 400, 404].includes(intakeRes.status())).toBe(true);
  });

  test('candidate with thin evidence sees WAITING_FOR_MATCH, not a generic PR', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/get-challenge`, {
      headers: candidateHeaders(sessionToken),
      data: { order: 0 },
    });
    expect(res.status()).toBe(200);

    const challenge = (await res.json()) as ChallengeResponse;

    // Must be WAITING_FOR_MATCH or INTAKE — never a fake CODE_REVIEW
    if (challenge.type === 'CODE_REVIEW') {
      // If matching somehow succeeded, verify it's a real PR not a fallback
      expect(challenge.githubPrNumber).toBeTruthy();
      expect(challenge.githubRepoUrl).toBeTruthy();
      // Ensure it's not a generic "smallest PR" placeholder
      expect(challenge.title).not.toContain('generic');
      expect(challenge.title).not.toContain('placeholder');
      expect(challenge.title).not.toContain('sample');
    } else {
      // Expected: WAITING_FOR_MATCH or INTAKE (still waiting for evidence)
      expect(['WAITING_FOR_MATCH', 'INTAKE']).toContain(challenge.type);
    }
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

    // Step 2: Get challenge — should now be CODE_REVIEW or WAITING_FOR_MATCH
    const challengeRes = await request.post(`${API_BASE}/rpc/get-challenge`, {
      headers: candidateHeaders(sessionToken),
      data: { order: 0 },
    });
    expect(challengeRes.status()).toBe(200);

    const challenge = (await challengeRes.json()) as ChallengeResponse;

    // If matched, verify real PR metadata with source-backed evidence
    if (challenge.type === 'CODE_REVIEW') {
      expect(challenge.githubPrNumber).toBeGreaterThan(0);
      expect(challenge.githubRepoUrl).toBeTruthy();
      expect(challenge.githubRepoUrl).toMatch(/^https:\/\/github\.com\//);
      expect(challenge.cachedDiffJson).toBeTruthy();
      expect(challenge.title).toBeTruthy();

      // No ground truth leaked
      const raw = JSON.stringify(challenge);
      expect(raw).not.toContain('groundTruth');
      expect(raw).not.toContain('plantedBugs');
      expect(raw).not.toContain('scoringRubric');
    } else {
      // WAITING_FOR_MATCH is acceptable — matcher needs more evidence
      expect(challenge.type).toBe('WAITING_FOR_MATCH');
    }
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

  test('submit-challenge-response accepts standalone CODE_REVIEW submission', async ({ request }) => {
    // Submit a code review response for the standalone interview.
    // This will FAIL until standalone submission is fully wired.
    const submitRes = await request.post(`${API_BASE}/rpc/submit-challenge-response`, {
      headers: candidateHeaders(sessionToken),
      data: {
        challengeId: 'standalone-review',
        type: 'CODE_REVIEW',
        response: {
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

    if (submitRes.status() === 200 || submitRes.status() === 201) {
      const body = await submitRes.json() as Record<string, unknown>;
      // Submission should not leak scoring info
      expect(JSON.stringify(body)).not.toContain('groundTruth');
    }
  });

  test('after submission, standalone scheduled_interview status becomes COMPLETED', async ({ request }) => {
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
    await expect(
      page.locator('[data-testid="living-context-graph"], text=/context|graph|evidence/i').first()
    ).toBeVisible({ timeout: 10000 });

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

  test('recruiter can see matched PR information for completed candidate', async ({ request }) => {
    // After a candidate completes the full flow, the recruiter should
    // be able to see which PR was selected and why via standaloneReviewMatch.
    const res = await request.get(`${API_BASE}/api/v1/candidates/${candidate.id}`, {
      headers: recruiterHeaders(authToken),
    });
    expect(res.status()).toBe(200);

    const profile = await res.json() as Record<string, unknown>;

    // standaloneReviewMatch is the actual API field for standalone code review context
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
    if (standaloneReviewMatch?.matchStatus === 'MATCHED') {
      expect(standaloneReviewMatch.repoUrl).toBeTruthy();
      expect(standaloneReviewMatch.prNumber).toBeGreaterThan(0);
      // Evidence alignments must include source refs from both sides
      expect(standaloneReviewMatch.evidence).toBeDefined();
      expect(standaloneReviewMatch.evidence!.length).toBeGreaterThan(0);
      const firstEvidence = standaloneReviewMatch.evidence![0];
      expect(firstEvidence.candidateSourceRefs).toBeDefined();
      expect(firstEvidence.challengeSourceRefs).toBeDefined();
    }
  });

  test('match explanation includes source evidence, not naked scores', async ({ request }) => {
    // Recruiter must be able to answer: which PR, why, what evidence.
    // Naked aggregate scores without evidence trail are forbidden.
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
    } | null;

    expect(standaloneReviewMatch).toBeDefined();
    expect(standaloneReviewMatch).not.toBeNull();
    if (standaloneReviewMatch) {
      // Source-backed evidence trail is mandatory
      expect(standaloneReviewMatch.evidence).toBeDefined();
      expect(standaloneReviewMatch.gaps).toBeDefined();
      expect(standaloneReviewMatch.summary).toBeTruthy();
      // Each evidence entry carries candidate + challenge source refs
      if (standaloneReviewMatch.evidence && standaloneReviewMatch.evidence.length > 0) {
        for (const entry of standaloneReviewMatch.evidence) {
          expect(entry.candidateSourceRefs).toBeDefined();
          expect(entry.challengeSourceRefs).toBeDefined();
        }
      }
    }
  });
});
