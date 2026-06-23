/**
 * D1 CRUD helpers for dev_container_sessions (Phase 3b).
 *
 * Thin typed wrappers around prepare/bind/run so routes and the
 * DevContainerDO share a single source of SQL truth. Every function
 * assumes migration 0023 has been applied.
 *
 * Recruiter-visible state lives in D1. The DO's ctx.storage holds live
 * config (env vars, pending alarm) that is opaque outside the DO instance.
 */

import type { TtlSource } from './devContainerTtl';

export type DevContainerStatus =
  | 'LAUNCHING'
  | 'READY'
  | 'SLEEPING'
  | 'ERROR'
  | 'STOPPED'
  | 'EXPIRED';

export interface DevContainerSessionRow {
  id: string;
  session_id: string;
  candidate_id: string | null;
  challenge_id: string | null;
  pipeline_id: string | null;
  meeting_id: string | null;
  meeting_room_id: string | null;
  owner_id: string | null;
  access_scope: 'candidate' | 'meeting_room';
  status: DevContainerStatus;
  instance_type: string;
  ttl_seconds: number;
  ttl_source: TtlSource;
  expires_at: string;
  warned_at: string | null;
  url: string | null;
  repo_git_url: string | null;
  challenge_branch: string | null;
  started_at: string | null;
  stopped_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsertSessionInput {
  id: string;
  sessionId: string;
  candidateId: string;
  challengeId: string | null;
  pipelineId: string;
  instanceType: string;
  ttlSeconds: number;
  ttlSource: TtlSource;
  expiresAt: string;
  repoGitUrl: string | null;
  challengeBranch: string | null;
}

export interface InsertRoomSessionInput {
  id: string;
  sessionId: string;
  meetingId: string;
  meetingRoomId: string;
  ownerId: string;
  instanceType: string;
  ttlSeconds: number;
  ttlSource: TtlSource;
  expiresAt: string;
  repoGitUrl: string;
  challengeBranch: string | null;
}

/** Insert a LAUNCHING row. */
export async function insertSession(
  db: D1Database,
  input: InsertSessionInput,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO dev_container_sessions (
         id, session_id, candidate_id, challenge_id, pipeline_id,
         status, instance_type, ttl_seconds, ttl_source, expires_at,
         repo_git_url, challenge_branch
       ) VALUES (?1, ?2, ?3, ?4, ?5, 'LAUNCHING', ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
    .bind(
      input.id,
      input.sessionId,
      input.candidateId,
      input.challengeId,
      input.pipelineId,
      input.instanceType,
      input.ttlSeconds,
      input.ttlSource,
      input.expiresAt,
      input.repoGitUrl,
      input.challengeBranch,
    )
    .run();
}

/** Insert a LAUNCHING row for a live meeting room workspace. */
export async function insertRoomSession(
  db: D1Database,
  input: InsertRoomSessionInput,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO dev_container_sessions (
         id, session_id, candidate_id, challenge_id, pipeline_id,
         meeting_id, meeting_room_id, owner_id, access_scope,
         status, instance_type, ttl_seconds, ttl_source, expires_at,
         repo_git_url, challenge_branch
       ) VALUES (?1, ?2, NULL, NULL, NULL, ?3, ?4, ?5, 'meeting_room',
         'LAUNCHING', ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
    .bind(
      input.id,
      input.sessionId,
      input.meetingId,
      input.meetingRoomId,
      input.ownerId,
      input.instanceType,
      input.ttlSeconds,
      input.ttlSource,
      input.expiresAt,
      input.repoGitUrl,
      input.challengeBranch,
    )
    .run();
}

/**
 * Fetch a session by its external session_id, verifying ownership.
 * Returns null if the session does not exist OR belongs to another candidate.
 * We deliberately conflate the two to avoid leaking session existence.
 */
export async function getSessionByIdForCandidate(
  db: D1Database,
  sessionId: string,
  candidateId: string,
): Promise<DevContainerSessionRow | null> {
  return db
    .prepare(
      `SELECT * FROM dev_container_sessions
       WHERE session_id = ?1 AND candidate_id = ?2
       LIMIT 1`,
    )
    .bind(sessionId, candidateId)
    .first<DevContainerSessionRow>();
}

/** Fetch a room-scoped session by public session_id and meeting room owner. */
export async function getSessionByIdForRoom(
  db: D1Database,
  sessionId: string,
  meetingRoomId: string,
): Promise<DevContainerSessionRow | null> {
  return db
    .prepare(
      `SELECT * FROM dev_container_sessions
       WHERE session_id = ?1
         AND meeting_room_id = ?2
         AND access_scope = 'meeting_room'
       LIMIT 1`,
    )
    .bind(sessionId, meetingRoomId)
    .first<DevContainerSessionRow>();
}

/** Latest live room-scoped session, if any. */
export async function getLatestSessionForRoom(
  db: D1Database,
  meetingRoomId: string,
): Promise<DevContainerSessionRow | null> {
  return db
    .prepare(
      `SELECT * FROM dev_container_sessions
       WHERE meeting_room_id = ?1
         AND access_scope = 'meeting_room'
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(meetingRoomId)
    .first<DevContainerSessionRow>();
}

/** Update status + timestamps without touching TTL fields. */
export async function markStatus(
  db: D1Database,
  sessionId: string,
  status: DevContainerStatus,
  extras: {
    url?: string | null;
    startedAt?: string | null;
    stoppedAt?: string | null;
    errorMessage?: string | null;
  } = {},
): Promise<void> {
  await db
    .prepare(
      `UPDATE dev_container_sessions
         SET status = ?1,
             url = COALESCE(?2, url),
             started_at = COALESCE(?3, started_at),
             stopped_at = COALESCE(?4, stopped_at),
             error_message = COALESCE(?5, error_message),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE session_id = ?6`,
    )
    .bind(
      status,
      extras.url ?? null,
      extras.startedAt ?? null,
      extras.stoppedAt ?? null,
      extras.errorMessage ?? null,
      sessionId,
    )
    .run();
}

/** Stamp the warned_at column when the 60s-before-expiry alarm fires. */
export async function markWarned(
  db: D1Database,
  sessionId: string,
  warnedAt: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE dev_container_sessions
         SET warned_at = ?1,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE session_id = ?2`,
    )
    .bind(warnedAt, sessionId)
    .run();
}

/** Manual destroy path. */
export async function markStopped(
  db: D1Database,
  sessionId: string,
  stoppedAt: string,
): Promise<void> {
  await markStatus(db, sessionId, 'STOPPED', { stoppedAt });
}

/** TTL alarm destroy path. */
export async function markExpired(
  db: D1Database,
  sessionId: string,
  stoppedAt: string,
): Promise<void> {
  await markStatus(db, sessionId, 'EXPIRED', { stoppedAt });
}

/** Error path — container failed to start or crashed mid-session. */
export async function markError(
  db: D1Database,
  sessionId: string,
  errorMessage: string,
): Promise<void> {
  await markStatus(db, sessionId, 'ERROR', { errorMessage });
}

// ─── Cockpit read helpers (recruiter-facing) ──────────────────────────────

/** Columns exposed to the cockpit. Excludes internal `id` and proxy `url`. */
export interface CockpitSessionRow {
  session_id: string;
  candidate_id: string | null;
  challenge_id: string | null;
  pipeline_id: string | null;
  status: DevContainerStatus;
  ttl_seconds: number;
  ttl_source: TtlSource;
  expires_at: string;
  warned_at: string | null;
  started_at: string | null;
  stopped_at: string | null;
  error_message: string | null;
  created_at: string;
}

const COCKPIT_COLUMNS = `
  session_id, candidate_id, challenge_id, pipeline_id, status,
  ttl_seconds, ttl_source, expires_at, warned_at,
  started_at, stopped_at, error_message, created_at
`.trim();

/**
 * List all sessions for a pipeline, newest first, capped at `limit` (default 100).
 * Returns an empty array when the pipeline has no sessions.
 */
export async function listSessionsByPipeline(
  db: D1Database,
  pipelineId: string,
  limit = 100,
): Promise<CockpitSessionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COCKPIT_COLUMNS}
       FROM dev_container_sessions
       WHERE pipeline_id = ?1
       ORDER BY created_at DESC
       LIMIT ?2`,
    )
    .bind(pipelineId, limit)
    .all<CockpitSessionRow>();
  return results ?? [];
}

/**
 * Fetch a single session by its public session_id.
 * Returns null if not found (caller decides 404 vs. ownership-conflation).
 */
export async function getSessionByPublicId(
  db: D1Database,
  sessionId: string,
): Promise<CockpitSessionRow | null> {
  return db
    .prepare(
      `SELECT ${COCKPIT_COLUMNS}
       FROM dev_container_sessions
       WHERE session_id = ?1
       LIMIT 1`,
    )
    .bind(sessionId)
    .first<CockpitSessionRow>();
}

// ─── Challenge lookup for TTL + repo metadata ──────────────────────────────

export interface ChallengeTtlRow {
  id: string;
  dev_container_ttl_seconds: number | null;
  repo_git_url: string | null;
  challenge_branch: string | null;
}

/**
 * Fetch the TTL + repo metadata for a challenge. Returns null when the
 * challenge does not exist (the launch handler falls through to global
 * defaults and a blank repo).
 *
 * When candidateId is provided, LEFT JOINs candidate_challenge_assignment
 * so per-candidate repo overrides (from AI matching) take precedence over
 * the challenge-level dev_container_repo_url.
 */
export async function getChallengeTtlMeta(
  db: D1Database,
  challengeId: string,
  candidateId?: string | null,
): Promise<ChallengeTtlRow | null> {
  if (candidateId) {
    return db
      .prepare(
        `SELECT ch.id,
                ch.dev_container_ttl_seconds,
                COALESCE(cca.github_repo_url, ch.dev_container_repo_url) AS repo_git_url,
                ch.dev_container_challenge_branch AS challenge_branch
         FROM challenges ch
         LEFT JOIN candidate_challenge_assignment cca
           ON cca.challenge_id = ch.id AND cca.candidate_id = ?2
         WHERE ch.id = ?1
         LIMIT 1`,
      )
      .bind(challengeId, candidateId)
      .first<ChallengeTtlRow>();
  }

  return db
    .prepare(
      `SELECT id,
              dev_container_ttl_seconds,
              dev_container_repo_url AS repo_git_url,
              dev_container_challenge_branch AS challenge_branch
       FROM challenges
       WHERE id = ?1
       LIMIT 1`,
    )
    .bind(challengeId)
    .first<ChallengeTtlRow>();
}

// ─── Exchange tokens for iframe auth ───────────────────────────────────────

const EXCHANGE_TOKEN_TTL_SECONDS = 30;

export interface ExchangeTokenRow {
  id: string;
  token: string;
  session_id: string;
  candidate_id: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

/**
 * Mint a short-lived, single-use exchange token for iframe auth.
 * The token can be embedded in the iframe URL without leaking the
 * full candidate JWT via Referer headers.
 */
export async function mintExchangeToken(
  db: D1Database,
  sessionId: string,
  candidateId: string,
): Promise<{ token: string; expiresAt: string }> {
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + EXCHANGE_TOKEN_TTL_SECONDS * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO dev_container_exchange_tokens (id, token, session_id, candidate_id, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(id, token, sessionId, candidateId, expiresAt)
    .run();

  return { token, expiresAt };
}

/**
 * Validate and consume an exchange token. Returns the session_id + candidate_id
 * if valid, null otherwise. Single-use: sets consumed_at on first valid use.
 *
 * Rejects if:
 *   - Token does not exist
 *   - Token is expired (expires_at < now)
 *   - Token was already consumed (consumed_at is not null)
 */
export async function consumeExchangeToken(
  db: D1Database,
  token: string,
): Promise<{ sessionId: string; candidateId: string } | null> {
  const now = new Date().toISOString();

  // Atomic: UPDATE only if not expired and not consumed, return the row
  const result = await db
    .prepare(
      `UPDATE dev_container_exchange_tokens
       SET consumed_at = ?1
       WHERE token = ?2
         AND expires_at > ?1
         AND consumed_at IS NULL
       RETURNING session_id, candidate_id`,
    )
    .bind(now, token)
    .first<{ session_id: string; candidate_id: string }>();

  if (!result) return null;
  return { sessionId: result.session_id, candidateId: result.candidate_id };
}

/**
 * Clean up expired exchange tokens. Call periodically (e.g., via cron)
 * to prevent table bloat. Returns the number of rows deleted.
 */
export async function pruneExpiredExchangeTokens(db: D1Database): Promise<number> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(`DELETE FROM dev_container_exchange_tokens WHERE expires_at < ?1`)
    .bind(now)
    .run();
  return result.meta.changes ?? 0;
}
