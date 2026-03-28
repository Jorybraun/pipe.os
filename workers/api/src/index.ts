import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { pipelines } from './routes/pipelines';
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
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  }),
);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.route('/api/v1/pipelines', pipelines);

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
