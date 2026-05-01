/**
 * meteredProvider.ts — Culture interview AI cost metering.
 *
 * Wraps an `LLMProvider` to intercept `complete()` calls and asynchronously
 * log a `culture_ai_usage_events` row to D1 after each completion.
 *
 * Design principles:
 * - NEVER throws into the request path. All metering errors are caught and
 *   logged with `console.error` so a DB hiccup cannot fail a candidate's
 *   interview response.
 * - Non-blocking: when an `ExecutionContext` is supplied the DB write is
 *   scheduled via `ctx.waitUntil()`. When the call originates from a
 *   background job (no ctx available), a plain `await` is used instead —
 *   the job is already async so blocking there is acceptable.
 * - Unknown models: `computeCallCost` throws for unknown models, which we
 *   intentionally let bubble up so misconfiguration surfaces in dev.
 *
 * TODO: `logCultureSttEvent` is ready for when voice responses land. Wire it
 * into the STT path in `workers/api/src/routes/screening/culture.ts` once
 * the voice response endpoint is built (Phase D).
 */

import type { LLMProvider, LLMMessage, LLMCompletion, CompleteOptions } from './types';
import { computeCallCost } from './pricing';

// ─── Feature tag ──────────────────────────────────────────────────────────────

export type CultureFeatureTag = 'conversation' | 'scoring' | 'synthesis' | 'stt';

// ─── Internal DB write helper ─────────────────────────────────────────────────

interface UsageEventRow {
  sessionId: string;
  feature: CultureFeatureTag;
  model: string;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  audioSeconds: number | undefined;
  usdCost: number;
}

async function insertUsageEvent(db: D1Database, row: UsageEventRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO culture_ai_usage_events
         (id, session_id, feature, model, input_tokens, output_tokens, audio_seconds, usd_cost, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      crypto.randomUUID(),
      row.sessionId,
      row.feature,
      row.model,
      row.inputTokens ?? null,
      row.outputTokens ?? null,
      row.audioSeconds ?? null,
      row.usdCost,
      new Date().toISOString(),
    )
    .run();
}

// ─── Metered provider wrapper ─────────────────────────────────────────────────

class MeteredCultureProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;
  readonly supportsTools: boolean;

  constructor(
    private readonly inner: LLMProvider,
    private readonly sessionId: string,
    private readonly feature: CultureFeatureTag,
    private readonly db: D1Database,
    private readonly ctx: ExecutionContext | null,
  ) {
    this.name = inner.name;
    this.model = inner.model;
    this.supportsTools = inner.supportsTools;
  }

  async complete(messages: LLMMessage[], options?: CompleteOptions): Promise<LLMCompletion> {
    const completion = await this.inner.complete(messages, options);

    const model = this.inner.model;

    const logEvent = async (): Promise<void> => {
      try {
        // Build TokenUsage without undefined values (exactOptionalPropertyTypes).
        const tokenUsage: import('./pricing').TokenUsage = {};
        if (completion.usage?.inputTokens !== undefined) {
          tokenUsage.inputTokens = completion.usage.inputTokens;
        }
        if (completion.usage?.outputTokens !== undefined) {
          tokenUsage.outputTokens = completion.usage.outputTokens;
        }

        const usdCost = computeCallCost(model, tokenUsage);

        await insertUsageEvent(this.db, {
          sessionId: this.sessionId,
          feature: this.feature,
          model,
          inputTokens: completion.usage?.inputTokens,
          outputTokens: completion.usage?.outputTokens,
          audioSeconds: undefined,
          usdCost,
        });
      } catch (err) {
        console.error('[cultureMetering] failed to log event:', err);
      }
    };

    if (this.ctx !== null) {
      this.ctx.waitUntil(logEvent());
    } else {
      // Background job (runScoringJob): already async, plain await is fine.
      await logEvent();
    }

    return completion;
  }
}

// ─── Public factory ───────────────────────────────────────────────────────────

/**
 * Wrap a provider with culture interview cost metering.
 *
 * Pass `ctx` when available (request handlers). Omit / pass `null` when
 * calling from a background job that already runs inside `waitUntil`.
 *
 * @example — request handler
 * ```ts
 * const provider = withCultureMetering(
 *   createCultureAgentProvider(env),
 *   sessionId,
 *   'conversation',
 *   env.DB,
 *   c.executionCtx,
 * );
 * ```
 *
 * @example — background scoring job
 * ```ts
 * const provider = withCultureMetering(
 *   createCultureAgentProvider(env),
 *   sessionId,
 *   'scoring',
 *   env.DB,
 *   null,   // no ctx available inside runScoringJob
 * );
 * ```
 */
export function withCultureMetering(
  provider: LLMProvider,
  sessionId: string,
  feature: 'conversation' | 'scoring' | 'synthesis',
  db: D1Database,
  ctx: ExecutionContext | null,
): LLMProvider {
  return new MeteredCultureProvider(provider, sessionId, feature, db, ctx);
}

// ─── STT helper ──────────────────────────────────────────────────────────────

/**
 * Log a culture STT usage event directly (STT does not go through LLMProvider).
 *
 * TODO: Wire into the voice response path when the voice endpoint lands
 * (Phase D). The helper is ready — just call it after each Whisper transcription
 * in the culture candidate route.
 */
export async function logCultureSttEvent(args: {
  db: D1Database;
  sessionId: string;
  audioSeconds: number;
  model: string; // '@cf/openai/whisper-large-v3-turbo'
  ctx: ExecutionContext | null;
}): Promise<void> {
  const { db, sessionId, audioSeconds, model, ctx } = args;

  const logEvent = async (): Promise<void> => {
    try {
      const usdCost = computeCallCost(model, { audioSeconds });
      await insertUsageEvent(db, {
        sessionId,
        feature: 'stt',
        model,
        inputTokens: undefined,
        outputTokens: undefined,
        audioSeconds,
        usdCost,
      });
    } catch (err) {
      console.error('[cultureMetering] failed to log STT event:', err);
    }
  };

  if (ctx !== null) {
    ctx.waitUntil(logEvent());
  } else {
    await logEvent();
  }
}
