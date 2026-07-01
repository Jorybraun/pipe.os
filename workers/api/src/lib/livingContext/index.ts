export * from './types';
export {
  LivingContextStore,
  deterministicEntityId,
  stableJson,
} from './persistence';
export * from './compatibility';
export * from './meetingTranscript';
export * from './cultureTurn';
export * from './cultureTranscriptBackfill';
export * from './phoneCall';
export * from './codeReview';
export * from './readModel';
export * from './projection';
export * from './openTerms';
export { ingestAssessmentToLivingContext, ingestAssessmentSessionRealTime, loadAssessmentSessionData } from './assessmentIngestion';
export type {
  AssessmentIngestionResult,
  AssessmentSessionRow,
  AssessmentSessionData,
  AssessmentEvidenceEventRow,
  AssessmentEventSourceRefRow,
  AssessmentEvaluationReportRow,
  AssessmentEvaluationClaimRow,
  AssessmentClaimSourceRefRow,
} from './assessmentIngestion';
export { loadContactLivingContext } from './readModel';
export {
  loadInteractionLivingContext,
  loadMeetingTranscriptContext,
  searchTranscriptSourceSpans,
  searchSourceContent,
  loadPersonEvidenceTimeline,
} from './readModel';
export type { TimelineEntry, PersonEvidenceTimeline } from './readModel';
export {
  ingestResumeToLivingContext,
  splitResumeIntoSections,
} from './resumeIngestion';
export type {
  ResumeIngestionInput,
  ResumeIngestionResult,
  ResumeSection,
  ResumeSectionType,
  ResumeAssertionInput,
  ResumeConceptInput,
} from './resumeIngestion';
export { ingestSessionEventsToLivingContext, loadSessionEventsForCandidate } from './sessionEventIngestion';
export type { SessionEventRow, SessionEventIngestionResult } from './sessionEventIngestion';
export {
  aggregateConceptEvidence,
  aggregateAllConceptEvidence,
  loadAggregatedCandidateEvidence,
  DEFAULT_AGGREGATION_CONFIG,
} from './evidenceAggregation';
export type {
  EvidenceObservation,
  AggregatedConceptEvidence,
  AggregationConfig,
  LoadAggregatedEvidenceConfig,
} from './evidenceAggregation';
export { BackfillOrchestrator } from './backfillOrchestrator';
export type { BackfillCheckpoint, BackfillTaskDefinition, BackfillOrchestratorStatus } from './backfillOrchestrator';
export { runScheduledBackfill, BACKFILL_TASKS } from './backfillScheduled';
export type { BackfillScheduledResult } from './backfillScheduled';
export {
  checkGate,
  requireGate,
  gatedField,
  updateGateStage,
  listGates,
  queryAuditLog,
  clearGateCache,
} from './rolloutEnforcement';
export type { GateStage, GateCheckResult } from './rolloutEnforcement';
export { traceEvidenceLineage } from './evidenceLineage';
export type {
  EvidenceLineage,
  LineageNode,
  LineageAssertion,
  LineageSourceSpan,
  LineageArtifact,
  LineageInteraction,
  LineageSignalEvidence,
} from './evidenceLineage';
export { loadTemporalAdjacencies, loadTemporalNeighborhood } from './conceptAdjacencyDecay';
export type { WeightedAdjacency } from './conceptAdjacencyDecay';
export {
  computeEvidenceFreshness,
  loadCandidateEvidenceFreshness,
} from './evidenceFreshness';
export type {
  EvidenceFreshnessSummary,
  EvidenceFreshnessEntry,
  FreshnessLevel,
  EvidenceRow as EvidenceFreshnessRow,
} from './evidenceFreshness';
export {
  analyzeEvidenceGaps,
  analyzeEvidenceGapsForChallenge,
  loadCandidateEvidenceForGapAnalysis,
} from './evidenceGapAnalysis';
export type {
  CoverageLevel,
  DemandCoverage,
  GapSummary,
  EvidenceGapReport,
  GapAnalysisOptions,
} from './evidenceGapAnalysis';
export { compareCandidateEvidence } from './candidateComparison';
export type {
  CandidateEvidenceProfile,
  ConceptEvidence,
  ConceptComparison,
  ComparisonSummary,
  CandidateComparisonReport,
} from './candidateComparison';
export { computeEvidenceReadiness } from './evidenceReadiness';
export type {
  ReadinessDimension,
  DimensionScore,
  EvidenceReadinessReport,
  EvidenceReadinessOptions,
} from './evidenceReadiness';
export { loadMatchProvenanceChain } from './matchProvenanceChain';
export type {
  ProvenanceMatchDecision,
  ProvenanceDemandLink,
  ProvenanceSignalNode,
  ProvenanceAssertionNode,
  ProvenanceArtifactNode,
  ProvenanceInteractionNode,
  ProvenanceChainEntry,
  MatchProvenanceChain,
  ProvenanceChainOptions,
} from './matchProvenanceChain';
export { detectEvidenceConflicts } from './evidenceConflicts';
export type {
  ConflictType,
  ConflictSeverity,
  ConflictAssertion,
  EvidenceConflict,
  EvidenceConflictReport,
  EvidenceConflictOptions,
} from './evidenceConflicts';
export { recordMatchDecision, loadMatchDecisionHistory } from './matchDecisionAudit';
export type {
  MatchDecisionVerdict,
  MatchDecisionInput,
  MatchDecisionResult,
  MatchDecisionHistoryEntry,
  MatchDecisionHistory,
} from './matchDecisionAudit';
export { loadPriorDecisionExclusions, buildDecisionExclusionDiagnostics } from './decisionWeightedRematch';
export type {
  DecisionExclusion,
  DecisionExclusionResult,
  DecisionExclusionDiagnostic,
} from './decisionWeightedRematch';
export { computeStalenessAlerts, loadCandidateStalenessAlerts } from './evidenceStalenessAlerts';
export type {
  AlertSeverity,
  AlertCategory,
  StalenessAlert,
  StalenessAlertSummary,
  StalenessAlertOptions,
} from './evidenceStalenessAlerts';
export { loadRepoDecompositionOverlay } from './repoDecompositionOverlay';
export type {
  RepoFileNode,
  RepoSymbolNode,
  RepoDemandNode,
  RepoStructuralFactNode,
  CandidateEvidenceOverlay,
  RepoDecompositionOverlay,
} from './repoDecompositionOverlay';
export { runBatchRematch } from './batchRematch';
export type {
  BatchRematchCandidate,
  BatchRematchResultEntry,
  BatchRematchResult,
} from './batchRematch';
export { scoreMatchConfidence, computeMatchConfidence } from './matchConfidenceScoring';
export type {
  ConfidenceLevel,
  DemandConfidence,
  ConfidenceDimension,
  MatchConfidenceReport,
  MatchConfidenceOptions,
} from './matchConfidenceScoring';
export { generateUnifiedMatchReport } from './matchReportPipeline';
export type {
  MatchVerdict,
  MatchReportSection,
  MatchReportConfidence,
  MatchReportGaps,
  MatchReportStaleness,
  MatchReportProvenance,
  MatchReportDecisionHistory,
  VerdictRationale,
  UnifiedMatchReport,
  MatchReportPipelineOptions,
} from './matchReportPipeline';
