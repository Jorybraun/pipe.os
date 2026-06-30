/**
 * Session Events — append-only observability log for all interview / assessment types.
 *
 * Every significant action in a candidate session writes one row:
 *   recordSessionEvent(db, { sessionId, sessionType, candidateId, eventType, payload })
 *
 * Query patterns:
 *   SELECT * FROM session_events WHERE session_id = ? ORDER BY created_at
 *   SELECT * FROM session_events WHERE candidate_id = ? ORDER BY created_at
 *   SELECT event_type, COUNT(*) FROM session_events WHERE created_at > ? GROUP BY event_type
 *
 * Future: swap the INSERT for an Analytics Engine write when volume justifies it.
 */

export type SessionType =
  | 'code_review'
  | 'culture_interview'
  | 'screening'
  | 'implementation'
  | 'voice'
  | 'video'
  | 'ingestion'
  | 'matching';

export type EventType =
  | 'started'
  | 'question_asked'
  | 'answer_submitted'
  | 'scoring_started'
  | 'scoring_complete'
  | 'error'
  | 'completed'
  | 'stage_advanced'
  | 'match_assigned'
  | 'decomposition_started'
  | 'decomposition_complete'
  | 'ingestion_retry_queued'
  | 'ingestion_retry_failed';

export interface SessionEventInput {
  sessionId: string;
  sessionType: SessionType;
  candidateId: string;
  eventType: EventType;
  payload?: Record<string, unknown>;
}

function cryptoRandomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function recordSessionEvent(
  db: D1Database,
  input: SessionEventInput,
): Promise<void> {
  const id = cryptoRandomId();
  const now = new Date().toISOString();
  const payloadJson = input.payload ? JSON.stringify(input.payload) : null;

  try {
    await db
      .prepare(
        `INSERT INTO session_events (id, session_id, session_type, candidate_id, event_type, payload_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(id, input.sessionId, input.sessionType, input.candidateId, input.eventType, payloadJson, now)
      .run();
  } catch (err) {
    // Observability must never break the main flow. Log and swallow.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[sessionEvents] failed to record event:', msg, input);
  }
}

/**
 * Fetch a timeline for a single session, newest first.
 */
export async function getSessionTimeline(
  db: D1Database,
  sessionId: string,
  limit = 200,
): Promise<Array<{ event_type: string; payload_json: string | null; created_at: string }>> {
  const result = await db
    .prepare(
      `SELECT event_type, payload_json, created_at
         FROM session_events
        WHERE session_id = ?1
        ORDER BY created_at DESC
        LIMIT ?2`,
    )
    .bind(sessionId, limit)
    .all<{ event_type: string; payload_json: string | null; created_at: string }>();
  return result.results ?? [];
}

/**
 * Fetch cross-session history for a candidate, newest first.
 */
export async function getCandidateEventHistory(
  db: D1Database,
  candidateId: string,
  limit = 500,
): Promise<Array<{ session_id: string; session_type: string; event_type: string; payload_json: string | null; created_at: string }>> {
  const result = await db
    .prepare(
      `SELECT session_id, session_type, event_type, payload_json, created_at
         FROM session_events
        WHERE candidate_id = ?1
        ORDER BY created_at DESC
        LIMIT ?2`,
    )
    .bind(candidateId, limit)
    .all<{ session_id: string; session_type: string; event_type: string; payload_json: string | null; created_at: string }>();
  return result.results ?? [];
}
