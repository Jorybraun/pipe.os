/**
 * pricing.ts — Single source of truth for LLM model pricing.
 *
 * All cost calculations for culture interview AI usage tracking flow
 * through `computeCallCost`. Adding a new model requires a single entry
 * in MODEL_PRICING — the metering layer picks it up automatically.
 *
 * Pricing sources (2025-Q1):
 *   Cloudflare Workers AI: https://developers.cloudflare.com/workers-ai/platform/pricing/
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ModelPrice {
  provider: 'cloudflare-ai' | 'mistral' | 'google-ai';
  /** USD per million input tokens */
  inputUsdPerM?: number;
  /** USD per million output tokens */
  outputUsdPerM?: number;
  /** Cloudflare Neurons per million input tokens (informational) */
  neuronsPerMInput?: number;
  /** Cloudflare Neurons per million output tokens (informational) */
  neuronsPerMOutput?: number;
  /** USD per audio minute (for STT models) */
  usdPerAudioMinute?: number;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Audio duration in seconds */
  audioSeconds?: number;
}

// ─── Model pricing table ──────────────────────────────────────────────────────

/**
 * All models used by the culture interview pipeline.
 * Unknown models cause `computeCallCost` to throw — this surfaces bugs early.
 */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  '@cf/google/gemma-4-26b-a4b-it': {
    provider: 'cloudflare-ai',
    inputUsdPerM: 0.10,
    outputUsdPerM: 0.30,
    neuronsPerMInput: 9091,
    neuronsPerMOutput: 27273,
  },
  '@cf/openai/whisper-large-v3-turbo': {
    provider: 'cloudflare-ai',
    usdPerAudioMinute: 0.0005,
  },
};

// ─── Cost calculation ─────────────────────────────────────────────────────────

/**
 * Compute the USD cost of a single model call.
 *
 * Throws `Error` for unknown models so bugs surface immediately in dev rather
 * than silently billing $0.
 *
 * Returns 0 when the model is priced but no usage fields are populated yet
 * (e.g. the provider did not return token counts).
 */
export function computeCallCost(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    throw new Error(
      `Unknown model: ${model} — add entry to MODEL_PRICING`,
    );
  }

  // Audio-based pricing (STT models)
  if (pricing.usdPerAudioMinute !== undefined) {
    const seconds = usage.audioSeconds ?? 0;
    return (seconds / 60) * pricing.usdPerAudioMinute;
  }

  // Token-based pricing (chat/completion models)
  const inputCost =
    pricing.inputUsdPerM !== undefined && usage.inputTokens !== undefined
      ? (usage.inputTokens / 1_000_000) * pricing.inputUsdPerM
      : 0;

  const outputCost =
    pricing.outputUsdPerM !== undefined && usage.outputTokens !== undefined
      ? (usage.outputTokens / 1_000_000) * pricing.outputUsdPerM
      : 0;

  return inputCost + outputCost;
}
