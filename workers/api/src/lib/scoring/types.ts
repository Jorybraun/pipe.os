/**
 * Canonical score report types — cross-assessment alignment groundwork.
 *
 * Defines normalized shapes for all assessment score reports so that
 * downstream matching and aggregation can consume them uniformly.
 *
 * No runtime behavior changes yet; this is pure type scaffolding.
 */

// ─── Review Score Report (Code Review) ───────────────────────────────────────

export type ReviewDimensionId =
  | 'issue_identification'
  | 'reasoning_quality'
  | 'prioritization'
  | 'question_formation'
  | 'revision_evaluation'
  | 'ai_direction';

export interface ReviewScoreDimension {
  score: number; // 1–5
  evidence?: string;
}

export interface ReviewScoreReport {
  dimensions: Record<ReviewDimensionId, number>;
  evidence: Partial<Record<`${ReviewDimensionId}_evidence`, string>>;
  metrics: {
    bugs_found_pct: number;
    false_positive_count: number;
    cave_ratio: number;
    fix_verifications: number;
  };
  effectiveness: {
    ris: number;
    efficiency: number;
    delta: number;
    score: number;
  };
  overall: {
    score: number; // 0–100
    band: 'strong' | 'adequate' | 'weak';
    narrative: string;
    strengths: string[];
    growth_areas: string[];
  };
  scorer_a_summary: string;
  scorer_b_summary: string;
}

// ─── Culture Score Report ────────────────────────────────────────────────────

export type CultureCompetencyDimension =
  | 'ownership'
  | 'collaboration'
  | 'adaptability'
  | 'problem_solving'
  | 'communication';

export type CultureProfileDimension =
  | 'autonomy_preference'
  | 'feedback_orientation'
  | 'pace_preference'
  | 'risk_tolerance'
  | 'structure_preference';

export interface CultureCompetencyScore {
  dimension: CultureCompetencyDimension;
  score: 1 | 2 | 3 | 4 | 5;
  confidence: number;
  evidenceQuotes: string[];
  reasoning: string;
}

export interface CultureProfileScore {
  dimension: CultureProfileDimension;
  candidatePosition: 1 | 2 | 3 | 4 | 5;
  confidence: number;
  evidenceQuotes: string[];
  reasoning: string;
}

export interface CultureScoreReport {
  competencyScores: CultureCompetencyScore[];
  profileScores: CultureProfileScore[];
  dealbreakerFlags: Array<{
    dimension: string;
    flagType: string;
    rationale: string;
  }>;
  hitlReviewRequired: boolean;
  synthesis: {
    headline: string;
    narrative: string;
    recommendation: 'HIRE' | 'FLAG_FOR_REVIEW' | 'PASS';
  };
  scoredAt: string;
}

// ─── Normalized / Triangulated Shape ─────────────────────────────────────────

export interface TriangulatedScores {
  /** ISO timestamp when scoring completed */
  scoredAt: string;
  /** Overall composite score (0–100) */
  overallScore: number;
  /** Normalized dimension scores, keyed by dimension ID (0–100 each) */
  dimensions: Record<string, number>;
  /** Human-readable synthesis */
  narrative: string;
  /** Source assessment type */
  source: 'code_review' | 'culture_interview';
}

// ─── Normalizers ─────────────────────────────────────────────────────────────

function barsToHundred(score: number): number {
  // BARS 1–5 → 0–100
  return Math.round(score * 20);
}

export function normalizeReviewScoreToTriangulated(
  report: ReviewScoreReport,
  scoredAt = new Date().toISOString(),
): TriangulatedScores {
  const dimensions: Record<string, number> = {};
  for (const [id, score] of Object.entries(report.dimensions)) {
    dimensions[id] = barsToHundred(score);
  }

  return {
    scoredAt,
    overallScore: report.overall.score,
    dimensions,
    narrative: report.overall.narrative,
    source: 'code_review',
  };
}

export function normalizeCultureScoreToTriangulated(
  report: CultureScoreReport,
): TriangulatedScores {
  const dimensions: Record<string, number> = {};

  let totalScore = 0;
  let count = 0;

  for (const c of report.competencyScores) {
    dimensions[c.dimension] = barsToHundred(c.score);
    totalScore += c.score;
    count++;
  }

  for (const p of report.profileScores) {
    dimensions[p.dimension] = barsToHundred(p.candidatePosition);
    totalScore += p.candidatePosition;
    count++;
  }

  const overallScore = count > 0 ? barsToHundred(totalScore / count) : 0;

  return {
    scoredAt: report.scoredAt,
    overallScore,
    dimensions,
    narrative: report.synthesis.narrative,
    source: 'culture_interview',
  };
}

/**
 * Union normalizer — dispatches to the correct converter based on report shape.
 */
export function normalizeToTriangulatedScores(
  report: ReviewScoreReport | CultureScoreReport,
): TriangulatedScores {
  if ('competencyScores' in report) {
    return normalizeCultureScoreToTriangulated(report);
  }
  return normalizeReviewScoreToTriangulated(report);
}
