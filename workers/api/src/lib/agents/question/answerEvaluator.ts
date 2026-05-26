/**
 * Answer Evaluator — lightweight heuristic quality check.
 *
 * Runs after every answer to decide whether to drill deeper or move on.
 * Pure function. No LLM. <1ms.
 *
 * Design goal: warm, non-invasive. We are not interrogating — we are
 * curiosity-matching. A thin answer gets a gentle nudge, not a probe.
 */

import type { Domain } from '../../../types';
import type { InterviewState } from '../interview/types';

export type AnswerQuality = 'rich' | 'moderate' | 'thin';

export interface AnswerEvaluation {
  quality: AnswerQuality;
  /** Human-readable explanation for logging. */
  reasoning: string;
  /** Whether a warm follow-up is warranted. */
  needsFollowUp: boolean;
}

// Warm, light-hearted follow-up templates — rotate so it never feels repetitive.
const WARM_FOLLOW_UPS = [
  "Could you paint me a quick picture of what that looks like day-to-day?",
  "I'd love to hear a specific example if one comes to mind — no pressure.",
  "That makes sense at a high level. What would that actually look like in practice?",
  "Curious — was there a moment that crystallized that for you?",
  "Tell me a bit more — what's the flavour of that in your world?",
  "Totally get it. If you had to describe it to a friend over coffee, what would you say?",
];

function pickWarmFollowUp(index: number): string {
  return WARM_FOLLOW_UPS[index % WARM_FOLLOW_UPS.length]!;
}

/** Heuristic: count specificity signals (names, numbers, examples, stories). */
function specificityScore(answer: string): number {
  const indicators = [
    /\b\d+\b/, // numbers
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b/i, // dates
    /\b(for example|e\.g\.|such as|like when|one time|recently|last year|a few months ago)\b/i,
    /\b(specifically|in particular|namely|called|named)\b/i,
    /\b(we use|our stack|we run on|built with|written in)\b/i,
  ];
  return indicators.reduce((score, re) => score + (re.test(answer) ? 1 : 0), 0);
}

/**
 * Evaluate the most recent answer for the current domain.
 *
 * Uses length + specificity heuristics. Tuned to be generous — we'd
 * rather move on than badger the user.
 */
export function evaluateLatestAnswer(state: InterviewState): AnswerEvaluation {
  if (!state.currentDomain) {
    return { quality: 'moderate', reasoning: 'No current domain.', needsFollowUp: false };
  }

  const domain = state.currentDomain;
  const delivered = state.domainQuestionsDelivered[domain] ?? 0;
  if (delivered === 0) {
    return { quality: 'moderate', reasoning: 'No questions delivered yet.', needsFollowUp: false };
  }

  // The last `delivered` exchanges belong to this domain.
  const exchanges = state.exchanges;
  const domainExchanges = exchanges.slice(-delivered);
  const lastExchange = domainExchanges[domainExchanges.length - 1];

  // Defensive: if no matching exchange exists (e.g. test fixtures), skip evaluation.
  if (!lastExchange) {
    return { quality: 'moderate', reasoning: 'No matching exchange found — skipping evaluation.', needsFollowUp: false };
  }

  const answer = lastExchange.answer?.trim() ?? '';

  if (answer.length === 0) {
    return { quality: 'thin', reasoning: 'Empty answer.', needsFollowUp: true };
  }

  const specScore = specificityScore(answer);

  // Rich: long AND specific
  if (answer.length > 120 && specScore >= 2) {
    return { quality: 'rich', reasoning: `Long (${answer.length} chars) + specific (${specScore}).`, needsFollowUp: false };
  }

  // Moderate: decent length or some specificity
  if (answer.length > 60 || specScore >= 1) {
    return { quality: 'moderate', reasoning: `Moderate length (${answer.length}) / specificity (${specScore}).`, needsFollowUp: false };
  }

  // Thin: short and vague
  return { quality: 'thin', reasoning: `Short (${answer.length} chars) and vague (${specScore} specificity signals).`, needsFollowUp: true };
}

/**
 * Build a warm, conversational follow-up question for a thin answer.
 *
 * Uses the current question's drillingHints when available, otherwise
 * falls back to a rotating set of light-hearted templates.
 */
export function buildWarmFollowUp(
  state: InterviewState,
  drillingHint?: string,
  followUpIndex = 0,
): { id: string; text: string; intent: string } {
  const text = drillingHint && drillingHint.length > 10
    ? drillingHint.replace(/\?$/, '') + ' — curious to hear your take.'
    : pickWarmFollowUp(followUpIndex);

  return {
    id: `dq-follow-up-${followUpIndex + 1}`,
    text,
    intent: 'Warm drilling follow-up for thin answer — conversational, non-invasive.',
  };
}
