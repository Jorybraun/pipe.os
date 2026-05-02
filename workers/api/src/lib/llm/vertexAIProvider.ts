/**
 * Vertex AI provider — calls Vertex AI through Cloudflare AI Gateway.
 *
 * Auth: no JWT signing in the Worker. The Gateway stores the GCP service
 * account and handles OAuth2 token refresh automatically. The Worker only
 * needs a Cloudflare API token with AI Gateway read permission.
 *
 * Model: defaults to gemma-4-26b-a4b-it-maas (Vertex AI MaaS).
 *
 * Env vars (set in .dev.vars and wrangler.jsonc secrets):
 *   CF_AI_GATEWAY_URL    — full Gateway URL, e.g.
 *                          https://gateway.ai.cloudflare.com/v1/ACCOUNT_ID/GATEWAY_NAME/google-vertex-ai
 *   CF_API_TOKEN         — Cloudflare API token with AI Gateway:Read
 *   VERTEX_AI_PROJECT_ID — GCP project ID (retained for compatibility)
 *   VERTEX_AI_REGION     — GCP region (retained for compatibility)
 *   VERTEX_AI_MODEL      — model ID (default: google/gemma-4-26b-a4b-it-maas)
 */

import type { LLMProvider, LLMMessage, LLMCompletion, LLMUsage, CompleteOptions } from './types';

// ─── OpenAI-compatible wire types ─────────────────────────────────────────────

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

interface OpenAICompletionResponse {
  choices: Array<{
    message?: { content?: string };
    delta?: { content?: string };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class VertexAIProvider implements LLMProvider {
  readonly name = 'vertex-ai';
  readonly supportsTools = false;

  private _lastUsage: LLMUsage | null = null;

  constructor(
    private readonly gatewayUrl: string,
    private readonly apiToken: string,
    /** Kept for compatibility — not used in unified endpoint. */
    private readonly _projectId?: string,
    /** Kept for compatibility — not used in unified endpoint. */
    private readonly _region?: string,
    readonly model = 'google/gemma-4-26b-a4b-it-maas',
  ) {}

  getLastUsage(): LLMUsage | null {
    return this._lastUsage;
  }

  getModelKey(): string {
    const normalized = this.model.replace(/^google\//, '');
    return `vertex/${normalized}`;
  }

  /**
   * Build the unified chat completions URL through AI Gateway.
   */
  private buildUrl(stream = false): string {
    const base = this.gatewayUrl.replace(/\/$/, '').replace(/\/google-vertex-ai$/, '');
    return stream ? `${base}/compat/chat/completions?alt=sse` : `${base}/compat/chat/completions`;
  }

  /** Model name prefixed for the unified endpoint. */
  private get gatewayModel(): string {
    if (this.model.startsWith('google-vertex-ai/')) return this.model;
    return `google-vertex-ai/${this.model}`;
  }

  private toOpenAIMessages(messages: LLMMessage[]): OpenAIMessage[] {
    const result: OpenAIMessage[] = [];
    for (const m of messages) {
      if (m.role === 'tool') {
        result.push({ role: 'user', content: `Tool result (${m.toolName ?? 'unknown'}):\n${m.content ?? ''}` });
      } else {
        result.push({ role: m.role as OpenAIMessage['role'], content: m.content ?? '' });
      }
    }
    return result;
  }

  async complete(messages: LLMMessage[], options: CompleteOptions = {}): Promise<LLMCompletion> {
    const openaiMessages = this.toOpenAIMessages(messages);

    const body: Record<string, unknown> = {
      model: this.gatewayModel,
      messages: openaiMessages,
      max_tokens: options.maxTokens ?? 1024,
      stream: false,
    };
    if (options.forceJson) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(this.buildUrl(false), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-aig-authorization': `Bearer ${this.apiToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Vertex AI ${res.status}: ${err}`);
    }

    const data = (await res.json()) as OpenAICompletionResponse;
    const content = data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!content) throw new Error('Vertex AI returned empty response');

    const usage: LLMUsage | null = data.usage
      ? {
          inputTokens: data.usage.prompt_tokens ?? 0,
          outputTokens: data.usage.completion_tokens ?? 0,
        }
      : null;
    this._lastUsage = usage;
    return usage ? { content, usage } : { content };
  }

  async *completeStream(messages: LLMMessage[], options: CompleteOptions = {}): AsyncGenerator<string> {
    this._lastUsage = null;
    const openaiMessages = this.toOpenAIMessages(messages);

    const body: Record<string, unknown> = {
      model: this.gatewayModel,
      messages: openaiMessages,
      max_tokens: options.maxTokens ?? 1024,
      stream: true,
    };
    if (options.forceJson) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(this.buildUrl(true), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-aig-authorization': `Bearer ${this.apiToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Vertex AI ${res.status}: ${err}`);
    }

    if (!res.body) throw new Error('Vertex AI returned no body for stream');

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
        const payload = line.slice(6);
        if (payload === '[DONE]') return;

        try {
          const chunk = JSON.parse(payload) as OpenAICompletionResponse;
          const text = chunk.choices?.[0]?.delta?.content ?? '';
          if (text) yield text;
        } catch {
          // Ignore malformed chunks
        }
      }
    }
  }
}
