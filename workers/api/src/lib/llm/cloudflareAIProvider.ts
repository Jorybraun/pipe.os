/**
 * Cloudflare Workers AI provider — wraps env.AI.run() for Gemma 4.
 *
 * Default model: @cf/google/gemma-4-26b-a4b-it
 * Pricing: $0.10 per M input tokens, $0.30 per M output tokens
 * (~1.5¢ per culture interview including scoring, per ADR-029).
 *
 * The binding is already live in wrangler.toml — transcribe.ts uses the same
 * env.AI binding for Whisper. No API key needed.
 *
 * Tool calling is NOT exposed by this provider. Gemma's tool support on
 * Workers AI is limited and the culture agent (ADR-029) uses a deterministic
 * FSM rather than ReAct-with-tools, so supportsTools = false is correct.
 *
 * Forced-JSON mode prepends a JSON-only instruction to the system message
 * rather than using a response_format parameter, because Workers AI's
 * response_format support varies by model and Gemma 4 does not currently
 * honor it reliably.
 */

import type { LLMProvider, LLMMessage, LLMCompletion, CompleteOptions } from './types';

// Workers AI chat messages use OpenAI-compatible roles.
interface CFChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface CFChatResponse {
  response?: string;
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

  constructor(
    private readonly ai: Ai,
    private readonly model: string = '@cf/google/gemma-4-26b-a4b-it',
  ) {}

  async complete(messages: LLMMessage[], options: CompleteOptions = {}): Promise<LLMCompletion> {
    const forceJson = options.forceJson === true;
    const cfMessages = toCFMessages(messages, forceJson);

    const input = {
      messages: cfMessages,
      max_tokens: options.maxTokens ?? 1024,
    };

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
    } else {
      // Try alternate response shapes
      const any = result as Record<string, unknown>;
      // { choices: [{ message: { content: "..." } }] }
      const choices = any['choices'] as Array<{ message?: { content?: string } }> | undefined;
      if (choices?.[0]?.message?.content) {
        rawText = choices[0].message.content.trim();
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
}
