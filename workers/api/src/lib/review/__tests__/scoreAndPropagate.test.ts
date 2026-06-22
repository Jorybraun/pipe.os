import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../types';
import { scoreAndPropagate } from '../scoreAndPropagate';
import { scoreReviewSession } from '../../scorerAgent';
import { ingestCodeReviewScoreReportToLivingContext } from '../../livingContext/codeReview';

vi.mock('../../scorerAgent', () => ({
  scoreReviewSession: vi.fn(),
}));

vi.mock('../../rcd', () => ({
  loadRcdForAssessment: vi.fn(async () => null),
}));

vi.mock('../../livingContext/codeReview', () => ({
  ingestCodeReviewScoreReportToLivingContext: vi.fn(async () => undefined),
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
    AI: {} as Ai,
  } as Env;
}

function assignedScoringRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ground_truth: JSON.stringify([{ id: 99, severity: 'critical', description: 'stale planted bug' }]),
    server_config: JSON.stringify({
      plantedBugs: [{ id: 100, severity: 'major', description: 'stale server planted bug' }],
    }),
    github_pr_title: 'Legacy challenge title',
    github_pr_description: 'Legacy challenge description',
    instructions: 'Review this PR.',
    cached_diff_json: JSON.stringify({ files: [{ filename: 'legacy.ts', headContent: 'stale cached diff' }] }),
    github_repo_url: null,
    github_pr_number: null,
    candidate_id: 'cand_1',
    created_at: '2026-06-20T00:00:00.000Z',
    assignment_id: 'assign_1',
    effective_repo_url: 'https://github.com/test/source-backed-repo',
    effective_pr_number: 42,
    ...overrides,
  };
}

function sourceBackedPacket() {
  return {
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
}

const scoreReport = {
  dimensions: {
    issue_identification: 4,
    prioritization: 4,
    revision_evaluation: 4,
    reasoning_quality: 4,
    question_formation: 4,
    ai_direction: 4,
  },
  evidence: {},
  metrics: {
    bugs_found: [],
    bugs_missed: [],
    bugs_found_pct: 0,
    false_positive_count: 0,
    true_finding_count: 0,
    approved_with_unfound_critical: false,
    cave_ratio: 0,
    fix_verifications: 0,
  },
  effectiveness: { ris: 0, efficiency: 0, delta: 100, score: 20 },
  overall: {
    score: 82,
    band: 'strong' as const,
    narrative: 'Source-backed scoring complete.',
    strengths: [],
    growth_areas: [],
  },
  scorer_a_summary: '',
  scorer_b_summary: '',
};

describe('scoreAndPropagate assignment-backed provenance', () => {
  beforeEach(() => {
    vi.mocked(scoreReviewSession).mockReset();
    vi.mocked(scoreReviewSession).mockResolvedValue(scoreReport);
    vi.mocked(ingestCodeReviewScoreReportToLivingContext).mockClear();
  });

  it('scores assigned PRs from source-backed packet spans and not stale challenge cache', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM challenges ch', value: assignedScoringRow() },
        { match: 'FROM review_challenge_packets', value: { packet_json: JSON.stringify(sourceBackedPacket()) } },
      ],
      allResponders: [
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

    await scoreAndPropagate({
      env: buildEnv(db),
      sessionId: 'sess_1',
      assessmentId: 'assessment_1',
      challengeId: 'ch_1',
      transcript: { rounds: [] },
      scope: 'test',
    });

    expect(scoreReviewSession).toHaveBeenCalledTimes(1);
    const scorerInput = vi.mocked(scoreReviewSession).mock.calls[0]![0];
    expect(scorerInput.groundTruth).toEqual([]);
    expect(scorerInput.diff).toContain('publishWithRetry(order)');
    expect(scorerInput.diff).not.toContain('stale cached diff');
    expect(scorerInput.prTitle).toBe('Source-backed retry PR');
    expect(scorerInput.prDescription).toBe('Source-backed packet body');
    expect(ingestCodeReviewScoreReportToLivingContext).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        sessionId: 'sess_1',
        candidateId: 'cand_1',
        challengeId: 'ch_1',
        assessmentId: 'assessment_1',
        producer: 'automated_scorer',
      }),
    );
  });

  it('fails closed when an assigned PR has no source-backed packet graph', async () => {
    const db = fakeD1({
      firstResponders: [
        { match: 'FROM challenges ch', value: assignedScoringRow() },
        { match: 'FROM review_challenge_packets', value: null },
      ],
    });

    await scoreAndPropagate({
      env: buildEnv(db),
      sessionId: 'sess_1',
      assessmentId: 'assessment_1',
      challengeId: 'ch_1',
      transcript: { rounds: [] },
      scope: 'test',
    });

    expect(scoreReviewSession).not.toHaveBeenCalled();
    expect(db.__calls.some((call) =>
      call.ran &&
      call.sql.includes('UPDATE review_sessions') &&
      call.sql.includes("status = 'scoring_failed'")
    )).toBe(true);
  });
});
