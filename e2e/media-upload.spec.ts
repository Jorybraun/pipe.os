/**
 * e2e/media-upload.spec.ts
 *
 * BDD: Candidate Media Upload — voice/video blobs directly to R2 via Worker
 *
 * Tests the POST /rpc/upload-media endpoint that replaces the Amplify
 * POST /rpc/upload-media — stores audio/video in R2, returns r2Key.
 *
 * Feature sections
 * ────────────────
 *   §M1  Upload endpoint — accepts audio/video blobs, returns r2Key
 *   §M2  Validation — rejects non-media MIME types, missing fields, oversized files
 *   §M3  Auth — requires candidate JWT; rejects missing/invalid tokens
 *
 * Auth: Tests seed a candidate via recruiter API, resolve the invite token
 *       to obtain a candidate JWT, then call /rpc/upload-media.
 *
 * API base: http://localhost:8787
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// ─── Constants ──────────────────────────────────────────────────────────────

const API_BASE = 'http://localhost:8787';

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

interface ResolveTokenResponse {
  id: string;
  pipelineId: string;
  status: string;
  sessionToken: string;
}

interface MediaUploadResponse {
  r2Key: string;
  uploadUrl: null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) {
    throw new Error('[media-upload.spec] No __session cookie. Run auth setup first.');
  }
  return sessionCookie.value;
}

function recruiterHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

/** Seed a minimal pipeline + candidate; returns pipeline ID, candidate, and invite token. */
async function seedCandidateWithPipeline(
  request: APIRequestContext,
  authToken: string,
): Promise<{ pipeline: SeededPipeline; candidate: SeededCandidate }> {
  const headers = recruiterHeaders(authToken);

  const pipelineRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers,
    data: { title: 'Media Upload E2E Pipeline', status: 'ACTIVE', level: 'Mid' },
  });
  expect(pipelineRes.status()).toBe(201);
  const { pipeline } = (await pipelineRes.json()) as { pipeline: SeededPipeline };

  const candidateRes = await request.post(
    `${API_BASE}/api/v1/pipelines/${pipeline.id}/candidates`,
    {
      headers,
      data: {
        name: 'Media Candidate',
        email: `media+${Date.now()}@pipe-test.dev`,
      },
    },
  );
  expect(candidateRes.status()).toBe(201);
  const { candidate } = (await candidateRes.json()) as { candidate: SeededCandidate };

  return { pipeline, candidate };
}

/** Resolve an invite token to obtain a candidate session JWT. */
async function resolveCandidateToken(
  request: APIRequestContext,
  inviteToken: string,
): Promise<ResolveTokenResponse> {
  const res = await request.post(`${API_BASE}/rpc/resolve-token`, {
    data: { inviteToken },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(200);
  return res.json() as Promise<ResolveTokenResponse>;
}

/** Create a minimal valid WebM blob (synthesized bytes — not a real video). */
function makeAudioBlob(sizeBytes = 1024): Buffer {
  // WebM starts with the EBML header signature: 0x1A 0x45 0xDF 0xA3
  const buf = Buffer.alloc(sizeBytes, 0x00);
  buf[0] = 0x1a;
  buf[1] = 0x45;
  buf[2] = 0xdf;
  buf[3] = 0xa3;
  return buf;
}

/** POST multipart/form-data to /rpc/upload-media with candidate JWT. */
async function uploadMedia(
  request: APIRequestContext,
  sessionToken: string,
  file: Buffer,
  mimeType: string,
  challengeId: string,
  filename = 'response.webm',
): ReturnType<APIRequestContext['post']> {
  return request.post(`${API_BASE}/rpc/upload-media`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
    multipart: {
      file: {
        name: filename,
        mimeType,
        buffer: file,
      },
      challengeId,
    },
  });
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

// ─── §M1  Upload endpoint ────────────────────────────────────────────────────

test.describe('§M1 — Media upload stores audio/video in R2 and returns r2Key', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let candidate: SeededCandidate;
  let sessionToken: string;
  const fakeChallengeId = crypto.randomUUID();

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await ctx.newPage();
    await page.goto('http://localhost:5173');
    authToken = await getAuthToken(page);
    await ctx.close();

    ({ pipeline, candidate } = await seedCandidateWithPipeline(request, authToken));

    const resolved = await resolveCandidateToken(request, candidate.inviteToken);
    sessionToken = resolved.sessionToken;
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  test('POST /rpc/upload-media returns 201 with r2Key for audio/webm', async ({ request }) => {
    const res = await uploadMedia(
      request,
      sessionToken,
      makeAudioBlob(),
      'audio/webm',
      fakeChallengeId,
    );
    expect(res.status()).toBe(201);
    const body = (await res.json()) as MediaUploadResponse;
    expect(typeof body.r2Key).toBe('string');
    expect(body.r2Key.length).toBeGreaterThan(0);
    expect(body.uploadUrl).toBeNull();
  });

  test('r2Key follows the candidate-submissions/{candidateId}/{challengeId}.webm pattern', async ({
    request,
  }) => {
    const cid = fakeChallengeId;
    const res = await uploadMedia(request, sessionToken, makeAudioBlob(), 'audio/webm', cid);
    expect(res.status()).toBe(201);
    const body = (await res.json()) as MediaUploadResponse;
    // Key must contain the challengeId in the path
    expect(body.r2Key).toContain(cid);
    expect(body.r2Key).toMatch(/^candidate-submissions\//);
  });

  test('POST /rpc/upload-media returns 201 for video/webm', async ({ request }) => {
    const res = await uploadMedia(
      request,
      sessionToken,
      makeAudioBlob(2048),
      'video/webm',
      fakeChallengeId,
      'response-video.webm',
    );
    expect(res.status()).toBe(201);
    const body = (await res.json()) as MediaUploadResponse;
    expect(typeof body.r2Key).toBe('string');
  });

  test('subsequent uploads for the same challengeId overwrite (idempotent key)', async ({
    request,
  }) => {
    const cid = fakeChallengeId;
    const res1 = await uploadMedia(request, sessionToken, makeAudioBlob(), 'audio/webm', cid);
    const res2 = await uploadMedia(request, sessionToken, makeAudioBlob(), 'audio/webm', cid);
    expect(res1.status()).toBe(201);
    expect(res2.status()).toBe(201);
    const b1 = (await res1.json()) as MediaUploadResponse;
    const b2 = (await res2.json()) as MediaUploadResponse;
    // Same key — R2 PUT is idempotent
    expect(b1.r2Key).toBe(b2.r2Key);
  });
});

// ─── §M2  Validation ────────────────────────────────────────────────────────

test.describe('§M2 — Validation rejects invalid input', () => {
  let authToken: string;
  let pipeline: SeededPipeline;
  let candidate: SeededCandidate;
  let sessionToken: string;
  const fakeChallengeId = crypto.randomUUID();

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await ctx.newPage();
    await page.goto('http://localhost:5173');
    authToken = await getAuthToken(page);
    await ctx.close();

    ({ pipeline, candidate } = await seedCandidateWithPipeline(request, authToken));
    const resolved = await resolveCandidateToken(request, candidate.inviteToken);
    sessionToken = resolved.sessionToken;
  });

  test.afterAll(async ({ request }) => {
    await teardownPipeline(request, authToken, pipeline.id);
  });

  test('rejects application/pdf MIME type with 415', async ({ request }) => {
    const res = await uploadMedia(
      request,
      sessionToken,
      Buffer.from('%PDF-1.4'),
      'application/pdf',
      fakeChallengeId,
    );
    expect(res.status()).toBe(415);
  });

  test('rejects image/png MIME type with 415', async ({ request }) => {
    const res = await uploadMedia(
      request,
      sessionToken,
      Buffer.from('\x89PNG'),
      'image/png',
      fakeChallengeId,
    );
    expect(res.status()).toBe(415);
  });

  test('rejects missing challengeId field with 400', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/upload-media`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
      multipart: {
        file: {
          name: 'response.webm',
          mimeType: 'audio/webm',
          buffer: makeAudioBlob(),
        },
        // challengeId omitted intentionally
      },
    });
    expect(res.status()).toBe(400);
  });

  test('rejects missing file field with 400', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/upload-media`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
      multipart: {
        challengeId: fakeChallengeId,
        // file omitted intentionally
      },
    });
    expect(res.status()).toBe(400);
  });
});

// ─── §M3  Auth ───────────────────────────────────────────────────────────────

test.describe('§M3 — Auth enforcement', () => {
  const fakeChallengeId = crypto.randomUUID();

  test('returns 401 when Authorization header is absent', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/upload-media`, {
      multipart: {
        file: {
          name: 'response.webm',
          mimeType: 'audio/webm',
          buffer: makeAudioBlob(),
        },
        challengeId: fakeChallengeId,
      },
    });
    expect(res.status()).toBe(401);
  });

  test('returns 401 when session token is invalid', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/upload-media`, {
      headers: { Authorization: 'Bearer not.a.valid.jwt' },
      multipart: {
        file: {
          name: 'response.webm',
          mimeType: 'audio/webm',
          buffer: makeAudioBlob(),
        },
        challengeId: fakeChallengeId,
      },
    });
    expect(res.status()).toBe(401);
  });

  test('returns 401 when using a recruiter Clerk JWT instead of candidate session token', async ({
    page,
    request,
  }) => {
    await page.goto('http://localhost:5173');
    const recruiterToken = await getAuthToken(page);

    const res = await request.post(`${API_BASE}/rpc/upload-media`, {
      headers: { Authorization: `Bearer ${recruiterToken}` },
      multipart: {
        file: {
          name: 'response.webm',
          mimeType: 'audio/webm',
          buffer: makeAudioBlob(),
        },
        challengeId: fakeChallengeId,
      },
    });
    // Clerk JWTs are not valid candidate session tokens
    expect(res.status()).toBe(401);
  });
});
