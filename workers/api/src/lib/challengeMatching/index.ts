export {
  alignCandidateToChallenge,
  compileCandidateMatchQuery,
  explainChallengeMatch,
  rankReviewChallenges,
  recallReviewChallenges,
} from './engine';

export type {
  AlignCandidateToChallengeInput,
  CandidateMatchQuery,
  CandidateSignal,
  ChallengeAlignment,
  ChallengeDemand,
  ChallengePacket,
  ChallengeQuality,
  CompileCandidateMatchInput,
  CompileCandidateMatchResult,
  ConceptAdjacency,
  DemandAlignment,
  EvidenceLevel,
  MatchExplanation,
  MatchStatus,
  MatchValidatorCheck,
  MatchValidatorDecision,
  MatchValidatorSourceBridge,
  MatchValidatorVerdict,
  PairScore,
  QueryAtom,
  QueryPurpose,
  RankedChallenge,
  RankReviewChallengesResult,
  RecallReviewChallengesInput,
  RecallReviewChallengesResult,
  RecalledChallenge,
  RoleGuardrailSnapshot,
  RoleSourceReference,
  Seniority,
  SourceRef,
  StretchMatch,
} from './types';
export * from './d1Matcher';
export * from './roleGuardrails';
export * from './evaluation';
export {
  computeDecayMultiplier,
  applyTemporalDecay,
  parseObservedAtMs,
  evidenceAgeDays,
  DEFAULT_DECAY_CONFIG,
} from './temporalDecay';
export type { TemporalDecayConfig } from './temporalDecay';
