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
    private readonly model = 'kimi-for-coding',
    private readonly baseUrl = 'https://api.kimi.com/coding/v1',
  ) {}

  async complete(messages: LLMMessage[], options: CompleteOptions = {}): Promise<LLMCompletion> {
    const openaiMessages = toOpenAIMessages(messages);
    const forceJson = options.forceJson === true;

    const body: Record<string, unknown> = {
      model: this.model,
      messages: openaiMessages,
      max_tokens: options.maxTokens ?? 1024,
      temperature: 0.2,
    };

    if (forceJson) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'User-Agent': 'Kilo-Code/1.0.0',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Kimi API ${res.status}: ${err}`);
    }

    const data = (await res.json()) as OpenAIChatCompletionResponse;
    const message = data.choices?.[0]?.message;
    let rawText = message?.content ?? '';

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
   * Stream text tokens from Kimi. Uses SSE streaming via the standard
   * OpenAI chat completions endpoint with stream: true.
   */
  async *completeStream(messages: LLMMessage[], options: CompleteOptions = {}): AsyncGenerator<string> {
    const openaiMessages = toOpenAIMessages(messages);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: openaiMessages,
      max_tokens: options.maxTokens ?? 1024,
      temperature: 0.2,
      stream: true,
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'User-Agent': 'Kilo-Code/1.0.0',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Kimi API streaming ${res.status}: ${err}`);
    }

    if (!res.body) {
      throw new Error('Kimi returned no body for stream');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;

        try {
          const chunk = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch {
          // Ignore malformed SSE chunks
        }
      }
    }
  }
}
