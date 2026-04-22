/**
 * Review routes — Phase C Multi-Turn Code Review
 *
 * Mounts under /rpc/review (candidate JWT auth via rpcAuth).
 *
 * Transcript stored as ReviewRound[] (arena-aligned) with optional explainer_exchanges.
 * Thread[] view computed from rounds on read for display.
 *
 * Routes:
 *   POST /rpc/review/submit              — create review session, call implementer agent
 *   POST /rpc/review/ask                 — lazy-create session + ask explainer (pre-round-1)
 *   POST /rpc/review/:sessionId/respond  — candidate reply, agent responds, round++
 *   POST /rpc/review/:sessionId/ask      — ask explainer question (alongside review)
 *   POST /rpc/review/:sessionId/verdict  — finalise session with approve/request_changes
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
import { scoreReviewSession, type PlantedBug } from '../../lib/scorerAgent';
import { scoreComprehensionSession, type ComprehensionGroundTruth } from '../../lib/comprehensionScorer';
import { computeImplementerMetrics } from '../../lib/implementerMetrics';
import { loadRcdForAssessment } from '../../lib/rcd';
import { fetchGitHubDiff } from '../../lib/fetchGitHubDiff';

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
}

interface ChallengeConfigRow {
  id: string;
  config: string | null;
  server_config: string | null;
  cached_diff_json: string | null;
  instructions: string | null;
  github_pr_title: string | null;
  github_pr_description: string | null;
}

/** Shape of transcript stored in D1 — review rounds + optional explainer exchanges */
interface StoredTranscript {
  rounds: ReviewRound[];
  explainer_exchanges?: ComprehensionExchange[];
  verdict?: {
    decision: string;
    summary: string;
    submittedAt: string;
  };
}

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

// ─── POST /rpc/review/submit ─────────────────────────────────────────────────

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
    `SELECT id, current_round, transcript, next_comment_id FROM review_sessions
     WHERE candidate_id = ?1 AND challenge_id = ?2 AND assessment_id = ?3 AND status = 'in_progress' LIMIT 1`,
  )
    .bind(candidateId, ch.id, assessment.id)
    .first<{ id: string; current_round: number; transcript: string; next_comment_id: number }>();

  // If a session exists and already has review rounds, it's a duplicate
  if (existingSession && existingSession.current_round > 0) {
    return c.json(
      { error: { code: 'CONFLICT', message: 'Review session already exists for this challenge.' } },
      409,
    );
  }

  // Shared context
  const cachedDiffJson = parseJsonColumn<unknown>(ch.cached_diff_json);
  const prDiff = extractDiffText(cachedDiffJson);
  const prBrief =
    ch.github_pr_description ??
    ch.github_pr_title ??
    ch.instructions ??
    'Implement the described feature.';
  // Implementer stays on Workers AI Qwen — different model family from Gemma scorer (ADR-032)
  const llmProvider = 'workers-ai' as const;
  const apiKey = '';

  // ── Bug-finding mode ───────────────────────────────────────────────────
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

  const persona = (config?.implementerPersona === 'senior' ? 'senior' : 'junior') as
    | 'junior'
    | 'senior';

  // Convert annotations to ReviewComment[] with numeric IDs
  const typedAnnotations = annotations as Array<Record<string, unknown>>;
  const [reviewerComments, nextCommentId] = annotationsToComments(typedAnnotations, 1);

  // ADR-036 Phase 3: inject team dispositional weights into the implementer
  // persona so push-back behavior reflects the team's research-grounded values.
  const rcdSubmit = await loadRcdForAssessment(c.env.DB, assessment.id);
  const dispositionalWeightsSubmit = rcdSubmit?.technical_context?.dispositional_weights;

  let agentResponses: ImplementerResponse[];
  try {
    agentResponses = await callImplementerAgent({
      apiKey,
      provider: llmProvider,
      ai: c.env.AI,
      persona,
      prBrief,
      prDiff,
      previousRounds: [],
      newComments: reviewerComments,
      ...(dispositionalWeightsSubmit ? { dispositionalWeights: dispositionalWeightsSubmit } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[review/submit] implementer agent failed:', msg);
    return c.json({ error: { code: 'AGENT_ERROR', message: msg } }, 502);
  }

  // Build first round
  const round1: ReviewRound = {
    round: 1,
    reviewer_comments: reviewerComments,
    reviewer_summary: summary as string,
    implementer_responses: agentResponses,
  };

  const now = new Date().toISOString();

  // Reuse existing lazy session (created by /ask) or create new
  if (existingSession) {
    const existingTranscript = parseJsonColumn<StoredTranscript>(existingSession.transcript)
      ?? { rounds: [] };
    existingTranscript.rounds.push(round1);

    await c.env.DB.prepare(
      `UPDATE review_sessions
       SET transcript = ?1, current_round = 1, next_comment_id = ?2,
           implementer_persona = ?3, max_rounds = ?4, updated_at = ?5
       WHERE id = ?6`,
    )
      .bind(
        JSON.stringify(existingTranscript), nextCommentId, persona,
        maxRounds, now, existingSession.id,
      )
      .run();

    const threads = buildThreadsForResponse(existingTranscript.rounds);
    return c.json({
      sessionId: existingSession.id,
      round: 1,
      rounds: existingTranscript.rounds,
      threads,
    });
  }

  const transcript: StoredTranscript = { rounds: [round1] };
  const sessionId = crypto.randomUUID();

  await c.env.DB.prepare(`
    INSERT INTO review_sessions
      (id, challenge_id, assessment_id, candidate_id, implementer_persona,
       current_round, max_rounds, status, transcript, next_comment_id, mode, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'in_progress', ?8, ?9, 'bug_finding', ?10, ?10)
  `)
    .bind(
      sessionId, ch.id, assessment.id, candidateId, persona,
      1, maxRounds, JSON.stringify(transcript), nextCommentId, now,
    )
    .run();

  const threads = buildThreadsForResponse(transcript.rounds);

  return c.json({
    sessionId,
    round: 1,
    rounds: transcript.rounds,
    threads,
  });
});

// ─── POST /rpc/review/:sessionId/respond ────────────────────────────────────

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
            current_round, max_rounds, status, transcript, next_comment_id, mode
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

  // Load challenge for context
  const ch = await c.env.DB.prepare(
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
  // Implementer stays on Workers AI Qwen — different model family from Gemma scorer (ADR-032)
  const llmProvider = 'workers-ai' as const;
  const apiKey = '';

  // ── Bug-finding conversation ──────────────────────────────────────────

  // Parse existing transcript
  const transcript = parseJsonColumn<StoredTranscript>(session.transcript) ?? { rounds: [] };

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

      // Reuse the original comment_id so the thread groups correctly
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

  const persona = (session.implementer_persona === 'senior' ? 'senior' : 'junior') as
    | 'junior'
    | 'senior';

  // ADR-036 Phase 3: dispositional weights → implementer persona tuning.
  const rcdRespond = await loadRcdForAssessment(c.env.DB, session.assessment_id);
  const dispositionalWeightsRespond = rcdRespond?.technical_context?.dispositional_weights;

  // Call implementer agent with full conversation context
  let agentResponses: ImplementerResponse[];
  try {
    agentResponses = await callImplementerAgent({
      apiKey,
      provider: llmProvider,
      ai: c.env.AI,
      persona,
      prBrief,
      prDiff,
      previousRounds: transcript.rounds,
      newComments,
      ...(dispositionalWeightsRespond ? { dispositionalWeights: dispositionalWeightsRespond } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[review/respond] implementer agent failed:', msg);
    return c.json({ error: { code: 'AGENT_ERROR', message: msg } }, 502);
  }

  // Build new round
  const newRoundNum = session.current_round + 1;
  const newRound: ReviewRound = {
    round: newRoundNum,
    reviewer_comments: newComments,
    implementer_responses: agentResponses,
  };

  transcript.rounds.push(newRound);

  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `UPDATE review_sessions
     SET transcript = ?1, current_round = ?2, next_comment_id = ?3, updated_at = ?4
     WHERE id = ?5`,
  )
    .bind(JSON.stringify(transcript), newRoundNum, nextId, now, sessionId)
    .run();

  const threads = buildThreadsForResponse(transcript.rounds);

  return c.json({ round: newRoundNum, rounds: transcript.rounds, threads });
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

    await c.env.DB.prepare(
      `UPDATE review_sessions SET transcript = ?1, updated_at = ?2 WHERE id = ?3`,
    )
      .bind(JSON.stringify(transcript), new Date().toISOString(), existingSession.id)
      .run();

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
    `SELECT id, challenge_id, candidate_id, status, transcript
     FROM review_sessions WHERE id = ?1`,
  )
    .bind(sessionId)
    .first<{ id: string; challenge_id: string; candidate_id: string; status: string; transcript: string }>();

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

  await c.env.DB.prepare(
    `UPDATE review_sessions SET transcript = ?1, updated_at = ?2 WHERE id = ?3`,
  )
    .bind(JSON.stringify(transcript), new Date().toISOString(), sessionId)
    .run();

  return c.json({ sessionId, exchanges });
});

// ─── POST /rpc/review/:sessionId/verdict ────────────────────────────────────

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
    `SELECT id, candidate_id, challenge_id, assessment_id, status, transcript, mode
     FROM review_sessions WHERE id = ?1`,
  )
    .bind(sessionId)
    .first<{ id: string; candidate_id: string; challenge_id: string; assessment_id: string; status: string; transcript: string; mode: string }>();

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

  // ── Review verdict ──────────────────────────────────────────────────────
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

  // Update transcript with verdict
  const transcript = parseJsonColumn<StoredTranscript>(session.transcript) ?? { rounds: [] };
  transcript.verdict = {
    decision: verdict as string,
    summary: verdictSummary as string,
    submittedAt: new Date().toISOString(),
  };

  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `UPDATE review_sessions
     SET status = 'verdict_submitted', transcript = ?1, updated_at = ?2
     WHERE id = ?3`,
  )
    .bind(JSON.stringify(transcript), now, sessionId)
    .run();

  // Trigger async scoring (fire-and-forget via waitUntil)
  // Scorer uses Google AI Gemma 4 31B — different family from Qwen implementer (ADR-032)
  const scorerApiKey = c.env.GOOGLE_AI_API_KEY ?? '';
  const hasAI = !!c.env.AI;
  if (hasAI || scorerApiKey) {
    const scoringPromise = (async () => {
      try {
        // Load challenge data for ground truth + PR context
        const ch = await c.env.DB.prepare(
          `SELECT ground_truth, server_config, github_pr_title, github_pr_description, instructions, cached_diff_json
           FROM challenges WHERE id = ?1`,
        )
          .bind(session.challenge_id)
          .first<{
            ground_truth: string | null;
            server_config: string | null;
            github_pr_title: string | null;
            github_pr_description: string | null;
            instructions: string | null;
            cached_diff_json: string | null;
          }>();

        if (!ch) {
          console.error('[review/verdict] Challenge not found for scoring, sessionId:', sessionId);
          return;
        }

        const groundTruth = parseJsonColumn<PlantedBug[]>(ch.ground_truth) ?? [];
        const serverConfig = parseJsonColumn<Record<string, unknown>>(ch.server_config);
        const plantedBugs = Array.isArray(serverConfig?.plantedBugs)
          ? (serverConfig.plantedBugs as PlantedBug[])
          : groundTruth;

        // Update status to 'scoring'
        await c.env.DB.prepare(
          `UPDATE review_sessions SET status = 'scoring', updated_at = ?1 WHERE id = ?2`,
        )
          .bind(new Date().toISOString(), sessionId)
          .run();

        const scorerProvider = c.env.GOOGLE_AI_API_KEY ? 'google-ai' as const : 'workers-ai' as const;

        // ADR-036 Phase 3: dispositional weights reshape the scorer's 6-dim
        // composite weighting (clamped to [0.5, 1.5], renormalized, sign-preserved).
        const rcdScore = await loadRcdForAssessment(c.env.DB, session.assessment_id);
        const dispositionalWeightsScore = rcdScore?.technical_context?.dispositional_weights;

        const scoreReport = await scoreReviewSession({
          apiKey: scorerApiKey,
          provider: scorerProvider,
          ai: c.env.AI,
          transcript,
          groundTruth: plantedBugs,
          diff: ch.cached_diff_json,
          prTitle: ch.github_pr_title,
          prDescription: ch.github_pr_description,
          instructions: ch.instructions,
          ...(dispositionalWeightsScore ? { dispositionalWeights: dispositionalWeightsScore } : {}),
        });

        // Compute implementer metrics (deterministic, no LLM)
        const implementerMetrics = computeImplementerMetrics(transcript.rounds);

        // Run supplementary comprehension scoring if explainer was used
        let comprehensionSupplement: Record<string, unknown> | undefined;
        if (transcript.explainer_exchanges && transcript.explainer_exchanges.length > 0) {
          try {
            const groundTruthRaw = parseJsonColumn<ComprehensionGroundTruth>(ch.ground_truth);
            const comprehensionGroundTruth: ComprehensionGroundTruth = groundTruthRaw?.mode === 'comprehension'
              ? groundTruthRaw
              : { mode: 'comprehension', keyInsights: [], idealVerdict: 'approve', idealRationale: '' };

            const compReport = await scoreComprehensionSession({
              apiKey: scorerApiKey,
              provider: scorerProvider,
              ai: c.env.AI,
              transcript: { mode: 'comprehension', exchanges: transcript.explainer_exchanges },
              groundTruth: comprehensionGroundTruth,
              prTitle: ch.github_pr_title,
              prDescription: ch.github_pr_description,
              instructions: ch.instructions,
            });
            comprehensionSupplement = compReport as unknown as Record<string, unknown>;
          } catch (compErr) {
            console.error('[review/verdict] Supplementary comprehension scoring failed:', compErr);
          }
        }

        // Write score report + implementer metrics + optional comprehension supplement
        const fullReport = {
          ...scoreReport,
          implementer_metrics: implementerMetrics,
          ...(comprehensionSupplement ? { comprehension_supplement: comprehensionSupplement } : {}),
        };
        const scoredAt = new Date().toISOString();
        await c.env.DB.prepare(
          `UPDATE review_sessions SET score_report = ?1, status = 'scored', updated_at = ?2 WHERE id = ?3`,
        )
          .bind(JSON.stringify(fullReport), scoredAt, sessionId)
          .run();

        // Propagate score to challenge_submission
        const sub = await c.env.DB.prepare(
          `SELECT id FROM challenge_submissions
           WHERE assessment_id = ?1 AND challenge_id = ?2 LIMIT 1`,
        )
          .bind(session.assessment_id, session.challenge_id)
          .first<{ id: string }>();

        if (sub) {
          await c.env.DB.prepare(
            `UPDATE challenge_submissions SET score = ?1, feedback = ?2, scored_at = ?3, updated_at = ?3 WHERE id = ?4`,
          )
            .bind(Math.round(scoreReport.overall.score), scoreReport.overall.narrative, scoredAt, sub.id)
            .run();

          // Re-aggregate assessment score
          await c.env.DB.prepare(
            `UPDATE assessments SET score = (SELECT AVG(score) FROM challenge_submissions WHERE assessment_id = ?1 AND score IS NOT NULL), updated_at = ?2 WHERE id = ?1`,
          )
            .bind(session.assessment_id, scoredAt)
            .run();
        }

        console.log(`[review/verdict] Scoring complete for session ${sessionId}: ${scoreReport.overall.score}/100 (${scoreReport.overall.band})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[review/verdict] Scoring failed for session ${sessionId}:`, msg);
        // Mark as scoring_failed so we can retry later
        await c.env.DB.prepare(
          `UPDATE review_sessions SET status = 'scoring_failed', updated_at = ?1 WHERE id = ?2`,
        )
          .bind(new Date().toISOString(), sessionId)
          .run();
      }
    })();

    c.executionCtx.waitUntil(scoringPromise);
  } else {
    console.warn('[review/verdict] No API key configured — scoring skipped for session:', sessionId);
  }

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
