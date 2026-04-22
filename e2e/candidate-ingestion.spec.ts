/**
 * e2e/candidate-ingestion.spec.ts
 *
 * BDD: Candidate resume upload → ingestion → meaning-based triangulation
 *
 * Tests the full upload→ingestion→match lifecycle for candidate resumes:
 *   1. Recruiter uploads a resume via POST /api/v1/candidates/:id/resume
 *   2. Ingestion fires asynchronously (Candidate Discovery v2 + situational scorer)
 *   3. Pipeline ingestion list shows matched repo with triangulated scores
 *   4. Mode-specific behavior: validate does NOT create challenge assignments;
 *      hybrid/tailored DOES create assignments
 *   5. Ingestion failure is non-fatal to upload; status = failed
 *   6. Re-ingest can be triggered from pending/failed state
 *   7. Match feedback (thumbs down) is recorded and retrievable
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

interface IngestionRow {
  candidateId: string;
  candidateName: string;
  status: 'pending' | 'profile_generated' | 'embedded' | 'matched' | 'failed';
  candidateSearchableProfile: string;
  matchedRepoName: string | null;
  triangulatedScore: number | null;
  dimensions: {
    skillCoverage: number;
    semanticSimilarity: number;
    situationFit: number;
    roleAlignment: number;
  } | null;
  reasoning: { matches: string[]; mismatches: string[] } | null;
  errorText: string | null;
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

async function uploadResume(
  request: APIRequestContext,
  authToken: string,
  candidateId: string,
): Promise<void> {
  const pdfBytes = minimalPdfBytes();
  const uploadRes = await request.post(
    `${API_BASE}/api/v1/candidates/${candidateId}/resume`,
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
}

async function pollIngestionStatus(
  request: APIRequestContext,
  authToken: string,
  pipelineId: string,
  candidateId: string,
  maxSeconds = 30,
): Promise<IngestionRow | null> {
  for (let i = 0; i < maxSeconds; i++) {
    const res = await request.get(
      `${API_BASE}/api/v1/pipelines/${pipelineId}/ingestion`,
      { headers: jsonHeaders(authToken) },
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { results: IngestionRow[] };
    const row = body.results.find((r) => r.candidateId === candidateId);
    if (row && (row.status === 'matched' || row.status === 'failed')) {
      return row;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

// ─── §I1  Upload triggers ingestion → candidate sees matched repo ────────────

test.describe('§I1 — Recruiter uploads resume → ingestion fires → pipeline shows matched repo', () => {
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

  test('Scenario: resume upload triggers ingestion and pipeline shows matched repo', async ({ request }) => {
    await uploadResume(request, authToken, candidate.id);

    const row = await pollIngestionStatus(request, authToken, pipeline.id, candidate.id);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('matched');
    expect(row!.matchedRepoName).not.toBeNull();
  });
});

// ─── §I2  Validate mode: upload does NOT create challenge assignments ───────

test.describe('§I2 — Validate mode: upload does NOT create challenge assignments', () => {
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

    await request.patch(`${API_BASE}/api/v1/pipelines/${pipeline.id}/match-config`, {
      headers: jsonHeaders(authToken),
      data: { match_philosophy: 'validate' },
    });
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  test('Scenario: validate mode ingestion completes but does not mutate assignments', async ({ request }) => {
    await uploadResume(request, authToken, candidate.id);

    const row = await pollIngestionStatus(request, authToken, pipeline.id, candidate.id);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('matched');

    const assignmentsRes = await request.get(
      `${API_BASE}/api/v1/candidates/${candidate.id}/assignments`,
      { headers: jsonHeaders(authToken) },
    );
    expect(assignmentsRes.status()).toBe(200);
    const assignmentsBody = (await assignmentsRes.json()) as { assignments: unknown[] };
    expect(assignmentsBody.assignments.length).toBe(0);
  });
});

// ─── §I3  Hybrid mode: upload DOES run full triangulation and assignments ───

test.describe('§I3 — Hybrid mode: upload DOES create challenge assignments', () => {
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

    await request.patch(`${API_BASE}/api/v1/pipelines/${pipeline.id}/match-config`, {
      headers: jsonHeaders(authToken),
      data: { match_philosophy: 'hybrid' },
    });
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  test('Scenario: hybrid mode creates assignments and shows triangulated scores', async ({ request }) => {
    await uploadResume(request, authToken, candidate.id);

    const row = await pollIngestionStatus(request, authToken, pipeline.id, candidate.id);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('matched');

    // Assignments exist
    const assignmentsRes = await request.get(
      `${API_BASE}/api/v1/candidates/${candidate.id}/assignments`,
      { headers: jsonHeaders(authToken) },
    );
    expect(assignmentsRes.status()).toBe(200);
    const assignmentsBody = (await assignmentsRes.json()) as { assignments: unknown[] };
    expect(assignmentsBody.assignments.length).toBeGreaterThan(0);

    // Dimensions populated
    expect(row!.triangulatedScore).not.toBeNull();
    expect(row!.dimensions).not.toBeNull();
    expect(row!.dimensions!.skillCoverage).toBeGreaterThanOrEqual(0);
    expect(row!.dimensions!.skillCoverage).toBeLessThanOrEqual(1);
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

  test('Scenario: upload succeeds even when ingestion eventually fails', async ({ request }) => {
    // We cannot force an ingestion failure in this environment without a mock
    // toggle. Assert the contract: upload 201 + eventual terminal status.
    await uploadResume(request, authToken, candidate.id);

    const row = await pollIngestionStatus(request, authToken, pipeline.id, candidate.id);
    expect(row).not.toBeNull();
    expect(['matched', 'failed']).toContain(row!.status);
  });
});

// ─── §I5  Re-ingest: re-runs from pending ───────────────────────────────────

test.describe('§I5 — Re-ingest: re-runs from pending/failed', () => {
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

  test('Scenario: re-ingest endpoint re-runs ingestion from pending', async ({ request }) => {
    // Trigger initial upload
    await uploadResume(request, authToken, candidate.id);

    // Wait for first run to finish
    const firstRow = await pollIngestionStatus(request, authToken, pipeline.id, candidate.id);
    expect(firstRow).not.toBeNull();
    expect(['matched', 'failed']).toContain(firstRow!.status);

    // Call re-ingest
    const reingestRes = await request.post(
      `${API_BASE}/api/v1/pipelines/${pipeline.id}/ingestion/${candidate.id}/reingest`,
      { headers: jsonHeaders(authToken) },
    );
    expect(reingestRes.status()).toBe(200);

    // Poll for completion again
    const secondRow = await pollIngestionStatus(request, authToken, pipeline.id, candidate.id);
    expect(secondRow).not.toBeNull();
    expect(secondRow!.status).toBe('matched');
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

  test('Scenario: thumbs down feedback is recorded and retrievable', async ({ request }) => {
    // Ensure a match exists first
    await uploadResume(request, authToken, candidate.id);

    const row = await pollIngestionStatus(request, authToken, pipeline.id, candidate.id);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('matched');

    // Submit thumbs down
    const feedbackRes = await request.post(
      `${API_BASE}/api/v1/pipelines/${pipeline.id}/ingestion/${candidate.id}/feedback`,
      {
        headers: jsonHeaders(authToken),
        data: {
          thumb: 'down',
          reason: 'Repo too advanced for this candidate',
        },
      },
    );
    expect(feedbackRes.status()).toBe(200);
    const feedbackBody = (await feedbackRes.json()) as { success: boolean; feedbackId: string };
    expect(feedbackBody.success).toBe(true);

    // Retrieve feedback
    const listRes = await request.get(
      `${API_BASE}/api/v1/pipelines/${pipeline.id}/ingestion/${candidate.id}/feedback`,
      { headers: jsonHeaders(authToken) },
    );
    expect(listRes.status()).toBe(200);
    const listBody = (await listRes.json()) as {
      feedback: Array<{ thumb: string; reason: string | null }>;
    };
    expect(listBody.feedback.length).toBeGreaterThan(0);
    expect(listBody.feedback[0].thumb).toBe('down');
    expect(listBody.feedback[0].reason).toBe('Repo too advanced for this candidate');
  });
});
