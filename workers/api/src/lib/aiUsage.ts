/**
 * aiUsage.ts — generic AI usage & cost tracking.
 *
 * Every AI call in the system writes one row to `ai_usage_events`. Text calls
 * are metered via `logAiUsage`; voice sessions aggregate their token totals in
 * the Durable Object and call `logAiUsage` once at session end.
 *
 * Both successful and failed calls get logged — the dashboard must be able to
 * answer "what did this interview cost me" even when things broke.
 */

import { computeCallCost, type TokenUsage } from './llm/pricing';

// ─── Types ────────────────────────────────────────────────────────────────────

export type UsageFeature =
  | 'role_discovery'
  | 'culture_interview'
  | 'live_panel'
  | 'copilot'
  | 'repo_crawl'
  | 'challenge_generation'
  | 'implementation_scoring';

export interface LogUsageInput {
  /** Which subsystem made the call. */
  feature: UsageFeature;
  /** Session-ish identifier (role_context_id, culture session_id, voice session_id, ...). */
  refId: string | null;
  /** Optional secondary reference (participant_id, candidate_id, ...). */
  subRefId?: string | null;
  /** Provider name — must match a `provider` in MODEL_PRICING. */
  provider: string;
  /** Canonical pricing key — must exist in `MODEL_PRICING`. */
  model: string;
  /** Token/audio usage totals for this call. Missing fields default to 0. */
  usage: TokenUsage;
  /** False when the call errored. Defaults to true. */
  success?: boolean;
  /** Short error description (truncated to 500 chars on write). */
  errorMessage?: string;
}

// ─── Write path ───────────────────────────────────────────────────────────────

/**
 * Persist one AI usage row. Never throws — metering must not break the
 * request path. Errors are logged via console.error for observability.
 */
export async function logAiUsage(
  db: D1Database,
  input: LogUsageInput,
): Promise<void> {
  try {
    const {
      feature,
      refId,
      subRefId = null,
      provider,
      model,
      usage,
      success = true,
      errorMessage,
    } = input;

    // Compute cost. `computeCallCost` throws on unknown models — we catch and
    // log instead of failing the write so a missing pricing entry still logs
    // tokens (with zero cost) rather than dropping the event.
    let usdCost = 0;
    try {
      usdCost = computeCallCost(model, usage);
    } catch (err) {
      console.error('[aiUsage] pricing lookup failed:', err instanceof Error ? err.message : String(err), 'model=', model);
      usdCost = 0;
    }

    await db
      .prepare(
        `INSERT INTO ai_usage_events (
           id, feature, ref_id, sub_ref_id, provider, model,
           input_tokens, output_tokens,
           input_audio_tokens, output_audio_tokens,
           audio_seconds, usd_cost, success, error_message, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
      )
      .bind(
        crypto.randomUUID(),
        feature,
        refId,
        subRefId,
        provider,
        model,
        usage.inputTokens ?? null,
        usage.outputTokens ?? null,
        usage.inputAudioTokens ?? null,
        usage.outputAudioTokens ?? null,
        usage.audioSeconds ?? null,
        usdCost,
        success ? 1 : 0,
        errorMessage ? errorMessage.slice(0, 500) : null,
        new Date().toISOString(),
      )
      .run();
  } catch (err) {
    console.error('[aiUsage] failed to log event:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Schedule `logAiUsage` via `ctx.waitUntil` when a ctx is available, else
 * await it inline. Use this in request handlers so the write happens after
 * the response flushes.
 */
export function recordAiUsage(
  db: D1Database,
  ctx: ExecutionContext | null,
  input: LogUsageInput,
): void {
  const p = logAiUsage(db, input);
  if (ctx) {
    ctx.waitUntil(p);
  } else {
    void p;
  }
}
