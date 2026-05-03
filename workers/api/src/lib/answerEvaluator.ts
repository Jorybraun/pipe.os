/**
 * Culture Interview — Heuristic Answer Evaluator (Analytics / Fallback).
 *
 * Ports the discovery agent's lightweight evaluator (Pattern 2).
 * Pure function. No LLM. <1ms.
 *
 * ⚠️  NOT wired into the live interview flow. The live path retains
 *    per-turn STAR analysis (`runTurnAnalysis`) for maximum quality.
 *
 * This module is kept for:
 *   - Offline transcript audit and coverage estimation
 *   - Mock-provider fallback when LLM is unavailable
 *   - Golden-set calibration baseline
 *
 * For live coverage computation, use `candidateCoverage.ts` which consumes
 * actual STAR slot analysis.
 */

export type AnswerQuality = 'rich' | 'moderate' | 'thin';

export interface AnswerEvaluation {
  quality: AnswerQuality;
  /** Human-readable explanation for logging and debugging. */
  reasoning: string;
  /** Whether a warm follow-up (probe) is warranted. */
  needsFollowUp: boolean;
}

// ─── Specificity heuristic ───────────────────────────────────────────────────

/** Heuristic: count specificity signals (names, numbers, examples, stories). */
export function specificityScore(answer: string): number {
  const indicators = [
    /\b\d+\b/, // numbers
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b/i, // dates
    /\b(for example|e\.g\.|such as|like when|one time|recently|last year|a few months ago)\b/i,
    /\b(specifically|in particular|namely|called|named)\b/i,
    /\b(we use|our stack|we run on|built with|written in)\b/i,
  ];
  return indicators.reduce((score, re) => score + (re.test(answer) ? 1 : 0), 0);
}

// ─── Core evaluator ──────────────────────────────────────────────────────────

/**
 * Evaluate a single candidate answer.
 *
 * Uses length + specificity heuristics. Tuned to be generous — we'd
 * rather move on than badger the candidate.
 *
 * Thresholds (from discovery agent):
 *   rich:     >120 chars AND specificity >= 2
 *   moderate: >60 chars  OR  specificity >= 1
 *   thin:     otherwise
 */
export function evaluateAnswer(answer: string): AnswerEvaluation {
  const trimmed = answer.trim();

  if (trimmed.length === 0) {
    return {
      quality: 'thin',
      reasoning: 'Empty answer.',
      needsFollowUp: true,
    };
  }

  const specScore = specificityScore(trimmed);

  // Rich: long AND specific
  if (trimmed.length > 120 && specScore >= 2) {
    return {
      quality: 'rich',
      reasoning: `Long (${trimmed.length} chars) + specific (${specScore} signals).`,
      needsFollowUp: false,
    };
  }

  // Moderate: decent length or some specificity
  if (trimmed.length > 60 || specScore >= 1) {
    return {
      quality: 'moderate',
      reasoning: `Moderate length (${trimmed.length}) / specificity (${specScore}).`,
      needsFollowUp: false,
    };
  }

  // Thin: short and vague
  return {
    quality: 'thin',
    reasoning: `Short (${trimmed.length} chars) and vague (${specScore} specificity signals).`,
    needsFollowUp: true,
  };
}

// ─── Batch evaluator ─────────────────────────────────────────────────────────

/**
 * Evaluate every answered turn in a transcript.
 *
 * Returns a Map keyed by turn index. Only seed turns (probeOf === null)
 * are evaluated; probe answers are skipped because they don't represent
 * new dimension coverage.
 */
export function evaluateTranscript(
  turns: Array<{ candidateResponse: string | null; probeOf: string | null }>,
): Map<number, AnswerEvaluation> {
  const results = new Map<number, AnswerEvaluation>();
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (!turn || turn.candidateResponse === null) continue;
    if (turn.probeOf !== null) continue; // probes don't count for coverage
    results.set(i, evaluateAnswer(turn.candidateResponse));
  }
  return results;
}
