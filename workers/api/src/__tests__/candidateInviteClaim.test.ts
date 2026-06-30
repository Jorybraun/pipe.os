import { describe, expect, it } from 'vitest';
import { rpcAuth, rpcPublic } from '../routes/rpc';
import type { Env } from '../types';

interface CandidateRow {
  id: string;
  pipeline_id: string | null;
  invite_token: string;
  status: string;
  name: string | null;
}

interface ScheduledInterviewRow {
  id: string;
  candidate_id: string;
  interview_type: string;
  status: string;
}

interface FakeD1 extends D1Database {
  candidate: CandidateRow;
  scheduledInterviews: ScheduledInterviewRow[];
}

function fakeD1(candidate: CandidateRow, scheduledInterviews: ScheduledInterviewRow[] = []): FakeD1 {
  const db = {
    candidate,
    scheduledInterviews,
    prepare(sql: string): D1PreparedStatement {
      const statement = {
        params: [] as unknown[],
        bind(...params: unknown[]) {
          this.params = params;
          return this as unknown as D1PreparedStatement;
        },
        async first() {
          if (sql.includes('WHERE invite_token = ?1')) {
            const inviteToken = this.params[0];
            if (db.candidate.invite_token !== inviteToken) return null;
            return {
              id: db.candidate.id,
              pipeline_id: db.candidate.pipeline_id,
              status: db.candidate.status,
              name: db.candidate.name,
            };
          }

          if (sql.includes('SELECT invite_token, status FROM candidates WHERE id = ?1')) {
            const candidateId = this.params[0];
            if (db.candidate.id !== candidateId) return null;
            return {
              invite_token: db.candidate.invite_token,
              status: db.candidate.status,
            };
          }

          return null;
        },
        async all() {
          return { results: [], success: true, meta: {} };
        },
        async run() {
          if (sql.includes('UPDATE candidates') && sql.includes('status = CASE') && sql.includes('AND invite_token = ?4')) {
            const [claimedToken, , candidateId, inviteToken] = this.params;
            if (db.candidate.id === candidateId && db.candidate.invite_token === inviteToken) {
              db.candidate.invite_token = String(claimedToken);
              if (db.candidate.status === 'INVITED') db.candidate.status = 'IN_PROGRESS';
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (sql.includes('UPDATE candidates') && sql.includes('AND invite_token = ?4')) {
            const [inviteToken, , candidateId, claimedToken] = this.params;
            if (db.candidate.id === candidateId && db.candidate.invite_token === claimedToken) {
              db.candidate.invite_token = String(inviteToken);
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (sql.includes('UPDATE scheduled_interviews')) {
            const [, candidateId] = this.params;
            let changes = 0;
            for (const interview of db.scheduledInterviews) {
              if (
                interview.candidate_id === candidateId
                && ['INVITED', 'SCHEDULED'].includes(interview.status)
                && ['CODE_REVIEW', 'DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX'].includes(interview.interview_type)
              ) {
                interview.status = 'ACTIVE';
                changes += 1;
              }
            }
            return { success: true, meta: { changes } };
          }
          return { success: true, meta: { changes: 0 } };
        },
        async raw() {
          return [];
        },
      };
      return statement as unknown as D1PreparedStatement;
    },
    dump: async () => new ArrayBuffer(0),
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
  };

  return db as unknown as FakeD1;
}

function buildEnv(
  candidate: CandidateRow,
  scheduledInterviews: ScheduledInterviewRow[] = [],
): Env & { DB: FakeD1 } {
  return {
    SESSION_TOKEN_SECRET: 'test-secret',
    DB: fakeD1(candidate, scheduledInterviews),
  } as Env & { DB: FakeD1 };
}

describe('candidate invite claiming', () => {
  it('does not claim a one-use invite when the assessment page only resolves the token', async () => {
    const env = buildEnv({
      id: 'candidate-1',
      pipeline_id: null,
      invite_token: 'invite-token-1',
      status: 'INVITED',
      name: 'Ada',
    });

    const response = await rpcPublic.request('/resolve-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteToken: 'invite-token-1' }),
    }, env);

    expect(response.status).toBe(200);
    const body = await response.json() as { sessionToken: string; status: string };
    expect(body.sessionToken).toEqual(expect.any(String));
    expect(body.status).toBe('INVITED');
    expect(env.DB.candidate.invite_token).toBe('invite-token-1');
    expect(env.DB.candidate.status).toBe('INVITED');
  });

  it('claims the one-use invite only when the assessment is started', async () => {
    const env = buildEnv({
      id: 'candidate-1',
      pipeline_id: null,
      invite_token: 'invite-token-1',
      status: 'INVITED',
      name: 'Ada',
    }, [
      {
        id: 'interview-1',
        candidate_id: 'candidate-1',
        interview_type: 'CODE_REVIEW',
        status: 'INVITED',
      },
    ]);

    const resolveResponse = await rpcPublic.request('/resolve-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteToken: 'invite-token-1' }),
    }, env);
    const resolved = await resolveResponse.json() as { sessionToken: string };

    const startResponse = await rpcAuth.request('/start-assessment', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resolved.sessionToken}` },
    }, env);

    expect(startResponse.status).toBe(200);
    await expect(startResponse.json()).resolves.toMatchObject({
      success: true,
      status: 'IN_PROGRESS',
      alreadyStarted: false,
    });
    expect(env.DB.candidate.invite_token).toBe('CLAIMED::invite-token-1');
    expect(env.DB.candidate.status).toBe('IN_PROGRESS');
    expect(env.DB.scheduledInterviews[0]?.status).toBe('ACTIVE');
  });

  it('repairs a pre-start claimed prefix instead of rejecting an invited candidate', async () => {
    const env = buildEnv({
      id: 'candidate-1',
      pipeline_id: null,
      invite_token: 'CLAIMED::invite-token-1',
      status: 'INVITED',
      name: 'Ada',
    });

    const response = await rpcPublic.request('/resolve-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteToken: 'invite-token-1' }),
    }, env);

    expect(response.status).toBe(200);
    const body = await response.json() as { sessionToken: string; status: string };
    expect(body.sessionToken).toEqual(expect.any(String));
    expect(body.status).toBe('INVITED');
    expect(env.DB.candidate.invite_token).toBe('invite-token-1');
    expect(env.DB.candidate.status).toBe('INVITED');
  });

  it('rejects the invite after the candidate has started the assessment', async () => {
    const env = buildEnv({
      id: 'candidate-1',
      pipeline_id: null,
      invite_token: 'CLAIMED::invite-token-1',
      status: 'IN_PROGRESS',
      name: 'Ada',
    });

    const response = await rpcPublic.request('/resolve-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteToken: 'invite-token-1' }),
    }, env);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'CONFLICT' },
      status: 'IN_PROGRESS',
    });
    expect(env.DB.candidate.invite_token).toBe('CLAIMED::invite-token-1');
  });
});
