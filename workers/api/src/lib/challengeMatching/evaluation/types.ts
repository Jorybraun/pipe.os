import type {
  PairScore,
  SourceRef,
  StretchMatch,
} from '../types';

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
  sourceReferences: Array<{
    entityId: string;
    locator: string;
    conceptKeys: string[];
  }>;
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
}

export interface EvaluationCorpus {
  version: typeof EVALUATION_CORPUS_VERSION;
  corpusId: string;
  createdAt: string;
  description: string;
  candidateEvidence: CandidatePersonEvidence[];
  roleRequirements: RoleRequirements[];
  expertLabels: ExpertLabel[];
  metadata: {
    totalLabels: number;
    totalCandidates: number;
    totalRoles: number;
    totalChallenges: number;
    syntheticFixtureCount: number;
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
  totalEvaluations: number;
  evaluatedPairCount: number;
  highlyRelevantInTop3: number;
  relevantInTop3: number;
  irrelevantInTop3: number;
  forbiddenInResults: number;
  syntheticFixtureCount: number;
  expertLabelCount: number;
  labelResults: LabelEvaluationResult[];
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

export interface EvaluationResult {
  metrics: EvaluationMetrics;
  thresholds: AcceptanceThresholds;
  passed: boolean;
  failures: string[];
  warnings: string[];
}
