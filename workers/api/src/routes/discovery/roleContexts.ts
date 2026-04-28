/**
 * Role Context Routes — Multi-Stakeholder Role Discovery (ADR-028)
 *
 * POST /api/v1/role-contexts                — Create with baseline + creator participant
 * GET  /api/v1/role-contexts/:id            — Retrieve full state + participants
 * POST /api/v1/role-contexts/:id/start      — Start interview (returns calibration question)
 * POST /api/v1/role-contexts/:id/respond    — Submit answer, get next question (per-participant)
 * POST /api/v1/role-contexts/:id/complete   — Force-complete a participant's interview
 * POST /api/v1/role-contexts/:id/invite     — Send interview invitations to team members
 * POST /api/v1/role-contexts/parse-jd       — Parse JD text or PDF into baseline
 * POST /api/v1/role-contexts/transcribe     — Whisper transcription for voice input
 * PATCH /api/v1/role-contexts/:id           — Link role context to a pipeline
 *
 * All routes require Clerk JWT auth. Ownership enforced on all mutations.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { createRoleContextSchema, respondSchema, inviteSchema, calibrateSchema, PARTICIPANT_ROLES } from '../../validation/roleContexts';
import { callRoleAgent, mergeKnowledgeState, callGapFillingAgent, type RoleAgentResponse } from '../../lib/roleAgent';
import { synthesizeRcd, type SynthesizeRcdResult } from '../../lib/roleAgent/synthesizeRcd';
import { decomposeRcdIntoNodes, persistRoleNodes } from '../../lib/roleAgent/decomposeRcd';
import { deriveJobDescriptionFromRcd } from '../../lib/roleAgent/deriveJobDescription';
import { calibrateRcd } from '../../lib/roleAgent/calibrateRcd';
import { buildConversationContext, buildPhaseDirective } from '../../lib/roleAgentPrompts';
import { createRoleAgentProvider, createRoleAgentFallbackProvider, createRoleAgentSynthesisProvider, createRoleAgentSynthesisFallbackProvider } from '../../lib/llm/createProvider';
import { recordAiUsage } from '../../lib/aiUsage';
import { parseJobDescription } from '../../lib/jdParser';
import { sendNotificationEmail } from '../../lib/email';
import { embedAndUpsertRole } from '../../lib/roleDiscovery/embedRole';
import { buildRoleSearchableProfile } from '../../lib/roleDiscovery/buildRoleProfile';
import { buildRcdSearchProfile } from '../../lib/repoDiscovery/rcdSearchProfile';
import type { Env, Variables, RoleContextRow, RoleContextParticipantRow, RoleExchange, ParticipantRole, RoleContextDocument } from '../../types';

export const roleContexts = new Hono<{ Bindings: Env; Variables: Variables }>();
roleContexts.use('*', authMiddleware);

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function parseJsonColumn<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Build a searchable profile from the role's job description + persona.
 * Best-effort: if embedding fails we log and move on — role discovery
 * must never block on the vector layer.
 */
export async function buildAndStoreRoleEmbedding(
  env: Env,
  roleContextId: string,
  jobDescription: string,
  persona: unknown,
): Promise<void> {
  // Step 0: read row to check for RCD (preferred) before falling back to JD+persona
  const rc = await env.DB.prepare('SELECT rcd_json FROM role_contexts WHERE id = ?')
    .bind(roleContextId)
    .first<{ rcd_json: string | null }>();

  let profile: string | null = null;

  if (rc?.rcd_json) {
    try {
      const rcd = JSON.parse(rc.rcd_json) as RoleContextDocument;
      profile = buildRcdSearchProfile(rcd);
    } catch {
      // ignore parse errors — fall through to legacy path
    }
  }

  if (!profile) {
    profile = buildRoleSearchableProfile(jobDescription, persona);
  }

  if (!profile || profile.trim().length < 50) {
    console.warn(`[roleContexts] skipping role embed for ${roleContextId}: profile too short`);
    return;
  }

  try {
    // Step 1: persist the searchable profile
    await env.DB.prepare(
      `UPDATE role_contexts SET role_searchable_profile = ?, updated_at = ? WHERE id = ?`,
    ).bind(profile, now(), roleContextId).run();

    // Step 2: read row back for metadata fields
    const rcRow = await env.DB.prepare('SELECT * FROM role_contexts WHERE id = ?')
      .bind(roleContextId)
      .first<RoleContextRow>();
    if (!rcRow) {
      console.warn(`[roleContexts] role context ${roleContextId} not found after profile update`);
      return;
    }

    // Step 3: build metadata (only non-null values)
    const metadata: Record<string, string | number | boolean> = {};
    if (rcRow.pipeline_id) metadata.pipeline_id = rcRow.pipeline_id;
    if (rcRow.rcd_json) {
      try {
        const rcd = JSON.parse(rcRow.rcd_json) as { technical_context?: { seniority_band?: string } };
        if (rcd.technical_context?.seniority_band) {
          metadata.seniority_band = rcd.technical_context.seniority_band;
        }
      } catch {
        // ignore parse errors
      }
    }

    // Step 4: embed and upsert via shared library
    await embedAndUpsertRole({
      ai: env.AI,
      vectorize: env.ROLE_INDEX,
      roleContextId: rcRow.id,
      profile,
      metadata,
      db: env.DB,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[roleContexts] role embed failed for ${roleContextId}:`, msg);
  }
}

/**
 * Run RCD synthesis across all participant transcripts for a role context.
 * Returns the RCD, derived persona, derived job description, and legacy synthesis string.
 */
async function runRcdSynthesis(
  env: Env,
  roleContextId: string,
  baseline: Record<string, unknown>,
): Promise<{ rcd: RoleContextDocument; persona: unknown; jobDescription: string; synthesis: string; issues: unknown[]; passed: boolean } | null> {
  const participantRows = await env.DB.prepare(
    'SELECT * FROM role_context_participants WHERE role_context_id = ?1 ORDER BY is_creator DESC, created_at ASC',
  )
    .bind(roleContextId)
    .all<RoleContextParticipantRow>();

  const participants = participantRows.results ?? [];
  if (participants.length === 0) return null;

  const stakeholderTranscripts = participants
    .filter((p) => p.participant_role && p.exchanges)
    .map((p) => ({
      stakeholder_type: p.participant_role as import('../../types').StakeholderType,
      interviewee_label: p.name || p.participant_role || 'Unknown',
      exchanges: parseJsonColumn<RoleExchange[]>(p.exchanges, []),
      knowledge_state: {},
    }));

  if (stakeholderTranscripts.length === 0) return null;

  const provider = createRoleAgentProvider(env);
  if (!provider) return null;

  try {
    const result = await synthesizeRcd({
      provider,
      roleContextId,
      pipelineId: (baseline.pipelineId as string | undefined) ?? '',
      baseline,
      stakeholderTranscripts,
    });

    const rcd = result.rcd;
    const persona = rcd.consumer_slice;
    const fallbackTitle = typeof baseline.title === 'string' ? baseline.title : '';
    const jobDescription = deriveJobDescriptionFromRcd(rcd, fallbackTitle);
    const synthesis = typeof persona.archetype === 'string' ? persona.archetype : '';

    return {
      rcd,
      persona,
      jobDescription,
      synthesis,
      issues: result.issues,
      passed: result.passed,
    };
  } catch (err) {
    console.error('[roleContexts] RCD synthesis failed:', err);
    return null;
  }
}



/**
 * Log role-discovery AI usage to ai_usage_events. Reads token counts from the
 * Vertex provider's `getLastUsage()` after a call. Safe to call even when the
 * provider is null, a non-Vertex provider, or the call errored — it just
 * writes whatever it knows, flipping `success=0` when appropriate.
 */
function logRoleAgentUsage(
  c: { env: Env; executionCtx: ExecutionContext },
  provider: ReturnType<typeof createRoleAgentProvider>,
  refs: { roleContextId: string; participantId: string },
  opts: { success: boolean; errorMessage?: string } = { success: true },
): void {
  if (!provider) return;
  // Duck-type: log usage for any provider that exposes getLastUsage() and getModelKey()
  const lastUsage = typeof (provider as unknown as Record<string, unknown>).getLastUsage === 'function'
    ? (provider as unknown as { getLastUsage(): import('../../lib/llm/types').LLMUsage | null }).getLastUsage()
    : null;
  if (!lastUsage && opts.success) return; // nothing to log

  const modelKey = typeof (provider as unknown as Record<string, unknown>).getModelKey === 'function'
    ? (provider as unknown as { getModelKey(): string }).getModelKey()
    : provider.name;

  recordAiUsage(c.env.DB, c.executionCtx, {
    feature: 'role_discovery',
    refId: refs.roleContextId,
    subRefId: refs.participantId,
    provider: provider.name,
    model: modelKey,
    usage: lastUsage ?? {},
    success: opts.success,
    ...(opts.errorMessage ? { errorMessage: opts.errorMessage } : {}),
  });
}

/** The hardcoded calibration question — always first, never agent-generated. */
function calibrationQuestion(): {
  acknowledgment: string;
  question: { id: string; text: string; input: { type: 'radio'; options: string[] } };
} {
  return {
    acknowledgment: "I'll help you build a detailed role profile. The more specific you are, the more targeted the assessments I can design. Let's start with one quick question.",
    question: {
      id: 'q-calibration',
      text: "What's your relationship to this role?",
      input: {
        type: 'radio' as const,
        options: ['Hiring Manager', 'Internal Recruiter', 'External Recruiter', 'Team Member'],
      },
    },
  };
}

/** Map calibration answer text to ParticipantRole enum value. */
function resolveParticipantRole(answer: string): ParticipantRole {
  const normalized = answer.trim().toUpperCase().replace(/\s+/g, '_');
  if ((PARTICIPANT_ROLES as readonly string[]).includes(normalized)) {
    return normalized as ParticipantRole;
  }
  // Fuzzy match
  if (answer.toLowerCase().includes('hiring')) return 'HIRING_MANAGER';
  if (answer.toLowerCase().includes('external')) return 'EXTERNAL_RECRUITER';
  if (answer.toLowerCase().includes('team')) return 'TEAM_MEMBER';
  return 'INTERNAL_RECRUITER';
}

// ─── POST / — Create role context with baseline + creator participant ───────

roleContexts.post('/', async (c) => {
  const userId = c.var.userId;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = createRoleContextSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const { baseline, questionBudget } = parsed.data;
  const id = generateId();
  const participantId = generateId();

  // Create role context + creator participant in a batch
  const batch = [
    c.env.DB.prepare(
      `INSERT INTO role_contexts (id, owner_id, baseline, question_budget, status)
       VALUES (?1, ?2, ?3, ?4, 'BASELINE')`,
    ).bind(id, userId, JSON.stringify(baseline), questionBudget),

    c.env.DB.prepare(
      `INSERT INTO role_context_participants (id, role_context_id, is_creator, question_budget, status)
       VALUES (?1, ?2, 1, ?3, 'PENDING')`,
    ).bind(participantId, id, questionBudget),
  ];

  await c.env.DB.batch(batch);

  return c.json(
    {
      id,
      participantId,
      status: 'BASELINE' as const,
      baseline,
      questionBudget,
      questionsAsked: 0,
    },
    201,
  );
});

// ─── POST /parse-jd — Parse JD text or PDF into baseline fields ─────────────

roleContexts.post('/parse-jd', async (c) => {
  const contentType = c.req.header('Content-Type') ?? '';
  const mock = c.env.MOCK_AI === 'true';

  // Multipart: file upload
  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const file = formData.get('file') as unknown as File | null;
    if (!file) {
      return apiError(c, 'VALIDATION_ERROR', 'No file provided.');
    }

    const buffer = await file.arrayBuffer();
    const parsed = await parseJobDescription({
      fileBuffer: buffer,
      contentType: file.type,
      env: c.env,
      mock,
    });

    if (!parsed) {
      return apiError(c, 'VALIDATION_ERROR', 'Could not parse the uploaded file.');
    }

    return c.json({ parsed });
  }

  // JSON: pasted text
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON or multipart form data.');
  }

  const text = (body as Record<string, unknown>)?.text;
  if (typeof text !== 'string' || text.trim().length < 20) {
    return apiError(c, 'VALIDATION_ERROR', 'text must be at least 20 characters.');
  }

  const parsed = await parseJobDescription({ text, env: c.env, mock });

  if (!parsed) {
    return apiError(c, 'INTERNAL_ERROR', 'Failed to parse job description.');
  }

  return c.json({ parsed });
});

// ─── POST /transcribe — Whisper transcription for voice input ───────────────

roleContexts.post('/transcribe', async (c) => {
  const contentType = c.req.header('Content-Type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return apiError(c, 'VALIDATION_ERROR', 'Expected multipart/form-data with an audio file.');
  }

  const formData = await c.req.formData();
  const file = formData.get('audio') as unknown as File | null;
  if (!file) {
    return apiError(c, 'VALIDATION_ERROR', 'No audio file provided.');
  }

  if (!c.env.AI) {
    return apiError(c, 'INTERNAL_ERROR', 'Workers AI not available.');
  }

  const buffer = await file.arrayBuffer();
  const audio = [...new Uint8Array(buffer)];

  async function runWhisper(): Promise<string | null> {
    const result = await c.env.AI.run(
      '@cf/openai/whisper' as Parameters<typeof c.env.AI.run>[0],
      { audio },
    ) as { text?: string };
    return result.text?.trim() || null;
  }

  let transcript: string | null = null;
  try {
    transcript = await runWhisper();
  } catch (err) {
    console.warn('[roleContexts/transcribe] Whisper attempt 1 failed, retrying:', err);
    // Single retry after short delay — error 1031 is transient upstream unavailability
    await new Promise((r) => setTimeout(r, 600));
    try {
      transcript = await runWhisper();
    } catch (retryErr) {
      console.error('[roleContexts/transcribe] Whisper failed after retry:', retryErr);
      return c.json({ error: 'Transcription temporarily unavailable. Please type your answer.' }, 503);
    }
  }

  console.log('[roleContexts/transcribe] Whisper result:', transcript?.slice(0, 100));
  return c.json({ transcript: transcript ?? '' });
});

// ─── GET /:id — Retrieve full state + participants ─────────────────────────

roleContexts.get('/:id', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  const row = await c.env.DB.prepare(
    'SELECT * FROM role_contexts WHERE id = ?1',
  )
    .bind(id)
    .first<RoleContextRow>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  // Fetch all participants
  const participantRows = await c.env.DB.prepare(
    'SELECT * FROM role_context_participants WHERE role_context_id = ?1 ORDER BY is_creator DESC, created_at ASC',
  )
    .bind(id)
    .all<RoleContextParticipantRow>();

  const participants = (participantRows.results ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    participantRole: p.participant_role,
    isCreator: p.is_creator === 1,
    questionsAsked: p.questions_asked,
    questionBudget: p.question_budget,
    status: p.status,
    exchanges: parseJsonColumn<RoleExchange[]>(p.exchanges, []),
  }));

  const baseline = parseJsonColumn<Record<string, unknown>>(row.baseline, {});
  const knowledgeState = parseJsonColumn<Record<string, unknown>>(row.knowledge_state, {});
  // Legacy: exchanges on role_contexts for backward compat during migration
  const exchanges = parseJsonColumn<RoleExchange[]>(row.exchanges, []);

  // Phase 0.1: read RCD consumer_slice primary, fall back to legacy persona_json.
  let persona: unknown = null;
  if (row.rcd_json) {
    try {
      const rcd = JSON.parse(row.rcd_json) as { consumer_slice?: unknown };
      persona = rcd.consumer_slice ?? null;
    } catch { /* fall through */ }
  }
  if (!persona && row.persona_json) {
    persona = parseJsonColumn(row.persona_json, null);
  }
  const jobDescription = row.job_description_md ?? null;

  return c.json({
    id: row.id,
    pipelineId: row.pipeline_id,
    status: row.status,
    baseline,
    knowledgeState,
    exchanges,
    persona,
    jobDescription,
    questionBudget: row.question_budget,
    questionsAsked: row.questions_asked,
    participants,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

// ─── POST /:id/start — Begin interview (calibration question) ──────────────

roleContexts.post('/:id/start', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  let body: { participantId?: string } = {};
  try {
    body = (await c.req.json()) as { participantId?: string };
  } catch {
    // No body is fine — will use creator participant
  }

  const row = await c.env.DB.prepare(
    'SELECT * FROM role_contexts WHERE id = ?1',
  )
    .bind(id)
    .first<RoleContextRow>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  // Find participant — either by explicit ID or the creator
  let participant: RoleContextParticipantRow | null;
  if (body.participantId) {
    participant = await c.env.DB.prepare(
      'SELECT * FROM role_context_participants WHERE id = ?1 AND role_context_id = ?2',
    )
      .bind(body.participantId, id)
      .first<RoleContextParticipantRow>();
  } else {
    participant = await c.env.DB.prepare(
      'SELECT * FROM role_context_participants WHERE role_context_id = ?1 AND is_creator = 1',
    )
      .bind(id)
      .first<RoleContextParticipantRow>();
  }

  if (!participant) {
    return apiError(c, 'NOT_FOUND', 'Participant not found.');
  }
  if (participant.status !== 'PENDING' && participant.status !== 'INVITED') {
    return apiError(c, 'VALIDATION_ERROR', `Cannot start interview from participant status '${participant.status}'.`);
  }

  // Return the hardcoded calibration question
  const cal = calibrationQuestion();

  // Store calibration exchange on the participant
  const exchange: RoleExchange = {
    questionId: cal.question.id,
    acknowledgment: cal.acknowledgment,
    question: cal.question.text,
    input: cal.question.input,
  };

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE role_context_participants
       SET status = 'CALIBRATING', exchanges = ?1, updated_at = ?2
       WHERE id = ?3`,
    ).bind(JSON.stringify([exchange]), now(), participant.id),

    // Transition role_contexts to INTERVIEWING if still BASELINE
    c.env.DB.prepare(
      `UPDATE role_contexts
       SET status = CASE WHEN status = 'BASELINE' THEN 'INTERVIEWING' ELSE status END,
           updated_at = ?1
       WHERE id = ?2`,
    ).bind(now(), id),
  ]);

  return c.json({
    participantId: participant.id,
    acknowledgment: cal.acknowledgment,
    question: cal.question,
    progress: {
      asked: 0,
      budget: participant.question_budget,
      domains: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
    },
    status: 'CALIBRATING' as const,
  });
});

// ─── POST /:id/respond — Submit answer, get next question ───────────────────

roleContexts.post('/:id/respond', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = respondSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const { answer, questionId } = parsed.data;
  const participantId = (body as Record<string, unknown>)?.participantId;
  if (typeof participantId !== 'string') {
    return apiError(c, 'VALIDATION_ERROR', 'participantId is required.');
  }

  // Fetch role context and participant in parallel — independent queries.
  const [row, participant] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM role_contexts WHERE id = ?1')
      .bind(id)
      .first<RoleContextRow>(),
    c.env.DB.prepare(
      'SELECT * FROM role_context_participants WHERE id = ?1 AND role_context_id = ?2',
    )
      .bind(participantId, id)
      .first<RoleContextParticipantRow>(),
  ]);

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  if (!participant) {
    return apiError(c, 'NOT_FOUND', 'Participant not found.');
  }
  if (participant.status !== 'CALIBRATING' && participant.status !== 'INTERVIEWING') {
    return apiError(c, 'VALIDATION_ERROR', `Cannot respond in participant status '${participant.status}'.`);
  }

  const exchanges = parseJsonColumn<RoleExchange[]>(participant.exchanges, []);

  // Validate questionId matches the current (last) exchange
  const lastExchange = exchanges[exchanges.length - 1];
  if (!lastExchange || lastExchange.questionId !== questionId) {
    return apiError(c, 'VALIDATION_ERROR', `questionId '${questionId}' does not match the current question.`);
  }
  lastExchange.answer = answer;

  // ── Shared setup (used by both calibration and normal paths) ──
  const baseline = parseJsonColumn<Record<string, unknown>>(row.baseline, {});
  const sharedKnowledgeState = parseJsonColumn<Record<string, Record<string, unknown>>>(row.knowledge_state, {});
  const provider = createRoleAgentProvider(c.env);
  const fallbackProvider = createRoleAgentFallbackProvider(c.env);
  const synthesisProvider = createRoleAgentSynthesisProvider(c.env);
  const synthesisFallbackProvider = createRoleAgentSynthesisFallbackProvider(c.env);

  // ── Streaming path: SSE for real-time token delivery ──
  // Must be checked BEFORE the calibration block so that calibration answers
  // are returned as SSE events when the client requests streaming. Previously
  // the calibration block returned JSON unconditionally, which caused postStream
  // on the client to receive JSON it couldn't parse as SSE, silently discard the
  // response, and leave the calibration question visible — triggering a second
  // submission that hit the "questionId does not match" error on the server.
  const acceptHeader = c.req.header('Accept');
  console.log('[roleContexts] Accept header:', acceptHeader);
  if (acceptHeader === 'text/event-stream') {
    const response = streamSSE(c, async (stream) => {
      try {
        // ── Calibration in streaming path ──
        if (questionId === 'q-calibration') {
          const participantRole = resolveParticipantRole(answer);
          const calAgentResponse = await callRoleAgent({
            provider,
            fallbackProvider,
            synthesisProvider,
            synthesisFallbackProvider,
            baseline,
            exchanges: [],
            knowledgeState: sharedKnowledgeState,
            questionsAsked: 0,
            questionBudget: participant.question_budget,
            participantRole,
          });
          logRoleAgentUsage(c, provider, { roleContextId: id, participantId: participant.id });
          if (calAgentResponse.type !== 'question') {
            await stream.writeSSE({ event: 'error', data: 'Agent did not return a question for the opening turn.' });
            return;
          }
          const calExchange: RoleExchange = {
            questionId: calAgentResponse.question.id,
            acknowledgment: calAgentResponse.acknowledgment,
            question: calAgentResponse.question.text,
            input: calAgentResponse.question.input,
          };
          exchanges.push(calExchange);
          await c.env.DB.prepare(
            `UPDATE role_context_participants
             SET participant_role = ?1, status = 'INTERVIEWING', exchanges = ?2, updated_at = ?3
             WHERE id = ?4`,
          ).bind(participantRole, JSON.stringify(exchanges), now(), participant.id).run();
          await stream.writeSSE({
            event: 'done',
            data: JSON.stringify({
              participantId: participant.id,
              participantRole,
              acknowledgment: calAgentResponse.acknowledgment,
              question: calAgentResponse.question,
              progress: { asked: 0, budget: participant.question_budget, domains: calAgentResponse.domainCoverage },
              status: 'INTERVIEWING' as const,
              toolsUsed: calAgentResponse.toolsUsed,
            }),
          });
          return;
        }

        // ── Normal question in streaming path ──
        const questionsAsked = participant.questions_asked + 1;
        const budgetExhausted = questionsAsked >= participant.question_budget;
        const agentExchanges = exchanges.filter((ex) => ex.questionId !== 'q-calibration');
        const previousCoverage = (sharedKnowledgeState as Record<string, unknown>)['_coverage'] as Record<string, string> | undefined;
        const conversationContext = buildConversationContext(sharedKnowledgeState as Record<string, unknown>, agentExchanges);
        const phaseDirective = buildPhaseDirective(conversationContext, questionsAsked, participant.question_budget);
        (sharedKnowledgeState as Record<string, unknown>)['_phase'] = phaseDirective;
        const agentInput = {
          provider,
          fallbackProvider,
          synthesisProvider,
          synthesisFallbackProvider,
          baseline,
          exchanges: agentExchanges,
          knowledgeState: sharedKnowledgeState,
          questionsAsked,
          questionBudget: participant.question_budget,
          phaseDirective,
          conversationContext,
          ...(previousCoverage ? { domainCoverage: previousCoverage } : {}),
          ...(participant.participant_role ? { participantRole: participant.participant_role } : {}),
        };

        const agentResponse = await callRoleAgent(agentInput);
        const activeProvider = budgetExhausted ? (synthesisProvider ?? provider) : provider;
        logRoleAgentUsage(c, activeProvider, { roleContextId: id, participantId: participant.id });

        const updatedKnowledgeState = mergeKnowledgeState(sharedKnowledgeState, agentResponse.knowledgeStateUpdate);
        (updatedKnowledgeState as Record<string, unknown>)['_coverage'] = agentResponse.domainCoverage;

        if (agentResponse.type === 'synthesis' || budgetExhausted) {
          // Path B: RCD synthesis replaces inline agent synthesis
          const rcdResult = await runRcdSynthesis(c.env, id, baseline);

          const synthesis = rcdResult?.synthesis ?? (agentResponse.type === 'synthesis' ? agentResponse.synthesis : '');
          const persona = rcdResult?.persona ?? (agentResponse.type === 'synthesis' ? agentResponse.persona : null);
          const jobDescription = rcdResult?.jobDescription ?? (agentResponse.type === 'synthesis' ? agentResponse.jobDescription : '');
          const rcd = rcdResult?.rcd ?? null;

          await c.env.DB.batch([
            c.env.DB.prepare(
              `UPDATE role_context_participants
               SET status = 'COMPLETE', exchanges = ?1, questions_asked = ?2, updated_at = ?3
               WHERE id = ?4`,
            ).bind(JSON.stringify(exchanges), questionsAsked, now(), participant.id),
            c.env.DB.prepare(
              `UPDATE role_contexts
               SET knowledge_state = ?1,
                   questions_asked = questions_asked + ?2,
                   persona_json = ?3,
                   job_description_md = ?4,
                   rcd_json = ?5,
                   validation_metadata = ?6,
                   updated_at = ?7
               WHERE id = ?8`,
            ).bind(
              JSON.stringify(updatedKnowledgeState),
              questionsAsked,
              persona ? JSON.stringify(persona) : null,
              jobDescription || null,
              rcd ? JSON.stringify(rcd) : null,
              rcd ? JSON.stringify(rcd.validation_metadata) : null,
              now(),
              id,
            ),
          ]);

          if (rcd) {
            try {
              const nodes = decomposeRcdIntoNodes(rcd, id);
              await persistRoleNodes(nodes, c.env, c.env.DB);
            } catch (decompErr) {
              const msg = decompErr instanceof Error ? decompErr.message : String(decompErr);
              console.error('[roleContexts] RCD decomposition failed:', msg);
            }
          }

          const incomplete = await c.env.DB.prepare(
            `SELECT COUNT(*) as cnt FROM role_context_participants
             WHERE role_context_id = ?1 AND status != 'COMPLETE'`,
          )
            .bind(id)
            .first<{ cnt: number }>();

          if (incomplete && incomplete.cnt === 0) {
            await c.env.DB.prepare(
              `UPDATE role_contexts SET status = 'COMPLETE', updated_at = ?1 WHERE id = ?2`,
            )
              .bind(now(), id)
              .run();
          }

          // Best-effort role embedding (fire-and-forget inside SSE)
          buildAndStoreRoleEmbedding(c.env, id, jobDescription, persona).catch(() => {});

          await stream.writeSSE({
            event: 'done',
            data: JSON.stringify({
              participantId: participant.id,
              synthesis,
              persona,
              jobDescription,
              rcd: rcd ? JSON.parse(JSON.stringify(rcd)) : null,
              knowledgeState: updatedKnowledgeState,
              progress: {
                asked: questionsAsked,
                budget: participant.question_budget,
                domains: agentResponse.domainCoverage,
              },
            }),
          });
        } else if (agentResponse.type === 'question') {
          // Question response — append new exchange before persisting
          const newExchange: RoleExchange = {
            questionId: agentResponse.question.id,
            acknowledgment: agentResponse.acknowledgment,
            question: agentResponse.question.text,
            input: agentResponse.question.input,
          };
          exchanges.push(newExchange);

          await c.env.DB.batch([
            c.env.DB.prepare(
              `UPDATE role_context_participants
               SET exchanges = ?1, questions_asked = ?2, updated_at = ?3
               WHERE id = ?4`,
            ).bind(JSON.stringify(exchanges), questionsAsked, now(), participant.id),
            c.env.DB.prepare(
              `UPDATE role_contexts SET knowledge_state = ?1, updated_at = ?2 WHERE id = ?3`,
            ).bind(JSON.stringify(updatedKnowledgeState), now(), id),
          ]);

          await stream.writeSSE({
            event: 'done',
            data: JSON.stringify({
              participantId: participant.id,
              acknowledgment: agentResponse.acknowledgment,
              question: agentResponse.question,
              knowledgeState: updatedKnowledgeState,
              progress: {
                asked: questionsAsked,
                budget: participant.question_budget,
                domains: agentResponse.domainCoverage,
              },
            }),
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[roleContexts/respond] Streaming error:', msg);
        await stream.writeSSE({ event: 'error', data: msg });
      }
    });
    response.headers.set('Content-Type', 'text/event-stream; charset=utf-8');
    return response;
  }

  // ── Non-streaming: calibration ──
  if (questionId === 'q-calibration') {
    const participantRole = resolveParticipantRole(answer);

    let agentResponse;
    try {
      agentResponse = await callRoleAgent({
        provider,
        fallbackProvider,
        synthesisProvider,
        synthesisFallbackProvider,
        baseline,
        exchanges: [],
        knowledgeState: sharedKnowledgeState,
        questionsAsked: 0,
        questionBudget: participant.question_budget,
        participantRole,
      });
    } catch (err) {
      logRoleAgentUsage(c, provider, { roleContextId: id, participantId: participant.id }, { success: false, errorMessage: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    logRoleAgentUsage(c, provider, { roleContextId: id, participantId: participant.id });

    if (agentResponse.type !== 'question') {
      return apiError(c, 'INTERNAL_ERROR', 'Agent did not return a question for the opening turn.');
    }

    const newExchange: RoleExchange = {
      questionId: agentResponse.question.id,
      acknowledgment: agentResponse.acknowledgment,
      question: agentResponse.question.text,
      input: agentResponse.question.input,
    };
    exchanges.push(newExchange);

    await c.env.DB.prepare(
      `UPDATE role_context_participants
       SET participant_role = ?1, status = 'INTERVIEWING', exchanges = ?2, updated_at = ?3
       WHERE id = ?4`,
    )
      .bind(participantRole, JSON.stringify(exchanges), now(), participant.id)
      .run();

    return c.json({
      participantId: participant.id,
      participantRole,
      acknowledgment: agentResponse.acknowledgment,
      question: agentResponse.question,
      progress: {
        asked: 0,
        budget: participant.question_budget,
        domains: agentResponse.domainCoverage,
      },
      status: 'INTERVIEWING' as const,
      toolsUsed: agentResponse.toolsUsed,
    });
  }

  // ── Non-streaming: normal interview response ──
  const questionsAsked = participant.questions_asked + 1;
  const budgetExhausted = questionsAsked >= participant.question_budget;

  // Filter exchanges: only answered ones for the agent (skip calibration)
  const agentExchanges = exchanges.filter((ex) => ex.questionId !== 'q-calibration');

  // Extract previous domain coverage from knowledge state (stored on prior turn)
  const previousCoverage = (sharedKnowledgeState as Record<string, unknown>)['_coverage'] as Record<string, string> | undefined;

  // RD-P5: build conversation context and phase directive (deterministic, no LLM call)
  const conversationContext = buildConversationContext(sharedKnowledgeState as Record<string, unknown>, agentExchanges);
  const phaseDirective = buildPhaseDirective(conversationContext, questionsAsked, participant.question_budget);
  (sharedKnowledgeState as Record<string, unknown>)['_phase'] = phaseDirective;

  const agentInput = {
    provider,
    fallbackProvider,
    synthesisProvider,
    synthesisFallbackProvider,
    baseline,
    exchanges: agentExchanges,
    knowledgeState: sharedKnowledgeState,
    questionsAsked,
    questionBudget: participant.question_budget,
    phaseDirective,
    conversationContext,
    ...(previousCoverage ? { domainCoverage: previousCoverage } : {}),
    ...(participant.participant_role ? { participantRole: participant.participant_role } : {}),
  };

  let agentResponse;
  try {
    agentResponse = await callRoleAgent(agentInput);
  } catch (err) {
    const activeProvider = budgetExhausted ? (synthesisProvider ?? provider) : provider;
    logRoleAgentUsage(c, activeProvider, { roleContextId: id, participantId: participant.id }, { success: false, errorMessage: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  const activeProvider = budgetExhausted ? (synthesisProvider ?? provider) : provider;
  logRoleAgentUsage(c, activeProvider, { roleContextId: id, participantId: participant.id });

  const updatedKnowledgeState = mergeKnowledgeState(sharedKnowledgeState, agentResponse.knowledgeStateUpdate);
  // Persist domain coverage so the agent receives it on the next turn
  (updatedKnowledgeState as Record<string, unknown>)['_coverage'] = agentResponse.domainCoverage;

  if (agentResponse.type === 'synthesis' || budgetExhausted) {
    // Path B: RCD synthesis replaces inline agent synthesis
    const rcdResult = await runRcdSynthesis(c.env, id, baseline);

    const synthesis = rcdResult?.synthesis ?? (agentResponse.type === 'synthesis' ? agentResponse.synthesis : '');
    const persona = rcdResult?.persona ?? (agentResponse.type === 'synthesis' ? agentResponse.persona : null);
    const jobDescription = rcdResult?.jobDescription ?? (agentResponse.type === 'synthesis' ? agentResponse.jobDescription : '');
    const rcd = rcdResult?.rcd ?? null;

    // Update participant as complete + merge knowledge state into shared +
    // persist persona/JD/RCD on the role_contexts row (shared across stakeholders).
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE role_context_participants
         SET status = 'COMPLETE', exchanges = ?1, questions_asked = ?2, updated_at = ?3
         WHERE id = ?4`,
      ).bind(JSON.stringify(exchanges), questionsAsked, now(), participant.id),

      c.env.DB.prepare(
        `UPDATE role_contexts
         SET knowledge_state = ?1,
             questions_asked = questions_asked + ?2,
             persona_json = ?3,
             job_description_md = ?4,
             rcd_json = ?5,
             validation_metadata = ?6,
             updated_at = ?7
         WHERE id = ?8`,
      ).bind(
        JSON.stringify(updatedKnowledgeState),
        questionsAsked,
        persona ? JSON.stringify(persona) : null,
        jobDescription || null,
        rcd ? JSON.stringify(rcd) : null,
        rcd ? JSON.stringify(rcd.validation_metadata) : null,
        now(),
        id,
      ),
    ]);

    if (rcd) {
      try {
        const nodes = decomposeRcdIntoNodes(rcd, id);
        await persistRoleNodes(nodes, c.env, c.env.DB);
      } catch (decompErr) {
        const msg = decompErr instanceof Error ? decompErr.message : String(decompErr);
        console.error('[roleContexts] RCD decomposition failed:', msg);
      }
    }

    // Check if all participants are complete → mark role context COMPLETE
    const incomplete = await c.env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM role_context_participants
       WHERE role_context_id = ?1 AND status != 'COMPLETE'`,
    )
      .bind(id)
      .first<{ cnt: number }>();

    if (incomplete && incomplete.cnt === 0) {
      await c.env.DB.prepare(
        `UPDATE role_contexts SET status = 'COMPLETE', updated_at = ?1 WHERE id = ?2`,
      )
        .bind(now(), id)
        .run();
    }

    // Best-effort role embedding
    c.executionCtx.waitUntil(
      buildAndStoreRoleEmbedding(c.env, id, jobDescription, persona),
    );

    return c.json({
      participantId: participant.id,
      synthesis,
      persona,
      jobDescription,
      rcd: rcd ? JSON.parse(JSON.stringify(rcd)) : null,
      knowledgeState: updatedKnowledgeState,
      progress: {
        asked: questionsAsked,
        budget: participant.question_budget,
        domains: agentResponse.domainCoverage,
      },
      status: 'COMPLETE' as const,
    });
  }

  // Mid-interview — append new exchange
  const newExchange: RoleExchange = {
    questionId: agentResponse.question.id,
    acknowledgment: agentResponse.acknowledgment,
    question: agentResponse.question.text,
    input: agentResponse.question.input,
  };
  exchanges.push(newExchange);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE role_context_participants
       SET exchanges = ?1, questions_asked = ?2, updated_at = ?3
       WHERE id = ?4`,
    ).bind(JSON.stringify(exchanges), questionsAsked, now(), participant.id),

    // Keep shared knowledge state updated incrementally
    c.env.DB.prepare(
      `UPDATE role_contexts
       SET knowledge_state = ?1, updated_at = ?2
       WHERE id = ?3`,
    ).bind(JSON.stringify(updatedKnowledgeState), now(), id),
  ]);

  return c.json({
    participantId: participant.id,
    acknowledgment: agentResponse.acknowledgment,
    question: agentResponse.question,
    progress: {
      asked: questionsAsked,
      budget: participant.question_budget,
      domains: agentResponse.domainCoverage,
    },
    status: 'INTERVIEWING' as const,
    toolsUsed: agentResponse.toolsUsed,
  });
});

// ─── POST /:id/complete — Force-complete a participant's interview ──────────

roleContexts.post('/:id/complete', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  let body: { participantId?: string } = {};
  try {
    body = (await c.req.json()) as { participantId?: string };
  } catch {
    // No body
  }

  const row = await c.env.DB.prepare(
    'SELECT * FROM role_contexts WHERE id = ?1',
  )
    .bind(id)
    .first<RoleContextRow>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  // Find participant
  let participant: RoleContextParticipantRow | null;
  if (body.participantId) {
    participant = await c.env.DB.prepare(
      'SELECT * FROM role_context_participants WHERE id = ?1 AND role_context_id = ?2',
    )
      .bind(body.participantId, id)
      .first<RoleContextParticipantRow>();
  } else {
    participant = await c.env.DB.prepare(
      'SELECT * FROM role_context_participants WHERE role_context_id = ?1 AND is_creator = 1',
    )
      .bind(id)
      .first<RoleContextParticipantRow>();
  }

  if (!participant) {
    return apiError(c, 'NOT_FOUND', 'Participant not found.');
  }
  if (participant.status !== 'INTERVIEWING') {
    return apiError(c, 'VALIDATION_ERROR', `Cannot complete from participant status '${participant.status}'.`);
  }

  const baseline = parseJsonColumn<Record<string, unknown>>(row.baseline, {});
  const exchanges = parseJsonColumn<RoleExchange[]>(participant.exchanges, []);
  const sharedKnowledgeState = parseJsonColumn<Record<string, Record<string, unknown>>>(row.knowledge_state, {});
  const agentExchanges = exchanges.filter((ex) => ex.questionId !== 'q-calibration');

  const provider = createRoleAgentProvider(c.env);
  const fallbackProvider = createRoleAgentFallbackProvider(c.env);
  const synthesisProvider = createRoleAgentSynthesisProvider(c.env);
  const synthesisFallbackProvider = createRoleAgentSynthesisFallbackProvider(c.env);
  let agentResponse;
  try {
    agentResponse = await callRoleAgent({
      provider,
      fallbackProvider,
      synthesisProvider,
      synthesisFallbackProvider,
      baseline,
      exchanges: agentExchanges,
      knowledgeState: sharedKnowledgeState,
      questionsAsked: participant.question_budget, // Force budget-exhausted
      questionBudget: participant.question_budget,
      ...(participant.participant_role ? { participantRole: participant.participant_role } : {}),
    });
  } catch (err) {
    logRoleAgentUsage(c, synthesisProvider ?? provider, { roleContextId: id, participantId: participant.id }, { success: false, errorMessage: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  logRoleAgentUsage(c, synthesisProvider ?? provider, { roleContextId: id, participantId: participant.id });

  const updatedKnowledgeState = mergeKnowledgeState(sharedKnowledgeState, agentResponse.knowledgeStateUpdate);

  // Path B: RCD synthesis replaces inline agent synthesis
  const rcdResult = await runRcdSynthesis(c.env, id, baseline);
  const synthesis = rcdResult?.synthesis ?? (agentResponse.type === 'synthesis' ? agentResponse.synthesis : '');
  const persona = rcdResult?.persona ?? (agentResponse.type === 'synthesis' ? agentResponse.persona : null);
  const jobDescription = rcdResult?.jobDescription ?? (agentResponse.type === 'synthesis' ? agentResponse.jobDescription : '');
  const rcd = rcdResult?.rcd ?? null;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE role_context_participants
       SET status = 'COMPLETE', updated_at = ?1
       WHERE id = ?2`,
    ).bind(now(), participant.id),

    c.env.DB.prepare(
      `UPDATE role_contexts
       SET knowledge_state = ?1,
           persona_json = ?2,
           job_description_md = ?3,
           rcd_json = ?4,
           validation_metadata = ?5,
           updated_at = ?6
       WHERE id = ?7`,
    ).bind(
      JSON.stringify(updatedKnowledgeState),
      persona ? JSON.stringify(persona) : null,
      jobDescription || null,
      rcd ? JSON.stringify(rcd) : null,
      rcd ? JSON.stringify(rcd.validation_metadata) : null,
      now(),
      id,
    ),
  ]);

  if (rcd) {
    try {
      const nodes = decomposeRcdIntoNodes(rcd, id);
      await persistRoleNodes(nodes, c.env, c.env.DB);
    } catch (decompErr) {
      const msg = decompErr instanceof Error ? decompErr.message : String(decompErr);
      console.error('[roleContexts] RCD decomposition failed:', msg);
    }
  }

  // Check if all complete
  const incomplete = await c.env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM role_context_participants
     WHERE role_context_id = ?1 AND status != 'COMPLETE'`,
  )
    .bind(id)
    .first<{ cnt: number }>();

  if (incomplete && incomplete.cnt === 0) {
    await c.env.DB.prepare(
      `UPDATE role_contexts SET status = 'COMPLETE', updated_at = ?1 WHERE id = ?2`,
    )
      .bind(now(), id)
      .run();
  }

  // Best-effort role embedding
  c.executionCtx.waitUntil(
    buildAndStoreRoleEmbedding(c.env, id, jobDescription, persona),
  );

  return c.json({
    participantId: participant.id,
    synthesis,
    persona,
    jobDescription,
    rcd: rcd ? JSON.parse(JSON.stringify(rcd)) : null,
    knowledgeState: updatedKnowledgeState,
    progress: {
      asked: participant.questions_asked,
      budget: participant.question_budget,
      domains: agentResponse.domainCoverage,
    },
    status: 'COMPLETE' as const,
  });
});

// ─── POST /:id/feedback — Flag a question with feedback for prompt tuning ────

roleContexts.post('/:id/feedback', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const { participantId, questionId, feedback } = body as Record<string, unknown>;
  if (typeof participantId !== 'string') {
    return apiError(c, 'VALIDATION_ERROR', 'participantId is required.');
  }
  if (typeof questionId !== 'string') {
    return apiError(c, 'VALIDATION_ERROR', 'questionId is required.');
  }
  if (typeof feedback !== 'string' || feedback.trim().length === 0) {
    return apiError(c, 'VALIDATION_ERROR', 'feedback must be a non-empty string.');
  }

  const row = await c.env.DB.prepare(
    'SELECT owner_id FROM role_contexts WHERE id = ?1',
  )
    .bind(id)
    .first<{ owner_id: string }>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  const participant = await c.env.DB.prepare(
    'SELECT id, exchanges FROM role_context_participants WHERE id = ?1 AND role_context_id = ?2',
  )
    .bind(participantId, id)
    .first<{ id: string; exchanges: string | null }>();

  if (!participant) {
    return apiError(c, 'NOT_FOUND', 'Participant not found.');
  }

  const exchanges = parseJsonColumn<RoleExchange[]>(participant.exchanges, []);
  const exchange = exchanges.find((ex) => ex.questionId === questionId);
  if (!exchange) {
    return apiError(c, 'NOT_FOUND', `Exchange with questionId '${questionId}' not found.`);
  }

  exchange.feedback = feedback.trim();

  await c.env.DB.prepare(
    'UPDATE role_context_participants SET exchanges = ?1, updated_at = ?2 WHERE id = ?3',
  )
    .bind(JSON.stringify(exchanges), now(), participant.id)
    .run();

  return c.json({ success: true });
});

// ─── POST /:id/calibrate — Recruiter flags a gap, get a clarifying question ──

roleContexts.post('/:id/calibrate', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = calibrateSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const { participantId, flagType, domain, attribute, note } = parsed.data;

  const row = await c.env.DB.prepare(
    'SELECT * FROM role_contexts WHERE id = ?1',
  )
    .bind(id)
    .first<RoleContextRow>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  const participant = await c.env.DB.prepare(
    'SELECT * FROM role_context_participants WHERE id = ?1 AND role_context_id = ?2',
  )
    .bind(participantId, id)
    .first<RoleContextParticipantRow>();

  if (!participant) {
    return apiError(c, 'NOT_FOUND', 'Participant not found.');
  }

  const rcd = row.rcd_json
    ? parseJsonColumn<RoleContextDocument | null>(row.rcd_json, null)
    : null;

  const exchanges = parseJsonColumn<RoleExchange[]>(participant.exchanges, []);
  const transcript = exchanges
    .map((ex) => `Q: ${ex.question}\nA: ${ex.answer ?? '(no answer)'}`)
    .join('\n\n');

  const provider = createRoleAgentProvider(c.env);
  const gapResult = await callGapFillingAgent({
    provider,
    rcd: (rcd ?? {}) as unknown as Record<string, unknown>,
    flagType,
    domain,
    attribute,
    recruiterNote: note ?? '',
    transcript,
  });

  return c.json({
    clarifyingQuestion: gapResult.clarifyingQuestion,
    domain,
    attribute,
  });
});

// ─── POST /:id/calibrate/respond — Gap-filling answer, re-synthesize domain ──

roleContexts.post('/:id/calibrate/respond', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const b = body as Record<string, unknown>;
  const participantId = typeof b.participantId === 'string' ? b.participantId : '';
  const answer = typeof b.answer === 'string' ? b.answer : '';
  const domain = typeof b.domain === 'string' ? b.domain : '';
  const attribute = typeof b.attribute === 'string' ? b.attribute : '';
  const flagType = typeof b.flagType === 'string' ? b.flagType : '';
  const note = typeof b.note === 'string' ? b.note : '';

  if (!participantId || !answer || !domain || !attribute) {
    return apiError(c, 'VALIDATION_ERROR', 'participantId, answer, domain, and attribute are required.');
  }

  const row = await c.env.DB.prepare(
    'SELECT * FROM role_contexts WHERE id = ?1',
  )
    .bind(id)
    .first<RoleContextRow>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  const participant = await c.env.DB.prepare(
    'SELECT * FROM role_context_participants WHERE id = ?1 AND role_context_id = ?2',
  )
    .bind(participantId, id)
    .first<RoleContextParticipantRow>();

  if (!participant) {
    return apiError(c, 'NOT_FOUND', 'Participant not found.');
  }

  const rcd = row.rcd_json
    ? parseJsonColumn<RoleContextDocument | null>(row.rcd_json, null)
    : null;

  if (!rcd) {
    return apiError(c, 'VALIDATION_ERROR', 'No RCD exists for this role context. Complete an interview first.');
  }

  const exchanges = parseJsonColumn<RoleExchange[]>(participant.exchanges, []);
  const transcript = exchanges
    .map((ex) => `Q: ${ex.question}\nA: ${ex.answer ?? '(no answer)'}`)
    .join('\n\n');

  const provider = createRoleAgentProvider(c.env);
  const calibrationResult = await calibrateRcd({
    provider,
    rcd: rcd as import('../../types').RoleContextDocument,
    flagType,
    domain: domain as import('../../types').Domain,
    attribute,
    recruiterNote: note,
    transcript,
    answer,
    stakeholder: (participant.participant_role as import('../../types').StakeholderType) ?? 'HIRING_MANAGER',
  });

  const baselineForCalibrate = parseJsonColumn<Record<string, unknown>>(row.baseline, {});
  const updatedRcd = calibrationResult.rcd;
  const persona = updatedRcd.consumer_slice;
  const fallbackTitle = typeof baselineForCalibrate.title === 'string' ? baselineForCalibrate.title : '';
  const jobDescription = deriveJobDescriptionFromRcd(updatedRcd, fallbackTitle);

  await c.env.DB.prepare(
    `UPDATE role_contexts
     SET rcd_json = ?1,
         validation_metadata = ?2,
         persona_json = ?3,
         job_description_md = ?4,
         updated_at = ?5
     WHERE id = ?6`,
  ).bind(
    JSON.stringify(updatedRcd),
    JSON.stringify(updatedRcd.validation_metadata),
    JSON.stringify(persona),
    jobDescription,
    now(),
    id,
  ).run();

  return c.json({
    updatedCell: calibrationResult.updatedCell,
    persona,
    jobDescription,
    rcd: JSON.parse(JSON.stringify(updatedRcd)),
  });
});

// ─── POST /:id/invite — Send interview invitations to team members ──────────

roleContexts.post('/:id/invite', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const row = await c.env.DB.prepare(
    'SELECT * FROM role_contexts WHERE id = ?1',
  )
    .bind(id)
    .first<RoleContextRow>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  const baseline = parseJsonColumn<Record<string, unknown>>(row.baseline, {});
  const roleTitle = typeof baseline.title === 'string' ? baseline.title : 'a role';
  const resendApiKey = c.env.RESEND_API_KEY ?? '';
  const appUrl = c.env.APP_BASE_URL ?? 'https://pipe.build';

  const created: Array<{ id: string; name: string; email: string }> = [];

  for (const invitee of parsed.data.invitees) {
    const pid = generateId();
    const token = generateId();

    await c.env.DB.prepare(
      `INSERT INTO role_context_participants (id, role_context_id, name, email, invite_token, is_creator, question_budget, status)
       VALUES (?1, ?2, ?3, ?4, ?5, 0, 5, 'INVITED')`,
    )
      .bind(pid, id, invitee.name, invitee.email, token)
      .run();

    // Send invitation email (non-blocking — log errors, don't throw)
    if (resendApiKey) {
      const interviewUrl = `${appUrl}/role-interview/${token}`;
      await sendNotificationEmail({
        apiKey: resendApiKey,
        trigger: 'INVITATION',
        to: invitee.email,
        variables: {
          name: invitee.name,
          email: invitee.email,
          pipelineName: roleTitle,
          assessUrl: interviewUrl,
        },
      });
    }

    created.push({ id: pid, name: invitee.name, email: invitee.email });
  }

  return c.json({ invited: created }, 201);
});

// ─── PATCH /:id — Link role context to a pipeline ───────────────────────────

roleContexts.patch('/:id', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const pipelineId = (body as Record<string, unknown>)?.pipelineId;
  if (typeof pipelineId !== 'string') {
    return apiError(c, 'VALIDATION_ERROR', 'pipelineId must be a string.');
  }

  const row = await c.env.DB.prepare(
    'SELECT owner_id FROM role_contexts WHERE id = ?1',
  )
    .bind(id)
    .first<{ owner_id: string }>();

  if (!row) {
    return apiError(c, 'NOT_FOUND', 'Role context not found.');
  }
  if (row.owner_id !== userId) {
    return apiError(c, 'FORBIDDEN', 'You do not own this role context.');
  }

  await c.env.DB.prepare(
    'UPDATE role_contexts SET pipeline_id = ?1, updated_at = ?2 WHERE id = ?3',
  )
    .bind(pipelineId, now(), id)
    .run();

  return c.json({ success: true });
});
