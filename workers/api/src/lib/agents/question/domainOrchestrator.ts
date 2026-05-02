/**
 * Domain Orchestrator — Column-by-column interview flow.
 *
 * Manages the domain-driven question pipeline:
 *   1. Pick next pending domain
 *   2. Generate + cache domain questions (one LLM call per domain)
 *   3. Serve cached questions one by one
 *   4. Run depth evaluator when cache is exhausted
 *   5. Generate follow-ups if shallow, or advance to next domain if deep
 *
 * Falls back to legacy per-turn generation when not in DISCOVERY phase
 * or when the domain-driven flag is not set.
 */

import type { LLMProvider } from '../../llm/types';
import type { Domain } from '../../../types';
import type { InterviewState, GeneratedQuestion, DomainCompletionStatus } from '../interview/types';
import { DOMAIN_COLUMN_ORDER } from '../interview/types';
import { generateDomainQuestions } from './domainGenerator';
import { evaluateDomainDepth } from './depthEvaluator';
import { generateQuestion } from './generator';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DomainDrivenQuestion {
  /** The question to ask. */
  question: GeneratedQuestion;
  /** State updates to apply before serving the question. */
  statePatches: Partial<Pick<InterviewState,
    'currentDomain' | 'domainCompletion' | 'domainQuestions' | 'domainFollowUpsDelivered'
  >>;
  /** Whether this question came from the domain cache (true) or a fresh LLM call (false). */
  fromCache: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pickNextDomain(state: InterviewState): Domain | null {
  const completion = state.domainCompletion ?? {};
  for (const d of DOMAIN_COLUMN_ORDER) {
    const status = completion[d] ?? 'pending';
    if (status === 'pending' || status === 'generating') {
      return d;
    }
  }
  return null;
}

function getCachedQuestions(state: InterviewState, domain: Domain): GeneratedQuestion[] {
  return state.domainQuestions?.[domain] ?? [];
}

function getDeliveredCount(state: InterviewState, domain: Domain): number {
  return state.domainQuestionsDelivered?.[domain] ?? 0;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the next question using domain-driven flow.
 *
 * - If not in DISCOVERY phase, falls back to legacy `generateQuestion()`.
 * - If in DISCOVERY, manages the column-by-column pipeline.
 *
 * This function may trigger LLM calls (domain generation or follow-up generation).
 * It returns the question + any state patches that must be applied before serving.
 */
export async function getNextDomainDrivenQuestion(
  state: InterviewState,
  provider: LLMProvider | null,
  opts: {
    /** Enable soul-style questioning for cultural domains. */
    enableSoulTrack?: boolean;
    /** Target number of questions per domain. Default: 6. */
    questionsPerDomain?: number;
    /** Max follow-ups when depth is shallow. Default: 3. */
    maxFollowUps?: number;
  } = {},
): Promise<DomainDrivenQuestion> {
  // Not in DISCOVERY — fall back to legacy generation
  if (state.phase !== 'DISCOVERY') {
    const legacy = await generateQuestion(state, provider);
    return {
      question: {
        id: legacy.question.id,
        text: legacy.question.text,
        intent: legacy.question.goal ?? '',
      },
      statePatches: {},
      fromCache: false,
    };
  }

  const questionsPerDomain = opts.questionsPerDomain ?? 6;
  const maxFollowUps = opts.maxFollowUps ?? 3;

  let currentDomain = state.currentDomain;
  let domainCompletion = { ...(state.domainCompletion ?? {}) };
  let domainQuestions = { ...(state.domainQuestions ?? {}) };
  let domainFollowUpsDelivered = state.domainFollowUpsDelivered ?? 0;

  // ── Determine current domain ──
  if (!currentDomain || domainCompletion[currentDomain] === 'complete') {
    currentDomain = pickNextDomain(state);
    if (currentDomain) {
      domainCompletion[currentDomain] = 'generating';
    }
  }

  // No pending domains — this should not happen in DISCOVERY, but handle gracefully
  if (!currentDomain) {
    const legacy = await generateQuestion(state, provider);
    return {
      question: {
        id: legacy.question.id,
        text: legacy.question.text,
        intent: legacy.question.goal ?? '',
      },
      statePatches: {},
      fromCache: false,
    };
  }

  // ── Check cached questions ──
  let cached = getCachedQuestions(state, currentDomain);
  const delivered = getDeliveredCount(state, currentDomain);

  // If we haven't generated questions for this domain yet, do it now
  if (cached.length === 0 && delivered === 0) {
    if (!provider) {
      throw new Error('No AI provider is configured.');
    }

    const style = opts.enableSoulTrack && currentDomain === 'team' ? 'soul' : undefined;
    const generated = await generateDomainQuestions(currentDomain, state, provider, {
      count: questionsPerDomain,
      style,
    });

    cached = generated;
    domainQuestions[currentDomain] = generated;
    domainCompletion[currentDomain] = 'asking';
  }

  // ── Serve from cache if available ──
  if (delivered < cached.length) {
    const nextQuestion = cached[delivered]!;
    return {
      question: nextQuestion,
      statePatches: {
        currentDomain,
        domainCompletion,
        domainQuestions,
        domainFollowUpsDelivered,
      },
      fromCache: true,
    };
  }

  // ── Cache exhausted — run depth evaluator ──
  const depthResult = evaluateDomainDepth(currentDomain, state);

  if (!depthResult.isDeep && domainFollowUpsDelivered < maxFollowUps) {
    // Generate 1 follow-up question for this domain
    if (!provider) {
      throw new Error('No AI provider is configured.');
    }

    const followUp = await generateDomainQuestions(currentDomain, state, provider, {
      count: 1,
      style: opts.enableSoulTrack && currentDomain === 'team' ? 'soul' : undefined,
    });

    cached = followUp;
    domainQuestions[currentDomain] = followUp;
    domainCompletion[currentDomain] = 'follow_up';
    domainFollowUpsDelivered += 1;

    const nextQuestion = cached[0]!;
    return {
      question: nextQuestion,
      statePatches: {
        currentDomain,
        domainCompletion,
        domainQuestions,
        domainFollowUpsDelivered,
      },
      fromCache: true,
    };
  }

  // ── Domain is deep (or follow-ups exhausted) — mark complete and recurse ──
  domainCompletion[currentDomain] = 'complete';
  domainQuestions[currentDomain] = [];
  domainFollowUpsDelivered = 0;

  const nextState: InterviewState = {
    ...state,
    currentDomain,
    domainCompletion,
    domainQuestions,
    domainFollowUpsDelivered,
  };

  // Recurse to serve the next domain's first question
  return getNextDomainDrivenQuestion(nextState, provider, opts);
}
