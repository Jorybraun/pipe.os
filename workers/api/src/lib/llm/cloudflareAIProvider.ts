/**
 * Cloudflare Workers AI provider — wraps env.AI.run() for text generation.
 *
 * Default model: @cf/google/gemma-4-26b-a4b-it
 * Override via CLOUDFLARE_AI_MODEL env var.
 *
 * The binding is already live in wrangler.toml — transcribe.ts uses the same
 * env.AI binding for Whisper. No API key needed.
 *
 * Tool calling is NOT exposed by this provider. The culture agent (ADR-029)
 * uses a deterministic FSM rather than ReAct-with-tools, so supportsTools =
 * false is correct.
 *
 * Forced-JSON mode uses prompt-level JSON enforcement because Workers AI
 * models have inconsistent response_format support across families.
 */

import type { LLMProvider, LLMMessage, LLMCompletion, CompleteOptions } from './types';

export const DEFAULT_CLOUDFLARE_MODEL = '@cf/google/gemma-4-26b-a4b-it';

const DEPRECATED_CLOUDFLARE_MODEL_REPLACEMENTS: Record<string, string> = {
  '@cf/meta/llama-3.1-8b-instruct': DEFAULT_CLOUDFLARE_MODEL,
  '@cf/meta/llama-3.1-8b-instruct-awq': DEFAULT_CLOUDFLARE_MODEL,
  '@cf/meta/llama-3.1-8b-instruct-fast': DEFAULT_CLOUDFLARE_MODEL,
  '@cf/meta/llama-3.1-8b-instruct-fp8': DEFAULT_CLOUDFLARE_MODEL,
};

export function normalizeCloudflareAIModel(model: string): string {
  const replacement = DEPRECATED_CLOUDFLARE_MODEL_REPLACEMENTS[model];
  if (!replacement) return model;
  console.warn(`[cloudflareAIProvider] Workers AI model ${model} is deprecated; using ${replacement} instead.`);
  return replacement;
}

// Workers AI chat messages use OpenAI-compatible roles.
interface CFChatMessage {
  role?: 'system' | 'user' | 'assistant';
  content?: string | null;
  reasoning?: string | null;
  function_call?: unknown | null;
  audio?: unknown | null;
  annotations?: unknown | null;
}

interface CFChatChoice {
  message?: CFChatMessage;
  finish_reason?: string;
  index?: number;
  logprobs?: unknown | null;
}

interface CFChatResponse {
  response?: string;
  choices?: CFChatChoice[];
  // Workers AI also exposes usage when available
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** Translate standardized LLMMessage[] into Workers AI chat messages. */
function toCFMessages(messages: LLMMessage[], forceJson: boolean): CFChatMessage[] {
  const out: CFChatMessage[] = [];

  // If forceJson is set, prepend a strict JSON-only instruction to whichever
  // message becomes the system message. Workers AI's Gemma does not honor
  // response_format reliably, so this prompt-level enforcement is the floor.
  const jsonInstruction =
    'You MUST respond with a single valid JSON object and nothing else. No markdown code fences, no prose, no commentary. Your entire response must parse as JSON.';

  let systemPrependDone = false;

  for (const m of messages) {
    if (m.role === 'tool') {
      // Culture agent does not use tools, but keep this path for future use.
      out.push({
        role: 'user',
        content: `Tool result (${m.toolName ?? 'unknown'}):\n${m.content ?? ''}`,
      });
      continue;
    }

    let content = m.content ?? '';

    if (m.role === 'system' && forceJson && !systemPrependDone) {
      content = `${jsonInstruction}\n\n${content}`;
      systemPrependDone = true;
    }

    out.push({ role: m.role, content });
  }

  // If there was no system message and forceJson is set, inject one at the front.
  if (forceJson && !systemPrependDone) {
    out.unshift({ role: 'system', content: jsonInstruction });
  }

  return out;
}

/**
 * Strip markdown code fences from a model response. Gemma 4 frequently wraps
 * JSON in ```json ... ``` blocks even when explicitly asked not to. Called
 * only when forceJson was requested.
 */
function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  // ```json ... ```  or  ``` ... ```
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) return fenceMatch[1]!.trim();
  return trimmed;
}

export class CloudflareAIProvider implements LLMProvider {
  readonly name = 'cloudflare-ai';
  readonly supportsTools = false;
  readonly model: string;

  constructor(
    private readonly ai: Ai,
    model: string = DEFAULT_CLOUDFLARE_MODEL,
  ) {
    this.model = normalizeCloudflareAIModel(model);
  }

  async complete(messages: LLMMessage[], options: CompleteOptions = {}): Promise<LLMCompletion> {
    const forceJson = options.forceJson === true;
    const cfMessages = toCFMessages(messages, forceJson);

    const input: Record<string, unknown> = {
      messages: cfMessages,
    };
    // Only cap output tokens when explicitly requested. Omitting max_tokens lets
    // the model use its own default ceiling, which is often higher than 1024
    // and prevents premature truncation during batch generation.
    if (options.maxTokens !== undefined && options.maxTokens > 0) {
      input.max_tokens = options.maxTokens;
    }

    // NOTE: We intentionally do NOT set `response_format` here.
    // Cloudflare Workers AI models have inconsistent support for `json_object`
    // vs `json_schema`; relying on the system prompt JSON instruction plus
    // `stripJsonFences` post-processing is more portable.

    let result: CFChatResponse;
    try {
      result = (await this.ai.run(
        this.model as Parameters<typeof this.ai.run>[0],
        input as unknown as Parameters<typeof this.ai.run>[1],
      )) as CFChatResponse;
    } catch (err) {
      console.error('[cloudflareAIProvider] ai.run failed:', err);
      throw new Error(
        `Cloudflare Workers AI call failed for model ${this.model}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Workers AI may return { response: "..." } or newer chat format with
    // { result: { response: "..." } } or { choices: [{ message: { content } }] }.
    // Log and normalize.
    console.log('[cloudflareAIProvider] raw result keys:', Object.keys(result), 'response type:', typeof result.response);
    if (typeof result.response !== 'string' && result.response !== null && result.response !== undefined) {
      console.log('[cloudflareAIProvider] full result:', JSON.stringify(result).slice(0, 500));
    }

    let rawText = '';
    if (typeof result.response === 'string') {
      rawText = result.response.trim();
    } else if (Array.isArray(result.choices) && result.choices.length > 0) {
      const choice = result.choices[0]!;
      const msg = choice.message;
      if (typeof msg?.content === 'string' && msg.content.length > 0) {
        rawText = msg.content.trim();
      } else if (typeof msg?.reasoning === 'string' && msg.reasoning.length > 0) {
        // Some reasoning models (e.g. Gemma 4) return thinking text in
        // message.reasoning when content is null. Fall back to it so callers
        // get *something* instead of an opaque "empty response" error.
        console.warn(
          `[cloudflareAIProvider] model ${this.model} returned empty content; falling back to message.reasoning (finish_reason=${choice.finish_reason ?? 'unknown'})`
        );
        rawText = msg.reasoning.trim();
      }
    }
    if (!rawText) {
      console.error('[cloudflareAIProvider] Empty response. Full result:', JSON.stringify(result).slice(0, 500));
      throw new Error(`Cloudflare Workers AI returned empty response for model ${this.model}`);
    }

    const content = forceJson ? stripJsonFences(rawText) : rawText;

    // Populate usage when the Workers AI response includes token counts.
    // Must not include usage: undefined — exactOptionalPropertyTypes requires omission.
    if (result.usage) {
      const usage: import('./types').LLMUsage = {};
      if (result.usage.prompt_tokens !== undefined) {
        usage.inputTokens = result.usage.prompt_tokens;
      }
      if (result.usage.completion_tokens !== undefined) {
        usage.outputTokens = result.usage.completion_tokens;
      }
      return { content, usage };
    }

    return { content };
  }

  /**
   * Stream text tokens from Workers AI. Workers AI returns SSE data when
   * stream: true is set. Each data event has the shape {"response":"token"}.
   * Final event is [DONE].
   *
   * Falls back to yielding the full response as one chunk when the model
   * returns a non-stream result (some models ignore stream: true).
   */
  async *completeStream(messages: LLMMessage[], options: CompleteOptions = {}): AsyncGenerator<string> {
    const forceJson = options.forceJson === true;
    const cfMessages = toCFMessages(messages, forceJson);

    const input = {
      messages: cfMessages,
      max_tokens: options.maxTokens ?? 1024,
      stream: true,
    };

    let result: unknown;
    try {
      result = await this.ai.run(
        this.model as Parameters<typeof this.ai.run>[0],
        input as unknown as Parameters<typeof this.ai.run>[1],
      );
    } catch (err) {
      console.error('[cloudflareAIProvider] completeStream ai.run failed:', err);
      throw new Error(
        `Cloudflare Workers AI streaming call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Workers AI returns a ReadableStream when stream: true is honoured.
    // Some models fall back to returning the complete response object instead.
    if (!(result instanceof ReadableStream)) {
      const response = (result as { response?: string }).response ?? '';
      if (response) yield forceJson ? stripJsonFences(response.trim()) : response.trim();
      return;
    }

    const reader = (result as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE lines end with \n; process all complete lines
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trimEnd();
        buffer = buffer.slice(newlineIdx + 1);

        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;

        try {
          const event = JSON.parse(payload) as { response?: string };
          if (event.response) yield event.response;
        } catch {
          // Ignore malformed SSE chunks
        }
      }
    }
  }
}
