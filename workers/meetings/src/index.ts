import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { contacts } from './routes/contacts';
import { meetings } from './routes/meetings';
import { globalErrorHandler } from './middleware/errors';
import type { Env, Variables } from './types';
import { runCopilotTurn } from './lib/copilotAgent';

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
        'http://localhost:5175',
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

// ─── CopilotKit-Compatible Endpoint (Custom Agent Implementation) ───────────────
app.post('/api/copilotkit', async (c) => {
  try {
    const body = await c.req.json();
    const { messages, threadId } = body;

    const ai = c.env.AI;
    if (!ai) {
      return c.json({ error: 'AI binding not available' }, 500);
    }

    // Convert CopilotKit format to our agent format
    const messagesArray = messages || [];
    const history = messagesArray
      .filter((m: any) => m.role !== 'user' || m.role !== 'assistant')
      .map((m: any) => ({ role: m.role, content: m.content || '' }));

    const lastMessage = messagesArray[messagesArray.length - 1];
    const userMessage = lastMessage?.content || '';

    const result = await runCopilotTurn({
      ai,
      history,
      userMessage,
      toolCtx: { db: c.env.DB },
    });

    // Return CopilotKit-compatible response format
    return c.json({
      choices: [{
        message: {
          content: result.response,
          role: 'assistant',
        },
      }],
      toolsUsed: result.toolsUsed,
      threadId: threadId || 'default',
      actions: result.actions,
    });
  } catch (error) {
    console.error('CopilotKit endpoint error:', error);
    return c.json({ error: 'Failed to process request', details: String(error) }, 500);
  }
});

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
