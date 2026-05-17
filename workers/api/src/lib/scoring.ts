/**
 * Pure scoring functions for the 6-dimension BARS code review rubric.
 *
 * All functions here are deterministic — no LLM calls, no side effects.
 * This makes them fully unit-testable.
 *
 * Rubric source of truth: scorerRubric.ts (ADR-032)
 */

import {
  SCORER_RUBRIC,
  DIMENSION_IDS,
  computeBarsComposite,
  type DimensionId,
} from './scorerRubric';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PlantedBug {
  id: number;
  severity: 'critical' | 'major' | 'minor';
  file?: string;
  line?: number;
  description: string;
  /** Whether the fixture author expects this bug to be found by a competent reviewer at this seniority level. */
  expectedFound?: boolean;
}

export interface EffectivenessScore {
  ris: number;
  efficiency: number;
  delta: number;
  score: number;
}

/** Scores for all 6 BARS dimensions (1-5 each) */
export type BarsDimensionScores = Record<DimensionId, number>;

// Re-export for convenience
export { DIMENSION_IDS, type DimensionId };

// ─── Legacy weight constants (kept for backward compatibility) ──────────────
// These are superseded by scorerRubric.ts weights, but kept so existing
// imports don't break during migration. Will be removed after full cutover.

export const TECH_WEIGHTS: Record<string, number> = {
  bug_detection: 0.20,
  root_cause_depth: 0.15,
  technical_accuracy: 0.15,
  design_awareness: 0.15,
  fix_quality: 0.15,
  false_positive_discipline: 0.10,
  severity_calibration: 0.10,
};

export const CONV_WEIGHTS: Record<string, number> = {
  pushback_handling: 0.20,
  explanation_clarity: 0.15,
  guidance_effectiveness: 0.15,
  clarifying_questions: 0.15,
  fix_verification: 0.10,
  thread_resolution: 0.10,
  concession_quality: 0.10,
  teaching_depth: 0.05,
};

export const PRACTICE_WEIGHTS: Record<string, number> = {
  bug_prioritization: 0.20,
  accuracy_discipline: 0.20,
  comment_substance: 0.15,
  verdict_quality: 0.15,
  craft_observations: 0.10,
  coverage: 0.10,
  positive_recognition: 0.10,
};

// ─── Severity weights for effectiveness ─────────────────────────────────────

const SEVERITY_WEIGHT: Record<string, number> = { critical: 3, major: 2, minor: 1 };

// ─── computeEffectiveness ───────────────────────────────────────────────────

/**
 * Computes the deterministic effectiveness score (no LLM).
 *
 * - RIS (50%): severity-weighted bug detection ratio (0-100)
 * - Efficiency (30%): useful_comments / total, penalized by false positives (0-100)
 * - Delta (20%): % of critical+major bugs found (0-100, defaults to 100 if none exist)
 * - Score: weighted composite
 */
export function computeEffectiveness(
  bugsFound: number[],
  bugsMissed: number[],
  groundTruth: PlantedBug[],
  falsePositiveCount: number,
  totalComments: number,
): EffectivenessScore {
  // RIS: severity-weighted bug detection
  const totalPossible = groundTruth.reduce((sum, b) => sum + (SEVERITY_WEIGHT[b.severity] ?? 1), 0);
  const foundWeight = groundTruth
    .filter((b) => bugsFound.includes(b.id))
    .reduce((sum, b) => sum + (SEVERITY_WEIGHT[b.severity] ?? 1), 0);
  const ris = totalPossible > 0 ? (foundWeight / totalPossible) * 100 : 0;

  // Efficiency: useful_comments / total_comments, -10% per false positive
  const usefulComments = Math.max(0, totalComments - falsePositiveCount);
  const rawEfficiency = totalComments > 0 ? (usefulComments / totalComments) * 100 : 0;
  const efficiency = Math.max(0, rawEfficiency - falsePositiveCount * 10);

  // Delta: % of critical+major bugs found
  const criticalMajor = groundTruth.filter((b) => b.severity === 'critical' || b.severity === 'major');
  const criticalMajorFound = criticalMajor.filter((b) => bugsFound.includes(b.id));
  const delta = criticalMajor.length > 0 ? (criticalMajorFound.length / criticalMajor.length) * 100 : 100;

  // Composite
  const score = 0.50 * ris + 0.30 * efficiency + 0.20 * delta;

  return {
    ris: Math.round(ris * 10) / 10,
    efficiency: Math.round(efficiency * 10) / 10,
    delta: Math.round(delta * 10) / 10,
    score: Math.round(score * 10) / 10,
  };
}

// ─── computeOverallScore ───────────────────────────────────────────────────

/**
 * Computes the overall score: BARS composite × 0.85 + effectiveness × 0.15.
 * BARS composite converts 6 dimension scores (1-5) to 0-100.
 *
 * Optional `dispositionalWeights` (from an RCD) are applied inside the BARS
 * composite step, clamped per dimension to [0.5, 1.5] and renormalized.
 */
export function computeOverallScore(
  dimensionScores: BarsDimensionScores,
  effectiveness: EffectivenessScore,
  level: 'junior' | 'mid' | 'senior' = 'mid',
  dispositionalWeights?: Record<string, number>,
): number {
  const barsComposite = computeBarsComposite(dimensionScores, level, dispositionalWeights);
  const { bars: barsWeight, effectiveness: effWeight } = SCORER_RUBRIC.compositeWeights;
  return Math.round(barsComposite * barsWeight + effectiveness.score * effWeight);
}

// ─── Legacy weightedAvg (kept for backward compatibility) ──────────────────

export interface DimensionScores {
  [key: string]: number;
}

/**
 * @deprecated Use computeBarsComposite() from scorerRubric.ts instead.
 * Computes a weighted average of dimension scores (1-10 scale) → 0-100.
 */
export function weightedAvg(dimensions: DimensionScores, weights: Record<string, number>): number {
  let sum = 0;
  for (const [key, weight] of Object.entries(weights)) {
    sum += (dimensions[key] ?? 5) * weight;
  }
  return Math.round(sum * 10);
}

// ─── Band assignment ────────────────────────────────────────────────────────

/**
 * Assigns a band based on overall score.
 * Uses rubric-defined thresholds: strong ≥75, adequate ≥45, weak <45.
 */
export function assignBand(overallScore: number): 'strong' | 'adequate' | 'weak' {
  if (overallScore >= SCORER_RUBRIC.bands.strong.min) return 'strong';
  if (overallScore >= SCORER_RUBRIC.bands.adequate.min) return 'adequate';
  return 'weak';
}

// ─── countReviewerComments ──────────────────────────────────────────────────

/**
 * Counts total reviewer comments across all rounds in a transcript.
 * Handles malformed/missing data gracefully.
 */
export function countReviewerComments(transcript: unknown): number {
  if (!transcript || typeof transcript !== 'object') return 0;
  const t = transcript as Record<string, unknown>;
  const rounds = t.rounds as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(rounds)) return 0;
  let count = 0;
  for (const round of rounds) {
    const comments = round.reviewer_comments as unknown[] | undefined;
    if (Array.isArray(comments)) count += comments.length;
  }
  return count;
}
