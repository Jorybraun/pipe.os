/**
 * Explainer Agent — Blind Comprehension Review
 *
 * Calls Workers AI or Google AI to answer candidate questions about a PR they're reviewing blind.
 *
 * Unlike the implementer agent (which responds to bug-finding annotations),
 * the explainer agent answers free-form questions with markdown + mermaid diagrams.
 *
 * Same provider abstraction: Workers AI / Google AI.
 *
 * Missing or failed AI providers return explicit diagnostics. They must not
 * fabricate PR author explanations.
 */

import {
  aiDeveloperUnavailableDiagnostic,
  type AssessmentDiagnostic,
} from './assessmentEvidence';
import { buildExplainerSystemPrompt, type RepoKnowledgeInput } from './explainerPrompts';

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

export type LLMProvider = 'workers-ai' | 'google-ai';

export class ExplainerAgentUnavailableError extends Error {
  readonly diagnostic: AssessmentDiagnostic;

  constructor(input: {
    provider: LLMProvider;
    reason: string;
    retryable?: boolean;
    details?: Record<string, string | number | boolean | null>;
  }) {
    const diagnostic = aiDeveloperUnavailableDiagnostic({
      provider: input.provider,
      reason: input.reason,
      retryable: input.retryable,
      details: input.details,
    });
    super(diagnostic.reason);
    this.name = 'ExplainerAgentUnavailableError';
    this.diagnostic = diagnostic;
  }
}

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
    throw new Error(`Google AI error ${response.status}`);
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
 * Throws ExplainerAgentUnavailableError when a real provider cannot produce a
 * valid response. Candidate transcripts must never contain simulated PR-author
 * explanations.
 */
export async function callExplainerAgent(
  input: CallExplainerAgentInput,
): Promise<ExplainerResponse> {
  const { apiKey, provider = 'workers-ai', ai, prBrief, prDiff, repoKnowledge, previousExchanges, newQuestion } = input;

  if (!apiKey && provider !== 'workers-ai') {
    throw new ExplainerAgentUnavailableError({
      provider,
      reason: 'Review explainer agent API key is not configured.',
      retryable: true,
    });
  }

  if (provider === 'workers-ai' && !ai) {
    throw new ExplainerAgentUnavailableError({
      provider,
      reason: 'Workers AI binding is not available for the review explainer agent.',
      retryable: true,
    });
  }

  const systemPrompt = buildExplainerSystemPrompt(prBrief, prDiff, repoKnowledge);
  const userMessage = buildUserMessage(previousExchanges, newQuestion);

  let raw: string;
  try {
    if (provider === 'workers-ai') {
      raw = await callWorkersAI(ai!, systemPrompt, userMessage);
    } else {
      raw = await callGoogleAI(apiKey, systemPrompt, userMessage);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[explainerAgent] ${provider} call failed:`, message);
    throw new ExplainerAgentUnavailableError({
      provider,
      reason: `Review explainer agent provider failed: ${message}`,
      retryable: true,
    });
  }

  if (!raw) {
    throw new ExplainerAgentUnavailableError({
      provider,
      reason: 'Review explainer agent provider returned an empty response.',
      retryable: true,
    });
  }

  // Parse JSON response
  let parsed: unknown;
  try {
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    parsed = JSON.parse(jsonText);
  } catch {
    console.error('[explainerAgent] Failed to parse JSON response:', raw.slice(0, 300));
    throw new ExplainerAgentUnavailableError({
      provider,
      reason: 'Review explainer agent provider returned invalid JSON.',
      retryable: true,
    });
  }

  if (!parsed || typeof parsed !== 'object') {
    console.error('[explainerAgent] Response is not an object:', typeof parsed);
    throw new ExplainerAgentUnavailableError({
      provider,
      reason: 'Review explainer agent provider response was not an object.',
      retryable: true,
    });
  }

  const rec = parsed as Record<string, unknown>;

  // Extract and validate fields
  const content = typeof rec.content === 'string' ? rec.content : '';
  if (!content) {
    console.error('[explainerAgent] Parsed object has no content field');
    throw new ExplainerAgentUnavailableError({
      provider,
      reason: 'Review explainer agent provider returned no answer content.',
      retryable: true,
    });
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
