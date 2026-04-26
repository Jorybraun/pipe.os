/**
 * Culture Interview Routes — Recruiter + Candidate endpoints (ADR-029, ADR-031).
 *
 * ## Recruiter routes (mounted at /api/v1/screening/culture, Clerk JWT)
 *
 *   POST   /challenges/:challengeId/config      — write OrgCultureBenchmark to challenges.server_config
 *   GET    /sessions/:sessionId/report          — full CultureScoreReport (HITL gate must be passed first)
 *   POST   /sessions/:sessionId/review          — recruiter confirm / override decision
 *
 * ## Candidate routes (mounted at /rpc/culture, candidate session JWT)
 *
 *   GET    /session/:token/state                — resume support; returns current FSM state
 *   POST   /session/:token/consent              — accept consent → seed first question
 *   POST   /session/:token/respond              — submit answer; advance FSM; may fire scoring job
 *   GET    /session/:token/report               — sanitized report (403 until recruiter has reviewed)
 *
 * ## Design notes
 *
 * - Ground truth (BARS rubrics, reasoning traces) NEVER leaves the server in
 *   candidate-facing responses. Only narrative, recommendation, and dimension
 *   scores are returned to candidates — and only after HITL review.
 * - All DB writes use D1 prepared statements. No string concatenation.
 * - Scoring runs inside `ctx.waitUntil()` so the candidate response is not
 *   blocked by the 11-call LLM pipeline.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { candidateAuth, type CandidateVariables } from '../../middleware/candidateAuth';
import { verifyJwt } from '../../lib/jwt';
import {
  startCultureInterview,
  advanceCultureInterview,
  defaultCultureTranscript,
  type CultureTranscript,
} from '../../lib/cultureAgent';
import {
  startAdaptiveCultureInterview,
  advanceAdaptiveCultureInterview,
} from '../../lib/cultureAgentAdaptive';
import { resolveCultureRoleContext } from '../../lib/cultureRoleResolution';
import { loadRoleProbeBank, EMPTY_PROBE_BANK } from '../../lib/cultureProbeBank';
import { decomposeCandidateAnswer, persistDecomposition } from '../../lib/cultureAgentDecomposition';
import {
  scoreCultureInterview,
  type OrgCultureBenchmark,
  type CultureScoreReport,
} from '../../lib/cultureScorer';
import { createCultureAgentProvider } from '../../lib/llm/createProvider';
import { withCultureMetering } from '../../lib/llm/meteredProvider';
import type { Env, Variables } from '../../types';
import type { CompetencyDimension } from '../../lib/cultureQuestionBank';

// ─── DB row shape ─────────────────────────────────────────────────────────────

interface CultureSessionRow {
  id: string;
  challenge_id: string;
  challenge_submission_id: string | null;
  assessment_id: string;
  candidate_id: string;
  state: 'consent' | 'in_progress' | 'scoring' | 'complete' | 'error';
  consent_at: string | null;
  transcript: string;
  current_question_idx: number;
  score_report: string | null;
  started_at: string | null;
  completed_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_decision: string | null;
  override_recommendation: string | null;
  review_notes: string | null;
  screener_mode: 'profile_builder' | 'role_fit' | null;
  created_at: string;
  updated_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function parseJsonColumn<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * ADR-031 §5.4 — Required disclosures for AI-conducted interviews.
 * Shown once before any turn is written to the transcript.
 */
function consentPayload(): {
  title: string;
  disclosures: string[];
  vendor: string;
  deletionLink: string;
  nonAiAlternativeLink: string;
} {
  return {
    title: 'AI-Conducted Culture Interview',
    disclosures: [
      'This interview is conducted by an AI system, not a human recruiter.',
      'Your responses will be analyzed by AI to evaluate cultural fit.',
      'The AI may ask follow-up questions to better understand your answers.',
      'A human recruiter will review the AI\'s assessment before any decision is made.',
      'You may request deletion of your interview data at any time.',
      'An alternative non-AI interview process is available upon request.',
    ],
    vendor: 'Cloudflare Workers AI + Gemma',
    deletionLink: '/data-deletion',
    nonAiAlternativeLink: '/request-human-interview',
  };
}

// ─── Scoring job ──────────────────────────────────────────────────────────────

/**
 * Background scoring job — called via `ctx.waitUntil()` so it runs after the
 * candidate response is sent. Loads the session, scores the transcript, and
 * writes the result back to D1.
 *
 * On error: sets state = 'error' and logs. Does not throw (background task).
 */
export async function runScoringJob(env: Env, sessionId: string): Promise<void> {
  const db = env.DB;

  let session: CultureSessionRow | null;
  try {
    session = await db
      .prepare('SELECT * FROM culture_interview_sessions WHERE id = ?1')
      .bind(sessionId)
      .first<CultureSessionRow>();
  } catch (err) {
    console.error('[cultureScoringJob] Failed to load session:', sessionId, err);
    return;
  }

  if (!session) {
    console.error('[cultureScoringJob] Session not found:', sessionId);
    return;
  }

  // Load orgBenchmark from challenge server_config
  const challengeRow = await db
    .prepare('SELECT server_config FROM challenges WHERE id = ?1')
    .bind(session.challenge_id)
    .first<{ server_config: string | null }>();

  const serverConfig = parseJsonColumn<Record<string, unknown>>(
    challengeRow?.server_config ?? null,
    {},
  );

  const orgBenchmark = serverConfig.orgBenchmark as OrgCultureBenchmark | undefined;
  if (!orgBenchmark) {
    console.error('[cultureScoringJob] No orgBenchmark in challenge server_config:', session.challenge_id);
    await db
      .prepare(`UPDATE culture_interview_sessions SET state = 'error', updated_at = ?1 WHERE id = ?2`)
      .bind(now(), sessionId)
      .run();
    return;
  }

  const transcript = parseJsonColumn<CultureTranscript>(
    session.transcript,
    defaultCultureTranscript(),
  );

  const rawProvider = createCultureAgentProvider(env);
  // Wrap with metering — no ExecutionContext inside a background job, so pass
  // null. The metering awaits the DB write directly (acceptable: we're already
  // running async inside ctx.waitUntil on the outer request).
  const provider = rawProvider !== null
    ? withCultureMetering(rawProvider, sessionId, 'scoring', db, null)
    : null;

  // Resolve the RCD Team Context so the scorer can apply BARS overrides,
  // dispositional weights, and surface dealbreakers as HITL flags. Null
  // during the migration window — scorer degrades gracefully.
  const roleContext = await resolveCultureRoleContext(db, session.assessment_id);

  let report: CultureScoreReport;
  try {
    report = await scoreCultureInterview({
      provider,
      transcript,
      orgBenchmark,
      teamContext: roleContext.teamContext,
    });
  } catch (err) {
    console.error('[cultureScoringJob] Scoring pipeline failed:', sessionId, err);
    await db
      .prepare(`UPDATE culture_interview_sessions SET state = 'error', updated_at = ?1 WHERE id = ?2`)
      .bind(now(), sessionId)
      .run();
    return;
  }

  try {
    await db
      .prepare(
        `UPDATE culture_interview_sessions
         SET state = 'complete',
             score_report = ?1,
             completed_at = ?2,
             updated_at = ?2
         WHERE id = ?3`,
      )
      .bind(JSON.stringify(report), now(), sessionId)
      .run();

    // Append compliance audit event
    await db
      .prepare(
        `INSERT INTO culture_compliance_audit (session_id, event_type, actor_type)
         VALUES (?1, 'scoring_complete', 'system')`,
      )
      .bind(sessionId)
      .run();

    // Emit SCORER_REPROMPT audit events for any dimensions that were re-prompted
    const repromptedCompetency = report.competencyScores.filter((s) => s.repromptCount > 0);
    const repromptedProfile = report.profileScores.filter((s) => s.repromptCount > 0);
    for (const s of repromptedCompetency) {
      await db
        .prepare(
          `INSERT INTO culture_compliance_audit (session_id, event_type, actor_type, metadata)
           VALUES (?1, 'scorer_reprompt', 'system', ?2)`,
        )
        .bind(
          sessionId,
          JSON.stringify({
            dimension: s.dimension,
            originalScore: s.originalScore ?? s.score,
            repromptScore: s.repromptCount > 0 ? s.score : null,
            finalGrounded: s.evidenceQuotes.length > 0,
          }),
        )
        .run();
    }
    for (const s of repromptedProfile) {
      await db
        .prepare(
          `INSERT INTO culture_compliance_audit (session_id, event_type, actor_type, metadata)
           VALUES (?1, 'scorer_reprompt', 'system', ?2)`,
        )
        .bind(
          sessionId,
          JSON.stringify({
            dimension: s.dimension,
            originalScore: s.originalPosition ?? s.candidatePosition,
            repromptScore: s.repromptCount > 0 ? s.candidatePosition : null,
            finalGrounded: s.evidenceQuotes.length > 0,
          }),
        )
        .run();
    }
  } catch (err) {
    console.error('[cultureScoringJob] Failed to write score report:', sessionId, err);
  }
}

// ─── Recruiter router ─────────────────────────────────────────────────────────

export const cultureRecruiter = new Hono<{ Bindings: Env; Variables: Variables }>();
cultureRecruiter.use('*', authMiddleware);

// ── POST /challenges/:challengeId/config ──────────────────────────────────────

cultureRecruiter.post('/challenges/:challengeId/config', async (c) => {
  const userId = c.var.userId;
  const { challengeId } = c.req.param();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const raw = body as Record<string, unknown>;
  const orgBenchmark = raw.orgBenchmark as OrgCultureBenchmark | undefined;
  if (!orgBenchmark || typeof orgBenchmark !== 'object') {
    return apiError(c, 'VALIDATION_ERROR', 'orgBenchmark is required.');
  }

  // Validate benchmark shape: each field must be 1–5
  const benchmarkKeys: Array<keyof OrgCultureBenchmark> = [
    'autonomy', 'riskTolerance', 'workPace', 'collaborationStyle', 'feedbackOrientation',
  ];
  for (const key of benchmarkKeys) {
    const val = orgBenchmark[key];
    if (typeof val !== 'number' || val < 1 || val > 5 || !Number.isInteger(val)) {
      return apiError(c, 'VALIDATION_ERROR', `orgBenchmark.${key} must be an integer 1–5.`);
    }
  }

  const focusDimensions = raw.focusDimensions as CompetencyDimension[] | undefined;

  // Verify the challenge exists and is owned by the recruiter (via pipeline ownership)
  const challenge = await c.env.DB.prepare(
    `SELECT ch.id, ch.server_config, ch.owner_id
     FROM challenges ch
     WHERE ch.id = ?1`,
  )
    .bind(challengeId)
    .first<{ id: string; server_config: string | null; owner_id: string | null }>();

  if (!challenge) {
    return apiError(c, 'NOT_FOUND', 'Challenge not found.');
  }

  // Ownership check: recruiter must own the challenge (via owner_id) or the parent pipeline
  if (challenge.owner_id !== null && challenge.owner_id !== userId) {
    // Also accept if the recruiter owns the pipeline this stage belongs to
    const ownsViaStage = await c.env.DB.prepare(
      `SELECT p.owner_id
       FROM challenges ch
       JOIN stages s ON s.id = ch.stage_id
       JOIN pipelines p ON p.id = s.pipeline_id
       WHERE ch.id = ?1 AND p.owner_id = ?2
       LIMIT 1`,
    )
      .bind(challengeId, userId)
      .first<{ owner_id: string }>();

    if (!ownsViaStage) {
      return apiError(c, 'FORBIDDEN', 'You do not have access to this challenge.');
    }
  }

  // Merge into existing server_config (don't clobber other challenge config)
  const existingConfig = parseJsonColumn<Record<string, unknown>>(challenge.server_config, {});
  const updatedConfig = {
    ...existingConfig,
    orgBenchmark,
    ...(focusDimensions ? { focusDimensions } : {}),
  };

  await c.env.DB.prepare(
    'UPDATE challenges SET server_config = ?1, updated_at = ?2 WHERE id = ?3',
  )
    .bind(JSON.stringify(updatedConfig), now(), challengeId)
    .run();

  return c.json({ success: true });
});

// ── GET /sessions/:sessionId/report ──────────────────────────────────────────

cultureRecruiter.get('/sessions/:sessionId/report', async (c) => {
  const userId = c.var.userId;
  const { sessionId } = c.req.param();

  const session = await c.env.DB.prepare(
    'SELECT * FROM culture_interview_sessions WHERE id = ?1',
  )
    .bind(sessionId)
    .first<CultureSessionRow>();

  if (!session) {
    return apiError(c, 'NOT_FOUND', 'Session not found.');
  }

  // Ownership check — recruiter must own the challenge's pipeline
  const ownsViaChallenge = await c.env.DB.prepare(
    `SELECT p.owner_id
     FROM challenges ch
     JOIN stages s ON s.id = ch.stage_id
     JOIN pipelines p ON p.id = s.pipeline_id
     WHERE ch.id = ?1 AND p.owner_id = ?2
     LIMIT 1`,
  )
    .bind(session.challenge_id, userId)
    .first<{ owner_id: string }>();

  if (!ownsViaChallenge) {
    return apiError(c, 'FORBIDDEN', 'You do not have access to this session.');
  }

  if (session.state !== 'complete') {
    return c.json(
      { error: { code: 'CONFLICT', message: `Session state is '${session.state}', not 'complete'.` } },
      409,
    );
  }

  const report = parseJsonColumn<CultureScoreReport | null>(session.score_report, null);
  if (!report) {
    return c.json(
      { error: { code: 'CONFLICT', message: 'Score report is not yet available.' } },
      409,
    );
  }

  // Aggregate AI cost for this session
  interface UsageRow {
    feature: string;
    cost: number;
    n: number;
  }
  const usageRows = await c.env.DB.prepare(
    `SELECT feature, SUM(usd_cost) as cost, COUNT(*) as n
     FROM culture_ai_usage_events
     WHERE session_id = ?1
     GROUP BY feature`,
  )
    .bind(sessionId)
    .all<UsageRow>();

  const byFeature = { conversation: 0, scoring: 0, stt: 0 };
  let totalUsd = 0;
  let callCount = 0;
  for (const row of usageRows.results ?? []) {
    totalUsd += row.cost;
    callCount += row.n;
    if (row.feature === 'conversation') byFeature.conversation += row.cost;
    else if (row.feature === 'scoring' || row.feature === 'synthesis') byFeature.scoring += row.cost;
    else if (row.feature === 'stt') byFeature.stt += row.cost;
  }

  return c.json({
    sessionId: session.id,
    candidateId: session.candidate_id,
    state: session.state,
    scoredAt: report.scoredAt,
    completedAt: session.completed_at,
    reviewDecision: session.review_decision ?? null,
    overrideRecommendation: session.override_recommendation ?? null,
    reviewNotes: session.review_notes ?? null,
    reviewedAt: session.reviewed_at ?? null,
    report,
    cost: {
      totalUsd,
      byFeature,
      callCount,
    },
  });
});

// ── POST /sessions/:sessionId/review ─────────────────────────────────────────

cultureRecruiter.post('/sessions/:sessionId/review', async (c) => {
  const userId = c.var.userId;
  const { sessionId } = c.req.param();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const raw = body as Record<string, unknown>;
  const decision = raw.decision;
  if (decision !== 'confirm' && decision !== 'override') {
    return apiError(c, 'VALIDATION_ERROR', "decision must be 'confirm' or 'override'.");
  }

  if (decision === 'override') {
    const validRecs = ['HIRE', 'FLAG_FOR_REVIEW', 'PASS'];
    if (typeof raw.overrideRecommendation !== 'string' || !validRecs.includes(raw.overrideRecommendation)) {
      return apiError(
        c,
        'VALIDATION_ERROR',
        "overrideRecommendation must be 'HIRE', 'FLAG_FOR_REVIEW', or 'PASS' when decision is 'override'.",
      );
    }
  }

  const session = await c.env.DB.prepare(
    'SELECT id, challenge_id, state FROM culture_interview_sessions WHERE id = ?1',
  )
    .bind(sessionId)
    .first<{ id: string; challenge_id: string; state: string }>();

  if (!session) {
    return apiError(c, 'NOT_FOUND', 'Session not found.');
  }

  if (session.state !== 'complete') {
    return c.json(
      { error: { code: 'CONFLICT', message: `Session state is '${session.state}', not 'complete'.` } },
      409,
    );
  }

  // Ownership check
  const ownsViaChallenge = await c.env.DB.prepare(
    `SELECT p.owner_id
     FROM challenges ch
     JOIN stages s ON s.id = ch.stage_id
     JOIN pipelines p ON p.id = s.pipeline_id
     WHERE ch.id = ?1 AND p.owner_id = ?2
     LIMIT 1`,
  )
    .bind(session.challenge_id, userId)
    .first<{ owner_id: string }>();

  if (!ownsViaChallenge) {
    return apiError(c, 'FORBIDDEN', 'You do not have access to this session.');
  }

  const overrideRecommendation = decision === 'override'
    ? (raw.overrideRecommendation as string)
    : null;
  const notes = typeof raw.notes === 'string' ? raw.notes.trim() : null;
  const reviewedAt = now();

  await c.env.DB.prepare(
    `UPDATE culture_interview_sessions
     SET reviewed_at = ?1,
         reviewed_by = ?2,
         review_decision = ?3,
         override_recommendation = ?4,
         review_notes = ?5,
         updated_at = ?1
     WHERE id = ?6`,
  )
    .bind(reviewedAt, userId, decision, overrideRecommendation, notes, sessionId)
    .run();

  // Append compliance audit event
  const eventType = decision === 'confirm' ? 'review_confirmed' : 'review_overridden';
  await c.env.DB.prepare(
    `INSERT INTO culture_compliance_audit (session_id, event_type, actor_type, actor_id, metadata)
     VALUES (?1, ?2, 'recruiter', ?3, ?4)`,
  )
    .bind(
      sessionId,
      eventType,
      userId,
      notes ? JSON.stringify({ notes, overrideRecommendation }) : null,
    )
    .run();

  return c.json({ success: true, reviewedAt });
});

// ── GET /cost-dashboard ───────────────────────────────────────────────────────

cultureRecruiter.get('/cost-dashboard', async (c) => {
  const db = c.env.DB;

  interface MonthlyRow {
    total_cost: number;
    interview_count: number;
  }

  // Monthly aggregates (current calendar month)
  const monthlyRow = await db
    .prepare(
      `SELECT
         COALESCE(SUM(usd_cost), 0) AS total_cost,
         COUNT(DISTINCT session_id) AS interview_count
       FROM culture_ai_usage_events
       WHERE created_at >= date('now', 'start of month')`,
    )
    .first<MonthlyRow>();

  const totalCost = monthlyRow?.total_cost ?? 0;
  const interviewCount = monthlyRow?.interview_count ?? 0;
  const avgCostPerInterview = interviewCount > 0 ? totalCost / interviewCount : 0;

  interface TopExpensiveRow {
    session_id: string;
    total_cost: number;
    candidate_id: string | null;
    state: string | null;
    completed_at: string | null;
  }

  // Top 10 most expensive sessions
  const topExpensive = await db
    .prepare(
      `SELECT
         u.session_id,
         SUM(u.usd_cost) AS total_cost,
         s.candidate_id,
         s.state,
         s.completed_at
       FROM culture_ai_usage_events u
       LEFT JOIN culture_interview_sessions s ON s.id = u.session_id
       GROUP BY u.session_id
       ORDER BY total_cost DESC
       LIMIT 10`,
    )
    .all<TopExpensiveRow>();

  return c.json({
    monthly: {
      totalCost,
      interviewCount,
      avgCostPerInterview,
    },
    topExpensive: topExpensive.results ?? [],
  });
});

// ── POST /calibration/run ─────────────────────────────────────────────────────
//
// Replaces the deprecated `workers/api/scripts/run-culture-calibration.ts`,
// which used the Cloudflare REST API + manual API token. This route runs the
// same calibration harness inside the Worker using the `env.AI` binding —
// same model, same fixtures, no API token bookkeeping.
//
// Recruiter-authed (Clerk JWT). Use sparingly: each run executes the full
// 11-call scoring pipeline against ~10 fixtures, so it burns Workers AI
// quota. Intended for use after any prompt change in cultureScorerPrompts.ts.
//
// Returns the full CalibrationReport JSON. The caller (recruiter UI or curl)
// can inspect QWK metrics and per-dimension confusion.
cultureRecruiter.post('/calibration/run', async (c) => {
  if (!c.env.AI) {
    return c.json(
      {
        error: {
          code: 'AI_BINDING_MISSING',
          message: 'Workers AI binding (env.AI) is not configured. Calibration cannot run.',
        },
      },
      503,
    );
  }

  // Lazy imports to keep the cold-start surface small for non-calibration
  // requests. The fixtures alone are ~440 lines of static JSON-ish data.
  const [{ runCalibration }, { CALIBRATION_FIXTURES }, { CloudflareAIProvider }] = await Promise.all([
    import('../../lib/cultureScorerCalibration'),
    import('../../lib/__tests__/cultureScorerCalibration.fixtures'),
    import('../../lib/llm/cloudflareAIProvider'),
  ]);

  const provider = new CloudflareAIProvider(c.env.AI);

  // Neutral mid-point benchmark so the scorer's profile match logic doesn't
  // bias the calibration output (matches the previous script's defaults).
  const orgBenchmark = {
    autonomy: 3,
    riskTolerance: 3,
    workPace: 3,
    collaborationStyle: 3,
    feedbackOrientation: 3,
  } as const;

  try {
    const report = await runCalibration({
      provider,
      fixtures: CALIBRATION_FIXTURES,
      orgBenchmark,
    });

    return c.json({
      passed: report.passed,
      competencyQwk: report.competencyQwk,
      profileQwk: report.profileQwk,
      overallQwk: report.overallQwk,
      target: 0.55,
      competencyResults: report.competencyResults,
      profileResults: report.profileResults,
    });
  } catch (err) {
    console.error('[culture-calibration] run failed:', err);
    return c.json(
      {
        error: {
          code: 'CALIBRATION_FAILED',
          message: err instanceof Error ? err.message : 'Unknown error during calibration.',
        },
      },
      500,
    );
  }
});

// ─── Candidate router ─────────────────────────────────────────────────────────
//
// These routes authenticate via a culture session token extracted from the URL
// path parameter, NOT the standard candidate JWT. The session token IS the
// invite token embedded in the candidate's link. We resolve it from D1 to find
// the session row — no separate JWT needed because the token IS the credential.
//
// This mirrors how review sessions work in routes/assessment/review.ts:
// the token in the path IS the auth credential; we look it up in D1.

export const cultureCandidate = new Hono<{ Bindings: Env; Variables: CandidateVariables }>();

// All candidate routes share the same session-token resolution helper.
// We look up the session by the invite token on the candidates table, then
// fetch the culture session for that candidate + challenge. To keep the
// interface simple, the :token path param IS the candidate session JWT
// (issued by resolve-token). We verify it and extract the candidateId.

async function resolveSessionByToken(
  env: Env,
  token: string,
): Promise<{ session: CultureSessionRow; candidateId: string } | null> {
  const secret = env.SESSION_TOKEN_SECRET;
  if (!secret) return null;

  const payload = await verifyJwt(token, secret);
  if (!payload) return null;

  const candidateId = payload.sub;

  // Find the most recent culture session for this candidate
  const session = await env.DB.prepare(
    `SELECT * FROM culture_interview_sessions
     WHERE candidate_id = ?1
     ORDER BY created_at DESC
     LIMIT 1`,
  )
    .bind(candidateId)
    .first<CultureSessionRow>();

  if (!session) return null;
  return { session, candidateId };
}

// ── GET /session/:token/state ─────────────────────────────────────────────────

cultureCandidate.get('/session/:token/state', async (c) => {
  const { token } = c.req.param();

  const resolved = await resolveSessionByToken(c.env, token);
  if (!resolved) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Session not found.' } }, 404);
  }

  const { session } = resolved;

  // Count turns asked (distinct questions, not probes)
  const transcript = parseJsonColumn<CultureTranscript>(
    session.transcript,
    defaultCultureTranscript(),
  );
  const turnsAsked = new Set(
    transcript.turns
      .filter((t) => t.probeOf === null)
      .map((t) => t.questionId),
  ).size;

  // Pending question text (last turn with no response)
  const pendingTurn = [...transcript.turns].reverse().find((t) => t.candidateResponse === null);
  const currentQuestion = pendingTurn
    ? { questionId: pendingTurn.questionId, text: pendingTurn.questionText }
    : null;

  if (session.state === 'consent') {
    // Log consent_shown event (idempotent: audit log is append-only)
    await c.env.DB.prepare(
      `INSERT INTO culture_compliance_audit (session_id, event_type, actor_type, actor_id)
       VALUES (?1, 'consent_shown', 'candidate', ?2)`,
    )
      .bind(session.id, resolved.candidateId)
      .run();

    return c.json({
      state: session.state,
      consentRequired: true,
      currentQuestion: null,
      turnsAsked: 0,
      totalBudget: 20,
      consent: consentPayload(),
    });
  }

  return c.json({
    state: session.state,
    consentRequired: false,
    currentQuestion,
    turnsAsked,
    totalBudget: 20,
  });
});

// ── POST /session/:token/consent ──────────────────────────────────────────────

cultureCandidate.post('/session/:token/consent', async (c) => {
  const { token } = c.req.param();

  const resolved = await resolveSessionByToken(c.env, token);
  if (!resolved) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Session not found.' } }, 404);
  }

  const { session, candidateId } = resolved;

  if (session.state !== 'consent') {
    return c.json(
      { error: { code: 'CONFLICT', message: `Session is already in state '${session.state}'.` } },
      409,
    );
  }

  // Resolve Team Context (RCD-derived) so the selector applies dimension
  // weights, enriched probes, and scorer-ready BARS/dealbreakers. Falls back
  // to mid + universal + empty probe bank on any lookup miss — never blocks
  // the interview.
  const roleContext = await resolveCultureRoleContext(c.env.DB, session.assessment_id);
  const probeBank = roleContext.teamContext
    ? await loadRoleProbeBank(c.env.DB, roleContext.teamContext.roleContextId)
    : EMPTY_PROBE_BANK;

  // Determine screener mode from challenge config (default role_fit).
  const challengeConfig = await c.env.DB.prepare(
    'SELECT server_config FROM challenges WHERE id = ?1',
  )
    .bind(session.challenge_id)
    .first<{ server_config: string | null }>();
  const serverConfig = parseJsonColumn<Record<string, unknown>>(
    challengeConfig?.server_config ?? null,
    {},
  );
  const mode = serverConfig.screenerMode === 'profile_builder' ? 'profile_builder' : 'role_fit';
  const useStaticFallback = c.env.USE_STATIC_QUESTION_BANK === 'true';

  // Create provider for generative first question (null when MOCK_AI or missing binding)
  const rawStartProvider = createCultureAgentProvider(c.env);
  const startProvider = rawStartProvider !== null
    ? withCultureMetering(rawStartProvider, session.id, 'conversation', c.env.DB, c.executionCtx)
    : null;

  // Seed first question (adaptive generative or static fallback)
  const { transcript, nextQuestion } = await startAdaptiveCultureInterview({
    provider: startProvider,
    db: c.env.DB,
    candidateId: session.candidate_id,
    assessmentId: session.assessment_id,
    mode,
    teamContext: roleContext.teamContext,
    seniority: roleContext.seniority,
    roleOverlayId: roleContext.roleOverlayId,
    probeBank,
    useStaticFallback,
  });

  const consentAt = now();
  const sourceMode = useStaticFallback ? 'static' : 'generative';

  await c.env.DB.prepare(
    `UPDATE culture_interview_sessions
     SET state = 'in_progress',
         consent_at = ?1,
         transcript = ?2,
         started_at = ?1,
         screener_mode = ?3,
         updated_at = ?1
     WHERE id = ?4`,
  )
    .bind(consentAt, JSON.stringify(transcript), mode, session.id)
    .run();

  // Compliance audit
  await c.env.DB.prepare(
    `INSERT INTO culture_compliance_audit (session_id, event_type, actor_type, actor_id)
     VALUES (?1, 'consent_given', 'candidate', ?2)`,
  )
    .bind(session.id, candidateId)
    .run();

  await c.env.DB.prepare(
    `INSERT INTO culture_compliance_audit (session_id, event_type, actor_type, actor_id)
     VALUES (?1, 'interview_started', 'candidate', ?2)`,
  )
    .bind(session.id, candidateId)
    .run();

  await c.env.DB.prepare(
    `INSERT INTO culture_compliance_audit (session_id, event_type, actor_type, metadata)
     VALUES (?1, 'question_source_mode', 'system', ?2)`,
  )
    .bind(session.id, JSON.stringify({ mode: sourceMode }))
    .run();

  return c.json({
    currentQuestion: nextQuestion,
    turnsAsked: 0,
    totalBudget: 20,
  });
});

// ── POST /session/:token/respond ──────────────────────────────────────────────

cultureCandidate.post('/session/:token/respond', async (c) => {
  const { token } = c.req.param();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.' } }, 422);
  }

  const answer = (body as Record<string, unknown>)?.answer;
  if (typeof answer !== 'string' || answer.trim().length === 0) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'answer must be a non-empty string.' } }, 422);
  }

  const resolved = await resolveSessionByToken(c.env, token);
  if (!resolved) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Session not found.' } }, 404);
  }

  const { session } = resolved;

  if (session.state !== 'in_progress') {
    return c.json(
      { error: { code: 'CONFLICT', message: `Session is in state '${session.state}', not 'in_progress'.` } },
      409,
    );
  }

  const transcript = parseJsonColumn<CultureTranscript>(
    session.transcript,
    defaultCultureTranscript(),
  );

  const rawProvider = createCultureAgentProvider(c.env);
  // Wrap with metering so each conversation turn is cost-tracked.
  const provider = rawProvider !== null
    ? withCultureMetering(rawProvider, session.id, 'conversation', c.env.DB, c.executionCtx)
    : null;

  // Re-resolve Team Context + probe bank on every advance — cheap (two
  // indexed queries) and avoids stale state if the recruiter re-runs role
  // setup mid-session.
  const roleContext = await resolveCultureRoleContext(c.env.DB, session.assessment_id);
  const probeBank = roleContext.teamContext
    ? await loadRoleProbeBank(c.env.DB, roleContext.teamContext.roleContextId)
    : EMPTY_PROBE_BANK;

  const mode = session.screener_mode ?? transcript.scratchpad.mode ?? 'role_fit';
  const useStaticFallback = c.env.USE_STATIC_QUESTION_BANK === 'true';

  const result = await advanceAdaptiveCultureInterview({
    provider,
    db: c.env.DB,
    candidateId: session.candidate_id,
    assessmentId: session.assessment_id,
    mode,
    teamContext: roleContext.teamContext,
    transcript,
    candidateAnswer: answer.trim(),
    maxQuestions: 20,
    minQuestions: 5,
    seniority: roleContext.seniority,
    roleOverlayId: roleContext.roleOverlayId,
    probeBank,
    useStaticFallback,
  });

  // ─── Decomposition (non-blocking, best-effort) ─────────────────────────────
  const pendingTurn = [...result.transcript.turns].reverse().find((t) => t.candidateResponse !== null);
  if (pendingTurn && pendingTurn.candidateResponse) {
    const targetDimension = result.transcript.scratchpad.questionMetadata?.find(
      (m) => m.questionText === pendingTurn.questionText,
    )?.targetDimension ?? 'ownership';

    const decomposition = await decomposeCandidateAnswer({
      provider,
      questionText: pendingTurn.questionText,
      candidateAnswer: pendingTurn.candidateResponse,
      targetDimension: targetDimension as import('../../lib/cultureQuestionBank').CompetencyDimension,
    });

    if (decomposition) {
      // Persist to candidate_nodes when table exists (currently a no-op stub)
      await persistDecomposition({
        db: c.env.DB,
        candidateId: session.candidate_id,
        sessionId: session.id,
        turnTimestamp: pendingTurn.timestamp,
        mode,
        decomposition,
      });

      // Audit log
      if (decomposition.culturalSignals.length > 0) {
        await c.env.DB.prepare(
          `INSERT INTO culture_compliance_audit (session_id, event_type, actor_type, metadata)
           VALUES (?1, 'answer_decomposed', 'system', ?2)`,
        )
          .bind(
            session.id,
            JSON.stringify({
              signalsExtracted: decomposition.culturalSignals.length,
              dimensions: decomposition.culturalSignals.map((s) => s.dimension),
              clarificationNeeded: decomposition.clarificationNeeded,
            }),
          )
          .run();
      }
    }
  }

  // ─── Audit: question_generated for new generative questions ─────────────────
  const latestTurn = [...result.transcript.turns].reverse().find((t) => t.probeOf === null && t.candidateResponse === null);
  if (latestTurn && latestTurn.questionId.startsWith('gen-')) {
    const meta = result.transcript.scratchpad.questionMetadata?.find(
      (m) => m.questionText === latestTurn.questionText,
    );
    if (meta) {
      await c.env.DB.prepare(
        `INSERT INTO culture_compliance_audit (session_id, event_type, actor_type, metadata)
         VALUES (?1, 'question_generated', 'system', ?2)`,
      )
        .bind(
          session.id,
          JSON.stringify({
            question_text: meta.questionText,
            target_dimension: meta.targetDimension,
            personalization_anchors: meta.personalizationAnchors,
          }),
        )
        .run();
    }
  }

  if (result.action === 'terminate') {
    // Persist updated transcript, transition to scoring
    await c.env.DB.prepare(
      `UPDATE culture_interview_sessions
       SET state = 'scoring',
           transcript = ?1,
           updated_at = ?2
       WHERE id = ?3`,
    )
      .bind(JSON.stringify(result.transcript), now(), session.id)
      .run();

    // Compliance audit
    await c.env.DB.prepare(
      `INSERT INTO culture_compliance_audit (session_id, event_type, actor_type, actor_id)
       VALUES (?1, 'interview_completed', 'candidate', ?2)`,
    )
      .bind(session.id, resolved.candidateId)
      .run();

    // Fire scoring in background — does not block the candidate response
    c.executionCtx.waitUntil(runScoringJob(c.env, session.id));

    return c.json({
      done: true,
      message: "Thank you for completing the interview. Your responses have been submitted for review.",
    });
  }

  // probe or next — persist transcript and return next question
  const nextQuestion =
    result.action === 'probe' ? result.probeQuestion : result.nextQuestion;

  const turnsAsked = new Set(
    result.transcript.turns
      .filter((t) => t.probeOf === null)
      .map((t) => t.questionId),
  ).size;

  await c.env.DB.prepare(
    `UPDATE culture_interview_sessions
     SET transcript = ?1,
         current_question_idx = ?2,
         updated_at = ?3
     WHERE id = ?4`,
  )
    .bind(JSON.stringify(result.transcript), turnsAsked, now(), session.id)
    .run();

  return c.json({
    done: false,
    acknowledgment: result.acknowledgment,
    currentQuestion: nextQuestion,
    turnsAsked,
    totalBudget: 20,
  });
});

// ── GET /session/:token/report ────────────────────────────────────────────────

cultureCandidate.get('/session/:token/report', async (c) => {
  const { token } = c.req.param();

  const resolved = await resolveSessionByToken(c.env, token);
  if (!resolved) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Session not found.' } }, 404);
  }

  const { session } = resolved;

  if (session.state !== 'complete') {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Report is not yet available.' } },
      404,
    );
  }

  // HITL gate (ADR-031 §2): report is withheld until recruiter has reviewed
  if (!session.review_decision) {
    return c.json(
      { error: { code: 'FORBIDDEN', message: 'Your report is pending recruiter review and will be available shortly.' } },
      403,
    );
  }

  const fullReport = parseJsonColumn<CultureScoreReport | null>(session.score_report, null);
  if (!fullReport) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Report is not available.' } },
      404,
    );
  }

  // Sanitize: strip BARS reasoning, internal traces, evidence quotes
  // Candidates see: headline, narrative, recommendation, dimension names + scores only
  const effectiveRecommendation = session.override_recommendation ?? fullReport.synthesis.recommendation;

  const sanitizedReport = {
    recommendation: effectiveRecommendation,
    headline: fullReport.synthesis.headline,
    narrative: fullReport.synthesis.narrative,
    competencyScores: fullReport.competencyScores.map((cs) => ({
      dimension: cs.dimension,
      score: cs.score,
      // No reasoning, no evidenceQuotes — ground truth stays server-side
    })),
    profileScores: fullReport.profileScores.map((ps) => ({
      dimension: ps.dimension,
      candidatePosition: ps.candidatePosition,
    })),
    scoredAt: fullReport.scoredAt,
  };

  return c.json({ report: sanitizedReport });
});
