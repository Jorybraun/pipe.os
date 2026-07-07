import type { JwtPayload } from './jwt';

export const CANDIDATE_SESSION_HANDLE_PREFIX = 'cand_sess_';
export const CANDIDATE_SESSION_HANDLE_TTL_SECONDS = 24 * 60 * 60;

export interface CandidateSessionIdentity {
  candidateId: string;
  pipelineId: string | null;
  inviteToken: string | null;
}

export interface CandidateSessionHandle {
  id: string;
  expiresAt: string;
}

interface CandidateSessionHandleRow {
  candidate_id: string;
  pipeline_id: string | null;
  invite_token: string | null;
  expires_at: string;
}

function isOpaqueCandidateSessionId(value: string): boolean {
  return value.startsWith(CANDIDATE_SESSION_HANDLE_PREFIX);
}

function candidateSessionHandleId(): string {
  return `${CANDIDATE_SESSION_HANDLE_PREFIX}${crypto.randomUUID().replaceAll('-', '')}`;
}

export async function createCandidateSessionHandle(
  db: D1Database,
  identity: CandidateSessionIdentity,
  ttlSeconds: number = CANDIDATE_SESSION_HANDLE_TTL_SECONDS,
): Promise<CandidateSessionHandle> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const id = candidateSessionHandleId();

  await db
    .prepare(
      `INSERT INTO candidate_session_handles (
          id,
          candidate_id,
          pipeline_id,
          invite_token,
          created_at,
          expires_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(
      id,
      identity.candidateId,
      identity.pipelineId,
      identity.inviteToken,
      now.toISOString(),
      expiresAt,
    )
    .run();

  return { id, expiresAt };
}

async function resolveCandidateSessionHandle(
  db: D1Database,
  sessionId: string,
): Promise<CandidateSessionIdentity | null> {
  const row = await db
    .prepare(
      `SELECT candidate_id, pipeline_id, invite_token, expires_at
         FROM candidate_session_handles
        WHERE id = ?1
        LIMIT 1`,
    )
    .bind(sessionId)
    .first<CandidateSessionHandleRow>();

  if (!row) return null;

  const expiresAtMs = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return null;
  }

  return {
    candidateId: row.candidate_id,
    pipelineId: row.pipeline_id,
    inviteToken: row.invite_token,
  };
}

export async function resolveCandidateSessionPayload(
  db: D1Database,
  payload: JwtPayload,
): Promise<CandidateSessionIdentity | null> {
  if (isOpaqueCandidateSessionId(payload.sub)) {
    return resolveCandidateSessionHandle(db, payload.sub);
  }

  return {
    candidateId: payload.sub,
    pipelineId: payload.pid,
    inviteToken: payload.itk ?? null,
  };
}
