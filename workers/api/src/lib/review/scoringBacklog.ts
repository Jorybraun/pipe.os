import type { Env } from '../../types';
import { scoreAndPropagate, type ScoreAndPropagateTranscript } from './scoreAndPropagate';

const DEFAULT_STALE_AFTER_MS = 120_000;
const DEFAULT_LIMIT = 3;

interface ScoringBacklogRow {
  id: string;
  assessment_id: string;
  challenge_id: string;
  transcript: string | null;
}

export interface ScoringBacklogResult {
  considered: number;
  retried: number;
  failed: number;
}

interface ScoringBacklogOptions {
  now?: Date;
  staleAfterMs?: number;
  limit?: number;
}

function parseTranscript(value: string | null): ScoreAndPropagateTranscript {
  if (!value) return { rounds: [] };
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { rounds?: unknown }).rounds)
    ) {
      return parsed as ScoreAndPropagateTranscript;
    }
  } catch {
    // Fall through to the safe empty transcript shape.
  }
  return { rounds: [] };
}

export async function processCodeReviewScoringBacklog(
  env: Env,
  options: ScoringBacklogOptions = {},
): Promise<ScoringBacklogResult> {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 10));
  const staleCutoff = new Date(now.getTime() - staleAfterMs).toISOString();

  const rows = await env.DB.prepare(`
    SELECT id, assessment_id, challenge_id, transcript
      FROM review_sessions
     WHERE score_report IS NULL
       AND status IN ('verdict_submitted', 'scoring', 'scoring_failed')
       AND (status = 'verdict_submitted' OR updated_at <= ?1)
     ORDER BY
       CASE status
         WHEN 'verdict_submitted' THEN 0
         WHEN 'scoring_failed' THEN 1
         ELSE 2
       END,
       updated_at ASC
     LIMIT ?2
  `)
    .bind(staleCutoff, limit)
    .all<ScoringBacklogRow>();

  const candidates = rows.results ?? [];
  let retried = 0;
  let failed = 0;

  for (const row of candidates) {
    try {
      await scoreAndPropagate({
        env,
        sessionId: row.id,
        assessmentId: row.assessment_id,
        challengeId: row.challenge_id,
        transcript: parseTranscript(row.transcript),
        scope: 'scheduled/review-scoring-backlog',
      });
      retried += 1;
    } catch (error) {
      failed += 1;
      console.error('[scheduled/review-scoring-backlog] Retry threw unexpectedly:', {
        sessionId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (candidates.length > 0) {
    console.log('[scheduled/review-scoring-backlog] processed review scoring backlog:', {
      considered: candidates.length,
      retried,
      failed,
      staleCutoff,
    });
  }

  return {
    considered: candidates.length,
    retried,
    failed,
  };
}
