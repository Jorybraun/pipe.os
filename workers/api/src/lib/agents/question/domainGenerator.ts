/**
 * Domain Question Generator
 *
 * Replaces probeLibrarian.ts with per-domain LLM generation.
 * Generates a batch of questions for a single domain in one LLM call.
 */

import type { LLMProvider, LLMMessage } from '../../llm/types';
import type { Domain } from '../../../types';
import type { InterviewState, GeneratedQuestion } from '../interview/types';
import { buildDomainGenerationPrompt } from './domainPrompts';

// ─── Parsing ─────────────────────────────────────────────────────────────────

function cleanJson(content: string): string {
  const trimmed = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function parseGeneratedQuestions(raw: unknown, count: number): GeneratedQuestion[] {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Domain generation response is not an object');
  }
  const obj = raw as Record<string, unknown>;
  const questionsRaw = obj.questions;
  if (!Array.isArray(questionsRaw)) {
    throw new Error('Domain generation response missing "questions" array');
  }

  const results: GeneratedQuestion[] = [];
  for (let i = 0; i < questionsRaw.length; i++) {
    const q = questionsRaw[i];
    if (!q || typeof q !== 'object') continue;

    const item = q as Record<string, unknown>;
    results.push({
      id: typeof item.id === 'string' ? item.id : `dq-${i + 1}`,
      text: typeof item.text === 'string' ? item.text : '',
      intent: typeof item.intent === 'string' ? item.intent : '',
      drillingHints: Array.isArray(item.drillingHints)
        ? item.drillingHints.filter((h): h is string => typeof h === 'string')
        : undefined,
      ladderingTarget: typeof item.ladderingTarget === 'string' ? item.ladderingTarget : undefined,
    });
  }

  // If we got fewer than requested, that's fine — the caller handles it.
  // If we got zero, that's an error.
  if (results.length === 0) {
    throw new Error('Domain generation returned zero valid questions');
  }

  return results;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface GenerateDomainQuestionsOptions {
  /** Number of questions to generate. Default: 6. */
  count?: number;
  /** Questioning style. 'soul' applies behavior-over-values framing. */
  style?: 'technical' | 'soul';
  /** Max tokens for the completion. Default: 4096. */
  maxTokens?: number;
}

/**
 * Generate questions for a specific domain.
 *
 * Makes a single LLM call and returns an array of GeneratedQuestion.
 * The questions are cached in state via the CACHE_DOMAIN_QUESTIONS action.
 */
export async function generateDomainQuestions(
  domain: Domain,
  state: InterviewState,
  provider: LLMProvider | null,
  opts: GenerateDomainQuestionsOptions = {},
): Promise<GeneratedQuestion[]> {
  if (!provider) {
    throw new Error('No AI provider is configured. Set ROLE_AGENT_PROVIDER or configure VERTEX_SA_KEY_JSON.');
  }

  const count = opts.count ?? 6;
  const { system, user } = buildDomainGenerationPrompt(domain, state, count, { style: opts.style });

  const messages: LLMMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  console.log(`[domainGenerator] generating ${count} questions for domain=${domain} | style=${opts.style ?? 'technical'}`);

  const maxTokens = opts.maxTokens ?? 4096;
  const genStart = Date.now();

  const completion = await provider.complete(messages, { forceJson: true, maxTokens });
  const content = completion.content?.trim() ?? '';

  console.log(`[domainGenerator] LLM call: ${Date.now() - genStart}ms | contentLen=${content.length}`);

  if (content.length === 0) {
    throw new Error('AI provider returned empty content');
  }

  const jsonText = cleanJson(content);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    throw new Error(`AI provider returned invalid JSON: ${content.slice(0, 300)}`);
  }

  return parseGeneratedQuestions(parsed, count);
}

/**
 * Stream domain question generation.
 *
 * Yields raw text chunks. Returns the parsed questions when done.
 */
export async function* generateDomainQuestionsStream(
  domain: Domain,
  state: InterviewState,
  provider: LLMProvider | null,
  opts: GenerateDomainQuestionsOptions = {},
): AsyncGenerator<string, GeneratedQuestion[], unknown> {
  if (!provider) {
    throw new Error('No AI provider is configured.');
  }

  const count = opts.count ?? 6;
  const { system, user } = buildDomainGenerationPrompt(domain, state, count, { style: opts.style });

  const messages: LLMMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  let content = '';

  if (provider.completeStream) {
    for await (const chunk of provider.completeStream(messages, { forceJson: true, maxTokens: opts.maxTokens ?? 4096 })) {
      yield chunk;
      content += chunk;
    }
  } else {
    const completion = await provider.complete(messages, { forceJson: true, maxTokens: opts.maxTokens ?? 4096 });
    content = completion.content?.trim() ?? '';
    yield content;
  }

  if (content.length === 0) {
    throw new Error('AI provider returned empty content');
  }

  const jsonText = cleanJson(content);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    throw new Error(`AI provider returned invalid JSON: ${content.slice(0, 300)}`);
  }

  return parseGeneratedQuestions(parsed, count);
}
