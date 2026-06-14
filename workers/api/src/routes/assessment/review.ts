/**
 * Review routes — Phase C Multi-Turn Code Review
 *
 * Mounts under /rpc/review (candidate JWT auth via rpcAuth).
 *
 * Transcript stored as ReviewRound[] (arena-aligned) with optional explainer_exchanges.
 * Thread[] view computed from rounds on read for display.
 *
 * New canonical routes (Golden Path):
 *   POST /rpc/review/session/init        — idempotent session creation on stage entry
 *   POST /rpc/review/session/:id/message — candidate message (round 1 or follow-up)
 *   POST /rpc/review/session/:id/complete — finalize session with verdict
 *
 * Legacy compatibility shims (deprecated):
 *   POST /rpc/review/submit              — delegates to init + message
 *   POST /rpc/review/ask                 — lazy-create session + ask explainer (pre-round-1)
 *   POST /rpc/review/:sessionId/respond  — delegates to message
 *   POST /rpc/review/:sessionId/ask      — ask explainer question (alongside review)
 *   POST /rpc/review/:sessionId/verdict  — delegates to complete
 *   GET  /rpc/review/:sessionId/status   — return current session status
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../types';
import type { CandidateVariables } from '../../middleware/candidateAuth';
import {
  callImplementerAgent,
  type ReviewComment,
  type ImplementerResponse,
  type ReviewRound,
} from '../../lib/implementerAgent';
import {
  callExplainerAgent,
  type ComprehensionQuestion,
  type ExplainerResponse,
  type ComprehensionExchange,
} from '../../lib/explainerAgent';
import type { RepoKnowledgeInput } from '../../lib/explainerPrompts';
import { loadRcdForAssessment } from '../../lib/rcd';
import { fetchGitHubDiff } from '../../lib/fetchGitHubDiff';
import { scoreAndPropagate } from '../../lib/review/scoreAndPropagate';
import { recordSessionEvent } from '../../lib/telemetry/sessionEvents';
import {
  ingestCodeReviewTranscriptToLivingContext,
  type CodeReviewTranscript,
} from '../../lib/livingContext/codeReview';

// ─── Router ──────────────────────────────────────────────────────────────────

export const review = new Hono<{ Bindings: Env; Variables: CandidateVariables }>();

// ─── Types ───────────────────────────────────────────────────────────────────

interface ReviewSessionRow {
  id: string;
  challenge_id: string;
  assessment_id: string;
  candidate_id: string;
  implementer_persona: string;
  current_round: number;
  max_rounds: number;
  status: string;
  transcript: string;
  next_comment_id: number;
  mode: string;
  created_at?: string;
  updated_at?: string;
}

interface ChallengeConfigRow {
  id: string;
  config: string | null;
  server_config: string | null;
  cached_diff_json: string | null;
  instructions: string | null;
  github_pr_title: string | null;
  github_pr_description: string | null;
  github_repo_url: string | null;
  github_pr_number: number | null;
}

/** Shape of transcript stored in D1 — review rounds + optional explainer exchanges */
type StoredTranscript = CodeReviewTranscript;

// ─── Severity mapping ────────────────────────────────────────────────────────

type ArenaSeverity = 'blocking' | 'major' | 'suggestion' | 'nit';

/** Map DiffPanel severity (critical/major/minor) to arena severity */
function mapSeverity(raw: string | null | undefined): ArenaSeverity | null {
  if (!raw) return null;
  const map: Record<string, ArenaSeverity> = {
    critical: 'blocking',
    blocking: 'blocking',
    major: 'major',
    minor: 'suggestion',
    suggestion: 'suggestion',
    nit: 'nit',
  };
  return map[raw.toLowerCase()] ?? null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseJsonColumn<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

async function syncReviewTranscript(
  db: D1Database,
  input: {
    sessionId: string;
    candidateId: string;
    challengeId: string;
    assessmentId: string;
    transcript: StoredTranscript;
    status: string;
    implementerPersona?: string | null;
    startedAt?: string | null;
    endedAt?: string | null;
    observedAt: string;
  },
): Promise<void> {
  try {
    await ingestCodeReviewTranscriptToLivingContext(db, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[review] living-context sync failed for session ${input.sessionId}:`,
      message,
    );
    await recordSessionEvent(db, {
      sessionId: input.sessionId,
      sessionType: 'code_review',
      candidateId: input.candidateId,
      eventType: 'error',
      payload: {
        operation: 'living_context_sync',
        message,
        recoverableBy: 'backfillLivingContext',
      },
    });
  }
}

function extractDiffText(cachedDiffJson: unknown): string {
  if (!cachedDiffJson || typeof cachedDiffJson !== 'object') {
    return '(diff not available)';
  }
  const diffObj = cachedDiffJson as Record<string, unknown>;
  const files = diffObj.files as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(files) || files.length === 0) return '(diff not available)';

  return files
    .map((f) => {
      const filename = typeof f.filename === 'string' ? f.filename
        : typeof f.path === 'string' ? f.path : '(unknown)';

      // Legacy format: raw patch string
      if (typeof f.patch === 'string') {
        return `--- ${filename}\n${f.patch}`;
      }

      // Current format: structured hunks from the Worker's parsePatch
      const hunks = Array.isArray(f.hunks) ? f.hunks as Array<Record<string, unknown>> : [];
      if (hunks.length === 0) return `--- ${filename}\n(no changes)`;

      const patchLines = hunks.flatMap((h) => {
        const header = typeof h.header === 'string' ? h.header : '';
        const lines = Array.isArray(h.lines) ? h.lines as Array<Record<string, unknown>> : [];
        return [
          header,
          ...lines.map((l) => {
            const type = typeof l.type === 'string' ? l.type : '';
            const content = typeof l.content === 'string' ? l.content : '';
            if (type === 'added' || type === 'addition') return `+${content}`;
            if (type === 'removed' || type === 'deletion') return `-${content}`;
            return ` ${content}`;
          }),
        ];
      });
      return `--- ${filename}\n${patchLines.join('\n')}`;
    })
    .join('\n\n');
}

/**
 * Converts candidate annotations into arena-aligned ReviewComment[].
 * Assigns sequential numeric IDs starting from nextId.
 * Returns [comments, nextId after assignment].
 */
function annotationsToComments(
  annotations: Array<Record<string, unknown>>,
  nextId: number,
): [ReviewComment[], number] {
  let id = nextId;
  const comments: ReviewComment[] = [];

  for (const ann of annotations) {
    const what = typeof ann.content === 'string' ? ann.content : (typeof ann.comment === 'string' ? ann.comment : '');
    if (!what) continue;

    const file = typeof ann.file === 'string' ? ann.file : undefined;
    const line = typeof ann.line === 'number' ? ann.line : undefined;
    const suggestion = typeof ann.suggestion === 'string' ? ann.suggestion : undefined;

    comments.push({
      id: id++,
      ...(file !== undefined ? { file } : {}),
      ...(line !== undefined ? { line } : {}),
      category: null, // Candidate doesn't classify — scorer does
      severity: mapSeverity(typeof ann.severity === 'string' ? ann.severity : null),
      what,
      why: typeof ann.why === 'string' ? ann.why : '',
      ...(suggestion !== undefined ? { suggestion } : {}),
      positive: ann.positive === true,
    });
  }

  return [comments, id];
}

/**
 * Builds Thread[] from ReviewRound[] for the API response.
 * Lightweight version — full Thread type with resolution is computed by scorer.
 */
function buildThreadsForResponse(rounds: ReviewRound[]): Array<{
  comment_id: number;
  comment: ReviewComment;
  exchanges: Array<{
    round: number;
    actor: 'implementer' | 'reviewer';
    move?: string;
    content: string;
    updated_code?: string;
  }>;
}> {
  const threadMap = new Map<number, {
    comment_id: number;
    comment: ReviewComment;
    exchanges: Array<{
      round: number;
      actor: 'implementer' | 'reviewer';
      move?: string;
      content: string;
      updated_code?: string;
    }>;
  }>();

  for (const round of rounds) {
    for (const comment of round.reviewer_comments) {
      if (!threadMap.has(comment.id)) {
        threadMap.set(comment.id, {
          comment_id: comment.id,
          comment,
          exchanges: [],
        });
      } else {
        // Follow-up from reviewer in a later round
        threadMap.get(comment.id)!.exchanges.push({
          round: round.round,
          actor: 'reviewer',
          content: comment.what,
        });
      }
    }

    for (const resp of round.implementer_responses) {
      const thread = threadMap.get(resp.to_comment_id);
      if (thread) {
        thread.exchanges.push({
          round: round.round,
          actor: 'implementer',
          move: resp.move,
          content: resp.content,
          ...(typeof resp.updated_code === 'string' ? { updated_code: resp.updated_code } : {}),
        });
      }
    }
  }

  return Array.from(threadMap.values());
}

// ─── Shared helpers (new + legacy shim support) ──────────────────────────────

/**
 * Builds PR context for a challenge, with self-heal diff fetch if needed.
 * Uses candidate_challenge_assignment overrides when present.
 */
async function buildPrContext(
  db: D1Database,
  ch: ChallengeConfigRow & { effective_repo_url?: string | null; effective_pr_number?: number | null },
  env: Env,
): Promise<{
  title: string | null;
  description: string | null;
  repoUrl: string | null;
  prNumber: number | null;
  diff: string;
}> {
  let cachedDiffJson = parseJsonColumn<unknown>(ch.cached_diff_json);
  const repoUrl = ch.effective_repo_url ?? ch.github_repo_url ?? null;
  const prNumber = ch.effective_pr_number ?? ch.github_pr_number ?? null;

  if (!cachedDiffJson && repoUrl && prNumber) {
    try {
      const token = (env as Env & { GITHUB_TOKEN?: string }).GITHUB_TOKEN;
      const result = await fetchGitHubDiff(repoUrl, prNumber, token);
      if (result) {
        cachedDiffJson = result.diff;
        await db.prepare(
          `UPDATE challenges SET cached_diff_json = ?1, cached_metadata = ?2, diff_cached_at = ?3 WHERE id = ?4`,
        )
          .bind(
            JSON.stringify(result.diff),
            JSON.stringify(result.metadata),
            new Date().toISOString(),
            ch.id,
          )
          .run();
      }
    } catch (err) {
      console.error('[buildPrContext] Self-heal diff fetch failed:', err);
    }
  }

  const diff = extractDiffText(cachedDiffJson);

  return {
    title: ch.github_pr_title ?? null,
    description: ch.github_pr_description ?? null,
    repoUrl,
    prNumber,
    diff,
  };
}

/**
 * Shared implementer round execution.
 * Calls the agent, persists the new round, and returns the updated view.
 */
async function executeReviewRound(
  db: D1Database,
  env: Env,
  session: ReviewSessionRow,
  newComments: ReviewComment[],
  summary: string | undefined,
  nextId: number,
): Promise<{
  round: number;
  agentResponse: ImplementerResponse[];
  threads: ReturnType<typeof buildThreadsForResponse>;
  transcript: StoredTranscript;
}> {
  const ch = await db.prepare(
    `SELECT config, server_config, cached_diff_json, instructions, github_pr_title, github_pr_description
     FROM challenges WHERE id = ?1`,
  )
    .bind(session.challenge_id)
    .first<ChallengeConfigRow>();

  const cachedDiffJson = parseJsonColumn<unknown>(ch?.cached_diff_json ?? null);
  const prDiff = extractDiffText(cachedDiffJson);
  const prBrief =
    ch?.github_pr_description ??
    ch?.github_pr_title ??
    ch?.instructions ??
    'Implement the described feature.';
  const llmProvider = 'workers-ai' as const;
  const apiKey = '';

  const persona = (session.implementer_persona === 'senior' ? 'senior' : 'junior') as 'junior' | 'senior';

  const rcd = await loadRcdForAssessment(db, session.assessment_id);
  const dispositionalWeights = rcd?.technical_context?.dispositional_weights;

  const transcript = parseJsonColumn<StoredTranscript>(session.transcript) ?? { rounds: [] };

  const agentResponses = await callImplementerAgent({
    apiKey,
    provider: llmProvider,
    ai: env.AI,
    persona,
    prBrief,
    prDiff,
    previousRounds: transcript.rounds,
    newComments,
    ...(dispositionalWeights ? { dispositionalWeights } : {}),
  });

  const newRoundNum = session.current_round + 1;
  const newRound: ReviewRound = {
    round: newRoundNum,
    reviewer_comments: newComments,
    ...(summary !== undefined ? { reviewer_summary: summary } : {}),
    implementer_responses: agentResponses,
  };

  transcript.rounds.push(newRound);

  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE review_sessions
     SET transcript = ?1, current_round = ?2, next_comment_id = ?3, updated_at = ?4
     WHERE id = ?5`,
  )
    .bind(JSON.stringify(transcript), newRoundNum, nextId, now, session.id)
    .run();
  await syncReviewTranscript(db, {
    sessionId: session.id,
    candidateId: session.candidate_id,
    challengeId: session.challenge_id,
    assessmentId: session.assessment_id,
    transcript,
    status: 'in_progress',
    implementerPersona: session.implementer_persona,
    startedAt: session.created_at ?? null,
    observedAt: now,
  });

  const threads = buildThreadsForResponse(transcript.rounds);

  return { round: newRoundNum, agentResponse: agentResponses, threads, transcript };
}

/**
 * Finalizes a review session: stores verdict, writes submission,
 * updates assessment, and triggers async scoring.
 */
async function finalizeReviewSession(
  c: Context<{ Bindings: Env; Variables: CandidateVariables }>,
  session: {
    id: string;
    candidate_id: string;
    challenge_id: string;
    assessment_id: string;
    transcript: string;
    created_at?: string;
    implementer_persona?: string;
  },
  verdict: string,
  summary: string,
): Promise<{ status: string; sessionId: string }> {
  const transcript = parseJsonColumn<StoredTranscript>(session.transcript) ?? { rounds: [] };
  transcript.verdict = {
    decision: verdict,
    summary,
    submittedAt: new Date().toISOString(),
  };

  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `UPDATE review_sessions
     SET status = 'verdict_submitted', transcript = ?1, updated_at = ?2
     WHERE id = ?3`,
  )
    .bind(JSON.stringify(transcript), now, session.id)
    .run();
  await syncReviewTranscript(c.env.DB, {
    sessionId: session.id,
    candidateId: session.candidate_id,
    challengeId: session.challenge_id,
    assessmentId: session.assessment_id,
    transcript,
    status: 'verdict_submitted',
    implementerPersona: session.implementer_persona ?? null,
    startedAt: session.created_at ?? null,
    endedAt: now,
    observedAt: now,
  });

  // Write challenge_submissions row
  const submissionId = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO challenge_submissions
      (id, assessment_id, challenge_id, candidate_id, response_json, submitted_at, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)
  `)
    .bind(
      submissionId,
      session.assessment_id,
      session.challenge_id,
      session.candidate_id,
      JSON.stringify({ verdict, summary, transcript }),
      now,
    )
    .run();

  // Update assessment status
  await c.env.DB.prepare(
    `UPDATE assessments
     SET status = 'COMPLETED', completed_at = ?1, updated_at = ?1
     WHERE id = ?2`,
  )
    .bind(now, session.assessment_id)
    .run();

  const scorerApiKey = c.env.GOOGLE_AI_API_KEY ?? '';
  const hasAI = !!c.env.AI;
  if (hasAI || scorerApiKey) {
    c.executionCtx.waitUntil(
      scoreAndPropagate({
        env: c.env,
        sessionId: session.id,
        assessmentId: session.assessment_id,
        challengeId: session.challenge_id,
        transcript,
        scope: 'finalizeReviewSession',
      }),
    );
  } else {
    console.warn('[finalizeReviewSession] No API key configured — scoring skipped for session:', session.id);
  }

  return { status: 'verdict_submitted', sessionId: session.id };
}

// ─── POST /rpc/review/session/init ───────────────────────────────────────────

review.post('/session/init', async (c) => {
  const candidateId = c.get('candidateId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const challengeId = body.challengeId;
  if (typeof challengeId !== 'string' || !challengeId) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'challengeId is required.' } },
      400,
    );
  }

  // Find candidate's current stage
  const candidate = await c.env.DB.prepare(
    `SELECT current_stage_id FROM candidates WHERE id = ?1`,
  )
    .bind(candidateId)
    .first<{ current_stage_id: string | null }>();

  if (!candidate?.current_stage_id) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'No active stage.' } }, 404);
  }

  // Fetch challenge with per-candidate overrides
  const ch = await c.env.DB.prepare(`
    SELECT
      ch.id, ch.config, ch.server_config, ch.cached_diff_json, ch.instructions,
      ch.github_pr_title, ch.github_pr_description,
      ch.github_repo_url, ch.github_pr_number,
      COALESCE(cca.github_repo_url, ch.github_repo_url) as effective_repo_url,
      COALESCE(cca.github_pr_number, ch.github_pr_number) as effective_pr_number
    FROM challenges ch
    LEFT JOIN candidate_challenge_assignment cca
      ON cca.challenge_id = ch.id AND cca.candidate_id = ?2
    WHERE ch.id = ?1
  `)
    .bind(challengeId, candidateId)
    .first<ChallengeConfigRow & { effective_repo_url?: string | null; effective_pr_number?: number | null }>();

  if (!ch) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Challenge not found.' } }, 404);
  }

  const config = parseJsonColumn<Record<string, unknown>>(ch.config);
  const isMultiTurn = config?.isMultiTurn === true;
  if (!isMultiTurn) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'This challenge is not configured for multi-turn review.' } },
      400,
    );
  }

  const maxRounds = typeof config?.maxRounds === 'number' ? config.maxRounds : 4;

  // Get assessment for this stage
  const assessment = await c.env.DB.prepare(
    `SELECT id FROM assessments WHERE candidate_id = ?1 AND stage_id = ?2 LIMIT 1`,
  )
    .bind(candidateId, candidate.current_stage_id)
    .first<{ id: string }>();

  if (!assessment) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'No assessment found for this stage.' } },
      404,
    );
  }

  // Check for existing session
  const existingSession = await c.env.DB.prepare(
    `SELECT id, status, current_round, transcript, next_comment_id, max_rounds
     FROM review_sessions
     WHERE candidate_id = ?1 AND challenge_id = ?2 AND assessment_id = ?3
     LIMIT 1`,
  )
    .bind(candidateId, challengeId, assessment.id)
    .first<{
      id: string;
      status: string;
      current_round: number;
      transcript: string;
      next_comment_id: number;
      max_rounds: number;
    }>();

  if (existingSession) {
    const pr = await buildPrContext(c.env.DB, ch, c.env);
    return c.json({
      sessionId: existingSession.id,
      status: existingSession.status,
      pr,
      maxRounds: existingSession.max_rounds,
      currentRound: existingSession.current_round,
    });
  }

  // Create new pending session
  const sessionId = crypto.randomUUID();
  const transcript: StoredTranscript = { rounds: [] };
  const persona = (config?.implementerPersona === 'senior' ? 'senior' : 'junior') as 'junior' | 'senior';
  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO review_sessions
      (id, challenge_id, assessment_id, candidate_id, implementer_persona,
       current_round, max_rounds, status, transcript, next_comment_id, mode, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, 'pending', ?7, 1, 'bug_finding', ?8, ?8)
  `)
    .bind(sessionId, challengeId, assessment.id, candidateId, persona, maxRounds, JSON.stringify(transcript), now)
    .run();

  await recordSessionEvent(c.env.DB, {
    sessionId,
    sessionType: 'code_review',
    candidateId,
    eventType: 'started',
    payload: { challengeId, assessmentId: assessment.id, maxRounds, persona },
  });

  const pr = await buildPrContext(c.env.DB, ch, c.env);

  return c.json({
    sessionId,
    status: 'pending',
    pr,
    maxRounds,
    currentRound: 0,
  });
});

// ─── POST /rpc/review/session/:id/message ────────────────────────────────────

review.post('/session/:id/message', async (c) => {
  const candidateId = c.get('candidateId');
  const sessionId = c.req.param('id');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  // Load and authorise session
  const session = await c.env.DB.prepare(
    `SELECT id, challenge_id, assessment_id, candidate_id, implementer_persona,
            current_round, max_rounds, status, transcript, next_comment_id, mode,
            created_at, updated_at
     FROM review_sessions
     WHERE id = ?1`,
  )
    .bind(sessionId)
    .first<ReviewSessionRow>();

  if (!session) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Review session not found.' } }, 404);
  }
  if (session.candidate_id !== candidateId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } }, 403);
  }

  if (session.status !== 'pending' && session.status !== 'in_progress') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Session is not active.' } },
      400,
    );
  }

  // Build new reviewer comments
  let nextId = session.next_comment_id ?? 1;
  const newComments: ReviewComment[] = [];

  // Pending → first round: annotations + summary required
  if (session.status === 'pending') {
    const annotations = body.annotations;
    const summary = body.summary;

    if (!Array.isArray(annotations) || annotations.length === 0) {
      return c.json(
        { error: { code: 'BAD_REQUEST', message: 'annotations array is required for the first message.' } },
        400,
      );
    }
    if (typeof summary !== 'string' || summary.trim() === '') {
      return c.json(
        { error: { code: 'BAD_REQUEST', message: 'summary is required for the first message.' } },
        400,
      );
    }

    const [converted, updatedId] = annotationsToComments(
      annotations as Array<Record<string, unknown>>,
      nextId,
    );
    newComments.push(...converted);
    nextId = updatedId;

    // Transition to in_progress before calling agent
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE review_sessions SET status = 'in_progress', updated_at = ?1 WHERE id = ?2`,
    )
      .bind(now, sessionId)
      .run();

    const result = await executeReviewRound(
      c.env.DB, c.env, { ...session, status: 'in_progress' }, newComments, summary as string, nextId,
    );

    await recordSessionEvent(c.env.DB, {
      sessionId,
      sessionType: 'code_review',
      candidateId,
      eventType: 'question_asked',
      payload: { round: result.round, commentCount: newComments.length },
    });

    return c.json({
      round: result.round,
      agentResponse: result.agentResponse,
      threads: result.threads,
    });
  }

  // in_progress → follow-up round
  if (session.current_round >= session.max_rounds) {
    return c.json(
      {
        error: {
          code: 'MAX_ROUNDS_REACHED',
          message: `Maximum rounds (${session.max_rounds}) reached. Submit a verdict to finish.`,
        },
      },
      400,
    );
  }

  // Replies to existing threads
  const replies = body.replies;
  if (Array.isArray(replies)) {
    for (const reply of replies as Array<Record<string, unknown>>) {
      const toCommentId = typeof reply.toCommentId === 'number' ? reply.toCommentId : null;
      const content = typeof reply.content === 'string' ? reply.content : '';
      if (toCommentId === null || !content) continue;

      newComments.push({
        id: toCommentId,
        what: content,
        why: '',
        category: null,
        severity: null,
        positive: false,
      });
    }
  }

  // Brand new annotations
  const newAnnotations = body.newAnnotations;
  if (Array.isArray(newAnnotations)) {
    const [converted, updatedId] = annotationsToComments(
      newAnnotations as Array<Record<string, unknown>>,
      nextId,
    );
    newComments.push(...converted);
    nextId = updatedId;
  }

  if (newComments.length === 0) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'No valid replies or annotations provided.' } },
      400,
    );
  }

  const result = await executeReviewRound(c.env.DB, c.env, session, newComments, undefined, nextId);

  await recordSessionEvent(c.env.DB, {
    sessionId,
    sessionType: 'code_review',
    candidateId,
    eventType: 'question_asked',
    payload: { round: result.round, commentCount: newComments.length },
  });

  return c.json({
    round: result.round,
    agentResponse: result.agentResponse,
    threads: result.threads,
  });
});

// ─── POST /rpc/review/session/:id/complete ───────────────────────────────────

review.post('/session/:id/complete', async (c) => {
  const candidateId = c.get('candidateId');
  const sessionId = c.req.param('id');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  // Load and authorise session
  const session = await c.env.DB.prepare(
    `SELECT id, candidate_id, challenge_id, assessment_id, status, transcript,
            implementer_persona, created_at
     FROM review_sessions WHERE id = ?1`,
  )
    .bind(sessionId)
    .first<{
      id: string;
      candidate_id: string;
      challenge_id: string;
      assessment_id: string;
      status: string;
      transcript: string;
      implementer_persona: string;
      created_at: string;
    }>();

  if (!session) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Review session not found.' } }, 404);
  }
  if (session.candidate_id !== candidateId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } }, 403);
  }
  if (session.status !== 'in_progress') {
    return c.json(
      { error: { code: 'CONFLICT', message: 'Session is not in progress.' } },
      409,
    );
  }

  const verdict = body.verdict;
  const summary = body.summary;

  if (verdict !== 'approve' && verdict !== 'request_changes' && verdict !== 'comment_only') {
    return c.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'verdict must be "approve", "request_changes", or "comment_only".',
        },
      },
      400,
    );
  }
  if (typeof summary !== 'string' || summary.trim() === '') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'summary is required.' } },
      400,
    );
  }

  await recordSessionEvent(c.env.DB, {
    sessionId,
    sessionType: 'code_review',
    candidateId,
    eventType: 'scoring_started',
    payload: { verdict, roundCount: (parseJsonColumn<StoredTranscript>(session.transcript)?.rounds ?? []).length },
  });

  const result = await finalizeReviewSession(c, session, verdict as string, summary as string);

  await recordSessionEvent(c.env.DB, {
    sessionId,
    sessionType: 'code_review',
    candidateId,
    eventType: 'scoring_complete',
    payload: { verdict, status: result.status },
  });

  return c.json(result);
});

// ─── POST /rpc/review/submit ─────────────────────────────────────────────────
// DEPRECATED: Use POST /rpc/review/session/init + POST /rpc/review/session/:id/message

review.post('/submit', async (c) => {
  const candidateId = c.get('candidateId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const challengeOrder = body.challengeOrder;

  if (typeof challengeOrder !== 'number' || !Number.isInteger(challengeOrder) || challengeOrder < 0) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'challengeOrder must be a non-negative integer.' } },
      400,
    );
  }

  // Find candidate's current stage
  const candidate = await c.env.DB.prepare(
    `SELECT current_stage_id FROM candidates WHERE id = ?1`,
  )
    .bind(candidateId)
    .first<{ current_stage_id: string | null }>();

  if (!candidate?.current_stage_id) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'No active stage.' } }, 404);
  }

  // Fetch challenge at the given order index
  const challenges = await c.env.DB.prepare(`
    SELECT id, config, server_config, cached_diff_json, instructions,
           github_pr_title, github_pr_description
    FROM challenges
    WHERE stage_id = ?1
    ORDER BY sort_order ASC
  `)
    .bind(candidate.current_stage_id)
    .all();

  const rows = challenges.results ?? [];
  if (challengeOrder >= rows.length) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Challenge not found.' } }, 404);
  }

  const ch = rows[challengeOrder] as unknown as ChallengeConfigRow;

  // Parse config to get multi-turn settings
  const config = parseJsonColumn<Record<string, unknown>>(ch.config);
  const isMultiTurn = config?.isMultiTurn === true;
  if (!isMultiTurn) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'This challenge is not configured for multi-turn review.' } },
      400,
    );
  }

  const maxRounds = typeof config?.maxRounds === 'number' ? config.maxRounds : 4;

  // Get assessment for this stage
  const assessment = await c.env.DB.prepare(
    `SELECT id FROM assessments WHERE candidate_id = ?1 AND stage_id = ?2 LIMIT 1`,
  )
    .bind(candidateId, candidate.current_stage_id)
    .first<{ id: string }>();

  if (!assessment) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'No assessment found for this stage.' } },
      404,
    );
  }

  // Check for existing session — reuse if created by lazy /ask, otherwise conflict
  const existingSession = await c.env.DB.prepare(
    `SELECT id, current_round, transcript, next_comment_id, status,
            implementer_persona, max_rounds, created_at, updated_at
     FROM review_sessions
     WHERE candidate_id = ?1 AND challenge_id = ?2 AND assessment_id = ?3
     LIMIT 1`,
  )
    .bind(candidateId, ch.id, assessment.id)
    .first<ReviewSessionRow>();

  // If a session exists and already has review rounds, it's a duplicate
  if (existingSession && existingSession.current_round > 0) {
    return c.json(
      { error: { code: 'CONFLICT', message: 'Review session already exists for this challenge.' } },
      409,
    );
  }

  const annotations = body.annotations;
  const summary = body.summary;

  if (!Array.isArray(annotations)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'annotations must be an array.' } },
      400,
    );
  }
  if (typeof summary !== 'string' || summary.trim() === '') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'summary is required.' } },
      400,
    );
  }

  const typedAnnotations = annotations as Array<Record<string, unknown>>;
  const [reviewerComments, nextCommentId] = annotationsToComments(typedAnnotations, 1);

  const persona = (config?.implementerPersona === 'senior' ? 'senior' : 'junior') as 'junior' | 'senior';

  let session: ReviewSessionRow;
  let sessionId: string;

  if (existingSession) {
    sessionId = existingSession.id;
    session = existingSession;
  } else {
    sessionId = crypto.randomUUID();
    const transcript: StoredTranscript = { rounds: [] };
    const now = new Date().toISOString();

    await c.env.DB.prepare(`
      INSERT INTO review_sessions
        (id, challenge_id, assessment_id, candidate_id, implementer_persona,
         current_round, max_rounds, status, transcript, next_comment_id, mode, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, 'in_progress', ?7, ?8, 'bug_finding', ?9, ?9)
    `)
      .bind(sessionId, ch.id, assessment.id, candidateId, persona, maxRounds, JSON.stringify(transcript), nextCommentId, now)
      .run();

    session = {
      id: sessionId,
      challenge_id: ch.id,
      assessment_id: assessment.id,
      candidate_id: candidateId,
      implementer_persona: persona,
      current_round: 0,
      max_rounds: maxRounds,
      status: 'in_progress',
      transcript: JSON.stringify(transcript),
      next_comment_id: nextCommentId,
      mode: 'bug_finding',
      created_at: now,
      updated_at: now,
    };
  }

  const result = await executeReviewRound(c.env.DB, c.env, session, reviewerComments, summary as string, nextCommentId);

  return c.json({
    sessionId,
    round: result.round,
    rounds: result.transcript.rounds,
    threads: result.threads,
  });
});

// ─── POST /rpc/review/:sessionId/respond ────────────────────────────────────
// DEPRECATED: Use POST /rpc/review/session/:id/message

review.post('/:sessionId/respond', async (c) => {
  const candidateId = c.get('candidateId');
  const sessionId = c.req.param('sessionId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  // Load and authorise session
  const session = await c.env.DB.prepare(
    `SELECT id, challenge_id, assessment_id, candidate_id, implementer_persona,
            current_round, max_rounds, status, transcript, next_comment_id, mode,
            created_at, updated_at
     FROM review_sessions
     WHERE id = ?1`,
  )
    .bind(sessionId)
    .first<ReviewSessionRow>();

  if (!session) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Review session not found.' } }, 404);
  }
  if (session.candidate_id !== candidateId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } }, 403);
  }
  if (session.status !== 'in_progress') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Session is not in progress.' } },
      400,
    );
  }
  if (session.current_round >= session.max_rounds) {
    return c.json(
      {
        error: {
          code: 'MAX_ROUNDS_REACHED',
          message: `Maximum rounds (${session.max_rounds}) reached. Submit a verdict to finish.`,
        },
      },
      400,
    );
  }

  // Build new reviewer comments from replies + new annotations
  let nextId = session.next_comment_id ?? 1;
  const newComments: ReviewComment[] = [];

  // Replies to existing threads (candidate follow-ups on prior comments)
  const replies = body.replies;
  if (Array.isArray(replies)) {
    for (const reply of replies as Array<Record<string, unknown>>) {
      const toCommentId = typeof reply.toCommentId === 'number' ? reply.toCommentId : null;
      const content = typeof reply.content === 'string' ? reply.content : '';
      if (toCommentId === null || !content) continue;

      newComments.push({
        id: toCommentId,
        what: content,
        why: '',
        category: null,
        severity: null,
        positive: false,
      });
    }
  }

  // Brand new annotations (new comments not tied to existing threads)
  const newAnnotations = body.newAnnotations;
  if (Array.isArray(newAnnotations)) {
    const [converted, updatedId] = annotationsToComments(
      newAnnotations as Array<Record<string, unknown>>,
      nextId,
    );
    newComments.push(...converted);
    nextId = updatedId;
  }

  if (newComments.length === 0) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'No valid replies or annotations provided.' } },
      400,
    );
  }

  const result = await executeReviewRound(c.env.DB, c.env, session, newComments, undefined, nextId);

  return c.json({ round: result.round, rounds: result.transcript.rounds, threads: result.threads });
});

// ─── POST /rpc/review/ask (lazy session creation + explainer) ───────────────

review.post('/ask', async (c) => {
  const candidateId = c.get('candidateId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const challengeOrder = body.challengeOrder;
  if (typeof challengeOrder !== 'number' || !Number.isInteger(challengeOrder) || challengeOrder < 0) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'challengeOrder must be a non-negative integer.' } },
      400,
    );
  }

  const questionText = body.question;
  if (typeof questionText !== 'string' || questionText.trim() === '') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'question is required.' } },
      400,
    );
  }

  // Find candidate's current stage
  const candidate = await c.env.DB.prepare(
    `SELECT current_stage_id FROM candidates WHERE id = ?1`,
  )
    .bind(candidateId)
    .first<{ current_stage_id: string | null }>();

  if (!candidate?.current_stage_id) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'No active stage.' } }, 404);
  }

  // Fetch challenge
  const challenges = await c.env.DB.prepare(`
    SELECT id, config, server_config, cached_diff_json, instructions,
           github_pr_title, github_pr_description
    FROM challenges
    WHERE stage_id = ?1
    ORDER BY sort_order ASC
  `)
    .bind(candidate.current_stage_id)
    .all();

  const rows = challenges.results ?? [];
  if (challengeOrder >= rows.length) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Challenge not found.' } }, 404);
  }

  const ch = rows[challengeOrder] as unknown as ChallengeConfigRow;
  const config = parseJsonColumn<Record<string, unknown>>(ch.config);

  if (!config?.enableExplainer) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Explainer is not enabled for this challenge.' } },
      400,
    );
  }

  // Get assessment
  const assessment = await c.env.DB.prepare(
    `SELECT id FROM assessments WHERE candidate_id = ?1 AND stage_id = ?2 LIMIT 1`,
  )
    .bind(candidateId, candidate.current_stage_id)
    .first<{ id: string }>();

  if (!assessment) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'No assessment found.' } }, 404);
  }

  // Check for existing session
  const existingSession = await c.env.DB.prepare(
    `SELECT id, transcript FROM review_sessions
     WHERE candidate_id = ?1 AND challenge_id = ?2 AND assessment_id = ?3 AND status = 'in_progress' LIMIT 1`,
  )
    .bind(candidateId, ch.id, assessment.id)
    .first<{ id: string; transcript: string }>();

  const maxExplainerQuestions = typeof config?.maxExplainerQuestions === 'number'
    ? config.maxExplainerQuestions : 6;

  const question: ComprehensionQuestion = {
    text: questionText as string,
    ...(typeof body.file === 'string' ? { file: body.file as string } : {}),
    ...(typeof body.line === 'number' ? { line: body.line as number } : {}),
  };

  const cachedDiffJson = parseJsonColumn<unknown>(ch.cached_diff_json);
  const prDiff = extractDiffText(cachedDiffJson);
  const prBrief = ch.github_pr_description ?? ch.github_pr_title ?? ch.instructions ?? '';
  const llmProvider = c.env.GOOGLE_AI_API_KEY ? 'google-ai' as const : 'workers-ai' as const;
  const apiKey = c.env.GOOGLE_AI_API_KEY ?? '';
  const serverConfig = parseJsonColumn<Record<string, unknown>>(ch.server_config);
  const repoKnowledge = (serverConfig?.repoKnowledge as RepoKnowledgeInput | undefined) ?? null;

  if (existingSession) {
    // Append to existing session
    const transcript = parseJsonColumn<StoredTranscript>(existingSession.transcript)
      ?? { rounds: [] };
    const exchanges = transcript.explainer_exchanges ?? [];

    if (exchanges.length >= maxExplainerQuestions) {
      return c.json(
        { error: { code: 'MAX_QUESTIONS_REACHED', message: `Maximum questions (${maxExplainerQuestions}) reached.` } },
        400,
      );
    }

    let answer: ExplainerResponse;
    try {
      answer = await callExplainerAgent({
        apiKey, provider: llmProvider, ai: c.env.AI,
        prBrief, prDiff, repoKnowledge,
        previousExchanges: exchanges,
        newQuestion: question,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[review/ask] explainer agent failed:', msg);
      return c.json({ error: { code: 'AGENT_ERROR', message: msg } }, 502);
    }

    const exchange: ComprehensionExchange = { round: exchanges.length + 1, question, answer };
    exchanges.push(exchange);
    transcript.explainer_exchanges = exchanges;

    const observedAt = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE review_sessions SET transcript = ?1, updated_at = ?2 WHERE id = ?3`,
    )
      .bind(JSON.stringify(transcript), observedAt, existingSession.id)
      .run();
    await syncReviewTranscript(c.env.DB, {
      sessionId: existingSession.id,
      candidateId,
      challengeId: ch.id,
      assessmentId: assessment.id,
      transcript,
      status: 'in_progress',
      observedAt,
    });

    return c.json({ sessionId: existingSession.id, exchanges });
  }

  // No session yet — create a lazy session (current_round=0, empty rounds)
  let answer: ExplainerResponse;
  try {
    answer = await callExplainerAgent({
      apiKey, provider: llmProvider, ai: c.env.AI,
      prBrief, prDiff, repoKnowledge,
      previousExchanges: [],
      newQuestion: question,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[review/ask] explainer agent failed:', msg);
    return c.json({ error: { code: 'AGENT_ERROR', message: msg } }, 502);
  }

  const exchange: ComprehensionExchange = { round: 1, question, answer };
  const transcript: StoredTranscript = { rounds: [], explainer_exchanges: [exchange] };
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO review_sessions
      (id, challenge_id, assessment_id, candidate_id, implementer_persona,
       current_round, max_rounds, status, transcript, next_comment_id, mode, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, 'pending', 0, ?5, 'in_progress', ?6, 1, 'bug_finding', ?7, ?7)
  `)
    .bind(sessionId, ch.id, assessment.id, candidateId,
      typeof config?.maxRounds === 'number' ? config.maxRounds : 4,
      JSON.stringify(transcript), now)
    .run();
  await syncReviewTranscript(c.env.DB, {
    sessionId,
    candidateId,
    challengeId: ch.id,
    assessmentId: assessment.id,
    transcript,
    status: 'in_progress',
    implementerPersona: 'pending',
    startedAt: now,
    observedAt: now,
  });

  return c.json({ sessionId, exchanges: transcript.explainer_exchanges });
});

// ─── POST /rpc/review/:sessionId/ask (explainer question on existing session) ─

review.post('/:sessionId/ask', async (c) => {
  const candidateId = c.get('candidateId');
  const sessionId = c.req.param('sessionId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const questionText = body.question;
  if (typeof questionText !== 'string' || questionText.trim() === '') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'question is required.' } },
      400,
    );
  }

  // Load and authorise session
  const session = await c.env.DB.prepare(
    `SELECT id, challenge_id, assessment_id, candidate_id, status, transcript,
            implementer_persona, created_at
     FROM review_sessions WHERE id = ?1`,
  )
    .bind(sessionId)
    .first<{
      id: string;
      challenge_id: string;
      assessment_id: string;
      candidate_id: string;
      status: string;
      transcript: string;
      implementer_persona: string;
      created_at: string;
    }>();

  if (!session) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Review session not found.' } }, 404);
  }
  if (session.candidate_id !== candidateId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } }, 403);
  }
  if (session.status !== 'in_progress') {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Session is not in progress.' } }, 400);
  }

  // Load challenge config
  const ch = await c.env.DB.prepare(
    `SELECT config, server_config, cached_diff_json, instructions, github_pr_title, github_pr_description
     FROM challenges WHERE id = ?1`,
  )
    .bind(session.challenge_id)
    .first<ChallengeConfigRow>();

  const config = parseJsonColumn<Record<string, unknown>>(ch?.config ?? null);
  if (!config?.enableExplainer) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Explainer is not enabled for this challenge.' } },
      400,
    );
  }

  const maxExplainerQuestions = typeof config?.maxExplainerQuestions === 'number'
    ? config.maxExplainerQuestions : 6;

  const transcript = parseJsonColumn<StoredTranscript>(session.transcript) ?? { rounds: [] };
  const exchanges = transcript.explainer_exchanges ?? [];

  if (exchanges.length >= maxExplainerQuestions) {
    return c.json(
      { error: { code: 'MAX_QUESTIONS_REACHED', message: `Maximum questions (${maxExplainerQuestions}) reached.` } },
      400,
    );
  }

  const question: ComprehensionQuestion = {
    text: questionText as string,
    ...(typeof body.file === 'string' ? { file: body.file as string } : {}),
    ...(typeof body.line === 'number' ? { line: body.line as number } : {}),
  };

  const cachedDiffJson = parseJsonColumn<unknown>(ch?.cached_diff_json ?? null);
  const prDiff = extractDiffText(cachedDiffJson);
  const prBrief = ch?.github_pr_description ?? ch?.github_pr_title ?? ch?.instructions ?? '';
  const llmProvider = c.env.GOOGLE_AI_API_KEY ? 'google-ai' as const : 'workers-ai' as const;
  const apiKey = c.env.GOOGLE_AI_API_KEY ?? '';
  const serverConfig = parseJsonColumn<Record<string, unknown>>(ch?.server_config ?? null);
  const repoKnowledge = (serverConfig?.repoKnowledge as RepoKnowledgeInput | undefined) ?? null;

  let answer: ExplainerResponse;
  try {
    answer = await callExplainerAgent({
      apiKey, provider: llmProvider, ai: c.env.AI,
      prBrief, prDiff, repoKnowledge,
      previousExchanges: exchanges,
      newQuestion: question,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[review/ask] explainer agent failed:', msg);
    return c.json({ error: { code: 'AGENT_ERROR', message: msg } }, 502);
  }

  const exchange: ComprehensionExchange = { round: exchanges.length + 1, question, answer };
  exchanges.push(exchange);
  transcript.explainer_exchanges = exchanges;

  const observedAt = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE review_sessions SET transcript = ?1, updated_at = ?2 WHERE id = ?3`,
  )
    .bind(JSON.stringify(transcript), observedAt, sessionId)
    .run();
  await syncReviewTranscript(c.env.DB, {
    sessionId,
    candidateId,
    challengeId: session.challenge_id,
    assessmentId: session.assessment_id,
    transcript,
    status: session.status,
    implementerPersona: session.implementer_persona,
    startedAt: session.created_at,
    observedAt,
  });

  return c.json({ sessionId, exchanges });
});

// ─── POST /rpc/review/:sessionId/verdict ────────────────────────────────────
// DEPRECATED: Use POST /rpc/review/session/:id/complete

review.post('/:sessionId/verdict', async (c) => {
  const candidateId = c.get('candidateId');
  const sessionId = c.req.param('sessionId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const verdict = body.verdict;

  // Load and authorise session
  const session = await c.env.DB.prepare(
    `SELECT id, candidate_id, challenge_id, assessment_id, status, transcript,
            implementer_persona, created_at
     FROM review_sessions WHERE id = ?1`,
  )
    .bind(sessionId)
    .first<{
      id: string;
      candidate_id: string;
      challenge_id: string;
      assessment_id: string;
      status: string;
      transcript: string;
      implementer_persona: string;
      created_at: string;
    }>();

  if (!session) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Review session not found.' } }, 404);
  }
  if (session.candidate_id !== candidateId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } }, 403);
  }
  if (session.status !== 'in_progress') {
    return c.json(
      { error: { code: 'CONFLICT', message: 'Session is not in progress.' } },
      409,
    );
  }

  const verdictSummary = body.summary;

  if (verdict !== 'approve' && verdict !== 'request_changes' && verdict !== 'comment_only') {
    return c.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'verdict must be "approve", "request_changes", or "comment_only".',
        },
      },
      400,
    );
  }
  if (typeof verdictSummary !== 'string' || verdictSummary.trim() === '') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'summary is required.' } },
      400,
    );
  }

  await finalizeReviewSession(c, session, verdict as string, verdictSummary as string);
  return c.json({ status: 'verdict_submitted' });
});

// ─── GET /rpc/review/:sessionId/status ──────────────────────────────────────

review.get('/:sessionId/status', async (c) => {
  const candidateId = c.get('candidateId');
  const sessionId = c.req.param('sessionId');

  const session = await c.env.DB.prepare(
    `SELECT id, candidate_id, status, score_report
     FROM review_sessions WHERE id = ?1`,
  )
    .bind(sessionId)
    .first<{ id: string; candidate_id: string; status: string; score_report: string | null }>();

  if (!session) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Review session not found.' } }, 404);
  }
  if (session.candidate_id !== candidateId) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } }, 403);
  }

  const scoreReport = parseJsonColumn<Record<string, unknown>>(session.score_report);

  // Only expose high-level score info (overall + band), not full rubric
  let publicScoreReport: { overall?: number; band?: string } | undefined;
  if (scoreReport) {
    const overallObj = scoreReport.overall as Record<string, unknown> | undefined;
    const overall = typeof overallObj?.score === 'number' ? overallObj.score : undefined;
    const band = typeof overallObj?.band === 'string' ? overallObj.band : undefined;
    publicScoreReport = {
      ...(overall !== undefined ? { overall } : {}),
      ...(band !== undefined ? { band } : {}),
    };
  }

  return c.json({
    status: session.status,
    ...(publicScoreReport !== undefined ? { scoreReport: publicScoreReport } : {}),
  });
});
