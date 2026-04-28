/**
 * Culture Calibration Fixture Types
 *
 * Defines the shape for synthetic culture-interview transcripts used to
 * calibrate the multi-agent culture scorer. Each fixture pairs a hand-written
 * transcript with heuristic-assigned BARS score ranges and grounding evidence
 * quotes.
 *
 * @see cultureScorer.ts — scorer pipeline that consumes these fixtures
 * @see calibrate-culture.ts — QWK harness that compares expert vs agent scores
 */

export type DimensionId =
  | 'ownership'
  | 'collaboration'
  | 'learning-orientation'
  | 'conflict-handling'
  | 'self-awareness'
  | 'autonomy'
  | 'risk-tolerance'
  | 'work-pace'
  | 'collaboration-style'
  | 'feedback-orientation';

/** Alias for backward compatibility with calibration scripts. */
export type CultureDimensionId = DimensionId;

export interface ExpectedScoreRange {
  /** Lower bound of the expected score (1–5, inclusive). */
  min: number;
  /** Upper bound of the expected score (1–5, inclusive). */
  max: number;
  /** Verbatim quotes from the transcript that ground this expected range. */
  evidenceQuotes: string[];
}

export interface CultureCalibrationFixture {
  /** Stable fixture identifier (e.g. 'culture-001'). */
  id: string;

  /** Synthetic interview transcript — agent questions + candidate responses. */
  transcript: Array<{
    speaker: 'agent' | 'candidate';
    text: string;
  }>;

  /**
   * Expert-assigned expected score ranges for every dimension.
   * Every DimensionId key must be present.
   */
  expectedScores: Record<DimensionId, ExpectedScoreRange>;

  /** Version of the question bank these fixtures were authored against. */
  questionBankVersion: string;

  /** Optional RCD-derived dispositional weights applied during calibration. */
  dispositionalWeights?: Record<string, number>;

  /** Tag list — typically the dimensions this fixture anchors most strongly. */
  tags: string[];

  /** Epistemic confidence in the fixture's ground-truth scores. */
  confidence: 'expert' | 'heuristic';
}
