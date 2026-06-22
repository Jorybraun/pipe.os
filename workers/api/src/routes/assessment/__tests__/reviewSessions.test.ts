import { describe, expect, it } from 'vitest';
import type { Env } from '../../../types';
import { reviewSessions } from '../reviewSessions';

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
