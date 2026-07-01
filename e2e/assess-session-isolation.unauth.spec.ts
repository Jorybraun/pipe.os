import { expect, test } from '@playwright/test';

test.describe('CODE_REVIEW assess session isolation', () => {
  test('resolves the URL invite when a stale candidate session exists in the same browser', async ({ page }) => {
    const resolveCalls: string[] = [];
    const stageAuthHeaders: string[] = [];
    const challengeCalls: string[] = [];

    await page.addInitScript(() => {
      window.sessionStorage.setItem('pipe_session_token', 'session-token-a');
      window.sessionStorage.setItem('pipe_session_invite_token', 'invite-token-a');
      window.sessionStorage.setItem('pipe_session_candidate', JSON.stringify({
        id: 'candidate-a',
        pipelineId: null,
        status: 'IN_PROGRESS',
        name: 'Stale Candidate A',
      }));
    });

    await page.route('**/rpc/resolve-token', async (route) => {
      const body = route.request().postDataJSON() as { inviteToken?: string };
      resolveCalls.push(String(body.inviteToken ?? ''));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'candidate-b',
          pipelineId: null,
          status: 'IN_PROGRESS',
          name: 'Fresh Candidate B',
          sessionToken: 'session-token-b',
        }),
      });
    });

    await page.route('**/rpc/get-stage-config', async (route) => {
      stageAuthHeaders.push(route.request().headers().authorization ?? '');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          isComplete: true,
          stageId: 'candidate-intake-queued',
          stageTitle: 'Profile received',
          mode: 'INTAKE',
          challenges: [],
          currentIndex: 0,
          message: 'Your profile has been received. PIPE will email you when your code review is ready.',
        }),
      });
    });

    await page.route('**/rpc/get-challenge', async (route) => {
      challengeCalls.push(route.request().postData() ?? '');
      await route.abort();
    });

    await page.goto('/assess/invite-token-b');

    await expect(page.getByTestId('assessment-submitted')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('assessment-submitted')).toContainText('Profile received.');
    await expect(page.getByTestId('assessment-submitted')).toContainText('email you when a source-backed code review is ready');

    expect(resolveCalls).toEqual(['invite-token-b']);
    expect(stageAuthHeaders).toContain('Bearer session-token-b');
    expect(challengeCalls).toEqual([]);
    await expect.poll(
      async () => page.evaluate(() => ({
        sessionToken: window.sessionStorage.getItem('pipe_session_token'),
        inviteToken: window.sessionStorage.getItem('pipe_session_invite_token'),
        candidate: JSON.parse(window.sessionStorage.getItem('pipe_session_candidate') ?? '{}') as { id?: string; name?: string },
      })),
      { message: 'sessionStorage should be rebound to candidate B' },
    ).toEqual({
      sessionToken: 'session-token-b',
      inviteToken: 'invite-token-b',
      candidate: {
        id: 'candidate-b',
        pipelineId: null,
        status: 'IN_PROGRESS',
        name: 'Fresh Candidate B',
      },
    });
  });
});
