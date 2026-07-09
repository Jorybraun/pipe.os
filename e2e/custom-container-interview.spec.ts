/**
 * e2e/custom-container-interview.spec.ts
 *
 * BDD: Custom container challenge — create a CUSTOM_CONTAINER challenge, invite a
 * candidate, and verify the interview factory creates the right interview and
 * assessment session.
 *
 * Route under test:
 *   1. Recruiter: POST /api/v1/pipelines -> create pipeline
 *   2. Recruiter: POST /api/v1/pipelines/:id/stages -> create stage
 *   3. Recruiter: POST /api/v1/stages/:id/challenges -> create CUSTOM_CONTAINER challenge
 *   4. Recruiter: POST /api/v1/candidates -> create standalone candidate with interviewType CUSTOM_CONTAINER
 *   5. Recruiter: GET /api/v1/candidates/:id -> verify scheduled_interview and assessmentProgress
 *
 * Auth: Recruiter authenticated via Clerk storageState.
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { API_BASE, APP_BASE } from './env';

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

// ─── Types ──────────────────────────────────────────────────────────────────

interface Pipeline {
  id: string;
  title: string;
}

interface Stage {
  id: string;
  pipelineId: string;
  title: string;
}

interface Challenge {
  id: string;
  stageId: string;
  type: string;
  title: string;
}

interface Candidate {
  id: string;
  inviteToken: string;
  status: string;
  interviewType: string | null;
  pipelineId: null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  throw new Error('[custom-container-interview.spec] No __session cookie. Run auth setup first.');
}

function recruiterHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function createPipeline(request: APIRequestContext, authToken: string, title: string): Promise<Pipeline> {
  const res = await request.post(`${API_BASE}/api/v1/pipelines`, {
    headers: recruiterHeaders(authToken),
    data: { title, description: 'E2E pipeline for custom container challenge', status: 'DRAFT' },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { pipeline: Pipeline };
  return body.pipeline;
}

async function createStage(
  request: APIRequestContext,
  authToken: string,
  pipelineId: string,
  title: string,
): Promise<Stage> {
  const res = await request.post(`${API_BASE}/api/v1/pipelines/${pipelineId}/stages`, {
    headers: recruiterHeaders(authToken),
    data: { title, description: 'Custom container stage', mode: 'ASYNC' },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { stage: Stage };
  return body.stage;
}

async function createCustomContainerChallenge(
  request: APIRequestContext,
  authToken: string,
  stageId: string,
): Promise<Challenge> {
  const res = await request.post(`${API_BASE}/api/v1/stages/${stageId}/challenges`, {
    headers: recruiterHeaders(authToken),
    data: {
      type: 'CUSTOM_CONTAINER',
      title: 'Senior accessibility audit',
      instructions: 'Audit the provided dashboard for accessibility issues, write a report, and fix the most critical issues.',
      config: {
        expectedArtifacts: ['AUDIT.md'],
      },
      serverConfig: {
        containerImage: 'node:20-slim',
        verificationCommand: 'npm run test:accessibility',
        groundTruth: { issues: [] },
        rubric: { dimensions: [] },
      },
      devContainerRepoUrl: 'https://github.com/pipe-os/accessibility-audit-challenge',
      devContainerChallengeBranch: 'main',
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { data: Challenge };
  return body.data;
}

async function createStandaloneCustomContainerCandidate(
  request: APIRequestContext,
  authToken: string,
  challengeId: string,
  options: { name?: string; email?: string } = {},
): Promise<Candidate> {
  const {
    name = 'Custom Container Candidate',
    email = `custom-container+e2e-${randomUUID()}@pipe-test.dev`,
  } = options;

  const res = await request.post(`${API_BASE}/api/v1/candidates`, {
    headers: recruiterHeaders(authToken),
    data: {
      name,
      email,
      interviewType: 'CUSTOM_CONTAINER',
      challengeId,
      skipEmail: true,
    },
  });
  expect(res.status()).toBe(201);

  const body = (await res.json()) as { candidate: Candidate };
  return body.candidate;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('§CC.1 — Recruiter creates a custom container challenge and invite', () => {
  let authToken: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();
  });

  test('POST /api/v1/stages/:id/challenges accepts CUSTOM_CONTAINER type', async ({ request }) => {
    const pipeline = await createPipeline(request, authToken, 'Custom Container Pipeline');
    const stage = await createStage(request, authToken, pipeline.id, 'Custom Container Stage');
    const challenge = await createCustomContainerChallenge(request, authToken, stage.id);

    expect(challenge.id).toBeTruthy();
    expect(challenge.type).toBe('CUSTOM_CONTAINER');
    expect(challenge.stageId).toBe(stage.id);
  });

  test('POST /api/v1/candidates with interviewType CUSTOM_CONTAINER creates a pipeline-free candidate and assessment session', async ({ request }) => {
    const pipeline = await createPipeline(request, authToken, 'Custom Container Pipeline');
    const stage = await createStage(request, authToken, pipeline.id, 'Custom Container Stage');
    const challenge = await createCustomContainerChallenge(request, authToken, stage.id);
    const candidate = await createStandaloneCustomContainerCandidate(request, authToken, challenge.id);

    expect(candidate.id).toBeTruthy();
    expect(candidate.inviteToken).toBeTruthy();
    expect(candidate.status).toBe('INVITED');
    expect(candidate.interviewType).toBe('CUSTOM_CONTAINER');
    expect(candidate.pipelineId).toBeNull();
  });

  test('scheduled_interview and assessmentProgress are correct for CUSTOM_CONTAINER', async ({ request }) => {
    const pipeline = await createPipeline(request, authToken, 'Custom Container Pipeline');
    const stage = await createStage(request, authToken, pipeline.id, 'Custom Container Stage');
    const challenge = await createCustomContainerChallenge(request, authToken, stage.id);
    const candidate = await createStandaloneCustomContainerCandidate(request, authToken, challenge.id);

    const profileRes = await request.get(`${API_BASE}/api/v1/candidates/${candidate.id}`, {
      headers: recruiterHeaders(authToken),
    });
    expect(profileRes.status()).toBe(200);

    const profile = (await profileRes.json()) as {
      scheduledInterviews: Array<{
        interviewType: string;
        status: string;
        pipelineId: string | null;
        stageId: string | null;
      }>;
      assessmentProgress?: {
        mode: string;
        state: string;
        challenge: {
          summary?: {
            task: string | null;
            verificationCommand: string | null;
          } | null;
        } | null;
      } | null;
    };

    expect(profile.scheduledInterviews).toBeDefined();
    expect(profile.scheduledInterviews).toHaveLength(1);
    expect(profile.scheduledInterviews[0].interviewType).toBe('CUSTOM_CONTAINER');
    expect(profile.scheduledInterviews[0].status).toBe('INVITED');
    expect(profile.scheduledInterviews[0].pipelineId).toBeNull();
    expect(profile.scheduledInterviews[0].stageId).toBeNull();

    expect(profile.assessmentProgress).toBeDefined();
    expect(profile.assessmentProgress?.mode).toBe('CUSTOM_CONTAINER');
    expect(profile.assessmentProgress?.challenge?.summary?.verificationCommand).toBe('npm run test:accessibility');
  });
});
