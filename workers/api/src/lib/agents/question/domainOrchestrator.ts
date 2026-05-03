/**
 * Domain Orchestrator — Conversational column-by-column interview flow.
 *
 * Architecture:
 *   1. Pick next pending domain (team → work → bar → codebase → process → why)
 *   2. Generate + cache 4-6 domain questions (one LLM call per domain)
 *   3. Serve cached questions one by one
 *   4. After EACH answer, evaluate its quality
 *   5. If thin → warm drilling follow-up (light-hearted, non-invasive)
 *   6. If rich or max questions reached → advance to next domain
 *
 * When all domains are complete, returns a completion marker so the caller
 * can run synthesis.
 */

import type { LLMProvider } from '../../llm/types';
import type { Domain } from '../../../types';
import type { InterviewState, DomainCompletionStatus } from '../interview/types';
import { DOMAIN_COLUMN_ORDER } from '../interview/types';
import { generateDomainQuestions } from './domainGenerator';
import { evaluateLatestAnswer, buildWarmFollowUp } from './answerEvaluator';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DomainDrivenResult {
  type: 'question';
  /** Legacy-compatible question result (same shape as generateQuestion()). */
  result: {
    reasoning: string;
    acknowledgment: string;
    question: {
      id: string;
      text: string;
      goal?: string;
      input: { type: 'text' | 'textarea' | 'tags' | 'select' | 'radio'; options?: string[]; placeholder?: string };
      suggestedAnswers?: string[];
    };
    knowledgeStateUpdate: Record<string, Record<string, unknown>>;
    domainCoverage: Record<string, import('../../../types').DomainCoverage>;
  };
  /** State patches to apply before serving the question. */
  statePatches: Partial<Pick<InterviewState,
    'currentDomain' | 'domainCompletion' | 'domainQuestions' | 'domainQuestionsDelivered' | 'domainFollowUpsDelivered'
  >>;
  /** Whether this question came from the domain cache (true) or a fresh LLM call (false). */
  fromCache: boolean;
}

export interface DomainDrivenComplete {
  type: 'complete';
  /** All domains are deep/complete. */
  statePatches: Partial<Pick<InterviewState,
    'currentDomain' | 'domainCompletion' | 'domainQuestions' | 'domainQuestionsDelivered' | 'domainFollowUpsDelivered'
  >>;
}

export type DomainDrivenOutcome = DomainDrivenResult | DomainDrivenComplete;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pickNextDomain(state: InterviewState): Domain | null {
  for (const d of DOMAIN_COLUMN_ORDER) {
    const status = state.domainCompletion[d] ?? 'pending';
    if (status === 'pending' || status === 'generating') {
      return d;
    }
  }
  return null;
}

function allDomainsComplete(state: InterviewState): boolean {
  return DOMAIN_COLUMN_ORDER.every((d) => state.domainCompletion[d] === 'complete');
}

function getCachedQuestions(state: InterviewState, domain: Domain) {
  return state.domainQuestions[domain] ?? [];
}

function getDeliveredCount(state: InterviewState, domain: Domain): number {
  return state.domainQuestionsDelivered[domain] ?? 0;
}

/** Build a warm acknowledgment for a domain question. Rotates so it feels natural. */
function buildAcknowledgment(state: InterviewState, domain: Domain): string {
  const delivered = getDeliveredCount(state, domain);
  const acks = [
    "Got it — let's keep going.",
    "Interesting. Onward.",
    "Noted. Here's what's next.",
    "Makes sense. Moving along.",
    "Cool. Next up:",
    "Appreciate that. Let's dig into the next one.",
  ];
  return acks[delivered % acks.length]!;
}

/** Wrap a lightweight domain question into the legacy GeneratedQuestion shape. */
function wrapAsLegacy(
  q: { id: string; text: string; intent: string },
  _state: InterviewState,
  _domain: Domain,
): DomainDrivenResult['result'] {
  return {
    reasoning: `Domain-driven question for ${_domain}: ${q.intent}`,
    acknowledgment: buildAcknowledgment(_state, _domain),
    question: {
      id: q.id,
      text: q.text,
      goal: q.intent,
      input: { type: 'textarea' as const, placeholder: 'Share your thoughts…' },
    },
    knowledgeStateUpdate: {},
    domainCoverage: {},
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the next question using domain-driven flow.
 *
 * - If all domains are complete, returns `{ type: 'complete' }`.
 * - Evaluates the most recent answer and decides: drill deeper, serve next
 *   cached question, or advance to the next domain.
 */
export async function getNextDomainDrivenQuestion(
  state: InterviewState,
  provider: LLMProvider | null,
  opts: {
    /** Enable soul-style questioning for cultural domains. */
    enableSoulTrack?: boolean;
    /** Target number of questions per domain. Default: 4. */
    questionsPerDomain?: number;
    /** Max drilling follow-ups per domain. Default: 2. */
    maxFollowUps?: number;
  } = {},
): Promise<DomainDrivenOutcome> {
  // All domains complete — signal caller to run synthesis
  if (allDomainsComplete(state)) {
    return {
      type: 'complete',
      statePatches: {},
    };
  }

  const questionsPerDomain = opts.questionsPerDomain ?? 4;
  const maxFollowUps = opts.maxFollowUps ?? 2;

  let currentDomain = state.currentDomain;
  let domainCompletion: Record<string, DomainCompletionStatus> = { ...state.domainCompletion };
  let domainQuestions = { ...state.domainQuestions };
  let domainQuestionsDelivered = { ...state.domainQuestionsDelivered };
  let domainFollowUpsDelivered = state.domainFollowUpsDelivered;

  // ── Determine current domain ──
  if (!currentDomain || domainCompletion[currentDomain] === 'complete') {
    currentDomain = pickNextDomain(state);
    if (currentDomain) {
      domainCompletion[currentDomain] = 'generating';
    }
  }

  // No pending domains — this should not happen (allDomainsComplete catches it),
  // but handle gracefully
  if (!currentDomain) {
    return {
      type: 'complete',
      statePatches: { currentDomain, domainCompletion, domainQuestions, domainQuestionsDelivered, domainFollowUpsDelivered },
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

  // ── Evaluate the most recent answer (if any) ──
  // If the user just gave a thin answer, serve a warm drilling follow-up
  // instead of jumping to the next cached question.
  if (delivered > 0 && domainFollowUpsDelivered < maxFollowUps) {
    const evalResult = evaluateLatestAnswer(state);

    if (evalResult.needsFollowUp) {
      const currentQ = cached[delivered - 1];
      const followUp = buildWarmFollowUp(state, currentQ?.drillingHints?.[0], domainFollowUpsDelivered);

      domainFollowUpsDelivered += 1;
      domainQuestionsDelivered[currentDomain] = delivered + 1;
      domainCompletion[currentDomain] = 'follow_up';

      return {
        type: 'question',
        result: wrapAsLegacy(followUp, state, currentDomain),
        statePatches: {
          currentDomain,
          domainCompletion,
          domainQuestions,
          domainQuestionsDelivered,
          domainFollowUpsDelivered,
        },
        fromCache: false,
      };
    }
  }

  // ── Serve from cache if available ──
  if (delivered < cached.length) {
    const nextQuestion = cached[delivered]!;
    domainQuestionsDelivered[currentDomain] = delivered + 1;
    return {
      type: 'question',
      result: wrapAsLegacy(nextQuestion, state, currentDomain),
      statePatches: {
        currentDomain,
        domainCompletion,
        domainQuestions,
        domainQuestionsDelivered,
        domainFollowUpsDelivered,
      },
      fromCache: true,
    };
  }

  // ── Cache exhausted (all main + any needed follow-ups asked) ──
  // Mark domain complete and recurse to the next domain
  domainCompletion[currentDomain] = 'complete';
  domainQuestions[currentDomain] = [];
  domainQuestionsDelivered[currentDomain] = 0;
  domainFollowUpsDelivered = 0;

  const nextState: InterviewState = {
    ...state,
    currentDomain,
    domainCompletion,
    domainQuestions,
    domainQuestionsDelivered,
    domainFollowUpsDelivered,
  };

  // Recurse to serve the next domain's first question
  return getNextDomainDrivenQuestion(nextState, provider, opts);
}
