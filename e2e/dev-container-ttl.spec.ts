/**
 * e2e/dev-container-ttl.spec.ts
 *
 * BDD: Dev Container — TTL warn-then-expire (ADR-037, Phase 3b Step 16)
 *
 * Exercises the DO's warn-then-expire alarm chain end-to-end against a
 * running worker. Launches a session with an admin-forced 30s TTL, waits
 * for the `onWarn` callback to stamp `warned_at` in D1, then waits for
 * the `onExpire` callback to flip the row to EXPIRED. Finally reads the
 * recruiter cockpit and verifies the session is visible as EXPIRED
 * (distinct from the manual STOPPED case in the happy spec).
 *
 * Skipped unless `PIPE_ADMIN_TTL_OVERRIDE_SECRET` is set in the env —
 * that's the shared secret the launch route requires to honor the
 * per-launch override. Point it at whatever value `wrangler dev` has
 * loaded for `ADMIN_TTL_OVERRIDE_SECRET`.
 *
 * Required env on the worker side for this test to be meaningful:
 *   DEV_CONTAINER_WARN_BEFORE_SECONDS  — should be ~10 (lower than 30s TTL)
 *   ADMIN_TTL_OVERRIDE_SECRET          — any non-empty value
 *
 * Wall clock: ~35s (30s TTL + up to 5s of poll slack).
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:8787';
const APP_BASE = 'http://localhost:5173';

const ADMIN_SECRET = process.env['PIPE_ADMIN_TTL_OVERRIDE_SECRET'] ?? '';
const FORCED_TTL_SECONDS = 30;

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
interface CockpitSessionResponse {
  session: {
    sessionId: string;
    status: string;
    ttlSource: string;
    warnedAt: string | null;
    stoppedAt: string | null;
  };
}

async function getRecruiterToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === '__session');
  if (!sessionCookie) {
    throw new Error('[dev-container-ttl] No __session cookie. Run auth setup first.');
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
    data: { title: 'Dev Container TTL', status: 'ACTIVE', level: 'Senior' },
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
        name: 'TTL Expiry Candidate',
        email: `ttl+${Date.now()}@pipe-test.dev`,
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
  return ((await res.json()) as ResolveTokenResponse).sessionToken;
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
    } else if (res.status() === 404) {
      // EXPIRED sessions that hit cleanup may transiently 404; keep polling.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `[dev-container-ttl] pollStatus timed out after ${timeoutMs}ms. Last: ${JSON.stringify(last)}`,
  );
}

test.describe('Dev container — TTL warn-then-expire (ADR-037 Step 16)', () => {
  test.skip(
    ADMIN_SECRET === '',
    'Set PIPE_ADMIN_TTL_OVERRIDE_SECRET to match the worker ADMIN_TTL_OVERRIDE_SECRET to run this spec.',
  );

  // This test intentionally waits on real alarm callbacks.
  test.setTimeout(90_000);

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

  test('forced 30s TTL → onWarn stamps warned_at → onExpire marks EXPIRED', async ({ request }) => {
    // 1. Launch with an admin-forced 30s TTL. Requires both the header
    //    secret AND a numeric ttlSecondsOverride in the body.
    const launchRes = await request.post(`${API_BASE}/rpc/dev-container/launch`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${candidateToken}`,
        'X-Pipe-Admin-Override': ADMIN_SECRET,
      },
      data: { ttlSecondsOverride: FORCED_TTL_SECONDS },
    });
    expect(launchRes.status()).toBe(201);
    const launch = (await launchRes.json()) as LaunchResponseBody;
    expect(launch.ttlSource).toBe('OVERRIDE');
    expect(launch.ttlSeconds).toBe(FORCED_TTL_SECONDS);

    // 2. Reach READY quickly (handleInit flips the row before the first alarm).
    await pollStatus(
      request,
      launch.sessionId,
      candidateToken,
      (s) => s.status === 'READY',
      10_000,
    );

    // 3. Wait for onWarn. With WARN_BEFORE_SECONDS ≤ 20 and TTL = 30s, the
    //    warn fires within ~25s of launch. Allow generous slack.
    const warned = await pollStatus(
      request,
      launch.sessionId,
      candidateToken,
      (s) => s.expiringSoon === true && s.warnedAt !== null,
      35_000,
    );
    expect(warned.status).toBe('READY');
    expect(new Date(warned.warnedAt!).getTime()).toBeLessThanOrEqual(
      new Date(warned.expiresAt).getTime(),
    );

    // 4. Wait for onExpire. Must reach EXPIRED (not STOPPED) so the cockpit
    //    can distinguish timed-out sessions from candidate-initiated teardowns.
    const expired = await pollStatus(
      request,
      launch.sessionId,
      candidateToken,
      (s) => s.status === 'EXPIRED',
      20_000,
    );
    expect(expired.status).toBe('EXPIRED');

    // 5. Recruiter cockpit sees EXPIRED with warned_at populated.
    const cockpitRes = await request.get(
      `${API_BASE}/api/v1/dev-container-sessions/${launch.sessionId}`,
      { headers: { Authorization: `Bearer ${recruiterToken}` } },
    );
    expect(cockpitRes.status()).toBe(200);
    const { session } = (await cockpitRes.json()) as CockpitSessionResponse;
    expect(session.status).toBe('EXPIRED');
    expect(session.ttlSource).toBe('OVERRIDE');
    expect(session.warnedAt).toBeTruthy();
    expect(session.stoppedAt).toBeTruthy();
  });
});
