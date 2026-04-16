/**
 * Google AI provider — wraps generativelanguage.googleapis.com (Gemma 4 / Gemini).
 *
 * Tool calling is not used — Google AI's function calling schema differs from
 * OpenAI-compatible providers and Gemma 4's tool support is limited. The role
 * agent falls back to direct JSON completion when supportsTools is false.
 *
 * Thinking is controlled via thinkingConfig.thinkingLevel (Gemma 4 param).
 * Values: 'high' | 'low' | 'none'. Omitting thinkingConfig uses model default.
 * Default: null (omit) — fastest response, no explicit thinking budget.
 */

import type { LLMProvider, LLMMessage, LLMCompletion, CompleteOptions } from './types';

interface GoogleAIPart {
  text?: string;
  thought?: boolean;
}

interface GoogleAIContent {
  role: 'user' | 'model';
  parts: GoogleAIPart[];
}

interface GoogleAIResponse {
  candidates?: Array<{
    content?: {
      parts?: GoogleAIPart[];
    };
  }>;
}

/** Merge system prompt into the first user message since Google AI has no system role. */
function toGoogleAIContents(messages: LLMMessage[]): GoogleAIContent[] {
  const contents: GoogleAIContent[] = [];
  let systemText = '';

  for (const m of messages) {
    if (m.role === 'system') {
      systemText = m.content ?? '';
      continue;
    }

    const role = m.role === 'assistant' ? 'model' : 'user';
    let text = m.content ?? '';

    // Prepend system prompt to the first user message
    if (role === 'user' && systemText) {
      text = `${systemText}\n\n---\n\n${text}`;
      systemText = '';
    }

    // Tool results come back as user messages with context
    if (m.role === 'tool') {
      text = `Tool result (${m.toolName ?? 'unknown'}):\n${m.content ?? ''}`;
    }

    contents.push({ role, parts: [{ text }] });
  }

  return contents;
}

function extractText(response: GoogleAIResponse): string | null {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  // Skip thought parts, return only the final answer text
  const answerParts = parts.filter((p) => !p.thought && typeof p.text === 'string');
  const text = answerParts.map((p) => p.text).join('').trim();
  return text || null;
}

export type ThinkingLevel = 'high' | 'low' | 'none';

export class GoogleAIProvider implements LLMProvider {
  readonly name = 'google-ai';
  readonly supportsTools = false;

  constructor(
    private readonly apiKey: string,
    private readonly model = 'gemma-4-31b-it',
    /** null = omit thinkingConfig (model default). 'none' = explicitly disable. */
    private readonly thinkingLevel: ThinkingLevel | null = null,
  ) {}

  async complete(messages: LLMMessage[], options: CompleteOptions = {}): Promise<LLMCompletion> {
    const contents = toGoogleAIContents(messages);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? 1024,
        ...(this.thinkingLevel !== null
          ? { thinkingConfig: { thinkingLevel: this.thinkingLevel } }
          : {}),
        ...(options.forceJson ? { responseMimeType: 'application/json' } : {}),
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google AI API ${res.status}: ${err}`);
    }

    const data = (await res.json()) as GoogleAIResponse;
    const content = extractText(data);

    if (!content) throw new Error('Google AI returned empty response');

    return { content };
  }

  /**
   * Stream text tokens from Google AI. Uses the streamGenerateContent endpoint
   * which returns SSE-style chunks. Each chunk has the shape:
   * {"candidates":[{"content":{"parts":[{"text":"token"}]}}]}
   */
  async *completeStream(messages: LLMMessage[], options: CompleteOptions = {}): AsyncGenerator<string> {
    const contents = toGoogleAIContents(messages);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? 1024,
        ...(this.thinkingLevel !== null
          ? { thinkingConfig: { thinkingLevel: this.thinkingLevel } }
          : {}),
        ...(options.forceJson ? { responseMimeType: 'application/json' } : {}),
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?key=${this.apiKey}&alt=sse`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google AI API ${res.status}: ${err}`);
    }

    if (!res.body) {
      throw new Error('Google AI returned no body for stream');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines (data: {...}\n\n)
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') return;

        try {
          const chunk = JSON.parse(payload) as GoogleAIResponse;
          const parts = chunk.candidates?.[0]?.content?.parts ?? [];
          for (const part of parts) {
            if (!part.thought && part.text) {
              yield part.text;
            }
          }
        } catch {
          // Ignore malformed chunks
        }
      }
    }
  }
}
