/**
 * Explainer Agent — Blind Comprehension Review
 *
 * Calls Devstral (Mistral) via the OpenAI-compatible Chat Completions API
 * to answer candidate questions about a PR they're reviewing blind.
 *
 * Unlike the implementer agent (which responds to bug-finding annotations),
 * the explainer agent answers free-form questions with markdown + mermaid diagrams.
 *
 * Same provider abstraction: Workers AI / Mistral / Anthropic.
 * When MISTRAL_API_KEY is not set, returns mock responses for testing.
 */

import { buildExplainerSystemPrompt, type RepoKnowledgeInput } from './explainerPrompts';
import { getMockExplainerResponse } from './mockResponses';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ContextTag = 'architecture' | 'data_flow' | 'surrounding_code' | 'trade_off' | 'problem_context' | 'integration';
export type DepthLevel = 'surface' | 'moderate' | 'deep';

export interface ComprehensionQuestion {
  text: string;
  file?: string;
  line?: number;
}

export interface ExplainerResponse {
  content: string;
  context_provided: ContextTag[];
  depth_level: DepthLevel;
}

export interface ComprehensionExchange {
  round: number;
  question: ComprehensionQuestion;
  answer: ExplainerResponse;
}

export type LLMProvider = 'workers-ai' | 'mistral' | 'anthropic' | 'google-ai';

export interface CallExplainerAgentInput {
  apiKey: string;
  provider?: LLMProvider;
  ai?: Ai;
  prBrief: string;
  prDiff: string;
  repoKnowledge: RepoKnowledgeInput | null;
  previousExchanges: ComprehensionExchange[];
  newQuestion: ComprehensionQuestion;
}

// ─── LLM API response shapes ───────────────────────────────────────────────

interface MistralChoice {
  message: { role: string; content: string };
}

interface MistralResponse {
  choices: MistralChoice[];
}

interface AnthropicMessage {
  content: Array<{ type: string; text: string }>;
}

const VALID_CONTEXT_TAGS: ContextTag[] = ['architecture', 'data_flow', 'surrounding_code', 'trade_off', 'problem_context', 'integration'];
const VALID_DEPTH_LEVELS: DepthLevel[] = ['surface', 'moderate', 'deep'];

// ─── Provider-specific API calls ────────────────────────────────────────────

async function callWorkersAI(ai: Ai, systemPrompt: string, userMessage: string): Promise<string> {
  const response = await ai.run(
    '@cf/qwen/qwen2.5-coder-32b-instruct',
    {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 4096,
    },
  );

  if (response instanceof ReadableStream) {
    const reader = response.getReader();
    const chunks: string[] = [];
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (result.value) chunks.push(new TextDecoder().decode(result.value));
    }
    return chunks.join('').trim();
  }

  const raw = (response as { response?: unknown }).response;
  if (typeof raw === 'string') return raw.trim();
  if (raw != null) {
    console.warn('[explainerAgent] Workers AI response.response is not a string:', typeof raw);
    return String(raw).trim();
  }
  return '';
}

async function callMistral(apiKey: string, systemPrompt: string, userMessage: string): Promise<string> {
  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'devstral-latest',
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[explainerAgent] Mistral API error', { status: response.status, body: errorText });
    return '';
  }

  const data = (await response.json()) as MistralResponse;
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

async function callAnthropic(apiKey: string, systemPrompt: string, userMessage: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[explainerAgent] Anthropic API error', { status: response.status, body: errorText });
    return '';
  }

  const data = (await response.json()) as AnthropicMessage;
  return data.content?.find((b) => b.type === 'text')?.text?.trim() ?? '';
}

async function callGoogleAI(apiKey: string, systemPrompt: string, userMessage: string): Promise<string> {
  const model = 'gemma-4-31b-it';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const combinedPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: combinedPrompt }] }],
      generationConfig: { maxOutputTokens: 4096, responseMimeType: 'application/json' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[explainerAgent] Google AI error', { status: response.status, body: errorText });
    return '';
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim();
}

// ─── User message builder ───────────────────────────────────────────────────

function buildUserMessage(
  previousExchanges: ComprehensionExchange[],
  newQuestion: ComprehensionQuestion,
): string {
  const parts: string[] = [];

  if (previousExchanges.length > 0) {
    parts.push('CONVERSATION SO FAR:\n');
    for (const ex of previousExchanges) {
      const location = ex.question.file
        ? ` (referencing ${ex.question.file}${ex.question.line ? `:${ex.question.line}` : ''})`
        : '';
      parts.push(`Q${ex.round}${location}: ${ex.question.text}`);
      parts.push(`A${ex.round}: ${ex.answer.content}`);
      parts.push('');
    }
  }

  const location = newQuestion.file
    ? ` (referencing ${newQuestion.file}${newQuestion.line ? `:${newQuestion.line}` : ''})`
    : '';
  parts.push(`NEW QUESTION${location}:\n${newQuestion.text}`);
  parts.push('\nAnswer this question as the PR author. Return the JSON object as instructed.');

  return parts.join('\n');
}

// ─── Agent call ─────────────────────────────────────────────────────────────

/**
 * Calls the configured LLM to get an explainer response to the candidate's question.
 *
 * Falls back to mock responses when:
 * - apiKey is empty / missing
 * - The API call fails
 */
export async function callExplainerAgent(
  input: CallExplainerAgentInput,
): Promise<ExplainerResponse> {
  const { apiKey, provider = 'workers-ai', ai, prBrief, prDiff, repoKnowledge, previousExchanges, newQuestion } = input;

  // Return mock response when API key is not configured (for testing)
  if (!apiKey && provider !== 'workers-ai') {
    console.log('[explainerAgent] No API key configured. Returning mock response for testing.');
    return getMockExplainerResponse(newQuestion);
  }

  if (provider === 'workers-ai' && !ai) {
    throw new Error('[explainerAgent] Workers AI binding not available.');
  }
  if (provider !== 'workers-ai' && !apiKey) {
    throw new Error(`[explainerAgent] No API key configured for ${provider}.`);
  }

  const systemPrompt = buildExplainerSystemPrompt(prBrief, prDiff, repoKnowledge);
  const userMessage = buildUserMessage(previousExchanges, newQuestion);

  let raw: string;
  try {
    if (provider === 'workers-ai') {
      raw = await callWorkersAI(ai!, systemPrompt, userMessage);
    } else if (provider === 'google-ai') {
      raw = await callGoogleAI(apiKey, systemPrompt, userMessage);
    } else if (provider === 'anthropic') {
      raw = await callAnthropic(apiKey, systemPrompt, userMessage);
    } else {
      raw = await callMistral(apiKey, systemPrompt, userMessage);
    }
  } catch (err) {
    console.error(`[explainerAgent] ${provider} call failed:`, err);
    console.log('[explainerAgent] Falling back to mock response.');
    return getMockExplainerResponse(newQuestion);
  }

  if (!raw) {
    console.warn(`[explainerAgent] ${provider} returned empty response. Falling back to mock.`);
    return getMockExplainerResponse(newQuestion);
  }

  // Parse JSON response
  let parsed: unknown;
  try {
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    parsed = JSON.parse(jsonText);
  } catch {
    console.error('[explainerAgent] Failed to parse JSON response:', raw.slice(0, 300));
    console.log('[explainerAgent] Falling back to mock response.');
    return getMockExplainerResponse(newQuestion);
  }

  if (!parsed || typeof parsed !== 'object') {
    console.error('[explainerAgent] Response is not an object:', typeof parsed);
    return getMockExplainerResponse(newQuestion);
  }

  const rec = parsed as Record<string, unknown>;

  // Extract and validate fields
  const content = typeof rec.content === 'string' ? rec.content : '';
  if (!content) {
    console.error('[explainerAgent] Parsed object has no content field');
    return getMockExplainerResponse(newQuestion);
  }

  const contextProvided = Array.isArray(rec.context_provided)
    ? (rec.context_provided as string[]).filter((t): t is ContextTag => VALID_CONTEXT_TAGS.includes(t as ContextTag))
    : [];

  const rawDepth = typeof rec.depth_level === 'string' ? rec.depth_level.toLowerCase() : 'moderate';
  const depthLevel: DepthLevel = VALID_DEPTH_LEVELS.includes(rawDepth as DepthLevel)
    ? (rawDepth as DepthLevel)
    : 'moderate';

  return {
    content,
    context_provided: contextProvided,
    depth_level: depthLevel,
  };
}
