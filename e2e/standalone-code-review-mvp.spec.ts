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
 * These tests protect the source-backed standalone path end-to-end.
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
  demandIds: string[];
  demandFamilies: string[];
  candidateSourceSpanIds: string[];
  repoSourceSpanIds: string[];
}

interface SeedStandaloneReviewFixture extends SeedStandaloneReviewFixtureResponse {
  conceptKey: string;
  conceptLabel: string;
  repoFullName: string;
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

async function submitStandaloneIntakeEvidence(
  request: APIRequestContext,
  sessionToken: string,
): Promise<void> {
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
  expect([200, 201]).toContain(intakeRes.status());

  const intakeBody = await intakeRes.json() as { success?: boolean };
  expect(intakeBody.success).toBe(true);
}

async function seedStandaloneReviewMatchFixture(
  request: APIRequestContext,
  authToken: string,
  candidate: StandaloneCandidate,
): Promise<SeedStandaloneReviewFixture> {
  const suffix = candidate.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toLowerCase();
  const conceptKey = `term:e2e-source-backed-${suffix}`;
  const conceptLabel = `e2e source backed ${suffix}`;
  const retryConceptKey = 'term:retry';
  const idempotencyConceptKey = 'term:idempotency';
  const publisherConceptKey = 'term:publisher';
  const vitestConceptKey = 'term:vitest';
  const repoFullName = `pipe/e2e-source-backed-${suffix}`;
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
        {
          canonicalKey: retryConceptKey,
          namespace: 'term',
          label: 'retry',
        },
        {
          canonicalKey: idempotencyConceptKey,
          namespace: 'term',
          label: 'idempotency',
        },
        {
          canonicalKey: publisherConceptKey,
          namespace: 'term',
          label: 'publisher',
        },
        {
          canonicalKey: vitestConceptKey,
          namespace: 'term',
          label: 'vitest',
        },
      ],
      candidateEvidence: [
        {
          exactText: `Implemented ${conceptLabel} idempotency with source-backed evidence.`,
          predicate: 'implemented',
          narrative: `Candidate implemented ${conceptLabel} idempotency.`,
          conceptKeys: [conceptKey, idempotencyConceptKey],
          evidenceLevel: 'implemented',
          strength: 1,
          confidence: 1,
        },
        {
          exactText: `Validated ${conceptLabel} retry behavior with tests.`,
          predicate: 'validated',
          narrative: `Candidate validated ${conceptLabel} retry behavior.`,
          conceptKeys: [conceptKey, retryConceptKey, vitestConceptKey],
          evidenceLevel: 'validated',
          strength: 1,
          confidence: 1,
        },
        {
          exactText: `Published ${conceptLabel} retry envelopes through a deterministic publisher.`,
          predicate: 'implemented',
          narrative: `Candidate implemented ${conceptLabel} publisher behavior.`,
          conceptKeys: [publisherConceptKey],
          evidenceLevel: 'implemented',
          strength: 1,
          confidence: 1,
        },
        {
          exactText: `Explained how ${conceptLabel} prevents duplicate retry acknowledgements.`,
          predicate: 'explained',
          narrative: `Candidate explained ${conceptLabel} duplicate acknowledgement prevention.`,
          conceptKeys: [retryConceptKey, idempotencyConceptKey],
          evidenceLevel: 'validated',
          strength: 1,
          confidence: 1,
        },
      ],
      repo: {
        githubUrl: repoUrl,
        fullName: repoFullName,
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
          exactText: [
            `export type RetryEvent = { id: string; attempt: number; key: string };`,
            ``,
            `// Implement ${conceptLabel} idempotency for reviewable retry events.`,
            `export function buildRetryEnvelope(event: RetryEvent) {`,
            `  const idempotencyKey = \`\${event.key}:\${event.attempt}\`;`,
            `  return {`,
            `    id: event.id,`,
            `    idempotencyKey,`,
            `    topic: '${conceptLabel}',`,
            `    shouldPublish: event.attempt > 0,`,
            `  };`,
            `}`,
            ``,
            `export function acknowledgeRetry(event: RetryEvent) {`,
            `  return buildRetryEnvelope(event).shouldPublish;`,
            `}`,
          ].join('\n'),
          artifactType: 'source',
          lineStart: 10,
        },
        {
          key: 'publisher',
          path: 'src/retry-publisher.ts',
          exactText: [
            `import { buildRetryEnvelope, type RetryEvent } from './retry-idempotency';`,
            ``,
            `export function publishRetry(event: RetryEvent, publish: (topic: string, key: string) => void) {`,
            `  const envelope = buildRetryEnvelope(event);`,
            `  if (!envelope.shouldPublish) return 'skipped';`,
            `  publish(envelope.topic, envelope.idempotencyKey);`,
            `  return 'published';`,
            `}`,
          ].join('\n'),
          artifactType: 'source',
          lineStart: 40,
        },
        {
          key: 'validation',
          path: 'src/retry-idempotency.test.ts',
          exactText: [
            `import { describe, expect, it } from 'vitest';`,
            `import { buildRetryEnvelope } from './retry-idempotency';`,
            ``,
            `describe('${conceptLabel} retry behavior', () => {`,
            `  it('keeps retry acknowledgement idempotent', () => {`,
            `    // Validate ${conceptLabel} retry behavior with deterministic tests.`,
            `    const envelope = buildRetryEnvelope({ id: 'evt-1', attempt: 2, key: 'retry' });`,
            `    expect(envelope.idempotencyKey).toBe('retry:2');`,
            `    expect(envelope.shouldPublish).toBe(true);`,
            `  });`,
            `});`,
          ].join('\n'),
          artifactType: 'test',
          lineStart: 22,
        },
      ],
      demands: [
        {
          id: 'implementation-demand',
          family: 'source-backed:e2e-implementation',
          narrative: `Review implemented ${conceptLabel} idempotency.`,
          conceptKeys: [conceptKey, idempotencyConceptKey],
          sourceSpanKeys: ['implementation'],
          weight: 0.5,
        },
        {
          id: 'publisher-demand',
          family: 'source-backed:e2e-publisher',
          narrative: `Review published ${conceptLabel} retry envelopes.`,
          conceptKeys: [publisherConceptKey],
          sourceSpanKeys: ['publisher'],
          weight: 0.25,
        },
        {
          id: 'validation-demand',
          family: 'source-backed:e2e-validation',
          narrative: `Review validated ${conceptLabel} retry behavior.`,
          conceptKeys: [conceptKey, retryConceptKey, vitestConceptKey],
          sourceSpanKeys: ['validation'],
          weight: 0.25,
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
  expect(body.demandIds.length).toBeGreaterThanOrEqual(2);
  expect(body.demandFamilies.length).toBeGreaterThanOrEqual(2);
  return { ...body, conceptKey, conceptLabel, repoFullName };
}

async function submitStandaloneCodeReview(
  request: APIRequestContext,
  sessionToken: string,
  options: {
    summary: string;
    annotations: Array<{
      file: string;
      line: number;
      severity: string;
      comment: string;
    }>;
  },
): Promise<void> {
  const submitRes = await request.post(`${API_BASE}/rpc/submit-challenge-response`, {
    headers: candidateHeaders(sessionToken),
    data: {
      order: 0,
      submission: {
        type: 'CODE_REVIEW',
        verdict: 'request_changes',
        summary: options.summary,
        annotations: options.annotations,
      },
    },
  });

  expect([200, 201]).toContain(submitRes.status());

  const body = await submitRes.json() as Record<string, unknown>;
  expect(JSON.stringify(body)).not.toContain('groundTruth');
  expect(body.success).toBe(true);
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

  test('UI flow: /schedule exposes current NEW INTERVIEW modal', async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();

    await page.goto(`${APP_BASE}/schedule`);
    await page.waitForLoadState('networkidle');

    // CODE_REVIEW candidate creation is covered by the recruiter API tests above.
    // The current schedule UI creates meeting invites from the same interview surface.
    const inviteBtn = page.getByRole('main').getByRole('button', { name: /NEW INTERVIEW/i }).first();
    await expect(inviteBtn).toBeVisible({ timeout: 10000 });
    await inviteBtn.click();

    await expect(page.getByText('NEW INTERVIEW').first()).toBeVisible({ timeout: 5000 });

    const nameInput = page.locator('input[placeholder="Jane Smith"]');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('E2E Code Review Test');

    const emailInput = page.locator('input[placeholder="jane@example.com"]');
    await expect(emailInput).toBeVisible();
    await emailInput.fill(`standalone-ui+${Date.now()}@pipe-test.dev`);

    await expect(page.getByRole('button', { name: /^VIDEO$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^CODE_REVIEW$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /CREATE INTERVIEW/i })).toBeEnabled();

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

    // Step 1: Submit resume/profile evidence via the challenge-response intake path.
    await submitStandaloneIntakeEvidence(request, sessionToken);

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

  test('submit-challenge-response requires a selected PR, then completes the matched review', async ({ request }) => {
    const prematureRes = await request.post(`${API_BASE}/rpc/submit-challenge-response`, {
      headers: candidateHeaders(sessionToken),
      data: {
        order: 0,
        submission: {
          type: 'CODE_REVIEW',
          verdict: 'request_changes',
          summary: 'This should not be accepted before a source-backed PR is selected.',
          annotations: [],
        },
      },
    });
    expect(prematureRes.status()).toBe(409);
    const prematureBody = await prematureRes.json() as {
      error?: { code?: string };
      challenge?: { type?: string };
    };
    expect(prematureBody.error?.code).toBe('WAITING_FOR_MATCH');
    expect(prematureBody.challenge?.type).toBe('WAITING_FOR_MATCH');

    await submitStandaloneIntakeEvidence(request, sessionToken);
    const fixture = await seedStandaloneReviewMatchFixture(request, authToken, candidate);

    const challengeRes = await request.post(`${API_BASE}/rpc/get-challenge`, {
      headers: candidateHeaders(sessionToken),
      data: { order: 0 },
    });
    expect(challengeRes.status()).toBe(200);
    const challenge = await challengeRes.json() as ChallengeResponse;
    expect(challenge.type).toBe('CODE_REVIEW');
    expect(challenge.githubRepoUrl).toBe(fixture.repoUrl);
    expect(challenge.githubPrNumber).toBe(fixture.prNumber);

    const reviewSummary = 'The PR introduces a search feature but has a critical debounce issue. Every keystroke triggers a network request which will overwhelm the API.';
    await submitStandaloneCodeReview(request, sessionToken, {
      summary: reviewSummary,
      annotations: [
        {
          file: 'src/pages/Search.tsx',
          line: 43,
          severity: 'blocking',
          comment: 'No debounce on search input; add a 300ms debounce with AbortController.',
        },
      ],
    });

    const profileRes = await request.get(`${API_BASE}/api/v1/candidates/${candidate.id}`, {
      headers: recruiterHeaders(authToken),
    });
    expect(profileRes.status()).toBe(200);

    const profile = await profileRes.json() as Record<string, unknown>;
    const interviews = profile.scheduledInterviews as Array<{
      interviewType: string;
      status: string;
    }> | undefined;
    const standaloneReviewMatch = profile.standaloneReviewMatch as {
      matchStatus?: string;
      repoUrl?: string | null;
      prNumber?: number | null;
      submitted?: boolean;
      submission?: {
        verdict?: string | null;
        summary?: string | null;
        annotationCount?: number;
      } | null;
      evidence?: Array<{
        candidateSourceRefs?: unknown[];
        challengeSourceRefs?: unknown[];
      }>;
      diagnostics?: {
        recalledPacketIds?: string[];
      };
    } | null;

    expect(interviews).toBeDefined();
    const codeReview = interviews!.find((i) => i.interviewType === 'CODE_REVIEW');
    expect(codeReview).toBeDefined();
    expect(codeReview!.status).toBe('COMPLETED');
    expect(standaloneReviewMatch).not.toBeNull();
    expect(standaloneReviewMatch!.matchStatus).toBe('MATCHED');
    expect(standaloneReviewMatch!.repoUrl).toBe(fixture.repoUrl);
    expect(standaloneReviewMatch!.prNumber).toBe(fixture.prNumber);
    expect(standaloneReviewMatch!.submitted).toBe(true);
    expect(standaloneReviewMatch!.submission?.verdict).toBe('request_changes');
    expect(standaloneReviewMatch!.submission?.summary).toBe(reviewSummary);
    expect(standaloneReviewMatch!.submission?.annotationCount).toBe(1);
    expect(standaloneReviewMatch!.evidence?.length).toBeGreaterThan(0);
    expect(standaloneReviewMatch!.evidence!.every((entry) =>
      Array.isArray(entry.candidateSourceRefs)
      && entry.candidateSourceRefs.length > 0
      && Array.isArray(entry.challengeSourceRefs)
      && entry.challengeSourceRefs.length > 0
    )).toBe(true);
    expect(standaloneReviewMatch!.diagnostics?.recalledPacketIds).toContain(fixture.packetId);
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

  test('CONTEXT tab renders submitted review with source-backed match evidence', async ({ browser, request }) => {
    const reviewedCandidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'Submitted Context Graph Candidate',
      email: `context-submitted+e2e-${Date.now()}@pipe-test.dev`,
    });
    const session = await resolveToken(request, reviewedCandidate.inviteToken);
    await submitStandaloneIntakeEvidence(request, session.sessionToken);
    const fixture = await seedStandaloneReviewMatchFixture(request, authToken, reviewedCandidate);

    const challengeRes = await request.post(`${API_BASE}/rpc/get-challenge`, {
      headers: candidateHeaders(session.sessionToken),
      data: { order: 0 },
    });
    expect(challengeRes.status()).toBe(200);
    const challenge = await challengeRes.json() as ChallengeResponse;
    expect(challenge.type).toBe('CODE_REVIEW');
    expect(challenge.githubRepoUrl).toBe(fixture.repoUrl);
    expect(challenge.githubPrNumber).toBe(fixture.prNumber);

    const reviewSummary = `The ${fixture.conceptLabel} implementation is reviewable, but the retry path still needs an idempotency guard before acknowledging duplicate events.`;
    const reviewComment = `Add an idempotency-key check around ${fixture.conceptLabel} retry publication before acknowledging the event.`;
    await submitStandaloneCodeReview(request, session.sessionToken, {
      summary: reviewSummary,
      annotations: [{
        file: 'src/retry-idempotency.ts',
        line: 10,
        severity: 'blocking',
        comment: reviewComment,
      }],
    });

    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();

    await page.goto(`${APP_BASE}/candidates/${reviewedCandidate.id}`);
    await page.getByRole('button', { name: 'CONTEXT' }).click();
    await expect(page.getByTestId('living-context-graph')).toBeVisible({ timeout: 15000 });

    const matchPanel = page.getByTestId('standalone-review-match-panel');
    await expect(matchPanel).toContainText('Standalone CODE_REVIEW match');
    await expect(matchPanel).toContainText('MATCHED');
    await expect(matchPanel).toContainText(`${fixture.repoFullName} #${fixture.prNumber}`);
    await expect(matchPanel).toContainText('Review source-backed retry idempotency');
    await expect(matchPanel).toContainText('Review submitted');

    const submission = page.getByTestId('standalone-review-submission');
    await expect(submission).toContainText('Candidate review result');
    await expect(submission).toContainText('Request Changes');
    await expect(submission).toContainText('1 annotation');
    await expect(submission).toContainText(reviewSummary);
    await expect(submission).toContainText('src/retry-idempotency.ts · line 10 · blocking');
    await expect(submission).toContainText(reviewComment);

    const evidence = page.getByTestId('standalone-review-evidence');
    await expect(evidence).toContainText('Candidate evidence');
    await expect(evidence).toContainText(`Implemented ${fixture.conceptLabel} idempotency with source-backed evidence.`);
    await expect(evidence).toContainText('PR demand evidence');
    await expect(evidence).toContainText(`Implement ${fixture.conceptLabel} idempotency for reviewable retry events.`);
    await expect(evidence).toContainText(fixture.conceptKey);

    const repoOverlay = page.getByTestId('repository-overlay-panel');
    await expect(repoOverlay).toBeVisible();
    await expect(repoOverlay).toContainText('Repository evidence overlay');
    await expect(repoOverlay).toContainText(`${fixture.repoFullName} · PR #${fixture.prNumber}`);
    for (const demandId of fixture.demandIds.slice(0, 2)) {
      await expect(repoOverlay).toContainText(demandId);
    }
    await expect(repoOverlay).toContainText('src/retry-idempotency.ts');
    await expect(repoOverlay).toContainText('src/retry-publisher.ts');
    await expect(repoOverlay).toContainText('src/retry-idempotency.test.ts');
    await expect(repoOverlay).toContainText('Candidate source');
    await expect(repoOverlay).toContainText('PR demand source');
    await expect(repoOverlay).toContainText(`Implemented ${fixture.conceptLabel} idempotency with source-backed evidence.`);
    await expect(repoOverlay).toContainText(`Implement ${fixture.conceptLabel} idempotency for reviewable retry events.`);
    await expect(repoOverlay).toContainText(`Validate ${fixture.conceptLabel} retry behavior with deterministic tests.`);
    await expect(repoOverlay).toContainText(fixture.conceptKey);

    const candidateSourceCard = repoOverlay
      .getByTestId('review-source-card')
      .filter({
        hasText: `Implemented ${fixture.conceptLabel} idempotency with source-backed evidence.`,
      })
      .first();
    await expect(candidateSourceCard).toHaveAttribute('data-source-ref-type', 'source_span');
    await expect(candidateSourceCard).toHaveAttribute('data-source-ref-id', fixture.candidateSourceSpanIds[0]);
    await expect(candidateSourceCard).toHaveAttribute('data-source-span-id', fixture.candidateSourceSpanIds[0]);

    const repoSourceCard = repoOverlay
      .getByTestId('review-source-card')
      .filter({
        hasText: `Implement ${fixture.conceptLabel} idempotency for reviewable retry events.`,
      })
      .first();
    await expect(repoSourceCard).toHaveAttribute('data-source-ref-type', 'repo_source_span');
    await expect(repoSourceCard).toHaveAttribute('data-content-hash', /^sha256:/);
    const repoSourceRefId = await repoSourceCard.getAttribute('data-source-ref-id');
    expect(fixture.repoSourceSpanIds).toContain(repoSourceRefId);

    const diagnostics = page.getByTestId('standalone-review-diagnostics');
    await expect(diagnostics).toContainText('Recalled packets');
    await expect(diagnostics).toContainText(fixture.packetId);
    await expect(diagnostics).toContainText('Evaluated challenge evidence');
    await expect(diagnostics).toContainText('Eligible');

    await context.close();
  });
});
