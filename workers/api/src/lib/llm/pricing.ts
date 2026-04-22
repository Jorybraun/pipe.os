/**
 * pricing.ts — Single source of truth for LLM model pricing.
 *
 * All cost calculations flow through `computeCallCost`. Adding a new model
 * requires a single entry in MODEL_PRICING.
 *
 * Pricing sources (2026-Q2, current as of 2026-04-17):
 *   Cloudflare Workers AI: https://developers.cloudflare.com/workers-ai/platform/pricing/
 *   Vertex AI:             https://cloud.google.com/vertex-ai/generative-ai/pricing
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PricingProvider =
  | 'cloudflare-ai'
  | 'google-ai'
  | 'vertex-ai'
  | 'vertex-live';

export interface ModelPrice {
  provider: PricingProvider;
  /** USD per million input text tokens */
  inputUsdPerM?: number;
  /** USD per million output text tokens */
  outputUsdPerM?: number;
  /** USD per million input audio tokens (Live API) */
  inputAudioUsdPerM?: number;
  /** USD per million output audio tokens (Live API) */
  outputAudioUsdPerM?: number;
  /** Cloudflare Neurons per million input tokens (informational) */
  neuronsPerMInput?: number;
  /** Cloudflare Neurons per million output tokens (informational) */
  neuronsPerMOutput?: number;
  /** USD per audio minute (for flat-rate STT models like Whisper) */
  usdPerAudioMinute?: number;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Audio input tokens (Live API). */
  inputAudioTokens?: number;
  /** Audio output tokens (Live API). */
  outputAudioTokens?: number;
  /** Audio duration in seconds (Whisper / approximate Live accounting). */
  audioSeconds?: number;
}

// ─── Model pricing table ──────────────────────────────────────────────────────

export const MODEL_PRICING: Record<string, ModelPrice> = {
  // Cloudflare Workers AI
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

  // Vertex AI — Gemma 4 (Role Discovery).
  // Free tier ended 2026-04-16; rates below are in effect starting 2026-04-17.
  'vertex/gemma-4-26b-a4b-it': {
    provider: 'vertex-ai',
    inputUsdPerM: 0.15,
    outputUsdPerM: 0.60,
  },
  'vertex/gemma-4-26b-a4b-it-maas': {
    provider: 'vertex-ai',
    inputUsdPerM: 0.15,
    outputUsdPerM: 0.60,
  },

  // Vertex AI — Gemini 2.5 Flash Live API (voice interviews; TTS+STT combined).
  // Session context window billing: every turn re-charges accumulated tokens.
  'vertex/gemini-live-2.5-flash-native-audio': {
    provider: 'vertex-live',
    inputUsdPerM: 0.50,
    outputUsdPerM: 2.00,
    inputAudioUsdPerM: 3.00,
    outputAudioUsdPerM: 12.00,
  },
};

// ─── Cost calculation ─────────────────────────────────────────────────────────

/**
 * Compute the USD cost of a single model call.
 *
 * Throws `Error` for unknown models so misconfiguration surfaces immediately
 * rather than silently billing $0.
 */
export function computeCallCost(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    throw new Error(`Unknown model: ${model} — add entry to MODEL_PRICING`);
  }

  // Flat-rate audio (Whisper-style)
  if (pricing.usdPerAudioMinute !== undefined) {
    const seconds = usage.audioSeconds ?? 0;
    return (seconds / 60) * pricing.usdPerAudioMinute;
  }

  const perM = (tokens: number | undefined, rate: number | undefined): number =>
    tokens !== undefined && rate !== undefined ? (tokens / 1_000_000) * rate : 0;

  const inputCost       = perM(usage.inputTokens,        pricing.inputUsdPerM);
  const outputCost      = perM(usage.outputTokens,       pricing.outputUsdPerM);
  const inputAudioCost  = perM(usage.inputAudioTokens,   pricing.inputAudioUsdPerM);
  const outputAudioCost = perM(usage.outputAudioTokens,  pricing.outputAudioUsdPerM);

  return inputCost + outputCost + inputAudioCost + outputAudioCost;
}
