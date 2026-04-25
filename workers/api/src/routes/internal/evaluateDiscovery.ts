/**
 * Internal test route for the Role Discovery interview evaluator.
 *
 * POST /api/v1/internal/evaluate-discovery
 *   Body: { exchanges: [{question, answer}, …] }
 *   Response: { coverage, specificity, tone, reasoning }
 *
 * Auth: shared secret via X-Evaluate-Discovery-Token matching
 * env.EVALUATE_DISCOVERY_TOKEN. If the secret is unset, the route 503s.
 */

import { Hono, type Context } from 'hono';
import { evaluateDiscoveryTranscript, type DiscoveryExchange, type DiscoveryEvaluation } from '../../lib/roleDiscovery/evaluator';
import type { Env, Variables } from '../../types';

type EvaluateContext = Context<{ Bindings: Env; Variables: Variables }>;

export const evaluateDiscovery = new Hono<{ Bindings: Env; Variables: Variables }>();

interface EvaluateDiscoveryBody {
  exchanges: DiscoveryExchange[];
}

interface EvaluateDiscoveryResponse extends DiscoveryEvaluation {
  model: string;
  elapsed_ms: number;
}

function authorize(c: EvaluateContext): Response | null {
  const expected = c.env.EVALUATE_DISCOVERY_TOKEN;
  if (!expected) {
    return c.json(
      {
        error: {
          code: 'EVALUATE_DISABLED',
          message: 'EVALUATE_DISCOVERY_TOKEN is not configured in this environment.',
        },
      },
      503,
    );
  }
  const got = c.req.header('X-Evaluate-Discovery-Token');
  if (got !== expected) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid X-Evaluate-Discovery-Token.' } },
      401,
    );
  }
  return null;
}

evaluateDiscovery.get('/health', (c) => {
  const authErr = authorize(c);
  if (authErr) return authErr;
  return c.json({ status: 'ok', ai_binding: Boolean(c.env.AI) });
});

evaluateDiscovery.post('/evaluate-discovery', async (c) => {
  const authErr = authorize(c);
  if (authErr) return authErr;

  let body: EvaluateDiscoveryBody;
  try {
    body = (await c.req.json()) as EvaluateDiscoveryBody;
  } catch {
    return c.json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON.' } }, 400);
  }

  if (!Array.isArray(body.exchanges) || body.exchanges.length === 0) {
    return c.json(
      { error: { code: 'MISSING_EXCHANGES', message: '`exchanges` must be a non-empty array of {question, answer} objects.' } },
      400,
    );
  }

  const start = Date.now();
  try {
    const evaluation = await evaluateDiscoveryTranscript(c.env.AI, body.exchanges);
    const elapsed = Date.now() - start;

    const response: EvaluateDiscoveryResponse = {
      ...evaluation,
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      elapsed_ms: elapsed,
    };

    return c.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[evaluateDiscovery] failed:', message);
    return c.json(
      {
        error: {
          code: 'EVALUATION_FAILED',
          message,
        },
      },
      500,
    );
  }
});
