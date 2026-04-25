/**
 * Culture Scorer — QWK calibration harness.
 *
 * ### Purpose
 *
 * Before shipping any prompt change, hand-score 10 sample transcripts against
 * the BARS rubrics, then run this harness against the same transcripts.
 * Compute Quadratic Weighted Kappa (QWK) across all expert vs. agent score
 * pairs. Target: overall QWK ≥ 0.55 (research brief §2.9).
 *
 * ### What QWK measures
 *
 * QWK penalizes large disagreements more than small ones. A QWK of 1.0 means
 * perfect agreement; 0.0 means no better than chance; negative means
 * systematically worse than chance. The target of 0.55 sits comfortably
 * within the human inter-rater agreement range documented in Huynh et al. 2025.
 *
 * ### Usage
 *
 * ```bash
 * cd workers/api && npx tsx scripts/run-culture-calibration.ts
 * ```
 *
 * @see scripts/run-culture-calibration.ts — CLI runner
 * @see src/lib/__tests__/cultureScorerCalibration.fixtures.ts — ground truth
 * @see research brief §2.9 — QWK target and methodology
 */

import type { LLMProvider } from './llm/types';
import { scoreCultureInterview, type OrgCultureBenchmark } from './cultureScorer';
import type { CompetencyDimension } from './cultureQuestionBank';
import { CULTURE_PROFILE_DIMENSIONS } from './cultureScorer';
import type { CultureProfileDimension } from './cultureScorerPrompts';
import type { CalibrationFixture } from './__tests__/cultureScorerCalibration.fixtures';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CalibrationResult {
  fixtureLabel: string;
  dimension: string;
  expertScore: number;
  agentScore: number;
}

export interface CalibrationReport {
  competencyResults: CalibrationResult[];
  profileResults: CalibrationResult[];
  competencyQwk: number;
  profileQwk: number;
  overallQwk: number;
  /** true when overallQwk >= 0.55 */
  passed: boolean;
  generatedAt: string;
}

// ─── QWK implementation ───────────────────────────────────────────────────────

/**
 * Compute Quadratic Weighted Kappa between two arrays of integer ratings.
 *
 * Both arrays must be the same length and contain values in the range
 * [1, numCategories]. The implementation follows the standard confusion-matrix
 * formulation used in the ML inter-rater literature.
 *
 * Edge cases:
 *   - All ratings identical (both arrays) → returns 1.0 (perfect agreement).
 *   - Mismatched array lengths → throws.
 *   - Empty arrays → throws.
 *
 * @param ratingsA - Expert ratings, each in [1, numCategories].
 * @param ratingsB - Agent ratings, each in [1, numCategories].
 * @param numCategories - Size of the rating scale (5 for BARS 1–5).
 * @returns QWK in the range [-1, 1]. Target ≥ 0.55 per research brief §2.9.
 */
export function quadraticWeightedKappa(
  ratingsA: number[],
  ratingsB: number[],
  numCategories: number,
): number {
  if (ratingsA.length === 0 || ratingsB.length === 0) {
    throw new Error('quadraticWeightedKappa: ratings arrays must not be empty.');
  }
  if (ratingsA.length !== ratingsB.length) {
    throw new Error(
      `quadraticWeightedKappa: array lengths must match (got ${ratingsA.length} vs ${ratingsB.length}).`,
    );
  }

  const n = numCategories;
  const N = ratingsA.length;

  // Build weight matrix: w[i][j] = (i - j)^2 / (n - 1)^2
  // Using 0-indexed internally; caller uses 1-indexed scores.
  const weights: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => Math.pow(i - j, 2) / Math.pow(n - 1, 2)),
  );

  // Convert 1-indexed scores to 0-indexed.
  const a0 = ratingsA.map((r) => r - 1);
  const b0 = ratingsB.map((r) => r - 1);

  // Build observed confusion matrix.
  const confusion: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let k = 0; k < N; k++) {
    const ai = a0[k];
    const bi = b0[k];
    if (ai === undefined || bi === undefined) continue;
    if (ai < 0 || ai >= n || bi < 0 || bi >= n) {
      throw new Error(
        `quadraticWeightedKappa: rating out of range [1, ${n}]: found a=${ai + 1}, b=${bi + 1}`,
      );
    }
    const row = confusion[ai];
    if (row !== undefined) row[bi] = (row[bi] ?? 0) + 1;
  }

  // Row and column histograms (marginals).
  const rowHist = new Array<number>(n).fill(0);
  const colHist = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cell = confusion[i]?.[j] ?? 0;
      rowHist[i] = (rowHist[i] ?? 0) + cell;
      colHist[j] = (colHist[j] ?? 0) + cell;
    }
  }

  // Build expected matrix from marginals: expected[i][j] = rowHist[i] * colHist[j] / N
  const expected: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => ((rowHist[i] ?? 0) * (colHist[j] ?? 0)) / N),
  );

  // Compute weighted sums.
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const w = weights[i]?.[j] ?? 0;
      numerator += w * (confusion[i]?.[j] ?? 0);
      denominator += w * (expected[i]?.[j] ?? 0);
    }
  }

  // When all ratings agree perfectly, both numerator and denominator are 0.
  if (denominator === 0) return 1.0;

  return 1 - numerator / denominator;
}

// ─── Calibration runner ───────────────────────────────────────────────────────

const QWK_TARGET = 0.55;
const BARS_SCALE = 5;

/**
 * Run the calibration harness against a set of fixtures.
 *
 * Calls the scorer for each fixture sequentially (not in parallel) to avoid
 * overwhelming the LLM endpoint during a calibration run.
 *
 * @param args.provider - LLM provider connected to the real model endpoint.
 * @param args.fixtures - Calibration fixtures with expert ground-truth scores.
 * @param args.orgBenchmark - Org benchmark to pass to the scorer (use defaults for calibration).
 * @returns CalibrationReport including per-dimension results and QWK metrics.
 */
export async function runCalibration(args: {
  provider: LLMProvider;
  fixtures: CalibrationFixture[];
  orgBenchmark: OrgCultureBenchmark;
}): Promise<CalibrationReport> {
  const { provider, fixtures, orgBenchmark } = args;

  const competencyResults: CalibrationResult[] = [];
  const profileResults: CalibrationResult[] = [];

  for (const fixture of fixtures) {
    console.log(`  Scoring fixture: ${fixture.label}`);

    const report = await scoreCultureInterview({
      provider,
      transcript: fixture.transcript,
      orgBenchmark,
    });

    // Collect competency scores.
    const competencyDimensions: readonly CompetencyDimension[] = [
      'ownership',
      'collaboration',
      'learning-orientation',
      'conflict-handling',
      'self-awareness',
    ];
    for (const dim of competencyDimensions) {
      const agentResult = report.competencyScores.find((s) => s.dimension === dim);
      if (agentResult === undefined) {
        console.warn(`[cultureScorerCalibration] Missing competency score for ${dim} in fixture "${fixture.label}"`);
        continue;
      }
      competencyResults.push({
        fixtureLabel: fixture.label,
        dimension: dim,
        expertScore: fixture.expertCompetencyScores[dim],
        agentScore: agentResult.score,
      });
    }

    // Collect profile scores.
    for (const dim of CULTURE_PROFILE_DIMENSIONS) {
      const profileDim = dim as CultureProfileDimension;
      const agentResult = report.profileScores.find((s) => s.dimension === profileDim);
      if (agentResult === undefined) {
        console.warn(`[cultureScorerCalibration] Missing profile score for ${dim} in fixture "${fixture.label}"`);
        continue;
      }
      profileResults.push({
        fixtureLabel: fixture.label,
        dimension: dim,
        expertScore: fixture.expertProfileScores[profileDim],
        agentScore: agentResult.candidatePosition,
      });
    }
  }

  const competencyQwk = quadraticWeightedKappa(
    competencyResults.map((r) => r.expertScore),
    competencyResults.map((r) => r.agentScore),
    BARS_SCALE,
  );

  const profileQwk = quadraticWeightedKappa(
    profileResults.map((r) => r.expertScore),
    profileResults.map((r) => r.agentScore),
    BARS_SCALE,
  );

  // Overall QWK pools all 100 data points (50 competency + 50 profile).
  const allExpert = [
    ...competencyResults.map((r) => r.expertScore),
    ...profileResults.map((r) => r.expertScore),
  ];
  const allAgent = [
    ...competencyResults.map((r) => r.agentScore),
    ...profileResults.map((r) => r.agentScore),
  ];
  const overallQwk = quadraticWeightedKappa(allExpert, allAgent, BARS_SCALE);

  return {
    competencyResults,
    profileResults,
    competencyQwk,
    profileQwk,
    overallQwk,
    passed: overallQwk >= QWK_TARGET,
    generatedAt: new Date().toISOString(),
  };
}
