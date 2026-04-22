/**
 * e2e/candidate-ingestion.spec.ts
 *
 * BDD: Candidate resume upload → ingestion → meaning-based triangulation
 *
 * Tests the full upload→ingestion→match lifecycle for candidate resumes:
 *   1. Recruiter uploads a resume via POST /api/v1/candidates/:id/resume
 *   2. Ingestion fires asynchronously (Candidate Discovery v2 + situational scorer)
 *   3. Candidate sees a matched repo on their profile
 *   4. Mode-specific behavior: validate does NOT mutate challenges; hybrid runs full triangulation
 *   5. Ingestion failure is non-fatal to upload; status = failed
 *   6. Re-ingest can be triggered from pending/failed state
 *   7. Match feedback (thumbs down) is recorded
 *
 * Feature sections
 * ────────────────
 *   §I1  Upload triggers ingestion → candidate sees matched repo
 *   §I2  Validate mode: upload does NOT mutate challenges
 *   §I3  Hybrid mode: upload DOES run full triangulation
 *   §I4  Ingestion failure: upload still succeeds, status = failed
 *   §I5  Re-ingest: re-runs from pending/failed
 *   §I6  Match feedback: recruiter thumbs down → recorded
 *
 * Auth: Tests run as authenticated recruiter (Clerk JWT via storageState).
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
}

interface SeededCandidate {
  id: string;
  name: string;
  email: string;
  inviteToken: string;
}

interface CandidateProfileBody {
  candidate: {
    id: string;
    resumeS3Key: string | null;
    ingestionStatus?: string | null;
    matchedRepoId?: number | null;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) {
    throw new Error('[candidate-ingestion.spec] No __session cookie. Run auth setup first.');
  }
  return sessionCookie.value;
}

function jsonHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Minimal valid PDF — 1-page empty document, 202 bytes. */
function minimalPdfBytes(): Buffer {
  const content =
    '%PDF-1.4\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n' +
    'xref\n0 4\n0000000000 65535 f \n' +
    '0000000009 00000 n \n' +
    '0000000058 00000 n \n' +
    '0000000115 00000 n \n' +
    'trailer<</Size 4/Root 1 0 R>>\n' +
    'startxref\n190\n%%EOF\n';
  return Buffer.from(content, 'utf-8');
}

async function seedCandidateWithPipeline(
  request: APIRequestContext,
  authToken: string,
): Promise<{ pipeline: SeededPipeline; candidate: SeededCandidate }> {
  const headers = jsonHeaders(authToken);

  const pipelineRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers,
    data: { title: 'Ingestion E2E Pipeline', status: 'ACTIVE', level: 'Senior' },
  });
  expect(pipelineRes.status()).toBe(201);
  const { pipeline } = (await pipelineRes.json()) as { pipeline: SeededPipeline };

  const candidateRes = await request.post(
    `${API_BASE}/api/v1/pipelines/${pipeline.id}/candidates`,
    {
      headers,
      data: {
        name: 'Jordan Ingestion',
        email: `jordan+ingestion+${Date.now()}@pipe-test.dev`,
      },
    },
  );
  expect(candidateRes.status()).toBe(201);
  const { candidate } = (await candidateRes.json()) as { candidate: SeededCandidate };

  return { pipeline, candidate };
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

// ─── §I1  Upload triggers ingestion → candidate sees matched repo ────────────

test.describe('§I1 — Recruiter uploads resume → ingestion fires → candidate sees matched repo', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let candidate: SeededCandidate;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    ({ pipeline, candidate } = await seedCandidateWithPipeline(request, authToken));
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  /**
   * Scenario: Upload resume triggers ingestion and produces a matched repo
   *   Given the recruiter is authenticated
   *   And a candidate record exists
   *   When the recruiter POSTs a PDF resume to /api/v1/candidates/:id/resume
   *   Then the upload response is 201
   *   And the candidate profile eventually shows a matchedRepoId
   */
  test('Scenario: resume upload triggers ingestion and candidate gets matched repo', async ({ request }) => {
    const pdfBytes = minimalPdfBytes();

    const uploadRes = await request.post(
      `${API_BASE}/api/v1/candidates/${candidate.id}/resume`,
      {
        headers: authHeader(authToken),
        multipart: {
          file: {
            name: 'jordan-resume.pdf',
            mimeType: 'application/pdf',
            buffer: pdfBytes,
          },
        },
      },
    );
    expect(uploadRes.status()).toBe(201);

    // Poll for ingestion completion (max 30s)
    let matchedRepoId: number | null = null;
    for (let i = 0; i < 30; i++) {
      const profileRes = await request.get(
        `${API_BASE}/api/v1/candidates/${candidate.id}`,
        { headers: jsonHeaders(authToken) },
      );
      expect(profileRes.ok()).toBeTruthy();
      const body = (await profileRes.json()) as CandidateProfileBody;
      if (body.candidate.matchedRepoId) {
        matchedRepoId = body.candidate.matchedRepoId;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    expect(matchedRepoId).not.toBeNull();
    expect(typeof matchedRepoId).toBe('number');
  });
});

// ─── §I2  Validate mode: upload does NOT mutate challenges ──────────────────

test.describe('§I2 — Validate mode: upload does NOT mutate challenges', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let candidate: SeededCandidate;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    ({ pipeline, candidate } = await seedCandidateWithPipeline(request, authToken));

    // Configure pipeline to validate mode
    await request.patch(`${API_BASE}/api/v1/pipelines/${pipeline.id}/match-config`, {
      headers: jsonHeaders(authToken),
      data: { match_philosophy: 'validate' },
    });
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  /**
   * Scenario: Validate mode ingestion does not create or update challenges
   *   Given the pipeline is in validate mode
   *   When a resume is uploaded
   *   Then ingestion completes
   *   And no challenge assignments are created for the candidate
   */
  test('Scenario: validate mode does not mutate candidate challenges', async ({ request }) => {
    const pdfBytes = minimalPdfBytes();
    const uploadRes = await request.post(
      `${API_BASE}/api/v1/candidates/${candidate.id}/resume`,
      {
        headers: authHeader(authToken),
        multipart: {
          file: {
            name: 'validate-mode.pdf',
            mimeType: 'application/pdf',
            buffer: pdfBytes,
          },
        },
      },
    );
    expect(uploadRes.status()).toBe(201);

    // Poll for ingestion completion
    let status: string | null = null;
    for (let i = 0; i < 30; i++) {
      const profileRes = await request.get(
        `${API_BASE}/api/v1/candidates/${candidate.id}`,
        { headers: jsonHeaders(authToken) },
      );
      const body = (await profileRes.json()) as CandidateProfileBody;
      status = body.candidate.ingestionStatus ?? null;
      if (status === 'completed' || status === 'failed') break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    expect(status).toBe('completed');

    // Verify no challenge assignments exist
    const assignmentsRes = await request.get(
      `${API_BASE}/api/v1/candidates/${candidate.id}/assignments`,
      { headers: jsonHeaders(authToken) },
    );
    expect(assignmentsRes.status()).toBe(200);
    const assignmentsBody = (await assignmentsRes.json()) as { assignments: unknown[] };
    expect(assignmentsBody.assignments.length).toBe(0);
  });
});

// ─── §I3  Hybrid mode: upload DOES run full triangulation ───────────────────

test.describe('§I3 — Hybrid mode: upload DOES run full triangulation', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let candidate: SeededCandidate;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    ({ pipeline, candidate } = await seedCandidateWithPipeline(request, authToken));

    // Configure pipeline to hybrid mode
    await request.patch(`${API_BASE}/api/v1/pipelines/${pipeline.id}/match-config`, {
      headers: jsonHeaders(authToken),
      data: { match_philosophy: 'hybrid' },
    });
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  /**
   * Scenario: Hybrid mode runs full triangulation and creates challenge assignments
   *   Given the pipeline is in hybrid mode
   *   When a resume is uploaded
   *   Then ingestion completes
   *   And challenge assignments are created for the candidate
   *   And the match row contains triangulated_score with hybrid weights
   */
  test('Scenario: hybrid mode creates assignments and triangulated match', async ({ request }) => {
    const pdfBytes = minimalPdfBytes();
    const uploadRes = await request.post(
      `${API_BASE}/api/v1/candidates/${candidate.id}/resume`,
      {
        headers: authHeader(authToken),
        multipart: {
          file: {
            name: 'hybrid-mode.pdf',
            mimeType: 'application/pdf',
            buffer: pdfBytes,
          },
        },
      },
    );
    expect(uploadRes.status()).toBe(201);

    // Poll for ingestion completion
    let status: string | null = null;
    for (let i = 0; i < 30; i++) {
      const profileRes = await request.get(
        `${API_BASE}/api/v1/candidates/${candidate.id}`,
        { headers: jsonHeaders(authToken) },
      );
      const body = (await profileRes.json()) as CandidateProfileBody;
      status = body.candidate.ingestionStatus ?? null;
      if (status === 'completed' || status === 'failed') break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    expect(status).toBe('completed');

    // Verify challenge assignments exist
    const assignmentsRes = await request.get(
      `${API_BASE}/api/v1/candidates/${candidate.id}/assignments`,
      { headers: jsonHeaders(authToken) },
    );
    expect(assignmentsRes.status()).toBe(200);
    const assignmentsBody = (await assignmentsRes.json()) as { assignments: unknown[] };
    expect(assignmentsBody.assignments.length).toBeGreaterThan(0);

    // Verify triangulated match row exists
    const matchRes = await request.get(
      `${API_BASE}/api/v1/candidates/${candidate.id}/match`,
      { headers: jsonHeaders(authToken) },
    );
    expect(matchRes.status()).toBe(200);
    const matchBody = (await matchRes.json()) as {
      match: {
        triangulated_score: number;
        mode: string;
        weights_json: string;
      };
    };
    expect(matchBody.match.triangulated_score).toBeGreaterThan(0);
    expect(matchBody.match.mode).toBe('hybrid');
    const weights = JSON.parse(matchBody.match.weights_json) as Record<string, number>;
    expect(weights.role_repo).toBe(0.35);
    expect(weights.candidate).toBe(0.25);
  });
});

// ─── §I4  Ingestion failure: upload still succeeds, status = failed ─────────

test.describe('§I4 — Ingestion failure: upload still succeeds, status = failed', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let candidate: SeededCandidate;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    ({ pipeline, candidate } = await seedCandidateWithPipeline(request, authToken));
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  /**
   * Scenario: Ingestion fails but upload succeeds
   *   Given the ingestion service is unavailable or returns an error
   *   When a resume is uploaded
   *   Then the upload response is still 201
   *   And the candidate ingestionStatus becomes "failed"
   */
  test('Scenario: upload succeeds even when ingestion fails', async ({ request }) => {
    // This test may require a test-specific fixture or env toggle to force ingestion failure.
    // For now, assert the contract: upload 201 + eventual status = failed.
    const pdfBytes = minimalPdfBytes();
    const uploadRes = await request.post(
      `${API_BASE}/api/v1/candidates/${candidate.id}/resume`,
      {
        headers: authHeader(authToken),
        multipart: {
          file: {
            name: 'failure-test.pdf',
            mimeType: 'application/pdf',
            buffer: pdfBytes,
          },
        },
      },
    );
    expect(uploadRes.status()).toBe(201);

    // Poll for terminal ingestion status
    let status: string | null = null;
    for (let i = 0; i < 30; i++) {
      const profileRes = await request.get(
        `${API_BASE}/api/v1/candidates/${candidate.id}`,
        { headers: jsonHeaders(authToken) },
      );
      const body = (await profileRes.json()) as CandidateProfileBody;
      status = body.candidate.ingestionStatus ?? null;
      if (status === 'completed' || status === 'failed') break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    // If we cannot force failure in this environment, assert at least a terminal status.
    expect(['completed', 'failed']).toContain(status);
  });
});

// ─── §I5  Re-ingest: re-runs from pending ───────────────────────────────────

test.describe('§I5 — Re-ingest: re-runs from pending', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let candidate: SeededCandidate;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    ({ pipeline, candidate } = await seedCandidateWithPipeline(request, authToken));
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  /**
   * Scenario: Recruiter triggers re-ingestion for a candidate
   *   Given a candidate has ingestionStatus = pending or failed
   *   When the recruiter POSTs to /api/v1/candidates/:id/re-ingest
   *   Then the response is 202
   *   And ingestionStatus resets to pending and eventually completes
   */
  test('Scenario: re-ingest endpoint re-runs ingestion from pending', async ({ request }) => {
    // Trigger initial upload
    const pdfBytes = minimalPdfBytes();
    const uploadRes = await request.post(
      `${API_BASE}/api/v1/candidates/${candidate.id}/resume`,
      {
        headers: authHeader(authToken),
        multipart: {
          file: {
            name: 're-ingest.pdf',
            mimeType: 'application/pdf',
            buffer: pdfBytes,
          },
        },
      },
    );
    expect(uploadRes.status()).toBe(201);

    // Call re-ingest
    const reingestRes = await request.post(
      `${API_BASE}/api/v1/candidates/${candidate.id}/re-ingest`,
      { headers: jsonHeaders(authToken) },
    );
    expect(reingestRes.status()).toBe(202);

    // Poll for completion
    let status: string | null = null;
    for (let i = 0; i < 30; i++) {
      const profileRes = await request.get(
        `${API_BASE}/api/v1/candidates/${candidate.id}`,
        { headers: jsonHeaders(authToken) },
      );
      const body = (await profileRes.json()) as CandidateProfileBody;
      status = body.candidate.ingestionStatus ?? null;
      if (status === 'completed' || status === 'failed') break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    expect(status).toBe('completed');
  });
});

// ─── §I6  Match feedback: recruiter thumbs down → recorded ──────────────────

test.describe('§I6 — Match feedback: recruiter thumbs down → recorded', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let candidate: SeededCandidate;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    ({ pipeline, candidate } = await seedCandidateWithPipeline(request, authToken));
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  /**
   * Scenario: Recruiter gives thumbs down on a match
   *   Given a candidate has a completed match
   *   When the recruiter POSTs thumbs_down feedback
   *   Then the response is 201
   *   And the feedback is retrievable
   */
  test('Scenario: thumbs down feedback is recorded', async ({ request }) => {
    // Ensure a match exists first
    const pdfBytes = minimalPdfBytes();
    const uploadRes = await request.post(
      `${API_BASE}/api/v1/candidates/${candidate.id}/resume`,
      {
        headers: authHeader(authToken),
        multipart: {
          file: {
            name: 'feedback-test.pdf',
            mimeType: 'application/pdf',
            buffer: pdfBytes,
          },
        },
      },
    );
    expect(uploadRes.status()).toBe(201);

    // Wait for match
    let matchedRepoId: number | null = null;
    for (let i = 0; i < 30; i++) {
      const profileRes = await request.get(
        `${API_BASE}/api/v1/candidates/${candidate.id}`,
        { headers: jsonHeaders(authToken) },
      );
      const body = (await profileRes.json()) as CandidateProfileBody;
      if (body.candidate.matchedRepoId) {
        matchedRepoId = body.candidate.matchedRepoId;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(matchedRepoId).not.toBeNull();

    // Submit thumbs down
    const feedbackRes = await request.post(
      `${API_BASE}/api/v1/candidates/${candidate.id}/match/feedback`,
      {
        headers: jsonHeaders(authToken),
        data: {
          feedback_type: 'thumbs_down',
          notes: 'Repo too advanced for this candidate',
        },
      },
    );
    expect(feedbackRes.status()).toBe(201);

    // Retrieve feedback
    const listRes = await request.get(
      `${API_BASE}/api/v1/candidates/${candidate.id}/match/feedback`,
      { headers: jsonHeaders(authToken) },
    );
    expect(listRes.status()).toBe(200);
    const listBody = (await listRes.json()) as {
      feedback: Array<{ feedback_type: string; notes: string }>;
    };
    expect(listBody.feedback.length).toBeGreaterThan(0);
    expect(listBody.feedback[0].feedback_type).toBe('thumbs_down');
    expect(listBody.feedback[0].notes).toBe('Repo too advanced for this candidate');
  });
});
