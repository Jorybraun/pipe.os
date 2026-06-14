/**
 * BDD: Standalone CODE_REVIEW MVP vertical slice.
 *
 * Recruiter-created standalone CODE_REVIEW candidates must expose a safe,
 * source-backed match state on the recruiter CONTEXT tab before the candidate
 * has submitted intake evidence.
 */

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE = 'http://localhost:8787';
const APP_BASE = 'http://localhost:5173';

interface StandaloneCandidate {
  id: string;
  email: string;
  inviteToken: string;
  interviewType: 'CODE_REVIEW';
  pipelineId: null;
}

async function getAuthToken(page: Page): Promise<string> {
  await page.waitForLoadState('networkidle');
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === '__session');
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

async function createStandaloneCodeReviewCandidate(
  request: APIRequestContext,
  authToken: string,
): Promise<StandaloneCandidate> {
  const email = `standalone-code-review-${Date.now()}@example.com`;
  const response = await request.post(`${API_BASE}/api/v1/candidates`, {
    headers: recruiterHeaders(authToken),
    data: {
      name: 'Standalone Code Review Candidate',
      email,
      interviewType: 'CODE_REVIEW',
      skipEmail: true,
    },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { candidate: StandaloneCandidate };
  expect(body.candidate.interviewType).toBe('CODE_REVIEW');
  expect(body.candidate.pipelineId).toBeNull();
  return body.candidate;
}

test.describe('Standalone CODE_REVIEW MVP', () => {
  test('recruiter sees source-backed pending match state in candidate CONTEXT tab', async ({ page, request }) => {
    const authToken = await getAuthToken(page);
    const candidate = await createStandaloneCodeReviewCandidate(request, authToken);

    try {
      await page.goto(`${APP_BASE}/candidates/${candidate.id}`);
      await page.getByRole('button', { name: 'CONTEXT' }).click();

      await expect(page.getByLabel('Standalone code review match')).toContainText('Standalone CODE_REVIEW match');
      await expect(page.getByLabel('Standalone code review match')).toContainText('PENDING INTAKE');
      await expect(page.getByLabel('Standalone code review match')).toContainText(
        'Waiting for candidate resume/profile evidence before matching to a PR.',
      );
      await expect(page.getByLabel('Standalone code review match')).toContainText(
        'Candidate has not submitted source evidence yet.',
      );
    } finally {
      await request.delete(`${API_BASE}/api/v1/candidates/${candidate.id}`, {
        headers: recruiterHeaders(authToken),
      });
    }
  });
});
