import { Hono, type Context } from 'hono';
import { scoreReviewSession, type ScorerInput, type LLMProvider, type ScoreReport } from '../../lib/scorerAgent';
import type { Env, Variables } from '../../types';

type CalibrateContext = Context<{ Bindings: Env; Variables: Variables }>;

/**
 * Internal calibration scoring endpoint — CAL-5 spine.
 *
 * Replaces the Cloudflare AI REST shim the CAL-2 harness was using for the
 * workers-ai provider. That shim had to reinstate the `env.AI` binding
 * behavior from scratch (auth, retries, response shape normalization) and
 * hit transient 503s on Gemma 4 26B ~50% of the time. Running inside a real
 * Worker with `env.AI` bypasses all of that — the binding uses Cloudflare's
 * internal routing, which production will use too.
 *
 * Forward-compat shape: the body includes a `domain` field. For now only
 * `code_review` is implemented. `culture_interview` is CAL-6, deferred —
 * when it lands it's a new dispatch case in this handler, not a new route.
 *
 * Auth: shared secret on `X-Calibrate-Token` matching `env.CALIBRATE_TOKEN`.
 * If the secret is not set in env, the route 503s — this is the prod kill
 * switch. The harness reads the same secret from `workers/api/.dev.vars`
 * and sends it on every request.
 */

export const calibrate = new Hono<{ Bindings: Env; Variables: Variables }>();

type CalibrationDomain = 'code_review' | 'culture_interview';

interface CalibrateScoreBody {
  /** Which scoring rubric to apply. Only `code_review` is implemented today. */
  domain: CalibrationDomain;
  /** Which provider to exercise. */
  provider: LLMProvider;
  /**
   * Scorer input minus `apiKey` and `ai` — the handler fills those from
   * `env` so clients never need to hold Mistral keys or Worker bindings.
   */
  scorerInput: Omit<ScorerInput, 'apiKey' | 'ai' | 'provider'>;
}

interface CalibrateScoreResponse {
  domain: CalibrationDomain;
  provider: LLMProvider;
  score_report: ScoreReport;
}

function authorize(c: CalibrateContext): Response | null {
  const expected = c.env.CALIBRATE_TOKEN;
  if (!expected) {
    return c.json(
      {
        error: {
          code: 'CALIBRATE_DISABLED',
          message: 'CALIBRATE_TOKEN is not configured in this environment.',
        },
      },
      503,
    );
  }
  const got = c.req.header('X-Calibrate-Token');
  if (got !== expected) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid X-Calibrate-Token.' } },
      401,
    );
  }
  return null;
}

calibrate.get('/health', (c) => {
  const authErr = authorize(c);
  if (authErr) return authErr;
  return c.json({ status: 'ok', ai_binding: Boolean(c.env.AI) });
});

calibrate.post('/score', async (c) => {
  const authErr = authorize(c);
  if (authErr) return authErr;

  let body: CalibrateScoreBody;
  try {
    body = (await c.req.json()) as CalibrateScoreBody;
  } catch {
    return c.json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON.' } }, 400);
  }

  if (body.domain !== 'code_review') {
    return c.json(
      {
        error: {
          code: 'DOMAIN_NOT_IMPLEMENTED',
          message: `Calibration domain '${body.domain}' is not implemented. CAL-6 (culture_interview) is deferred.`,
        },
      },
      501,
    );
  }

  if (!body.provider) {
    return c.json({ error: { code: 'MISSING_PROVIDER', message: 'provider is required.' } }, 400);
  }
  if (!body.scorerInput) {
    return c.json({ error: { code: 'MISSING_SCORER_INPUT', message: 'scorerInput is required.' } }, 400);
  }

  const input: ScorerInput = {
    ...body.scorerInput,
    provider: body.provider,
    apiKey: resolveApiKey(body.provider, c.env),
    ...(body.provider === 'workers-ai' ? { ai: c.env.AI } : {}),
  };

  try {
    const report = await scoreReviewSession(input);
    const response: CalibrateScoreResponse = {
      domain: body.domain,
      provider: body.provider,
      score_report: report,
    };
    return c.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[calibrate/score] failed', { provider: body.provider, message });
    return c.json(
      {
        error: {
          code: 'SCORING_FAILED',
          message,
          provider: body.provider,
        },
      },
      500,
    );
  }
});

function resolveApiKey(provider: LLMProvider, env: Env): string {
  if (provider === 'workers-ai') return '';
  if (provider === 'mistral') {
    if (!env.MISTRAL_API_KEY) {
      throw new Error('[calibrate] MISTRAL_API_KEY not configured for devstral calibration run.');
    }
    return env.MISTRAL_API_KEY;
  }
  if (provider === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('[calibrate] ANTHROPIC_API_KEY not configured for sonnet calibration run.');
    }
    return env.ANTHROPIC_API_KEY;
  }
  if (provider === 'google-ai') {
    if (!env.GOOGLE_AI_API_KEY) {
      throw new Error('[calibrate] GOOGLE_AI_API_KEY not configured for gemini calibration run.');
    }
    return env.GOOGLE_AI_API_KEY;
  }
  if (provider === 'vertex-ai') {
    if (!env.VERTEX_API_KEY) {
      throw new Error('[calibrate] VERTEX_API_KEY not configured for vertex calibration run.');
    }
    return env.VERTEX_API_KEY;
  }
  throw new Error(`[calibrate] Unknown provider: ${provider as string}`);
}
