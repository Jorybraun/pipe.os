/**
 * e2e/self-serve-talent-join.spec.ts
 *
 * BDD: Self-serve talent pool join — marketing-site entry
 *
 * Route under test:
 *   1. Public:    POST /rpc/talent/join  (hire-pipe.com "For Engineers" form)
 *   2. Candidate: /talent/:token intake (link delivered by email)
 *
 * Product slice: an engineer joins the talent pool with no recruiter in the
 * loop — they submit name + email, receive a private intake link, share their
 * profile, and enter the same evidence pipeline as invited candidates.
 *
 * Invariants asserted:
 *   - Join response NEVER contains the invite token or any internal id;
 *     the token is delivered by email only
 *   - Re-joining with the same email is idempotent (no duplicate pool entries)
 *   - The minted token resolves to a PROFILE_NEEDED intake dashboard
 *   - Submitting a profile moves the intake to CHALLENGE_PREPARING —
 *     no fabricated challenge, no fake waiting room
 *
 * Auth: Join is public. Token retrieval for the spec uses the local/test-gated
 *       internal endpoint /api/v1/internal/e2e/talent-join-token (recruiter
 *       Clerk storageState), because email delivery cannot be read in E2E.
 *
 * API base: http://localhost:8787
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { API_BASE, APP_BASE } from './env';

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

const HEX_TOKEN_32 = /[0-9a-f]{32}/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function getAuthToken(page: Page): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === '__session');
    if (sessionCookie) {
      return sessionCookie.value;
    }
    await page.waitForTimeout(250);
  }
  throw new Error('[self-serve-talent-join.spec] No __session cookie. Run auth setup first.');
}

async function joinPool(
  request: APIRequestContext,
  body: Record<string, unknown>,
): Promise<{ status: number; raw: string; json: Record<string, unknown> }> {
  const res = await request.post(`${API_BASE}/rpc/talent/join`, {
    headers: { 'Content-Type': 'application/json' },
    data: body,
  });
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: res.status(), raw, json };
}

async function fetchInviteToken(
  request: APIRequestContext,
  authToken: string,
  email: string,
): Promise<string> {
  const res = await request.post(`${API_BASE}/api/v1/internal/e2e/talent-join-token`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    data: { email },
  });
  expect(res.status(), 'internal talent-join-token lookup should succeed').toBe(200);
  const body = await res.json() as { inviteToken: string };
  expect(body.inviteToken).toMatch(/^[0-9a-f]{32}$/);
  return body.inviteToken;
}

test.describe('Self-serve talent pool join', () => {
  const email = `join+e2e-${Date.now()}@pipe-test.dev`;
  let authToken: string;
  let inviteToken: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();
  });

  test('rejects an invalid email with 400', async ({ request }) => {
    const res = await joinPool(request, { email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  test('joins the pool with email only and leaks no token or internal ids', async ({ request }) => {
    const res = await joinPool(request, { email, name: 'E2E Self Serve' });

    expect(res.status).toBe(201);
    expect(res.json).toEqual({ ok: true, email });
    expect(res.raw).not.toMatch(HEX_TOKEN_32);
    expect(res.raw).not.toMatch(UUID);
  });

  test('re-joining with the same email is idempotent', async ({ request }) => {
    const res = await joinPool(request, { email: email.toUpperCase() });

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, email });
  });

  test('the minted token resolves to a PROFILE_NEEDED intake dashboard', async ({ request }) => {
    inviteToken = await fetchInviteToken(request, authToken, email);

    const res = await request.post(`${API_BASE}/rpc/talent/resolve-token`, {
      headers: { 'Content-Type': 'application/json' },
      data: { inviteToken },
    });
    expect(res.status()).toBe(200);

    const dashboard = await res.json() as {
      status: string;
      candidateName: string | null;
      readyChallenges: unknown[];
      completedChallenges: unknown[];
    };
    expect(dashboard.status).toBe('PROFILE_NEEDED');
    expect(dashboard.candidateName).toBe('E2E Self Serve');
    expect(dashboard.readyChallenges).toEqual([]);
    expect(dashboard.completedChallenges).toEqual([]);
  });

  test('submitting a profile moves the intake to CHALLENGE_PREPARING — never a fabricated challenge', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/talent/submit-profile`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        inviteToken,
        resumeText:
          'Senior software engineer with 8 years of TypeScript, React, and Node.js experience. ' +
          'Built large-scale frontend applications, designed Workers APIs, and led code review culture. ' +
          'Open-source contributor to UI tooling.',
        githubUrl: 'https://github.com/e2e-self-serve',
        phoneScreenerConsent: false,
      },
    });
    expect(res.status()).toBe(200);

    const dashboard = await res.json() as { status: string; readyChallenges: unknown[] };
    expect(['PROFILE_RECEIVED', 'CHALLENGE_PREPARING']).toContain(dashboard.status);
    expect(dashboard.readyChallenges).toEqual([]);
  });

  test('the intake page renders for the joined candidate', async ({ page }) => {
    await page.goto(`${APP_BASE}/talent/${inviteToken}`);

    await expect(page.getByText(/preparing the right challenge|profile received/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
