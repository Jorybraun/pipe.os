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
  PairScore,
  QueryAtom,
  QueryPurpose,
  RankedChallenge,
  RankReviewChallengesResult,
  RecallReviewChallengesInput,
  RecallReviewChallengesResult,
  RecalledChallenge,
  RoleGuardrailSnapshot,
  Seniority,
  SourceRef,
  StretchArea,
  StretchMatch,
  UnmatchedDemand,
} from './types';
export * from './d1Matcher';
export * from './roleGuardrails';
export * from './evaluation';
export { formatMatchNarrative } from './matchNarrative';
export type { MatchNarrative, NarrativeSection } from './matchNarrative';
