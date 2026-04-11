/**
 * RPC routes — Phase 3 Candidate Flow
 *
 * Candidate-facing routes authenticated via custom JWT session tokens.
 * No Clerk. No sign-in required.
 *
 * Routes:
 *   POST /rpc/resolve-token      — Public: validate invite token, issue JWT
 *   POST /rpc/get-stage-config   — Candidate JWT: return current stage metadata
 *   POST /rpc/get-challenge      — Candidate JWT: return challenge content by order
 *   POST /rpc/refresh-session    — Public: reissue JWT from expired token
 */

import { Hono } from 'hono';
import { signJwt, verifyJwt } from '../lib/jwt';
import { candidateAuth, type CandidateVariables } from '../middleware/candidateAuth';
import { review } from './assessment/review';
import { repo } from './assessment/repo';
import { devContainer } from './assessment/devContainer';
import { fetchGitHubDiff } from '../lib/fetchGitHubDiff';
import { cultureCandidate } from './screening/culture';
import type { Env } from '../types';

// ─── Public routes (no auth) ────────────────────────────────────────────────

const rpcPublic = new Hono<{ Bindings: Env }>();

// ── POST /rpc/resolve-token ─────────────────────────────────────────────────

rpcPublic.post('/resolve-token', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const inviteToken = body.inviteToken;

  if (!inviteToken || typeof inviteToken !== 'string' || inviteToken.trim() === '') {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'inviteToken is required.' } }, 400);
  }

  const trimmed = inviteToken.trim();

  // Reject already-claimed tokens
  if (trimmed.startsWith('CLAIMED::')) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Token already claimed.' } }, 404);
  }

  // Look up candidate by invite token
  const candidate = await c.env.DB.prepare(
    `SELECT id, pipeline_id, status, name
     FROM candidates
     WHERE invite_token = ?1
     LIMIT 1`,
  )
    .bind(trimmed)
    .first<{
      id: string;
      pipeline_id: string;
      status: string;
      name: string | null;
    }>();

  if (!candidate) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Invalid invite token.' } }, 404);
  }

  // Block completed candidates
  if (candidate.status === 'COMPLETED') {
    return c.json({
      error: { code: 'FORBIDDEN', message: 'You have already completed this assessment.' },
      status: 'COMPLETED',
    }, 403);
  }

  const secret = c.env.SESSION_TOKEN_SECRET;
  if (!secret) {
    console.error('[resolve-token] SESSION_TOKEN_SECRET not configured');
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Auth not configured.' } }, 500);
  }

  // Issue JWT session token
  const sessionToken = await signJwt(
    { sub: candidate.id, pid: candidate.pipeline_id },
    secret,
  );

  // Claim the invite token atomically (one-time use)
  const result = await c.env.DB.prepare(
    `UPDATE candidates
     SET invite_token = ?1, status = CASE WHEN status = 'INVITED' THEN 'IN_PROGRESS' ELSE status END, updated_at = ?2
     WHERE id = ?3 AND invite_token = ?4`,
  )
    .bind(`CLAIMED::${trimmed}`, new Date().toISOString(), candidate.id, trimmed)
    .run();

  // If no rows affected, token was claimed by concurrent request
  if (result.meta.changes === 0) {
    return c.json({ error: { code: 'CONFLICT', message: 'Token was already claimed.' } }, 409);
  }

  return c.json({
    id: candidate.id,
    pipelineId: candidate.pipeline_id,
    status: candidate.status === 'INVITED' ? 'IN_PROGRESS' : candidate.status,
    name: candidate.name,
    sessionToken,
  });
});

// ── POST /rpc/refresh-session ───────────────────────────────────────────────

rpcPublic.post('/refresh-session', async (c) => {
  const authHeader = c.req.header('Authorization');
  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  if (!token) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing session token.' } }, 401);
  }

  const secret = c.env.SESSION_TOKEN_SECRET;
  if (!secret) {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Auth not configured.' } }, 500);
  }

  // Verify signature but IGNORE expiry — this is the refresh flow
  const payload = await verifyJwt(token, secret, true);
  if (!payload) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid session token.' } }, 401);
  }

  // Check candidate still exists and is not completed
  const candidate = await c.env.DB.prepare(
    `SELECT id, status FROM candidates WHERE id = ?1`,
  )
    .bind(payload.sub)
    .first<{ id: string; status: string }>();

  if (!candidate) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Candidate not found.' } }, 404);
  }

  if (candidate.status === 'COMPLETED') {
    return c.json({
      error: { code: 'FORBIDDEN', message: 'Assessment already completed.' },
    }, 403);
  }

  // Issue fresh JWT
  const sessionToken = await signJwt(
    { sub: payload.sub, pid: payload.pid },
    secret,
  );

  return c.json({ sessionToken });
});

// ─── Authenticated routes (candidate JWT) ───────────────────────────────────

const rpcAuth = new Hono<{ Bindings: Env; Variables: CandidateVariables }>();

rpcAuth.use('*', candidateAuth);

// ── POST /rpc/get-stage-config ──────────────────────────────────────────────

rpcAuth.post('/get-stage-config', async (c) => {
  const candidateId = c.get('candidateId');
  const pipelineId = c.get('pipelineId');

  // Fetch candidate to get owner_id for Assessment creation
  const candidate = await c.env.DB.prepare(
    `SELECT id, pipeline_id, owner_id FROM candidates WHERE id = ?1`,
  )
    .bind(candidateId)
    .first<{ id: string; pipeline_id: string; owner_id: string | null }>();

  if (!candidate) {
    return c.json({ isComplete: false, error: 'Candidate not found' });
  }

  // Fetch all stages with challenges in a single JOIN query
  // Include config so we can filter out empty/unconfigured challenges
  const rows = await c.env.DB.prepare(`
    SELECT
      s.id AS stage_id,
      s.title AS stage_title,
      s.sort_order AS stage_order,
      s.mode AS stage_mode,
      s.time_limit,
      s.video_config,
      ch.id AS challenge_id,
      ch.type AS challenge_type,
      ch.sort_order AS challenge_order,
      ch.config AS challenge_config,
      ch.instructions AS challenge_instructions
    FROM stages s
    LEFT JOIN challenges ch ON ch.stage_id = s.id
    WHERE s.pipeline_id = ?1
    ORDER BY s.sort_order ASC, ch.sort_order ASC
  `)
    .bind(pipelineId)
    .all();

  if (!rows.results || rows.results.length === 0) {
    return c.json({ isComplete: true });
  }

  // Group by stage
  const stageMap = new Map<
    string,
    {
      id: string;
      title: string;
      order: number;
      mode: string | null;
      timeLimit: number | null;
      videoConfig: string | null;
      challenges: Array<{ id: string; type: string; order: number }>;
    }
  >();

  for (const row of rows.results) {
    const r = row as Record<string, unknown>;
    const sid = r.stage_id as string;
    if (!stageMap.has(sid)) {
      stageMap.set(sid, {
        id: sid,
        title: r.stage_title as string,
        order: r.stage_order as number,
        mode: (r.stage_mode as string | null) ?? null,
        timeLimit: (r.time_limit as number | null) ?? null,
        videoConfig: (r.video_config as string | null) ?? null,
        challenges: [],
      });
    }
    if (r.challenge_id) {
      // Filter out empty/unconfigured challenges — candidates should never see
      // placeholder challenges that have no meaningful content (Bug #11 fix).
      const rawConfig = r.challenge_config as string | null;
      const instructions = r.challenge_instructions as string | null;
      let hasContent = !!(instructions && instructions.trim().length > 0);
      if (rawConfig) {
        try {
          const parsed = typeof rawConfig === 'string' ? JSON.parse(rawConfig) : rawConfig;
          // A challenge has content if config has any truthy values
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            hasContent = true;
          }
        } catch {
          // Invalid JSON config — treat as empty
        }
      }

      if (hasContent) {
        stageMap.get(sid)!.challenges.push({
          id: r.challenge_id as string,
          type: r.challenge_type as string,
          order: r.challenge_order as number,
        });
      }
    }
  }

  const stages = [...stageMap.values()].sort((a, b) => a.order - b.order);

  // Walk stages to find the first with un-submitted challenges
  for (const stage of stages) {
    if (stage.challenges.length === 0) continue;

    // Fetch existing submissions for this stage
    const subs = await c.env.DB.prepare(`
      SELECT cs.challenge_id
      FROM challenge_submissions cs
      JOIN assessments a ON a.id = cs.assessment_id
      WHERE a.candidate_id = ?1 AND a.stage_id = ?2
    `)
      .bind(candidateId, stage.id)
      .all();

    const submittedIds = new Set(
      (subs.results ?? []).map(
        (r) => (r as Record<string, unknown>).challenge_id as string,
      ),
    );

    // Find first un-submitted challenge index
    let currentIndex = -1;
    for (let i = 0; i < stage.challenges.length; i++) {
      if (!submittedIds.has(stage.challenges[i].id)) {
        currentIndex = i;
        break;
      }
    }

    if (currentIndex === -1) continue; // All submitted, move to next stage

    // Ensure Assessment exists for this stage
    const existingAssessment = await c.env.DB.prepare(
      `SELECT id FROM assessments WHERE candidate_id = ?1 AND stage_id = ?2 LIMIT 1`,
    )
      .bind(candidateId, stage.id)
      .first<{ id: string }>();

    if (!existingAssessment) {
      const assessmentId = crypto.randomUUID();
      const now = new Date().toISOString();
      await c.env.DB.prepare(`
        INSERT INTO assessments (id, candidate_id, stage_id, status, owner_id, started_at, created_at, updated_at)
        VALUES (?1, ?2, ?3, 'PENDING', ?4, ?5, ?5, ?5)
      `)
        .bind(assessmentId, candidateId, stage.id, candidate.owner_id, now)
        .run();
    }

    // Update currentStageId on candidate
    await c.env.DB.prepare(
      `UPDATE candidates SET current_stage_id = ?1 WHERE id = ?2`,
    )
      .bind(stage.id, candidateId)
      .run();

    // Prepend synthetic challenge steps: WELCOME always, LIVE_VIDEO for video stages
    const syntheticChallenges: Array<{ type: string; order: number }> = [];
    syntheticChallenges.push({ type: 'WELCOME', order: -2 });
    if (stage.mode === 'LIVE_VIDEO') {
      syntheticChallenges.push({ type: 'LIVE_VIDEO', order: -1 });
    }

    const allChallenges = [
      ...syntheticChallenges,
      ...stage.challenges,
    ];

    // Re-index orders sequentially
    const indexedChallenges = allChallenges.map((ch, i) => ({ type: ch.type, order: i }));

    // If no real challenges submitted yet, start at 0 (WELCOME).
    // If resuming (some submitted), skip synthetics and jump to the right real challenge.
    const syntheticCount = syntheticChallenges.length;
    const hasSubmissions = currentIndex > 0;
    const adjustedIndex = hasSubmissions ? currentIndex + syntheticCount : 0;

    // Build response — challenge IDs are NOT exposed, only type + order index
    return c.json({
      isComplete: false,
      stageId: stage.id,
      candidateId,
      stageTitle: stage.title,
      mode: stage.mode ?? 'ASYNC',
      timeLimit: stage.timeLimit,
      challenges: indexedChallenges,
      currentIndex: adjustedIndex,
    });
  }

  // All stages complete
  return c.json({ isComplete: true });
});

// ── POST /rpc/get-challenge ─────────────────────────────────────────────────

rpcAuth.post('/get-challenge', async (c) => {
  const candidateId = c.get('candidateId');
  const pipelineId = c.get('pipelineId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const order = body.order;
  if (typeof order !== 'number' || order < 0 || !Number.isInteger(order)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'order must be a non-negative integer.' } },
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
    return c.json({ error: 'No active stage' }, 404);
  }

  // Determine synthetic challenge count for this stage
  const stageInfo = await c.env.DB.prepare(
    `SELECT mode FROM stages WHERE id = ?1`
  )
    .bind(candidate.current_stage_id)
    .first<{ mode: string | null }>();

  const syntheticCount = 1 + (stageInfo?.mode === 'LIVE_VIDEO' ? 1 : 0); // WELCOME + optional LIVE_VIDEO

  // Return synthetic challenges without DB lookup
  if (order < syntheticCount) {
    const syntheticType = order === 0 ? 'WELCOME' : 'LIVE_VIDEO';
    return c.json({
      id: `synthetic-${syntheticType.toLowerCase()}`,
      type: syntheticType,
      title: syntheticType === 'WELCOME' ? 'Welcome' : 'Video Interview',
      instructions: null,
      config: null,
      cachedDiffJson: null,
      githubPrTitle: null,
      githubPrNumber: null,
      githubRepoUrl: null,
      githubPrDescription: null,
    });
  }

  // Adjust order to account for synthetic entries
  const dbOrder = order - syntheticCount;

  // Fetch challenges for the current stage, ordered
  const challenges = await c.env.DB.prepare(`
    SELECT id, type, title, instructions, config,
           cached_diff_json, github_pr_title, github_pr_number,
           github_repo_url, github_pr_description
    FROM challenges
    WHERE stage_id = ?1
    ORDER BY sort_order ASC
  `)
    .bind(candidate.current_stage_id)
    .all();

  const rows = challenges.results ?? [];

  if (dbOrder >= rows.length) {
    return c.json({ error: 'Challenge not found at this order index' }, 404);
  }

  const ch = rows[dbOrder] as Record<string, unknown>;

  // Parse config JSON if stored as string
  let config: unknown = null;
  if (ch.config) {
    try {
      config =
        typeof ch.config === 'string' ? JSON.parse(ch.config) : ch.config;
    } catch {
      config = null;
    }
  }

  // Parse cached diff JSON if stored as string
  let cachedDiffJson: unknown = null;
  if (ch.cached_diff_json) {
    try {
      cachedDiffJson =
        typeof ch.cached_diff_json === 'string'
          ? JSON.parse(ch.cached_diff_json as string)
          : ch.cached_diff_json;
    } catch {
      cachedDiffJson = null;
    }
  }

  // Self-heal: if diff is missing but repo+PR exist, fetch and cache it now
  if (!cachedDiffJson && ch.github_repo_url && ch.github_pr_number) {
    try {
      const token = (c.env as Env & { GITHUB_TOKEN?: string }).GITHUB_TOKEN;
      const result = await fetchGitHubDiff(
        ch.github_repo_url as string,
        ch.github_pr_number as number,
        token,
      );
      if (result) {
        cachedDiffJson = result.diff;
        // Persist so we don't fetch again next time
        await c.env.DB.prepare(
          `UPDATE challenges SET cached_diff_json = ?1, cached_metadata = ?2, diff_cached_at = ?3 WHERE id = ?4`,
        )
          .bind(
            JSON.stringify(result.diff),
            JSON.stringify(result.metadata),
            new Date().toISOString(),
            ch.id as string,
          )
          .run();
      }
    } catch (err) {
      console.error('[rpc/get-challenge] Self-heal diff fetch failed:', err);
    }
  }

  // SECURITY: Never expose server_config or ground truth.
  // Challenge ID (UUID) is safe — needed for file browser + review session scoping.
  return c.json({
    id: ch.id,
    type: ch.type,
    title: ch.title,
    instructions: ch.instructions,
    config,
    cachedDiffJson,
    githubPrTitle: ch.github_pr_title ?? null,
    githubPrNumber: ch.github_pr_number ?? null,
    githubRepoUrl: ch.github_repo_url ?? null,
    githubPrDescription: ch.github_pr_description ?? null,
  });
});

// ── POST /rpc/submit-challenge-response ─────────────────────────────────────

rpcAuth.post('/submit-challenge-response', async (c) => {
  const candidateId = c.get('candidateId');
  const pipelineId = c.get('pipelineId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const order = body.order;
  const submission = body.submission;

  if (typeof order !== 'number' || order < 0 || !Number.isInteger(order)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'order must be a non-negative integer.' } },
      400,
    );
  }

  if (submission === undefined || submission === null) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'submission is required.' } },
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
    return c.json({ success: false, error: 'No active stage' }, 404);
  }

  const stageId = candidate.current_stage_id;

  // Determine synthetic challenge count for this stage
  const stageInfo = await c.env.DB.prepare(
    `SELECT mode FROM stages WHERE id = ?1`
  )
    .bind(stageId)
    .first<{ mode: string | null }>();

  const syntheticCount = 1 + (stageInfo?.mode === 'LIVE_VIDEO' ? 1 : 0);

  // Synthetic challenges (WELCOME, LIVE_VIDEO) — no DB write needed
  if (order < syntheticCount) {
    return c.json({ success: true, next: true });
  }

  const dbOrder = order - syntheticCount;

  // Fetch challenges for the current stage, ordered
  const challenges = await c.env.DB.prepare(`
    SELECT id, type, sort_order, server_config
    FROM challenges
    WHERE stage_id = ?1
    ORDER BY sort_order ASC
  `)
    .bind(stageId)
    .all();

  const rows = challenges.results ?? [];

  if (dbOrder >= rows.length) {
    return c.json({ success: false, error: 'Challenge not found at this order index' }, 404);
  }

  const challenge = rows[dbOrder] as Record<string, unknown>;
  const challengeId = challenge.id as string;

  // Get or create assessment for this stage
  let assessment = await c.env.DB.prepare(
    `SELECT id FROM assessments WHERE candidate_id = ?1 AND stage_id = ?2 LIMIT 1`,
  )
    .bind(candidateId, stageId)
    .first<{ id: string }>();

  const now = new Date().toISOString();

  if (!assessment) {
    const assessmentId = crypto.randomUUID();
    const ownerRow = await c.env.DB.prepare(
      `SELECT owner_id FROM candidates WHERE id = ?1`,
    )
      .bind(candidateId)
      .first<{ owner_id: string }>();

    await c.env.DB.prepare(`
      INSERT INTO assessments (id, candidate_id, stage_id, status, owner_id, started_at, created_at, updated_at)
      VALUES (?1, ?2, ?3, 'IN_PROGRESS', ?4, ?5, ?5, ?5)
    `)
      .bind(assessmentId, candidateId, stageId, ownerRow?.owner_id ?? null, now)
      .run();

    assessment = { id: assessmentId };
  }

  // Check for duplicate submission
  const existing = await c.env.DB.prepare(
    `SELECT id FROM challenge_submissions
     WHERE assessment_id = ?1 AND challenge_id = ?2 LIMIT 1`,
  )
    .bind(assessment.id, challengeId)
    .first<{ id: string }>();

  if (existing) {
    return c.json(
      { success: false, error: 'Challenge already submitted' },
      409,
    );
  }

  // Create ChallengeSubmission
  const submissionId = crypto.randomUUID();
  const responseJson = typeof submission === 'string' ? submission : JSON.stringify(submission);

  await c.env.DB.prepare(`
    INSERT INTO challenge_submissions (id, assessment_id, challenge_id, candidate_id, response_json, submitted_at, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)
  `)
    .bind(submissionId, assessment.id, challengeId, candidateId, responseJson, now)
    .run();

  return c.json({
    success: true,
    challengeSubmissionId: submissionId,
  });
});

// ── POST /rpc/score-submission ──────────────────────────────────────────────

rpcAuth.post('/score-submission', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const challengeSubmissionId = body.challengeSubmissionId;
  if (typeof challengeSubmissionId !== 'string' || !challengeSubmissionId) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'challengeSubmissionId is required.' } },
      400,
    );
  }

  // Fetch submission + challenge
  const sub = await c.env.DB.prepare(`
    SELECT cs.id, cs.response_json, cs.assessment_id,
           ch.type, ch.server_config
    FROM challenge_submissions cs
    JOIN challenges ch ON ch.id = cs.challenge_id
    WHERE cs.id = ?1
  `)
    .bind(challengeSubmissionId)
    .first<{
      id: string;
      response_json: string | null;
      assessment_id: string;
      type: string;
      server_config: string | null;
    }>();

  if (!sub) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Submission not found.' } }, 404);
  }

  let score: number | null = null;
  let feedback: string | null = null;
  const now = new Date().toISOString();

  // Deterministic scoring for QUIZ_MCQ
  if (sub.type === 'QUIZ_MCQ') {
    let serverConfig: Record<string, unknown> = {};
    if (sub.server_config) {
      try {
        serverConfig = JSON.parse(sub.server_config) as Record<string, unknown>;
      } catch { /* empty config */ }
    }

    let response: Record<string, unknown> = {};
    if (sub.response_json) {
      try {
        response = JSON.parse(sub.response_json) as Record<string, unknown>;
      } catch { /* empty response */ }
    }

    const correctOptionId = serverConfig.correctOptionId as string | undefined;
    const answers = response.answers as Record<string, string> | undefined;
    const selectedAnswer = answers?.current;

    if (correctOptionId && selectedAnswer) {
      score = selectedAnswer === correctOptionId ? 100 : 0;
      feedback = score === 100 ? 'Correct answer' : `Incorrect. The correct answer was ${correctOptionId}`;
    } else {
      // No correct answer configured — score as 0
      score = 0;
      feedback = 'No scoring criteria configured for this challenge';
    }
  }

  // Update submission with score
  if (score !== null) {
    await c.env.DB.prepare(`
      UPDATE challenge_submissions
      SET score = ?1, feedback = ?2, scored_at = ?3, updated_at = ?3
      WHERE id = ?4
    `)
      .bind(score, feedback, now, challengeSubmissionId)
      .run();

    // Re-aggregate assessment score (average of all child submissions)
    await c.env.DB.prepare(`
      UPDATE assessments
      SET score = (
        SELECT AVG(score) FROM challenge_submissions
        WHERE assessment_id = ?1 AND score IS NOT NULL
      ), updated_at = ?2
      WHERE id = ?1
    `)
      .bind(sub.assessment_id, now)
      .run();
  }

  return c.json({
    success: true,
    score,
    feedback,
  });
});

// ── POST /rpc/submit-status ────────────────────────────────────────────────

rpcAuth.post('/submit-status', async (c) => {
  const candidateId = c.get('candidateId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const status = body.status;
  if (typeof status !== 'string' || !['COMPLETED', 'ABANDONED'].includes(status)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'status must be COMPLETED or ABANDONED.' } },
      400,
    );
  }

  const now = new Date().toISOString();

  // Update candidate status
  await c.env.DB.prepare(
    `UPDATE candidates SET status = ?1, updated_at = ?2 WHERE id = ?3`,
  )
    .bind(status, now, candidateId)
    .run();

  // Also update any in-progress assessments for this candidate
  await c.env.DB.prepare(
    `UPDATE assessments SET status = ?1, completed_at = ?2, updated_at = ?2
     WHERE candidate_id = ?3 AND status = 'IN_PROGRESS'`,
  )
    .bind(status, now, candidateId)
    .run();

  return c.json({ success: true });
});

// ── POST /rpc/upload-media ──────────────────────────────────────────────────
//
// Accepts a media file (audio or video) as multipart/form-data and writes it
// directly to R2. Returns the R2 key so the frontend can store it in the
// submission JSON.
//
// Field layout:
//   file        — the binary blob (Blob/File)
//   challengeId — string identifier for the challenge (used in R2 path)
//
// R2 path: candidate-submissions/{candidateId}/{challengeId}.webm
// Auth: candidate JWT (candidateId extracted from verified token)

/** Maximum accepted media file size: 50 MB. */
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

/** MIME type guard — only audio/* and video/* are accepted. */
function isMediaMime(mimeType: string): boolean {
  return /^(audio|video)\//.test(mimeType);
}

rpcAuth.post('/upload-media', async (c) => {
  const candidateId = c.get('candidateId');

  // Parse multipart/form-data
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Request must be multipart/form-data.' } },
      400,
    );
  }

  const fileEntry = formData.get('file');
  if (!(fileEntry instanceof File)) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'No "file" field found in the request.' } },
      400,
    );
  }

  const challengeIdEntry = formData.get('challengeId');
  if (typeof challengeIdEntry !== 'string' || !challengeIdEntry.trim()) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: '"challengeId" field is required.' } },
      400,
    );
  }
  const challengeId = challengeIdEntry.trim();

  // Validate MIME type — must be audio/* or video/*
  if (!isMediaMime(fileEntry.type)) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Only audio/* and video/* MIME types are accepted.',
        },
      },
      415,
    );
  }

  // Validate size
  if (fileEntry.size > MAX_MEDIA_BYTES) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'File exceeds the 50 MB limit.' } },
      413,
    );
  }

  // Derive extension from MIME — prefer .webm, fall back to subtype
  const mimeSubtype = fileEntry.type.split('/')[1] ?? 'webm';
  const ext = mimeSubtype.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'webm';
  const r2Key = `candidate-submissions/${candidateId}/${challengeId}.${ext}`;

  // Write to R2
  if (!c.env.STORAGE) {
    console.error('[rpc/upload-media] R2 STORAGE binding not configured');
    return c.json(
      { error: { code: 'SERVER_ERROR', message: 'Storage not configured.' } },
      503,
    );
  }
  const arrayBuffer = await fileEntry.arrayBuffer();
  await c.env.STORAGE.put(r2Key, arrayBuffer, {
    httpMetadata: { contentType: fileEntry.type },
    customMetadata: { candidateId, challengeId },
  });

  console.log('[rpc/upload-media] Stored media', { candidateId, challengeId, r2Key, size: fileEntry.size });

  // Auto-transcribe audio files via Workers AI Whisper (free, at-edge)
  let transcript: string | null = null;
  if (fileEntry.type.startsWith('audio/') && c.env.AI) {
    try {
      const result = await c.env.AI.run('@cf/openai/whisper' as Parameters<typeof c.env.AI.run>[0], {
        audio: [...new Uint8Array(arrayBuffer)],
      }) as { text?: string };
      transcript = result.text?.trim() || null;
      console.log('[rpc/upload-media] Whisper transcript:', transcript?.slice(0, 100));
    } catch (err) {
      console.error('[rpc/upload-media] Whisper transcription failed:', err);
    }
  }

  return c.json({ r2Key, uploadUrl: null, transcript }, 201);
});

// ── POST /rpc/get-scheduled-interview ──────────────────────────────────────

rpcAuth.post('/get-scheduled-interview', async (c) => {
  const candidateId = c.get('candidateId');
  const db = c.env.DB;

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const stageId = body['stageId'];
  if (!stageId || typeof stageId !== 'string') {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'stageId is required.' } }, 400);
  }

  const interview = await db
    .prepare(
      `SELECT id, candidate_id, pipeline_id, stage_id, status,
              scheduled_at, meeting_url, scheduling_provider, scheduling_url,
              created_at, updated_at
       FROM scheduled_interviews
       WHERE candidate_id = ? AND stage_id = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(candidateId, stageId)
    .first<{
      id: string;
      candidate_id: string;
      pipeline_id: string;
      stage_id: string;
      status: string;
      scheduled_at: string | null;
      meeting_url: string | null;
      scheduling_provider: string | null;
      scheduling_url: string | null;
      created_at: string;
      updated_at: string;
    }>();

  if (!interview) {
    return c.json({ interview: null });
  }

  return c.json({
    interview: {
      id: interview.id,
      candidateId: interview.candidate_id,
      pipelineId: interview.pipeline_id,
      stageId: interview.stage_id,
      status: interview.status,
      scheduledAt: interview.scheduled_at,
      meetingUrl: interview.meeting_url,
      schedulingProvider: interview.scheduling_provider,
      schedulingUrl: interview.scheduling_url,
      createdAt: interview.created_at,
      updatedAt: interview.updated_at,
    },
  });
});

// ─── Mount multi-turn review sub-router ─────────────────────────────────────

rpcAuth.route('/review', review);
rpcAuth.route('/repo', repo);
rpcAuth.route('/dev-container', devContainer);

// ─── Mount culture interview candidate sub-router ────────────────────────────
// Culture routes use path-param token auth (the session JWT is the :token URL
// param, not an Authorization header). Mount on rpcPublic so candidateAuth
// middleware doesn't intercept before the route handler reads its own token.
// Each handler calls verifyJwt internally. See screening/culture.ts.
rpcPublic.route('/culture', cultureCandidate);

export { rpcPublic, rpcAuth };
