import { Hono } from 'hono';
import { cors } from 'hono/cors';
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
import { ingestionStatus } from './routes/cockpit/ingestionStatus';
import { search } from './routes/search';
import { schedulingAuth, schedulingPublic } from './routes/cockpit/scheduling';
import { contacts } from './routes/cockpit/contacts';
// Discovery — Role Discovery Agent
import { roleContexts } from './routes/discovery/roleContexts';
// Outreach — invites + result emails + email OAuth
import { emailRoutes } from './routes/outreach/email';
import { emailOAuth } from './routes/outreach/emailOAuth';
import { pdlSearch } from './routes/outreach/pdlSearch';
// Screening — phone screening + culture interview
import { phonePublic, phoneAuth } from './routes/screening/phone';
import { cultureRecruiter } from './routes/screening/culture';
// Assessment — code review, challenges, video interviews
import { videoAuth, videoCandidate, videoPublic } from './routes/assessment/video';
import { meetingRooms, meetingsAuth } from './routes/meetingRooms';
import { challengeSubmissions } from './routes/assessment/challengeSubmissions';
import { reviewSessions } from './routes/assessment/reviewSessions';
// Voice — voice session creation, WebSocket upgrade, transcript callback
import { voiceSessions } from './routes/voice/voiceSessions';
// TTS — Google Cloud Text-to-Speech proxy
import { ttsRouter } from './routes/tts';
// Waitlist — public email signup from marketing site
import { waitlist } from './routes/waitlist';
// Internal tooling — scorer calibration (CAL-5 spine, ADR-036 / STRATEGY CAL-2+)
import { calibrate } from './routes/internal/calibrate';
// Neo4j health check (ADR-043 Phase A)
import neo4jHealth from './routes/internal/neo4jHealth';
import { e2eSeed } from './routes/internal/e2eSeed';
// Candidate runtime entry (cross-cutting JWT layer)
import { rpcPublic, rpcAuth } from './routes/rpc';
import { globalErrorHandler } from './middleware/errors';
import type { Env, Variables } from './types';
import { processProjectionOutbox } from './lib/livingContext';

// Unified Agent Runtime plugin registration (ADR-034)
import { registerAllPlugins } from './lib/agents';
registerAllPlugins();

// Unified Agent Runtime routes (ADR-034)
import agents from './routes/agents';

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
        'https://pipe.build',
        'https://www.pipe.build',
        'https://app.hire-pipe.com',
        'https://room.hire-pipe.com',
        'https://app-dev.hire-pipe.com',
        'https://room-dev.hire-pipe.com',
        'https://pipe-video-room-dev.pages.dev',
        // Cloudflare Pages preview URLs follow this pattern
        /https:\/\/.*\.pipe-os\.pages\.dev$/,
        /https:\/\/.*\.pipe-video-room-dev\.pages\.dev$/,
        // Marketing site (deployed via Devin / static host)
        /https:\/\/.*\.devinapps\.com$/,
        // Local dev
        'http://localhost:5173',
        'http://localhost:5175',
        'http://localhost:4173',
        'http://localhost:8080',
        /^http:\/\/localhost:\d+$/,
        /^http:\/\/127\.0\.0\.1:\d+$/,
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

// Dev deployments are reachable only through the authenticated room proxy.
// The proxy injects X-Pipe-Dev-Proxy-Secret after HTTP Basic Auth succeeds.
app.use('*', async (c, next) => {
  if (c.env.ENV !== 'dev') return next();
  if (c.req.method === 'OPTIONS') return next();

  const { pathname } = new URL(c.req.url);
  if (pathname === '/health' || pathname === '/api/health') return next();

  if (!c.env.DEV_PROXY_SECRET) {
    return c.json(
      {
        error: {
          code: 'DEV_PROXY_NOT_CONFIGURED',
          message: 'Dev proxy secret is not configured.',
        },
      },
      503,
    );
  }

  if (c.req.header('X-Pipe-Dev-Proxy-Secret') !== c.env.DEV_PROXY_SECRET) {
    return c.json(
      {
        error: {
          code: 'DEV_PROXY_REQUIRED',
          message: 'Use the authenticated dev app URL.',
        },
      },
      401,
    );
  }

  return next();
});

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
// Repo discovery: role-matched repo discovery for code review challenges (ADR-032, repo-discovery-pipeline.md)
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
// Ingestion status: SSE stream for a single candidate's ingestion progress
app.route('/api/v1/candidates', ingestionStatus);
// Search: POST /api/v1/search/candidates, POST /api/v1/search/repos
app.route('/api/v1/search', search);
// Dev container sessions: recruiter read-only cockpit routes (ADR-037, Phase 3b)
app.route('/api/v1', devContainerSessions);
// Email: POST /api/v1/candidates/:candidateId/send-invite, /send-result
app.route('/api/v1/candidates', emailRoutes);
// Email OAuth: connect Gmail / Microsoft for send-as
app.route('/api/v1/email', emailOAuth);
// PDL Search: candidate sourcing and enrichment
app.route('/api/v1/outreach', pdlSearch);
// Scheduling: webhook receiver (public, no auth) — must mount before auth routes
app.route('/api/v1/scheduling', schedulingPublic);
// Scheduling: OAuth, event types, interviews (authenticated)
app.route('/api/v1/scheduling', schedulingAuth);
app.route('/api/v1/contacts', contacts);
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
// Video: public WebSocket connection (candidate via invite link, no auth)
app.route('/api/v1/video/public', videoPublic);
// Standalone host/guest meeting room runtime (opaque token auth)
app.route('/api/v1/meeting-rooms', meetingRooms);
// Meeting management: create/list/invite (authenticated)
app.route('/api/v1/meetings', meetingsAuth);
// Challenge submission scoring: PATCH /api/v1/challenge-submissions/:id
app.route('/api/v1/challenge-submissions', challengeSubmissions);
// Review session reports: GET/PATCH /api/v1/review-sessions/:id/{report,transcript,score}
app.route('/api/v1/review-sessions', reviewSessions);

// Role Discovery Agent: AI-powered role context extraction (ADR-027)
app.route('/api/v1/role-contexts', roleContexts);

// Unified Agent Runtime routes (ADR-034)
app.route('', agents);

// Voice sessions: session creation, WebSocket upgrade, transcript callback
app.route('/api/v1/voice-sessions', voiceSessions);

// TTS: Google Cloud Neural2 voice synthesis
app.route('/api/v1/tts', ttsRouter);

// RPC: Candidate-facing routes (custom JWT auth, no Clerk)
app.route('/rpc', rpcPublic);
app.route('/rpc', rpcAuth);

// Waitlist: public email signup from marketing site (no auth)
app.route('/api/v1/waitlist', waitlist);

// Internal: scorer calibration endpoint (shared-secret auth via X-Calibrate-Token;
// disabled entirely when CALIBRATE_TOKEN is unset in env)
app.route('/internal/calibrate', calibrate);

// Internal: Neo4j health check (no auth — dev/ops smoke test)
app.route('/api/v1/internal', neo4jHealth);

// Internal: deterministic local/test fixture seeding for E2E only.
app.route('/api/v1/internal/e2e', e2eSeed);

// ─── Health check ─────────────────────────────────────────────────────────────
function healthPayload(): { status: 'ok'; timestamp: string } {
  return { status: 'ok', timestamp: new Date().toISOString() };
}

app.get('/health', (c) => c.json(healthPayload()));
app.get('/api/health', (c) => c.json(healthPayload()));

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

export default {
  fetch: app.fetch,
  scheduled: (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(processProjectionOutbox(env));
  },
};
