/**
 * Unified Agent Runtime — Route Handler
 *
 * Single route module for all AI interview agents.
 * Replaces roleContexts.ts, reviewSessions.ts, and future culture routes.
 *
 * Pattern:
 *   POST /api/v1/agents/:agentType/sessions              → create
 *   GET  /rpc/agents/:token                              → candidate read
 *   POST /rpc/agents/:token/consent                      → consent
 *   POST /rpc/agents/:token/respond                      → respond (generate turn + eval gate)
 *   GET  /api/v1/agents/:agentType/sessions/:id/report   → score report
 *   POST /api/v1/agents/:agentType/sessions/:id/review   → HITL override
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import {
  getPlugin,
  createFSM,
  runEvalGate,
  scoreSession,
  InMemorySessionStore,
  type AgentSession,
} from '../lib/unifiedAgentRuntime';
import { createRoleAgentProvider } from '../lib/llm/createProvider';

// Use in-memory store for now; swap to D1SessionStore in Phase 5
const store = new InMemorySessionStore();

function getProvider(env: Env) {
  return createRoleAgentProvider(env);
}

const app = new Hono<{ Bindings: Env }>();

// ─── Create session ──────────────────────────────────────────────────────────

app.post('/api/v1/agents/:agentType/sessions', async (c) => {
  const agentType = c.req.param('agentType') as AgentSession['agentType'];
  const body = await c.req.json<{ challengeId?: string; candidateId?: string }>().catch(() => ({}));

  const plugin = getPlugin(agentType);
  const session = await store.createSession(agentType, body.challengeId, body.candidateId);

  return c.json({ sessionId: session.id, state: session.state });
});

// ─── Candidate: get state + next question ────────────────────────────────────

app.get('/rpc/agents/:token', async (c) => {
  const token = c.req.param('token');
  const session = await store.getSessionByToken(token);
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const plugin = getPlugin(session.agentType);
  const nextQuestion = session.transcript.turns[session.transcript.turns.length - 1]?.questionText ?? null;

  return c.json({
    state: session.state,
    turnCount: session.transcript.turns.length,
    nextQuestion,
  });
});

// ─── Candidate: consent ──────────────────────────────────────────────────────

app.post('/rpc/agents/:token/consent', async (c) => {
  const token = c.req.param('token');
  const session = await store.getSessionByToken(token);
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const fsm = createFSM(getPlugin(session.agentType).fsmConfig);
  const updated = await store.updateSession(session.id, {
    consentAt: new Date().toISOString(),
  });

  const nextState = fsm.nextState({ ...updated, state: 'consent' });
  const final = await store.updateSession(session.id, { state: nextState });

  return c.json({ state: final.state });
});

// ─── Candidate: respond ──────────────────────────────────────────────────────

app.post('/rpc/agents/:token/respond', async (c) => {
  const token = c.req.param('token');
  const body = await c.req.json<{ answer?: string }>().catch(() => ({}));

  const session = await store.getSessionByToken(token);
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const plugin = getPlugin(session.agentType);
  const fsm = createFSM(plugin.fsmConfig);

  // Append candidate response to last turn
  const turns = session.transcript.turns;
  if (turns.length > 0 && body.answer) {
    const lastTurn = turns[turns.length - 1]!;
    lastTurn.candidateResponse = body.answer;
    await store.updateSession(session.id, { transcript: session.transcript });
  }

  // Check FSM
  const nextState = fsm.nextState(session);

  // → Scoring
  if (nextState === 'scoring' && plugin.scoringConfig) {
    const report = await scoreSession(getProvider(c.env), session, plugin.scoringConfig);
    const completed = await store.updateSession(session.id, {
      state: 'complete',
      scoreReport: report,
    });
    return c.json({ state: 'complete', report });
  }

  // → Generate next turn
  const turn = await plugin.generateTurn(session, {}, getProvider(c.env));

  // Eval gate (optional)
  if (plugin.evalConfig) {
    const evalResult = await runEvalGate(getProvider(c.env), turn, session, plugin.evalConfig);
    if (!evalResult.approved && evalResult.rewrite) {
      turn.questionText = evalResult.rewrite;
    }
  }

  await store.appendTurn(session.id, turn);

  return c.json({ state: 'in_progress', turn });
});

// ─── Recruiter: score report ─────────────────────────────────────────────────

app.get('/api/v1/agents/:agentType/sessions/:id/report', async (c) => {
  const sessionId = c.req.param('id');
  const session = await store.getSession(sessionId);
  if (!session) return c.json({ error: 'Session not found' }, 404);

  return c.json({
    state: session.state,
    report: session.scoreReport ?? null,
  });
});

// ─── Recruiter: HITL override ────────────────────────────────────────────────

app.post('/api/v1/agents/:agentType/sessions/:id/review', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json<{ overrides?: Array<{ dimensionId: string; score: number }> }>().catch(() => ({}));

  const session = await store.getSession(sessionId);
  if (!session) return c.json({ error: 'Session not found' }, 404);

  if (!session.scoreReport) {
    return c.json({ error: 'No score report available' }, 400);
  }

  const report = { ...session.scoreReport };
  if (body.overrides) {
    for (const o of body.overrides) {
      const dim = report.dimensions.find((d) => d.id === o.dimensionId);
      if (dim) dim.score = o.score;
    }
  }

  await store.updateSession(sessionId, { scoreReport: report });
  return c.json({ report });
});

export default app;
