/**
 * Kimi API provider — wraps api.moonshot.cn/v1 (OpenAI-compatible chat completions).
 *
 * Default model: kimi-for-coding (coding-agent endpoint, maps to kimi-k2-6).
 * Base URL: https://api.kimi.com/coding/v1
 *
 * Follows the same pattern as the agent-harness (agent_harness/swarm/graph.py):
 * - Uses standard OpenAI chat completions format
 * - Sends User-Agent: claude-code/0.1 header for tracking
 * - Supports JSON mode via forceJson option
 *
 * Environment:
 *   KIMI_API_KEY    — required API key
 *   KIMI_BASE_URL   — optional override (default: https://api.kimi.com/coding/v1)
 *   KIMI_SCORER_MODEL — optional model override (default: kimi-for-coding)
 */

import type { LLMProvider, LLMMessage, LLMCompletion, CompleteOptions } from './types';

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function toOpenAIMessages(messages: LLMMessage[]): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({
        role: 'tool',
        content: m.content ?? '',
        tool_call_id: m.toolCallId ?? 'unknown',
      });
      continue;
    }
    out.push({ role: m.role, content: m.content ?? '' });
  }
  return out;
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) return fenceMatch[1]!.trim();
  return trimmed;
}

export class KimiProvider implements LLMProvider {
  readonly name = 'kimi';
  readonly supportsTools = false;

  constructor(
    private readonly apiKey: string,
    readonly model = 'kimi-for-coding',
    private readonly baseUrl = 'https://api.kimi.com/coding/v1',
  ) {}

  async complete(messages: LLMMessage[], options: CompleteOptions = {}): Promise<LLMCompletion> {
    const openaiMessages = toOpenAIMessages(messages);
    const forceJson = options.forceJson === true;
    const startMs = Date.now();

    const body: Record<string, unknown> = {
      model: this.model,
      messages: openaiMessages,
      max_tokens: options.maxTokens ?? 4096,
      temperature: 0.2,
    };

    if (forceJson) {
      body.response_format = { type: 'json_object' };
    }

    console.log(`[KimiProvider] POST ${this.baseUrl}/chat/completions model=${this.model} messages=${messages.length} maxTokens=${options.maxTokens ?? 4096}`);

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'User-Agent': 'claude-code/0.1',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Kimi API ${res.status}: ${err}`);
    }

    const data = (await res.json()) as OpenAIChatCompletionResponse;
    const elapsed = Date.now() - startMs;
    const msg = data.choices?.[0]?.message;
    console.log(`[KimiProvider] ${elapsed}ms | contentLen=${msg?.content?.length ?? 0} reasoningLen=${msg?.reasoning_content?.length ?? 0} promptTokens=${data.usage?.prompt_tokens ?? '?'} completionTokens=${data.usage?.completion_tokens ?? '?'}`);
    const message = data.choices?.[0]?.message;
    const contentText = message?.content ?? '';
    const reasoningText = message?.reasoning_content ?? '';

    // Kimi k2.6 is non-deterministic about where it places output:
    // - Usually JSON is in `content` and reasoning in `reasoning_content`
    // - Sometimes reasoning ends up in `content` and JSON is nowhere
    // - Occasionally JSON is in `reasoning_content`
    // Pick the field that looks most like JSON (starts with '{' after trimming).
    const contentLooksLikeJson = contentText.trim().startsWith('{');
    const reasoningLooksLikeJson = reasoningText.trim().startsWith('{');

    let rawText = '';
    if (contentLooksLikeJson) {
      rawText = contentText;
    } else if (reasoningLooksLikeJson) {
      rawText = reasoningText;
    } else if (contentText) {
      rawText = contentText;
    } else if (reasoningText) {
      rawText = reasoningText;
    }

    if (!rawText && !message?.tool_calls?.length) {
      throw new Error('Kimi returned empty response');
    }

    const content = forceJson ? stripJsonFences(rawText) : rawText;

    const usage: import('./types').LLMUsage = {};
    if (data.usage?.prompt_tokens !== undefined) {
      usage.inputTokens = data.usage.prompt_tokens;
    }
    if (data.usage?.completion_tokens !== undefined) {
      usage.outputTokens = data.usage.completion_tokens;
    }

    if (Object.keys(usage).length > 0) {
      return { content, usage };
    }
    return { content };
  }

  /**
   * Stream text tokens from Kimi.
   *
   * WORKAROUND: Kimi's coding endpoint (kimi-for-coding) sends all streaming
   * tokens in `delta.reasoning_content` instead of `delta.content` when
   * `response_format: {type: "json_object"}` is used, leaving `content` empty.
   * Rather than stream reasoning tokens (which include the model's internal
   * monologue), we delegate to the non-streaming `complete()` and yield the
   * full response as a single chunk. This preserves the streaming interface
   * while ensuring valid JSON output.
   */
  async *completeStream(messages: LLMMessage[], options: CompleteOptions = {}): AsyncGenerator<string> {
    const completion = await this.complete(messages, options);
    const text = completion.content ?? '';
    if (text) yield text;
  }
}
