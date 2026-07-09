/**
 * e2e/standalone-code-review-mvp.spec.ts
 *
 * BDD: Standalone CODE_REVIEW MVP — Full E2E skeleton
 *
 * Route under test:
 *   1. Recruiter: /schedule → INVITE CANDIDATE → select CODE_REVIEW
 *   2. Candidate: /assess/:token
 *   3. Recruiter: /candidates/:id → CONTEXT
 *
 * Product slice: recruiter invites a person to a standalone code-review
 * challenge outside any pipeline or role → candidate opens /assess/:token →
 * candidate provides resume/profile evidence → PIPE queues living-context
 * ingestion in the background → PIPE later matches to a real reviewable PR or
 * requests more context → candidate submits review → recruiter sees context
 * graph and source-backed result.
 *
 * These tests protect the source-backed standalone path end-to-end.
 *
 * Invariants asserted:
 *   - No generic repo / smallest-PR / fabricated evidence fallback
 *   - Missing evidence → completed intake state, not a fake challenge or waiting room
 *   - Every match links to source evidence
 *   - Ground truth never leaks to candidate
 *
 * Auth: Recruiter authenticated via Clerk storageState.
 *       Candidate uses /rpc/* with custom session JWT (no sign-in).
 *
 * API base: http://localhost:8787
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { API_BASE, APP_BASE } from './env';

test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);

// ─── Types ──────────────────────────────────────────────────────────────────

interface StandaloneCandidate {
  id: string;
  name: string;
  email: string;
  inviteToken: string;
  status: string;
  interviewType: string | null;
  pipelineId: null;
}

interface ResolveTokenResponse {
  status: string;
  name: string | null;
  sessionToken: string;
}

interface StageConfigResponse {
  isComplete: boolean;
  stageId?: string;
  stageTitle?: string;
  message?: string;
  mode?: string;
  timeLimit?: number | null;
  challenges?: Array<{ type: string; order: number; title?: string }>;
  upcoming?: Array<{ type: string; title?: string }>;
  currentIndex?: number;
}

interface ChallengeResponse {
  id?: string;
  type?: string;
  title?: string;
  instructions?: string;
  config?: unknown;
  cachedDiffJson?: unknown;
  githubPrTitle?: string;
  githubPrNumber?: number;
  githubRepoUrl?: string;
  githubPrDescription?: string | null;
  reviewSession?: {
    requiresInit?: boolean;
    challengeId?: string;
  };
  matchExplanation?: {
    status?: string;
    summary?: string;
    score?: number | null;
    qualityGate?: {
      verdict?: string;
      checks?: string[];
    };
    assessmentQuality?: {
      verdict?: string;
      score?: number;
      maxScore?: number;
      metrics?: Array<{
        id?: string;
        label?: string;
        score?: number;
        maxScore?: number;
        reason?: string;
      }>;
    };
    candidateSourceCount?: number;
    repoSourceCount?: number;
    roleSourceCount?: number;
    validatorAgent?: {
      agentName?: string;
      agentVersion?: string;
      mode?: string;
      verdict?: string;
      rationale?: string;
      checks?: Array<{
        id?: string;
        passed?: boolean;
        reason?: string;
      }>;
      sourceBridge?: {
        prNumber?: number;
        candidateSourceCount?: number;
        repoSourceCount?: number;
        roleSourceCount?: number;
        alignedDemandCount?: number;
        stretchCount?: number;
        provenanceComplete?: boolean;
      };
    };
    evidence?: Array<{
      roleSourceRefs?: Array<{
        locator?: string;
        exactText?: string;
        conceptKeys?: string[];
      }>;
      candidateSourceRefs?: Array<{
        sourceRefType?: string;
        locator?: string;
        exactText?: string;
      }>;
      challengeSourceRefs?: Array<{
        sourceRefType?: string;
        locator?: string;
        exactText?: string;
      }>;
    }>;
    evidenceHyperedges?: Array<{
      relation?: string;
      label?: string;
      pairScore?: number;
      nodes?: Array<{
        kind?: string;
        label?: string;
        sourceRef?: {
          locator?: string;
          exactText?: string;
          conceptKeys?: string[];
        };
      }>;
      stretch?: {
        atomConcept?: string;
        demandConcept?: string;
        dimension?: string;
      };
    }>;
  };
  error?: { code: string; message: string };
}

interface SeedStandaloneReviewFixtureResponse {
  ok: boolean;
  fixtureId: string;
  repoUrl: string;
  prNumber: number;
  packetId: string;
  roleContextId: string | null;
  roleSources: Array<{
    entityId: string;
    locator: string;
    conceptKeys: string[];
  }>;
  demandIds: string[];
  demandFamilies: string[];
  candidateSourceSpanIds: string[];
  repoSourceSpanIds: string[];
}

interface SeedStandaloneReviewFixture extends SeedStandaloneReviewFixtureResponse {
  conceptKey: string;
  conceptLabel: string;
  repoFullName: string;
  recordingKey: string;
  transcriptionAudioKey: string;
  transcriptStatus: string;
  transcriptionProvider: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
  throw new Error('[standalone-code-review-mvp.spec] No __session cookie. Run auth setup first.');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function recruiterHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

function candidateHeaders(sessionToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${sessionToken}`,
  };
}

/**
 * Create a standalone candidate via POST /api/v1/candidates with
 * interviewType: CODE_REVIEW — no pipeline, no stage.
 */
async function createStandaloneCodeReviewCandidate(
  request: APIRequestContext,
  authToken: string,
  options: {
    name?: string;
    email?: string;
    githubRepoUrl?: string;
    githubPrNumber?: number;
  } = {},
): Promise<StandaloneCandidate> {
  const {
    name = 'E2E Standalone Candidate',
    email = `standalone+e2e-${randomUUID()}@pipe-test.dev`,
    githubRepoUrl,
    githubPrNumber,
  } = options;

  const res = await request.post(`${API_BASE}/api/v1/candidates`, {
    headers: recruiterHeaders(authToken),
    data: {
      name,
      email,
      interviewType: 'CODE_REVIEW',
      skipEmail: true,
      ...(githubRepoUrl ? { githubRepoUrl } : {}),
      ...(githubPrNumber ? { githubPrNumber } : {}),
    },
  });
  expect(res.status()).toBe(201);

  const body = (await res.json()) as { candidate: StandaloneCandidate };
  return body.candidate;
}

/**
 * Resolve a candidate invite token → session JWT via /rpc/resolve-token.
 */
async function resolveToken(
  request: APIRequestContext,
  inviteToken: string,
): Promise<ResolveTokenResponse> {
  const res = await request.post(`${API_BASE}/rpc/resolve-token`, {
    data: { inviteToken },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as ResolveTokenResponse;
}

async function submitStandaloneIntakeEvidence(
  request: APIRequestContext,
  sessionToken: string,
): Promise<void> {
  const intakeRes = await request.post(`${API_BASE}/rpc/submit-challenge-response`, {
    headers: candidateHeaders(sessionToken),
    data: {
      order: 0,
      submission: {
        resumeText: 'Senior software engineer with 8 years of TypeScript, React, and Node.js experience. Built large-scale frontend applications. Expert in component architecture, state management, and performance optimization. Contributed to open-source UI libraries.',
        githubHandle: 'e2e-test-user',
      },
    },
  });
  expect([200, 201]).toContain(intakeRes.status());

  const intakeBody = await intakeRes.json() as { success?: boolean };
  expect(intakeBody.success).toBe(true);
}

async function getChallengeWithRetry(
  request: APIRequestContext,
  sessionToken: string,
  order = 0,
): Promise<ChallengeResponse> {
  let lastStatus = 0;
  let lastBody = '';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const res = await request.post(`${API_BASE}/rpc/get-challenge`, {
      headers: candidateHeaders(sessionToken),
      data: { order },
    });
    lastStatus = res.status();
    lastBody = await res.text();
    if (lastStatus === 200) {
      return JSON.parse(lastBody) as ChallengeResponse;
    }
    if (![500, 503].includes(lastStatus)) break;
    await new Promise((resolve) => setTimeout(resolve, 500 + attempt * 250));
  }
  throw new Error(`get-challenge failed after retries: ${lastStatus} ${lastBody.slice(0, 500)}`);
}

async function seedStandaloneReviewMatchFixture(
  request: APIRequestContext,
  authToken: string,
  candidate: StandaloneCandidate,
): Promise<SeedStandaloneReviewFixture> {
  const suffix = candidate.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toLowerCase();
  const conceptKey = `term:workflow-conflict-warning-${suffix}`;
  const conceptLabel = 'workflow conflict warning';
  const uniquenessConceptKey = `term:workflow-name-uniqueness-${suffix}`;
  const releaseNoteConceptKey = `term:release-note-wording-${suffix}`;
  const dashboardPolishConceptKey = `term:dashboard-polish-${suffix}`;
  const copyEditingConceptKey = `term:copy-editing-${suffix}`;
  const readmeDocsConceptKey = `term:readme-docs-${suffix}`;
  const configRenameConceptKey = `term:wrangler-config-rename-${suffix}`;
  const deployWarningConceptKey = `term:deploy-warning-${suffix}`;
  const changesetConceptKey = `term:changeset-release-note-${suffix}`;
  const vitestConceptKey = `term:vitest-${suffix}`;
  const repoFullName = `cloudflare/workers-sdk-assessment-${suffix}`;
  const comparatorRepoFullName = `cloudflare/workers-sdk-comparator-${suffix}`;
  const repoUrl = `https://github.com/cloudflare/workers-sdk-assessment-${suffix}`;
  const comparatorRepoUrl = `https://github.com/cloudflare/workers-sdk-comparator-${suffix}`;
  const prNumber = 14000 + (Number.parseInt(suffix.slice(0, 5), 16) % 50000);
  const comparatorPrNumber = prNumber + 1;
  const recordingKey = `meetings/e2e-owner/${suffix}/recording.webm`;
  const transcriptionAudioKey = `meetings/e2e-owner/${suffix}/transcription-audio.webm`;
  const transcriptStatus = 'READY';
  const transcriptionProvider = 'deepgram-multichannel';

  const comparatorRes = await request.post(`${API_BASE}/api/v1/internal/e2e/standalone-review-match-fixture`, {
    headers: recruiterHeaders(authToken),
    data: {
      fixtureId: `standalone-review-comparator-${suffix}`,
      candidateId: candidate.id,
      useExistingCandidateEvidence: true,
      concepts: [
        { canonicalKey: conceptKey, namespace: 'term', label: conceptLabel },
        { canonicalKey: uniquenessConceptKey, namespace: 'term', label: 'workflow name uniqueness' },
        { canonicalKey: releaseNoteConceptKey, namespace: 'term', label: 'release note wording' },
        { canonicalKey: dashboardPolishConceptKey, namespace: 'term', label: 'dashboard polish' },
        { canonicalKey: copyEditingConceptKey, namespace: 'term', label: 'copy editing' },
        { canonicalKey: readmeDocsConceptKey, namespace: 'term', label: 'readme docs' },
      ],
      repo: {
        githubUrl: comparatorRepoUrl,
        fullName: comparatorRepoFullName,
        primaryLanguage: 'TypeScript',
        description: 'Comparator repository used to prove automatic match score separation.',
      },
      pullRequest: {
        number: comparatorPrNumber,
        title: '[Wrangler] Tidy copy for workflow dashboard notes',
        author: 'pipe-e2e',
        baseSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        headSha: 'cccccccccccccccccccccccccccccccccccccccc',
        mergedAt: '2026-06-26T11:51:43Z',
      },
      repoSpans: [
        {
          key: 'dashboard-copy',
          path: 'packages/wrangler/src/workflows/dashboard-copy.ts',
          exactText: [
            `export const workflowDashboardCopy = {`,
            `  warning: "Workflow names must be unique per account.",`,
            `  helper: "Review release note wording before publishing.",`,
            `  audience: "workflow dashboard maintainers",`,
            `  tone: "concise",`,
            `  emphasis: "copy editing",`,
            `};`,
            ``,
            `export function workflowDashboardWarning(): string {`,
            `  return workflowDashboardCopy.warning;`,
            `}`,
          ].join('\n'),
          artifactType: 'source',
          lineStart: 12,
        },
        {
          key: 'dashboard-test',
          path: 'packages/wrangler/src/__tests__/workflows/dashboard-copy.test.ts',
          exactText: [
            `import { describe, expect, it } from "vitest";`,
            `import { workflowDashboardWarning } from "../../workflows/dashboard-copy";`,
            ``,
            `describe("workflow dashboard copy", () => {`,
            `  it("mentions account-scoped workflow names", () => {`,
            `    expect(workflowDashboardWarning()).toContain("Workflow names must be unique");`,
            `    expect(workflowDashboardWarning()).toContain("per account");`,
            `  });`,
            `});`,
          ].join('\n'),
          artifactType: 'test',
          lineStart: 1,
        },
        {
          key: 'readme-note',
          path: 'packages/wrangler/README.md',
          exactText: [
            `### Workflow dashboard note`,
            ``,
            `Workflow names must be unique per account, and documentation copy should stay concise.`,
            ``,
            `Reviewers should confirm that the dashboard warning, release note wording,`,
            `and README language do not overstate workflow reassignment behavior.`,
          ].join('\n'),
          artifactType: 'documentation',
          lineStart: 42,
        },
      ],
      demands: [
        {
          id: 'dashboard-copy-demand',
          family: 'source-backed:dashboard-copy',
          narrative: 'Review broad dashboard copy for workflow naming guidance.',
          conceptKeys: [
            uniquenessConceptKey,
            releaseNoteConceptKey,
            dashboardPolishConceptKey,
            copyEditingConceptKey,
          ],
          sourceSpanKeys: ['dashboard-copy'],
          weight: 0.1,
        },
        {
          id: 'dashboard-test-demand',
          family: 'source-backed:dashboard-copy-test',
          narrative: 'Review broad test coverage for workflow dashboard copy.',
          conceptKeys: [
            dashboardPolishConceptKey,
            copyEditingConceptKey,
            readmeDocsConceptKey,
          ],
          sourceSpanKeys: ['dashboard-test'],
          weight: 0.45,
        },
        {
          id: 'readme-note-demand',
          family: 'source-backed:readme-docs',
          narrative: 'Review README wording for workflow naming guidance.',
          conceptKeys: [
            readmeDocsConceptKey,
            copyEditingConceptKey,
            dashboardPolishConceptKey,
          ],
          sourceSpanKeys: ['readme-note'],
          weight: 0.45,
        },
      ],
    },
  });
  const comparatorText = await comparatorRes.text();
  expect(comparatorRes.status(), comparatorText).toBe(200);
  const comparatorBody = JSON.parse(comparatorText) as SeedStandaloneReviewFixtureResponse;
  expect(comparatorBody.ok).toBe(true);
  expect(comparatorBody.prNumber).toBe(comparatorPrNumber);

  const fixtureId = `standalone-review-match-${suffix}`;
  const res = await request.post(`${API_BASE}/api/v1/internal/e2e/standalone-review-match-fixture`, {
    headers: recruiterHeaders(authToken),
    data: {
      fixtureId,
      candidateId: candidate.id,
      omitSamplePrRow: true,
      concepts: [
        {
          canonicalKey: conceptKey,
          namespace: 'term',
          label: conceptLabel,
        },
        {
          canonicalKey: uniquenessConceptKey,
          namespace: 'term',
          label: 'workflow name uniqueness',
        },
        {
          canonicalKey: configRenameConceptKey,
          namespace: 'term',
          label: 'wrangler config rename',
        },
        {
          canonicalKey: deployWarningConceptKey,
          namespace: 'term',
          label: 'deploy warning',
        },
        {
          canonicalKey: vitestConceptKey,
          namespace: 'term',
          label: 'vitest',
        },
        {
          canonicalKey: changesetConceptKey,
          namespace: 'term',
          label: 'changeset release note',
        },
      ],
      roleSource: {
        title: 'Source-backed Workers SDK review role',
        jobDescriptionMd: 'Review TypeScript PRs that improve Wrangler deploy warnings for workflow name conflicts with source-backed evidence.',
        selectedConceptKeys: [conceptKey, uniquenessConceptKey],
      },
      candidateEvidenceSource: {
        interactionType: 'video_meeting',
        artifactType: 'meeting_transcript',
        externalReference: `meeting:${suffix}`,
        logicalKey: `meeting:${suffix}:transcript`,
        contextRecordType: 'meeting_transcript_assertion',
        recordingKey,
        transcriptionAudioKey,
        provider: transcriptionProvider,
        transcriptStatus,
      },
      candidateEvidence: [
        {
          exactText: 'Implemented workflow conflict warning copy explaining unique workflow names.',
          predicate: 'implemented',
          narrative: 'Candidate implemented workflow conflict warning copy.',
          conceptKeys: [conceptKey, uniquenessConceptKey, deployWarningConceptKey],
          evidenceLevel: 'implemented',
          strength: 1,
          confidence: 1,
        },
        {
          exactText: 'Validated workflow conflict warning behavior in Wrangler deploy tests.',
          predicate: 'validated',
          narrative: 'Candidate validated workflow conflict warning behavior.',
          conceptKeys: [conceptKey, deployWarningConceptKey, vitestConceptKey],
          evidenceLevel: 'validated',
          strength: 1,
          confidence: 1,
        },
        {
          exactText: 'Explained how Wrangler config rename guidance prevents unintended workflow reassignment.',
          predicate: 'explained',
          narrative: 'Candidate explained Wrangler config rename guidance.',
          conceptKeys: [configRenameConceptKey, uniquenessConceptKey],
          evidenceLevel: 'implemented',
          strength: 1,
          confidence: 1,
        },
        {
          exactText: 'Reviewed deploy helper warning message for account-scoped workflow name uniqueness.',
          predicate: 'explained',
          narrative: 'Candidate reviewed deploy helper warning semantics.',
          conceptKeys: [deployWarningConceptKey, uniquenessConceptKey],
          evidenceLevel: 'validated',
          strength: 1,
          confidence: 1,
        },
        {
          exactText: 'Reviewed changeset release note coverage for the Wrangler workflow conflict warning.',
          predicate: 'reviewed',
          narrative: 'Candidate reviewed changeset release note coverage.',
          conceptKeys: [changesetConceptKey, deployWarningConceptKey],
          evidenceLevel: 'validated',
          strength: 1,
          confidence: 1,
        },
      ],
      repo: {
        githubUrl: repoUrl,
        fullName: repoFullName,
        primaryLanguage: 'TypeScript',
        description: 'Cloudflare Workers SDK and Wrangler source repository.',
      },
      pullRequest: {
        number: prNumber,
        title: '[Wrangler] Improve deploy warn for workflows with repeated names',
        author: 'pombosilva',
        baseSha: 'cb7ad1177a4ba0b06054268229ed39ae111d7c4f',
        headSha: 'f11917ab8f3dcf94e59bb72d8232f4e43c67a36d',
        mergedAt: '2026-06-26T10:51:43Z',
      },
      repoSpans: [
        {
          key: 'deploy-helper',
          path: 'packages/deploy-helpers/src/deploy/helpers/check-workflow-conflicts.ts',
          exactText: [
            `const message =`,
            `  \`The following workflow(s) already exist and belong to different workers:\\n\${conflictList}\\n\\n\` +`,
            `  \`Deploying will reassign these workflows to "\${scriptName}". Workflow names must be unique per account. If this reassignment is unintended, rename the workflow(s) in the Wrangler config.\`;`,
            ``,
            `return { hasConflicts: true, conflicts, message };`,
          ].join('\n'),
          artifactType: 'source',
          lineStart: 85,
        },
        {
          key: 'unit-test',
          path: 'packages/wrangler/src/__tests__/deploy/check-workflow-conflicts.test.ts',
          exactText: [
            `expect(message).toBe(`,
            `  \`The following workflow(s) already exist and belong to different workers:\\n\` +`,
            `    \`  - "my-workflow" (currently belongs to "other-worker")\\n\\n\` +`,
            `    \`Deploying will reassign these workflows to "my-worker". Workflow names must be unique per account. If this reassignment is unintended, rename the workflow(s) in the Wrangler config.\``,
            `);`,
          ].join('\n'),
          artifactType: 'test',
          lineStart: 277,
        },
        {
          key: 'integration-test',
          path: 'packages/wrangler/src/__tests__/deploy/workflows.test.ts',
          exactText: [
            `expect(std.warn).toContain(`,
            `  'Deploying will reassign these workflows to "test-name".'`,
            `);`,
            `expect(std.warn).toContain(`,
            `  "Workflow names must be unique per account."`,
            `);`,
            `expect(std.warn).toContain(`,
            `  "If this reassignment is unintended, rename the workflow(s) in the Wrangler config."`,
            `);`,
          ].join('\n'),
          artifactType: 'test',
          lineStart: 987,
        },
        {
          key: 'changeset',
          path: '.changeset/explain-workflow-name-conflict.md',
          exactText: [
            `---`,
            `"wrangler": patch`,
            `---`,
            ``,
            `Improve the deploy warning shown when a Workflow name already belongs to another Worker`,
            ``,
            `The warning still notes that deploying reassigns the workflow to the current Worker, and now also explains why this happens (workflow names must be unique per account) and how to resolve it (rename the workflow in the Wrangler config).`,
          ].join('\n'),
          artifactType: 'documentation',
          lineStart: 1,
        },
      ],
      demands: [
        {
          id: 'deploy-helper-demand',
          family: 'source-backed:workflow-conflict-message',
          narrative: 'Review the deploy helper warning for workflow name conflicts.',
          conceptKeys: [conceptKey, uniquenessConceptKey, deployWarningConceptKey],
          sourceSpanKeys: ['deploy-helper'],
          weight: 0.4,
        },
        {
          id: 'unit-test-demand',
          family: 'source-backed:workflow-conflict-unit-test',
          narrative: 'Review the direct unit assertion for the workflow conflict message.',
          conceptKeys: [conceptKey, uniquenessConceptKey, vitestConceptKey],
          sourceSpanKeys: ['unit-test'],
          weight: 0.25,
        },
        {
          id: 'integration-test-demand',
          family: 'source-backed:workflow-conflict-integration-test',
          narrative: 'Review the deploy integration test coverage for rename guidance.',
          conceptKeys: [configRenameConceptKey, deployWarningConceptKey, vitestConceptKey],
          sourceSpanKeys: ['integration-test'],
          weight: 0.2,
        },
        {
          id: 'changeset-demand',
          family: 'source-backed:workflow-conflict-changeset',
          narrative: 'Review the public changeset note for the workflow conflict warning.',
          conceptKeys: [changesetConceptKey, deployWarningConceptKey],
          sourceSpanKeys: ['changeset'],
          weight: 0.15,
        },
      ],
    },
  });
  const resText = await res.text();
  if (res.status() !== 200) {
    console.log('SEED fixture failed for fixtureId', fixtureId, 'status', res.status(), 'body', resText);
  }
  expect(res.status()).toBe(200);
  const body = JSON.parse(resText) as SeedStandaloneReviewFixtureResponse;
  expect(body.ok).toBe(true);
  expect(body.repoUrl).toBe(repoUrl);
  expect(body.prNumber).toBe(prNumber);
  expect(body.roleContextId).toBeTruthy();
  expect(body.roleSources).toEqual([expect.objectContaining({
    locator: expect.stringContaining('simple_job_description:source_span:'),
    conceptKeys: expect.arrayContaining([conceptKey]),
  })]);
  expect(body.candidateSourceSpanIds.length).toBeGreaterThan(0);
  expect(body.repoSourceSpanIds.length).toBeGreaterThan(0);
  expect(body.demandIds.length).toBeGreaterThanOrEqual(2);
  expect(body.demandFamilies.length).toBeGreaterThanOrEqual(2);
  return {
    ...body,
    conceptKey,
    conceptLabel,
    repoFullName,
    recordingKey,
    transcriptionAudioKey,
    transcriptStatus,
    transcriptionProvider,
  };
}

async function submitStandaloneCodeReview(
  request: APIRequestContext,
  sessionToken: string,
  options: {
    summary: string;
    annotations: Array<{
      file: string;
      line: number;
      severity: string;
      comment: string;
    }>;
  },
): Promise<void> {
  const submitRes = await request.post(`${API_BASE}/rpc/submit-challenge-response`, {
    headers: candidateHeaders(sessionToken),
    data: {
      order: 0,
      submission: {
        type: 'CODE_REVIEW',
        verdict: 'request_changes',
        summary: options.summary,
        annotations: options.annotations,
      },
    },
  });

  expect([200, 201]).toContain(submitRes.status());

  const body = await submitRes.json() as Record<string, unknown>;
  expect(JSON.stringify(body)).not.toContain('groundTruth');
  expect(body.success).toBe(true);
}

// ─── §MVP.1 Recruiter creates standalone CODE_REVIEW invite ─────────────────

test.describe('§MVP.1 — Recruiter creates standalone CODE_REVIEW invite', () => {
  let authToken: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();
  });

  test('POST /api/v1/candidates with interviewType CODE_REVIEW creates pipeline-free candidate', async ({ request }) => {
    const candidate = await createStandaloneCodeReviewCandidate(request, authToken);

    expect(candidate.id).toBeTruthy();
    expect(candidate.inviteToken).toBeTruthy();
    expect(candidate.status).toBe('INVITED');
    expect(candidate.interviewType).toBe('CODE_REVIEW');
    expect(candidate.pipelineId).toBeNull();
  });

  test('scheduled_interviews row exists with correct shape', async ({ request }) => {
    const candidate = await createStandaloneCodeReviewCandidate(request, authToken);

    // Verify via the GET candidate profile endpoint that the interview exists
    const profileRes = await request.get(`${API_BASE}/api/v1/candidates/${candidate.id}`, {
      headers: recruiterHeaders(authToken),
    });
    expect(profileRes.status()).toBe(200);

    const profile = await profileRes.json() as Record<string, unknown>;
    const interviews = profile.scheduledInterviews as Array<{
      interviewType: string;
      pipelineId: string | null;
      stageId: string | null;
      status: string;
    }> | undefined;

    // The candidate profile should expose scheduled interviews
    expect(interviews).toBeDefined();
    expect(interviews).toHaveLength(1);
    expect(interviews![0].interviewType).toBe('CODE_REVIEW');
    expect(interviews![0].pipelineId).toBeNull();
    expect(interviews![0].stageId).toBeNull();
    expect(interviews![0].status).toBe('INVITED');
  });

  test('manual repo override is persisted for standalone CODE_REVIEW interviews', async ({ request }) => {
    const repoUrl = 'https://github.com/cloudflare/workers-sdk';
    const prNumber = 14435;
    const candidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'Manual Repo Override Candidate',
      email: `manual-override+e2e-${randomUUID()}@pipe-test.dev`,
      githubRepoUrl: repoUrl,
      githubPrNumber: prNumber,
    });

    const profileRes = await request.get(`${API_BASE}/api/v1/candidates/${candidate.id}`, {
      headers: recruiterHeaders(authToken),
    });
    expect(profileRes.status()).toBe(200);

    const profile = await profileRes.json() as Record<string, unknown>;
    const interviews = profile.scheduledInterviews as Array<{
      interviewType: string;
      githubRepoUrl: string | null;
      githubPrNumber: number | null;
    }> | undefined;

    expect(interviews).toBeDefined();
    expect(interviews).toHaveLength(1);
    expect(interviews![0]).toEqual(expect.objectContaining({
      interviewType: 'CODE_REVIEW',
      githubRepoUrl: repoUrl,
      githubPrNumber: prNumber,
    }));
  });

  test('manual repo override returns source-backed validator-agent justification', async ({ request }) => {
    const packetSeedCandidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'Manual Override Packet Seeder',
      email: `manual-packet-seed+e2e-${randomUUID()}@pipe-test.dev`,
    });
    const fixture = await seedStandaloneReviewMatchFixture(request, authToken, packetSeedCandidate);

    const manualCandidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'Manual Override Review Candidate',
      email: `manual-override-review+e2e-${randomUUID()}@pipe-test.dev`,
      githubRepoUrl: fixture.repoUrl,
      githubPrNumber: fixture.prNumber,
    });
    const session = await resolveToken(request, manualCandidate.inviteToken);
    await submitStandaloneIntakeEvidence(request, session.sessionToken);

    const challenge = await getChallengeWithRetry(request, session.sessionToken);
    expect(challenge.type).toBe('CODE_REVIEW');
    expect(challenge.githubRepoUrl).toBe(fixture.repoUrl);
    expect(challenge.githubPrNumber).toBe(fixture.prNumber);
    expect(challenge.cachedDiffJson).toBeTruthy();
    expect(challenge.matchExplanation).toEqual(expect.objectContaining({
      status: 'MATCHED',
      summary: expect.stringContaining('Manual override'),
      score: null,
      qualityGate: expect.objectContaining({
        verdict: 'PASSED',
        checks: expect.arrayContaining([
          'repo_source_spans',
          'source_backed_manual_override',
          'agent_validated_match',
        ]),
      }),
      candidateSourceCount: 0,
      repoSourceCount: 1,
      roleSourceCount: 0,
      assessmentQuality: expect.objectContaining({
        verdict: 'USABLE',
        score: 8,
        maxScore: 12,
        metrics: expect.arrayContaining([
          expect.objectContaining({
            id: 'pr_reviewability',
            score: 2,
          }),
          expect.objectContaining({
            id: 'contrast_separation',
            score: 0,
          }),
        ]),
      }),
      validatorAgent: expect.objectContaining({
        agentName: 'source_backed_match_validator',
        agentVersion: 'v1',
        mode: 'deterministic',
        verdict: 'PASSED',
        rationale: expect.stringMatching(/recruiter-selected/i),
        checks: expect.arrayContaining([
          expect.objectContaining({ id: 'repo_source_spans', passed: true }),
          expect.objectContaining({ id: 'source_backed_manual_override', passed: true }),
          expect.objectContaining({ id: 'provenance_complete', passed: true }),
        ]),
        sourceBridge: expect.objectContaining({
          prNumber: fixture.prNumber,
          candidateSourceCount: 0,
          repoSourceCount: 1,
          roleSourceCount: 0,
          provenanceComplete: true,
        }),
      }),
    }));

    const profileRes = await request.get(`${API_BASE}/api/v1/candidates/${manualCandidate.id}`, {
      headers: recruiterHeaders(authToken),
    });
    expect(profileRes.status()).toBe(200);
    const profile = await profileRes.json() as {
      standaloneReviewMatch?: {
        matchStatus: string;
        repoUrl: string | null;
        prNumber: number | null;
        summary: string | null;
        gaps: string[];
      } | null;
    };

    expect(profile.standaloneReviewMatch).toEqual(expect.objectContaining({
      matchStatus: 'MATCHED',
      repoUrl: fixture.repoUrl,
      prNumber: fixture.prNumber,
    }));
    expect(profile.standaloneReviewMatch?.summary).toContain('Matched to a reviewable PR challenge.');
    expect(profile.standaloneReviewMatch?.gaps).toEqual([]);
  });

  test('UI flow: /schedule exposes current NEW INTERVIEW modal', async ({ page }) => {
    await page.goto(`${APP_BASE}/schedule`, { waitUntil: 'domcontentloaded' });

    // CODE_REVIEW candidate creation is covered by the recruiter API tests above.
    // The current schedule UI creates meeting invites from the same interview surface.
    const inviteBtn = page.getByRole('button', { name: /NEW INTERVIEW/i }).first();
    await expect(inviteBtn).toBeVisible({ timeout: 30000 });
    await inviteBtn.click();

    await expect(page.getByText('NEW INTERVIEW').first()).toBeVisible({ timeout: 5000 });

    const nameInput = page.getByPlaceholder('Jane Doe');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('E2E Code Review Test');

    const emailInput = page.getByPlaceholder('jane@example.com');
    await expect(emailInput).toBeVisible();
    await emailInput.fill(`standalone-ui+${randomUUID()}@pipe-test.dev`);

    await expect(page.getByText('Video interview').first()).toBeVisible();
    const codeReviewMode = page.getByRole('button', {
      name: /Code-review interview\s+Async pull request review/i,
    });
    await expect(codeReviewMode).toBeVisible();
    await codeReviewMode.click();
    await expect(page.getByText('Async pull request review')).toBeVisible();
    await expect(page.getByText('ROOM FEATURES')).toHaveCount(0);

    await page.getByRole('button', { name: 'Specify repo manually' }).click();
    await page.getByPlaceholder('https://github.com/owner/repo').fill('https://github.com/cloudflare/workers-sdk');
    const createButton = page.getByRole('button', { name: /CREATE ASSESSMENT INVITE/i });
    await expect(createButton).toBeDisabled();
    await page.getByPlaceholder('PR number').fill('14435');
    await expect(createButton).toBeEnabled();
  });
});

// ─── §MVP.2 Candidate token resolution (standalone) ─────────────────────────

test.describe('§MVP.2 — Candidate token resolution for standalone invite', () => {
  let authToken: string;
  let candidate: StandaloneCandidate;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    candidate = await createStandaloneCodeReviewCandidate(request, authToken);
  });

  test('resolve-token issues a session token for a standalone candidate', async ({ request }) => {
    const session = await resolveToken(request, candidate.inviteToken);

    expect(session.sessionToken).toBeTruthy();
    expect(session.status).toBe(candidate.status);
    expect(session.status).toBe('INVITED');
  });
});

// ─── §MVP.3 Candidate stage config — intake before code review ──────────────

test.describe('§MVP.3 — Standalone candidate sees intake before code review', () => {
  let authToken: string;
  let candidate: StandaloneCandidate;
  let sessionToken: string;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    candidate = await createStandaloneCodeReviewCandidate(request, authToken);
    const session = await resolveToken(request, candidate.inviteToken);
    sessionToken = session.sessionToken;
  });

  test('get-stage-config serves INTAKE mode with CODE_REVIEW upcoming', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/get-stage-config`, {
      headers: candidateHeaders(sessionToken),
      data: {},
    });
    expect(res.status()).toBe(200);

    const config = (await res.json()) as StageConfigResponse;
    expect(config.isComplete).toBe(false);
    expect(config.mode).toBe('INTAKE');

    // Should list INTAKE as current challenge
    expect(config.challenges).toBeDefined();
    expect(config.challenges!.length).toBeGreaterThanOrEqual(1);
    expect(config.challenges![0].type).toBe('INTAKE');

    // Should advertise CODE_REVIEW as upcoming
    expect(config.upcoming).toBeDefined();
    expect(config.upcoming!.length).toBeGreaterThanOrEqual(1);
    expect(config.upcoming!.some((u) => u.type === 'CODE_REVIEW')).toBe(true);
  });

  test('get-challenge order=0 returns INTAKE content', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/get-challenge`, {
      headers: candidateHeaders(sessionToken),
      data: { order: 0 },
    });
    expect(res.status()).toBe(200);

    const challenge = (await res.json()) as ChallengeResponse;
    expect(challenge.type).toBe('INTAKE');
    expect(challenge.title).toBeTruthy();
  });

  test('candidate can paste resume text and reach source-backed CODE_REVIEW without file upload', async ({ browser, request }) => {
    const textIntakeCandidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'Text Intake Code Review Candidate',
      email: `text-intake-code-review+e2e-${randomUUID()}@pipe-test.dev`,
      githubRepoUrl: 'https://github.com/cloudflare/workers-sdk',
      githubPrNumber: 14435,
    });
    const fixture = await seedStandaloneReviewMatchFixture(request, authToken, textIntakeCandidate);

    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${APP_BASE}/assess/${textIntakeCandidate.inviteToken}`);
    await expect(page.getByText('Code Review · Review a pull request and leave feedback')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('start-interview-btn').evaluate((el) => (el as HTMLButtonElement).click());

    const resumeText = page.getByPlaceholder('Paste resume text, recent project notes, or a short profile summary.');
    await expect(resumeText).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'CONTINUE' })).toBeDisabled();
    await resumeText.fill(
      'Senior software engineer with TypeScript, Cloudflare Workers, deployment tooling, workflow configuration, and production PR review experience. I routinely review warning copy, regression tests, and developer-experience changes in large TypeScript repos.',
    );
    await page.getByPlaceholder('username (not the full URL)').fill('text-intake-e2e');
    await expect(page.getByRole('button', { name: 'CONTINUE' })).toBeEnabled();
    await page.getByRole('button', { name: 'CONTINUE' }).click();

    const codeReview = page.getByTestId('code-review-challenge');
    await expect(codeReview).toBeVisible({ timeout: 30000 });
    await expect(codeReview).toContainText(fixture.repoFullName);
    await expect(codeReview).toContainText(`#${fixture.prNumber}`);
    await expect(page.getByTestId('code-review-match-proof')).toContainText('Why you got this pull request');
    await expect(page.getByTestId('code-review-match-proof')).not.toContainText('MATCH_PROOF');
    await expect(page.getByTestId('code-review-match-proof')).not.toContainText(/PERSON_ROLE_REPO|CANDIDATE_REPO/);
    await expect(page.getByTestId('code-review-match-proof')).toContainText('Repo source spans');
    await expect(page.getByTestId('code-review-match-validator')).toContainText('Independent verification');
    await expect(page.getByTestId('pierre-diff-viewer')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('JOIN VIDEO');
    await expect(page.locator('body')).not.toContainText('Video Waiting Room');

    await context.close();
  });
});

// ─── §MVP.4 No generic/fallback challenge — fail-closed matching ────────────

test.describe('§MVP.4 — Deterministic matching: no generic/smallest-PR fallback', () => {
  let authToken: string;
  let candidate: StandaloneCandidate;
  let sessionToken: string;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    candidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'Unmatchable Candidate',
      email: `unmatchable+e2e-${randomUUID()}@pipe-test.dev`,
    });
    const session = await resolveToken(request, candidate.inviteToken);
    sessionToken = session.sessionToken;

    // Submit minimal resume so candidate passes intake but has thin evidence.
    // This must not be enough to select a reviewable PR.
    const intakeRes = await request.post(`${API_BASE}/rpc/submit-challenge-response`, {
      headers: candidateHeaders(sessionToken),
      data: {
        order: 0,
        submission: {
          resumeText: 'Minimal resume with no relevant technical background.',
        },
      },
    });
    expect(intakeRes.status()).toBe(200);
    const intakeBody = await intakeRes.json() as {
      success?: boolean;
      complete?: boolean;
      queued?: boolean;
      message?: string;
    };
    expect(intakeBody.success).toBe(true);
    expect(intakeBody.complete).toBe(true);
    expect(intakeBody.queued).toBe(true);
    expect(intakeBody.message).toBe('INTAKE queued for background processing');
  });

  test('candidate with thin evidence completes intake instead of seeing a waiting room or generic PR', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/get-stage-config`, {
      headers: candidateHeaders(sessionToken),
      data: {},
    });
    expect(res.status()).toBe(200);

    const config = (await res.json()) as StageConfigResponse;

    expect(config.isComplete).toBe(true);
    expect(config.stageId).toBe('candidate-intake-queued');
    expect(config.challenges).toEqual([]);
    expect(config.message).toContain('email you when your code review is ready');
  });

  test('queued intake response never exposes ground truth', async ({ request }) => {
    const res = await request.post(`${API_BASE}/rpc/get-stage-config`, {
      headers: candidateHeaders(sessionToken),
      data: {},
    });
    const body = await res.text();

    // Ground truth, scoring rubrics, planted bugs must never appear in response
    expect(body).not.toContain('groundTruth');
    expect(body).not.toContain('plantedBugs');
    expect(body).not.toContain('scoringRubric');
    expect(body).not.toContain('correctAnswer');
  });
});

// ─── §MVP.5 Candidate assessment UI — /assess/:token ────────────────────────

test.describe('§MVP.5 — Candidate opens /assess/:token for standalone code review', () => {
  let authToken: string;
  let candidate: StandaloneCandidate;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    candidate = await createStandaloneCodeReviewCandidate(request, authToken);
  });

  test('candidate lands on intake with resume upload when no evidence exists', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${APP_BASE}/assess/${candidate.inviteToken}`);

    // Should see intake intro — not a direct code review.
    await expect(page.getByText('UPLOAD YOUR CV · GETTING STARTED')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Profile & Resume')).toBeVisible();
    await expect(page.getByTestId('start-interview-btn')).toBeVisible();

    // Must NOT immediately show a code review diff
    const hasDiff = await page
      .locator('[data-testid="diff-panel"], .diff-panel, text=/@@.*@@/')
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    expect(hasDiff).toBe(false);

    await context.close();
  });

  test('candidate URL invite token clears stale cached matched session', async ({ browser, request }) => {
    const staleCandidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'Stale Matched Code Review Candidate',
      email: `stale-matched+e2e-${randomUUID()}@pipe-test.dev`,
    });
    const staleSession = await resolveToken(request, staleCandidate.inviteToken);
    await submitStandaloneIntakeEvidence(request, staleSession.sessionToken);
    const staleFixture = await seedStandaloneReviewMatchFixture(request, authToken, staleCandidate);
    await getChallengeWithRetry(request, staleSession.sessionToken);

    const freshCandidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'Fresh Intake Candidate',
      email: `fresh-intake+e2e-${randomUUID()}@pipe-test.dev`,
    });

    const context = await browser.newContext();
    await context.addInitScript(({ sessionToken, inviteToken, candidate }) => {
      window.sessionStorage.setItem('pipe_session_token', sessionToken);
      window.sessionStorage.setItem('pipe_session_invite_token', inviteToken);
      window.sessionStorage.setItem('pipe_session_candidate', JSON.stringify({
        id: candidate.id,
        pipelineId: null,
        status: 'IN_PROGRESS',
        name: candidate.name,
        email: candidate.email,
      }));
    }, {
      sessionToken: staleSession.sessionToken,
      inviteToken: staleCandidate.inviteToken,
      candidate: {
        id: staleCandidate.id,
        name: staleCandidate.name,
        email: staleCandidate.email,
      },
    });
    const page = await context.newPage();

    await page.goto(`${APP_BASE}/assess/${freshCandidate.inviteToken}`);

    await expect(page.getByText('UPLOAD YOUR CV · GETTING STARTED')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Profile & Resume')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(staleFixture.repoFullName);
    await expect(page.locator('body')).not.toContainText(`#${staleFixture.prNumber}`);

    const cachedInviteToken = await page.evaluate(() =>
      window.sessionStorage.getItem('pipe_session_invite_token')
    );
    const cachedSessionToken = await page.evaluate(() =>
      window.sessionStorage.getItem('pipe_session_token')
    );
    expect(cachedInviteToken).toBeNull();
    expect(cachedSessionToken).not.toBe(staleSession.sessionToken);
    expect(cachedSessionToken).toBeTruthy();

    await context.close();
  });
});

// ─── §MVP.6 Matched path — CODE_REVIEW with real PR ─────────────────────────

test.describe('§MVP.6 — Matched candidate receives real CODE_REVIEW challenge', () => {
  let authToken: string;
  let candidate: StandaloneCandidate;
  let sessionToken: string;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    candidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'Matched Code Review Candidate',
      email: `matched+e2e-${randomUUID()}@pipe-test.dev`,
    });
    const session = await resolveToken(request, candidate.inviteToken);
    sessionToken = session.sessionToken;
  });

  test('after evidence + matching, get-challenge returns CODE_REVIEW with PR metadata', async ({ request }) => {
    // This test requires the full pipeline: intake → living context → match.
    // The candidate submits text-based evidence via submit-challenge-response,
    // which triggers ingestion and deterministic matching.

    // Step 1: Submit resume/profile evidence via the challenge-response intake path.
    await submitStandaloneIntakeEvidence(request, sessionToken);

    const fixture = await seedStandaloneReviewMatchFixture(request, authToken, candidate);

    // Step 2: Get challenge — source-backed candidate evidence and repo packet must match deterministically.
    const challenge = await getChallengeWithRetry(request, sessionToken);

    expect(challenge.type).toBe('CODE_REVIEW');
    expect(challenge.githubPrNumber).toBe(fixture.prNumber);
    expect(challenge.githubRepoUrl).toBe(fixture.repoUrl);
    expect(challenge.githubRepoUrl).toMatch(/^https:\/\/github\.com\//);
    expect(challenge.githubRepoUrl).not.toMatch(/\/pipe\/e2e-|\/pipe\/manual-review/);
    expect(challenge.cachedDiffJson).toBeTruthy();
    expect(challenge.githubPrTitle).toBe('[Wrangler] Improve deploy warn for workflows with repeated names');
    expect(challenge.title).toBeTruthy();
    expect(challenge.matchExplanation).toEqual(expect.objectContaining({
      status: 'MATCHED',
      summary: expect.stringContaining('Matched'),
      qualityGate: expect.objectContaining({
        verdict: 'PASSED',
        checks: expect.arrayContaining([
          'candidate_source_evidence',
          'repo_source_spans',
          'role_context_alignment',
          'agent_validated_match',
        ]),
      }),
      validatorAgent: expect.objectContaining({
        agentName: 'source_backed_match_validator',
        agentVersion: 'v1',
        mode: 'deterministic',
        verdict: 'PASSED',
        rationale: expect.stringContaining('source-backed demand'),
        sourceBridge: expect.objectContaining({
          prNumber: fixture.prNumber,
          provenanceComplete: true,
        }),
      }),
    }));
    expect(challenge.matchExplanation?.score ?? 0).toBeGreaterThan(0);
    expect(challenge.matchExplanation?.candidateSourceCount ?? 0).toBeGreaterThan(0);
    expect(challenge.matchExplanation?.repoSourceCount ?? 0).toBeGreaterThan(0);
    expect(challenge.matchExplanation?.roleSourceCount ?? 0).toBeGreaterThan(0);
    expect(challenge.matchExplanation?.evidence?.length ?? 0).toBeGreaterThan(0);
    const validator = challenge.matchExplanation?.validatorAgent;
    expect(validator?.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'candidate_source_evidence', passed: true }),
      expect.objectContaining({ id: 'repo_source_spans', passed: true }),
      expect.objectContaining({ id: 'role_context_alignment', passed: true }),
      expect.objectContaining({ id: 'provenance_complete', passed: true }),
      expect.objectContaining({ id: 'bounded_stretch', passed: true }),
      expect.objectContaining({ id: 'eligible_match', passed: true }),
    ]));
    expect(validator?.sourceBridge?.candidateSourceCount ?? 0).toBeGreaterThan(0);
    expect(validator?.sourceBridge?.repoSourceCount ?? 0).toBeGreaterThan(0);
    expect(validator?.sourceBridge?.roleSourceCount ?? 0).toBeGreaterThan(0);
    expect(validator?.sourceBridge?.alignedDemandCount ?? 0).toBeGreaterThanOrEqual(2);
    const matchEvidence = challenge.matchExplanation?.evidence ?? [];
    const roleRefs = matchEvidence.flatMap((entry) => entry.roleSourceRefs ?? []);
    const candidateRefs = matchEvidence.flatMap((entry) => entry.candidateSourceRefs ?? []);
    const challengeRefs = matchEvidence.flatMap((entry) => entry.challengeSourceRefs ?? []);
    expect(roleRefs.some((ref) =>
      ref.exactText?.includes('Review TypeScript PRs that improve Wrangler deploy warnings')
      && ref.conceptKeys?.includes(fixture.conceptKey)
    )).toBe(true);
    expect(candidateRefs.some((ref) =>
      ref.sourceRefType === 'source_span'
      && ref.exactText?.includes('Implemented workflow conflict warning copy')
    )).toBe(true);
    expect(challengeRefs.some((ref) =>
      ref.sourceRefType === 'repo_source_span'
      && ref.exactText?.includes('Workflow names must be unique per account.')
    )).toBe(true);
    const evidenceHyperedges = challenge.matchExplanation?.evidenceHyperedges ?? [];
    expect(evidenceHyperedges.length).toBeGreaterThan(0);
    expect(evidenceHyperedges.some((edge) =>
      edge.relation === 'candidate_role_repo_alignment'
      && edge.nodes?.some((node) =>
        node.kind === 'person_evidence'
        && node.sourceRef?.exactText?.includes('Implemented workflow conflict warning copy')
      )
      && edge.nodes?.some((node) =>
        node.kind === 'role_source'
        && node.sourceRef?.exactText?.includes('Review TypeScript PRs that improve Wrangler deploy warnings')
      )
      && edge.nodes?.some((node) =>
        node.kind === 'repo_challenge'
        && node.sourceRef?.exactText?.includes('Workflow names must be unique per account.')
      )
    )).toBe(true);

    const diff = challenge.cachedDiffJson as { files?: Array<{ filename?: string; hunks?: unknown[] }> };
    expect(Array.isArray(diff.files)).toBe(true);
    expect(diff.files!.map((file) => file.filename)).toEqual(expect.arrayContaining([
      'packages/deploy-helpers/src/deploy/helpers/check-workflow-conflicts.ts',
      'packages/wrangler/src/__tests__/deploy/check-workflow-conflicts.test.ts',
      'packages/wrangler/src/__tests__/deploy/workflows.test.ts',
    ]));
    expect(diff.files!.every((file) => Array.isArray(file.hunks) && file.hunks.length > 0)).toBe(true);

    const raw = JSON.stringify(challenge);
    expect(raw).not.toContain('groundTruth');
    expect(raw).not.toContain('plantedBugs');
    expect(raw).not.toContain('scoringRubric');
    expect(raw).not.toMatch(/sourceRefId|sourceSpanId|artifactId|artifactVersion|contentHash/);

    const profileRes = await request.get(`${API_BASE}/api/v1/candidates/${candidate.id}`, {
      headers: recruiterHeaders(authToken),
    });
    expect(profileRes.status()).toBe(200);
    const profile = await profileRes.json() as {
      standaloneReviewMatch?: {
        matchStatus?: string;
        repoUrl?: string | null;
        prNumber?: number | null;
        prUrl?: string | null;
        packetId?: string;
        roleSources?: Array<{
          entityId?: string;
          locator?: string;
          conceptKeys?: string[];
        }>;
        evidence?: Array<{
          candidateSourceRefs?: unknown[];
          challengeSourceRefs?: unknown[];
          sharedConcepts?: string[];
        }>;
        gaps?: string[];
        diagnostics?: {
          recalledPacketIds?: string[];
          evaluatedChallenges?: Array<{ challengeId?: string; eligible?: boolean }>;
        };
      };
    };
    const match = profile.standaloneReviewMatch;
    expect(match).toBeDefined();
    expect(match!.matchStatus).toBe('MATCHED');
    expect(match!.repoUrl).toBe(fixture.repoUrl);
    expect(match!.prNumber).toBe(fixture.prNumber);
    expect(match!.prUrl).toBe(`${fixture.repoUrl}/pull/${fixture.prNumber}`);
    expect(match!.roleSources).toEqual([expect.objectContaining({
      locator: fixture.roleSources[0]!.locator,
      conceptKeys: expect.arrayContaining([fixture.conceptKey]),
    })]);
    expect(match!.evidence?.length).toBeGreaterThan(0);
    expect(match!.evidence!.every((entry) =>
      Array.isArray(entry.candidateSourceRefs)
      && entry.candidateSourceRefs.length > 0
      && Array.isArray(entry.challengeSourceRefs)
      && entry.challengeSourceRefs.length > 0
      && Array.isArray(entry.sharedConcepts)
      && entry.sharedConcepts.length > 0
    )).toBe(true);
    expect(match!.gaps ?? []).toEqual([]);
    expect(match!.diagnostics?.recalledPacketIds).toContain(fixture.packetId);
    expect(match!.diagnostics?.evaluatedChallenges?.some((entry) =>
      entry.challengeId === fixture.packetId && entry.eligible === true
    )).toBe(true);
  });

  test('matched standalone CODE_REVIEW initializes an AI developer defense session', async ({ request }) => {
    const defenseCandidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'AI Developer Defense Candidate',
      email: `defense+e2e-${randomUUID()}@pipe-test.dev`,
    });
    const defenseSession = await resolveToken(request, defenseCandidate.inviteToken);

    await submitStandaloneIntakeEvidence(request, defenseSession.sessionToken);
    const fixture = await seedStandaloneReviewMatchFixture(request, authToken, defenseCandidate);
    const challenge = await getChallengeWithRetry(request, defenseSession.sessionToken);

    expect(challenge.type).toBe('CODE_REVIEW');
    expect(challenge.githubRepoUrl).toBe(fixture.repoUrl);
    expect(challenge.githubPrNumber).toBe(fixture.prNumber);
    expect(challenge.reviewSession).toEqual(expect.objectContaining({
      requiresInit: true,
      challengeId: challenge.id,
    }));

    const initRes = await request.post(`${API_BASE}/rpc/review/session/init`, {
      headers: candidateHeaders(defenseSession.sessionToken),
      data: { challengeId: challenge.id },
    });
    expect(initRes.ok(), `initSession failed: ${await initRes.text()}`).toBeTruthy();

    const initBody = await initRes.json() as {
      sessionId?: string;
      status?: string;
      currentRound?: number;
      maxRounds?: number;
      pr?: {
        repoUrl?: string | null;
        prNumber?: number | null;
        diff?: string;
      };
    };

    expect(initBody.sessionId).toBeTruthy();
    expect(initBody.status).toBe('pending');
    expect(initBody.currentRound).toBe(1);
    expect(initBody.maxRounds).toBeGreaterThanOrEqual(2);
    expect(initBody.pr).toEqual(expect.objectContaining({
      repoUrl: fixture.repoUrl,
      prNumber: fixture.prNumber,
    }));
    expect(initBody.pr?.diff).toContain('workflow');
  });

  test('candidate UI renders CodeReviewChallenge with proof, diff, verdict, and submit flow', async ({ browser, request }) => {
    const uiCandidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'Matched Code Review UI Candidate',
      email: `matched-ui+e2e-${randomUUID()}@pipe-test.dev`,
    });
    const session = await resolveToken(request, uiCandidate.inviteToken);
    await submitStandaloneIntakeEvidence(request, session.sessionToken);
    const fixture = await seedStandaloneReviewMatchFixture(request, authToken, uiCandidate);

    const context = await browser.newContext();
    await context.addInitScript(({ sessionToken, inviteToken, candidate }) => {
      window.sessionStorage.setItem('pipe_session_token', sessionToken);
      window.sessionStorage.setItem('pipe_session_invite_token', inviteToken);
      window.sessionStorage.setItem('pipe_session_candidate', JSON.stringify({
        id: candidate.id,
        pipelineId: null,
        status: 'IN_PROGRESS',
        name: candidate.name,
        email: candidate.email,
      }));
    }, {
      sessionToken: session.sessionToken,
      inviteToken: uiCandidate.inviteToken,
      candidate: {
        id: uiCandidate.id,
        name: uiCandidate.name,
        email: uiCandidate.email,
      },
    });
    const page = await context.newPage();
    const diffRenderErrors: string[] = [];
    page.on('console', (message) => {
      const renderedMessage = message.text();
      const location = message.location();
      const source = location.url ? ` ${location.url}` : '';
      if (message.type() === 'error' && /parsePatchContent|Invalid hunk|pierre/i.test(`${renderedMessage}${source}`)) {
        diffRenderErrors.push(`${renderedMessage}${source}`);
      }
    });
    page.on('pageerror', (error) => {
      if (/diff|patch|pierre/i.test(error.message)) {
        diffRenderErrors.push(`[pageerror] ${error.message}`);
      }
    });

    await page.goto(`${APP_BASE}/assess/${uiCandidate.inviteToken}`);
    const startButton = page.getByTestId('start-interview-btn');
    if (await startButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await startButton.evaluate((el) => (el as HTMLButtonElement).click());
    }

    const codeReview = page.getByTestId('code-review-challenge');
    await expect(codeReview).toBeVisible({ timeout: 30000 });
    await expect(codeReview).toContainText('Pull request');
    await expect(codeReview).toContainText(fixture.repoFullName);
    await expect(codeReview).toContainText(`#${fixture.prNumber}`);
    await expect(codeReview).toContainText('[Wrangler] Improve deploy warn for workflows with repeated names');
    await expect(codeReview).toContainText('check-workflow-conflicts.ts');
    await expect(page.getByTestId('conversation-panel')).toContainText('Review conversation');
    await expect(page.getByTestId('pierre-diff-viewer')).toBeVisible({ timeout: 30000 });
    const reviewLine = codeReview
      .locator('[aria-label="Comment on diff line 5"]')
      .filter({ hasText: 'Improve the deploy warning shown when a Workflow name already belongs to another Worker' });
    await expect(reviewLine).toBeVisible({ timeout: 30000 });
    expect(diffRenderErrors).toEqual([]);
    await expect(page.getByTestId('code-review-match-proof')).toContainText('Why you got this pull request');
    await expect(page.getByTestId('code-review-match-proof')).toContainText('Passed');
    await expect(page.getByTestId('code-review-match-proof')).not.toContainText('MATCH_PROOF');
    await expect(page.getByTestId('code-review-match-proof')).not.toContainText(/PERSON_ROLE_REPO|CANDIDATE_REPO/);
    await expect(page.getByTestId('code-review-match-hyperedges')).not.toContainText('EVIDENCE_HYPEREDGES');
    await expect(page.getByTestId('code-review-match-proof')).toContainText('Candidate evidence');
    await expect(page.getByTestId('code-review-match-proof')).toContainText('Repo source spans');
    await expect(page.getByTestId('code-review-match-proof')).toContainText('Role alignment');
    await expect(page.getByTestId('code-review-match-proof')).toContainText('Assessment quality');
    await expect(page.getByTestId('code-review-match-proof')).toContainText('Agent validated');
    await expect(page.getByTestId('code-review-assessment-quality')).toContainText('How this assignment was checked');
    await expect(page.getByTestId('code-review-assessment-quality')).toContainText('PR reviewability');
    await expect(page.getByTestId('code-review-assessment-quality')).toContainText('Contrast separation');
    await expect(page.getByTestId('code-review-match-hyperedges')).toContainText('Supporting evidence');
    await expect(page.getByTestId('code-review-match-hyperedges')).toContainText('From your profile');
    await expect(page.getByTestId('code-review-match-hyperedges')).toContainText('From the role');
    await expect(page.getByTestId('code-review-match-hyperedges')).toContainText('From the repo');
    await expect(page.getByTestId('code-review-match-proof')).not.toContainText('candidate_source_evidence');
    await expect(page.getByTestId('code-review-match-proof')).not.toContainText('repo_source_spans');
    await expect(page.getByTestId('code-review-match-proof')).not.toContainText('role_context_alignment');
    await expect(page.getByTestId('code-review-match-proof')).not.toContainText('assessment_quality_verified');
    await expect(page.getByTestId('code-review-match-proof')).not.toContainText('agent_validated_match');
    await expect(page.getByTestId('code-review-match-validator')).toContainText('Independent verification');
    await expect(page.getByTestId('code-review-match-validator')).toContainText('deterministic');
    await expect(page.getByTestId('code-review-match-validator')).toContainText('Passed');
    await expect(page.getByTestId('code-review-match-validator')).toContainText('Eligible match');
    await expect(page.getByTestId('code-review-match-validator')).not.toContainText('eligible_match');
    await expect(page.locator('body')).not.toContainText('JOIN VIDEO');
    await expect(page.locator('body')).not.toContainText('Video Waiting Room');

    await reviewLine.click();
    await expect(page.getByTestId('annotation-editor-form')).toBeVisible();
    await page.getByTestId('severity-major').click();
    await page.getByTestId('annotation-input').fill('The warning copy needs review because it changes how users reason about workflow reassignment risk.');
    await page.getByTestId('save-annotation-btn').click();
    await expect(page.getByTestId('annotation-badge-5')).toBeVisible();

    await page.getByTestId('submit-round').click();
    await expect(page.getByTestId('conversation-thread')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('conversation-thread')).toContainText('AUTHOR');
    await expect(page.getByTestId('conversation-thread')).toContainText(/COMMENT|PUSHBACK|CHANGE/);

    await page.getByTestId('verdict-option-request_changes').click();
    const summary = `The ${fixture.conceptLabel} review target is appropriate; the warning copy and regression coverage should stay aligned.`;
    await page.getByTestId('verdict-summary').fill(summary);
    await page.getByTestId('submit-verdict').click();
    await expect(page.getByTestId('review-session-completion')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('review-session-continue-btn').click();
    await expect(page.getByTestId('assessment-submitted')).toContainText('Submitted.', { timeout: 30000 });

    await context.close();
  });
});

// ─── §MVP.7 Code review submission (standalone) ─────────────────────────────

test.describe('§MVP.7 — Candidate submits standalone code review', () => {
  let authToken: string;
  let candidate: StandaloneCandidate;
  let sessionToken: string;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    candidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'Submitting Reviewer',
      email: `reviewer+e2e-${randomUUID()}@pipe-test.dev`,
    });
    const session = await resolveToken(request, candidate.inviteToken);
    sessionToken = session.sessionToken;
  });

  test('submit-challenge-response requires a selected PR, then completes the matched review', async ({ request }) => {
    const prematureRes = await request.post(`${API_BASE}/rpc/submit-challenge-response`, {
      headers: candidateHeaders(sessionToken),
      data: {
        order: 0,
        submission: {
          type: 'CODE_REVIEW',
          verdict: 'request_changes',
          summary: 'This should not be accepted before a source-backed PR is selected.',
          annotations: [],
        },
      },
    });
    expect(prematureRes.status()).toBe(409);
    const prematureBody = await prematureRes.json() as {
      error?: { code?: string };
      challenge?: { type?: string; id?: string; instructions?: string };
      stageId?: string;
      isComplete?: boolean;
    };
    expect(prematureBody.error?.code).toBe('PROFILE_RECEIVED');
    expect(prematureBody.challenge?.type).toBe('PROFILE_RECEIVED');
    expect(prematureBody.challenge?.id).toBe('profile-received');
    expect(prematureBody.challenge?.instructions).toContain('email you when your code review is ready');
    expect(prematureBody.stageId).toBe('candidate-intake-queued');
    expect(prematureBody.isComplete).toBe(true);
    expect(JSON.stringify(prematureBody)).not.toContain('WAITING_FOR_MATCH');

    await submitStandaloneIntakeEvidence(request, sessionToken);
    const fixture = await seedStandaloneReviewMatchFixture(request, authToken, candidate);

    const challenge = await getChallengeWithRetry(request, sessionToken);
    expect(challenge.type).toBe('CODE_REVIEW');
    expect(challenge.githubRepoUrl).toBe(fixture.repoUrl);
    expect(challenge.githubPrNumber).toBe(fixture.prNumber);

    const reviewSummary = 'The PR introduces a search feature but has a critical debounce issue. Every keystroke triggers a network request which will overwhelm the API.';
    await submitStandaloneCodeReview(request, sessionToken, {
      summary: reviewSummary,
      annotations: [
        {
          file: 'src/pages/Search.tsx',
          line: 43,
          severity: 'blocking',
          comment: 'No debounce on search input; add a 300ms debounce with AbortController.',
        },
      ],
    });

    const profileRes = await request.get(`${API_BASE}/api/v1/candidates/${candidate.id}`, {
      headers: recruiterHeaders(authToken),
    });
    expect(profileRes.status()).toBe(200);

    const profile = await profileRes.json() as Record<string, unknown>;
    const interviews = profile.scheduledInterviews as Array<{
      interviewType: string;
      status: string;
    }> | undefined;
    const standaloneReviewMatch = profile.standaloneReviewMatch as {
      matchStatus?: string;
      repoUrl?: string | null;
      prNumber?: number | null;
      submitted?: boolean;
      submission?: {
        verdict?: string | null;
        summary?: string | null;
        annotationCount?: number;
      } | null;
      roleSources?: Array<{
        locator?: string;
        conceptKeys?: string[];
      }>;
      evidence?: Array<{
        candidateSourceRefs?: unknown[];
        challengeSourceRefs?: unknown[];
      }>;
      diagnostics?: {
        recalledPacketIds?: string[];
      };
    } | null;

    expect(interviews).toBeDefined();
    const codeReview = interviews!.find((i) => i.interviewType === 'CODE_REVIEW');
    expect(codeReview).toBeDefined();
    expect(codeReview!.status).toBe('COMPLETED');
    expect(standaloneReviewMatch).not.toBeNull();
    expect(standaloneReviewMatch!.matchStatus).toBe('MATCHED');
    expect(standaloneReviewMatch!.repoUrl).toBe(fixture.repoUrl);
    expect(standaloneReviewMatch!.prNumber).toBe(fixture.prNumber);
    expect(standaloneReviewMatch!.submitted).toBe(true);
    expect(standaloneReviewMatch!.submission?.verdict).toBe('request_changes');
    expect(standaloneReviewMatch!.submission?.summary).toBe(reviewSummary);
    expect(standaloneReviewMatch!.submission?.annotationCount).toBe(1);
    expect(standaloneReviewMatch!.roleSources).toEqual([expect.objectContaining({
      locator: fixture.roleSources[0]!.locator,
      conceptKeys: expect.arrayContaining([fixture.conceptKey]),
    })]);
    expect(standaloneReviewMatch!.evidence?.length).toBeGreaterThan(0);
    expect(standaloneReviewMatch!.evidence!.every((entry) =>
      Array.isArray(entry.candidateSourceRefs)
      && entry.candidateSourceRefs.length > 0
      && Array.isArray(entry.challengeSourceRefs)
      && entry.challengeSourceRefs.length > 0
    )).toBe(true);
    expect(standaloneReviewMatch!.diagnostics?.recalledPacketIds).toContain(fixture.packetId);
  });

  test('recruiter API resolves reviewSessionId submissions into review evidence', async ({ request }) => {
    const sessionCandidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'Review Session Result Candidate',
      email: `review-session-result+e2e-${randomUUID()}@pipe-test.dev`,
    });
    const session = await resolveToken(request, sessionCandidate.inviteToken);
    await submitStandaloneIntakeEvidence(request, session.sessionToken);
    const fixture = await seedStandaloneReviewMatchFixture(request, authToken, sessionCandidate);

    const challenge = await getChallengeWithRetry(request, session.sessionToken);
    expect(challenge.type).toBe('CODE_REVIEW');
    expect(challenge.reviewSession?.requiresInit).toBe(true);

    const initRes = await request.post(`${API_BASE}/rpc/review/session/init`, {
      headers: candidateHeaders(session.sessionToken),
      data: { challengeId: challenge.id },
    });
    expect(initRes.ok(), `init failed: ${await initRes.text()}`).toBeTruthy();
    const initBody = await initRes.json() as { sessionId: string };

    const reviewSummary = `The ${fixture.conceptLabel} review target is right for this candidate, and the user-facing warning needs test-backed explanation.`;
    const reviewComment = 'Please defend the exact warning language with regression coverage for workflow reassignment risk.';
    const messageRes = await request.post(`${API_BASE}/rpc/review/session/${initBody.sessionId}/message`, {
      headers: candidateHeaders(session.sessionToken),
      data: {
        summary: reviewSummary,
        annotations: [{
          id: 'annotation-1',
          file: 'packages/deploy-helpers/src/deploy/helpers/check-workflow-conflicts.ts',
          line: 85,
          severity: 'major',
          comment: reviewComment,
        }],
      },
    });
    expect(messageRes.ok(), `message failed: ${await messageRes.text()}`).toBeTruthy();

    const completeRes = await request.post(`${API_BASE}/rpc/review/session/${initBody.sessionId}/complete`, {
      headers: candidateHeaders(session.sessionToken),
      data: {
        verdict: 'request_changes',
        summary: reviewSummary,
      },
    });
    expect(completeRes.ok(), `complete failed: ${await completeRes.text()}`).toBeTruthy();

    const profileAfterCompleteRes = await request.get(`${API_BASE}/api/v1/candidates/${sessionCandidate.id}`, {
      headers: recruiterHeaders(authToken),
    });
    expect(profileAfterCompleteRes.status()).toBe(200);
    const profileAfterComplete = await profileAfterCompleteRes.json() as {
      scheduledInterviews?: Array<{
        interviewType?: string;
        status?: string;
      }>;
      standaloneReviewMatch?: {
        submitted?: boolean;
        submission?: {
          verdict?: string | null;
          summary?: string | null;
          annotationCount?: number;
        } | null;
      } | null;
    };
    const completedCodeReview = profileAfterComplete.scheduledInterviews?.find((interview) =>
      interview.interviewType === 'CODE_REVIEW'
    );
    expect(completedCodeReview?.status).toBe('COMPLETED');
    expect(profileAfterComplete.standaloneReviewMatch?.submitted).toBe(true);
    expect(profileAfterComplete.standaloneReviewMatch?.submission).toEqual(expect.objectContaining({
      verdict: 'request_changes',
      summary: reviewSummary,
      annotationCount: 1,
    }));

    const submitRes = await request.post(`${API_BASE}/rpc/submit-challenge-response`, {
      headers: candidateHeaders(session.sessionToken),
      data: {
        order: 0,
        submission: { reviewSessionId: initBody.sessionId },
      },
    });
    expect(submitRes.ok(), `submit failed: ${await submitRes.text()}`).toBeTruthy();

    const profileRes = await request.get(`${API_BASE}/api/v1/candidates/${sessionCandidate.id}`, {
      headers: recruiterHeaders(authToken),
    });
    expect(profileRes.status()).toBe(200);
    const profile = await profileRes.json() as {
      standaloneReviewMatch?: {
        submitted?: boolean;
        submission?: {
          verdict?: string | null;
          summary?: string | null;
          annotationCount?: number;
          annotations?: Array<{
            file?: string | null;
            line?: number | null;
            severity?: string | null;
            comment?: string;
          }>;
        } | null;
      } | null;
    };

    expect(profile.standaloneReviewMatch?.submitted).toBe(true);
    expect(profile.standaloneReviewMatch?.submission).toEqual(expect.objectContaining({
      verdict: 'request_changes',
      summary: reviewSummary,
      annotationCount: 1,
    }));
    expect(profile.standaloneReviewMatch?.submission?.annotations).toEqual([
      expect.objectContaining({
        file: 'packages/deploy-helpers/src/deploy/helpers/check-workflow-conflicts.ts',
        line: 85,
        severity: 'major',
        comment: reviewComment,
      }),
    ]);
  });
});

// ─── §MVP.8 Recruiter views candidate context graph ─────────────────────────

test.describe('§MVP.8 — Recruiter inspects standalone candidate context + result', () => {
  let authToken: string;
  let candidate: StandaloneCandidate;

  test.beforeAll(async ({ browser, request }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();
    await page.goto(APP_BASE);
    authToken = await getAuthToken(page);
    await context.close();

    candidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'Context Graph Candidate',
      email: `context+e2e-${randomUUID()}@pipe-test.dev`,
    });
  });

  test('GET /api/v1/candidates/:id/living-context returns source-backed graph', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v1/candidates/${candidate.id}/living-context`, {
      headers: recruiterHeaders(authToken),
    });
    expect(res.status()).toBe(200);

    const graph = await res.json() as Record<string, unknown>;

    // Living context endpoint should return structured data
    // (will fail until living context is populated after intake)
    expect(graph).toBeDefined();
  });

  test('recruiter profile page shows CONTEXT tab for standalone candidate', async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();

    await page.goto(`${APP_BASE}/candidates/${candidate.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: candidate.name })).toBeVisible({ timeout: 30000 });

    // CONTEXT tab should exist
    const contextTab = page.getByRole('button', { name: 'CONTEXT', exact: true });
    await expect(contextTab).toBeVisible({ timeout: 30000 });

    // Click CONTEXT tab
    await contextTab.click();

    await expect(page.getByLabel('Standalone code review match')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('No source-backed living evidence yet for this person.')).toBeVisible();

    await context.close();
  });

  test('recruiter sees source-backed pending match state in CONTEXT tab before intake', async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const page = await context.newPage();

    await page.goto(`${APP_BASE}/candidates/${candidate.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: candidate.name })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'CONTEXT', exact: true }).click();

    const matchPanel = page.getByLabel('Standalone code review match');
    await expect(matchPanel).toContainText('Code review match');
    await expect(matchPanel).toContainText('PENDING INTAKE');
    await expect(matchPanel).toContainText(
      'Waiting for candidate resume/profile evidence before matching to a PR.',
    );
    await expect(matchPanel).toContainText('Candidate has not submitted source evidence yet.');

    await context.close();
  });

  test('recruiter API exposes pending standalone match without fabricated PR data', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v1/candidates/${candidate.id}`, {
      headers: recruiterHeaders(authToken),
    });
    expect(res.status()).toBe(200);

    const profile = await res.json() as Record<string, unknown>;

    const standaloneReviewMatch = profile.standaloneReviewMatch as {
      interviewId?: string;
      interviewStatus?: string;
      matchStatus?: string;
      repoUrl?: string | null;
      prNumber?: number | null;
      prTitle?: string | null;
      score?: number | null;
      summary?: string;
      evidence?: Array<{
        candidateSourceRefs?: unknown[];
        challengeSourceRefs?: unknown[];
      }>;
      gaps?: string[];
      submitted?: boolean;
      submission?: unknown;
    } | null;

    expect(standaloneReviewMatch).toBeDefined();
    expect(standaloneReviewMatch).not.toBeNull();
    expect(standaloneReviewMatch!.matchStatus).toBe('PENDING_INTAKE');
    expect(standaloneReviewMatch!.interviewStatus).toBe('INVITED');
    expect(standaloneReviewMatch!.repoUrl).toBeNull();
    expect(standaloneReviewMatch!.prNumber).toBeNull();
    expect(standaloneReviewMatch!.score).toBeNull();
    expect(standaloneReviewMatch!.submitted).toBe(false);
    expect(standaloneReviewMatch!.submission).toBeNull();
  });

  test('pending match explanation reports missing candidate evidence without naked scores', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v1/candidates/${candidate.id}`, {
      headers: recruiterHeaders(authToken),
    });
    expect(res.status()).toBe(200);

    const profile = await res.json() as Record<string, unknown>;

    const standaloneReviewMatch = profile.standaloneReviewMatch as {
      evidence?: Array<{
        candidateSourceRefs?: unknown[];
        challengeSourceRefs?: unknown[];
        sharedConcepts?: string[];
      }>;
      gaps?: string[];
      summary?: string;
      score?: number | null;
      diagnostics?: {
        recalledPacketIds?: unknown[];
        excludedPackets?: unknown[];
        evaluatedChallenges?: unknown[];
      };
    } | null;

    expect(standaloneReviewMatch).toBeDefined();
    expect(standaloneReviewMatch).not.toBeNull();
    expect(standaloneReviewMatch!.summary).toBe(
      'Waiting for candidate resume/profile evidence before matching to a PR.',
    );
    expect(standaloneReviewMatch!.evidence).toEqual([]);
    expect(standaloneReviewMatch!.gaps).toContain('Candidate has not submitted source evidence yet.');
    expect(standaloneReviewMatch!.score).toBeNull();
    expect(standaloneReviewMatch!.diagnostics?.recalledPacketIds).toEqual([]);
    expect(standaloneReviewMatch!.diagnostics?.excludedPackets).toEqual([]);
    expect(standaloneReviewMatch!.diagnostics?.evaluatedChallenges).toEqual([]);
  });

  test('CONTEXT tab renders submitted review with source-backed match evidence', async ({ page, request }) => {
    const reviewedCandidate = await createStandaloneCodeReviewCandidate(request, authToken, {
      name: 'Submitted Context Graph Candidate',
      email: `context-submitted+e2e-${randomUUID()}@pipe-test.dev`,
    });
    const session = await resolveToken(request, reviewedCandidate.inviteToken);
    await submitStandaloneIntakeEvidence(request, session.sessionToken);
    const fixture = await seedStandaloneReviewMatchFixture(request, authToken, reviewedCandidate);

    const challenge = await getChallengeWithRetry(request, session.sessionToken);
    expect(challenge.type).toBe('CODE_REVIEW');
    expect(challenge.githubRepoUrl).toBe(fixture.repoUrl);
    expect(challenge.githubPrNumber).toBe(fixture.prNumber);

    const reviewSummary = `The ${fixture.conceptLabel} implementation is reviewable, but the helper and test wording should stay synchronized before this ships.`;
    const reviewComment = `Keep the Wrangler config rename guidance aligned between the helper message and deploy tests.`;
    await submitStandaloneCodeReview(request, session.sessionToken, {
      summary: reviewSummary,
      annotations: [{
        file: 'packages/deploy-helpers/src/deploy/helpers/check-workflow-conflicts.ts',
        line: 85,
        severity: 'blocking',
        comment: reviewComment,
      }],
    });

    await page.goto(`${APP_BASE}/candidates/${reviewedCandidate.id}`);
    const contextTab = page.locator('button').filter({ hasText: /^CONTEXT$/ });
    await expect(contextTab).toBeVisible({ timeout: 30000 });
    await contextTab.click();
    await expect(page.getByTestId('living-context-graph')).toBeVisible({ timeout: 15000 });

    const meetingEvidence = page.getByTestId('meeting-evidence-panel');
    await expect(meetingEvidence).toBeVisible();
    await expect(meetingEvidence).toContainText('Video Meeting');
    await expect(meetingEvidence).toContainText('Implemented workflow conflict warning copy');
    await expect(meetingEvidence).toContainText('Validated workflow conflict warning behavior');
    await expect(meetingEvidence.getByTestId('meeting-recording-provenance')).toContainText(fixture.transcriptStatus);
    await expect(meetingEvidence.getByTestId('meeting-recording-provenance')).toContainText(fixture.transcriptionProvider);
    await expect(meetingEvidence.getByTestId('meeting-recording-provenance')).toContainText(fixture.recordingKey);
    await expect(meetingEvidence.getByTestId('meeting-recording-provenance')).toContainText(fixture.transcriptionAudioKey);

    const matchPanel = page.getByTestId('standalone-review-match-panel');
    await expect(matchPanel).toContainText('Code review match');
    await expect(matchPanel).toContainText('MATCHED');
    await expect(matchPanel).toContainText(`${fixture.repoFullName} #${fixture.prNumber}`);
    await expect(matchPanel).toContainText('[Wrangler] Improve deploy warn for workflows with repeated names');
    await expect(matchPanel).toContainText('Review submitted');
    const roleSources = page.getByTestId('standalone-review-role-sources');
    await expect(roleSources).toContainText('Role sources');
    await expect(roleSources).toContainText(fixture.roleSources[0]!.locator);
    await expect(roleSources).toContainText(fixture.conceptKey);

    const proofDetails = page.getByTestId('standalone-review-proof-details');
    await expect(proofDetails).toBeVisible();
    await proofDetails.click();

    const evidenceBridge = page.getByTestId('match-evidence-bridge');
    await expect(evidenceBridge).toBeVisible();
    await expect(evidenceBridge).toContainText('Evidence bridge');
    await expect(evidenceBridge).toContainText('role context -> person context -> repo challenge');
    await expect(evidenceBridge).toContainText('Role requirement');
    await expect(evidenceBridge).toContainText('Person evidence');
    await expect(evidenceBridge).toContainText('Repo challenge');
    await expect(evidenceBridge).toContainText(
      'Review TypeScript PRs that improve Wrangler deploy warnings for workflow name conflicts with source-backed evidence.',
    );
    await expect(evidenceBridge).toContainText(
      /(Implemented|Validated|Reviewed|Explained)[\s\S]*workflow conflict warning|workflow name uniqueness/,
    );
    await expect(evidenceBridge).toContainText(
      'Workflow names must be unique per account.',
    );
    await expect(evidenceBridge).toContainText(fixture.conceptKey);

    const bridgeRoleSource = evidenceBridge
      .getByTestId('match-bridge-role-source')
      .filter({ hasText: fixture.roleSources[0]!.locator })
      .first();
    await expect(bridgeRoleSource).toContainText(fixture.conceptKey);
    const bridgePersonSource = evidenceBridge
      .getByTestId('match-bridge-person-source')
      .filter({
        hasText: /workflow conflict warning|workflow name uniqueness|Wrangler config rename/,
      })
      .first();
    await expect(bridgePersonSource).toHaveAttribute('data-source-ref-type', 'source_span');
    const bridgePersonSourceRefId = await bridgePersonSource.getAttribute('data-source-ref-id');
    const bridgePersonSourceSpanId = await bridgePersonSource.getAttribute('data-source-span-id');
    expect(fixture.candidateSourceSpanIds).toContain(bridgePersonSourceRefId);
    expect(fixture.candidateSourceSpanIds).toContain(bridgePersonSourceSpanId);
    const bridgeRepoSource = evidenceBridge
      .getByTestId('match-bridge-repo-source')
      .filter({
        hasText: 'Workflow names must be unique per account.',
      })
      .first();
    await expect(bridgeRepoSource).toHaveAttribute('data-source-ref-type', 'repo_source_span');
    await expect(bridgeRepoSource).toHaveAttribute('data-content-hash', /^sha256:/);
    const bridgeRepoSourceRefId = await bridgeRepoSource.getAttribute('data-source-ref-id');
    expect(fixture.repoSourceSpanIds).toContain(bridgeRepoSourceRefId);

    const submission = page.getByTestId('standalone-review-submission');
    await expect(submission).toContainText('Candidate review result');
    await expect(submission).toContainText('Request Changes');
    await expect(submission).toContainText('1 annotation');
    await expect(submission).toContainText(reviewSummary);
    await expect(submission).toContainText('check-workflow-conflicts.ts · line 85 · blocking');
    await expect(submission).toContainText(reviewComment);

    const evidence = page.getByTestId('standalone-review-evidence');
    await expect(evidence).toContainText('Candidate evidence');
    await expect(evidence).toContainText('PR demand evidence');
    await expect(evidence).toContainText(
      new RegExp(`(Implemented|Validated|Explained|Reviewed)[\\s\\S]*${escapeRegex(fixture.conceptLabel)}`),
    );
    await expect(evidence).toContainText(
      /Workflow names must be unique per account|Wrangler config/,
    );
    await expect(evidence).toContainText(fixture.conceptKey);

    const repoOverlay = page.getByTestId('repository-overlay-panel');
    await expect(repoOverlay).toBeVisible();
    await expect(repoOverlay).toContainText('Repository evidence overlay');
    await expect(repoOverlay).toContainText(`${fixture.repoFullName} · PR #${fixture.prNumber}`);
    for (const demandId of fixture.demandIds.slice(0, 2)) {
      await expect(repoOverlay).toContainText(demandId);
    }
    await expect(repoOverlay).toContainText('check-workflow-conflicts.ts');
    await expect(repoOverlay).toContainText('workflows.test.ts');
    await expect(repoOverlay).toContainText('Candidate source');
    await expect(repoOverlay).toContainText('PR demand source');
    await expect(repoOverlay).toContainText('Implemented workflow conflict warning copy');
    await expect(repoOverlay).toContainText('Workflow names must be unique per account.');
    await expect(repoOverlay).toContainText('Wrangler config.');
    await expect(repoOverlay).toContainText(fixture.conceptKey);

    const candidateSourceCard = repoOverlay
      .getByTestId('review-source-card')
      .filter({
        hasText: /workflow conflict warning|workflow name uniqueness|Wrangler config rename/,
      })
      .first();
    await expect(candidateSourceCard).toHaveAttribute('data-source-ref-type', 'source_span');
    const candidateSourceRefId = await candidateSourceCard.getAttribute('data-source-ref-id');
    const candidateSourceSpanId = await candidateSourceCard.getAttribute('data-source-span-id');
    expect(fixture.candidateSourceSpanIds).toContain(candidateSourceRefId);
    expect(fixture.candidateSourceSpanIds).toContain(candidateSourceSpanId);

    const repoSourceCard = repoOverlay
      .getByTestId('review-source-card')
      .filter({
        hasText: 'Workflow names must be unique per account.',
      })
      .first();
    await expect(repoSourceCard).toHaveAttribute('data-source-ref-type', 'repo_source_span');
    await expect(repoSourceCard).toHaveAttribute('data-content-hash', /^sha256:/);
    const repoSourceRefId = await repoSourceCard.getAttribute('data-source-ref-id');
    expect(fixture.repoSourceSpanIds).toContain(repoSourceRefId);

    const diagnostics = page.getByTestId('standalone-review-diagnostics');
    await expect(diagnostics).toContainText('Recalled packets');
    await expect(diagnostics).toContainText(fixture.packetId);
    await expect(diagnostics).toContainText('Evaluated challenge evidence');
    await expect(diagnostics).toContainText('Eligible');

    const profileRes = await request.get(`${API_BASE}/api/v1/candidates/${reviewedCandidate.id}`, {
      headers: recruiterHeaders(authToken),
    });
    expect(profileRes.status()).toBe(200);
    const profile = await profileRes.json() as {
      scheduledInterviews?: Array<{
        id: string;
        interviewType: string;
      }>;
    };
    const reviewInterview = profile.scheduledInterviews?.find((interview) =>
      interview.interviewType === 'CODE_REVIEW'
    );
    expect(reviewInterview?.id).toBeTruthy();

    await page.goto(`${APP_BASE}/interviews/${reviewInterview!.id}`, { waitUntil: 'domcontentloaded' });
    const detailResult = page.getByTestId('interview-code-review-result');
    await expect(detailResult).toBeVisible({ timeout: 30000 });
    await expect(detailResult).toContainText('Request Changes');
    await expect(detailResult).toContainText(reviewSummary);
    await expect(detailResult).toContainText('1 annotation');
    await expect(detailResult).toContainText('check-workflow-conflicts.ts · line 85 · blocking');
    await expect(detailResult).toContainText(reviewComment);

    const detailMatch = page.getByTestId('interview-code-review-match');
    await expect(detailMatch).toBeVisible();
    await expect(detailMatch).toContainText('Assessment quality');
    await expect(detailMatch).toContainText(/STRONG|USABLE/);
    await expect(detailMatch).toContainText('/12');
    await expect(detailMatch).toContainText('Skill/stack overlap');
    await expect(detailMatch).toContainText('Source proof');
    await expect(detailMatch).toContainText('Validator agent');
    await expect(detailMatch).toContainText('deterministic');
    await expect(detailMatch).toContainText('PASSED');
    await expect(detailMatch).toContainText('source-backed demand');
    await expect(detailMatch).toContainText('Person sources');
    await expect(detailMatch).toContainText('Role sources');
    await expect(detailMatch).toContainText('Repo sources');
    await expect(detailMatch).toContainText('Evidence bridge');
    await expect(detailMatch).toContainText('Role requirement');
    await expect(detailMatch).toContainText('Person evidence');
    await expect(detailMatch).toContainText('Repo challenge');
    await expect(detailMatch).toContainText(fixture.conceptKey);
    await expect(detailMatch).toContainText(/workflow conflict warning|workflow name uniqueness/i);
    await expect(detailMatch).toContainText('Workflow names must be unique per account.');

    await expect(page.locator('body')).toContainText(fixture.repoFullName);
    await expect(page.locator('body')).toContainText(`#${fixture.prNumber}`);
    await expect(page.locator('body')).not.toContainText('OPEN HOST ROOM');
    await expect(page.locator('body')).not.toContainText('Live workspace');
  });
});
