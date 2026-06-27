import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../types';
import { review } from '../review';

vi.mock('../../../lib/livingContext/codeReview', () => ({
  ingestCodeReviewTranscriptToLivingContext: vi.fn(async () => ({ artifactVersionId: 'transcript_version_1' })),
}));

vi.mock('../../../lib/review/judgeImprovementExamples', () => ({
  persistCodeReviewJudgeExample: vi.fn(async () => undefined),
}));

vi.mock('../../../lib/review/scoreAndPropagate', () => ({
  scoreAndPropagate: vi.fn(async () => undefined),
}));

vi.mock('../../../lib/telemetry/sessionEvents', () => ({
  recordSessionEvent: vi.fn(async () => undefined),
}));

interface PreparedCall {
  sql: string;
  params: unknown[];
  ran: boolean;
}

interface FakeD1Config {
  firstResponders?: Array<{ match: string; value: unknown }>;
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
      all: async () => ({ results: [], success: true, meta: {} }),
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

function mountReviewApp(candidateId = 'candidate-1'): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.set('candidateId', candidateId);
    c.set('pipelineId', 'pipeline-1');
    await next();
  });
  app.route('/rpc/review', review);
  return app;
}

describe('pipeline-backed code review completion', () => {
  it('marks the matching scheduled CODE_REVIEW interview completed with the submitted verdict', async () => {
    const db = fakeD1({
      firstResponders: [
        {
          match: 'FROM review_sessions WHERE id',
          value: {
            id: 'review-session-1',
            candidate_id: 'candidate-1',
            challenge_id: 'challenge-code-review-1',
            assessment_id: 'assessment-1',
            status: 'in_progress',
            transcript: JSON.stringify({
              rounds: [{
                round: 1,
                reviewer_comments: [{
                  id: 1,
                  file: 'src/popover.ts',
                  line: 42,
                  severity: 'major',
                  what: 'Timing behavior needs a regression test.',
                }],
                implementer_responses: [],
              }],
            }),
            implementer_persona: 'junior',
            created_at: '2026-06-27T00:00:00.000Z',
          },
        },
        {
          match: 'SELECT stage_id FROM assessments',
          value: { stage_id: 'stage-code-review-1' },
        },
      ],
    });
    const app = mountReviewApp();

    const response = await app.request('/rpc/review/session/review-session-1/complete', {
      method: 'POST',
      body: JSON.stringify({
        verdict: 'request_changes',
        summary: 'Request changes until the timing regression has direct coverage.',
      }),
      headers: { 'Content-Type': 'application/json' },
    }, buildEnv(db));

    expect(response.status).toBe(200);
    const body = await response.json() as { status: string; sessionId: string };
    expect(body).toEqual({ status: 'verdict_submitted', sessionId: 'review-session-1' });

    const scheduledUpdate = db.__calls.find((call) =>
      call.ran && call.sql.includes('UPDATE scheduled_interviews')
    );
    expect(scheduledUpdate).toBeDefined();
    expect(scheduledUpdate?.params[2]).toBe('candidate-1');
    expect(scheduledUpdate?.params[3]).toBe('stage-code-review-1');

    const submission = JSON.parse(String(scheduledUpdate?.params[0])) as {
      type: string;
      verdict: string;
      summary: string;
      reviewSessionId: string;
      annotations: Array<{ file: string; line: number; severity: string; comment: string }>;
    };
    expect(submission).toMatchObject({
      type: 'CODE_REVIEW',
      verdict: 'request_changes',
      summary: 'Request changes until the timing regression has direct coverage.',
      reviewSessionId: 'review-session-1',
    });
    expect(submission.annotations).toEqual([{
      id: '1',
      file: 'src/popover.ts',
      line: 42,
      severity: 'major',
      comment: 'Timing behavior needs a regression test.',
    }]);
  });
});
