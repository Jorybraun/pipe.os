import { expect, test, type Page } from '@playwright/test';

const TOKEN_A_URL = (process.env.ASSESS_TOKEN_A_URL ?? '').trim();
const TOKEN_B_URL = (process.env.ASSESS_TOKEN_B_URL ?? '').trim();
const EXPECTED_A_CANDIDATE_ID = (process.env.ASSESS_TOKEN_A_CANDIDATE_ID ?? '').trim();
const EXPECTED_B_CANDIDATE_ID = (process.env.ASSESS_TOKEN_B_CANDIDATE_ID ?? '').trim();
const EXPECTED_A_CANDIDATE_NAME = (process.env.ASSESS_TOKEN_A_CANDIDATE_NAME ?? '').trim();
const EXPECTED_B_CANDIDATE_NAME = (process.env.ASSESS_TOKEN_B_CANDIDATE_NAME ?? '').trim();

function inviteTokenFromAssessUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const match = url.pathname.match(/\/assess\/([^/?#]+)/);
  if (!match?.[1]) throw new Error(`Expected /assess/:token URL, got ${rawUrl}`);
  return decodeURIComponent(match[1]);
}

async function expectNoCandidateBlockingState(page: Page): Promise<void> {
  await expect(page.locator('body')).not.toContainText('This one-use assessment link has already started');
  await expect(page.locator('body')).not.toContainText('This invite link has already been used');
  await expect(page.locator('body')).not.toContainText('Building your personalized challenge');
  await expect(page.locator('body')).not.toContainText('MATCHING IN PROGRESS');
  await expect(page.locator('body')).not.toContainText('WAITING_FOR_MATCH');
}

async function expectStoredCandidate(
  page: Page,
  expected: { inviteToken: string; candidateId: string; candidateName: string; status?: string },
): Promise<void> {
  await expect.poll(
    async () => page.evaluate(() => ({
      inviteToken: window.sessionStorage.getItem('pipe_session_invite_token'),
      candidateId: (JSON.parse(window.sessionStorage.getItem('pipe_session_candidate') ?? '{}') as { id?: string }).id,
      candidateName: (JSON.parse(window.sessionStorage.getItem('pipe_session_candidate') ?? '{}') as { name?: string | null }).name,
      candidateStatus: (JSON.parse(window.sessionStorage.getItem('pipe_session_candidate') ?? '{}') as { status?: string | null }).status,
      hasSessionToken: Boolean(window.sessionStorage.getItem('pipe_session_token')),
    })),
    { message: `sessionStorage should belong to ${expected.candidateName}` },
  ).toEqual({
    inviteToken: expected.inviteToken,
    candidateId: expected.candidateId,
    candidateName: expected.candidateName,
    candidateStatus: expected.status ?? 'INVITED',
    hasSessionToken: true,
  });
}

test.describe('deployed /assess token lifecycle isolation', () => {
  test.skip(
    !TOKEN_A_URL || !TOKEN_B_URL || !EXPECTED_A_CANDIDATE_ID || !EXPECTED_B_CANDIDATE_ID,
    'Set ASSESS_TOKEN_A_URL, ASSESS_TOKEN_B_URL, and expected candidate ids.',
  );

  test('opens token B after token A in the same browser without leaking the stale pre-start session', async ({ page }) => {
    test.setTimeout(90_000);

    const tokenA = inviteTokenFromAssessUrl(TOKEN_A_URL);
    const tokenB = inviteTokenFromAssessUrl(TOKEN_B_URL);
    const resolveCalls: string[] = [];

    await page.route('**/rpc/resolve-token', async (route) => {
      const body = route.request().postDataJSON() as { inviteToken?: string };
      resolveCalls.push(String(body.inviteToken ?? ''));
      await route.continue();
    });

    await page.goto(TOKEN_A_URL);
    await expect(page.getByTestId('start-interview-btn')).toBeVisible({ timeout: 45_000 });
    await expectNoCandidateBlockingState(page);
    await expectStoredCandidate(page, {
      inviteToken: tokenA,
      candidateId: EXPECTED_A_CANDIDATE_ID,
      candidateName: EXPECTED_A_CANDIDATE_NAME,
    });

    await page.goto(TOKEN_B_URL);
    await expect(page.getByTestId('start-interview-btn')).toBeVisible({ timeout: 45_000 });
    await expectNoCandidateBlockingState(page);
    await expectStoredCandidate(page, {
      inviteToken: tokenB,
      candidateId: EXPECTED_B_CANDIDATE_ID,
      candidateName: EXPECTED_B_CANDIDATE_NAME,
    });

    expect(resolveCalls).toContain(tokenA);
    expect(resolveCalls).toContain(tokenB);
    expect(resolveCalls.at(-1)).toBe(tokenB);

    await expect(page.getByTestId('start-interview-btn')).toBeVisible();
    await expectNoCandidateBlockingState(page);
    await expectStoredCandidate(page, {
      inviteToken: tokenB,
      candidateId: EXPECTED_B_CANDIDATE_ID,
      candidateName: EXPECTED_B_CANDIDATE_NAME,
    });
  });
});
