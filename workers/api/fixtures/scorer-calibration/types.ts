/**
 * Scorer calibration fixture schema — ADR-036 Phase 3 / STRATEGY CAL-1.
 *
 * Each fixture is a fully-formed `ScorerInput` payload plus a human-annotated
 * expected-band range per dimension. The harness (CAL-2) runs the fixture
 * through the scorer under each provider override, and the analysis script
 * (CAL-3) computes Cohen's weighted κ per dimension per provider pair.
 *
 * Rules for authoring fixtures:
 *
 * 1. **Cover the anchor range.** At least one fixture must expect band 1 on
 *    each dimension, and at least one must expect band 5. Without range
 *    coverage, κ is uninformative due to range restriction.
 *
 * 2. **Expected bands are a range, not a point.** Humans disagree ±1 on BARS
 *    routinely; the fixture author commits to a min/max band, and the scorer
 *    is considered "in agreement" with the fixture if its output falls inside
 *    the range. κ is still computed on point estimates, but the range is used
 *    by the sanity-check pass that flags outlier fixtures.
 *
 * 3. **Every rationale line must reference concrete transcript evidence.**
 *    "Caught bug #2 in round 1 with a specific file:line" is rationale.
 *    "Good review" is not.
 *
 * 4. **Ground-truth dimensions** (`issue_identification`, `prioritization`,
 *    `revision_evaluation`) are derivable from the transcript + planted bugs.
 *    The expected band here should agree with the deterministic effectiveness
 *    score within ±1 band; if it doesn't, the fixture is internally inconsistent.
 *
 * 5. **Communication dimensions** (`reasoning_quality`, `question_formation`,
 *    `ai_direction`) have no structural ground truth. Sonnet acts as oracle
 *    during CAL-3 for these three — the fixture's expected band is the
 *    human-author anchor that Sonnet is measured against.
 *
 * 6. **Never bake in internal IDs.** Planted bug IDs are fixture-local
 *    (start at 1), not D1 row IDs. The harness does not touch the database.
 */

import type { PlantedBug, ReviewRound } from '../../src/lib/implementerAgent';

export type DimensionId =
  | 'issue_identification'
  | 'prioritization'
  | 'revision_evaluation'
  | 'reasoning_quality'
  | 'question_formation'
  | 'ai_direction';

export type Seniority = 'junior' | 'mid' | 'senior';

export interface ExpectedBand {
  /** Inclusive lower bound (1-5). */
  min: number;
  /** Inclusive upper bound (1-5). */
  max: number;
  /** One-line justification grounded in transcript evidence. */
  rationale: string;
}

export interface ScorerCalibrationFixture {
  /** Stable fixture identifier — used by the harness as the output filename. */
  id: string;
  /** One-line summary shown in CAL-3 reports. */
  description: string;
  /** Tags for filtering (e.g. "typescript", "security", "refactor"). */
  tags: string[];
  /** Candidate seniority level — drives the scorer's BARS weight profile. */
  seniority: Seniority;
  /** PR context fed to both Scorer A (ground truth) and Scorer B (communication). */
  prContext: {
    title: string;
    description: string;
    instructions: string;
    /** Unified diff the candidate reviewed. */
    diff: string;
  };
  /** Fixture-local planted bug list. IDs are small integers starting at 1. */
  groundTruth: PlantedBug[];
  /** Completed transcript — what the scorer actually reads. */
  transcript: {
    rounds: ReviewRound[];
    verdict?: {
      decision: 'approve' | 'request_changes' | 'reject';
      summary: string;
      submittedAt: string;
    };
  };
  /** Human-author expected band per dimension (1-5 range). */
  expectedBands: Record<DimensionId, ExpectedBand>;
}
