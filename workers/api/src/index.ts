import { Hono } from 'hono';
import { cors } from 'hono/cors';
// Cron — scheduled handlers for issue crawling + scoring
import { handleScheduled, type ScheduledEvent } from './routes/cron';
// Cockpit — recruiter config + view CRUD
import { pipelines } from './routes/cockpit/pipelines';
import { autoBuild as pipelinesAutoBuild } from './routes/cockpit/pipelinesAutoBuild';
import { pipelineStages, stageOps, stageChallenges } from './routes/cockpit/stages';
import { challenges } from './routes/cockpit/challenges';
import { repoDiscovery } from './routes/cockpit/repoDiscovery';
import { adminRepos } from './routes/cockpit/adminRepos';
import { adminAiUsage } from './routes/cockpit/adminAiUsage';
import { agentRoutes } from './routes/cockpit/agent';
import { github } from './routes/cockpit/github';
import { overview } from './routes/cockpit/overview';
import { pipelineCandidates, candidateOps } from './routes/cockpit/candidates';
import { devContainerSessions } from './routes/cockpit/devContainerSessions';
import { ingestion } from './routes/cockpit/ingestion';
import { schedulingAuth, schedulingPublic } from './routes/cockpit/scheduling';
// Discovery — Role Discovery Agent
import { roleContexts } from './routes/discovery/roleContexts';
// Outreach — invites + result emails + email OAuth
import { emailRoutes } from './routes/outreach/email';
import { emailOAuth } from './routes/outreach/emailOAuth';
// Screening — phone screening + culture interview
import { phonePublic, phoneAuth } from './routes/screening/phone';
import { cultureRecruiter } from './routes/screening/culture';
// Assessment — code review, challenges, video interviews
import { videoAuth, videoCandidate } from './routes/assessment/video';
import { challengeSubmissions } from './routes/assessment/challengeSubmissions';
import { reviewSessions } from './routes/assessment/reviewSessions';
// Voice — voice session creation, WebSocket upgrade, transcript callback
import { voiceSessions } from './routes/voice/voiceSessions';
// TTS — Google Cloud Text-to-Speech proxy
import { ttsRouter } from './routes/tts';
// Internal tooling — scorer calibration (CAL-5 spine, ADR-036 / STRATEGY CAL-2+)
import { calibrate } from './routes/internal/calibrate';
// Candidate runtime entry (cross-cutting JWT layer)
import { rpcPublic, rpcAuth } from './routes/rpc';
import { globalErrorHandler } from './middleware/errors';
import type { Env, Variables } from './types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Restrict to known origins in production; wrangler dev allows localhost.
app.use(
  '*',
  cors({
    origin: (origin) => {
      const allowed = [
        'https://pipe.dev',
        'https://www.pipe.dev',
        // Cloudflare Pages preview URLs follow this pattern
        /https:\/\/.*\.pipe-os\.pages\.dev$/,
        // Local dev
        'http://localhost:5173',
        'http://localhost:4173',
      ];

      for (const pattern of allowed) {
        if (typeof pattern === 'string' && pattern === origin) return origin;
        if (pattern instanceof RegExp && pattern.test(origin)) return origin;
      }

      // Deny by returning undefined — hono/cors will omit the CORS headers.
      return undefined;
    },
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  }),
);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.route('/api/v1/pipelines', pipelines);
// ADR-039 wizard handoff: POST /api/v1/pipelines/auto-build
app.route('/api/v1/pipelines', pipelinesAutoBuild);
// Pipeline-scoped stage creation: POST /api/v1/pipelines/:pipelineId/stages
app.route('/api/v1/pipelines', pipelineStages);
// Flat stage routes: GET/PATCH/DELETE /api/v1/stages/:stageId
app.route('/api/v1/stages', stageOps);
// Stage-scoped challenge creation: POST /api/v1/stages/:stageId/challenges
app.route('/api/v1/stages', stageChallenges);
// Challenge CRUD: GET/PUT /api/v1/challenges/:id, POST /api/v1/challenges/:id/clone
app.route('/api/v1/challenges', challenges);
// Repo discovery: role-matched repo discovery for code review challenges (CR-13)
app.route('/api/v1/repos', repoDiscovery);
// Admin: human approval of qualified_repos catalog
app.route('/api/v1/admin', adminRepos);
// Admin: AI cost + usage dashboard
app.route('/api/v1/admin', adminAiUsage);
// Global copilot agent: recruiter assistant drawer with skill modes
app.route('/api/v1/agent', agentRoutes);
// GitHub PR proxy: POST /api/v1/github/pr
app.route('/api/v1/github', github);
// Overview: GET /api/v1/pipelines/:pipelineId/overview
app.route('/api/v1/pipelines', overview);
// Candidates: POST /api/v1/pipelines/:pipelineId/candidates
app.route('/api/v1/pipelines', pipelineCandidates);
// Candidate ops: GET/PATCH /api/v1/candidates/:candidateId
app.route('/api/v1/candidates', candidateOps);
// Ingestion: GET/POST /api/v1/pipelines/:pipelineId/ingestion
app.route('/api/v1/pipelines', ingestion);
// Dev container sessions: recruiter read-only cockpit routes (ADR-037, Phase 3b)
app.route('/api/v1', devContainerSessions);
// Email: POST /api/v1/candidates/:candidateId/send-invite, /send-result
app.route('/api/v1/candidates', emailRoutes);
// Email OAuth: connect Gmail / Microsoft for send-as
app.route('/api/v1/email', emailOAuth);
// Scheduling: webhook receiver (public, no auth) — must mount before auth routes
app.route('/api/v1/scheduling', schedulingPublic);
// Scheduling: OAuth, event types, interviews (authenticated)
app.route('/api/v1/scheduling', schedulingAuth);
// Culture interview: recruiter config + report + HITL review
app.route('/api/v1/screening/culture', cultureRecruiter);
// Phone: Twilio webhooks (public, signature validation)
app.route('/api/v1/phone', phonePublic);
// Phone: token generation, call CRUD (authenticated)
app.route('/api/v1/phone', phoneAuth);
// Video: session creation, TURN credentials (recruiter auth)
app.route('/api/v1/video', videoAuth);
// Video: candidate WebSocket connection (candidate JWT auth)
app.route('/rpc/video', videoCandidate);
// Challenge submission scoring: PATCH /api/v1/challenge-submissions/:id
app.route('/api/v1/challenge-submissions', challengeSubmissions);
// Review session reports: GET/PATCH /api/v1/review-sessions/:id/{report,transcript,score}
app.route('/api/v1/review-sessions', reviewSessions);

// Role Discovery Agent: AI-powered role context extraction (ADR-027)
app.route('/api/v1/role-contexts', roleContexts);

// Voice sessions: session creation, WebSocket upgrade, transcript callback
app.route('/api/v1/voice-sessions', voiceSessions);

// TTS: Google Cloud Neural2 voice synthesis
app.route('/api/v1/tts', ttsRouter);

// RPC: Candidate-facing routes (custom JWT auth, no Clerk)
app.route('/rpc', rpcPublic);
app.route('/rpc', rpcAuth);

// Internal: scorer calibration endpoint (shared-secret auth via X-Calibrate-Token;
// disabled entirely when CALIBRATE_TOKEN is unset in env)
app.route('/internal/calibrate', calibrate);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() }),
);

// ─── AI test endpoint (dev only) ─────────────────────────────────────────────
app.post('/dev/test-ai', async (c) => {
  if (!c.env.AI) {
    return c.json({ error: 'AI binding not available' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt : 'Review this code: function add(a, b) { return a - b; }';

  const start = Date.now();
  const response = await c.env.AI.run('@cf/qwen/qwen2.5-coder-32b-instruct', {
    messages: [
      { role: 'system', content: 'You are a senior code reviewer. Be concise.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: 512,
  });
  const elapsed = Date.now() - start;

  return c.json({
    model: '@cf/qwen/qwen2.5-coder-32b-instruct',
    elapsed_ms: elapsed,
    response,
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────
app.onError(globalErrorHandler);

// 404 fallback
app.notFound((c) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }, 404),
);

export { VideoRoom } from './durable-objects/VideoRoom';
export { DevContainerDO } from './durable-objects/DevContainerDO';
export { VoiceSessionDO } from './durable-objects/VoiceSessionDO';

// ─── Scheduled handler (cron triggers) ────────────────────────────────────────
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    await handleScheduled(event, env);
  },
};
