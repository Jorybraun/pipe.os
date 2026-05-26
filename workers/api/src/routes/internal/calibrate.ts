import { Hono, type Context } from 'hono';
import { scoreReviewSession, type ScorerInput, type LLMProvider as CodeReviewProvider, type ScoreReport } from '../../lib/scorerAgent';
import {
  scoreCultureInterview,
  type CultureScoreReport,
  type OrgCultureBenchmark,
} from '../../lib/cultureScorer';
import type { CultureTranscript } from '../../lib/cultureAgent';
import type { CultureTeamContext } from '../../lib/cultureRoleResolution';
import { CloudflareAIProvider } from '../../lib/llm/cloudflareAIProvider';
import { GoogleAIProvider } from '../../lib/llm/googleAIProvider';
import { VertexAIProvider } from '../../lib/llm/vertexAIProvider';
import { KimiProvider } from '../../lib/llm/kimiProvider';
import type { LLMProvider } from '../../lib/llm/types';
import type { Env, Variables } from '../../types';

type CalibrateContext = Context<{ Bindings: Env; Variables: Variables }>;

/**
 * Internal calibration scoring endpoint — CAL-5 spine (code_review) + CAL-6 (culture_interview).
 *
 * Auth: shared secret on `X-Calibrate-Token` matching `env.CALIBRATE_TOKEN`.
 * If the secret is not set in env, the route 503s — this is the prod kill switch.
 */

export const calibrate = new Hono<{ Bindings: Env; Variables: Variables }>();

type CalibrationDomain = 'code_review' | 'culture_interview';

interface CodeReviewScoreBody {
  domain: 'code_review';
  provider: CodeReviewProvider;
  scorerInput: Omit<ScorerInput, 'apiKey' | 'ai' | 'provider'>;
}

interface CultureScoreBody {
  domain: 'culture_interview';
  /** Wire provider name — may include 'mistral' which maps to Workers AI Mistral model. */
  provider: string;
  scorerInput: {
    transcript: CultureTranscript;
    /** Org culture benchmark. Defaults to neutral midpoint (3 across all axes) when omitted. */
    orgBenchmark?: OrgCultureBenchmark;
    /** Full RCD team context. If omitted and dispositionalWeights is provided, a synthetic context is built. */
    teamContext?: CultureTeamContext | null;
    /** Calibration ground truth — accepted for request symmetry but not passed to scorer (harness-side metric computation). */
    groundTruth?: unknown;
    /** RCD-derived per-dimension weight deltas. Applied via synthetic team context when teamContext is absent. */
    dispositionalWeights?: Record<string, number>;
    /** Question bank version for audit trail. */
    questionBankVersion?: string;
  };
}

type CalibrateScoreBody = CodeReviewScoreBody | CultureScoreBody;

type CalibrateScoreResponse =
  | { domain: 'code_review'; provider: string; score_report: ScoreReport }
  | { domain: 'culture_interview'; provider: string; score_report: CultureScoreReport };

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
  return c.json({
    status: 'ok',
    ai_binding: Boolean(c.env.AI),
    domains: ['code_review', 'culture_interview'],
  });
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

  if (!body.provider) {
    return c.json({ error: { code: 'MISSING_PROVIDER', message: 'provider is required.' } }, 400);
  }
  if (!body.scorerInput) {
    return c.json({ error: { code: 'MISSING_SCORER_INPUT', message: 'scorerInput is required.' } }, 400);
  }

  if (body.domain === 'code_review') {
    return handleCodeReview(c, body);
  }

  if (body.domain === 'culture_interview') {
    return handleCultureInterview(c, body);
  }

  return c.json(
    {
      error: {
        code: 'DOMAIN_NOT_IMPLEMENTED',
        message: `Calibration domain '${(body as CalibrateScoreBody).domain}' is not implemented.`,
      },
    },
    501,
  );
});

async function handleCodeReview(c: CalibrateContext, body: CodeReviewScoreBody): Promise<Response> {
  const input: ScorerInput = {
    ...body.scorerInput,
    provider: body.provider,
    apiKey: resolveCodeReviewApiKey(body.provider, c.env),
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
    console.error('[calibrate/score] code_review failed', { provider: body.provider, message });
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
}

async function handleCultureInterview(
  c: CalibrateContext,
  body: CultureScoreBody,
): Promise<Response> {
  let provider: LLMProvider;
  try {
    provider = createCultureProvider(body.provider, c.env);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: { code: 'PROVIDER_SETUP_FAILED', message } }, 500);
  }

  const orgBenchmark: OrgCultureBenchmark = body.scorerInput.orgBenchmark ?? {
    autonomy: 3,
    riskTolerance: 3,
    workPace: 3,
    collaborationStyle: 3,
    feedbackOrientation: 3,
  };

  // Build teamContext: use provided teamContext, or synthesise one from dispositionalWeights.
  let teamContext: CultureTeamContext | null = body.scorerInput.teamContext ?? null;
  if (!teamContext && body.scorerInput.dispositionalWeights) {
    teamContext = {
      rcdVersion: 'calibration',
      roleContextId: 'calibration',
      teamCultureProfile: { per_stakeholder: {} },
      dispositionalWeights: body.scorerInput.dispositionalWeights,
      teamDomainCells: { hiringManager: null, teamMember: null },
      barsOverrides: [],
      dealbreakers: [],
    };
  }

  try {
    const report = await scoreCultureInterview({
      provider,
      transcript: body.scorerInput.transcript,
      orgBenchmark,
      teamContext,
    });
    const response: CalibrateScoreResponse = {
      domain: body.domain,
      provider: body.provider,
      score_report: report,
    };
    return c.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[calibrate/score] culture_interview failed', { provider: body.provider, message });
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
}

function createCultureProvider(provider: string, env: Env): LLMProvider {
  if (provider === 'workers-ai') {
    if (!env.AI) {
      throw new Error('[calibrate] Workers AI binding not available.');
    }
    return new CloudflareAIProvider(env.AI);
  }

  if (provider === 'google-ai') {
    if (!env.GOOGLE_AI_API_KEY) {
      throw new Error('[calibrate] GOOGLE_AI_API_KEY not configured for google-ai calibration run.');
    }
    return new GoogleAIProvider(env.GOOGLE_AI_API_KEY);
  }

  if (provider === 'vertex-ai') {
    if (!env.CF_AI_GATEWAY_URL || !env.CF_API_TOKEN) {
      throw new Error('[calibrate] CF_AI_GATEWAY_URL and CF_API_TOKEN not configured for vertex-ai calibration run.');
    }
    if (!env.VERTEX_AI_PROJECT_ID) {
      throw new Error('[calibrate] VERTEX_AI_PROJECT_ID not configured for vertex-ai calibration run.');
    }
    return new VertexAIProvider(
      env.CF_AI_GATEWAY_URL,
      env.CF_API_TOKEN,
      env.VERTEX_AI_PROJECT_ID,
      env.VERTEX_AI_REGION ?? 'us-central1',
      env.VERTEX_AI_MODEL ?? 'google/gemma-4-26b-a4b-it-maas',
    );
  }

  if (provider === 'mistral') {
    // Pragmatic fallback: map Mistral wire provider to Workers AI with Mistral model
    // until a native Mistral API provider is implemented.
    if (!env.AI) {
      throw new Error('[calibrate] Workers AI binding not available for mistral provider.');
    }
    return new CloudflareAIProvider(env.AI, '@cf/mistralai/mistral-small-3.1-24b-instruct');
  }

  throw new Error(`[calibrate] Unknown provider: ${provider}`);
}

function resolveCodeReviewApiKey(provider: CodeReviewProvider, env: Env): string {
  if (provider === 'workers-ai') return '';
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
  if (provider === 'kimi') {
    if (!env.KIMI_API_KEY) {
      throw new Error('[calibrate] KIMI_API_KEY not configured for kimi calibration run.');
    }
    return env.KIMI_API_KEY;
  }
  throw new Error(`[calibrate] Unknown provider: ${provider as string}`);
}
