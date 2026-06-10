import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { contacts } from './routes/contacts';
import { meetings } from './routes/meetings';
import { globalErrorHandler } from './middleware/errors';
import type { Env, Variables } from './types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(
  '*',
  cors({
    origin: (origin) => {
      const allowed = [
        // Meetings app production
        'https://meet.hire-pipe.com',
        // Main app (may embed meeting links)
        'https://pipe.build',
        'https://www.pipe.build',
        'https://hire-pipe.com',
        'https://www.hire-pipe.com',
        // Cloudflare Pages previews
        /https:\/\/.*\.pipe-os\.pages\.dev$/,
        // Local dev
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:8080',
      ];

      for (const pattern of allowed) {
        if (typeof pattern === 'string' && pattern === origin) return origin;
        if (pattern instanceof RegExp && pattern.test(origin)) return origin;
      }

      return undefined;
    },
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  }),
);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.route('/api/v1/contacts', contacts);
app.route('/api/v1/meetings', meetings);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (c) =>
  c.json({ status: 'ok', service: 'pipe-meetings', timestamp: new Date().toISOString() }),
);

// ─── Error handling ───────────────────────────────────────────────────────────
app.onError(globalErrorHandler);

app.notFound((c) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }, 404),
);

export default {
  fetch: app.fetch,
};
