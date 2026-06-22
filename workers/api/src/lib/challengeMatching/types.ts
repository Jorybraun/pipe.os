export type EvidenceLevel =
  | 'mentioned'
  | 'used'
  | 'explained'
  | 'selected'
  | 'implemented'
  | 'demonstrated'
  | 'validated';

export type QueryPurpose = 'validation' | 'deepening';

export interface SourceRef {
  artifactId: string;
  artifactVersion: string;
  contentHash: string;
  startOffset: number;
  endOffset: number;
  sourceRefType?: string;
  sourceRefId?: string;
  sourceSpanId?: string;
  locator?: string;
  exactText?: string;
}

export interface CandidateSignal {
  id: string;
  episodeId: string;
  narrative: string;
  purpose: QueryPurpose;
  evidenceLevel: EvidenceLevel | null;
  evidenceStrength: number | null;
  confidence: number | null;
  concepts: string[];
  problems?: string[];
  mechanisms?: string[];
  domains?: string[];
  businessObjects?: string[];
  ownershipActions?: string[];
  embedding?: number[];
  sourceRefs: SourceRef[];
  contradicted?: boolean;
}

export interface QueryAtom extends Omit<
  CandidateSignal,
  'evidenceLevel' | 'evidenceStrength' | 'confidence'
> {
  evidenceLevel: EvidenceLevel;
  evidenceStrength: number;
  confidence: number;
  episodeMultiplier: 0 | 0.35 | 1;
  recallOnly: boolean;
}

export type Seniority = 'junior' | 'mid' | 'senior' | 'staff' | 'principal';

export interface RoleSourceReference {
  entityId: string;
  locator: string;
  conceptKeys: string[];
  sourceRefType?: string;
  sourceRefId?: string;
  sourceSpanId?: string;
  exactText?: string;
  contentHash?: string;
}

export interface RoleGuardrailSnapshot {
  requiredLanguages: string[];
  forbiddenLanguages?: string[];
  relevantConcepts?: string[];
  genericConcepts?: string[];
  requiredConcepts?: string[];
  forbiddenConcepts?: string[];
  minimumSeniority?: Seniority;
  conceptResolverVersion?: string;
  sourceReferences?: RoleSourceReference[];
}

export interface CandidateMatchQuery {
  candidateSnapshotId: string;
  roleSnapshotId: string;
  policyVersion: 'candidate-pr-v1';
  validationAtoms: QueryAtom[];
  deepeningAtoms: QueryAtom[];
  recallOnlyAtoms: QueryAtom[];
  roleGuardrails: RoleGuardrailSnapshot;
  maxAdjacentStretches: 1;
}

export interface CompileCandidateMatchInput {
  candidateSnapshotId: string;
  roleSnapshotId: string;
  signals: CandidateSignal[];
  roleGuardrails: RoleGuardrailSnapshot;
  /** Data-owned concepts used only to choose the bounded scoring atom set. */
  selectionConcepts?: string[];
}

export type MatchStatus =
  | 'READY'
  | 'MATCHED'
  | 'NEEDS_MORE_EVIDENCE'
  | 'NO_ROLE_SAFE_CHALLENGE';

export interface CompileCandidateMatchResult {
  status: 'READY' | 'NEEDS_MORE_EVIDENCE';
  query: CandidateMatchQuery;
  excludedSignalIds: string[];
}

export interface ChallengeDemand {
  id: string;
  family: string;
  narrative: string;
  weight: number;
  concepts: string[];
  problems?: string[];
  mechanisms?: string[];
  domains?: string[];
  businessObjects?: string[];
  ownershipActions?: string[];
  embedding?: number[];
  sourceRefs: SourceRef[];
  roleRequirement?: boolean;
  highWeightRoleRequirement?: boolean;
}

export interface ChallengeQuality {
  deterministic: number;
  contextualSpecificity: number;
}

export interface ChallengePacket {
  id: string;
  repoId: string;
  prNumber: number;
  sourceVersion: string;
  packetContentHash?: string | null;
  contextRecordId?: string | null;
  repoSourceRefCount?: number | null;
  conceptLinkCount?: number | null;
  challengeReady: boolean;
  languages: string[];
  seniority?: Seniority;
  concepts: string[];
  demands: ChallengeDemand[];
  quality: ChallengeQuality;
}

export interface ConceptAdjacency {
  from: string;
  to: string;
  dimension: 'technology' | 'mechanism' | 'domain' | 'scale' | 'review_practice';
  stretchAllowed?: boolean;
}

export interface RecallReviewChallengesInput {
  query: CandidateMatchQuery;
  challenges: ChallengePacket[];
  adjacency?: ConceptAdjacency[];
  limit?: number;
}

export interface RecalledChallenge {
  challenge: ChallengePacket;
  recallScore: number;
  matchedAtomIds: string[];
}

export interface RecallReviewChallengesResult {
  status: 'READY' | 'NEEDS_MORE_EVIDENCE' | 'NO_ROLE_SAFE_CHALLENGE';
  challenges: RecalledChallenge[];
  excludedChallengeIds: string[];
}

export interface PairScore {
  semanticNarrative: number;
  conceptCorrespondence: number;
  problemMechanismCorrespondence: number;
  domainBusinessContext: number;
  ownershipActionCorrespondence: number;
  total: number;
}

export interface StretchMatch {
  atomConcept: string;
  demandConcept: string;
  dimension: ConceptAdjacency['dimension'];
}

export interface DemandAlignment {
  atom: QueryAtom;
  demand: ChallengeDemand;
  pairScore: PairScore;
  weightedScore: number;
  stretch?: StretchMatch;
}

export interface ChallengeAlignment {
  challenge: ChallengePacket;
  alignments: DemandAlignment[];
  unmatchedDemandIds: string[];
  candidateEvidenceAlignment: number;
  roleRelevance: number;
  contextualSpecificity: number;
  challengeQuality: number;
  validationDeepeningValue: number;
  finalScore: number;
  stretchCount: number;
  stretchDemandWeightRatio: number;
  hasNonGenericAlignment: boolean;
  hasHighWeightRoleRequirement: boolean;
  provenanceComplete: boolean;
  eligible: boolean;
  rejectionReasons: string[];
}

export interface AlignCandidateToChallengeInput {
  query: CandidateMatchQuery;
  challenge: ChallengePacket;
  adjacency?: ConceptAdjacency[];
}

export interface RankedChallenge {
  rank: number;
  alignment: ChallengeAlignment;
}

export interface RankReviewChallengesResult {
  status: 'MATCHED' | 'NEEDS_MORE_EVIDENCE' | 'NO_ROLE_SAFE_CHALLENGE';
  matches: RankedChallenge[];
}

export interface MatchExplanation {
  status: 'MATCHED' | 'NEEDS_MORE_EVIDENCE' | 'NO_ROLE_SAFE_CHALLENGE';
  challengeId?: string;
  repoId?: string;
  prNumber?: number;
  selectedPr?: {
    challengeId: string;
    repoId: string;
    prNumber: number;
    sourceVersion: string;
  };
  score: number;
  summary: string;
  evidence: Array<{
    atomId: string;
    demandId: string;
    purpose: QueryPurpose;
    pairScore: number;
    episodeMultiplier: number;
    stretch?: StretchMatch;
    candidateSourceRefs: SourceRef[];
    challengeSourceRefs: SourceRef[];
  }>;
  candidateSpans: Array<{
    atomId: string;
    demandId: string;
    purpose: QueryPurpose;
    sourceRefs: SourceRef[];
  }>;
  repoSpans: Array<{
    atomId: string;
    demandId: string;
    sourceRefs: SourceRef[];
  }>;
  roleSources: RoleSourceReference[];
  rejectedPackets: Array<{
    id: string;
    repoId?: string;
    prNumber?: number | null;
    reasons: string[];
    demandIds?: string[];
    missingSourceSpanIds?: string[];
    gateFailures?: string[];
    provenanceFailures?: string[];
    contextProjectionFailures?: string[];
    qualityScore?: number | null;
  }>;
  missingEvidence: Array<{
    scope: 'candidate' | 'repo' | 'role' | 'challenge';
    reason: string;
    challengeId?: string;
    demandId?: string;
    sourceRefs?: SourceRef[];
  }>;
  stretchAreas: Array<{
    atomId: string;
    demandId: string;
    atomConcept: string;
    demandConcept: string;
    dimension: StretchMatch['dimension'];
    candidateSourceRefs: SourceRef[];
    challengeSourceRefs: SourceRef[];
  }>;
  unmatchedDemandIds: string[];
  rejectionReasons: string[];
}
