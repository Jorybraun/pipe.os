/**
 * Global Copilot Agent routes
 *
 * Mounts under /api/v1/agent.
 * All routes require a valid Clerk JWT via authMiddleware.
 *
 * Routes:
 *   POST   /chat      — send a message, get agent response
 *   GET    /session    — restore session for a pipeline (?pipelineId=X)
 *   DELETE /session    — clear/archive session
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { createCopilotProvider } from '../../lib/llm/createProvider';
import { runCopilotTurn, getMockCopilotResponse } from '../../lib/copilotAgent';
import type { AgentContext } from '../../lib/copilotAgentPrompts';
import type { LLMMessage } from '../../lib/llm/types';
import type { Env, Variables, CandidatePersona } from '../../types';

const agentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
agentRoutes.use('*', authMiddleware);

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/** Build context snapshot from D1 data. */
async function buildContextSnapshot(db: D1Database, pipelineId: string): Promise<AgentContext> {
  const ctx: AgentContext = {};

  const pipeline = await db.prepare(
    `SELECT title, level, stack, description FROM pipelines WHERE id = ?1`,
  ).bind(pipelineId).first<{ title: string; level: string; stack: string | null; description: string | null }>();

  if (pipeline) {
    ctx.pipelineTitle = pipeline.title;
    ctx.pipelineLevel = pipeline.level;
    ctx.pipelineStack = parseJson<string[]>(pipeline.stack, []);
    ctx.pipelineDescription = pipeline.description ?? undefined;
  }

  // Role context (persona + JD)
  const roleCtx = await db.prepare(
    `SELECT persona_json, job_description_md FROM role_contexts WHERE pipeline_id = ?1 AND status = 'COMPLETE' ORDER BY updated_at DESC LIMIT 1`,
  ).bind(pipelineId).first<{ persona_json: string | null; job_description_md: string | null }>();

  if (roleCtx?.persona_json) {
    const persona = parseJson<CandidatePersona | null>(roleCtx.persona_json, null);
    if (persona) {
      ctx.personaSeniority = persona.seniority;
      ctx.personaArchetype = persona.archetype;
      ctx.personaMustHaveSkills = persona.mustHaveSkills;
      ctx.personaNiceToHaveSkills = persona.niceToHaveSkills;
    }
  }
  if (roleCtx?.job_description_md) {
    ctx.jobDescriptionMd = roleCtx.job_description_md;
  }

  // Stages + challenge counts
  const { results: stages } = await db.prepare(
    `SELECT s.title, s.stage_type, COUNT(c.id) as challenge_count
     FROM stages s LEFT JOIN challenges c ON c.stage_id = s.id
     WHERE s.pipeline_id = ?1 GROUP BY s.id ORDER BY s.sort_order`,
  ).bind(pipelineId).all<{ title: string; stage_type: string | null; challenge_count: number }>();

  if (stages?.length) {
    ctx.stages = stages.map((s) => ({
      title: s.title,
      type: s.stage_type,
      challengeCount: s.challenge_count,
    }));
  }

  return ctx;
}

// ─── POST /chat ─────────────────────────────────────────────────────────────

agentRoutes.post('/chat', async (c) => {
  const userId = c.var.userId;
  const body = await c.req.json<{
    message?: string;
    pipelineId?: string;
    skillMode?: string;
  }>().catch(() => ({}));

  if (!body.message?.trim()) {
    return apiError(c, 'BAD_REQUEST', 'message is required');
  }

  const pipelineId = body.pipelineId ?? null;
  const now = new Date().toISOString();

  // Resolve or create session
  let session = pipelineId
    ? await c.env.DB.prepare(
        `SELECT id, skill_mode, messages, context_snapshot FROM agent_sessions WHERE owner_id = ?1 AND pipeline_id = ?2 AND status = 'active'`,
      ).bind(userId, pipelineId).first<{ id: string; skill_mode: string; messages: string; context_snapshot: string | null }>()
    : await c.env.DB.prepare(
        `SELECT id, skill_mode, messages, context_snapshot FROM agent_sessions WHERE owner_id = ?1 AND pipeline_id IS NULL AND status = 'active'`,
      ).bind(userId).first<{ id: string; skill_mode: string; messages: string; context_snapshot: string | null }>();

  let sessionId: string;
  let skillMode: string;
  let history: LLMMessage[];
  let context: AgentContext;

  if (session) {
    sessionId = session.id;
    skillMode = body.skillMode ?? session.skill_mode;
    history = parseJson<LLMMessage[]>(session.messages, []);
    context = parseJson<AgentContext>(session.context_snapshot, {});
  } else {
    // Create new session
    const newSession = await c.env.DB.prepare(`
      INSERT INTO agent_sessions (owner_id, pipeline_id, skill_mode, messages, context_snapshot, created_at, updated_at)
      VALUES (?1, ?2, ?3, '[]', ?4, ?5, ?5)
      RETURNING id
    `).bind(
      userId,
      pipelineId,
      body.skillMode ?? 'general',
      null,
      now,
    ).first<{ id: string }>();

    if (!newSession) {
      return apiError(c, 'SERVER_ERROR', 'Failed to create agent session');
    }

    sessionId = newSession.id;
    skillMode = body.skillMode ?? 'general';
    history = [];

    // Build context snapshot
    context = pipelineId ? await buildContextSnapshot(c.env.DB, pipelineId) : {};
    await c.env.DB.prepare(
      `UPDATE agent_sessions SET context_snapshot = ?1 WHERE id = ?2`,
    ).bind(JSON.stringify(context), sessionId).run();
  }

  // Get provider
  const provider = createCopilotProvider(c.env);

  if (!provider) {
    // Mock mode
    const mock = getMockCopilotResponse(body.message, skillMode);
    const updatedMessages = [...history, ...mock.updatedHistory];
    await c.env.DB.prepare(
      `UPDATE agent_sessions SET messages = ?1, skill_mode = ?2, updated_at = ?3 WHERE id = ?4`,
    ).bind(JSON.stringify(updatedMessages), mock.skillMode, now, sessionId).run();

    return c.json({
      sessionId,
      response: mock.response,
      toolsUsed: mock.toolsUsed,
      skillMode: mock.skillMode,
    });
  }

  // Run the agent turn
  const result = await runCopilotTurn({
    provider,
    history,
    userMessage: body.message,
    skillMode,
    context,
    toolCtx: {
      db: c.env.DB,
      ownerId: userId,
      githubToken: c.env.GITHUB_TOKEN,
      librariesIoApiKey: c.env.LIBRARIES_IO_API_KEY,
    },
  });

  // Persist updated history + skill mode
  await c.env.DB.prepare(
    `UPDATE agent_sessions SET messages = ?1, skill_mode = ?2, updated_at = ?3 WHERE id = ?4`,
  ).bind(JSON.stringify(result.updatedHistory), result.skillMode, now, sessionId).run();

  return c.json({
    sessionId,
    response: result.response,
    toolsUsed: result.toolsUsed,
    skillMode: result.skillMode,
  });
});

// ─── GET /session ───────────────────────────────────────────────────────────

agentRoutes.get('/session', async (c) => {
  const userId = c.var.userId;
  const pipelineId = c.req.query('pipelineId');

  const session = pipelineId
    ? await c.env.DB.prepare(
        `SELECT id, skill_mode, messages, context_snapshot, created_at, updated_at FROM agent_sessions WHERE owner_id = ?1 AND pipeline_id = ?2 AND status = 'active'`,
      ).bind(userId, pipelineId).first<Record<string, string | null>>()
    : await c.env.DB.prepare(
        `SELECT id, skill_mode, messages, context_snapshot, created_at, updated_at FROM agent_sessions WHERE owner_id = ?1 AND pipeline_id IS NULL AND status = 'active'`,
      ).bind(userId).first<Record<string, string | null>>();

  if (!session) {
    return c.json({ session: null });
  }

  return c.json({
    session: {
      id: session.id,
      skillMode: session.skill_mode,
      messages: parseJson<LLMMessage[]>(session.messages as string, []),
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    },
  });
});

// ─── DELETE /session ────────────────────────────────────────────────────────

agentRoutes.delete('/session', async (c) => {
  const userId = c.var.userId;
  const pipelineId = c.req.query('pipelineId');

  if (pipelineId) {
    await c.env.DB.prepare(
      `UPDATE agent_sessions SET status = 'archived', updated_at = ?1 WHERE owner_id = ?2 AND pipeline_id = ?3 AND status = 'active'`,
    ).bind(new Date().toISOString(), userId, pipelineId).run();
  } else {
    await c.env.DB.prepare(
      `UPDATE agent_sessions SET status = 'archived', updated_at = ?1 WHERE owner_id = ?2 AND pipeline_id IS NULL AND status = 'active'`,
    ).bind(new Date().toISOString(), userId).run();
  }

  return c.json({ success: true });
});

export { agentRoutes };
