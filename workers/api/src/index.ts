import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { pipelines } from './routes/pipelines';
import { pipelineStages, stageOps, stageChallenges } from './routes/stages';
import { challenges } from './routes/challenges';
import { github } from './routes/github';
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

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() }),
);

// ─── Error handling ───────────────────────────────────────────────────────────
app.onError(globalErrorHandler);

// 404 fallback
app.notFound((c) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }, 404),
);

export default app;
