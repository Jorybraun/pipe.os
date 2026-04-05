/**
 * Role Discovery Agent — Mistral API Integration
 *
 * Calls mistral-small-latest to generate the next interview question
 * based on conversation history, knowledge state, and remaining budget.
 *
 * Follows the same HTTP fetch pattern as implementerAgent.ts:
 * - Synchronous JSON response (no SSE)
 * - Graceful fallback to mock when API key missing
 * - Code-fence stripping for JSON parsing
 */

import { buildRoleAgentSystemPrompt, buildRoleAgentUserMessage, buildSynthesisPrompt } from './roleAgentPrompts';
import type { RoleExchange, DomainCoverage } from '../types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RoleAgentQuestionResponse {
  type: 'question';
  reasoning: string;
  acknowledgment: string;
  question: {
    id: string;
    text: string;
    input: {
      type: 'text' | 'textarea' | 'tags' | 'select' | 'radio';
      options?: string[];
      placeholder?: string;
    };
  };
  knowledgeStateUpdate: Record<string, Record<string, unknown>>;
  domainCoverage: Record<string, DomainCoverage>;
}

export interface RoleAgentSynthesisResponse {
  type: 'synthesis';
  reasoning: string;
  synthesis: string;
  knowledgeStateUpdate: Record<string, Record<string, unknown>>;
  domainCoverage: Record<string, DomainCoverage>;
}

export type RoleAgentResponse = RoleAgentQuestionResponse | RoleAgentSynthesisResponse;

export interface CallRoleAgentInput {
  apiKey: string;
  baseline: Record<string, unknown>;
  exchanges: RoleExchange[];
  knowledgeState: Record<string, unknown>;
  questionsAsked: number;
  questionBudget: number;
}

// ─── Mistral API ────────────────────────────────────────────────────────────

interface MistralChoice {
  message: { role: string; content: string };
}

interface MistralChatResponse {
  choices: MistralChoice[];
}

async function callMistral(apiKey: string, systemPrompt: string, userMessage: string): Promise<string> {
  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      max_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[roleAgent] Mistral API error', { status: response.status, body: errorText });
    throw new Error(`Mistral API returned ${response.status}`);
  }

  const data = (await response.json()) as MistralChatResponse;
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ─── Mock response (for testing without API key) ────────────────────────────

function getMockQuestionResponse(questionsAsked: number): RoleAgentQuestionResponse {
  const questionNum = questionsAsked + 1;
  return {
    type: 'question',
    reasoning: `[MOCK] Generating question ${questionNum}. This is a mock response for testing.`,
    acknowledgment: questionNum === 1
      ? "I'll help you build a detailed profile for this role so we can design assessments that test for what actually matters. The more specific you can be, the better the challenges I'll generate."
      : 'Thanks for that context — it helps me understand the scope.',
    question: {
      id: `q-${questionNum}`,
      text: questionNum === 1
        ? "Are you the hiring manager, or recruiting on someone's behalf?"
        : `Mock question #${questionNum} — what does the day-to-day look like?`,
      input: {
        type: questionNum === 1 ? 'radio' : 'textarea',
        ...(questionNum === 1 ? { options: ['I\'m the hiring manager', 'I\'m recruiting for someone else'] } : {}),
        placeholder: questionNum === 1 ? undefined : 'Describe a typical week...',
      },
    },
    knowledgeStateUpdate: {},
    domainCoverage: {
      why: 'none',
      work: 'none',
      team: 'none',
      bar: 'none',
      codebase: 'none',
      process: 'none',
    },
  };
}

function getMockSynthesisResponse(baseline: Record<string, unknown>): RoleAgentSynthesisResponse {
  const title = typeof baseline.title === 'string' ? baseline.title : 'the role';
  return {
    type: 'synthesis',
    reasoning: '[MOCK] Budget exhausted. Generating synthesis.',
    synthesis: `Based on our conversation, you're looking for a ${title} who can contribute meaningfully to your team. This is a mock synthesis — in production, this would be a detailed narrative demonstrating understanding of the role context, team dynamics, and technical requirements.`,
    knowledgeStateUpdate: {},
    domainCoverage: {
      why: 'partial',
      work: 'partial',
      team: 'sparse',
      bar: 'sparse',
      codebase: 'none',
      process: 'none',
    },
  };
}

// ─── Parse and validate ─────────────────────────────────────────────────────

const VALID_INPUT_TYPES = ['text', 'textarea', 'tags', 'select', 'radio'] as const;
const VALID_COVERAGES: DomainCoverage[] = ['none', 'sparse', 'partial', 'covered', 'deep'];
const SIX_DOMAINS = ['why', 'work', 'team', 'bar', 'codebase', 'process'] as const;

function parseDomainCoverage(raw: unknown): Record<string, DomainCoverage> {
  const result: Record<string, DomainCoverage> = {};
  if (raw && typeof raw === 'object') {
    for (const domain of SIX_DOMAINS) {
      const val = (raw as Record<string, unknown>)[domain];
      result[domain] = typeof val === 'string' && VALID_COVERAGES.includes(val as DomainCoverage)
        ? (val as DomainCoverage)
        : 'none';
    }
  } else {
    for (const domain of SIX_DOMAINS) {
      result[domain] = 'none';
    }
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

function parseQuestionResponse(parsed: Record<string, unknown>, questionsAsked: number): RoleAgentQuestionResponse {
  const question = parsed.question as Record<string, unknown> | undefined;
  const input = question?.input as Record<string, unknown> | undefined;

  const inputType = typeof input?.type === 'string' && VALID_INPUT_TYPES.includes(input.type as typeof VALID_INPUT_TYPES[number])
    ? (input.type as RoleAgentQuestionResponse['question']['input']['type'])
    : 'textarea';

  return {
    type: 'question',
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    acknowledgment: typeof parsed.acknowledgment === 'string' ? parsed.acknowledgment : '',
    question: {
      id: typeof question?.id === 'string' ? question.id : `q-${questionsAsked + 1}`,
      text: typeof question?.text === 'string' ? question.text : '',
      input: {
        type: inputType,
        ...(Array.isArray(input?.options) ? { options: input.options.filter((o: unknown) => typeof o === 'string') as string[] } : {}),
        ...(typeof input?.placeholder === 'string' ? { placeholder: input.placeholder } : {}),
      },
    },
    knowledgeStateUpdate: parseKnowledgeStateUpdate(parsed.knowledgeStateUpdate),
    domainCoverage: parseDomainCoverage(parsed.domainCoverage),
  };
}

function parseSynthesisResponse(parsed: Record<string, unknown>): RoleAgentSynthesisResponse {
  return {
    type: 'synthesis',
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    synthesis: typeof parsed.synthesis === 'string' ? parsed.synthesis : '',
    knowledgeStateUpdate: parseKnowledgeStateUpdate(parsed.knowledgeStateUpdate),
    domainCoverage: parseDomainCoverage(parsed.domainCoverage),
  };
}

// ─── Main export ────────────────────────────────────────────────────────────

/**
 * Call the Role Discovery Agent.
 *
 * Returns either a question turn or a synthesis (when budget exhausted).
 * Falls back to mock responses when API key is not set.
 */
export async function callRoleAgent(input: CallRoleAgentInput): Promise<RoleAgentResponse> {
  const { apiKey, baseline, exchanges, knowledgeState, questionsAsked, questionBudget } = input;

  const budgetExhausted = questionsAsked >= questionBudget;

  // Mock mode
  if (!apiKey) {
    console.log('[roleAgent] No MISTRAL_API_KEY configured. Returning mock response.');
    return budgetExhausted
      ? getMockSynthesisResponse(baseline)
      : getMockQuestionResponse(questionsAsked);
  }

  const systemPrompt = buildRoleAgentSystemPrompt();
  const userMessage = budgetExhausted
    ? buildSynthesisPrompt({ baseline, exchanges, knowledgeState })
    : buildRoleAgentUserMessage({ baseline, exchanges, knowledgeState, questionsAsked, questionBudget });

  let raw: string;
  try {
    raw = await callMistral(apiKey, systemPrompt, userMessage);
  } catch (err) {
    console.error('[roleAgent] Mistral call failed:', err);
    return budgetExhausted
      ? getMockSynthesisResponse(baseline)
      : getMockQuestionResponse(questionsAsked);
  }

  if (!raw) {
    console.warn('[roleAgent] Mistral returned empty response. Falling back to mock.');
    return budgetExhausted
      ? getMockSynthesisResponse(baseline)
      : getMockQuestionResponse(questionsAsked);
  }

  // Parse JSON — handle potential code fences
  let parsed: Record<string, unknown>;
  try {
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    console.error('[roleAgent] Failed to parse JSON response:', raw.slice(0, 300));
    return budgetExhausted
      ? getMockSynthesisResponse(baseline)
      : getMockQuestionResponse(questionsAsked);
  }

  // Determine response type: synthesis if budget exhausted or "synthesis" field present
  if (budgetExhausted || typeof parsed.synthesis === 'string') {
    return parseSynthesisResponse(parsed);
  }

  return parseQuestionResponse(parsed, questionsAsked);
}

/**
 * Merge a knowledge state update into the existing knowledge state.
 * Performs a shallow merge per domain.
 */
export function mergeKnowledgeState(
  existing: Record<string, Record<string, unknown>>,
  update: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const result = { ...existing };
  for (const [domain, fields] of Object.entries(update)) {
    result[domain] = { ...(result[domain] ?? {}), ...fields };
  }
  return result;
}
