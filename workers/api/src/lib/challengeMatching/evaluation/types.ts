import type {
  PairScore,
  RoleSourceReference,
  SourceRef,
  StretchMatch,
} from '../types';
import type { ChallengeReviewProfile } from '../../repoSemanticGraph';

/**
 * Schema version for frozen evaluation corpora.
 *
 * Concept keys remain open data. This schema defines evidence and evaluation
 * structure, not a closed semantic taxonomy.
 */
export const EVALUATION_CORPUS_VERSION = '1.0.0' as const;

export type RelevanceGrade =
  | 'highly_relevant'
  | 'relevant'
  | 'borderline'
  | 'irrelevant'
  | 'forbidden';

export type GuardrailViolation =
  | 'language_requirement'
  | 'forbidden_language'
  | 'required_concept'
  | 'forbidden_concept'
  | 'seniority_requirement'
  | 'multi_stretch_exceeded'
  | 'missing_provenance'
  | 'expert_forbidden_result';

export type StretchPath = StretchMatch;
export type EvidenceReference = SourceRef;

export interface CandidatePersonEvidence {
  candidateId: string;
  evidenceId: string;
  episodeId: string;
  narrative: string;
  concepts: string[];
  problems?: string[];
  mechanisms?: string[];
  domains?: string[];
  businessObjects?: string[];
  ownershipActions?: string[];
  evidenceReferences: EvidenceReference[];
}

export interface RoleRequirements {
  roleId: string;
  requiredLanguages: string[];
  forbiddenLanguages?: string[];
  relevantConcepts?: string[];
  genericConcepts?: string[];
  requiredConcepts?: string[];
  forbiddenConcepts?: string[];
  minimumSeniority?: 'junior' | 'mid' | 'senior' | 'staff' | 'principal';
  sourceReferences: RoleSourceReference[];
}

export interface ExpertLabel {
  labelId: string;
  candidateId: string;
  roleId: string;
  challengeId: string;
  relevanceGrade: RelevanceGrade;
  eligibleChallengeIds: string[];
  forbiddenRoles?: string[];
  guardrailViolations?: GuardrailViolation[];
  permittedStretchPaths?: StretchPath[];
  explanation?: string;
  labelVersion: string;
  labeledAt: string;
  labeledBy: string;
  labelProvenance?: {
    reviewerId: string;
    reviewerRole?: string;
    reviewArtifactId: string;
    reviewArtifactVersion: string;
    contentHash: string;
    locator: string;
    rubricVersion: string;
  };
}

/**
 * Expected repo packet / PR identity declared by the corpus.
 *
 * The corpus is self-describing about which challenge packets (repo + PR +
 * source version) the matcher is expected to surface for each labelled
 * challenge. The evaluation harness cross-checks persisted match runs against
 * these declarations so that a drift in packet identity (e.g. a different PR
 * number or source version for the same challenge id) is caught as a coverage
 * failure rather than a silent rerank.
 */
export interface ExpectedDemandReference {
  demandId: string;
  concepts: string[];
  sourceRefs: EvidenceReference[];
}

export interface ExpectedChallengePacket {
  challengeId: string;
  repoId: string;
  repoFullName?: string;
  repoUrl?: string;
  prNumber: number;
  prUrl?: string;
  prTitle?: string;
  sourceVersion: string;
  packetContentHash?: string;
  demands?: ExpectedDemandReference[];
}

export interface EvaluationCorpus {
  version: typeof EVALUATION_CORPUS_VERSION;
  corpusId: string;
  createdAt: string;
  description: string;
  candidateEvidence: CandidatePersonEvidence[];
  roleRequirements: RoleRequirements[];
  expertLabels: ExpertLabel[];
  /**
   * Expected repo packets / PRs that the matcher must surface for labelled
   * challenges. Optional for backward compatibility with v1.0.0 corpora that
   * predate packet identity coverage; the staged rollout gate treats a missing
   * declaration as a coverage gap for canary/production stages.
   */
  expectedPackets?: ExpectedChallengePacket[];
  metadata: {
    totalLabels: number;
    totalCandidates: number;
    totalRoles: number;
    totalChallenges: number;
    syntheticFixtureCount: number;
    totalExpectedPackets?: number;
  };
}

/**
 * Source-backed alignment exactly as persisted in match_runs.ranked_results_json.
 */
export interface PersistedMatchAlignment {
  atomId: string;
  demandId: string;
  pairScore: number;
  pairScoreBreakdown?: PairScore;
  weightedScore?: number;
  stretch: StretchPath | null;
  sharedConcepts: string[];
  roleSourceRefs: RoleSourceReference[];
  candidateSourceRefs: SourceRef[];
  challengeSourceRefs: SourceRef[];
}

export interface PersistedRankedChallenge {
  rank: number | null;
  recallRank: number;
  challengeId: string;
  repoId: string;
  prNumber: number;
  sourceVersion: string;
  packetContentHash?: string;
  score: number;
  candidateEvidenceAlignment: number;
  roleRelevance: number;
  contextualSpecificity: number;
  challengeQuality: number;
  validationDeepeningValue: number;
  reviewProfile?: ChallengeReviewProfile;
  alignedDemandCount: number;
  stretchCount: number;
  stretchDemandWeightRatio: number;
  provenanceComplete: boolean;
  eligible: boolean;
  alignments: PersistedMatchAlignment[];
  rejectionReasons: string[];
}

export interface PersistedMatchRun {
  matchRunId: string;
  candidateId: string;
  roleId: string;
  candidateSnapshotId: string;
  policyVersion: string;
  modelVersion: string | null;
  status: string;
  createdAt?: number;
  rankedChallenges: PersistedRankedChallenge[];
}

export interface LabelEvaluationResult {
  labelId: string;
  candidateId: string;
  roleId: string;
  challengeId: string;
  expectedGrade: RelevanceGrade;
  actualRank: number | null;
  actualRecallRank: number | null;
  actualScore: number | null;
  guardrailViolations: GuardrailViolation[];
  stretchPathsUsed: StretchPath[];
  provenanceComplete: boolean;
  passed: boolean;
  failureReason?: string;
}

export interface DeterminismComparison {
  candidateId: string;
  roleId: string;
  matchRunId: string;
  comparisonMatchRunId: string | null;
  identical: boolean;
  fingerprint: string;
  comparisonFingerprint: string | null;
  drift?: DeterminismDriftSummary;
}

export interface DeterminismChallengeSnapshot {
  challengeId: string;
  repoId: string;
  prNumber: number;
  rank: number | null;
  recallRank: number;
  score: number;
  candidateEvidenceAlignment: number;
  roleRelevance: number;
  contextualSpecificity: number;
  challengeQuality: number;
  validationDeepeningValue: number;
  alignedDemandCount: number;
  stretchCount: number;
  stretchDemandWeightRatio: number;
  provenanceComplete: boolean;
  eligible: boolean;
  sharedConcepts: string[];
}

export interface DeterminismDriftSummary {
  reason:
    | 'missing_comparison'
    | 'top_challenge_changed'
    | 'ranked_result_changed'
    | 'source_payload_changed';
  primaryTopChallenge: DeterminismChallengeSnapshot | null;
  comparisonTopChallenge: DeterminismChallengeSnapshot | null;
  firstDifference: string;
}

export interface PacketIdentityMismatch {
  challengeId: string;
  field: 'repoId' | 'prNumber' | 'sourceVersion' | 'packetContentHash';
  expected: string;
  actual: string;
  matchRunId: string;
}

export interface EvaluationMetrics {
  corpusVersion: string;
  corpusId: string;
  matchRunIds: string[];
  comparisonMatchRunIds: string[];
  evaluatedAt: string;
  recallAt50: number;
  precisionAt3: number;
  ndcgAt5: number;
  guardrailViolationCount: number;
  multiStretchViolationCount: number;
  missingProvenanceCount: number;
  missingMatchRunCount: number;
  byteIdenticalRerun: boolean;
  rerunFingerprints: Record<string, string>;
  determinismComparisons: DeterminismComparison[];
  totalEvaluations: number;
  evaluatedPairCount: number;
  highlyRelevantInTop3: number;
  relevantInTop3: number;
  irrelevantInTop3: number;
  forbiddenInResults: number;
  syntheticFixtureCount: number;
  expertLabelCount: number;
  labelResults: LabelEvaluationResult[];
  /**
   * Coverage metrics for the staged rollout gate.
   */
  expectedPacketCount: number;
  packetCoverage: number;
  pairCoverage: number;
  comparisonCoverage: number;
  missingPacketIds: string[];
  packetIdentityMismatches: PacketIdentityMismatch[];
}

export interface AcceptanceThresholds {
  minRecallAt50: number;
  minPrecisionAt3: number;
  minNdcgAt5: number;
  maxGuardrailViolations: number;
  maxMultiStretchViolations: number;
  maxMissingProvenance: number;
  maxMissingMatchRuns: number;
  requireByteIdenticalRerun: boolean;
  requireExpertLabels: boolean;
}

export const DEFAULT_ACCEPTANCE_THRESHOLDS: AcceptanceThresholds = {
  minRecallAt50: 0.95,
  minPrecisionAt3: 0.80,
  minNdcgAt5: 0.80,
  maxGuardrailViolations: 0,
  maxMultiStretchViolations: 0,
  maxMissingProvenance: 0,
  maxMissingMatchRuns: 0,
  requireByteIdenticalRerun: true,
  requireExpertLabels: true,
};

/**
 * Staged rollout gate thresholds.
 *
 * The matcher is rolled out in three stages, each strictly stronger than the
 * last. A stage fails if any of its coverage requirements are missing.
 */
export type RolloutStage = 'shadow' | 'canary' | 'production';

export interface RolloutGateThresholds extends AcceptanceThresholds {
  stage: RolloutStage;
  /** Minimum fraction of labelled candidate-role pairs with a persisted run. */
  minPairCoverage: number;
  /** Minimum fraction of pairs with an independent comparison rerun. */
  minComparisonCoverage: number;
  /** Minimum fraction of expected packets surfaced with matching identity. */
  minPacketCoverage: number;
  /** When true, the corpus must declare expected packets (canary/production). */
  requireExpectedPackets: boolean;
  /** Maximum allowed packet identity mismatches (0 for production). */
  maxPacketIdentityMismatches: number;
}

export const STAGED_ROLLOUT_THRESHOLDS: Record<RolloutStage, RolloutGateThresholds> = {
  shadow: {
    ...DEFAULT_ACCEPTANCE_THRESHOLDS,
    stage: 'shadow',
    minRecallAt50: 0,
    minPrecisionAt3: 0,
    minNdcgAt5: 0,
    maxGuardrailViolations: Number.POSITIVE_INFINITY,
    maxMultiStretchViolations: Number.POSITIVE_INFINITY,
    maxMissingProvenance: Number.POSITIVE_INFINITY,
    maxMissingMatchRuns: Number.POSITIVE_INFINITY,
    requireByteIdenticalRerun: false,
    requireExpertLabels: false,
    minPairCoverage: 0,
    minComparisonCoverage: 0,
    minPacketCoverage: 0,
    requireExpectedPackets: false,
    maxPacketIdentityMismatches: Number.POSITIVE_INFINITY,
  },
  canary: {
    ...DEFAULT_ACCEPTANCE_THRESHOLDS,
    stage: 'canary',
    minRecallAt50: 0.90,
    minPrecisionAt3: 0.70,
    minNdcgAt5: 0.70,
    minPairCoverage: 1,
    minComparisonCoverage: 1,
    minPacketCoverage: 1,
    requireExpectedPackets: true,
    maxPacketIdentityMismatches: 0,
  },
  production: {
    ...DEFAULT_ACCEPTANCE_THRESHOLDS,
    stage: 'production',
    minPairCoverage: 1,
    minComparisonCoverage: 1,
    minPacketCoverage: 1,
    requireExpectedPackets: true,
    maxPacketIdentityMismatches: 0,
  },
};

export interface RolloutGateResult {
  stage: RolloutStage;
  ready: boolean;
  failures: string[];
  warnings: string[];
  metrics: EvaluationMetrics;
  thresholds: RolloutGateThresholds;
}

export interface EvaluationResult {
  metrics: EvaluationMetrics;
  thresholds: AcceptanceThresholds;
  passed: boolean;
  failures: string[];
  warnings: string[];
}
