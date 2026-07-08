import { describe, expect, it } from 'vitest';
import { rpcAuth, rpcPublic } from '../routes/rpc';
import { signJwt, verifyJwt } from '../lib/jwt';
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
  created_at?: string | null;
}

interface InviteDeliveryRow {
  external_reference: string;
  metadata_json: string;
}

interface FakeD1 extends D1Database {
  candidate: CandidateRow;
  scheduledInterviews: ScheduledInterviewRow[];
  inviteDeliveries: InviteDeliveryRow[];
  candidateSessions: Array<{
    id: string;
    candidate_id: string;
    pipeline_id: string | null;
    invite_token: string | null;
    expires_at: string;
  }>;
}

function fakeD1(
  candidate: CandidateRow,
  scheduledInterviews: ScheduledInterviewRow[] = [],
  inviteDeliveries: InviteDeliveryRow[] = [],
): FakeD1 {
  const db = {
    candidate,
    scheduledInterviews,
    inviteDeliveries,
    candidateSessions: [],
    prepare(sql: string): D1PreparedStatement {
      const statement = {
        params: [] as unknown[],
        bind(...params: unknown[]) {
          this.params = params;
          return this as unknown as D1PreparedStatement;
        },
        async first() {
          if (sql.includes('FROM candidate_session_handles')) {
            const sessionId = this.params[0];
            const row = db.candidateSessions.find((session) => session.id === sessionId);
            return row
              ? {
                  candidate_id: row.candidate_id,
                  pipeline_id: row.pipeline_id,
                  invite_token: row.invite_token,
                  expires_at: row.expires_at,
                }
              : null;
          }

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

          if (sql.includes('SELECT id, status FROM candidates WHERE id = ?1')) {
            const candidateId = this.params[0];
            if (db.candidate.id !== candidateId) return null;
            return {
              id: db.candidate.id,
              status: db.candidate.status,
            };
          }

          if (sql.includes('FROM scheduled_interviews') && sql.includes("interview_type = 'CODE_REVIEW'")) {
            const candidateId = this.params[0];
            return db.scheduledInterviews
              .filter((interview) => (
                interview.candidate_id === candidateId
                && interview.interview_type === 'CODE_REVIEW'
                && !['COMPLETED', 'CANCELLED'].includes(interview.status)
              ))
              .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0] ?? null;
          }

          if (sql.includes('FROM scheduled_interviews') && sql.includes("interview_type IN ('DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX')")) {
            const candidateId = this.params[0];
            return db.scheduledInterviews
              .filter((interview) => (
                interview.candidate_id === candidateId
                && ['DEV_CONTAINER_CHALLENGE', 'OPEN_SOURCE_BUG_FIX'].includes(interview.interview_type)
                && !['COMPLETED', 'CANCELLED'].includes(interview.status)
              ))
              .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0] ?? null;
          }

          return null;
        },
        async all() {
          if (sql.includes("interaction_type = 'scheduled_interview_invite_delivery'")) {
            const pattern = String(this.params[0] ?? '').replace(/^%/, '').replace(/%$/, '');
            return {
              results: db.inviteDeliveries.filter((delivery) => delivery.metadata_json.includes(pattern)),
              success: true,
              meta: {},
            };
          }
          return { results: [], success: true, meta: {} };
        },
        async run() {
          if (sql.includes('INSERT INTO candidate_session_handles')) {
            const [id, candidateId, pipelineId, inviteToken, , expiresAt] = this.params;
            db.candidateSessions.push({
              id: String(id),
              candidate_id: String(candidateId),
              pipeline_id: typeof pipelineId === 'string' ? pipelineId : null,
              invite_token: typeof inviteToken === 'string' ? inviteToken : null,
              expires_at: String(expiresAt),
            });
            return { success: true, meta: { changes: 1 } };
          }

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
            const [, interviewId, candidateId] = this.params;
            let changes = 0;
            for (const interview of db.scheduledInterviews) {
              if (
                interview.id === interviewId
                && interview.candidate_id === candidateId
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
  inviteDeliveries: InviteDeliveryRow[] = [],
): Env & { DB: FakeD1 } {
  return {
    SESSION_TOKEN_SECRET: 'test-secret',
    DB: fakeD1(candidate, scheduledInterviews, inviteDeliveries),
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

  it('returns an opaque session token without candidate ids, pipeline ids, or invite tokens', async () => {
    const env = buildEnv({
      id: 'candidate-1',
      pipeline_id: 'pipeline-1',
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
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({
      status: 'INVITED',
      name: 'Ada',
      sessionToken: expect.any(String),
    });

    const serializedBody = JSON.stringify(body);
    expect(serializedBody).not.toContain('candidate-1');
    expect(serializedBody).not.toContain('pipeline-1');
    expect(serializedBody).not.toContain('invite-token-1');

    const payload = await verifyJwt(String(body.sessionToken), env.SESSION_TOKEN_SECRET);
    expect(payload?.sub).toMatch(/^cand_sess_/);
    expect(payload?.pid).toBeNull();
    expect(payload?.itk).toBeNull();
    expect(payload?.sub).not.toContain('candidate-1');
    expect(payload?.sub).not.toContain('pipeline-1');
    expect(payload?.sub).not.toContain('invite-token-1');
  });

  it('refreshes legacy candidate tokens into opaque session tokens', async () => {
    const env = buildEnv({
      id: 'candidate-1',
      pipeline_id: 'pipeline-1',
      invite_token: 'invite-token-1',
      status: 'IN_PROGRESS',
      name: 'Ada',
    });
    const legacyToken = await signJwt(
      { sub: 'candidate-1', pid: 'pipeline-1', itk: 'invite-token-1' },
      env.SESSION_TOKEN_SECRET,
      -10,
    );

    const response = await rpcPublic.request('/refresh-session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${legacyToken}` },
    }, env);

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({ sessionToken: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain('candidate-1');
    expect(JSON.stringify(body)).not.toContain('pipeline-1');
    expect(JSON.stringify(body)).not.toContain('invite-token-1');

    const payload = await verifyJwt(String(body.sessionToken), env.SESSION_TOKEN_SECRET);
    expect(payload?.sub).toMatch(/^cand_sess_/);
    expect(payload?.pid).toBeNull();
    expect(payload?.itk).toBeNull();
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
        created_at: '2026-06-29T09:00:00.000Z',
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

  it('activates only the delivered assessment interview when the same candidate has multiple pending meetings', async () => {
    const env = buildEnv({
      id: 'candidate-1',
      pipeline_id: null,
      invite_token: 'invite-token-1',
      status: 'INVITED',
      name: 'Ada',
    }, [
      {
        id: 'delivered-interview',
        candidate_id: 'candidate-1',
        interview_type: 'CODE_REVIEW',
        status: 'INVITED',
        created_at: '2026-06-29T09:00:00.000Z',
      },
      {
        id: 'newer-unrelated-interview',
        candidate_id: 'candidate-1',
        interview_type: 'OPEN_SOURCE_BUG_FIX',
        status: 'INVITED',
        created_at: '2026-06-29T10:00:00.000Z',
      },
    ], [
      {
        external_reference: 'delivered-interview',
        metadata_json: JSON.stringify({
          scheduledInterviewId: 'delivered-interview',
          deliveredUrl: 'https://app-dev.hire-pipe.com/assess/invite-token-1',
        }),
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
    expect(env.DB.scheduledInterviews.find((interview) => interview.id === 'delivered-interview')?.status).toBe('ACTIVE');
    expect(env.DB.scheduledInterviews.find((interview) => interview.id === 'newer-unrelated-interview')?.status).toBe('INVITED');
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
