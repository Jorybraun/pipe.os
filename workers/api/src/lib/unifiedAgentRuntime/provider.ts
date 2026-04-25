/**
 * Unified Agent Runtime — Provider Wrapper
 *
 * Wraps LLMProvider with cross-cutting concerns:
 *   - Retry with exponential backoff (max 3 attempts)
 *   - Cost tracking callback
 *   - Force-JSON enforcement
 *   - Timeout handling (30s network)
 */

import type { LLMProvider, LLMMessage, CompleteOptions } from '../llm/types';
import type { ProviderCallOptions, ProviderCallResult, UsageCallback } from './types';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;
const NETWORK_TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('abort') ||
      msg.includes('rate limit') ||
      msg.includes('429') ||
      msg.includes('503') ||
      msg.includes('502') ||
      msg.includes('500') ||
      msg.includes('max retries') ||
      msg.includes('3050') ||
      msg.includes('fetch failed') ||
      msg.includes('network')
    );
  }
  return false;
}

function stripJsonFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function buildOptions(opts: ProviderCallOptions): CompleteOptions {
  const result: CompleteOptions = {};
  if (opts.forceJson !== undefined) result.forceJson = opts.forceJson;
  if (opts.maxTokens !== undefined) result.maxTokens = opts.maxTokens;
  if (opts.tools !== undefined) result.tools = opts.tools;
  return result;
}

export async function callProvider(
  provider: LLMProvider,
  messages: LLMMessage[],
  options: ProviderCallOptions = { forceJson: undefined, maxTokens: undefined, tools: undefined, budgetLabel: undefined, signal: undefined },
  onUsage?: UsageCallback,
): Promise<ProviderCallResult> {
  const { forceJson, budgetLabel, signal } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const timeoutSignal = AbortSignal.timeout(NETWORK_TIMEOUT_MS);
      const compositeSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;

      if (compositeSignal.aborted) {
        throw new Error('Request aborted');
      }

      const completion = await provider.complete(messages, buildOptions(options));

      const content = completion.content?.trim() ?? '';

      if (onUsage && completion.usage) {
        await Promise.resolve(
          onUsage({
            budgetLabel,
            inputTokens: completion.usage.inputTokens,
            outputTokens: completion.usage.outputTokens,
            model: provider.name,
          }),
        );
      }

      if (forceJson && content) {
        const cleaned = stripJsonFences(content);
        if (!isValidJson(cleaned)) {
          console.warn(`[provider] JSON enforcement failed on attempt ${attempt}, content:`, content.slice(0, 200));
          if (attempt < MAX_RETRIES) {
            const retryMessages: LLMMessage[] = [
              ...messages,
              { role: 'assistant', content: content },
              { role: 'user', content: 'Your previous response was not valid JSON. Respond with ONLY a valid JSON object — no markdown fences, no prose.' },
            ];
            messages = retryMessages;
            lastError = new Error('JSON enforcement — re-prompting');
            await sleep(INITIAL_BACKOFF_MS * attempt);
            continue;
          }
        }
      }

      return {
        content,
        usage: completion.usage
          ? {
              inputTokens: completion.usage.inputTokens,
              outputTokens: completion.usage.outputTokens,
            }
          : undefined,
      };
    } catch (err) {
      lastError = err;

      if (err instanceof Error && err.message.includes('abort')) {
        throw err;
      }

      if (isRetryableError(err) && attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        console.warn(`[provider] Attempt ${attempt} failed, retrying in ${backoff}ms…`);
        await sleep(backoff);
        continue;
      }

      throw err;
    }
  }

  throw lastError ?? new Error('Provider call failed after max retries');
}
