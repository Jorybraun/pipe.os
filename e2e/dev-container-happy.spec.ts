/**
 * e2e/dev-container-happy.spec.ts
 *
 * BDD: Dev Container — Happy Path (ADR-037, Phase 3b Step 16)
 *
 * Candidate opens an invite, launches a dev container, sees the D1 row
 * reach READY, then manually destroys it. The test then reads the
 * cockpit route as the recruiter and verifies the session shows
 * `status=STOPPED`.
 *
 * This test runs against `wrangler dev` + the frontend dev server. It
 * does NOT require Docker — `handleInit` flips the D1 row to READY
 * before any container actually boots, so the REST flow is exercisable
 * end-to-end on a laptop without running a code-server image.
 *
 * Required env on the worker side:
 *   (none — default TTL of 3600s is fine for the happy path)
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:8787';
const APP_BASE = 'http://localhost:5173';

interface SeededPipeline {
  id: string;
}
interface SeededStage {
  id: string;
}
interface SeededCandidate {
  id: string;
  inviteToken: string;
}
interface ResolveTokenResponse {
  sessionToken: string;
}
interface LaunchResponseBody {
  sessionId: string;
  status: 'LAUNCHING';
  ttlSeconds: number;
  ttlSource: 'GLOBAL' | 'CHALLENGE' | 'OVERRIDE';
  expiresAt: string;
}
interface StatusResponseBody {
  sessionId: string;
  status: 'LAUNCHING' | 'READY' | 'SLEEPING' | 'ERROR' | 'STOPPED' | 'EXPIRED';
  ttlSeconds: number;
  ttlSource: 'GLOBAL' | 'CHALLENGE' | 'OVERRIDE';
  expiresAt: string;
  warnedAt: string | null;
  url: string | null;
  expiringSoon: boolean;
}
interface CockpitListResponse {
  sessions: Array<{
    sessionId: string;
    status: string;
    ttlSource: string;
    stoppedAt: string | null;
  }>;
}

async function getRecruiterToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) {
    throw new Error('[dev-container-happy] No __session cookie. Run auth setup first.');
  }
  return sessionCookie.value;
}

async function seedPipelineWithCandidate(
  request: APIRequestContext,
  recruiterToken: string,
): Promise<{ pipeline: SeededPipeline; candidate: SeededCandidate }> {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${recruiterToken}`,
  };
  const pRes = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers,
    data: { title: 'Dev Container Happy', status: 'ACTIVE', level: 'Senior' },
  });
  expect(pRes.status()).toBe(201);
  const { pipeline } = (await pRes.json()) as { pipeline: SeededPipeline };

  const sRes = await request.post(`${API_BASE}/api/v1/pipelines/${pipeline.id}/stages`, {
    headers,
    data: { title: 'Take-home', order: 0 },
  });
  expect(sRes.status()).toBe(201);
  const { stage } = (await sRes.json()) as { stage: SeededStage };

  const cRes = await request.post(
    `${API_BASE}/api/v1/pipelines/${pipeline.id}/candidates`,
    {
      headers,
      data: {
        name: 'Happy Path Candidate',
        email: `happy+${Date.now()}@pipe-test.dev`,
        currentStageId: stage.id,
      },
    },
  );
  expect(cRes.status()).toBe(201);
  const { candidate } = (await cRes.json()) as { candidate: SeededCandidate };

  return { pipeline, candidate };
}

async function resolveCandidateSession(
  request: APIRequestContext,
  inviteToken: string,
): Promise<string> {
  const res = await request.post(`${API_BASE}/rpc/resolve-token`, {
    headers: { 'Content-Type': 'application/json' },
    data: { inviteToken },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as ResolveTokenResponse;
  return body.sessionToken;
}

async function pollStatus(
  request: APIRequestContext,
  sessionId: string,
  candidateToken: string,
  predicate: (body: StatusResponseBody) => boolean,
  timeoutMs: number,
): Promise<StatusResponseBody> {
  const deadline = Date.now() + timeoutMs;
  let last: StatusResponseBody | null = null;
  while (Date.now() < deadline) {
    const res = await request.get(
      `${API_BASE}/rpc/dev-container/${sessionId}/status`,
      { headers: { Authorization: `Bearer ${candidateToken}` } },
    );
    if (res.status() === 200) {
      last = (await res.json()) as StatusResponseBody;
      if (predicate(last)) return last;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `[dev-container-happy] pollStatus timed out after ${timeoutMs}ms. Last: ${JSON.stringify(last)}`,
  );
}

test.describe('Dev container — happy path (ADR-037 Step 16)', () => {
  let recruiterToken: string;
  let pipeline: SeededPipeline;
  let candidate: SeededCandidate;
  let candidateToken: string;

  test.beforeAll(async ({ browser, request }) => {
    const ctx = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await ctx.newPage();
    await page.goto(APP_BASE);
    recruiterToken = await getRecruiterToken(page);
    await ctx.close();

    const seed = await seedPipelineWithCandidate(request, recruiterToken);
    pipeline = seed.pipeline;
    candidate = seed.candidate;
    candidateToken = await resolveCandidateSession(request, candidate.inviteToken);
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${API_BASE}/api/v1/pipelines/${pipeline.id}`, {
      headers: { Authorization: `Bearer ${recruiterToken}` },
    });
  });

  test('launch → READY → destroy → STOPPED visible in cockpit', async ({ request }) => {
    // 1. Launch.
    const launchRes = await request.post(`${API_BASE}/rpc/dev-container/launch`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${candidateToken}`,
      },
      data: {},
    });
    expect(launchRes.status()).toBe(201);
    const launch = (await launchRes.json()) as LaunchResponseBody;
    expect(launch.sessionId).toBeTruthy();
    expect(launch.ttlSource).toBe('GLOBAL');
    expect(launch.ttlSeconds).toBeGreaterThanOrEqual(30);
    expect(new Date(launch.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // 2. Poll until the DO's /__init flips the row to READY.
    const ready = await pollStatus(
      request,
      launch.sessionId,
      candidateToken,
      (s) => s.status === 'READY' || s.status === 'SLEEPING',
      10_000,
    );
    expect(ready.expiresAt).toBe(launch.expiresAt);
    expect(ready.expiringSoon).toBe(false);
    expect(ready.warnedAt).toBeNull();

    // 3. Candidate clicks Destroy.
    const destroyRes = await request.post(
      `${API_BASE}/rpc/dev-container/${launch.sessionId}/destroy`,
      { headers: { Authorization: `Bearer ${candidateToken}` } },
    );
    expect(destroyRes.status()).toBe(200);
    const destroy = (await destroyRes.json()) as { sessionId: string; status: string };
    expect(destroy.status).toBe('STOPPED');

    // 4. Idempotent — calling destroy twice is safe.
    const destroyAgain = await request.post(
      `${API_BASE}/rpc/dev-container/${launch.sessionId}/destroy`,
      { headers: { Authorization: `Bearer ${candidateToken}` } },
    );
    expect(destroyAgain.status()).toBe(200);

    // 5. Recruiter cockpit sees STOPPED (not EXPIRED).
    const cockpitRes = await request.get(
      `${API_BASE}/api/v1/pipelines/${pipeline.id}/dev-container-sessions`,
      { headers: { Authorization: `Bearer ${recruiterToken}` } },
    );
    expect(cockpitRes.status()).toBe(200);
    const body = (await cockpitRes.json()) as CockpitListResponse;
    const row = body.sessions.find((s) => s.sessionId === launch.sessionId);
    expect(row).toBeTruthy();
    expect(row?.status).toBe('STOPPED');
    expect(row?.ttlSource).toBe('GLOBAL');
    expect(row?.stoppedAt).toBeTruthy();
  });
});
