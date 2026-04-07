/**
 * Mistral provider — wraps api.mistral.ai chat completions.
 * Supports OpenAI-compatible tool/function calling.
 */

import type { LLMProvider, LLMMessage, LLMCompletion, CompleteOptions, LLMToolCall } from './types';

interface MistralToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface MistralMessage {
  role: string;
  content: string | null;
  tool_calls?: MistralToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface MistralResponse {
  choices: Array<{
    message: MistralMessage;
    finish_reason: string;
  }>;
}

function toMistralMessages(messages: LLMMessage[]): MistralMessage[] {
  return messages.map((m) => {
    const out: MistralMessage = { role: m.role, content: m.content };
    if (m.toolCalls) {
      out.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }));
    }
    if (m.toolCallId) out.tool_call_id = m.toolCallId;
    if (m.toolName) out.name = m.toolName;
    return out;
  });
}

function fromMistralToolCalls(calls: MistralToolCall[]): LLMToolCall[] {
  return calls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
  }));
}

export class MistralProvider implements LLMProvider {
  readonly name = 'mistral';
  readonly supportsTools = true;

  constructor(
    private readonly apiKey: string,
    private readonly model = 'mistral-small-latest',
  ) {}

  async complete(messages: LLMMessage[], options: CompleteOptions = {}): Promise<LLMCompletion> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options.maxTokens ?? 1024,
      messages: toMistralMessages(messages),
    };

    if (options.tools?.length) {
      body.tools = options.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = 'auto';
    }

    if (options.forceJson) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Mistral API ${res.status}: ${err}`);
    }

    const data = (await res.json()) as MistralResponse;
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('No choices in Mistral response');

    return {
      content: msg.content?.trim() ?? null,
      toolCalls: msg.tool_calls?.length ? fromMistralToolCalls(msg.tool_calls) : undefined,
    };
  }
}
