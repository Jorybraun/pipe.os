export type NonEmptyArray<T> = readonly [T, ...T[]];

export type RepoTaskAssessmentMode =
  | 'DEV_CONTAINER_REPO_TASK'
  | 'OPEN_SOURCE_BUG_FIX';

export type AssessmentSurfaceMode =
  | 'STANDARD_VIDEO_INTERVIEW'
  | 'CODE_REVIEW'
  | RepoTaskAssessmentMode
  | 'CLIPPY_DEVIN_INTERACTION';

export type AssessmentMode =
  | AssessmentSurfaceMode
  | 'AUTO_MATCHED'
  | 'ROLE_BACKED_MATCHED'
  | 'RECRUITER_SELECTED_REVIEWABLE_PR'
  | 'NEEDS_MORE_EVIDENCE'
  | 'AI_DEVELOPER_UNAVAILABLE'
  | 'NO_ROLE_SAFE_CHALLENGE';

export type DiagnosticVerdict =
  | 'OK'
  | 'NEEDS_MORE_EVIDENCE'
  | 'AI_DEVELOPER_UNAVAILABLE'
  | 'NO_ROLE_SAFE_CHALLENGE'
  | 'PROVENANCE_INCOMPLETE'
  | 'NEEDS_REVIEW'
  | 'REJECTED';

export type AssessmentDiagnosticCode =
  | 'MISSING_CANDIDATE_SOURCE_EVIDENCE'
  | 'MISSING_ROLE_SOURCE_EVIDENCE'
  | 'MISSING_REPO_SOURCE_EVIDENCE'
  | 'MISSING_ISSUE_OR_PR_CONTEXT'
  | 'MISSING_REPO_TASK_PACKET'
  | 'MISSING_AI_USAGE_EVENT'
  | 'PROVENANCE_INCOMPLETE'
  | 'EMBEDDING_ONLY_MATCH_REJECTED'
  | 'FABRICATED_OR_SYNTHETIC_SOURCE_REJECTED'
  | 'SIMULATED_AGENT_REJECTED'
  | 'INSUFFICIENT_ALIGNMENT'
  | 'NO_ROLE_SAFE_CHALLENGE'
  | 'AI_DEVELOPER_UNAVAILABLE'
  | 'EVALUATION_NEEDS_HUMAN_REVIEW';

export type SourceRefType =
  | 'source_span'
  | 'repo_source_span'
  | 'review_challenge_packet'
  | 'repo_task_challenge_packet'
  | 'match_run'
  | 'ai_usage_event'
  | 'candidate_submission'
  | 'session_event'
  | 'test_run'
  | 'pull_request'
  | 'issue'
  | 'commit'
  | 'role_source';

export interface SourceSpan {
  sourceRefType: SourceRefType | string;
  sourceRefId: string;
  sourceSpanId?: string;
  locator?: string;
  exactText?: string;
  contentHash?: string;
}

export interface ExactSourceRef extends SourceSpan {
  exactText: string;
  contentHash: string;
}

export interface EvidenceHyperedgeNode {
  kind:
    | 'candidate'
    | 'role'
    | 'repo'
    | 'issue'
    | 'pull_request'
    | 'challenge'
    | 'assessment'
    | 'agent_run'
    | 'diagnostic'
    | 'ai_usage_event';
  id?: string;
  label?: string;
  sourceRefs?: NonEmptyArray<SourceSpan>;
}

export interface EvidenceHyperedge {
  id: string;
  relation: string;
  nodes: NonEmptyArray<EvidenceHyperedgeNode>;
  sourceRefs: NonEmptyArray<SourceSpan>;
}

export interface SourceBackedClaim {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  narrative: string;
  polarity: 1 | 0 | -1;
  confidence: number;
  sourceRefs: NonEmptyArray<ExactSourceRef>;
  hyperedgeIds: NonEmptyArray<string>;
}

export type EvidenceObservationLevel =
  | 'mentioned'
  | 'used'
  | 'explained'
  | 'selected'
  | 'implemented'
  | 'demonstrated'
  | 'validated';

export interface CandidateEvidenceAtom {
  id: string;
  contextRecordId: string;
  episodeId?: string;
  purpose: 'validation' | 'deepening' | 'recall_only';
  observationLevel: EvidenceObservationLevel;
  narrative: string;
  conceptKeys: readonly string[];
  problems?: readonly string[];
  mechanisms?: readonly string[];
  domains?: readonly string[];
  ownershipActions?: readonly string[];
  sourceRefs: NonEmptyArray<ExactSourceRef>;
  positiveClaims: readonly SourceBackedClaim[];
}

export interface CandidateEvidencePacket {
  schemaVersion: 'candidate-evidence-packet-v1';
  candidateId: string;
  personId?: string;
  workspacePersonId?: string;
  applicationId?: string;
  snapshotId: string;
  producedAt: string;
  sourceArtifactRefs: NonEmptyArray<SourceSpan>;
  atoms: NonEmptyArray<CandidateEvidenceAtom>;
  hyperedges: NonEmptyArray<EvidenceHyperedge>;
  diagnostics: readonly AssessmentDiagnostic[];
}

export interface RepoTaskDemand {
  id: string;
  family: string;
  narrative: string;
  weight: number;
  conceptKeys: readonly string[];
  problems?: readonly string[];
  mechanisms?: readonly string[];
  domains?: readonly string[];
  businessObjects?: readonly string[];
  ownershipActions?: readonly string[];
  sourceRefs: NonEmptyArray<ExactSourceRef>;
}

export type RepoTaskSourceKind =
  | 'github_issue'
  | 'github_pull_request'
  | 'maintainer_authored_task'
  | 'repo_source_span';

export interface RepoTaskChallengePacket {
  schemaVersion: 'repo-task-challenge-packet-v1';
  mode: RepoTaskAssessmentMode;
  id: string;
  repoSnapshotId: string;
  repository: {
    provider: 'github' | 'gitlab' | 'bitbucket' | 'other';
    owner: string;
    name: string;
    canonicalUrl: string;
    commitSha: string;
  };
  taskSource: {
    kind: RepoTaskSourceKind;
    externalUrl: string;
    title: string;
    sourceRefs: NonEmptyArray<ExactSourceRef>;
  };
  candidateVisible: {
    title: string;
    instructions: string;
    changedFilePaths: readonly string[];
    relevantSourceRefs: NonEmptyArray<ExactSourceRef>;
  };
  demands: NonEmptyArray<RepoTaskDemand>;
  quality: {
    productionReady: boolean;
    provenanceCoverage: number;
    deterministicQualityScore: number;
    gates: NonEmptyArray<{
      id: string;
      passed: boolean;
      reason: string;
    }>;
  };
  sourceBacked: {
    fixture: false;
    synthetic: false;
    provenanceComplete: true;
    resolverVersion: string;
    policyVersion: string;
  };
  serverOnlyEvaluationContext?: {
    hiddenGroundTruthRefs: NonEmptyArray<ExactSourceRef>;
    rubricRefs: NonEmptyArray<ExactSourceRef>;
  };
  hyperedges: NonEmptyArray<EvidenceHyperedge>;
}

export type MatchDecisionBasis =
  | 'candidate_source_claim'
  | 'repo_demand_source_claim'
  | 'role_source_claim'
  | 'concept_registry_source_relationship'
  | 'problem_mechanism_correspondence'
  | 'domain_business_context'
  | 'ownership_action_correspondence'
  | 'human_selected_source_backed_packet';

export interface EmbeddingSignalEvidence {
  allowedUse: 'recall_only' | 'tie_break_after_source_alignment';
  model: string;
  score: number;
  sourceRefs: NonEmptyArray<SourceSpan>;
}

export interface CandidateRepoTaskAlignment {
  id: string;
  candidateAtomId: string;
  demandId: string;
  pairScore: number;
  decisionBasis: NonEmptyArray<MatchDecisionBasis>;
  embeddingSignal?: EmbeddingSignalEvidence;
  sharedConceptKeys: readonly string[];
  candidateSourceRefs: NonEmptyArray<ExactSourceRef>;
  repoSourceRefs: NonEmptyArray<ExactSourceRef>;
  roleSourceRefs?: NonEmptyArray<ExactSourceRef>;
  positiveClaims: NonEmptyArray<SourceBackedClaim>;
}

export interface CandidateRepoTaskMatchScore {
  candidateEvidenceAlignment: number;
  roleRelevance: number;
  contextualSpecificity: number;
  deterministicChallengeQuality: number;
  validationDeepeningValue: number;
  finalScore: number;
}

export interface MatchedCandidateRepoTaskMatch {
  status: 'MATCHED';
  mode: RepoTaskAssessmentMode;
  matchRunId: string;
  candidatePacket: CandidateEvidencePacket;
  challengePacket: RepoTaskChallengePacket;
  alignments: NonEmptyArray<CandidateRepoTaskAlignment>;
  score: CandidateRepoTaskMatchScore;
  selectedBecause: NonEmptyArray<SourceBackedClaim>;
  diagnostics: readonly AssessmentDiagnostic[];
}

export interface DiagnosticCandidateRepoTaskMatch {
  status:
    | 'NEEDS_MORE_EVIDENCE'
    | 'NO_ROLE_SAFE_CHALLENGE'
    | 'PROVENANCE_INCOMPLETE'
    | 'AI_DEVELOPER_UNAVAILABLE'
    | 'NEEDS_REVIEW';
  mode: RepoTaskAssessmentMode;
  matchRunId: string;
  candidatePacket?: CandidateEvidencePacket;
  challengePacket?: RepoTaskChallengePacket;
  diagnostics: NonEmptyArray<AssessmentDiagnostic>;
}

export type CandidateRepoTaskMatch =
  | MatchedCandidateRepoTaskMatch
  | DiagnosticCandidateRepoTaskMatch;

export interface AiUsageEvidence {
  id: string;
  sourceRef: SourceSpan & {
    sourceRefType: 'ai_usage_event';
    sourceRefId: string;
  };
  feature:
    | 'repo_task_matching'
    | 'repo_task_ai_developer'
    | 'repo_task_scoring'
    | 'repo_task_evaluation'
    | string;
  refId: string;
  subRefId?: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  usdCost: number;
  success: boolean;
  errorMessage?: string;
  createdAt: string;
  simulated: false;
  outputClaimRefs?: NonEmptyArray<ExactSourceRef>;
}

export interface AssessmentDiagnostic {
  mode: AssessmentMode;
  verdict: DiagnosticVerdict;
  code?: AssessmentDiagnosticCode;
  reason: string;
  provider?: string;
  retryable: boolean;
  blocking?: boolean;
  sourceRefs?: NonEmptyArray<SourceSpan>;
  details?: Record<string, string | number | boolean | null>;
}

export type EvaluationDimensionId =
  | 'source_comprehension'
  | 'implementation_correctness'
  | 'debugging_reasoning'
  | 'test_strategy'
  | 'security_and_reliability'
  | 'ai_output_verification'
  | 'communication';

export interface RepoTaskEvaluationDimension {
  id: EvaluationDimensionId;
  score: number;
  maxScore: number;
  rationale: string;
  supportingClaims: NonEmptyArray<SourceBackedClaim>;
  gaps: readonly AssessmentDiagnostic[];
}

export interface RepoTaskEvaluationOverall {
  score: number | null;
  maxScore: number;
  recommendation:
    | 'strong_evidence_to_advance'
    | 'mixed_evidence_human_review'
    | 'insufficient_evidence'
    | 'not_demonstrated';
  narrative: string;
  supportingClaims: readonly SourceBackedClaim[];
}

export interface EvaluatedRepoTaskAssessmentOutput {
  schemaVersion: 'repo-task-assessment-output-v1';
  mode: RepoTaskAssessmentMode;
  status: 'EVALUATED';
  match: CandidateRepoTaskMatch;
  submissionSourceRefs: NonEmptyArray<ExactSourceRef>;
  aiUsage: readonly AiUsageEvidence[];
  dimensions: NonEmptyArray<RepoTaskEvaluationDimension>;
  overall: Omit<RepoTaskEvaluationOverall, 'supportingClaims'> & {
    supportingClaims: NonEmptyArray<SourceBackedClaim>;
  };
  diagnostics: readonly AssessmentDiagnostic[];
}

export interface DiagnosticRepoTaskAssessmentOutput {
  schemaVersion: 'repo-task-assessment-output-v1';
  mode: RepoTaskAssessmentMode;
  status:
    | 'NEEDS_MORE_EVIDENCE'
    | 'NO_ROLE_SAFE_CHALLENGE'
    | 'PROVENANCE_INCOMPLETE'
    | 'AI_DEVELOPER_UNAVAILABLE'
    | 'NEEDS_HUMAN_REVIEW';
  match: CandidateRepoTaskMatch;
  submissionSourceRefs: readonly ExactSourceRef[];
  aiUsage: readonly AiUsageEvidence[];
  dimensions: readonly RepoTaskEvaluationDimension[];
  overall: RepoTaskEvaluationOverall;
  diagnostics: NonEmptyArray<AssessmentDiagnostic>;
}

export type FinalRepoTaskAssessmentOutput =
  | EvaluatedRepoTaskAssessmentOutput
  | DiagnosticRepoTaskAssessmentOutput;

export interface AssessmentEvidencePacket {
  mode: AssessmentMode;
  verdict: DiagnosticVerdict;
  sourceRefs: NonEmptyArray<SourceSpan>;
  hyperedges: NonEmptyArray<EvidenceHyperedge>;
  diagnostics: readonly AssessmentDiagnostic[];
}

export function aiDeveloperUnavailableDiagnostic(input: {
  provider: string;
  reason: string;
  retryable?: boolean;
  details?: Record<string, string | number | boolean | null>;
}): AssessmentDiagnostic {
  return {
    mode: 'AI_DEVELOPER_UNAVAILABLE',
    verdict: 'AI_DEVELOPER_UNAVAILABLE',
    code: 'AI_DEVELOPER_UNAVAILABLE',
    provider: input.provider,
    reason: input.reason,
    retryable: input.retryable ?? true,
    blocking: true,
    ...(input.details ? { details: input.details } : {}),
  };
}
