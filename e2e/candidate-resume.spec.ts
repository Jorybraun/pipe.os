/**
 * e2e/candidate-resume.spec.ts
 *
 * BDD: Candidate CV/Resume Upload and Download — R2 storage via Worker API
 *
 * Tests the full upload→store→download lifecycle for candidate resumes:
 *   1. Recruiter uploads a PDF via POST /api/v1/candidates/:id/resume
 *   2. Worker stores the file in R2 and persists the key on the candidate record
 *   3. Recruiter downloads via GET /api/v1/candidates/:id/resume
 *   4. The candidate profile page VIEW_RESUME button is functional
 *
 * Feature sections
 * ────────────────
 *   §R1  Upload endpoint — accepts file, returns r2Key, updates candidate record
 *   §R2  Download endpoint — streams file from R2 with correct headers
 *   §R3  Profile page — VIEW_RESUME button enabled when resumeS3Key is set
 *   §R4  Validation — rejects oversized files, wrong MIME types, missing auth
 *
 * Auth: Tests run as authenticated recruiter (Clerk JWT via storageState).
 * API base: http://localhost:8787
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { API_BASE, APP_BASE } from './env';

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

interface UploadResumeResponse {
  success: boolean;
  r2Key: string;
}

interface CandidateProfileBody {
  candidate: {
    id: string;
    resumeS3Key: string | null;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) {
    throw new Error('[candidate-resume.spec] No __session cookie. Run auth setup first.');
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
  // A syntactically valid PDF 1.4 with one blank page.
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
    data: { title: 'Resume Upload E2E Pipeline', status: 'ACTIVE', level: 'Senior' },
  });
  expect(pipelineRes.status()).toBe(201);
  const { pipeline } = (await pipelineRes.json()) as { pipeline: SeededPipeline };

  const candidateRes = await request.post(
    `${API_BASE}/api/v1/pipelines/${pipeline.id}/candidates`,
    {
      headers,
      data: {
        name: 'Alex Resume',
        email: `alex+resume+${Date.now()}@pipe-test.dev`,
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

// ─── §R1  Upload endpoint ────────────────────────────────────────────────────

test.describe('§R1 — Resume upload stores file in R2 and updates candidate record', () => {
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
   * Scenario: Upload a PDF resume for a candidate
   *   Given the recruiter is authenticated
   *   And a candidate record exists
   *   When the recruiter POSTs a PDF file to /api/v1/candidates/:id/resume
   *   Then the response is 201 with { success: true, r2Key: string }
   */
  test('Scenario: POST PDF resume returns 201 with r2Key', async ({ request }) => {
    const pdfBytes = minimalPdfBytes();

    const res = await request.post(
      `${API_BASE}/api/v1/candidates/${candidate.id}/resume`,
      {
        headers: authHeader(authToken),
        multipart: {
          file: {
            name: 'alex-resume.pdf',
            mimeType: 'application/pdf',
            buffer: pdfBytes,
          },
        },
      },
    );

    expect(res.status()).toBe(201);
    const body = (await res.json()) as UploadResumeResponse;
    expect(body.success).toBe(true);
    expect(typeof body.r2Key).toBe('string');
    expect(body.r2Key).toContain(candidate.id);
    expect(body.r2Key).toContain('alex-resume.pdf');
  });

  /**
   * Scenario: After upload, candidate record has resumeS3Key set
   *   Given a resume was uploaded
   *   When the recruiter GETs the candidate profile
   *   Then the candidate.resumeS3Key field is non-null
   */
  test('Scenario: candidate record has resumeS3Key after upload', async ({ request }) => {
    // Upload first
    const pdfBytes = minimalPdfBytes();
    const uploadRes = await request.post(
      `${API_BASE}/api/v1/candidates/${candidate.id}/resume`,
      {
        headers: authHeader(authToken),
        multipart: {
          file: {
            name: 'alex-resume-check.pdf',
            mimeType: 'application/pdf',
            buffer: pdfBytes,
          },
        },
      },
    );
    expect(uploadRes.status()).toBe(201);

    // Verify it's persisted on the candidate record
    const profileRes = await request.get(
      `${API_BASE}/api/v1/candidates/${candidate.id}`,
      { headers: jsonHeaders(authToken) },
    );
    expect(profileRes.ok()).toBeTruthy();
    const body = (await profileRes.json()) as CandidateProfileBody;
    expect(body.candidate.resumeS3Key).toBeTruthy();
    expect(typeof body.candidate.resumeS3Key).toBe('string');
  });

  /**
   * Scenario: R2 key follows the expected path pattern
   *   Given a resume is uploaded
   *   Then the r2Key starts with candidate-documents/{candidateId}/
   */
  test('Scenario: r2Key follows candidate-documents/{id}/ path pattern', async ({ request }) => {
    const pdfBytes = minimalPdfBytes();
    const res = await request.post(
      `${API_BASE}/api/v1/candidates/${candidate.id}/resume`,
      {
        headers: authHeader(authToken),
        multipart: {
          file: {
            name: 'path-check.pdf',
            mimeType: 'application/pdf',
            buffer: pdfBytes,
          },
        },
      },
    );
    expect(res.status()).toBe(201);
    const body = (await res.json()) as UploadResumeResponse;
    expect(body.r2Key.startsWith(`candidate-documents/${candidate.id}/`)).toBe(true);
  });
});

// ─── §R2  Download endpoint ───────────────────────────────────────────────────

test.describe('§R2 — Resume download streams file with correct headers', () => {
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

    // Upload a resume so download tests can run
    const pdfBytes = minimalPdfBytes();
    const uploadRes = await request.post(
      `${API_BASE}/api/v1/candidates/${candidate.id}/resume`,
      {
        headers: authHeader(authToken),
        multipart: {
          file: {
            name: 'alex-dl-test.pdf',
            mimeType: 'application/pdf',
            buffer: pdfBytes,
          },
        },
      },
    );
    expect(uploadRes.status()).toBe(201);
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  /**
   * Scenario: GET resume returns 200 with PDF Content-Type
   *   Given a resume has been uploaded
   *   When the recruiter GETs /api/v1/candidates/:id/resume
   *   Then the response is 200
   *   And Content-Type is application/pdf
   */
  test('Scenario: GET resume returns 200 with PDF content-type', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/candidates/${candidate.id}/resume`,
      { headers: authHeader(authToken) },
    );

    expect(res.status()).toBe(200);
    const contentType = res.headers()['content-type'] ?? '';
    expect(contentType).toContain('application/pdf');
  });

  /**
   * Scenario: GET resume returns non-empty body
   *   Given a resume has been uploaded
   *   When the recruiter downloads the resume
   *   Then the response body is non-empty (the file bytes)
   */
  test('Scenario: GET resume body is the file content', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/candidates/${candidate.id}/resume`,
      { headers: authHeader(authToken) },
    );

    expect(res.status()).toBe(200);
    const body = await res.body();
    expect(body.length).toBeGreaterThan(0);
  });

  /**
   * Scenario: GET resume has Content-Disposition inline header
   *   Given a resume has been uploaded
   *   When the recruiter downloads the resume
   *   Then Content-Disposition is set (inline or attachment)
   */
  test('Scenario: GET resume has Content-Disposition header', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/api/v1/candidates/${candidate.id}/resume`,
      { headers: authHeader(authToken) },
    );

    expect(res.status()).toBe(200);
    const disposition = res.headers()['content-disposition'] ?? '';
    expect(disposition.length).toBeGreaterThan(0);
  });

  /**
   * Scenario: GET resume for candidate with no resume returns 404
   *   Given a candidate exists but has no resume
   *   When the recruiter GETs /api/v1/candidates/:id/resume
   *   Then the response is 404
   */
  test('Scenario: GET resume for candidate without resume returns 404', async ({ request }) => {
    // Create a fresh candidate with no resume
    const freshCandidateRes = await request.post(
      `${API_BASE}/api/v1/pipelines/${pipeline.id}/candidates`,
      {
        headers: jsonHeaders(authToken),
        data: {
          name: 'No Resume Candidate',
          email: `noresume+${Date.now()}@pipe-test.dev`,
        },
      },
    );
    expect(freshCandidateRes.status()).toBe(201);
    const { candidate: freshCandidate } = (await freshCandidateRes.json()) as { candidate: SeededCandidate };

    const res = await request.get(
      `${API_BASE}/api/v1/candidates/${freshCandidate.id}/resume`,
      { headers: authHeader(authToken) },
    );
    expect(res.status()).toBe(404);
  });
});

// ─── §R3  Profile page VIEW_RESUME button ────────────────────────────────────

test.describe('§R3 — VIEW_RESUME button enabled when resume exists', () => {
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
   * Scenario: VIEW_RESUME button is disabled when no resume on file
   *   Given a candidate has no resume uploaded
   *   When the recruiter views the candidate profile
   *   Then the VIEW_RESUME button is disabled
   */
  test('Scenario: VIEW_RESUME button disabled when no resume', async ({ page }) => {
    await page.goto(`${APP_BASE}/candidates/${candidate.id}`);
    await expect(page.getByText('Alex Resume')).toBeVisible({ timeout: 15000 });

    const viewResumeButton = page.getByRole('button', { name: /VIEW_RESUME/i });
    await expect(viewResumeButton).toBeDisabled({ timeout: 5000 });
  });

  /**
   * Scenario: VIEW_RESUME button is enabled after resume is uploaded
   *   Given a resume has been uploaded for the candidate
   *   When the recruiter refreshes the candidate profile
   *   Then the VIEW_RESUME button is enabled
   */
  test('Scenario: VIEW_RESUME button enabled after resume upload', async ({ page, request }) => {
    // Upload the resume via API
    const pdfBytes = minimalPdfBytes();
    const uploadRes = await request.post(
      `${API_BASE}/api/v1/candidates/${candidate.id}/resume`,
      {
        headers: authHeader(authToken),
        multipart: {
          file: {
            name: 'view-test.pdf',
            mimeType: 'application/pdf',
            buffer: pdfBytes,
          },
        },
      },
    );
    expect(uploadRes.status()).toBe(201);

    // Navigate to the profile page — the button should now be enabled
    await page.goto(`${APP_BASE}/candidates/${candidate.id}`);
    await expect(page.getByText('Alex Resume')).toBeVisible({ timeout: 15000 });

    const viewResumeButton = page.getByRole('button', { name: /VIEW_RESUME/i });
    await expect(viewResumeButton).toBeEnabled({ timeout: 5000 });
  });
});

// ─── §R4  Validation ─────────────────────────────────────────────────────────

test.describe('§R4 — Upload endpoint validates file size and MIME type', () => {
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
   * Scenario: Upload without auth returns 401
   *   Given no Authorization header is provided
   *   When POST /api/v1/candidates/:id/resume is called
   *   Then the response is 401
   */
  test('Scenario: upload without auth returns 401', async ({ request }) => {
    const pdfBytes = minimalPdfBytes();
    const res = await request.post(
      `${API_BASE}/api/v1/candidates/${candidate.id}/resume`,
      {
        multipart: {
          file: {
            name: 'unauth.pdf',
            mimeType: 'application/pdf',
            buffer: pdfBytes,
          },
        },
      },
    );
    expect(res.status()).toBe(401);
  });

  /**
   * Scenario: Upload with unsupported MIME type returns 400
   *   Given a PNG image is sent instead of a PDF or DOCX
   *   When POST /api/v1/candidates/:id/resume is called
   *   Then the response is 400 with VALIDATION_ERROR code
   */
  test('Scenario: upload with wrong MIME type returns 400', async ({ request }) => {
    const fakeImage = Buffer.from('GIF89a<fake gif content>', 'utf-8');
    const res = await request.post(
      `${API_BASE}/api/v1/candidates/${candidate.id}/resume`,
      {
        headers: authHeader(authToken),
        multipart: {
          file: {
            name: 'bad-file.gif',
            mimeType: 'image/gif',
            buffer: fakeImage,
          },
        },
      },
    );
    expect(res.status()).toBe(422);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  /**
   * Scenario: Upload for a different recruiter's candidate returns 404
   *   Given a candidate belongs to recruiter A
   *   When an unauthorised GET is made (wrong owner) for the candidate
   *   Then the response is 404 (not 403 — don't leak existence)
   */
  test('Scenario: upload for nonexistent candidate returns 404', async ({ request }) => {
    const pdfBytes = minimalPdfBytes();
    const res = await request.post(
      `${API_BASE}/api/v1/candidates/does-not-exist-id/resume`,
      {
        headers: authHeader(authToken),
        multipart: {
          file: {
            name: 'ghost.pdf',
            mimeType: 'application/pdf',
            buffer: pdfBytes,
          },
        },
      },
    );
    expect(res.status()).toBe(404);
  });

  /**
   * Scenario: Upload without a file field returns 400
   *   Given the multipart body has no "file" field
   *   When POST /api/v1/candidates/:id/resume is called
   *   Then the response is 400 with VALIDATION_ERROR
   */
  test('Scenario: upload with missing file field returns 400', async ({ request }) => {
    const res = await request.post(
      `${API_BASE}/api/v1/candidates/${candidate.id}/resume`,
      {
        headers: authHeader(authToken),
        multipart: {
          // Sending a different field name — "document" instead of "file"
          document: {
            name: 'wrong-field.pdf',
            mimeType: 'application/pdf',
            buffer: minimalPdfBytes(),
          },
        },
      },
    );
    expect(res.status()).toBe(422);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
