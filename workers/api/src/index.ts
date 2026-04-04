import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { pipelines } from './routes/pipelines';
import { pipelineStages, stageOps, stageChallenges } from './routes/stages';
import { challenges } from './routes/challenges';
import { github } from './routes/github';
import { overview } from './routes/overview';
import { pipelineCandidates, candidateOps } from './routes/candidates';
import { emailRoutes } from './routes/email';
import { schedulingAuth, schedulingPublic } from './routes/scheduling';
import { phonePublic, phoneAuth } from './routes/phone';
import { videoAuth, videoCandidate } from './routes/video';
import { challengeSubmissions } from './routes/challengeSubmissions';
import { reviewSessions } from './routes/reviewSessions';
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
// Pipeline-scoped stage creation: POST /api/v1/pipelines/:pipelineId/stages
app.route('/api/v1/pipelines', pipelineStages);
// Flat stage routes: GET/PATCH/DELETE /api/v1/stages/:stageId
app.route('/api/v1/stages', stageOps);
// Stage-scoped challenge creation: POST /api/v1/stages/:stageId/challenges
app.route('/api/v1/stages', stageChallenges);
// Challenge CRUD: GET/PUT /api/v1/challenges/:id, POST /api/v1/challenges/:id/clone
app.route('/api/v1/challenges', challenges);
// GitHub PR proxy: POST /api/v1/github/pr
app.route('/api/v1/github', github);
// Overview: GET /api/v1/pipelines/:pipelineId/overview
app.route('/api/v1/pipelines', overview);
// Candidates: POST /api/v1/pipelines/:pipelineId/candidates
app.route('/api/v1/pipelines', pipelineCandidates);
// Candidate ops: GET/PATCH /api/v1/candidates/:candidateId
app.route('/api/v1/candidates', candidateOps);
// Email: POST /api/v1/candidates/:candidateId/send-invite, /send-result
app.route('/api/v1/candidates', emailRoutes);
// Scheduling: webhook receiver (public, no auth) — must mount before auth routes
app.route('/api/v1/scheduling', schedulingPublic);
// Scheduling: OAuth, event types, interviews (authenticated)
app.route('/api/v1/scheduling', schedulingAuth);
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

// RPC: Candidate-facing routes (custom JWT auth, no Clerk)
app.route('/rpc', rpcPublic);
app.route('/rpc', rpcAuth);

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
export default app;
