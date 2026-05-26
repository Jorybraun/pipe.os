/**
 * Confidence Scorer — Cross-family repo narrative evaluation
 *
 * Calls Workers AI REST API (Qwen family) to evaluate Gemma-generated narratives.
 * Designed to run both inside Workers (via binding) and outside (via REST).
 */

import {
  type Pass2SignalSummary,
  type ConfidenceScores,
  type ConfidenceResult,
  buildConfidenceSystemPrompt,
  buildConfidenceUserPrompt,
} from './confidenceScorerPrompts';

const DEFAULT_MODEL = '@cf/qwen/qwen2.5-coder-32b-instruct';
const API_BASE = 'https://api.cloudflare.com/client/v4';

/** Raw response from Workers AI chat completion. */
interface CFChatResponse {
  result?: {
    response?: string;
  };
}

export interface ScorerApiConfig {
  /** Cloudflare account ID. */
  accountId: string;
  /** Cloudflare API token with Workers AI read permission. */
  apiToken: string;
  /** Model override. Defaults to Qwen 2.5-Coder 32B. */
  model?: string;
}

export interface ScoreRepoConfidenceParams {
  /** Gemma-generated engineering narrative. */
  engineeringNarrative: string;
  /** Gemma-generated searchable profile. */
  repoSearchableProfile: string;
  /** Deterministic Pass 2 signals used as ground truth. */
  pass2Signals: Pass2SignalSummary;
}

/**
 * Strip markdown code fences from a model response.
 * Models frequently wrap JSON in ```json ... ``` even when asked not to.
 */
function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) return fenceMatch[1]!.trim();
  return trimmed;
}

/**
 * Derive verdict from aggregate confidence score.
 */
function deriveVerdict(aggregate: number): ConfidenceResult['verdict'] {
  if (aggregate >= 0.8) return 'auto_approve';
  if (aggregate < 0.4) return 'auto_reject';
  return 'manual_review';
}

/**
 * Call Workers AI REST API for a single completion.
 *
 * Uses the chat completion endpoint directly rather than env.AI.run()
 * so this scorer can run both inside Workers and in Node scripts.
 */
async function callWorkersAI(
  config: ScorerApiConfig,
  systemPrompt: string,
  userPrompt: string,
  retries = 3,
): Promise<string> {
  const model = config.model ?? DEFAULT_MODEL;
  const url = `${API_BASE}/accounts/${config.accountId}/ai/run/${model}`;

  const body = JSON.stringify({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 1024,
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(60_000),
    });

    if (res.status === 429 && attempt < retries) {
      const delay = 2000 * (attempt + 1);
      console.warn(`[confidenceScorer] rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Workers AI ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as CFChatResponse;
    const raw = data.result?.response ?? '';
    if (!raw) {
      throw new Error('Workers AI returned empty response');
    }
    return stripJsonFences(raw);
  }

  throw new Error('Workers AI max retries exceeded');
}

/**
 * Parse and validate the JSON response from the confidence scorer model.
 */
function parseConfidenceResponse(raw: string): ConfidenceResult {
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const coverage = Number(parsed.coverage);
  const accuracy = Number(parsed.accuracy);
  const groundedness = Number(parsed.groundedness);
  const specificity = Number(parsed.specificity);

  if (
    !Number.isFinite(coverage) || coverage < 0 || coverage > 1 ||
    !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1 ||
    !Number.isFinite(groundedness) || groundedness < 0 || groundedness > 1 ||
    !Number.isFinite(specificity) || specificity < 0 || specificity > 1
  ) {
    throw new Error(`Invalid confidence scores: coverage=${coverage}, accuracy=${accuracy}, groundedness=${groundedness}, specificity=${specificity}`);
  }

  const scores: ConfidenceScores = {
    coverage: Math.round(coverage * 100) / 100,
    accuracy: Math.round(accuracy * 100) / 100,
    groundedness: Math.round(groundedness * 100) / 100,
    specificity: Math.round(specificity * 100) / 100,
  };

  const aggregate = Math.round(((scores.coverage + scores.accuracy + scores.groundedness + scores.specificity) / 4) * 100) / 100;

  return {
    scores,
    aggregate,
    verdict: deriveVerdict(aggregate),
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
  };
}

/**
 * Evaluate a repo's Gemma-generated narrative against its deterministic Pass 2 signals.
 *
 * @returns Confidence scores, aggregate, verdict, and model reasoning.
 * @throws If the Workers AI call fails or returns unparseable/invalid scores.
 */
export async function scoreRepoConfidence(
  params: ScoreRepoConfidenceParams,
  config: ScorerApiConfig,
): Promise<ConfidenceResult> {
  const systemPrompt = buildConfidenceSystemPrompt();
  const userPrompt = buildConfidenceUserPrompt(
    params.engineeringNarrative,
    params.repoSearchableProfile,
    params.pass2Signals,
  );

  const raw = await callWorkersAI(config, systemPrompt, userPrompt);
  return parseConfidenceResponse(raw);
}
