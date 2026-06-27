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

import { callImplementerAgent } from '../lib/implementerAgent';
import { callExplainerAgent } from '../lib/explainerAgent';
import { matchReposForCandidateNeo4j } from '../lib/neo4j/matchingQueries';
import { matchReposByGroundedEdges } from '../lib/neo4j/contextualGraph';

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
          match: "interview_type = 'DEV_CONTAINER_CHALLENGE'",
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
    expect(body.currentRound).toBe(0);
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
    expect(body.currentRound).toBe(2);
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
