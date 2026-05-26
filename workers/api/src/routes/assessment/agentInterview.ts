/**
 * Agent Interview Bridge Routes
 *
 * Bridges the frontend candidateConversationAdapter (which expects
 * /rpc/agent-interview/:challengeId/start|respond|complete) to the
 * existing culture interview engine (/rpc/culture/session/:token/...).
 *
 * These routes use standard candidate JWT auth (Authorization: Bearer)
 * and translate between the adapter's QuestionTurnResult/SynthesisResult
 * shapes and the culture engine's native formats.
 */

import { Hono } from 'hono';
import type { ExecutionContext } from '@cloudflare/workers-types';
import type { Env } from '../../types';
import type { CandidateVariables } from '../../middleware/candidateAuth';
import { candidateAuth } from '../../middleware/candidateAuth';
import { verifyJwt } from '../../lib/jwt';
import {
  startCultureInterview,
  advanceCultureInterview,
} from '../../lib/cultureAgent';
import { resolveCultureRoleContext } from '../../lib/cultureRoleResolution';
import { loadRoleProbeBank, EMPTY_PROBE_BANK } from '../../lib/cultureProbeBank';
import { createCultureAgentProvider } from '../../lib/llm/createProvider';
import { withCultureMetering } from '../../lib/llm/meteredProvider';
import { runScoringJob } from '../screening/culture';
import type {
  CultureTranscript,
  CultureTurn,
} from '../../lib/cultureAgent';
import {
  defaultCultureTranscript,
} from '../../lib/cultureAgent';
import { CULTURE_BANK_SIZE } from '../../lib/cultureQuestionBank';
import type {
  OrgCultureBenchmark,
  CultureScoreReport,
} from '../../lib/cultureScorer';

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
  screener_mode: 'profile_builder' | 'role_fit' | null;
  created_at: string;
  updated_at: string;
}

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

// ─── Default org benchmark for demo challenges ────────────────────────────────

const DEFAULT_ORG_BENCHMARK: OrgCultureBenchmark = {
  autonomy: 3,
  riskTolerance: 3,
  workPace: 3,
  collaborationStyle: 3,
  feedbackOrientation: 3,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveOrCreateSession(
  db: D1Database,
  candidateId: string,
  challengeId: string,
): Promise<{ session: CultureSessionRow; isNew: boolean } | null> {
  // Find existing session for this candidate + challenge
  const existing = await db
    .prepare(
      `SELECT * FROM culture_interview_sessions
       WHERE candidate_id = ?1 AND challenge_id = ?2
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(candidateId, challengeId)
    .first<CultureSessionRow>();

  if (existing) {
    return { session: existing, isNew: false };
  }

  // Need an assessment for this challenge
  const assessment = await db
    .prepare(
      `SELECT a.id
       FROM assessments a
       JOIN stages s ON s.id = a.stage_id
       JOIN challenges ch ON ch.stage_id = s.id
       WHERE a.candidate_id = ?1 AND ch.id = ?2
       LIMIT 1`,
    )
    .bind(candidateId, challengeId)
    .first<{ id: string }>();

  if (!assessment) {
    return null;
  }

  const sessionId = crypto.randomUUID();
  const createdAt = now();

  await db
    .prepare(
      `INSERT INTO culture_interview_sessions
       (id, challenge_id, assessment_id, candidate_id, state, transcript, current_question_idx, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'consent', ?5, 0, ?6, ?6)`,
    )
    .bind(
      sessionId,
      challengeId,
      assessment.id,
      candidateId,
      JSON.stringify(defaultCultureTranscript()),
      createdAt,
    )
    .run();

  const session = await db
    .prepare('SELECT * FROM culture_interview_sessions WHERE id = ?1')
    .bind(sessionId)
    .first<CultureSessionRow>();

  if (!session) return null;
  return { session, isNew: true };
}

async function loadOrgBenchmark(db: D1Database, challengeId: string): Promise<OrgCultureBenchmark> {
  const row = await db
    .prepare('SELECT server_config FROM challenges WHERE id = ?1')
    .bind(challengeId)
    .first<{ server_config: string | null }>();

  const serverConfig = parseJsonColumn<Record<string, unknown>>(row?.server_config ?? null, {});
  const bm = serverConfig.orgBenchmark as OrgCultureBenchmark | undefined;
  if (bm && typeof bm === 'object' && 'autonomy' in bm) {
    return bm;
  }
  return DEFAULT_ORG_BENCHMARK;
}

function buildTranscriptFromCulture(session: CultureSessionRow): Array<{ role: 'user' | 'model'; text: string; videoR2Key?: string }> {
  const transcript = parseJsonColumn<CultureTranscript>(session.transcript, defaultCultureTranscript());
  const result: Array<{ role: 'user' | 'model'; text: string; videoR2Key?: string }> = [];

  for (const turn of transcript.turns) {
    if (turn.questionText) {
      result.push({ role: 'model', text: turn.questionText });
    }
    if (turn.candidateResponse) {
      result.push({ role: 'user', text: turn.candidateResponse, videoR2Key: turn.videoR2Key });
    }
  }

  return result;
}

function countTurnsAsked(session: CultureSessionRow): number {
  const transcript = parseJsonColumn<CultureTranscript>(session.transcript, defaultCultureTranscript());
  return new Set(
    transcript.turns
      .filter((t) => t.probeOf === null)
      .map((t) => t.questionId),
  ).size;
}

function getCurrentQuestion(session: CultureSessionRow): { questionId: string; text: string } | null {
  const transcript = parseJsonColumn<CultureTranscript>(session.transcript, defaultCultureTranscript());
  const pendingTurn = [...transcript.turns].reverse().find((t) => t.candidateResponse === null);
  if (pendingTurn) {
    return { questionId: pendingTurn.questionId, text: pendingTurn.questionText };
  }
  return null;
}

// ─── Translation helpers ──────────────────────────────────────────────────────

function toQuestionTurnResult(
  question: { questionId: string; text: string },
  turnsAsked: number,
  acknowledgment = '',
): {
  type: 'question';
  acknowledgment: string;
  question: { id: string; text: string; input: { type: 'textarea'; placeholder: string } };
  progress: { asked: number; budget: number; domains: Record<string, 'none'> };
} {
  return {
    type: 'question',
    acknowledgment,
    question: {
      id: question.questionId,
      text: question.text,
      input: { type: 'textarea', placeholder: 'Type your answer here…' },
    },
    progress: {
      asked: turnsAsked,
      budget: CULTURE_BANK_SIZE,
      domains: {
        why: 'none',
        work: 'none',
        team: 'none',
        bar: 'none',
        codebase: 'none',
        process: 'none',
      },
    },
  };
}

function toSynthesisResult(
  session: CultureSessionRow,
  message: string,
): {
  type: 'synthesis';
  synthesis: string;
  persona: null;
  jobDescription: null;
  progress: { asked: number; budget: number; domains: Record<string, 'none'> };
  transcript: Array<{ role: 'user' | 'model'; text: string }>;
} {
  return {
    type: 'synthesis',
    synthesis: message,
    persona: null,
    jobDescription: null,
    progress: {
      asked: countTurnsAsked(session),
      budget: CULTURE_BANK_SIZE,
      domains: {
        why: 'none',
        work: 'none',
        team: 'none',
        bar: 'none',
        codebase: 'none',
        process: 'none',
      },
    },
    transcript: buildTranscriptFromCulture(session),
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const agentInterviewRouter = new Hono<{
  Bindings: Env;
  Variables: CandidateVariables;
}>();

agentInterviewRouter.use('*', candidateAuth);

// ── POST /:challengeId/start ──────────────────────────────────────────────────

agentInterviewRouter.post('/:challengeId/start', async (c) => {
  const candidateId = c.get('candidateId');
  const challengeId = c.req.param('challengeId');
  const db = c.env.DB;

  const resolved = await resolveOrCreateSession(db, candidateId, challengeId);
  if (!resolved) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'No assessment found for this challenge.' } }, 404);
  }

  let { session } = resolved;

  // ── Auto-consent if needed ─────────────────────────────────────────────────
  if (session.state === 'consent') {
    const roleContext = await resolveCultureRoleContext(db, session.assessment_id);
    const probeBank = roleContext.teamContext
      ? await loadRoleProbeBank(db, roleContext.teamContext.roleContextId)
      : EMPTY_PROBE_BANK;

    const challengeConfig = await db
      .prepare('SELECT server_config FROM challenges WHERE id = ?1')
      .bind(challengeId)
      .first<{ server_config: string | null }>();
    const serverConfig = parseJsonColumn<Record<string, unknown>>(
      challengeConfig?.server_config ?? null,
      {},
    );
    const mode = serverConfig.screenerMode === 'profile_builder' ? 'profile_builder' : 'role_fit';
    const useStaticFallback = c.env.USE_STATIC_QUESTION_BANK === 'true';

    const rawProvider = createCultureAgentProvider(c.env);
    const provider = rawProvider !== null
      ? withCultureMetering(rawProvider, session.id, 'conversation', db, c.executionCtx)
      : null;

    const { transcript, nextQuestion } = startCultureInterview({
      mode,
      seniority: roleContext.seniority,
      roleOverlayId: roleContext.roleOverlayId,
      probeBank,
    });

    const consentAt = now();
    await db
      .prepare(
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

    // Refresh session
    const refreshed = await db
      .prepare('SELECT * FROM culture_interview_sessions WHERE id = ?1')
      .bind(session.id)
      .first<CultureSessionRow>();
    if (refreshed) session = refreshed;

    return c.json(toQuestionTurnResult(nextQuestion, 0));
  }

  // ── Already in progress ────────────────────────────────────────────────────
  if (session.state === 'in_progress') {
    const currentQuestion = getCurrentQuestion(session);
    if (currentQuestion) {
      return c.json(toQuestionTurnResult(currentQuestion, countTurnsAsked(session)));
    }

    // No pending question — interview may have stalled. Force a new question
    // by re-running start (rare edge case).
    const roleContext = await resolveCultureRoleContext(db, session.assessment_id);
    const probeBank = roleContext.teamContext
      ? await loadRoleProbeBank(db, roleContext.teamContext.roleContextId)
      : EMPTY_PROBE_BANK;

    const challengeConfig = await db
      .prepare('SELECT server_config FROM challenges WHERE id = ?1')
      .bind(challengeId)
      .first<{ server_config: string | null }>();
    const serverConfig = parseJsonColumn<Record<string, unknown>>(
      challengeConfig?.server_config ?? null,
      {},
    );
    const mode = serverConfig.screenerMode === 'profile_builder' ? 'profile_builder' : 'role_fit';
    const useStaticFallback = c.env.USE_STATIC_QUESTION_BANK === 'true';

    const rawProvider = createCultureAgentProvider(c.env);
    const provider = rawProvider !== null
      ? withCultureMetering(rawProvider, session.id, 'conversation', db, c.executionCtx)
      : null;

    const { transcript, nextQuestion } = startCultureInterview({
      mode,
      seniority: roleContext.seniority,
      roleOverlayId: roleContext.roleOverlayId,
      probeBank,
    });

    await db
      .prepare(
        `UPDATE culture_interview_sessions
         SET transcript = ?1, updated_at = ?2
         WHERE id = ?3`,
      )
      .bind(JSON.stringify(transcript), now(), session.id)
      .run();

    return c.json(toQuestionTurnResult(nextQuestion, countTurnsAsked(session)));
  }

  // ── Scoring or complete ────────────────────────────────────────────────────
  if (session.state === 'scoring' || session.state === 'complete') {
    return c.json(
      toSynthesisResult(
        session,
        'Your interview has been submitted for review. Thank you for your time.',
      ),
    );
  }

  return c.json({ error: { code: 'CONFLICT', message: `Session is in unexpected state '${session.state}'.` } }, 409);
});

// ── POST /:challengeId/respond ─────────────────────────────────────────────────

agentInterviewRouter.post('/:challengeId/respond', async (c) => {
  const candidateId = c.get('candidateId');
  const challengeId = c.req.param('challengeId');
  const db = c.env.DB;

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
  const videoR2Key = (body as Record<string, unknown>)?.videoR2Key as string | undefined;

  const resolved = await resolveOrCreateSession(db, candidateId, challengeId);
  if (!resolved) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Session not found.' } }, 404);
  }

  const { session } = resolved;

  if (session.state === 'consent') {
    // Candidate hit respond before start — auto-start first
    const startResponse = await fetch(
      `${new URL(c.req.url).origin}/rpc/agent-interview/${challengeId}/start`,
      {
        method: 'POST',
        headers: {
          Authorization: c.req.header('Authorization') ?? '',
          'Content-Type': 'application/json',
        },
      },
    );
    if (!startResponse.ok) {
      const err = (await startResponse.json().catch(() => ({}))) as { error?: { message?: string } };
      return c.json({ error: { code: 'FAILED_TO_START', message: err.error?.message || 'Failed to auto-start interview.' } }, 502);
    }
    // Refresh session after auto-start
    const refreshed = await db
      .prepare('SELECT * FROM culture_interview_sessions WHERE id = ?1')
      .bind(session.id)
      .first<CultureSessionRow>();
    if (!refreshed) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Session lost after auto-start.' } }, 404);
    }
    // Fall through to respond with refreshed session
    return doRespond(c, db, refreshed, answer.trim(), videoR2Key);
  }

  if (session.state !== 'in_progress') {
    return c.json(
      { error: { code: 'CONFLICT', message: `Session is in state '${session.state}', not 'in_progress'.` } },
      409,
    );
  }

  return doRespond(c, db, session, answer.trim(), videoR2Key);
});

async function doRespond(
  ctx: { env: Env; executionCtx: ExecutionContext; json: (body: unknown, status?: number) => Response },
  db: D1Database,
  session: CultureSessionRow,
  answer: string,
  videoR2Key?: string,
) {
  const transcript = parseJsonColumn<CultureTranscript>(session.transcript, defaultCultureTranscript());

  const rawProvider = createCultureAgentProvider(ctx.env);
  const provider = rawProvider !== null
    ? withCultureMetering(rawProvider, session.id, 'conversation', db, ctx.executionCtx)
    : null;

  const roleContext = await resolveCultureRoleContext(db, session.assessment_id);
  const probeBank = roleContext.teamContext
    ? await loadRoleProbeBank(db, roleContext.teamContext.roleContextId)
    : EMPTY_PROBE_BANK;

  const mode = session.screener_mode ?? transcript.scratchpad.mode ?? 'role_fit';
  const useStaticFallback = ctx.env.USE_STATIC_QUESTION_BANK === 'true';

  const result = await advanceCultureInterview({
    provider,
    transcript,
    candidateAnswer: answer,
    maxQuestions: CULTURE_BANK_SIZE,
    minQuestions: 5,
    seniority: roleContext.seniority,
    roleOverlayId: roleContext.roleOverlayId,
    probeBank,
  });

  // Attach video R2 key to the most recent answered turn
  // (advanceCultureInterview may append a probe turn at the end, so we walk
  // backwards to find the last turn with a non-null candidateResponse.)
  if (videoR2Key && result.transcript.turns.length > 0) {
    for (let i = result.transcript.turns.length - 1; i >= 0; i--) {
      const turn = result.transcript.turns[i]!;
      if (turn.candidateResponse !== null) {
        turn.videoR2Key = videoR2Key;
        break;
      }
    }
  }

  if (result.action === 'terminate') {
    await db
      .prepare(
        `UPDATE culture_interview_sessions
         SET state = 'scoring',
             transcript = ?1,
             updated_at = ?2
         WHERE id = ?3`,
      )
      .bind(JSON.stringify(result.transcript), now(), session.id)
      .run();

    ctx.executionCtx.waitUntil(runScoringJob(ctx.env, session.id));

    const refreshed = await db
      .prepare('SELECT * FROM culture_interview_sessions WHERE id = ?1')
      .bind(session.id)
      .first<CultureSessionRow>();

    return ctx.json(
      toSynthesisResult(
        refreshed ?? session,
        "Thank you for completing the interview. Your responses have been submitted for review.",
      ),
    );
  }

  const nextQuestion =
    result.action === 'probe' ? result.probeQuestion : result.nextQuestion;

  const turnsAsked = new Set(
    result.transcript.turns
      .filter((t) => t.probeOf === null)
      .map((t) => t.questionId),
  ).size;

  await db
    .prepare(
      `UPDATE culture_interview_sessions
       SET transcript = ?1,
           current_question_idx = ?2,
           updated_at = ?3
       WHERE id = ?4`,
    )
    .bind(JSON.stringify(result.transcript), turnsAsked, now(), session.id)
    .run();

  return ctx.json(toQuestionTurnResult(nextQuestion, turnsAsked, result.acknowledgment));
}

// ── POST /:challengeId/complete ────────────────────────────────────────────────

agentInterviewRouter.post('/:challengeId/complete', async (c) => {
  const candidateId = c.get('candidateId');
  const challengeId = c.req.param('challengeId');
  const db = c.env.DB;

  const resolved = await resolveOrCreateSession(db, candidateId, challengeId);
  if (!resolved) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Session not found.' } }, 404);
  }

  const { session } = resolved;

  if (session.state === 'scoring' || session.state === 'complete') {
    return c.json(
      toSynthesisResult(
        session,
        'Your interview has been submitted for review. Thank you for your time.',
      ),
    );
  }

  if (session.state === 'consent') {
    // Not even started — just return a basic synthesis
    return c.json(
      toSynthesisResult(session, 'Interview completed. No responses were recorded.'),
    );
  }

  // Force completion: mark as scoring and fire background scoring
  const transcript = parseJsonColumn<CultureTranscript>(session.transcript, defaultCultureTranscript());

  await db
    .prepare(
      `UPDATE culture_interview_sessions
       SET state = 'scoring',
           transcript = ?1,
           updated_at = ?2
       WHERE id = ?3`,
    )
    .bind(JSON.stringify(transcript), now(), session.id)
    .run();

  c.executionCtx.waitUntil(runScoringJob(c.env, session.id));

  // Refresh
  const refreshed = await db
    .prepare('SELECT * FROM culture_interview_sessions WHERE id = ?1')
    .bind(session.id)
    .first<CultureSessionRow>();

  return c.json(
    toSynthesisResult(
      refreshed ?? session,
      "Thank you for completing the interview. Your responses have been submitted for review.",
    ),
  );
});
