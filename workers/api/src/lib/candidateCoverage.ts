/**
 * Culture Interview — Coverage Computation + Gap Detection.
 *
 * High-quality coverage engine that consumes STAR slot analysis (not
 * heuristics). Tracks per-dimension depth, specificity-weighted coverage,
 * systematic gap patterns, and targeted probe recommendations.
 *
 * Designed for quality-first interviews where per-turn LLM analysis is
 * retained. The coverage state accumulates STAR signals across the transcript
 * to build a rich portrait of where the candidate has been explored deeply
 * and where drilling is still needed.
 */

import type { StarSlot } from './cultureQuestionBank';

// ─── Types ─────────────────────────────────────────────────────────────────────

/** A turn that has been analyzed for STAR slots. */
export interface StarCoverageTurn {
  questionId: string;
  probeOf: string | null;
  dimension: string;
  starSlots: Record<StarSlot, { present: boolean; specificity: number }>;
}

/** Per-dimension depth analysis. */
export interface DimensionDepth {
  dimension: string;
  /** Number of seed turns for this dimension. */
  turnCount: number;
  /** Average specificity across all present slots (0–2). */
  avgSpecificity: number;
  /** Percentage of expected slots that are present (0–1). */
  completeness: number;
  /** Slots that are absent or weak across turns for this dimension. */
  missingSlots: StarSlot[];
  /** Slots that are present but weak (specificity < 1). */
  weakSlots: StarSlot[];
  /** Coverage score weighted by specificity and completeness (0–2). */
  depthScore: number;
}

/** Probe recommendation for a dimension with gaps. */
export interface ProbeRecommendation {
  dimension: string;
  missingSlots: StarSlot[];
  weakSlots: StarSlot[];
  /** Suggested probe templates targeting the specific gaps. */
  suggestedProbes: string[];
}

export interface CoverageState {
  dimensions: DimensionDepth[];
  /** Dimensions with depthScore below the threshold. */
  gaps: string[];
  /** True when every dimension has depthScore >= threshold. */
  isComplete: boolean;
  /** Probe recommendations for gap dimensions. */
  probeRecommendations: ProbeRecommendation[];
  /** Human-readable summary. */
  summary: string;
}

export interface CoverageConfig {
  /** Minimum depthScore per dimension to consider it covered. Default 1.0. */
  threshold: number;
  /** Minimum specificity for a slot to count as "strong". Default 1. */
  strongSpecificity: number;
  /** Minimum completeness ratio for a slot to not be "missing". Default 0.5. */
  slotPresenceThreshold: number;
}

export const DEFAULT_COVERAGE_CONFIG: CoverageConfig = {
  threshold: 1.0,
  strongSpecificity: 1,
  slotPresenceThreshold: 0.5,
};

const STAR_KEYS: StarSlot[] = ['S', 'T', 'A', 'R'];

// ─── Per-answer coverage scoring ───────────────────────────────────────────────

/**
 * Compute a depth score for a single set of STAR slots.
 *
 * Depth = (average specificity of present slots) * (completeness ratio)
 *
 * A complete answer with high specificity scores near 2.0.
 * A thin answer with vague specifics scores near 0.0.
 */
export function scoreStarDepth(
  slots: Record<StarSlot, { present: boolean; specificity: number }>,
): { depthScore: number; completeness: number; avgSpecificity: number } {
  let presentCount = 0;
  let totalSpecificity = 0;

  for (const k of STAR_KEYS) {
    const s = slots[k];
    if (s.present) {
      presentCount++;
      totalSpecificity += s.specificity;
    }
  }

  const completeness = presentCount / STAR_KEYS.length;
  const avgSpecificity = presentCount > 0 ? totalSpecificity / presentCount : 0;
  const depthScore = avgSpecificity * completeness;

  return { depthScore, completeness, avgSpecificity };
}

// ─── Aggregate coverage computation ────────────────────────────────────────────

/**
 * Build a full `CoverageState` from STAR-analyzed turns.
 *
 * Only seed turns (probeOf === null) contribute to dimension depth.
 * Probe turns sharpen existing signal but don't open new dimensions.
 */
export function computeCoverageState(
  turns: StarCoverageTurn[],
  dimensions: string[],
  config: Partial<CoverageConfig> = {},
): CoverageState {
  const cfg = { ...DEFAULT_COVERAGE_CONFIG, ...config };

  // Accumulate per-dimension slot statistics.
  const dimStats: Record<
    string,
    {
      turnCount: number;
      slotCounts: Record<StarSlot, { present: number; totalSpecificity: number }>;
    }
  > = {};

  for (const dim of dimensions) {
    dimStats[dim] = {
      turnCount: 0,
      slotCounts: {
        S: { present: 0, totalSpecificity: 0 },
        T: { present: 0, totalSpecificity: 0 },
        A: { present: 0, totalSpecificity: 0 },
        R: { present: 0, totalSpecificity: 0 },
      },
    };
  }

  for (const turn of turns) {
    if (turn.probeOf !== null) continue;
    const stats = dimStats[turn.dimension];
    if (!stats) continue;

    stats.turnCount += 1;
    for (const k of STAR_KEYS) {
      const s = turn.starSlots[k];
      if (s.present) {
        stats.slotCounts[k].present += 1;
        stats.slotCounts[k].totalSpecificity += s.specificity;
      }
    }
  }

  // Build DimensionDepth records.
  const dimensionDepths: DimensionDepth[] = [];
  for (const dim of dimensions) {
    const stats = dimStats[dim];
    const { turnCount, slotCounts } = stats;

    const missingSlots: StarSlot[] = [];
    const weakSlots: StarSlot[] = [];
    let totalSlotDepth = 0;

    for (const k of STAR_KEYS) {
      const sc = slotCounts[k];
      const presenceRatio = turnCount > 0 ? sc.present / turnCount : 0;
      const avgSpec = sc.present > 0 ? sc.totalSpecificity / sc.present : 0;
      const slotDepth = presenceRatio * avgSpec;

      if (presenceRatio < cfg.slotPresenceThreshold) {
        missingSlots.push(k);
      } else if (avgSpec < cfg.strongSpecificity) {
        weakSlots.push(k);
      }

      totalSlotDepth += slotDepth;
    }

    const depthScore = STAR_KEYS.length > 0 ? totalSlotDepth / STAR_KEYS.length : 0;
    const completeness = turnCount > 0
      ? (STAR_KEYS.reduce((sum, k) => sum + (slotCounts[k].present > 0 ? 1 : 0), 0) / STAR_KEYS.length)
      : 0;
    const avgSpecificity = turnCount > 0
      ? (STAR_KEYS.reduce((sum, k) => sum + (slotCounts[k].present > 0 ? slotCounts[k].totalSpecificity / slotCounts[k].present : 0), 0) / STAR_KEYS.length)
      : 0;

    dimensionDepths.push({
      dimension: dim,
      turnCount,
      avgSpecificity: Math.round(avgSpecificity * 100) / 100,
      completeness: Math.round(completeness * 100) / 100,
      missingSlots,
      weakSlots,
      depthScore: Math.round(depthScore * 100) / 100,
    });
  }

  const gaps = dimensionDepths
    .filter((d) => d.depthScore < cfg.threshold)
    .map((d) => d.dimension);

  const isComplete = gaps.length === 0;

  const probeRecommendations = buildProbeRecommendations(
    dimensionDepths.filter((d) => d.missingSlots.length > 0 || d.weakSlots.length > 0),
  );

  const coveredCount = dimensions.length - gaps.length;
  const summary = `${coveredCount}/${dimensions.length} dimensions at target depth (${gaps.length} gaps: ${gaps.join(', ') || 'none'}).`;

  return { dimensions: dimensionDepths, gaps, isComplete, probeRecommendations, summary };
}

// ─── Probe recommendations ─────────────────────────────────────────────────────

const SLOT_PROBE_TEMPLATES: Record<StarSlot, string[]> = {
  S: [
    'Walk me through the specific situation — what was the context?',
    'What was going on at the time? Who was involved?',
  ],
  T: [
    'What was your specific responsibility or task in that situation?',
    'What were you personally accountable for?',
  ],
  A: [
    'What did you specifically do? Not the team — you.',
    'Walk me through the steps you took.',
  ],
  R: [
    'What was the outcome? How did you measure success?',
    'What happened as a result? What would you do differently?',
  ],
};

function buildProbeRecommendations(gapDimensions: DimensionDepth[]): ProbeRecommendation[] {
  return gapDimensions.map((dim) => {
    const targetSlots = [...dim.missingSlots, ...dim.weakSlots];
    const suggestedProbes: string[] = [];
    for (const slot of targetSlots.slice(0, 2)) {
      const templates = SLOT_PROBE_TEMPLATES[slot];
      suggestedProbes.push(templates[dim.turnCount % templates.length]);
    }
    return {
      dimension: dim.dimension,
      missingSlots: dim.missingSlots,
      weakSlots: dim.weakSlots,
      suggestedProbes,
    };
  });
}

// ─── Termination gate ──────────────────────────────────────────────────────────

/**
 * Check whether the interview can terminate.
 *
 * Uses depth-based coverage instead of simple counts.
 */
export function evaluateCoverageTermination(input: {
  coverageState: CoverageState;
  questionsAsked: number;
  minQuestions: number;
  maxQuestions: number;
}): 'hard_cap' | 'coverage_complete' | null {
  const { coverageState, questionsAsked, minQuestions, maxQuestions } = input;

  if (questionsAsked >= maxQuestions) return 'hard_cap';
  if (questionsAsked < minQuestions) return null;
  if (coverageState.isComplete) return 'coverage_complete';
  return null;
}

// ─── Gap analysis helpers ──────────────────────────────────────────────────────

/**
 * Return dimensions ordered by ascending depth score.
 */
export function rankCoverageGaps(
  coverageState: CoverageState,
): Array<{ dimension: string; depthScore: number }> {
  return [...coverageState.dimensions]
    .sort((a, b) => a.depthScore - b.depthScore)
    .map((d) => ({ dimension: d.dimension, depthScore: d.depthScore }));
}

/**
 * Return true if a specific dimension is at or above the depth threshold.
 */
export function isDimensionCovered(
  dimension: string,
  coverageState: CoverageState,
  config: Partial<CoverageConfig> = {},
): boolean {
  const cfg = { ...DEFAULT_COVERAGE_CONFIG, ...config };
  const dim = coverageState.dimensions.find((d) => d.dimension === dimension);
  return (dim?.depthScore ?? 0) >= cfg.threshold;
}
