/**
 * Vertex AI provider — wraps Google Cloud Vertex AI (Gemma, Gemini).
 *
 * Uses Vertex AI's generateContent endpoint with OAuth2 access token auth.
 * Get a token with: gcloud auth print-access-token
 *
 * Models available:
 * - gemma-2-27b-it (recommended for scoring)
 * - gemma-2-9b-it (faster, smaller)
 * - gemini-1.5-flash (if Gemma unavailable)
 *
 * Vertex AI has much higher rate limits than AI Studio when using GCP credits.
 */

import type { LLMProvider, LLMMessage, LLMCompletion, CompleteOptions } from './types';

interface VertexAIPart {
  text?: string;
}

interface VertexAIContent {
  role: 'user' | 'model';
  parts: VertexAIPart[];
}

interface VertexAIResponse {
  candidates?: Array<{
    content?: {
      parts?: VertexAIPart[];
    };
  }>;
  error?: {
    code: number;
    message: string;
  };
}

/** Merge system prompt into first user message since Vertex AI Gemma has no system role. */
function toVertexAIContents(messages: LLMMessage[]): VertexAIContent[] {
  const contents: VertexAIContent[] = [];
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

    if (m.role === 'tool') {
      text = `Tool result (${m.toolName ?? 'unknown'}):\n${m.content ?? ''}`;
    }

    contents.push({ role, parts: [{ text }] });
  }

  return contents;
}

function extractText(response: VertexAIResponse): string | null {
  if (response.error) {
    throw new Error(`Vertex AI error ${response.error.code}: ${response.error.message}`);
  }
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('').trim();
  return text || null;
}

export class VertexAIProvider implements LLMProvider {
  readonly name = 'vertex-ai';
  readonly supportsTools = false;

  /**
   * @param accessToken OAuth2 access token (from `gcloud auth print-access-token`)
   * @param projectId GCP project ID
   * @param region GCP region (default: us-central1)
   * @param model Vertex AI model ID (default: gemma-2-27b-it)
   */
  constructor(
    private readonly accessToken: string,
    private readonly projectId: string,
    private readonly region = 'us-central1',
    private readonly model = 'gemma-2-27b-it',
  ) {}

  async complete(messages: LLMMessage[], options: CompleteOptions = {}): Promise<LLMCompletion> {
    const contents = toVertexAIContents(messages);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? 1024,
        ...(options.forceJson ? { responseMimeType: 'application/json' } : {}),
      },
    };

    const url = `https://aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/publishers/google/models/${this.model}:generateContent`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Vertex AI ${res.status}: ${err}`);
    }

    const data = (await res.json()) as VertexAIResponse;
    const content = extractText(data);

    if (!content) throw new Error('Vertex AI returned empty response');

    return { content };
  }
}

/**
 * Helper: create VertexAIProvider from env vars.
 *
 * Required env vars:
 * - VERTEX_AI_ACCESS_TOKEN (or run `gcloud auth print-access-token`)
 * - VERTEX_AI_PROJECT_ID
 *
 * Optional:
 * - VERTEX_AI_REGION (default: us-central1)
 * - VERTEX_AI_MODEL (default: gemma-2-27b-it)
 */
export function createVertexAIProvider(env: Record<string, string | undefined>): VertexAIProvider {
  const accessToken = env['VERTEX_AI_ACCESS_TOKEN'];
  const projectId = env['VERTEX_AI_PROJECT_ID'];
  const region = env['VERTEX_AI_REGION'] ?? 'us-central1';
  const model = env['VERTEX_AI_MODEL'] ?? 'gemma-2-27b-it';

  if (!accessToken) throw new Error('VERTEX_AI_ACCESS_TOKEN env var required');
  if (!projectId) throw new Error('VERTEX_AI_PROJECT_ID env var required');

  return new VertexAIProvider(accessToken, projectId, region, model);
}
