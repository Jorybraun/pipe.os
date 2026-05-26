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
import { buildQuestionPrompt, buildBatchPrompt } from './prompt';
import { checkQuestion, buildGuardNudge } from './guard';
import type { GuardResult } from './guard';

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
  const trimmed = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  // If the text is wrapped in prose, extract the outermost JSON object.
  // Kimi k2.6 occasionally prefixes/suffixes its reasoning around the JSON.
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
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
              from: parseDomainCoverage({ domain: (question.expectedCoverage as Record<string, unknown>).from })['domain'] ?? 'none',
              to: parseDomainCoverage({ domain: (question.expectedCoverage as Record<string, unknown>).to })['domain'] ?? 'none',
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
 * Stream the next interview question generation.
 *
 * Yields raw text chunks as they arrive from the provider.
 * Returns the parsed {@link GeneratedQuestion} when the stream completes.
 *
 * If the provider does not support streaming, falls back to a single
 * non-streaming completion and yields the full response as one chunk.
 */
export async function* generateQuestionStream(
  state: InterviewState,
  provider: LLMProvider | null,
  opts: GenerateQuestionOptions = {},
): AsyncGenerator<string, GeneratedQuestion, unknown> {
  if (!provider) {
    throw new Error('No AI provider is configured. Set ROLE_AGENT_PROVIDER or configure VERTEX_SA_KEY_JSON.');
  }

  const promptStart = Date.now();
  const { system, user } = buildQuestionPrompt(state);
  const messages: LLMMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  console.log(`[generator] prompt built in ${Date.now() - promptStart}ms | system=${system.length}chars user=${user.length}chars`);

  const maxTokens = opts.maxTokens ?? 2048;

  let content = '';
  const genStart = Date.now();

  if (provider.completeStream) {
    for await (const chunk of provider.completeStream(messages, { forceJson: true, maxTokens })) {
      yield chunk;
      content += chunk;
    }
  } else {
    const completion = await provider.complete(messages, { forceJson: true, maxTokens });
    content = completion.content?.trim() ?? '';
    yield content;
  }

  console.log(`[generator] LLM call: ${Date.now() - genStart}ms | contentLen=${content.length}`);

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
  const question = parseGeneratedQuestion(parsed, expectedId);

  // Stream guard check: we can't retry without confusing the user, but we CAN log.
  const previousQuestions = state.exchanges.map((ex) => ex.question);
  const guardResult = checkQuestion({
    text: question.question.text,
    acknowledgment: question.acknowledgment,
    participantRole: state.participantRole ?? undefined,
    previousQuestions,
  });
  if (!guardResult.passed) {
    const blocks = guardResult.violations.filter((v) => v.severity === 'block');
    console.warn(
      `[generator] Streamed question failed guard (no retry possible): "${question.question.text.slice(0, 80)}..." | blocks=${blocks.map((b) => b.ruleId).join(',')}`,
    );
  }

  return question;
}

// ─── Guard retry helper ──────────────────────────────────────────────────────

const MAX_GUARD_RETRIES = 2;

async function generateQuestionWithGuardRetry(
  state: InterviewState,
  provider: LLMProvider | null,
  opts: GenerateQuestionOptions = {},
): Promise<{ question: GeneratedQuestion; guardViolations: GuardResult[] }> {
  const guardViolations: GuardResult[] = [];
  const messages: LLMMessage[] = [];

  for (let attempt = 0; attempt <= MAX_GUARD_RETRIES; attempt++) {
    const promptStart = Date.now();
    const { system, user } = buildQuestionPrompt(state);

    const callMessages: LLMMessage[] =
      messages.length > 0
        ? messages
        : [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ];

    if (messages.length === 0) {
      messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: user });
    }

    console.log(`[generator] prompt built in ${Date.now() - promptStart}ms | attempt=${attempt + 1}`);

    const maxTokens = opts.maxTokens ?? 2048;
    const genStart = Date.now();

    if (!provider) {
      throw new Error('No AI provider is configured. Set ROLE_AGENT_PROVIDER or configure VERTEX_SA_KEY_JSON.');
    }

    const completion = await provider.complete(callMessages, { forceJson: true, maxTokens });
    const content = completion.content?.trim() ?? '';

    console.log(`[generator] LLM call: ${Date.now() - genStart}ms | contentLen=${content.length}`);

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

    if (parsed.persona || parsed.synthesis || parsed.jobDescription) {
      throw new Error('Question generator received a synthesis response. Use synthesize() for budget-exhausted turns.');
    }

    const expectedId = `q-${state.questionsAsked + 1}`;
    const question = parseGeneratedQuestion(parsed, expectedId);

    const previousQuestions = state.exchanges.map((ex) => ex.question);
    const guardResult = checkQuestion({
      text: question.question.text,
      acknowledgment: question.acknowledgment,
      participantRole: state.participantRole ?? undefined,
      previousQuestions,
    });

    if (guardResult.passed) {
      if (guardViolations.length > 0) {
        console.log(`[generator] Guard passed after ${attempt} retry(s)`);
      }
      return { question, guardViolations };
    }

    guardViolations.push(guardResult);
    const blocks = guardResult.violations.filter((v) => v.severity === 'block');
    console.warn(
      `[generator] Guard blocked question (attempt ${attempt + 1}): "${question.question.text.slice(0, 80)}..." | blocks=${blocks.map((b) => b.ruleId).join(',')}`,
    );

    if (attempt < MAX_GUARD_RETRIES) {
      const nudge = buildGuardNudge(guardResult);
      messages.push({ role: 'assistant', content: jsonText });
      messages.push({ role: 'user', content: nudge });
    }
  }

  console.error(`[generator] Guard failed after ${MAX_GUARD_RETRIES} retries. Returning last question anyway.`);
  const expectedId = `q-${state.questionsAsked + 1}`;
  // Re-parse from the last assistant message
  const lastAssistantMsg = messages.filter((m) => m.role === 'assistant').pop();
  const lastContent = lastAssistantMsg?.content ?? '{}';
  const lastJson = cleanJson(lastContent);
  let lastParsed: Record<string, unknown>;
  try {
    lastParsed = JSON.parse(lastJson) as Record<string, unknown>;
  } catch {
    lastParsed = {};
  }
  return { question: parseGeneratedQuestion(lastParsed, expectedId), guardViolations };
}

/**
 * Generate the next interview question from state.
 *
 * Stateless: same state + same provider → same prompt → deterministic output
 * (modulo model temperature).
 *
 * Includes deterministic guard retry: if the generated question violates a
 * guard rule, the prompt is nudged and regeneration is attempted up to 2 times.
 */
export async function generateQuestion(
  state: InterviewState,
  provider: LLMProvider | null,
  opts: GenerateQuestionOptions = {},
): Promise<GeneratedQuestion> {
  const { question } = await generateQuestionWithGuardRetry(state, provider, opts);
  return question;
}

// ─── Batch generation (stack architecture) ───────────────────────────────────

function parseBatchItem(
  raw: unknown,
  expectedQuestionId: string,
): GeneratedQuestion {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid batch item: expected object, got ${typeof raw}`);
  }
  const item = raw as Record<string, unknown>;
  const question = item.question as Record<string, unknown> | undefined;
  const input = question?.input as Record<string, unknown> | undefined;

  const inputType =
    typeof input?.type === 'string' && VALID_INPUT_TYPES.includes(input.type as typeof VALID_INPUT_TYPES[number])
      ? (input.type as GeneratedQuestion['question']['input']['type'])
      : 'textarea';

  return {
    reasoning: '', // batch-level reasoning is separate
    acknowledgment: typeof item.acknowledgment === 'string' ? item.acknowledgment : '',
    question: {
      id: typeof question?.id === 'string' ? question.id : expectedQuestionId,
      text: typeof question?.text === 'string' ? question.text : '',
      ...(typeof question?.goal === 'string' ? { goal: question.goal } : {}),
      ...(question?.expectedCoverage && typeof question.expectedCoverage === 'object'
        ? {
            expectedCoverage: {
              domain: String((question.expectedCoverage as Record<string, unknown>).domain ?? ''),
              from: parseDomainCoverage({ domain: (question.expectedCoverage as Record<string, unknown>).from })['domain'] ?? 'none',
              to: parseDomainCoverage({ domain: (question.expectedCoverage as Record<string, unknown>).to })['domain'] ?? 'none',
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
    knowledgeStateUpdate: parseKnowledgeStateUpdate(item.knowledgeStateUpdate),
    domainCoverage: parseDomainCoverage(item.domainCoverage),
  };
}

function parseBatchResponse(
  parsed: Record<string, unknown>,
  firstQuestionId: number,
): GeneratedQuestion[] {
  const batchRaw = parsed.batch;
  if (!Array.isArray(batchRaw)) {
    throw new Error(`Batch response missing "batch" array: ${Object.keys(parsed).join(', ')}`);
  }

  const results: GeneratedQuestion[] = [];
  for (let i = 0; i < batchRaw.length; i++) {
    const expectedId = `q-${firstQuestionId + i}`;
    const item = parseBatchItem(batchRaw[i], expectedId);
    // Attach batch-level reasoning to the first item only
    if (i === 0 && typeof parsed.reasoning === 'string') {
      item.reasoning = parsed.reasoning;
    }
    results.push(item);
  }
  return results;
}

export interface GenerateBatchOptions extends GenerateQuestionOptions {
  /** Number of questions to generate in one call. Default: 3. */
  batchSize?: number;
}

/**
 * Generate a batch of interview questions in a single LLM call.
 *
 * Returns an array of GeneratedQuestion (typically 3). The first item
 * includes the acknowledgment of the most recent answer; subsequent items
 * have empty acknowledgments and are meant to be served from the stack.
 */
export async function generateQuestionBatch(
  state: InterviewState,
  provider: LLMProvider | null,
  opts: GenerateBatchOptions = {},
): Promise<GeneratedQuestion[]> {
  if (!provider) {
    throw new Error('No AI provider is configured. Set ROLE_AGENT_PROVIDER or configure VERTEX_SA_KEY_JSON.');
  }

  const batchSize = opts.batchSize ?? 3;
  const promptStart = Date.now();
  const { system, user } = buildBatchPrompt(state, batchSize);
  const messages: LLMMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  console.log(`[generator] batch prompt built in ${Date.now() - promptStart}ms | system=${system.length}chars user=${user.length}chars batchSize=${batchSize}`);

  const maxTokens = opts.maxTokens ?? 4096; // batches need more tokens
  const genStart = Date.now();

  const completion = await provider.complete(messages, { forceJson: true, maxTokens });
  const content = completion.content?.trim() ?? '';

  console.log(`[generator] LLM batch call: ${Date.now() - genStart}ms | contentLen=${content.length}`);

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

  if (parsed.persona || parsed.synthesis || parsed.jobDescription) {
    throw new Error('Question generator received a synthesis response. Use synthesize() for budget-exhausted turns.');
  }

  const questions = parseBatchResponse(parsed, state.questionsAsked + 1);

  // Guard check each question in the batch (telemetry only — no retry for batches)
  const previousQuestions = state.exchanges.map((ex) => ex.question);
  for (const q of questions) {
    const guardResult = checkQuestion({
      text: q.question.text,
      acknowledgment: q.acknowledgment,
      participantRole: state.participantRole ?? undefined,
      previousQuestions,
    });
    if (!guardResult.passed) {
      const blocks = guardResult.violations.filter((v) => v.severity === 'block');
      console.warn(
        `[generator] Batch question failed guard: "${q.question.text.slice(0, 80)}..." | blocks=${blocks.map((b) => b.ruleId).join(',')}`,
      );
    }
  }

  return questions;
}
