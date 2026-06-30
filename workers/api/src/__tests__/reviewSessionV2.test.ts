/**
 * Unit tests for review session v2 backend endpoints.
 *
 * Drives the real rpcAuth Hono app via app.request() with a fake D1 stub.
 * Mocks callImplementerAgent so no external AI calls are made.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rpcAuth } from '../routes/rpc';
import { signJwt } from '../lib/jwt';
import type { Env } from '../types';

vi.mock('../lib/implementerAgent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/implementerAgent')>();
  return {
    ...actual,
    callImplementerAgent: vi.fn(),
  };
});

vi.mock('../lib/explainerAgent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/explainerAgent')>();
  return {
    ...actual,
    callExplainerAgent: vi.fn(),
  };
});

vi.mock('../lib/neo4j/matchingQueries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/neo4j/matchingQueries')>();
  return {
    ...actual,
    matchReposForCandidateNeo4j: vi.fn(async () => []),
  };
});

vi.mock('../lib/neo4j/contextualGraph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/neo4j/contextualGraph')>();
  return {
    ...actual,
    matchReposByGroundedEdges: vi.fn(async () => []),
  };
});

vi.mock('../lib/challengeMatching', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/challengeMatching')>();
  return {
    ...actual,
    matchCandidateToReviewChallenge: vi.fn(async () => ({
      status: 'NO_ROLE_SAFE_CHALLENGE',
      repoId: null,
      prNumber: null,
      explanation: undefined,
    })),
  };
});

vi.mock('../lib/candidateDiscovery/orchestrate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/candidateDiscovery/orchestrate')>();
  return {
    ...actual,
    runCandidateIngestion: vi.fn(async () => undefined),
  };
});

import { AiDeveloperUnavailableError, callImplementerAgent } from '../lib/implementerAgent';
import { ExplainerAgentUnavailableError, callExplainerAgent } from '../lib/explainerAgent';
import { matchReposForCandidateNeo4j } from '../lib/neo4j/matchingQueries';
import { matchReposByGroundedEdges } from '../lib/neo4j/contextualGraph';
import { matchCandidateToReviewChallenge } from '../lib/challengeMatching';
import { runCandidateIngestion } from '../lib/candidateDiscovery/orchestrate';

// ─── Fake D1 ─────────────────────────────────────────────────────────────────

interface PreparedCall {
  sql: string;
  params: unknown[];
  ran: boolean;
  firstResult: unknown;
}

interface FakeD1Config {
  firstResponders?: Array<{ match: string; value: unknown }>;
  allResponders?: Array<{ match: string; value: unknown[] }>;
}

interface FakeD1 extends D1Database {
  __calls: PreparedCall[];
}

function fakeD1(cfg: FakeD1Config = {}): FakeD1 {
  const calls: PreparedCall[] = [];

  const prepare = (sql: string): D1PreparedStatement => {
    const call: PreparedCall = { sql, params: [], ran: false, firstResult: null };
    calls.push(call);

    const stmt = {
      bind: (...params: unknown[]) => {
        call.params = params;
        return stmt;
      },
      first: async () => {
        const match = (cfg.firstResponders ?? []).find((r) => sql.includes(r.match));
        const result = match ? match.value : null;
        call.firstResult = result;
        return result;
      },
      all: async () => {
        const match = (cfg.allResponders ?? []).find((r) => sql.includes(r.match));
        return {
          results: match ? match.value : [],
          success: true,
          meta: {},
        };
      },
      run: async () => {
        call.ran = true;
        return { success: true, meta: { changes: 1 } };
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement;

    return stmt;
  };

  return {
    prepare,
    dump: async () => new ArrayBuffer(0),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    __calls: calls,
  } as unknown as FakeD1;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function authHeader(candidateId = 'cand_1', pipelineId = 'pipe_1'): Promise<string> {
  const token = await signJwt({ sub: candidateId, pid: pipelineId }, 'test-secret');
  return `Bearer ${token}`;
}

async function authHeaderWithoutPipeline(candidateId = 'cand_1'): Promise<string> {
  const token = await signJwt({ sub: candidateId, pid: null }, 'test-secret');
  return `Bearer ${token}`;
}

function buildEnv(overrides: Partial<Env & { DB: FakeD1 }> = {}): Env & { DB: FakeD1 } {
  return {
    SESSION_TOKEN_SECRET: 'test-secret',
    DB: fakeD1(),
    ...overrides,
  } as Env & { DB: FakeD1 };
}

function buildCtx(): { ctx: ExecutionContext; waitUntilAll: () => Promise<void> } {
  const promises: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (promise: Promise<unknown>) => {
        promises.push(promise);
      },
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
    waitUntilAll: async () => {
      await Promise.all(promises);
    },
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CANDIDATE = { current_stage_id: 'stage_1' };

const CHALLENGE_ROW = {
  id: 'ch_1',
  config: JSON.stringify({ isMultiTurn: true, maxRounds: 4, implementerPersona: 'junior' }),
  server_config: null,
  cached_diff_json: JSON.stringify({
    files: [
      {
        filename: 'src/index.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        hunks: [
          {
            header: '@@ -1,3 +1,4 @@',
            lines: [{ type: 'added', content: 'const x = 1;', lineNumber: 1 }],
          },
        ],
      },
    ],
  }),
  instructions: 'Review this PR',
  github_pr_title: 'Add feature',
  github_pr_description: 'This PR adds a feature',
  github_repo_url: 'https://github.com/test/repo',
  github_pr_number: 1,
};

const CHALLENGE_NON_MULTITURN = {
  ...CHALLENGE_ROW,
  config: JSON.stringify({ isMultiTurn: false }),
};

const ASSIGNED_CHALLENGE_WITHOUT_SOURCE_PACKET = {
  ...CHALLENGE_ROW,
  cached_diff_json: JSON.stringify({
    files: [{
      filename: 'legacy.ts',
      hunks: [{ lines: [{ type: 'added', content: 'stale cached diff' }] }],
    }],
  }),
  github_repo_url: null,
  github_pr_number: null,
  assignment_id: 'assign_1',
  effective_repo_url: 'https://github.com/test/source-backed-repo',
  effective_pr_number: 42,
};

const ASSESSMENT_ROW = { id: 'assessment_1' };

const SESSION_PENDING = {
  id: 'sess_1',
  challenge_id: 'ch_1',
  assessment_id: 'assessment_1',
  candidate_id: 'cand_1',
  implementer_persona: 'junior',
  current_round: 0,
  max_rounds: 4,
  status: 'pending',
  transcript: JSON.stringify({ rounds: [] }),
  next_comment_id: 1,
  mode: 'bug_finding',
};

const SESSION_IN_PROGRESS = {
  id: 'sess_1',
  challenge_id: 'ch_1',
  assessment_id: 'assessment_1',
  candidate_id: 'cand_1',
  implementer_persona: 'junior',
  current_round: 1,
  max_rounds: 4,
  status: 'in_progress',
  transcript: JSON.stringify({
    rounds: [
      {
        round: 1,
        reviewer_comments: [
          {
            id: 1,
            what: 'Missing test',
            why: 'No coverage',
            category: null,
            severity: 'major',
            positive: false,
          },
        ],
        reviewer_summary: 'Initial review',
        implementer_responses: [
          { to_comment_id: 1, move: 'comment', content: 'Will add tests' },
        ],
      },
    ],
  }),
  next_comment_id: 2,
  mode: 'bug_finding',
};

const SESSION_MAX_ROUNDS = {
  ...SESSION_IN_PROGRESS,
  current_round: 4,
  max_rounds: 4,
};

const SESSION_OTHER_CANDIDATE = {
  ...SESSION_PENDING,
  candidate_id: 'cand_other',
};

function sourceBackedPacket(spanId = 'repo-span-auto'): Record<string, unknown> {
  return {
    pullRequest: {
      title: 'Source-backed review PR',
      author: 'dev',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      mergedAt: '2026-06-20T12:00:00.000Z',
      body: 'Source-backed packet body',
    },
    demands: [{ sourceSpanIds: [spanId], family: 'frontend_state' }],
  };
}

function matchValidator(prNumber: number): Record<string, unknown> {
  return {
    agentName: 'source_backed_match_validator',
    agentVersion: 'v1',
    mode: 'deterministic',
    verdict: 'PASSED',
    rationale: 'The selected PR has source-backed candidate and repository evidence.',
    checks: [{ id: 'provenance_complete', passed: true, reason: 'Candidate and repo source spans are present.' }],
    sourceBridge: {
      prNumber,
      candidateSourceCount: 1,
      repoSourceCount: 1,
      roleSourceCount: 0,
      alignedDemandCount: 1,
      stretchCount: 0,
      provenanceComplete: true,
    },
  };
}

function assessmentQuality(contrastScore: number): Record<string, unknown> {
  return {
    verdict: contrastScore > 0 ? 'STRONG' : 'USABLE',
    score: contrastScore > 0 ? 10 : 8,
    maxScore: 12,
    metrics: [
      {
        id: 'contrast_separation',
        label: 'Contrast separation',
        score: contrastScore,
        maxScore: 2,
        reason: contrastScore > 0
          ? 'The selected PR separates from comparable alternatives.'
          : 'The selected PR is a near-tie with comparable alternatives.',
      },
    ],
  };
}

function evidenceAlignment(): Record<string, unknown> {
  return {
    atomId: 'atom_frontend_state',
    demandId: 'demand_frontend_state',
    purpose: 'frontend state review',
    pairScore: 0.91,
    episodeMultiplier: 1,
    roleSourceRefs: [],
    candidateSourceRefs: [{
      sourceRefType: 'candidate_node',
      locator: 'resume:experience',
      exactText: 'Built React and TypeScript state-management systems.',
    }],
    challengeSourceRefs: [{
      sourceRefType: 'repo_source_span',
      locator: 'src/component.tsx:12',
      exactText: 'React state update code under review.',
    }],
  };
}

function persistedRankedResult(prNumber: number, contrastScore: number): Record<string, unknown> {
  return {
    repoId: 973,
    prNumber,
    eligible: true,
    score: contrastScore > 0 ? 10 : 9,
    alignedDemandCount: 1,
    stretchCount: 0,
    alignments: [evidenceAlignment()],
    assessmentQuality: assessmentQuality(contrastScore),
    validatorAgent: matchValidator(prNumber),
  };
}

function automaticMatchExplanation(prNumber: number, contrastScore: number): Record<string, unknown> {
  return {
    status: 'MATCHED',
    summary: 'Matched one source-backed frontend demand.',
    score: contrastScore > 0 ? 10 : 9,
    evidence: [evidenceAlignment()],
    roleSources: [],
    candidateSpans: [{
      atomId: 'atom_frontend_state',
      demandId: 'demand_frontend_state',
      purpose: 'frontend state review',
      sourceRefs: [{
        sourceRefType: 'candidate_node',
        locator: 'resume:experience',
        exactText: 'Built React and TypeScript state-management systems.',
      }],
    }],
    repoSpans: [{
      atomId: 'atom_frontend_state',
      demandId: 'demand_frontend_state',
      sourceRefs: [{
        sourceRefType: 'repo_source_span',
        locator: 'src/component.tsx:12',
        exactText: 'React state update code under review.',
      }],
    }],
    assessmentQuality: assessmentQuality(contrastScore),
    validatorAgent: matchValidator(prNumber),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(callImplementerAgent).mockReset();
  vi.mocked(callImplementerAgent).mockResolvedValue([
    { to_comment_id: 1, move: 'comment', content: 'Mock implementer response' },
  ]);
  vi.mocked(callExplainerAgent).mockReset();
  vi.mocked(callExplainerAgent).mockResolvedValue({
    content: 'Mock explainer response',
    context_provided: ['surrounding_code'],
    depth_level: 'surface',
  });
  vi.mocked(matchReposForCandidateNeo4j).mockClear();
  vi.mocked(matchReposByGroundedEdges).mockClear();
  vi.mocked(matchCandidateToReviewChallenge).mockReset();
  vi.mocked(matchCandidateToReviewChallenge).mockResolvedValue({
    status: 'NO_ROLE_SAFE_CHALLENGE',
    repoId: null,
    prNumber: null,
    explanation: undefined,
  } as Awaited<ReturnType<typeof matchCandidateToReviewChallenge>>);
  vi.mocked(runCandidateIngestion).mockClear();
});

// ─── POST /rpc/get-stage-config ──────────────────────────────────────────────

describe('POST /rpc/get-stage-config', () => {
  it('routes telemetry-only standalone CODE_REVIEW candidates to CV intake instead of matching', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM candidates WHERE id',
          value: {
            id: 'cand_1',
            pipeline_id: null,
            owner_id: 'owner_1',
            current_stage_id: null,
            resume_s3_key: null,
          },
        },
        {
          match: 'cn.superseded_at IS NULL',
          value: {
            resume_s3_key: null,
            raw_node_count: 111,
            node_count: 0,
          },
        },
        {
          match: 'FROM candidates c WHERE c.id',
          value: {
            resume_s3_key: null,
            node_count: 111,
          },
        },
        {
          match: "interview_type = 'CODE_REVIEW'",
          value: {
            id: 'standalone_telemetry_only',
            status: 'INVITED',
            matched_repo_id: null,
            github_repo_url: null,
            github_pr_number: null,
            submission_json: null,
          },
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/get-stage-config',
      {
        method: 'POST',
        headers: { Authorization: await authHeaderWithoutPipeline() },
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      stageId?: string;
      mode?: string;
      challenges?: Array<{ type: string; title: string }>;
      upcoming?: Array<{ type: string; title?: string }>;
    };
    expect(body.stageId).toBe('talent-pool-intake');
    expect(body.mode).toBe('INTAKE');
    expect(body.challenges?.[0]).toMatchObject({
      type: 'INTAKE',
      title: 'Profile & Resume',
    });
    expect(body.upcoming?.[0]).toMatchObject({ type: 'CODE_REVIEW' });
  });

  it('uses the newest standalone interview type while waiting for CV intake', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM candidates WHERE id',
          value: {
            id: 'cand_1',
            pipeline_id: null,
            owner_id: 'owner_1',
            current_stage_id: null,
            resume_s3_key: null,
          },
        },
        {
          match: 'FROM candidates c WHERE c.id',
          value: {
            resume_s3_key: null,
            raw_node_count: 12,
            node_count: 0,
          },
        },
        {
          match: "interview_type = 'CODE_REVIEW'",
          value: {
            id: 'new_code_review',
            status: 'INVITED',
            created_at: '2026-06-27T22:00:00.000Z',
            matched_repo_id: null,
            github_repo_url: null,
            github_pr_number: null,
            submission_json: null,
          },
        },
        {
          match: "interview_type IN ('DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX')",
          value: {
            id: 'old_dev_container',
            status: 'INVITED',
            created_at: '2026-06-27T21:00:00.000Z',
            interview_type: 'DEV_CONTAINER_CHALLENGE',
            matched_repo_id: null,
            github_repo_url: null,
            github_pr_number: null,
            submission_json: null,
          },
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/get-stage-config',
      {
        method: 'POST',
        headers: { Authorization: await authHeaderWithoutPipeline() },
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      stageTitle?: string;
      challenges?: Array<{ type: string; title: string }>;
      upcoming?: Array<{ type: string; title?: string }>;
    };
    expect(body.stageTitle).toBe('Upload Your CV');
    expect(body.challenges?.[0]).toMatchObject({ type: 'INTAKE' });
    expect(body.upcoming?.[0]).toMatchObject({
      type: 'CODE_REVIEW',
      title: 'Code Review',
    });
  });

  it('ends standalone CODE_REVIEW candidate intake while source-backed evidence builds in the background', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM candidates WHERE id',
          value: {
            id: 'cand_1',
            pipeline_id: null,
            owner_id: 'owner_1',
            current_stage_id: null,
            resume_s3_key: 'text-intake/cand_1',
          },
        },
        { match: 'FROM candidates c WHERE c.id', value: { resume_s3_key: 'text-intake/cand_1', node_count: 0 } },
        {
          match: "interview_type = 'CODE_REVIEW'",
          value: {
            id: 'standalone_waiting',
            status: 'INVITED',
            matched_repo_id: null,
            github_repo_url: null,
            github_pr_number: null,
            submission_json: null,
          },
        },
        {
          match: 'LEFT JOIN candidate_ingestion',
          value: {
            resume_s3_key: 'text-intake/cand_1',
            status: 'pending',
            current_step: 'parse_resume',
            error_text: null,
            node_count: 0,
          },
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/get-stage-config',
      {
        method: 'POST',
        headers: { Authorization: await authHeaderWithoutPipeline() },
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      isComplete?: boolean;
      stageId?: string;
      stageTitle?: string;
      message?: string;
      challenges?: Array<{ type: string; title: string }>;
    };
    expect(body).toMatchObject({
      isComplete: true,
      stageId: 'candidate-intake-queued',
      stageTitle: 'Profile received',
      message: expect.stringContaining('email you when your code review is ready'),
      challenges: [],
    });
  });

  it('serves standalone CODE_REVIEW when an explicit source-backed PR is already assigned', async () => {
    const packet = sourceBackedPacket('repo-span-manual');
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM candidates WHERE id',
          value: {
            id: 'cand_1',
            pipeline_id: null,
            owner_id: 'owner_1',
            current_stage_id: null,
            resume_s3_key: 'text-intake/cand_1',
          },
        },
        { match: 'FROM candidates c WHERE c.id', value: { resume_s3_key: 'text-intake/cand_1', node_count: 0 } },
        {
          match: "interview_type = 'CODE_REVIEW'",
          value: {
            id: 'standalone_manual',
            status: 'INVITED',
            matched_repo_id: 973,
            github_repo_url: 'https://github.com/mui/base-ui',
            github_pr_number: 973,
            submission_json: null,
          },
        },
        { match: 'FROM review_challenge_packets', value: { packet_json: JSON.stringify(packet) } },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/get-stage-config',
      {
        method: 'POST',
        headers: { Authorization: await authHeaderWithoutPipeline() },
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      isComplete?: boolean;
      stageId?: string;
      stageTitle?: string;
      mode?: string;
      challenges?: Array<{ type: string; title: string }>;
    };
    expect(body).toMatchObject({
      isComplete: false,
      stageId: 'standalone-code-review',
      stageTitle: 'Code Review',
      mode: 'ASYNC',
      challenges: [{ type: 'CODE_REVIEW', order: 0, title: 'Code Review' }],
    });
    expect(db.__calls.some((call) => call.sql.includes('LEFT JOIN candidate_ingestion'))).toBe(false);
  });

  it('keeps stale standalone CODE_REVIEW ingestion out of the candidate-facing waiting room', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM candidates WHERE id',
          value: {
            id: 'cand_1',
            pipeline_id: null,
            owner_id: 'owner_1',
            current_stage_id: null,
            resume_s3_key: 'text-intake/cand_1/stale',
          },
        },
        {
          match: 'FROM candidates c WHERE c.id',
          value: {
            resume_s3_key: 'text-intake/cand_1/stale',
            raw_node_count: 0,
            node_count: 0,
          },
        },
        {
          match: "interview_type = 'CODE_REVIEW'",
          value: {
            id: 'standalone_stale',
            status: 'INVITED',
            matched_repo_id: null,
            github_repo_url: null,
            github_pr_number: null,
            submission_json: null,
          },
        },
        {
          match: 'LEFT JOIN candidate_ingestion',
          value: {
            resume_s3_key: 'text-intake/cand_1/stale',
            status: 'pending',
            current_step: 'decompose_resume',
            error_text: null,
            estimated_completion_at: '2000-01-01T00:05:00.000Z',
            updated_at: '2000-01-01T00:00:00.000Z',
            raw_node_count: 0,
            node_count: 0,
          },
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/get-stage-config',
      {
        method: 'POST',
        headers: { Authorization: await authHeaderWithoutPipeline() },
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      isComplete?: boolean;
      stageId?: string;
      message?: string;
      waitingChallenge?: unknown;
    };
    expect(body).toMatchObject({
      isComplete: true,
      stageId: 'candidate-intake-queued',
      message: expect.stringContaining('email you when your code review is ready'),
    });
    expect(body.waitingChallenge).toBeUndefined();
  });

  it('hides role-backed CODE_REVIEW no-match diagnostics from the candidate-facing intake response', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM candidates WHERE id',
          value: {
            id: 'cand_1',
            pipeline_id: 'pipe_1',
            owner_id: 'owner_1',
            current_stage_id: null,
            resume_s3_key: 'text-intake/cand_1/role-backed',
          },
        },
        {
          match: 'FROM candidates c WHERE c.id',
          value: {
            resume_s3_key: 'text-intake/cand_1/role-backed',
            raw_node_count: 16,
            node_count: 16,
          },
        },
        {
          match: 'SELECT match_philosophy FROM pipeline_match_config',
          value: { match_philosophy: 'tailored' },
        },
        {
          match: 'FROM role_contexts',
          value: {
            id: 'role_ctx_1',
            persona_json: null,
            rcd_json: JSON.stringify({ rcd_version: 'simple-jd-v1' }),
            job_description_md: 'React TypeScript usePopoverRoot rendered trigger id ownership.',
            non_negotiable_skills_json: JSON.stringify(['React', 'TypeScript', 'usePopoverRoot']),
          },
        },
        {
          match: 'LEFT JOIN candidate_ingestion',
          value: {
            resume_s3_key: 'text-intake/cand_1/role-backed',
            status: 'pending',
            current_step: 'decompose_resume',
            error_text: null,
            estimated_completion_at: '2026-06-28T16:59:40.000Z',
            updated_at: '2026-06-28T16:59:23.000Z',
            raw_node_count: 16,
            node_count: 16,
          },
        },
      ],
      allResponders: [
        {
          match: 'FROM stages s',
          value: [{
            stage_id: 'stage_code_review',
            stage_title: 'Code Review',
            stage_order: 0,
            stage_mode: 'ASYNC',
            time_limit: null,
            screening_input_mode: null,
            video_config: null,
            challenge_id: 'challenge_code_review',
            challenge_type: 'CODE_REVIEW',
            challenge_title: 'Code Review',
            challenge_order: 0,
            challenge_config: '{}',
            challenge_instructions: 'Review the matched PR.',
          }],
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/get-stage-config',
      {
        method: 'POST',
        headers: { Authorization: await authHeader('cand_1', 'pipe_1') },
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      isComplete?: boolean;
      stageId?: string;
      message?: string;
      challenges?: Array<{ type: string; title?: string }>;
      waitingChallenge?: unknown;
    };
    expect(body).toMatchObject({
      isComplete: true,
      stageId: 'candidate-intake-queued',
      message: expect.stringContaining('email you when your code review is ready'),
      challenges: [],
    });
    expect(body.waitingChallenge).toBeUndefined();
    expect(matchCandidateToReviewChallenge).toHaveBeenCalledOnce();
  });

  it('retries stale Workers AI model failures from stored text-intake source on status refresh', async () => {
    const resumeText = 'Senior TypeScript engineer building Cloudflare Workers runtime tooling, request routing, source-mapped stack traces, and Vitest regression tests.';
    const storage = {
      get: vi.fn(async () => ({
        text: async () => resumeText,
      })),
    } as unknown as R2Bucket;
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM candidates WHERE id',
          value: {
            id: 'cand_1',
            pipeline_id: null,
            owner_id: 'owner_1',
            current_stage_id: null,
            resume_s3_key: 'text-intake/cand_1/old',
          },
        },
        {
          match: 'FROM candidates c WHERE c.id',
          value: {
            resume_s3_key: 'text-intake/cand_1/old',
            raw_node_count: 0,
            node_count: 0,
          },
        },
        {
          match: "interview_type = 'CODE_REVIEW'",
          value: {
            id: 'standalone_retry',
            status: 'INVITED',
            matched_repo_id: null,
            github_repo_url: null,
            github_pr_number: null,
            submission_json: null,
          },
        },
        {
          match: "interview_type IN ('DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX')",
          value: null,
        },
        {
          match: 'retryable_standalone_ingestion',
          value: {
            resume_s3_key: 'text-intake/cand_1/old',
            status: 'failed',
            current_step: 'discover_profile',
            error_text: 'Discovery failed: Cloudflare Workers AI call failed for model @cf/meta/llama-3.1-8b-instruct: 5028: This model was deprecated on 2026-05-30.',
          },
        },
      ],
    });
    const env = buildEnv({ DB: db, STORAGE: storage });
    const { ctx, waitUntilAll } = buildCtx();

    const res = await rpcAuth.request(
      '/get-stage-config',
      {
        method: 'POST',
        headers: { Authorization: await authHeaderWithoutPipeline() },
      },
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      isComplete?: boolean;
      stageId?: string;
      message?: string;
      waitingChallenge?: unknown;
    };
    expect(body).toMatchObject({
      isComplete: true,
      stageId: 'candidate-intake-queued',
      message: expect.stringContaining('email you when your code review is ready'),
    });
    expect(body.waitingChallenge).toBeUndefined();
    expect(db.__calls.some((call) =>
      call.ran
      && call.sql.includes("status = 'pending'")
      && call.sql.includes("current_step = 'retry_queued'")
    )).toBe(true);

    await waitUntilAll();
    expect(storage.get).toHaveBeenCalledWith('text-intake/cand_1/old');
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'cand_1',
      resumeText,
      decompositionResult: null,
      parsed: expect.objectContaining({
        skills: expect.any(Array),
        experiences: expect.any(Array),
        projects: expect.any(Array),
      }),
    }));
  });

  it('retries generic deprecated Workers AI discovery failures without matching one stale model id', async () => {
    const resumeText = 'Staff frontend systems engineer building collaborative editors, Cloudflare deployments, state synchronization, and Playwright regression suites.';
    const storage = {
      get: vi.fn(async () => ({
        text: async () => resumeText,
      })),
    } as unknown as R2Bucket;
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM candidates WHERE id',
          value: {
            id: 'cand_1',
            pipeline_id: null,
            owner_id: 'owner_1',
            current_stage_id: null,
            resume_s3_key: 'text-intake/cand_1/future',
          },
        },
        {
          match: 'FROM candidates c WHERE c.id',
          value: {
            resume_s3_key: 'text-intake/cand_1/future',
            raw_node_count: 0,
            node_count: 0,
          },
        },
        {
          match: "interview_type = 'CODE_REVIEW'",
          value: null,
        },
        {
          match: "interview_type IN ('DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX')",
          value: {
            id: 'future_model_retry',
            status: 'INVITED',
            created_at: '2026-06-28T08:00:00.000Z',
            interview_type: 'OPEN_SOURCE_BUG_FIX',
            matched_repo_id: null,
            github_repo_url: null,
            github_pr_number: null,
            submission_json: null,
          },
        },
        {
          match: 'retryable_standalone_ingestion',
          value: {
            resume_s3_key: 'text-intake/cand_1/future',
            status: 'failed',
            current_step: 'discover_profile',
            error_text: 'Discovery failed: Cloudflare Workers AI call failed for model @cf/example/future-retired-model: This model was decommissioned. Please use an alternative model.',
          },
        },
      ],
    });
    const env = buildEnv({ DB: db, STORAGE: storage });
    const { ctx, waitUntilAll } = buildCtx();

    const res = await rpcAuth.request(
      '/get-stage-config',
      {
        method: 'POST',
        headers: { Authorization: await authHeaderWithoutPipeline() },
      },
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      isComplete?: boolean;
      stageId?: string;
      message?: string;
      waitingChallenge?: unknown;
    };
    expect(body).toMatchObject({
      isComplete: true,
      stageId: 'candidate-intake-queued',
      message: expect.stringContaining('email you when your code review is ready'),
    });
    expect(body.waitingChallenge).toBeUndefined();

    await waitUntilAll();
    expect(storage.get).toHaveBeenCalledWith('text-intake/cand_1/future');
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'cand_1',
      resumeText,
      decompositionResult: null,
    }));
  });

  it('retries stale Workers AI model failures before standalone dev-container matching', async () => {
    const resumeText = 'Senior TypeScript engineer building Cloudflare Workers runtime tooling, request routing, source-mapped stack traces, and Vitest regression tests.';
    const storage = {
      get: vi.fn(async () => ({
        text: async () => resumeText,
      })),
    } as unknown as R2Bucket;
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM candidates WHERE id',
          value: {
            id: 'cand_1',
            pipeline_id: null,
            owner_id: 'owner_1',
            current_stage_id: null,
            resume_s3_key: 'text-intake/cand_1/old',
          },
        },
        {
          match: 'FROM candidates c WHERE c.id',
          value: {
            resume_s3_key: 'text-intake/cand_1/old',
            raw_node_count: 0,
            node_count: 0,
          },
        },
        {
          match: "interview_type = 'CODE_REVIEW'",
          value: null,
        },
        {
          match: "interview_type IN ('DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX')",
          value: {
            id: 'dev_retry',
            status: 'INVITED',
            created_at: '2026-06-27T22:00:00.000Z',
            interview_type: 'OPEN_SOURCE_BUG_FIX',
            matched_repo_id: null,
            github_repo_url: null,
            github_pr_number: null,
            submission_json: null,
          },
        },
        {
          match: 'retryable_standalone_ingestion',
          value: {
            resume_s3_key: 'text-intake/cand_1/old',
            status: 'failed',
            current_step: 'discover_profile',
            error_text: 'Discovery failed: Cloudflare Workers AI call failed for model @cf/meta/llama-3.1-8b-instruct: 5028: This model was deprecated on 2026-05-30.',
          },
        },
      ],
    });
    const env = buildEnv({ DB: db, STORAGE: storage });
    const { ctx, waitUntilAll } = buildCtx();

    const res = await rpcAuth.request(
      '/get-stage-config',
      {
        method: 'POST',
        headers: { Authorization: await authHeaderWithoutPipeline() },
      },
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      isComplete?: boolean;
      stageId?: string;
      message?: string;
      waitingChallenge?: unknown;
    };
    expect(body).toMatchObject({
      isComplete: true,
      stageId: 'candidate-intake-queued',
      message: expect.stringContaining('email you when your code review is ready'),
    });
    expect(body.waitingChallenge).toBeUndefined();
    expect(db.__calls.some((call) =>
      call.ran
      && call.sql.includes("status = 'pending'")
      && call.sql.includes("current_step = 'retry_queued'")
    )).toBe(true);

    await waitUntilAll();
    expect(storage.get).toHaveBeenCalledWith('text-intake/cand_1/old');
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'cand_1',
      resumeText,
      decompositionResult: null,
    }));
  });
});

// ─── POST /rpc/submit-challenge-response ─────────────────────────────────────

describe('POST /rpc/submit-challenge-response', () => {
  it('queues text-intake ingestion from deterministic CV evidence without a pre-ingestion AI parse', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'SELECT invite_token, status FROM candidates WHERE id',
          value: { invite_token: 'CLAIMED::invite-token', status: 'IN_PROGRESS' },
        },
      ],
    });
    const aiRun = vi.fn(async () => ({ response: '{}' }));
    const storage = { put: vi.fn(async () => null) } as unknown as R2Bucket;
    const env = buildEnv({ DB: db, AI: { run: aiRun } as unknown as Ai, STORAGE: storage });
    const { ctx, waitUntilAll } = buildCtx();
    const resumeText = 'Senior TypeScript engineer building Cloudflare Workers runtime tooling, request routing, source-mapped stack traces, and Vitest regression tests.';

    const res = await rpcAuth.request(
      '/submit-challenge-response',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeaderWithoutPipeline(),
        },
        body: JSON.stringify({
          order: 0,
          submission: JSON.stringify({
            resumeText,
          }),
        }),
      },
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { success?: boolean; complete?: boolean; queued?: boolean };
    expect(body).toMatchObject({
      success: true,
      complete: true,
      queued: true,
    });
    await waitUntilAll();
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^text-intake\/cand_1\//),
      resumeText,
      expect.objectContaining({
        httpMetadata: { contentType: 'text/plain;charset=utf-8' },
        customMetadata: expect.objectContaining({
          source: 'candidate_text_intake',
          candidateId: 'cand_1',
        }),
      }),
    );
    expect(aiRun).not.toHaveBeenCalled();
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'cand_1',
      resumeText: expect.stringContaining('Cloudflare Workers runtime tooling'),
      decompositionResult: null,
      parsed: expect.objectContaining({
        skills: expect.any(Array),
        experiences: expect.any(Array),
        projects: expect.any(Array),
      }),
    }));
  });

  it('advances after intake when standalone CODE_REVIEW has an explicit source-backed PR', async () => {
    const packet = sourceBackedPacket('repo-span-manual');
    const db = fakeD1({
      firstResponders: [
        {
          match: 'SELECT invite_token, status FROM candidates WHERE id',
          value: { invite_token: 'CLAIMED::invite-token', status: 'IN_PROGRESS' },
        },
        {
          match: "interview_type = 'CODE_REVIEW'",
          value: {
            id: 'standalone_manual',
            status: 'INVITED',
            matched_repo_id: 973,
            github_repo_url: 'https://github.com/mui/base-ui',
            github_pr_number: 973,
            submission_json: null,
          },
        },
        { match: 'FROM review_challenge_packets', value: { packet_json: JSON.stringify(packet) } },
      ],
    });
    const storage = { put: vi.fn(async () => null) } as unknown as R2Bucket;
    const env = buildEnv({ DB: db, STORAGE: storage });
    const { ctx, waitUntilAll } = buildCtx();

    const res = await rpcAuth.request(
      '/submit-challenge-response',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeaderWithoutPipeline(),
        },
        body: JSON.stringify({
          order: 0,
          submission: {
            resumeText: 'Senior frontend engineer with React, TypeScript, popover interaction timing, and source-backed review experience.',
          },
        }),
      },
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { success?: boolean; next?: boolean; complete?: boolean; queued?: boolean };
    expect(body).toMatchObject({
      success: true,
      next: true,
    });
    expect(body.complete).toBeUndefined();
    expect(body.queued).toBeUndefined();
    await waitUntilAll();
  });
});

// ─── POST /rpc/get-challenge ─────────────────────────────────────────────────

describe('POST /rpc/get-challenge', () => {
  it('does not use Neo4j projection recall when CODE_REVIEW lacks source-backed role context', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates WHERE id', value: { current_stage_id: 'stage_code' } },
        { match: 'FROM stages WHERE id', value: { mode: 'ASYNC', screening_input_mode: null } },
        { match: 'FROM pipeline_match_config', value: { match_philosophy: 'tailored' } },
        { match: 'FROM candidate_challenge_assignment', value: null },
        { match: 'FROM role_contexts', value: null },
      ],
      allResponders: [
        {
          match: 'FROM challenges ch',
          value: [{
            id: 'ch_review',
            type: 'CODE_REVIEW',
            title: 'Code Review',
            instructions: 'Review a source-backed PR',
            config: JSON.stringify({ isMultiTurn: true }),
            cached_diff_json: null,
            github_pr_title: null,
            github_pr_number: null,
            github_repo_url: null,
            github_pr_description: null,
            dev_container_repo_url: null,
            assignment_id: null,
            assignment_repo_url: null,
            assignment_pr_number: null,
            effective_repo_url: null,
            effective_pr_number: null,
            effective_issue_number: null,
          }],
        },
      ],
    });
    const env = buildEnv({ DB: db, PRIMARY_MATCH_STORE: 'neo4j' } as Partial<Env & { DB: FakeD1 }>);

    const res = await rpcAuth.request(
      '/get-challenge',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ order: 1 }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { type: string; id: string };
    expect(body).toMatchObject({
      id: 'waiting-for-match',
      type: 'WAITING_FOR_MATCH',
    });
    expect(matchReposByGroundedEdges).not.toHaveBeenCalled();
    expect(matchReposForCandidateNeo4j).not.toHaveBeenCalled();
  });

  it('uses source-backed issue context for CODE_IMPLEMENTATION without Neo4j recall', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates WHERE id', value: { current_stage_id: 'stage_code' } },
        { match: 'FROM stages WHERE id', value: { mode: 'ASYNC', screening_input_mode: null } },
        { match: 'FROM pipeline_match_config', value: { match_philosophy: 'tailored' } },
        { match: 'FROM candidate_challenge_assignment', value: null },
        {
          match: 'FROM role_contexts',
          value: {
            id: 'role_ctx_impl',
            persona_json: null,
            rcd_json: null,
            job_description_md: 'We need Kafka Idempotency work.',
            non_negotiable_skills_json: JSON.stringify(['Kafka Idempotency']),
          },
        },
      ],
      allResponders: [
        {
          match: 'FROM challenges ch',
          value: [{
            id: 'ch_impl',
            type: 'CODE_IMPLEMENTATION',
            title: 'Implementation',
            instructions: 'Implement a source-backed issue',
            config: JSON.stringify({}),
            cached_diff_json: null,
            github_pr_title: null,
            github_pr_number: null,
            github_repo_url: null,
            github_pr_description: null,
            dev_container_repo_url: null,
            assignment_id: null,
            assignment_repo_url: null,
            assignment_pr_number: null,
            effective_repo_url: null,
            effective_pr_number: null,
            effective_issue_number: null,
          }],
        },
        { match: 'FROM role_nodes', value: [] },
        {
          match: "cr.scope_type = 'role_context'",
          value: [{
            context_record_id: 'role-context-record-1',
            record_type: 'simple_job_description',
            extraction_version: 'simple-jd-v1',
            canonical_key: 'term:kafka-idempotency',
            label: 'Kafka Idempotency',
            source_ref_type: 'source_span',
            source_ref_id: 'role-source-span-1',
          }],
        },
        {
          match: 'ri.repo_id,\n            ri.issue_number',
          value: [],
        },
        {
          match: 'SELECT qr.id AS repo_id',
          value: [{
            repo_id: 44,
            full_name: 'acme/orders',
            github_url: 'https://github.com/acme/orders',
            description: null,
            seniority_band: 'mid',
            detected_domain: 'general',
            pr_quality_score: 0.8,
            stars: 10,
            primary_language: 'typescript',
            issue_id: 901,
            issue_number: 77,
            issue_title: 'Kafka idempotency work',
            implementability_score: 0.7,
            clarity_score: 0.8,
            canonical_key: 'term:kafka-idempotency',
          }],
        },
        {
          match: 'SELECT ri.id AS issue_id,\n              ri.issue_number',
          value: [{
            issue_id: 901,
            issue_number: 77,
            title: 'Kafka idempotency work',
            implementability_score: 0.7,
            clarity_score: 0.8,
          }],
        },
        {
          match: 'SELECT crsr.source_ref_id AS issue_id',
          value: [{ issue_id: '901', overlap: 1 }],
        },
      ],
    });
    const env = buildEnv({ DB: db, PRIMARY_MATCH_STORE: 'neo4j' } as Partial<Env & { DB: FakeD1 }>);

    const res = await rpcAuth.request(
      '/get-challenge',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ order: 1 }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(matchReposByGroundedEdges).not.toHaveBeenCalled();
    expect(matchReposForCandidateNeo4j).not.toHaveBeenCalled();
    const assignmentInsert = db.__calls.find((call) =>
      call.sql.includes('INSERT INTO candidate_challenge_assignment')
    );
    expect(assignmentInsert?.params.slice(1)).toEqual([
      'cand_1',
      'stage_code',
      'ch_impl',
      44,
      'https://github.com/acme/orders',
      null,
      77,
    ]);
  });

  it('does not live-fetch standalone review diffs when source spans cannot rebuild the packet diff', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch should not be called'));
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates c WHERE c.id', value: { resume_s3_key: 'resume.pdf', node_count: 1 } },
        {
          match: "interview_type IN ('DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX')",
          value: null,
        },
        {
          match: "interview_type = 'CODE_REVIEW'",
          value: {
            id: 'standalone_1',
            status: 'MATCHED',
            matched_repo_id: 10,
            github_repo_url: 'https://github.com/test/source-backed-repo',
            github_pr_number: 42,
            submission_json: null,
          },
        },
        {
          match: 'FROM review_challenge_packets',
          value: {
            packet_json: JSON.stringify({
              pullRequest: {
                title: 'Source-backed retry PR',
                author: 'dev',
                baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                mergedAt: '2026-06-20T12:00:00.000Z',
                body: 'Source-backed packet body',
              },
              demands: [{ sourceSpanIds: ['missing-span'] }],
            }),
          },
        },
      ],
      allResponders: [
        { match: 'FROM repo_source_spans', value: [] },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/get-challenge',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeaderWithoutPipeline(),
        },
        body: JSON.stringify({ order: 0 }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { type: string; id: string };
    expect(body.type).toBe('WAITING_FOR_MATCH');
    expect(body.id).toBe('waiting-for-match');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('waits instead of matching standalone CODE_REVIEW while text-intake evidence is still building', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates c WHERE c.id', value: { resume_s3_key: 'text-intake/cand_1', node_count: 0 } },
        {
          match: "interview_type IN ('DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX')",
          value: null,
        },
        {
          match: "interview_type = 'CODE_REVIEW'",
          value: {
            id: 'standalone_waiting',
            status: 'INVITED',
            matched_repo_id: null,
            github_repo_url: null,
            github_pr_number: null,
            submission_json: null,
          },
        },
        {
          match: 'LEFT JOIN candidate_ingestion',
          value: {
            resume_s3_key: 'text-intake/cand_1',
            status: 'pending',
            current_step: 'parse_resume',
            error_text: null,
            node_count: 0,
          },
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/get-challenge',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeaderWithoutPipeline(),
        },
        body: JSON.stringify({ order: 0 }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { type: string; id: string };
    expect(body).toMatchObject({
      id: 'waiting-for-match',
      type: 'WAITING_FOR_MATCH',
    });
    expect(matchCandidateToReviewChallenge).not.toHaveBeenCalled();
  });

  it('attempts standalone CODE_REVIEW matching once text intake has source-backed review evidence', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates c WHERE c.id', value: { resume_s3_key: 'text-intake/cand_1', node_count: 16 } },
        {
          match: "interview_type IN ('DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX')",
          value: null,
        },
        {
          match: "interview_type = 'CODE_REVIEW'",
          value: {
            id: 'standalone_pending_with_evidence',
            status: 'INVITED',
            matched_repo_id: null,
            github_repo_url: null,
            github_pr_number: null,
            submission_json: null,
          },
        },
        {
          match: 'LEFT JOIN candidate_ingestion',
          value: {
            resume_s3_key: 'text-intake/cand_1',
            status: 'pending',
            current_step: 'decompose_resume',
            error_text: null,
            node_count: 16,
            raw_node_count: 16,
          },
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/get-challenge',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeaderWithoutPipeline(),
        },
        body: JSON.stringify({ order: 0 }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { type: string; id: string };
    expect(body).toMatchObject({
      id: 'waiting-for-match',
      type: 'WAITING_FOR_MATCH',
    });
    expect(matchCandidateToReviewChallenge).toHaveBeenCalledOnce();
  });

  it('refreshes weak cached automatic standalone CODE_REVIEW matches before serving a challenge', async () => {
    vi.mocked(matchCandidateToReviewChallenge).mockResolvedValueOnce({
      status: 'MATCHED',
      repoId: 973,
      prNumber: 973,
      explanation: automaticMatchExplanation(973, 2),
    } as Awaited<ReturnType<typeof matchCandidateToReviewChallenge>>);
    const packet = sourceBackedPacket('repo-span-auto');
    const weakCachedMatch = persistedRankedResult(5110, 0);
    weakCachedMatch.assessmentQuality = {
      ...assessmentQuality(0),
      verdict: 'WEAK',
      score: 6,
    };
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates c WHERE c.id', value: { resume_s3_key: 'resume.pdf', node_count: 38 } },
        {
          match: "interview_type IN ('DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX')",
          value: null,
        },
        {
          match: "interview_type = 'CODE_REVIEW'",
          value: {
            id: 'standalone_auto',
            status: 'INVITED',
            matched_repo_id: 973,
            github_repo_url: 'https://github.com/mui/base-ui',
            github_pr_number: 5110,
            submission_json: null,
          },
        },
        { match: 'FROM review_challenge_packets', value: { packet_json: JSON.stringify(packet) } },
        {
          match: 'LEFT JOIN candidate_ingestion',
          value: {
            resume_s3_key: 'resume.pdf',
            status: 'embedded',
            current_step: 'embed_profile',
            error_text: null,
            node_count: 38,
          },
        },
        { match: 'SELECT github_url FROM qualified_repos', value: { github_url: 'https://github.com/mui/base-ui' } },
        { match: 'SELECT owner_id FROM candidates', value: { owner_id: 'owner_1' } },
      ],
      allResponders: [
        {
          match: 'FROM match_runs',
          value: [{
            status: 'MATCHED',
            ranked_results_json: JSON.stringify([weakCachedMatch]),
          }],
        },
        {
          match: 'FROM repo_source_spans',
          value: [{
            id: 'repo-span-auto',
            path: 'src/component.tsx',
            exact_text: 'React state update code under review.',
            line_start: 12,
            line_end: 12,
          }],
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/get-challenge',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeaderWithoutPipeline(),
        },
        body: JSON.stringify({ order: 0 }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      type: string;
      githubPrNumber?: number | null;
      matchExplanation?: {
        assessmentQuality?: { metrics?: Array<{ id: string; score: number }> };
      };
    };
    expect(body.type).toBe('CODE_REVIEW');
    expect(body.githubPrNumber).toBe(973);
    expect(body.matchExplanation?.assessmentQuality?.metrics?.find((metric) =>
      metric.id === 'contrast_separation'
    )?.score).toBe(2);
    expect(matchCandidateToReviewChallenge).toHaveBeenCalledOnce();
    expect(db.__calls.some((call) =>
      call.ran && call.sql.includes('SET matched_repo_id = NULL')
    )).toBe(true);
    expect(db.__calls.some((call) =>
      call.ran
      && call.sql.includes('SET matched_repo_id = ?1')
      && call.params.includes(973)
      && call.params.includes('https://github.com/mui/base-ui')
    )).toBe(true);
  });

  it('blocks roleless automatic standalone CODE_REVIEW near-ties with repo-matching diagnostics', async () => {
    vi.mocked(matchCandidateToReviewChallenge).mockResolvedValueOnce({
      status: 'MATCHED',
      repoId: 973,
      prNumber: 973,
      explanation: automaticMatchExplanation(973, 0),
    } as Awaited<ReturnType<typeof matchCandidateToReviewChallenge>>);
    const packet = sourceBackedPacket('repo-span-auto');
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates c WHERE c.id', value: { resume_s3_key: 'resume.pdf', node_count: 38 } },
        {
          match: "interview_type IN ('DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX')",
          value: null,
        },
        {
          match: "interview_type = 'CODE_REVIEW'",
          value: {
            id: 'standalone_auto_roleless',
            status: 'INVITED',
            matched_repo_id: null,
            github_repo_url: null,
            github_pr_number: null,
            submission_json: null,
          },
        },
        {
          match: 'LEFT JOIN candidate_ingestion',
          value: {
            resume_s3_key: 'resume.pdf',
            status: 'embedded',
            current_step: 'embed_profile',
            error_text: null,
            node_count: 38,
          },
        },
        { match: 'SELECT github_url FROM qualified_repos', value: { github_url: 'https://github.com/mui/base-ui' } },
        { match: 'SELECT owner_id FROM candidates', value: { owner_id: 'owner_1' } },
        { match: 'FROM review_challenge_packets', value: { packet_json: JSON.stringify(packet) } },
      ],
      allResponders: [
        {
          match: 'FROM repo_source_spans',
          value: [{
            id: 'repo-span-auto',
            path: 'src/component.tsx',
            exact_text: 'React state update code under review.',
            line_start: 12,
            line_end: 12,
          }],
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/get-challenge',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeaderWithoutPipeline(),
        },
        body: JSON.stringify({ order: 0 }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      type: string;
      config?: {
        state?: string;
        autoRefresh?: boolean;
        reason?: string;
        diagnostics?: {
          phase?: string;
          pipeline?: Array<{ id: string; status: string }>;
        };
      };
    };
    expect(body).toMatchObject({
      type: 'WAITING_FOR_MATCH',
      config: {
        state: 'blocked',
        autoRefresh: false,
        reason: 'The deterministic repo matcher did not return a quality-gated, source-backed PR challenge.',
        diagnostics: {
          phase: 'repo_matching',
          pipeline: expect.arrayContaining([
            expect.objectContaining({ id: 'intake', status: 'complete' }),
            expect.objectContaining({ id: 'decomposition', status: 'complete' }),
            expect.objectContaining({ id: 'repo_matching', status: 'blocked' }),
            expect.objectContaining({ id: 'challenge', status: 'pending' }),
            expect.objectContaining({ id: 'review', status: 'pending' }),
            expect.objectContaining({ id: 'scoring', status: 'pending' }),
          ]),
        },
      },
    });
    expect(matchCandidateToReviewChallenge).toHaveBeenCalledOnce();
    expect(db.__calls.some((call) =>
      call.ran && call.sql.includes('SET matched_repo_id = ?1')
    )).toBe(false);
  });

  it('routes standalone OPEN_SOURCE_BUG_FIX invites into a repo-backed implementation challenge', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates c WHERE c.id', value: { resume_s3_key: 'resume.pdf', node_count: 1 } },
        {
          match: "interview_type IN ('DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX')",
          value: {
            id: 'open_source_1',
            status: 'INVITED',
            interview_type: 'OPEN_SOURCE_BUG_FIX',
            matched_repo_id: null,
            github_repo_url: 'https://github.com/hash-pipe/open-source-task',
            github_pr_number: 101,
            submission_json: null,
          },
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/get-challenge',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeaderWithoutPipeline(),
        },
        body: JSON.stringify({ order: 0 }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      type: string;
      title: string;
      instructions: string;
      githubRepoUrl: string | null;
      githubPrNumber: number | null;
      devContainerRepoUrl: string | null;
    };
    expect(body.type).toBe('CODE_IMPLEMENTATION');
    expect(body.title).toBe('Open Source Bug Fix');
    expect(body.instructions).toContain('matched open-source task');
    expect(body.githubRepoUrl).toBe('https://github.com/hash-pipe/open-source-task');
    expect(body.githubPrNumber).toBe(101);
    expect(body.devContainerRepoUrl).toBe('https://github.com/hash-pipe/open-source-task');
  });

  it('retries stale Workers AI model failures before serving unassigned standalone implementation challenges', async () => {
    const resumeText = 'Senior TypeScript engineer building Cloudflare Workers runtime tooling, request routing, source-mapped stack traces, and Vitest regression tests.';
    const storage = {
      get: vi.fn(async () => ({
        text: async () => resumeText,
      })),
    } as unknown as R2Bucket;
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates c WHERE c.id', value: { resume_s3_key: 'text-intake/cand_1/old', node_count: 0 } },
        {
          match: "interview_type = 'CODE_REVIEW'",
          value: null,
        },
        {
          match: "interview_type IN ('DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX')",
          value: {
            id: 'open_source_retry',
            status: 'INVITED',
            interview_type: 'OPEN_SOURCE_BUG_FIX',
            matched_repo_id: null,
            github_repo_url: null,
            github_pr_number: null,
            submission_json: null,
          },
        },
        {
          match: 'retryable_standalone_ingestion',
          value: {
            resume_s3_key: 'text-intake/cand_1/old',
            status: 'failed',
            current_step: 'discover_profile',
            error_text: 'Discovery failed: Cloudflare Workers AI call failed for model @cf/meta/llama-3.1-8b-instruct: 5028: This model was deprecated on 2026-05-30.',
          },
        },
      ],
    });
    const env = buildEnv({ DB: db, STORAGE: storage });
    const { ctx, waitUntilAll } = buildCtx();

    const res = await rpcAuth.request(
      '/get-challenge',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeaderWithoutPipeline(),
        },
        body: JSON.stringify({ order: 0 }),
      },
      env,
      ctx,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      type: string;
      config?: { state?: string; reason?: string };
    };
    expect(body.type).toBe('WAITING_FOR_MATCH');
    expect(body.config).toMatchObject({
      state: 'pending',
      reason: 'Retrying candidate evidence ingestion after a stale Workers AI model failure.',
    });
    expect(db.__calls.some((call) =>
      call.ran
      && call.sql.includes("status = 'pending'")
      && call.sql.includes("current_step = 'retry_queued'")
    )).toBe(true);

    await waitUntilAll();
    expect(storage.get).toHaveBeenCalledWith('text-intake/cand_1/old');
    expect(runCandidateIngestion).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'cand_1',
      resumeText,
      decompositionResult: null,
    }));
  });

  it('returns match proof for a manual standalone CODE_REVIEW source-backed PR', async () => {
    const packet = {
      pullRequest: {
        title: 'Manual source-backed PR',
        author: 'dev',
        baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        mergedAt: '2026-06-20T12:00:00.000Z',
        body: 'Manual review packet body',
      },
      demands: [{ sourceSpanIds: ['repo-span-manual'] }],
    };
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates c WHERE c.id', value: { resume_s3_key: 'resume.pdf', node_count: 1 } },
        {
          match: "interview_type = 'CODE_REVIEW'",
          value: {
            id: 'standalone_1',
            status: 'MATCHED',
            matched_repo_id: 10,
            github_repo_url: 'https://github.com/test/source-backed-repo',
            github_pr_number: 42,
            submission_json: null,
          },
        },
        { match: 'FROM review_challenge_packets', value: { packet_json: JSON.stringify(packet) } },
        { match: 'SELECT owner_id FROM candidates', value: { owner_id: 'owner_1' } },
      ],
      allResponders: [
        {
          match: 'FROM repo_source_spans',
          value: [{
            id: 'repo-span-manual',
            path: 'src/manual.ts',
            exact_text: 'const reviewed = true;',
            line_start: 12,
            line_end: 12,
          }],
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/get-challenge',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeaderWithoutPipeline(),
        },
        body: JSON.stringify({ order: 0 }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      type: string;
      cachedDiffJson?: { files: Array<{ filename: string; headContent: string }> };
      githubPrNumber?: number | null;
      githubRepoUrl?: string | null;
      matchExplanation?: {
        status?: string;
        summary?: string;
        qualityGate?: { verdict?: string; checks?: string[] };
        assessmentQuality?: { verdict?: string };
        validatorAgent?: { verdict?: string; sourceBridge?: { prNumber?: number } };
      };
      reviewSession?: { requiresInit?: boolean; challengeId?: string };
    };

    expect(body.type).toBe('CODE_REVIEW');
    expect(body.githubRepoUrl).toBe('https://github.com/test/source-backed-repo');
    expect(body.githubPrNumber).toBe(42);
    expect(body.cachedDiffJson?.files[0]).toMatchObject({
      filename: 'src/manual.ts',
      headContent: 'const reviewed = true;',
    });
    expect(body.matchExplanation).toMatchObject({
      status: 'MATCHED',
      qualityGate: {
        verdict: 'PASSED',
        checks: expect.arrayContaining(['repo_source_spans', 'source_backed_manual_override']),
      },
      assessmentQuality: { verdict: 'USABLE' },
      validatorAgent: {
        verdict: 'PASSED',
        sourceBridge: { prNumber: 42 },
      },
    });
    expect(body.matchExplanation?.summary).toContain('Manual override');
    expect(body.reviewSession).toMatchObject({
      requiresInit: true,
      challengeId: 'standalone-review-backing-challenge-standalone_1',
    });
  });

  it('serves source-backed packet diff for assignment-backed review even when challenge cache is stale', async () => {
    const packet = {
      pullRequest: {
        title: 'Source-backed retry PR',
        author: 'dev',
        baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        mergedAt: '2026-06-20T12:00:00.000Z',
        body: 'Source-backed packet body',
      },
      demands: [{ sourceSpanIds: ['repo-span-retry'] }],
    };
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates', value: CANDIDATE },
        { match: 'FROM stages', value: { mode: 'ASYNC', screening_input_mode: null } },
        {
          match: 'FROM candidate_challenge_assignment',
          value: {
            id: 'assign_1',
            github_repo_url: 'https://github.com/test/source-backed-repo',
            github_pr_number: 42,
            issue_number: null,
          },
        },
        { match: 'FROM review_challenge_packets', value: { packet_json: JSON.stringify(packet) } },
      ],
      allResponders: [
        {
          match: 'FROM challenges ch',
          value: [{
            id: 'ch_1',
            type: 'CODE_REVIEW',
            title: 'Code Review',
            instructions: 'Review this PR',
            config: JSON.stringify({ isMultiTurn: true }),
            cached_diff_json: JSON.stringify({
              files: [{
                filename: 'legacy.ts',
                headContent: 'stale cached diff',
                hunks: [{ lines: [{ type: 'added', content: 'stale cached diff' }] }],
              }],
            }),
            github_pr_title: 'Legacy title',
            github_pr_number: null,
            github_repo_url: null,
            github_pr_description: null,
            dev_container_repo_url: null,
            assignment_id: 'assign_1',
            assignment_repo_url: 'https://github.com/test/source-backed-repo',
            assignment_pr_number: 42,
            effective_repo_url: 'https://github.com/test/source-backed-repo',
            effective_pr_number: 42,
            effective_issue_number: null,
          }],
        },
        {
          match: 'FROM repo_source_spans',
          value: [{
            id: 'repo-span-retry',
            path: 'src/orders/retry.ts',
            exact_text: 'publishWithRetry(order)',
            line_start: 18,
            line_end: 18,
          }],
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/get-challenge',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ order: 1 }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      cachedDiffJson: { files: Array<{ filename: string; headContent: string }> };
      githubPrTitle: string | null;
      githubPrDescription: string | null;
      githubPrNumber: number | null;
      githubRepoUrl: string | null;
    };
    expect(body.githubPrTitle).toBe('Source-backed retry PR');
    expect(body.githubPrDescription).toBe('Source-backed packet body');
    expect(body.githubPrNumber).toBe(42);
    expect(body.githubRepoUrl).toBe('https://github.com/test/source-backed-repo');
    expect(body.cachedDiffJson.files[0]).toMatchObject({
      filename: 'src/orders/retry.ts',
      headContent: 'publishWithRetry(order)',
    });
  });

  it('serves raw source issue text for implementation challenges without body cache', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates', value: CANDIDATE },
        { match: 'FROM stages', value: { mode: 'ASYNC', screening_input_mode: null } },
        {
          match: 'FROM candidate_challenge_assignment',
          value: {
            id: 'assign_impl',
            github_repo_url: 'https://github.com/test/source-backed-repo',
            github_pr_number: null,
            issue_number: 77,
          },
        },
        {
          match: 'FROM repo_issues ri',
          value: {
            title: 'Implement retry queue',
            body: 'Original GitHub issue body with exact implementation request.',
            labels_json: JSON.stringify(['good first issue', 'backend']),
            body_cache_json: null,
          },
        },
      ],
      allResponders: [
        {
          match: 'FROM challenges ch',
          value: [{
            id: 'ch_impl',
            type: 'CODE_IMPLEMENTATION',
            title: 'Implementation',
            instructions: 'Implement the issue',
            config: JSON.stringify({}),
            cached_diff_json: null,
            github_pr_title: null,
            github_pr_number: null,
            github_repo_url: null,
            github_pr_description: null,
            dev_container_repo_url: null,
            assignment_id: 'assign_impl',
            assignment_repo_url: 'https://github.com/test/source-backed-repo',
            assignment_pr_number: null,
            effective_repo_url: 'https://github.com/test/source-backed-repo',
            effective_pr_number: null,
            effective_issue_number: 77,
          }],
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/get-challenge',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ order: 1 }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      issueBody?: {
        title: string | null;
        body: string | null;
        labels: string[];
      };
    };
    expect(body.issueBody).toEqual({
      title: 'Implement retry queue',
      body: 'Original GitHub issue body with exact implementation request.',
      labels: ['good first issue', 'backend'],
    });
  });
});

// ─── POST /rpc/review/ask ────────────────────────────────────────────────────

describe('POST /rpc/review/ask', () => {
  it('does not call explainer agent when assigned PR prompt context lacks source-backed packet graph', async () => {
    const assignedExplainerChallenge = {
      ...ASSIGNED_CHALLENGE_WITHOUT_SOURCE_PACKET,
      config: JSON.stringify({ enableExplainer: true, maxExplainerQuestions: 4 }),
    };
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates', value: CANDIDATE },
        { match: 'FROM assessments', value: ASSESSMENT_ROW },
        { match: 'FROM review_sessions', value: null },
        { match: 'FROM challenges ch', value: assignedExplainerChallenge },
        { match: 'FROM review_challenge_packets', value: null },
      ],
      allResponders: [
        {
          match: 'FROM challenges',
          value: [assignedExplainerChallenge],
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/ask',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ challengeOrder: 0, question: 'What is this PR doing?' }),
      },
      env,
    );

    expect(res.status).toBe(409);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('WAITING_FOR_MATCH');
    expect(vi.mocked(callExplainerAgent)).not.toHaveBeenCalled();
    expect(db.__calls.some((call) => call.sql.includes('FROM review_challenge_packets'))).toBe(true);
  });

  it('returns AI_DEVELOPER_UNAVAILABLE without creating a fake explainer exchange', async () => {
    vi.mocked(callExplainerAgent).mockRejectedValueOnce(new ExplainerAgentUnavailableError({
      provider: 'workers-ai',
      reason: 'Workers AI binding is not available for the review explainer agent.',
      retryable: true,
    }));
    const assignedExplainerChallenge = {
      ...ASSIGNED_CHALLENGE_WITHOUT_SOURCE_PACKET,
      config: JSON.stringify({ enableExplainer: true, maxExplainerQuestions: 4 }),
    };
    const packet = sourceBackedPacket('repo-span-explainer');
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates', value: CANDIDATE },
        { match: 'FROM assessments', value: ASSESSMENT_ROW },
        { match: 'FROM review_sessions', value: null },
        { match: 'FROM challenges ch', value: assignedExplainerChallenge },
        { match: 'FROM review_challenge_packets', value: { packet_json: JSON.stringify(packet) } },
      ],
      allResponders: [
        {
          match: 'FROM challenges',
          value: [assignedExplainerChallenge],
        },
        {
          match: 'FROM repo_source_spans',
          value: [{
            id: 'repo-span-explainer',
            path: 'src/auth.ts',
            exact_text: 'retryTokenRefresh();',
            line_start: 12,
            line_end: 12,
          }],
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/ask',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ challengeOrder: 0, question: 'What is this PR doing?' }),
      },
      env,
    );

    expect(res.status).toBe(503);
    const body = await res.json() as { error: { code: string; diagnostic: { code: string } } };
    expect(body.error.code).toBe('AI_DEVELOPER_UNAVAILABLE');
    expect(body.error.diagnostic.code).toBe('AI_DEVELOPER_UNAVAILABLE');
    expect(vi.mocked(callExplainerAgent)).toHaveBeenCalledTimes(1);
    expect(db.__calls.some((call) => call.sql.includes('INSERT INTO review_sessions') && call.ran)).toBe(false);
  });
});

// ─── POST /rpc/review/session/init ───────────────────────────────────────────

describe('POST /rpc/review/session/init', () => {
  it('returns 400 when challengeId is missing', async () => {
    const env = buildEnv();
    const res = await rpcAuth.request(
      '/review/session/init',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({}),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when challenge is not multi-turn', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates', value: CANDIDATE },
        { match: 'FROM challenges', value: CHALLENGE_NON_MULTITURN },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/init',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ challengeId: 'ch_1' }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('not configured for multi-turn review');
  });

  it('creates a pending session for a new candidate/challenge/assessment', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates', value: CANDIDATE },
        { match: 'FROM challenges', value: CHALLENGE_ROW },
        { match: 'FROM assessments', value: ASSESSMENT_ROW },
        { match: 'candidate_id = ?1 AND challenge_id = ?2 AND assessment_id = ?3', value: null },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/init',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ challengeId: 'ch_1' }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessionId: string;
      status: string;
      maxRounds: number;
      currentRound: number;
      pr: unknown;
    };
    expect(body.status).toBe('pending');
    expect(body.maxRounds).toBe(4);
    expect(body.currentRound).toBe(1);
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);

    const insertCall = db.__calls.find((c) => c.sql.includes('INSERT INTO review_sessions'));
    expect(insertCall).toBeTruthy();
    expect(insertCall?.ran).toBe(true);
  });

  it('returns an existing session if one already exists', async () => {
    const existing = { ...SESSION_PENDING, id: 'sess_existing', current_round: 2, max_rounds: 6 };
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates', value: CANDIDATE },
        { match: 'FROM challenges', value: CHALLENGE_ROW },
        { match: 'FROM assessments', value: ASSESSMENT_ROW },
        { match: 'candidate_id = ?1 AND challenge_id = ?2 AND assessment_id = ?3', value: existing },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/init',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ challengeId: 'ch_1' }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessionId: string;
      status: string;
      maxRounds: number;
      currentRound: number;
    };
    expect(body.sessionId).toBe('sess_existing');
    expect(body.status).toBe('pending');
    expect(body.maxRounds).toBe(6);
    expect(body.currentRound).toBe(3);
  });

  it('marks terminal existing sessions as completed on init so candidates cannot keep reviewing', async () => {
    const existing = {
      ...SESSION_IN_PROGRESS,
      id: 'sess_scored',
      status: 'scored',
      current_round: 2,
      max_rounds: 4,
    };
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates', value: CANDIDATE },
        { match: 'FROM challenges', value: CHALLENGE_ROW },
        { match: 'FROM assessments', value: ASSESSMENT_ROW },
        { match: 'candidate_id = ?1 AND challenge_id = ?2 AND assessment_id = ?3', value: existing },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/init',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ challengeId: 'ch_1' }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessionId: string;
      status: string;
      completed: boolean;
      currentRound: number;
      maxRounds: number;
    };
    expect(body.sessionId).toBe('sess_scored');
    expect(body.status).toBe('scored');
    expect(body.completed).toBe(true);
    expect(body.currentRound).toBe(4);
    expect(body.maxRounds).toBe(4);
  });

  it('returns correct PR metadata and diff', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates', value: CANDIDATE },
        { match: 'FROM challenges', value: CHALLENGE_ROW },
        { match: 'FROM assessments', value: ASSESSMENT_ROW },
        { match: 'candidate_id = ?1 AND challenge_id = ?2 AND assessment_id = ?3', value: null },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/init',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ challengeId: 'ch_1' }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pr: {
        title: string | null;
        description: string | null;
        repoUrl: string | null;
        prNumber: number | null;
        diff: string;
      };
    };
    expect(body.pr.title).toBe('Add feature');
    expect(body.pr.description).toBe('This PR adds a feature');
    expect(body.pr.repoUrl).toBe('https://github.com/test/repo');
    expect(body.pr.prNumber).toBe(1);
    expect(body.pr.diff).toContain('const x = 1;');
  });

  it('returns waiting without creating a session when an assigned PR lacks source-backed packet context even with stale cached diff', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM candidates', value: CANDIDATE },
        { match: 'FROM challenges', value: ASSIGNED_CHALLENGE_WITHOUT_SOURCE_PACKET },
        { match: 'FROM assessments', value: ASSESSMENT_ROW },
        { match: 'candidate_id = ?1 AND challenge_id = ?2 AND assessment_id = ?3', value: null },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/init',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ challengeId: 'ch_1' }),
      },
      env,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('WAITING_FOR_MATCH');
    expect(body.error.message).toContain('source-backed review challenge');
    expect(db.__calls.some((call) => call.sql.includes('FROM review_challenge_packets'))).toBe(true);
    expect(db.__calls.find((call) => call.sql.includes('INSERT INTO review_sessions'))).toBeUndefined();
  });
});

// ─── POST /rpc/review/session/:id/message ────────────────────────────────────

describe('POST /rpc/review/session/:id/message', () => {
  it('first message: pending → in_progress, requires annotations + summary', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'implementer_persona', value: SESSION_PENDING },
        { match: 'FROM challenges', value: CHALLENGE_ROW },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/message',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          annotations: [{ content: 'Missing edge-case handling', file: 'src/index.ts', line: 5 }],
          summary: 'Initial review round',
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      round: number;
      agentResponse: Array<{ to_comment_id: number; move: string; content: string }>;
      threads: unknown[];
    };
    expect(body.round).toBe(1);
    expect(body.agentResponse).toHaveLength(1);
    expect(body.agentResponse[0]!.to_comment_id).toBe(1);
    expect(body.threads).toHaveLength(1);

    const statusUpdate = db.__calls.find(
      (c) => c.sql.includes('UPDATE review_sessions') && c.sql.includes("status = 'in_progress'"),
    );
    expect(statusUpdate).toBeTruthy();
    expect(statusUpdate?.ran).toBe(true);

    const transcriptUpdate = db.__calls.find(
      (c) => c.sql.includes('UPDATE review_sessions') && c.sql.includes('transcript = ?1'),
    );
    expect(transcriptUpdate).toBeTruthy();
    expect(transcriptUpdate?.ran).toBe(true);
  });

  it('uses Kimi for author pushback when KIMI_API_KEY is configured', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'implementer_persona', value: SESSION_PENDING },
        { match: 'FROM challenges', value: CHALLENGE_ROW },
      ],
    });
    const env = buildEnv({ DB: db, KIMI_API_KEY: 'test-kimi-key' });

    const res = await rpcAuth.request(
      '/review/session/sess_1/message',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          annotations: [{ content: 'Missing edge-case handling', file: 'src/index.ts', line: 5 }],
          summary: 'Initial review round',
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(callImplementerAgent)).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-kimi-key',
        provider: 'kimi',
      }),
    );
  });

  it('falls back to Workers AI author pushback when configured Kimi is unavailable', async () => {
    vi.mocked(callImplementerAgent)
      .mockRejectedValueOnce(new AiDeveloperUnavailableError({
        provider: 'kimi',
        reason: 'Review author agent provider failed: Kimi API error 401',
        retryable: true,
      }))
      .mockResolvedValueOnce([{
        to_comment_id: 1,
        move: 'pushback',
        content: 'Can you explain the concrete production failure this review comment prevents?',
      }]);

    const db = fakeD1({
      firstResponders: [
        { match: 'implementer_persona', value: SESSION_PENDING },
        { match: 'FROM challenges', value: CHALLENGE_ROW },
      ],
    });
    const env = buildEnv({
      DB: db,
      KIMI_API_KEY: 'bad-kimi-key',
      AI: { run: vi.fn() } as unknown as Env['AI'],
    });

    const res = await rpcAuth.request(
      '/review/session/sess_1/message',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          annotations: [{ content: 'Missing edge-case handling', file: 'src/index.ts', line: 5 }],
          summary: 'Initial review round',
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(callImplementerAgent)).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        apiKey: 'bad-kimi-key',
        provider: 'kimi',
      }),
    );
    expect(vi.mocked(callImplementerAgent)).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        apiKey: '',
        provider: 'workers-ai',
        ai: env.AI,
      }),
    );
    const body = await res.json() as {
      agentResponse: Array<{ move: string; content: string }>;
    };
    expect(body.agentResponse[0]?.move).toBe('pushback');
  });

  it('returns AI_DEVELOPER_UNAVAILABLE instead of a fake author round when the author agent is unavailable', async () => {
    vi.mocked(callImplementerAgent).mockRejectedValueOnce(new AiDeveloperUnavailableError({
      provider: 'workers-ai',
      reason: 'Workers AI binding is not available for the review author agent.',
      retryable: true,
    }));

    const db = fakeD1({
      firstResponders: [
        { match: 'implementer_persona', value: SESSION_PENDING },
        { match: 'FROM challenges', value: CHALLENGE_ROW },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/message',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          annotations: [{ content: 'Missing edge-case handling', file: 'src/index.ts', line: 5 }],
          summary: 'Initial review round',
        }),
      },
      env,
    );

    expect(res.status).toBe(503);
    const body = await res.json() as {
      error: {
        code: string;
        diagnostic: {
          mode: string;
          verdict: string;
          provider: string;
          retryable: boolean;
        };
      };
    };
    expect(body.error.code).toBe('AI_DEVELOPER_UNAVAILABLE');
    expect(body.error.diagnostic).toMatchObject({
      mode: 'AI_DEVELOPER_UNAVAILABLE',
      verdict: 'AI_DEVELOPER_UNAVAILABLE',
      provider: 'workers-ai',
      retryable: true,
    });
    const transcriptUpdate = db.__calls.find(
      (call) => call.sql.includes('UPDATE review_sessions') && call.sql.includes('transcript = ?1'),
    );
    expect(transcriptUpdate).toBeUndefined();
  });

  it('does not call implementer agent when assigned PR prompt context lacks source-backed packet graph', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'implementer_persona', value: SESSION_PENDING },
        { match: 'FROM challenges ch', value: ASSIGNED_CHALLENGE_WITHOUT_SOURCE_PACKET },
        { match: 'FROM review_challenge_packets', value: null },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/message',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          annotations: [{ content: 'Missing edge-case handling', file: 'src/index.ts', line: 5 }],
          summary: 'Initial review round',
        }),
      },
      env,
    );

    expect(res.status).toBe(409);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('WAITING_FOR_MATCH');
    expect(vi.mocked(callImplementerAgent)).not.toHaveBeenCalled();
    expect(db.__calls.some((call) => call.sql.includes('FROM review_challenge_packets'))).toBe(true);
  });

  it('follow-up message: appends round, respects maxRounds', async () => {
    vi.mocked(callImplementerAgent).mockResolvedValue([
      { to_comment_id: 1, move: 'change', content: 'Fixed in commit abc' },
    ]);

    const db = fakeD1({
      firstResponders: [
        { match: 'implementer_persona', value: SESSION_IN_PROGRESS },
        { match: 'FROM challenges', value: CHALLENGE_ROW },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/message',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          replies: [{ toCommentId: 1, content: 'Please fix this' }],
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { round: number };
    expect(body.round).toBe(2);

    const transcriptUpdate = db.__calls.find(
      (c) => c.sql.includes('UPDATE review_sessions') && c.sql.includes('transcript = ?1'),
    );
    expect(transcriptUpdate).toBeTruthy();
    expect(transcriptUpdate?.ran).toBe(true);
  });

  it('returns 400 when max rounds reached', async () => {
    const db = fakeD1({
      firstResponders: [{ match: 'implementer_persona', value: SESSION_MAX_ROUNDS }],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/message',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          replies: [{ toCommentId: 1, content: 'One more thing' }],
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('MAX_ROUNDS_REACHED');
  });

  it('returns 403 for wrong candidate', async () => {
    const db = fakeD1({
      firstResponders: [{ match: 'implementer_persona', value: SESSION_OTHER_CANDIDATE }],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/message',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          annotations: [{ content: 'Bug' }],
          summary: 'Review',
        }),
      },
      env,
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 when no valid comments are provided', async () => {
    const db = fakeD1({
      firstResponders: [{ match: 'implementer_persona', value: SESSION_IN_PROGRESS }],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/message',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          replies: [{ toCommentId: null, content: '' }],
          newAnnotations: [],
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toContain('No valid replies or annotations');
  });
});

// ─── POST /rpc/review/session/:id/complete ───────────────────────────────────

describe('POST /rpc/review/session/:id/complete', () => {
  it('returns 400 for invalid verdict', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'candidate_id, challenge_id, assessment_id, status, transcript',
          value: SESSION_IN_PROGRESS,
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/complete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ verdict: 'invalid', summary: 'Looks good' }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when summary is missing', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'candidate_id, challenge_id, assessment_id, status, transcript',
          value: SESSION_IN_PROGRESS,
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/complete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ verdict: 'approve' }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('transitions session to verdict_submitted and writes submission', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'candidate_id, challenge_id, assessment_id, status, transcript',
          value: SESSION_IN_PROGRESS,
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/complete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ verdict: 'approve', summary: 'Solid work overall.' }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; sessionId: string };
    expect(body.status).toBe('verdict_submitted');
    expect(body.sessionId).toBe('sess_1');

    const updateSession = db.__calls.find(
      (c) => c.sql.includes('UPDATE review_sessions') && c.sql.includes("status = 'verdict_submitted'"),
    );
    expect(updateSession).toBeTruthy();
    expect(updateSession?.ran).toBe(true);

    const insertSub = db.__calls.find((c) => c.sql.includes('INSERT INTO challenge_submissions'));
    expect(insertSub).toBeTruthy();
    expect(insertSub?.ran).toBe(true);

    const updateAssessment = db.__calls.find(
      (c) => c.sql.includes('UPDATE assessments') && c.sql.includes("status = 'COMPLETED'"),
    );
    expect(updateAssessment).toBeTruthy();
    expect(updateAssessment?.ran).toBe(true);

    const insertJudgeExample = db.__calls.find((c) =>
      c.sql.includes('INSERT INTO code_review_judge_examples')
    );
    expect(insertJudgeExample).toBeTruthy();
    expect(insertJudgeExample?.ran).toBe(true);
    expect(insertJudgeExample?.params[1]).toBe('sess_1');
    expect(insertJudgeExample?.params[2]).toBe('assessment_1');
    expect(insertJudgeExample?.params[3]).toBe('ch_1');
    expect(insertJudgeExample?.params[4]).toBe('cand_1');

    const promptInput = JSON.parse(String(insertJudgeExample?.params[6])) as {
      task?: string;
      candidateReview?: {
        finalVerdict?: string;
        finalSummary?: string;
        comments?: Array<{ what?: string }>;
      };
      aiDeveloperPushback?: unknown[];
      improvementUses?: string[];
    };
    expect(promptInput.task).toBe('score_and_improve_code_review_judge');
    expect(promptInput.candidateReview?.finalVerdict).toBe('approve');
    expect(promptInput.candidateReview?.finalSummary).toBe('Solid work overall.');
    expect(promptInput.candidateReview?.comments).toEqual([
      expect.objectContaining({ what: 'Missing test' }),
    ]);
    expect(promptInput.aiDeveloperPushback).toHaveLength(1);
    expect(promptInput.improvementUses).toContain('judge_prompt_regression');
  });

  it('reconciles standalone CODE_REVIEW scheduled interview rows for recruiter results', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'candidate_id, challenge_id, assessment_id, status, transcript',
          value: {
            ...SESSION_IN_PROGRESS,
            assessment_id: 'standalone-review-assessment-interview_1',
          },
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/complete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ verdict: 'request_changes', summary: 'Please add the missing regression test.' }),
      },
      env,
    );

    expect(res.status).toBe(200);

    const updateScheduledInterview = db.__calls.find((c) =>
      c.sql.includes('UPDATE scheduled_interviews')
      && c.sql.includes("interview_type = 'CODE_REVIEW'")
      && c.sql.includes("status = 'COMPLETED'")
    );
    expect(updateScheduledInterview).toBeTruthy();
    expect(updateScheduledInterview?.ran).toBe(true);
    expect(updateScheduledInterview?.params[2]).toBe('interview_1');
    expect(updateScheduledInterview?.params[3]).toBe('cand_1');

    const storedResponse = JSON.parse(String(updateScheduledInterview?.params[0])) as {
      type?: string;
      verdict?: string;
      summary?: string;
      reviewSessionId?: string;
      annotations?: Array<{ comment?: string; severity?: string | null }>;
      transcript?: { verdict?: { decision?: string; summary?: string } };
    };
    expect(storedResponse.type).toBe('CODE_REVIEW');
    expect(storedResponse.verdict).toBe('request_changes');
    expect(storedResponse.summary).toBe('Please add the missing regression test.');
    expect(storedResponse.reviewSessionId).toBe('sess_1');
    expect(storedResponse.annotations).toEqual([
      expect.objectContaining({
        comment: 'Missing test',
        severity: 'major',
      }),
    ]);
    expect(storedResponse.transcript?.verdict).toEqual(
      expect.objectContaining({
        decision: 'request_changes',
        summary: 'Please add the missing regression test.',
      }),
    );
  });

  it('returns 409 when session is not in_progress', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'candidate_id, challenge_id, assessment_id, status, transcript',
          value: SESSION_PENDING,
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/complete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ verdict: 'approve', summary: 'Looks good' }),
      },
      env,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CONFLICT');
  });

  it('returns 403 for wrong candidate', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'candidate_id, challenge_id, assessment_id, status, transcript',
          value: SESSION_OTHER_CANDIDATE,
        },
      ],
    });
    const env = buildEnv({ DB: db });

    const res = await rpcAuth.request(
      '/review/session/sess_1/complete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authHeader(),
        },
        body: JSON.stringify({ verdict: 'approve', summary: 'Looks good' }),
      },
      env,
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
