import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../types';
import { reviewSessions } from '../reviewSessions';
import { ingestCodeReviewScoreReportToLivingContext } from '../../../lib/livingContext/codeReview';

vi.mock('../../../lib/livingContext/codeReview', () => ({
  ingestCodeReviewScoreReportToLivingContext: vi.fn(async () => ({ artifactVersionId: 'score_report_version_1' })),
}));

interface PreparedCall {
  sql: string;
  params: unknown[];
  ran: boolean;
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
    const call: PreparedCall = { sql, params: [], ran: false };
    calls.push(call);

    const stmt = {
      bind: (...params: unknown[]) => {
        call.params = params;
        return stmt;
      },
      first: async () => {
        const match = (cfg.firstResponders ?? []).find((responder) => sql.includes(responder.match));
        return match ? match.value : null;
      },
      all: async () => {
        const match = (cfg.allResponders ?? []).find((responder) => sql.includes(responder.match));
        return { results: match ? match.value : [], success: true, meta: {} };
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

function buildEnv(db: FakeD1): Env {
  return {
    DB: db,
    DEV_AUTH_BYPASS: 'true',
    DEV_BYPASS_USER_ID: 'user_1',
  } as Env;
}

function sourceBackedPacket() {
  return {
    pullRequest: {
      title: 'Source-backed transcript PR',
      author: 'dev',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      mergedAt: '2026-06-20T12:00:00.000Z',
      body: 'Source-backed packet body',
    },
    demands: [{ sourceSpanIds: ['repo-span-transcript'] }],
  };
}

describe('review session transcript provenance', () => {
  it('does not expose stale challenge ground truth for assignment-backed PR sessions', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM review_sessions rs',
          value: {
            id: 'sess_1',
            transcript: JSON.stringify({ rounds: [] }),
            status: 'scored',
            implementer_persona: 'junior',
            current_round: 1,
            max_rounds: 4,
            ground_truth: JSON.stringify([{ id: 1, severity: 'critical', description: 'stale fixture bug' }]),
            server_config: JSON.stringify({ plantedBugs: [{ id: 2, severity: 'major', description: 'stale server bug' }] }),
            cached_diff_json: JSON.stringify({ files: [{ filename: 'legacy.ts', headContent: 'stale diff' }] }),
            instructions: 'Review this PR.',
            github_pr_title: 'Legacy challenge title',
            github_pr_description: 'Legacy challenge description',
            github_repo_url: null,
            github_pr_number: null,
            assignment_id: 'assign_1',
            effective_repo_url: 'https://github.com/test/source-backed-repo',
            effective_pr_number: 42,
          },
        },
        { match: 'FROM review_challenge_packets', value: { packet_json: JSON.stringify(sourceBackedPacket()) } },
      ],
      allResponders: [
        {
          match: 'FROM repo_source_spans',
          value: [{
            id: 'repo-span-transcript',
            path: 'src/orders/retry.ts',
            exact_text: 'publishWithRetry(order)',
            line_start: 18,
            line_end: 18,
          }],
        },
      ],
    });

    const res = await reviewSessions.request('/sess_1/transcript', {}, buildEnv(db));

    expect(res.status).toBe(200);
    const body = await res.json() as {
      groundTruth: unknown;
      serverConfig: unknown;
      prTitle: string | null;
      prDescription: string | null;
      reviewProvenance: {
        assignmentBacked: boolean;
        sourceBackedReady: boolean | null;
        repoUrl: string | null;
        prNumber: number | null;
      };
    };
    expect(body.groundTruth).toBeNull();
    expect(body.serverConfig).toBeNull();
    expect(body.prTitle).toBe('Source-backed transcript PR');
    expect(body.prDescription).toBe('Source-backed packet body');
    expect(body.reviewProvenance).toEqual({
      assignmentBacked: true,
      sourceBackedReady: true,
      repoUrl: 'https://github.com/test/source-backed-repo',
      prNumber: 42,
    });
  });
});

describe('review session judge example queue', () => {
  it('returns owner-scoped labelled examples for judge replay and calibration', async () => {
    const promptInput = {
      task: 'score_and_improve_code_review_judge',
      candidateReview: {
        comments: [{ what: 'Caught the retry bug.' }],
      },
    };
    const expectedOutput = {
      overall: {
        score: 91,
        band: 'strong',
      },
    };
    const judgeFeedback = {
      labelType: 'human_score_report',
      producer: 'recruiter_override',
    };
    const provenance = {
      sourceTables: ['review_sessions', 'challenge_submissions'],
      observedAt: '2026-06-26T12:00:00.000Z',
    };
    const db = fakeD1({
      allResponders: [{
        match: 'FROM code_review_judge_examples',
        value: [{
          id: 'example_1',
          session_id: 'sess_1',
          assessment_id: 'assessment_1',
          challenge_id: 'challenge_1',
          candidate_id: 'candidate_1',
          example_version: 'code-review-judge-example-v1',
          prompt_input_json: JSON.stringify(promptInput),
          expected_output_json: JSON.stringify(expectedOutput),
          judge_feedback_json: JSON.stringify(judgeFeedback),
          provenance_json: JSON.stringify(provenance),
          status: 'LABELLED',
          created_at: '2026-06-26T12:00:00.000Z',
          updated_at: '2026-06-26T12:30:00.000Z',
          candidate_name: 'Ada Reviewer',
          candidate_email: 'ada@example.com',
        }],
      }],
    });

    const res = await reviewSessions.request('/judge-examples?status=labelled&limit=5', {}, buildEnv(db));

    expect(res.status).toBe(200);
    const body = await res.json() as {
      examples: Array<{
        id: string;
        sessionId: string;
        status: string;
        candidate: {
          name: string | null;
          email: string | null;
        };
        promptInput: unknown;
        expectedOutput: unknown;
        judgeFeedback: unknown;
        provenance: unknown;
      }>;
      filters: {
        status: string | null;
        limit: number;
      };
    };

    expect(body.filters).toEqual({ status: 'LABELLED', limit: 5 });
    expect(body.examples).toHaveLength(1);
    expect(body.examples[0]).toEqual(expect.objectContaining({
      id: 'example_1',
      sessionId: 'sess_1',
      status: 'LABELLED',
      candidate: {
        name: 'Ada Reviewer',
        email: 'ada@example.com',
      },
      promptInput,
      expectedOutput,
      judgeFeedback,
      provenance,
    }));

    const selectCall = db.__calls.find((call) => call.sql.includes('FROM code_review_judge_examples'));
    expect(selectCall?.params).toEqual(['user_1', 'LABELLED', 5]);
  });

  it('rejects unknown judge example statuses', async () => {
    const db = fakeD1();

    const res = await reviewSessions.request('/judge-examples?status=stale', {}, buildEnv(db));

    expect(res.status).toBe(400);
    const body = await res.json() as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(body.error?.message).toContain('READY');
    expect(db.__calls).toEqual([]);
  });
});

describe('review session score overrides', () => {
  beforeEach(() => {
    vi.mocked(ingestCodeReviewScoreReportToLivingContext).mockClear();
  });

  it('labels a replayable judge example when a recruiter overrides the score', async () => {
    const transcript = {
      rounds: [{
        round: 1,
        reviewer_comments: [{
          id: 1,
          file: 'src/orders/retry.ts',
          line: 18,
          category: 'correctness',
          severity: 'major',
          what: 'The retry loop can double-publish the order after a timeout.',
          why: 'The operation is not idempotent and the timeout does not prove the first publish failed.',
          suggestion: 'Use an idempotency key before retrying.',
          positive: false,
        }],
        reviewer_verdict: 'request_changes',
        reviewer_summary: 'Needs idempotency before this can merge.',
        implementer_responses: [{
          to_comment_id: 1,
          move: 'pushback',
          content: 'The queue provider already deduplicates retries.',
        }],
      }],
      verdict: {
        decision: 'request_changes',
        summary: 'The PR needs idempotent publish semantics before merge.',
        submittedAt: '2026-06-26T12:30:00.000Z',
      },
    };
    const scoreReport = {
      overall: {
        score: 91,
        band: 'strong',
        narrative: 'Strong review: caught the production data-loss risk and defended the decision.',
      },
      dimensions: {
        issue_identification: 5,
        prioritization: 5,
        reasoning_quality: 5,
      },
    };
    const db = fakeD1({
      firstResponders: [
        {
          match: 'SELECT rs.id, rs.assessment_id',
          value: {
            id: 'sess_1',
            assessment_id: 'assessment_1',
            challenge_id: 'ch_1',
            candidate_id: 'cand_1',
            transcript: JSON.stringify(transcript),
            created_at: '2026-06-26T12:00:00.000Z',
          },
        },
        {
          match: 'SELECT cs.id FROM challenge_submissions cs',
          value: { id: 'submission_1' },
        },
      ],
    });

    const res = await reviewSessions.request('/sess_1/score', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scoreReport,
        reviewerFeedback: 'The automated judge underweighted the candidate defending their request-changes stance.',
        judgeFailureModes: ['candidate_caved_to_weak_pushback', '', 'severity_calibration_wrong'],
      }),
    }, buildEnv(db));

    expect(res.status).toBe(200);
    expect(ingestCodeReviewScoreReportToLivingContext).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        sessionId: 'sess_1',
        candidateId: 'cand_1',
        challengeId: 'ch_1',
        assessmentId: 'assessment_1',
        producer: 'recruiter_override',
        producerId: 'user_1',
      }),
    );

    const insertExample = db.__calls.find((call) =>
      call.ran && call.sql.includes('INSERT INTO code_review_judge_examples')
    );
    expect(insertExample).toBeDefined();

    const labelExample = db.__calls.find((call) =>
      call.ran && call.sql.includes('UPDATE code_review_judge_examples')
    );
    expect(labelExample).toBeDefined();
    expect(labelExample?.params[0]).toBe(JSON.stringify(scoreReport));
    expect(labelExample?.params[3]).toBe('sess_1');

    const feedback = JSON.parse(labelExample?.params[1] as string) as {
      source: string;
      producer: string;
      producerId: string;
      labelType: string;
      reviewerFeedback: string | null;
      judgeFailureModes: string[];
    };
    expect(feedback).toMatchObject({
      source: 'review_session_score_override',
      producer: 'recruiter_override',
      producerId: 'user_1',
      labelType: 'human_score_report',
      reviewerFeedback: 'The automated judge underweighted the candidate defending their request-changes stance.',
      judgeFailureModes: ['candidate_caved_to_weak_pushback', 'severity_calibration_wrong'],
    });
  });
});
