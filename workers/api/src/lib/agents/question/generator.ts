/**
 * Question Generator — Stateless LLM Call
 *
 * Takes an InterviewState, builds a concise prompt, makes a single LLM call,
 * and returns the next question + optional knowledge-state update.
 *
 * No tool loop. No synthesis path. No hidden state.
 * Same state → same prompt every time.
 */

import type { LLMProvider, LLMMessage } from '../../llm/types';
import type { DomainCoverage } from '../../../types';
import type { InterviewState } from '../interview/types';
import { buildQuestionPrompt } from './prompt';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GeneratedQuestion {
  reasoning: string;
  acknowledgment: string;
  question: {
    id: string;
    text: string;
    goal?: string;
    expectedCoverage?: {
      domain: string;
      from: DomainCoverage;
      to: DomainCoverage;
    };
    probeAlignment?: string;
    questionType?: string;
    input: {
      type: 'text' | 'textarea' | 'tags' | 'select' | 'radio';
      options?: string[];
      placeholder?: string;
    };
    suggestedAnswers?: string[];
  };
  knowledgeStateUpdate: Record<string, Record<string, unknown>>;
  domainCoverage: Record<string, DomainCoverage>;
}

// ─── Parsing utilities (extracted from roleAgent.ts) ─────────────────────────

const VALID_INPUT_TYPES = ['text', 'textarea', 'tags', 'select', 'radio'] as const;
const VALID_COVERAGES: DomainCoverage[] = ['none', 'sparse', 'partial', 'covered', 'deep'];
const SIX_DOMAINS = ['why', 'work', 'team', 'bar', 'codebase', 'process'] as const;

function parseDomainCoverage(raw: unknown): Record<string, DomainCoverage> {
  const result: Record<string, DomainCoverage> = {};
  if (raw && typeof raw === 'object') {
    for (const domain of SIX_DOMAINS) {
      const val = (raw as Record<string, unknown>)[domain];
      result[domain] =
        typeof val === 'string' && VALID_COVERAGES.includes(val as DomainCoverage)
          ? (val as DomainCoverage)
          : 'none';
    }
  } else {
    for (const domain of SIX_DOMAINS) result[domain] = 'none';
  }
  return result;
}

function parseKnowledgeStateUpdate(raw: unknown): Record<string, Record<string, unknown>> {
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = value as Record<string, unknown>;
    }
  }
  return result;
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function cleanJson(content: string): string {
  return content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function parseGeneratedQuestion(
  parsed: Record<string, unknown>,
  expectedQuestionId: string,
): GeneratedQuestion {
  const question = parsed.question as Record<string, unknown> | undefined;
  const input = question?.input as Record<string, unknown> | undefined;

  const inputType =
    typeof input?.type === 'string' && VALID_INPUT_TYPES.includes(input.type as typeof VALID_INPUT_TYPES[number])
      ? (input.type as GeneratedQuestion['question']['input']['type'])
      : 'textarea';

  return {
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    acknowledgment: typeof parsed.acknowledgment === 'string' ? parsed.acknowledgment : '',
    question: {
      id: typeof question?.id === 'string' ? question.id : expectedQuestionId,
      text: typeof question?.text === 'string' ? question.text : '',
      ...(typeof question?.goal === 'string' ? { goal: question.goal } : {}),
      ...(question?.expectedCoverage && typeof question.expectedCoverage === 'object'
        ? {
            expectedCoverage: {
              domain: String((question.expectedCoverage as Record<string, unknown>).domain ?? ''),
              from: parseDomainCoverage({ domain: (question.expectedCoverage as Record<string, unknown>).from })[
                'domain'
              ],
              to: parseDomainCoverage({ domain: (question.expectedCoverage as Record<string, unknown>).to })['domain'],
            },
          }
        : {}),
      ...(typeof question?.probeAlignment === 'string' ? { probeAlignment: question.probeAlignment } : {}),
      ...(typeof question?.questionType === 'string' ? { questionType: question.questionType } : {}),
      input: {
        type: inputType,
        ...(Array.isArray(input?.options)
          ? { options: input.options.filter((o: unknown) => typeof o === 'string') as string[] }
          : {}),
        ...(typeof input?.placeholder === 'string' ? { placeholder: input.placeholder } : {}),
      },
      ...(Array.isArray(question?.suggestedAnswers)
        ? { suggestedAnswers: toStringArray(question.suggestedAnswers) }
        : {}),
    },
    knowledgeStateUpdate: parseKnowledgeStateUpdate(parsed.knowledgeStateUpdate),
    domainCoverage: parseDomainCoverage(parsed.domainCoverage),
  };
}

// ─── Generator ───────────────────────────────────────────────────────────────

export interface GenerateQuestionOptions {
  /** Max tokens for the completion. Default: 2048. */
  maxTokens?: number;
}

/**
 * Generate the next interview question from state.
 *
 * Stateless: same state + same provider → same prompt → deterministic output
 * (modulo model temperature).
 */
export async function generateQuestion(
  state: InterviewState,
  provider: LLMProvider | null,
  opts: GenerateQuestionOptions = {},
): Promise<GeneratedQuestion> {
  if (!provider) {
    throw new Error('No AI provider is configured. Set ROLE_AGENT_PROVIDER or configure VERTEX_SA_KEY_JSON.');
  }

  const { system, user } = buildQuestionPrompt(state);
  const messages: LLMMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  const maxTokens = opts.maxTokens ?? 2048;

  const completion = await provider.complete(messages, { forceJson: true, maxTokens });
  const content = completion.content?.trim() ?? '';

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

  // Guard against synthesis responses leaking into the question path
  if (parsed.persona || parsed.synthesis || parsed.jobDescription) {
    throw new Error('Question generator received a synthesis response. Use synthesize() for budget-exhausted turns.');
  }

  const expectedId = `q-${state.questionsAsked + 1}`;
  return parseGeneratedQuestion(parsed, expectedId);
}
