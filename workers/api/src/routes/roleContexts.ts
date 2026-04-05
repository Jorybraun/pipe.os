/**
 * Role Context Routes — AI-Powered Role Discovery (ADR-027)
 *
 * POST /api/v1/role-contexts           — Create with baseline
 * GET  /api/v1/role-contexts/:id       — Retrieve full state (reload recovery)
 * POST /api/v1/role-contexts/:id/start — Start the AI interview
 * POST /api/v1/role-contexts/:id/respond — Submit answer, get next question
 * POST /api/v1/role-contexts/:id/complete — Force-complete early
 * POST /api/v1/role-contexts/parse-jd    — Parse JD text or PDF into baseline
 *
 * All routes require Clerk JWT auth. Ownership enforced on all mutations.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { apiError } from '../middleware/errors';
import { createRoleContextSchema, respondSchema } from '../validation/roleContexts';
import { callRoleAgent, mergeKnowledgeState } from '../lib/roleAgent';
import { parseJobDescription } from '../lib/jdParser';
import type { Env, Variables, RoleContextRow, RoleExchange } from '../types';

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

// ─── POST / — Create role context with baseline ─────────────────────────────

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

  await c.env.DB.prepare(
    `INSERT INTO role_contexts (id, owner_id, baseline, question_budget, status)
     VALUES (?1, ?2, ?3, ?4, 'BASELINE')`,
  )
    .bind(id, userId, JSON.stringify(baseline), questionBudget)
    .run();

  return c.json(
    {
      id,
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
  const apiKey = c.env.MISTRAL_API_KEY ?? '';
  const mock = c.env.MOCK_AI === 'true';

  // Multipart: file upload
  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return apiError(c, 'VALIDATION_ERROR', 'No file provided.');
    }

    const buffer = await file.arrayBuffer();
    const parsed = await parseJobDescription({
      fileBuffer: buffer,
      contentType: file.type,
      apiKey,
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

  const parsed = await parseJobDescription({ text, apiKey, mock });

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
  const file = formData.get('audio');
  if (!file || !(file instanceof File)) {
    return apiError(c, 'VALIDATION_ERROR', 'No audio file provided.');
  }

  if (!c.env.AI) {
    return apiError(c, 'INTERNAL_ERROR', 'Workers AI not available.');
  }

  const buffer = await file.arrayBuffer();

  try {
    const result = await c.env.AI.run(
      '@cf/openai/whisper' as Parameters<typeof c.env.AI.run>[0],
      { audio: [...new Uint8Array(buffer)] },
    ) as { text?: string };

    const transcript = result.text?.trim() || '';
    console.log('[roleContexts/transcribe] Whisper result:', transcript.slice(0, 100));

    return c.json({ transcript });
  } catch (err) {
    console.error('[roleContexts/transcribe] Whisper failed:', err);
    return apiError(c, 'INTERNAL_ERROR', 'Transcription failed.');
  }
});

// ─── GET /:id — Retrieve full state ─────────────────────────────────────────

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

  const baseline = parseJsonColumn<Record<string, unknown>>(row.baseline, {});
  const knowledgeState = parseJsonColumn<Record<string, unknown>>(row.knowledge_state, {});
  const exchanges = parseJsonColumn<RoleExchange[]>(row.exchanges, []);

  return c.json({
    id: row.id,
    pipelineId: row.pipeline_id,
    status: row.status,
    baseline,
    knowledgeState,
    exchanges,
    questionBudget: row.question_budget,
    questionsAsked: row.questions_asked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

// ─── POST /:id/start — Begin AI interview (first question) ─────────────────

roleContexts.post('/:id/start', async (c) => {
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
  if (row.status !== 'BASELINE') {
    return apiError(c, 'VALIDATION_ERROR', `Cannot start interview from status '${row.status}'. Expected 'BASELINE'.`);
  }

  const baseline = parseJsonColumn<Record<string, unknown>>(row.baseline, {});
  const apiKey = c.env.MISTRAL_API_KEY ?? '';

  const agentResponse = await callRoleAgent({
    apiKey,
    baseline,
    exchanges: [],
    knowledgeState: {},
    questionsAsked: 0,
    questionBudget: row.question_budget,
  });

  if (agentResponse.type !== 'question') {
    return apiError(c, 'INTERNAL_ERROR', 'Agent did not return a question for the opening turn.');
  }

  // Store the first exchange (without an answer yet)
  const exchange: RoleExchange = {
    questionId: agentResponse.question.id,
    acknowledgment: agentResponse.acknowledgment,
    question: agentResponse.question.text,
    input: agentResponse.question.input,
  };

  const knowledgeState = mergeKnowledgeState({}, agentResponse.knowledgeStateUpdate);

  await c.env.DB.prepare(
    `UPDATE role_contexts
     SET status = 'INTERVIEWING',
         exchanges = ?1,
         knowledge_state = ?2,
         updated_at = ?3
     WHERE id = ?4`,
  )
    .bind(JSON.stringify([exchange]), JSON.stringify(knowledgeState), now(), id)
    .run();

  return c.json({
    acknowledgment: agentResponse.acknowledgment,
    question: agentResponse.question,
    progress: {
      asked: 0,
      budget: row.question_budget,
      domains: agentResponse.domainCoverage,
    },
    status: 'INTERVIEWING' as const,
    toolsUsed: agentResponse.toolsUsed,
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
  if (row.status !== 'INTERVIEWING') {
    return apiError(c, 'VALIDATION_ERROR', `Cannot respond in status '${row.status}'. Expected 'INTERVIEWING'.`);
  }

  const baseline = parseJsonColumn<Record<string, unknown>>(row.baseline, {});
  const exchanges = parseJsonColumn<RoleExchange[]>(row.exchanges, []);
  const knowledgeState = parseJsonColumn<Record<string, Record<string, unknown>>>(row.knowledge_state, {});

  // Attach the answer to the current (last) exchange
  const lastExchange = exchanges[exchanges.length - 1];
  if (!lastExchange || lastExchange.questionId !== questionId) {
    return apiError(c, 'VALIDATION_ERROR', `questionId '${questionId}' does not match the current question.`);
  }
  lastExchange.answer = answer;

  const questionsAsked = row.questions_asked + 1;
  const budgetExhausted = questionsAsked >= row.question_budget;

  const apiKey = c.env.MISTRAL_API_KEY ?? '';
  const agentResponse = await callRoleAgent({
    apiKey,
    baseline,
    exchanges,
    knowledgeState,
    questionsAsked,
    questionBudget: row.question_budget,
  });

  const updatedKnowledgeState = mergeKnowledgeState(knowledgeState, agentResponse.knowledgeStateUpdate);

  if (agentResponse.type === 'synthesis' || budgetExhausted) {
    // Interview complete
    const synthesis = agentResponse.type === 'synthesis' ? agentResponse.synthesis : '';

    await c.env.DB.prepare(
      `UPDATE role_contexts
       SET status = 'COMPLETE',
           exchanges = ?1,
           knowledge_state = ?2,
           questions_asked = ?3,
           updated_at = ?4
       WHERE id = ?5`,
    )
      .bind(JSON.stringify(exchanges), JSON.stringify(updatedKnowledgeState), questionsAsked, now(), id)
      .run();

    return c.json({
      synthesis,
      knowledgeState: updatedKnowledgeState,
      progress: {
        asked: questionsAsked,
        budget: row.question_budget,
        domains: agentResponse.domainCoverage,
      },
      status: 'COMPLETE' as const,
    });
  }

  // Mid-interview — append new exchange (question without answer)
  const newExchange: RoleExchange = {
    questionId: agentResponse.question.id,
    acknowledgment: agentResponse.acknowledgment,
    question: agentResponse.question.text,
    input: agentResponse.question.input,
  };
  exchanges.push(newExchange);

  await c.env.DB.prepare(
    `UPDATE role_contexts
     SET exchanges = ?1,
         knowledge_state = ?2,
         questions_asked = ?3,
         updated_at = ?4
     WHERE id = ?5`,
  )
    .bind(JSON.stringify(exchanges), JSON.stringify(updatedKnowledgeState), questionsAsked, now(), id)
    .run();

  return c.json({
    acknowledgment: agentResponse.acknowledgment,
    question: agentResponse.question,
    progress: {
      asked: questionsAsked,
      budget: row.question_budget,
      domains: agentResponse.domainCoverage,
    },
    status: 'INTERVIEWING' as const,
    toolsUsed: agentResponse.toolsUsed,
  });
});

// ─── POST /:id/complete — Force-complete early ──────────────────────────────

roleContexts.post('/:id/complete', async (c) => {
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
  if (row.status !== 'INTERVIEWING') {
    return apiError(c, 'VALIDATION_ERROR', `Cannot complete from status '${row.status}'. Expected 'INTERVIEWING'.`);
  }

  const baseline = parseJsonColumn<Record<string, unknown>>(row.baseline, {});
  const exchanges = parseJsonColumn<RoleExchange[]>(row.exchanges, []);
  const knowledgeState = parseJsonColumn<Record<string, Record<string, unknown>>>(row.knowledge_state, {});

  const apiKey = c.env.MISTRAL_API_KEY ?? '';
  const agentResponse = await callRoleAgent({
    apiKey,
    baseline,
    exchanges,
    knowledgeState,
    questionsAsked: row.question_budget, // Force budget-exhausted mode
    questionBudget: row.question_budget,
  });

  const updatedKnowledgeState = mergeKnowledgeState(knowledgeState, agentResponse.knowledgeStateUpdate);
  const synthesis = agentResponse.type === 'synthesis' ? agentResponse.synthesis : '';

  await c.env.DB.prepare(
    `UPDATE role_contexts
     SET status = 'COMPLETE',
         knowledge_state = ?1,
         updated_at = ?2
     WHERE id = ?3`,
  )
    .bind(JSON.stringify(updatedKnowledgeState), now(), id)
    .run();

  return c.json({
    synthesis,
    knowledgeState: updatedKnowledgeState,
    progress: {
      asked: row.questions_asked,
      budget: row.question_budget,
      domains: agentResponse.domainCoverage,
    },
    status: 'COMPLETE' as const,
  });
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
