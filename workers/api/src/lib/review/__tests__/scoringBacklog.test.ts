import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../types';
import { processCodeReviewScoringBacklog } from '../scoringBacklog';
import { scoreAndPropagate } from '../scoreAndPropagate';

vi.mock('../scoreAndPropagate', () => ({
  scoreAndPropagate: vi.fn(async () => undefined),
}));

interface PreparedCall {
  sql: string;
  params: unknown[];
  ran: boolean;
}

interface FakeD1 extends D1Database {
  __calls: PreparedCall[];
}

function fakeD1(rows: unknown[]): FakeD1 {
  const calls: PreparedCall[] = [];
  const prepare = (sql: string): D1PreparedStatement => {
    const call: PreparedCall = { sql, params: [], ran: false };
    calls.push(call);
    const stmt = {
      bind: (...params: unknown[]) => {
        call.params = params;
        return stmt;
      },
      first: async () => null,
      all: async () => ({ results: rows, success: true, meta: {} }),
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
  return { DB: db, AI: {} as Ai } as Env;
}

describe('processCodeReviewScoringBacklog', () => {
  beforeEach(() => {
    vi.mocked(scoreAndPropagate).mockClear();
  });

  it('retries verdict-submitted, failed, and stale scoring sessions from cron', async () => {
    const db = fakeD1([
      {
        id: 'sess_verdict',
        assessment_id: 'assessment_1',
        challenge_id: 'challenge_1',
        transcript: JSON.stringify({ rounds: [{ reviewer_comments: [{ body: 'Needs idempotency.' }] }] }),
      },
      {
        id: 'sess_stale',
        assessment_id: 'assessment_2',
        challenge_id: 'challenge_2',
        transcript: JSON.stringify({ rounds: [] }),
      },
    ]);

    const result = await processCodeReviewScoringBacklog(buildEnv(db), {
      now: new Date('2026-06-28T04:00:00.000Z'),
      staleAfterMs: 120_000,
      limit: 5,
    });

    expect(result.retried).toBe(2);
    expect(scoreAndPropagate).toHaveBeenCalledTimes(2);
    expect(scoreAndPropagate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sessionId: 'sess_verdict',
      assessmentId: 'assessment_1',
      challengeId: 'challenge_1',
      scope: 'scheduled/review-scoring-backlog',
    }));
    expect(db.__calls[0]?.sql).toContain("status IN ('verdict_submitted', 'scoring', 'scoring_failed')");
    expect(db.__calls[0]?.params[1]).toBe(5);
  });
});
