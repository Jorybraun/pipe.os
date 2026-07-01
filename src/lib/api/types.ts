/**
 * API response and request types for the Cloudflare Worker API.
 *
 * These types mirror the Worker's response shapes (camelCase) and must stay
 * in sync with workers/api/src/types.ts. The canonical source of truth for
 * valid field values is workers/api/src/validation/pipelines.ts.
 */

import type { ScoringReport, StructuredTranscript } from '../../types/conversation';

// ─── Pipeline list ────────────────────────────────────────────────────────────

export interface PipelineListItem {
  id: string;
  title: string;
  level: string | null;
  stack?: string[] | null;
  description?: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  creationMode: string | null;
  stageCount: number;
  candidateCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PipelinesResponse {
  pipelines: PipelineListItem[];
  total: number;
  page: number;
  limit: number;
}

// ─── Pipeline create ──────────────────────────────────────────────────────────

export type PipelineLevel =
  | 'Junior'
  | 'Mid'
  | 'Senior'
  | 'Staff'
  | 'Principal'
  | 'Lead'
  | 'Manager';

export interface CreatePipelineRequest {
  title: string;
  level?: PipelineLevel | null;
  stack?: string[];
  description?: string;
  /** Defaults to 'DRAFT' on the server when omitted. */
  status?: 'DRAFT' | 'ACTIVE';
  /** Defaults to 'BLANK' on the server when omitted. */
  creationMode?: 'BLANK' | 'PRESET';
  presetId?: string;
  /** Defaults to true on the server. Set false for roleless interview plans. */
  createDefaultStages?: boolean;
}

export interface CreatePipelineResponse {
  pipeline: {
    id: string;
    title: string;
    level: string | null;
    status: string;
    stageCount: number;
    createdAt: string;
  };
}

export interface SimpleJobDescriptionRoleContextResponse {
  id: string;
  pipelineId: string | null;
  status: 'COMPLETE';
  baseline: {
    title: string;
    source: 'simple_job_description';
  };
  jobDescription: string;
  selectedTerms: string[];
  rejectedSelectedTerms: string[];
  roleSnapshotId: string;
}

// ─── Stage ────────────────────────────────────────────────────────────────────

export type ChallengeType =
  | 'CODE_REVIEW'
  | 'CODE_IMPLEMENTATION'
  | 'QUIZ_MCQ'
  | 'QUIZ_SHORT_ANSWER'
  | 'FOLLOW_UP'
  | 'AGENT_INTERVIEW'
  | 'INTAKE'
  | 'WAITING_FOR_MATCH';

export interface NotificationTemplate {
  trigger: 'INVITATION' | 'SUCCESS' | 'FAILURE';
  subject: string;
  body: string;
}

export interface ChallengeItem {
  id: string;
  stageId: string;
  type: ChallengeType;
  order: number;
  title: string;
  instructions: string | null;
  config: Record<string, unknown> | null;
  githubRepoUrl: string | null;
  githubPrNumber: number | null;
  githubPrTitle: string | null;
  devContainerRepoUrl: string | null;
  devContainerChallengeBranch: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ScreeningFormat = 'PHONE_CALL' | 'VIDEO_CALL' | 'ONLINE';

export interface StageDetail {
  id: string;
  pipelineId: string;
  title: string;
  description: string | null;
  order: number;
  timeLimit: number | null;
  mode: 'ASYNC' | 'LIVE_VIDEO';
  notificationTemplates: NotificationTemplate[];
  schedulingEventTypeId: string | null;
  stageType: string | null;
  isScheduled: boolean;
  screeningFormat: ScreeningFormat | null;
  screeningInputMode: 'text' | 'voice' | 'video' | null;
  createdAt: string;
  updatedAt: string;
  challenges: ChallengeItem[];
}

// ─── Challenge editor ─────────────────────────────────────────────────────────

export interface ChallengeDetail extends ChallengeItem {
  pipelineId: string;
  serverConfig: Record<string, unknown>;
  groundTruthAnnotations: Record<string, unknown>;
  cachedDiffJson: Record<string, unknown>;
  cachedMetadata: Record<string, unknown>;
  diffCachedAt: string | null;
}

export interface CreateChallengeRequest {
  type: ChallengeType;
  title: string;
  instructions?: string;
  config?: Record<string, unknown>;
  serverConfig?: Record<string, unknown>;
  order?: number;
  githubRepoUrl?: string;
  githubPrNumber?: number;
  githubPrTitle?: string;
  githubPrDescription?: string;
  devContainerRepoUrl?: string;
  devContainerChallengeBranch?: string;
}

export interface UpdateStageRequest {
  title?: string;
  timeLimit?: number | null;
  mode?: 'ASYNC' | 'LIVE_VIDEO';
  notificationTemplates?: NotificationTemplate[];
  schedulingEventTypeId?: string | null;
  stageType?: string | null;
  isScheduled?: boolean;
  screeningFormat?: ScreeningFormat | null;
  screeningInputMode?: 'text' | 'voice' | 'video' | null;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

/**
 * Typed error thrown by the API client when the Worker returns a non-2xx
 * response with a structured error body.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

// ─── Overview ──────────────────────────────────────────────────────────────────

export interface OverviewStage {
  id: string;
  title: string;
  pipelineId: string;
  sortOrder: number;
  challengeCount: number;
  mode: string | null;
  description: string | null;
  stageType: string | null;
  isScheduled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OverviewCandidate {
  id: string;
  name: string | null;
  email: string | null;
  inviteToken: string;
  status: 'INVITED' | 'IN_PROGRESS' | 'COMPLETED' | 'ARCHIVED';
  currentStageId: string | null;
  score: number | null;
  createdAt: string;
}

export interface OverviewRoleContext {
  id: string;
  baseline: RoleContextBaseline;
  knowledgeState: Record<string, Record<string, unknown>>;
  questionsAsked: number;
  questionBudget: number;
  createdAt: string;
  /** Structured candidate persona produced by the Role Discovery Agent on synthesis. */
  persona: CandidatePersona | null;
  /** Generated job description in Markdown produced by the Role Discovery Agent. */
  jobDescription: GeneratedJobDescription | null;
  /** Full Role Context Document — null until RCD synthesis runs. */
  rcd: RoleContextDocument | null;
}

/** Inherited match config (pipeline-level + role-level fallback) — ADR-039. */
export interface OverviewMatchConfig {
  matchPhilosophy: 'tailored' | 'hybrid' | 'validate' | null;
  tolerance: 'strict' | 'moderate' | 'lenient' | null;
  stageLinkage: 'shared-repo' | 'per-stage' | null;
  automationGranularity:
    | 'per-pipeline'
    | 'per-candidate'
    | 'per-stage'
    | 'recruiter-override'
    | null;
  hybridMixRatio: number | null;
}

export interface OverviewResponse {
  pipeline: PipelineListItem;
  stages: OverviewStage[];
  candidates: OverviewCandidate[];
  interviews: unknown[];
  roleContext: OverviewRoleContext | null;
  matchConfig: OverviewMatchConfig | null;
}

// ─── Candidates ────────────────────────────────────────────────────────────────

export interface CreateCandidateRequest {
  name: string;
  email: string;
}

export interface CreateCandidateResponse {
  candidate: {
    id: string;
    name: string;
    email: string;
    inviteToken: string;
    status: string;
    currentStageId: string | null;
    scheduledInterview?: {
      id: string;
      status: string;
      meetingUrl: string | null;
    } | null;
  };
}

export type OverviewPipeline = PipelineListItem;

// ─── Role Discovery ──────────────────────────────────────────────────────────

export type DomainCoverage = 'none' | 'sparse' | 'partial' | 'covered' | 'deep';

export interface RoleContextBaseline {
  title: string;
  department?: string;
  companyName?: string;
  companyUrl?: string;
  location?: string;
  /** Compensation range captured upfront — e.g. "$150K–$180K base + equity". */
  salaryRange?: string;
  /** Must-have technologies captured upfront — e.g. ["React", "TypeScript", "PostgreSQL"]. */
  techStack?: string[];
}

export type ParticipantRole = 'HIRING_MANAGER' | 'INTERNAL_RECRUITER' | 'EXTERNAL_RECRUITER' | 'TEAM_MEMBER';

export interface ParseJDResponse {
  parsed: {
    title?: string;
    department?: string;
    companyName?: string;
    companyUrl?: string;
    location?: string;
  };
}

export interface RoleContextQuestionInput {
  type: 'text' | 'textarea' | 'tags' | 'select' | 'radio';
  options?: string[];
  placeholder?: string;
}

export interface RoleContextQuestion {
  id: string;
  text: string;
  input: RoleContextQuestionInput;
  suggestedAnswers?: string[];
}

export interface RoleContextProgress {
  asked: number;
  budget: number;
  domains: Record<string, DomainCoverage>;
  /** Current domain being interviewed (column-by-column flow). */
  currentDomain?: string | null | undefined;
  /** Per-domain completion status for the new architecture. */
  domainCompletion?: Record<string, DomainCompletionStatus> | undefined;
  /** Active phase from the deterministic phase controller (Brief 6). */
  phase?: string | undefined;
  /** Human-readable explanation of why the current phase was selected. */
  phaseReasoning?: string | undefined;
  /** Internal ReAct reasoning for why this specific question was generated. */
  questionReasoning?: string | undefined;
}

export interface CreateRoleContextRequest {
  baseline: RoleContextBaseline;
  questionBudget?: number;
}

export interface CreateRoleContextResponse {
  id: string;
  participantId: string;
  status: 'BASELINE';
  baseline: RoleContextBaseline;
  questionBudget: number;
  questionsAsked: number;
}

export interface StartRoleContextResponse {
  participantId: string;
  acknowledgment: string;
  question: RoleContextQuestion;
  progress: RoleContextProgress;
  status: 'CALIBRATING';
  toolsUsed?: string[];
}

export interface RespondRoleContextRequest {
  answer: string;
  questionId: string;
  participantId: string;
}

export interface RespondQuestionResponse {
  participantId: string;
  participantRole?: ParticipantRole;
  acknowledgment: string;
  question: RoleContextQuestion;
  progress: RoleContextProgress;
  status: 'INTERVIEWING';
  toolsUsed?: string[];
}

/**
 * Structured candidate persona — the internal hiring truth produced by the
 * Discovery Agent on COMPLETE. Mirrors `CandidatePersona` in the Worker types.
 */
export interface CandidatePersona {
  seniority: string;
  archetype: string;
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  disposition: string[];
  careerSignal: string;
  redFlags: string[];
  dealbreakers: string[];
}

/**
 * Generated job description — public-facing Markdown artifact produced by the
 * Discovery Agent on COMPLETE. This is the raw markdown string (not parsed sections).
 */
export type GeneratedJobDescription = string;

export interface RespondSynthesisResponse {
  participantId: string;
  /** Legacy narrative string — now derived from `persona.archetype`. Kept for backwards compat. */
  synthesis: string;
  /** Structured candidate persona (Role Discovery v2). Null if the agent failed to produce one. */
  persona: CandidatePersona | null;
  /** Generated job description in Markdown (Role Discovery v2). */
  jobDescription: GeneratedJobDescription;
  knowledgeState: Record<string, Record<string, unknown>>;
  progress: RoleContextProgress;
  status: 'COMPLETE';
  /** Full Role Context Document — present when backend has cut over to RCD synthesis. */
  rcd?: RoleContextDocument | null;
}

export type RespondRoleContextResponse = RespondQuestionResponse | RespondSynthesisResponse;

export type RoleContextExchange = {
  questionId: string;
  acknowledgment: string;
  question: string;
  input: RoleContextQuestionInput;
  answer?: string;
};

export interface RoleContextParticipantSummary {
  id: string;
  participantRole: ParticipantRole | null;
  isCreator: boolean;
  questionsAsked: number;
  questionBudget: number;
  status: 'PENDING' | 'INVITED' | 'CALIBRATING' | 'INTERVIEWING' | 'COMPLETE';
  exchanges: RoleContextExchange[];
  phase: InterviewPhase;
}

export interface RoleContextFullState {
  id: string;
  pipelineId: string | null;
  status: 'BASELINE' | 'INTERVIEWING' | 'COMPLETE' | 'ABANDONED';
  baseline: RoleContextBaseline;
  knowledgeState: Record<string, Record<string, unknown>>;
  exchanges: RoleContextExchange[];
  /** Persisted persona from prior synthesis — null if not yet synthesized. */
  persona: CandidatePersona | null;
  /** Persisted JD markdown from prior synthesis — null if not yet synthesized. */
  jobDescription: GeneratedJobDescription | null;
  /** Full Role Context Document — null until RCD synthesis runs. */
  rcd: RoleContextDocument | null;
  questionBudget: number;
  questionsAsked: number;
  participants: RoleContextParticipantSummary[];
  createdAt: string;
  updatedAt: string;
}

// ─── Role Context Document (ADR-036) ─────────────────────────────────────────

export type EnergySignal = 'high' | 'medium' | 'low' | 'unknown';

export type DomainCoverageLevel = 'not_probed' | 'sparse' | 'partial' | 'covered' | 'deep';

export type AxialRelation = 'causes' | 'enables' | 'blocks' | 'contradicts' | 'instantiates';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface LadderingChain {
  attribute_quote: string;
  source_exchange_id: string;
  consequence: string;
  value: string;
  energy_signal: EnergySignal;
  confidence: ConfidenceLevel;
}

export interface StoryRecord {
  situation: string;
  action: string;
  outcome: string;
  moral: string;
  source_exchange_id: string;
}

export interface DomainCell {
  primary_authority: boolean;
  coverage: DomainCoverageLevel;
  laddering_chains: LadderingChain[];
  open_codes: string[];
  axial_links: Array<{
    from_code: string;
    to_code: string;
    relation: AxialRelation;
  }>;
  stories: StoryRecord[];
  summary: string;
}

export type StakeholderType = 'HIRING_MANAGER' | 'TEAM_MEMBER' | 'INTERNAL_RECRUITER' | 'EXTERNAL_RECRUITER';

export type Domain = 'why' | 'work' | 'team' | 'bar' | 'codebase' | 'process';

export type DomainMatrix = {
  [stakeholder in StakeholderType]?: {
    [domain in Domain]?: DomainCell;
  };
};

export type ConflictFlag = 'minor' | 'material' | 'blocking';

export type ConflictResolution = 'prefer_authoritative' | 'preserve_both' | 'escalate_to_recruiter';

export interface ConflictRecord {
  domain: Domain;
  field: string;
  stakeholder_a: StakeholderType;
  position_a: string;
  stakeholder_b: StakeholderType;
  position_b: string;
  conflict_flag: ConflictFlag;
  resolution_strategy: ConflictResolution;
}

export interface DealbreakerRecord {
  id: string;
  label: string;
  pattern: string;
  source_stakeholder: StakeholderType;
  source_chain_id: string;
  job_relatedness_note: string;
  job_relatedness_strength: 'strong' | 'moderate' | 'weak';
  evidence_quote: string;
}

export interface RedFlagRecord {
  id: string;
  label: string;
  source_stakeholder: StakeholderType;
  source_chain_id: string;
  evidence_quote: string;
}

export interface TeamCultureProfile {
  per_stakeholder: {
    [stakeholder in StakeholderType]?: {
      clan_affinity: number;
      adhocracy_affinity: number;
      market_affinity: number;
      hierarchy_affinity: number;
      psychological_safety: number;
    };
  };
  aggregated?: {
    formula: string;
    clan_affinity: number;
    adhocracy_affinity: number;
    market_affinity: number;
    hierarchy_affinity: number;
    psychological_safety: number;
  };
}

export interface BarsOverride {
  dimension: string;
  anchor_level: number;
  base_anchor_text: string;
  override_anchor_text: string;
  source_chain_id: string;
  approved_by: string;
  approved_at: string;
}

export interface ProbeEnrichment {
  static_base_version: string;
  enriched_probes: Array<{
    dimension: string;
    probe_text: string;
    source_chain_id: string;
    approved_by: string;
    approved_at: string;
  }>;
}

export interface TechnicalContext {
  stack: string[];
  constructs: string[];
  seniority_band: string;
  codebase_expectations: string[];
  dispositional_weights: Record<string, number>;
}

export interface ValidationMetadata {
  schema_version: string;
  synthesis_model: string;
  synthesis_prompt_version: string;
  verification_pass_model: string;
  face_validity_reviewed_at: string | null;
  face_validity_reviewer: string | null;
}

export interface RoleContextDocument {
  rcd_version: string;
  role_context_id: string;
  pipeline_id: string;
  created_at: string;
  domain_matrix: DomainMatrix;
  conflicts: ConflictRecord[];
  technical_context: TechnicalContext;
  team_culture_profile: TeamCultureProfile;
  bars_overrides: BarsOverride[];
  probe_bank_enrichment: ProbeEnrichment;
  dealbreakers: DealbreakerRecord[];
  red_flags: RedFlagRecord[];
  consumer_slice: CandidatePersona;
  validation_metadata: ValidationMetadata;
}

// ─── RCD Calibration ─────────────────────────────────────────────────────────

export interface FlagAttributeRequest {
  flagType: string;
  domain: string;
  attribute: string;
  note?: string;
}

export interface FlagAttributeResponse {
  question: string;
}

export interface SubmitGapAnswerRequest {
  answer: string;
}

export interface SubmitGapAnswerResponse {
  success: boolean;
  rcd?: RoleContextDocument;
}

// ─── Candidate Profile ────────────────────────────────────────────────────────

export interface ChallengeSubmissionDetail {
  id: string;
  score: number | null;
  feedback: string | null;
  response: Record<string, unknown> | null;
  submittedAt: string | null;
  scoredAt: string | null;
}

export interface ProfileChallenge {
  id: string;
  type: ChallengeType;
  title: string;
  instructions: string | null;
  config: Record<string, unknown> | null;
  order: number;
  submission: ChallengeSubmissionDetail | null;
  reviewSession?: ReviewSessionListItem | null;
}

export interface ScheduledInterviewInfo {
  id: string;
  status: string;
  scheduledAt: string | null;
  meetingUrl: string | null;
  provider: string | null;
}

export interface ProfileStage {
  id: string;
  title: string;
  order: number;
  mode: string | null;
  challenges: ProfileChallenge[];
  scheduledInterview?: ScheduledInterviewInfo;
}

export interface CandidateProfileRecord {
  id: string;
  personId?: string | null;
  workspacePersonId?: string | null;
  applicationId?: string | null;
  contactId?: string | null;
  name: string | null;
  email: string | null;
  phoneNumber: string | null;
  status: string;
  pipelineId: string | null;
  currentStageId: string | null;
  resumeS3Key: string | null;
  inviteToken: string;
  skills: string[] | null;
  yearsOfExperience: number | null;
  currentRole: string | null;
  education: string[] | null;
  score: number | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Phone Calls ─────────────────────────────────────────────────────────────

export interface PhoneCallRecord {
  id: string;
  candidateId: string;
  pipelineId: string;
  direction: 'OUTBOUND' | 'INBOUND';
  status: string;
  fromNumber: string;
  toNumber: string;
  twilioCallSid: string | null;
  durationSeconds: number | null;
  recordingS3Key: string | null;
  transcription: string | null;
  transcriptionStatus: string | null;
  recruiterNotes: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

// ─── Review Sessions ──────────────────────────────────────────────────────────

export type ReviewSessionStatus = 'pending' | 'in_progress' | 'scoring' | 'scored' | 'scoring_failed';

export interface ReviewSessionListItem {
  id: string;
  challengeId: string;
  status: ReviewSessionStatus;
  score: number | null;
  scoreReport: ScoringReport | null;
  transcript?: StructuredTranscript;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSessionReportResponse {
  id: string;
  challengeId: string;
  status: string;
  transcript: StructuredTranscript;
  scoreReport: ScoringReport | null;
  metrics: {
    bugsFound: number;
    bugsMissed: number;
    falsePositives: number;
  };
}

export interface CandidateMatchDimensions {
  skillCoverage: number;
  semanticSimilarity: number;
  situationFit: number;
  roleAlignment: number;
}

export interface CandidateMatchReasoning {
  matches: string[];
  mismatches: string[];
}

export interface ContributionCalendar {
  totalContributions: number;
  weeks: Array<{
    contributionDays: Array<{
      date: string;
      count: number;
    }>;
  }>;
}

export interface RepoMatchItem {
  rank: number;
  repoName: string;
  repoUrl: string;
  score: number;
  locationTag: string | null;
}

export type StandaloneReviewMatchStatus =
  | 'PENDING_INTAKE'
  | 'MATCHED'
  | 'NEEDS_MORE_EVIDENCE'
  | 'NO_ROLE_SAFE_CHALLENGE';

export interface StandaloneReviewSourceRef {
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

export interface StandaloneReviewRoleSource {
  entityId: string;
  locator: string;
  conceptKeys: string[];
  sourceRefType?: string;
  sourceRefId?: string;
  sourceSpanId?: string;
  exactText?: string;
  contentHash?: string;
}

export interface StandaloneReviewStretchArea {
  atomId: string;
  demandId: string;
  atomConcept: string;
  demandConcept: string;
  dimension: string;
  candidateSourceRefs: StandaloneReviewSourceRef[];
  challengeSourceRefs: StandaloneReviewSourceRef[];
}

export interface StandaloneReviewAlignment {
  atomId: string;
  demandId: string;
  purpose: string | null;
  pairScore: number;
  sharedConcepts: string[];
  stretch: { dimension: string; atomConcept: string; demandConcept: string } | null;
  roleSourceRefs: StandaloneReviewRoleSource[];
  candidateSourceRefs: StandaloneReviewSourceRef[];
  challengeSourceRefs: StandaloneReviewSourceRef[];
}

export type StandaloneReviewExclusionReason =
  | 'DEMAND_WITHOUT_SOURCE_SPANS'
  | 'MISSING_DEMAND_SOURCE_SPANS'
  | 'ROLE_GUARDRAIL_FAILED'
  | 'PACKET_NOT_PRODUCTION_READY'
  | 'PACKET_PROVENANCE_INVALID'
  | 'PACKET_CONTEXT_PROJECTION_INCOMPLETE';

export interface StandaloneReviewExcludedPacket {
  id: string;
  repoId: string | null;
  prNumber: number | null;
  reason: StandaloneReviewExclusionReason;
  demandIds: string[];
  missingSourceSpanIds: string[];
  gateFailures: string[];
  provenanceFailures: string[];
  contextProjectionFailures: string[];
  qualityScore: number | null;
}

export interface StandaloneReviewEvaluatedChallenge {
  challengeId: string;
  repoId: string;
  prNumber: number;
  recallRank: number | null;
  rank: number | null;
  eligible: boolean;
  rejectionReasons: string[];
  provenanceComplete: boolean;
  alignedDemandCount: number;
  stretchCount: number;
}

export interface StandaloneReviewDiagnostics {
  recalledPacketIds: string[];
  excludedPackets: StandaloneReviewExcludedPacket[];
  evaluatedChallenges: StandaloneReviewEvaluatedChallenge[];
}

export interface StandaloneReviewSubmissionSummary {
  verdict: string | null;
  summary: string | null;
  annotationCount: number;
  annotations: Array<{
    file: string | null;
    line: number | null;
    severity: string | null;
    comment: string;
  }>;
}

export interface StandaloneReviewPacketDemand {
  id: string;
  family: string;
  narrative: string;
  conceptKeys: string[];
  sourceSpanIds: string[];
  changedSymbolIds: string[];
  weight: number;
}

export interface StandaloneReviewPacketTestChange {
  path: string;
  framework: string | null;
  sourceSpanIds: string[];
  relatedSymbolIds: string[];
}

export interface StandaloneReviewPacketIssue {
  number: number;
  title: string;
  labels: string[];
  sourceSpanIds: string[];
}

export interface StandaloneReviewPacketQualityGate {
  gate: string;
  passed: boolean;
  reason: string;
}

export interface StandaloneReviewPacketQuality {
  score: number;
  eligible: boolean;
  metrics: {
    provenanceCoverage: number;
    reviewableSize: number;
    testCoverage: number;
    issueContext: number;
    demandDiversity: number;
  };
  gates: StandaloneReviewPacketQualityGate[];
}

export interface StandaloneReviewPacketDetail {
  packetId: string;
  changedFilePaths: string[];
  changedSymbolIds: string[];
  sourceSpanIds: string[];
  demandFamilies: string[];
  demands: StandaloneReviewPacketDemand[];
  testChanges: StandaloneReviewPacketTestChange[];
  issue: StandaloneReviewPacketIssue | null;
  quality: StandaloneReviewPacketQuality | null;
}

export interface MatchNarrativeSection {
  heading: string;
  items: string[];
}

export interface StandaloneReviewMatchNarrative {
  title: string;
  verdict: string;
  sections: MatchNarrativeSection[];
  plainText: string;
}

export interface StandaloneReviewMatchRecord {
  interviewId: string;
  interviewStatus: string;
  matchStatus: StandaloneReviewMatchStatus;
  matchRunId: string | null;
  packetId: string | null;
  repoId: number | null;
  repoName: string | null;
  repoUrl: string | null;
  prNumber: number | null;
  prUrl: string | null;
  prTitle: string | null;
  score: number | null;
  summary: string;
  evidence: StandaloneReviewAlignment[];
  roleSources: StandaloneReviewRoleSource[];
  stretchAreas: StandaloneReviewStretchArea[];
  unmatchedDemandIds: string[];
  gaps: string[];
  matchNarrative: StandaloneReviewMatchNarrative | null;
  diagnostics: StandaloneReviewDiagnostics;
  packet: StandaloneReviewPacketDetail | null;
  submitted: boolean;
  submission: StandaloneReviewSubmissionSummary | null;
  completedAt: string | null;
}

export interface CandidateEnrichmentRecord {
  status: 'pending' | 'profile_generated' | 'embedded' | 'matched' | 'failed';
  candidateSearchableProfile: string | null;
  keyConcepts: Record<string, unknown> | null;
  profileVersion: string | null;
  modelUsed: string | null;
  decompositionVersion: string | null;
  triangulatedScore: number | null;
  roleCandidateCosine: number | null;
  dimensions: CandidateMatchDimensions | null;
  reasoning: CandidateMatchReasoning | null;
  matchPhilosophy: string | null;
  careerContext: Record<string, unknown> | null;
  situationSignature: Record<string, unknown> | null;
  keySituations: unknown[] | null;
  matchedRepoName: string | null;
  matchedRepoUrl: string | null;
  githubUrl: string | null;
  lastEnrichedAt: string | null;
  profileGeneratedAt: string | null;
  profileEmbeddedAt: string | null;
  matchedAt: string | null;
  errorText: string | null;
  enrichmentJobStatus: string | null;
  topRepoMatches?: RepoMatchItem[];
  githubCalendar: ContributionCalendar | null;
}

// ─── Per-Requirement Matching (Neo4j) ───────────────────────────────────────

export interface EvidenceNode {
  nodeId: string;
  nodeType: string;
  narrative: string;
  similarity: number;
  barsScore?: number;
  sourceType: string;
  capturedAt: string;
}

export interface RequirementMatch {
  requirementId: string;
  requirementText: string;
  score: number;
  weight: number;
  matchCount: number;
  evidence: EvidenceNode[];
}

export interface DealbreakerFailure {
  dealbreakerId: string;
  narrative: string;
  matchedSimilarity: number;
}

export interface UnifiedMatchResult {
  candidateId: string;
  score: number;
  name?: string;
  email?: string;
  requirementMatches: RequirementMatch[];
  dealbreakerFailures: DealbreakerFailure[];
}

export interface ProfileSection {
  type: string;
  props: Record<string, unknown>;
}

export interface CultureInterviewSession {
  id: string;
  challengeId: string;
  assessmentId: string;
  state: string;
  transcript: Record<string, unknown>;
  scoreReport: Record<string, unknown> | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ScheduledInterviewSummary {
  id: string;
  candidateId: string;
  pipelineId: string | null;
  stageId: string | null;
  interviewType: string;
  meetingType: string | null;
  status: string;
  scheduledAt: string | null;
  meetingUrl: string | null;
  schedulingProvider: string | null;
  schedulingUrl: string | null;
  matchedRepoId: number | null;
  githubRepoUrl: string | null;
  githubPrNumber: number | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateProfileResponse {
  candidate: CandidateProfileRecord;
  stages: ProfileStage[];
  phoneCalls: PhoneCallRecord[];
  scheduledInterviews: ScheduledInterviewSummary[];
  reviewSessions?: ReviewSessionListItem[];
  ingestion: CandidateEnrichmentRecord | null;
  standaloneReviewMatch: StandaloneReviewMatchRecord | null;
  profileSections: ProfileSection[];
  cultureInterviewSessions: CultureInterviewSession[];
}

// ─── Living Context Graph ───────────────────────────────────────────────────

export interface LivingContextSourceRef {
  sourceRefType?: 'source_span';
  sourceRefId?: string;
  sourceSpanId: string;
  evidenceRole: string | null;
  artifactId: string;
  artifactType: string;
  artifactLogicalKey: string | null;
  artifactVersionId: string;
  artifactVersionNumber: number;
  mediaType: string;
  storageKey: string | null;
  stableSegmentId: string | null;
  exactText: string;
  byteStart: number | null;
  byteEnd: number | null;
  charStart: number | null;
  charEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  timestampStartMs: number | null;
  timestampEndMs: number | null;
  metadata: Record<string, unknown>;
}

export interface LivingContextGenericSourceRef {
  sourceRefType: string;
  sourceRefId: string;
  sourceSpanId: null;
  evidenceRole: string | null;
  locator: Record<string, unknown>;
  exactText: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
}

export type LivingContextRecordSourceRef =
  | LivingContextSourceRef
  | LivingContextGenericSourceRef;

export interface LivingContextArtifact {
  id: string;
  interactionId: string | null;
  artifactType: string;
  logicalKey: string | null;
  metadata: Record<string, unknown>;
  latestVersionId: string | null;
  latestVersionNumber: number | null;
  versionCount: number;
  mediaType: string | null;
  storageKey: string | null;
  createdAt: string;
  updatedAt: string;
  sourceSpans: LivingContextSourceRef[];
}

export interface LivingContextAssertionConcept {
  id: string;
  canonicalKey: string;
  namespace: string;
  label: string;
  relationship: string;
  weight: number;
}

export interface LivingContextAssertion {
  id: string;
  interactionId: string | null;
  episodeId: string | null;
  subjectType: string;
  subjectId: string | null;
  predicate: string;
  narrative: string;
  confidence: number | null;
  polarity: number;
  extractionVersion: string | null;
  observedAt: string | null;
  qualifiers: Record<string, unknown>;
  concepts: LivingContextAssertionConcept[];
  sources: LivingContextSourceRef[];
}

export interface LivingContextRecordEntity {
  entityType: string;
  entityId: string | null;
  relationship: string;
  value: unknown;
  confidence: number | null;
  metadata: Record<string, unknown>;
}

export interface LivingContextRecordConcept {
  id: string;
  canonicalKey: string;
  namespace: string;
  label: string;
  relationship: string;
  weight: number;
}

export interface LivingContextRecord {
  id: string;
  scopeType: string;
  scopeId: string;
  interactionId: string | null;
  applicationId: string | null;
  episodeId: string | null;
  assertionId: string | null;
  recordType: string;
  predicate: string | null;
  narrative: string;
  qualifiers: Record<string, unknown>;
  confidence: number | null;
  polarity: number;
  extractionVersion: string | null;
  observedAt: string | null;
  entities: LivingContextRecordEntity[];
  concepts: LivingContextRecordConcept[];
  sources: LivingContextRecordSourceRef[];
}

export interface LivingContextSignalEvidence {
  id: string;
  interactionId: string | null;
  assertionId: string;
  conceptId: string | null;
  evidenceLevel: string;
  strength: number;
  polarity: number;
  observedAt: string | null;
  assertionNarrative: string;
  assertionPredicate: string;
  sources: LivingContextSourceRef[];
}

export interface LivingContextSignal {
  signalKey: string;
  label: string;
  namespace: string | null;
  interactionId: string | null;
  asOf: string;
  conversationScore: number | null;
  totalScore: number;
  confidence: number;
  evidenceCount: number;
  sourceDiversity: number;
  dimensions: Record<string, unknown>;
  policyVersion: string;
  evidence: LivingContextSignalEvidence[];
}

export interface LivingContextInteraction {
  id: string;
  interactionType: string;
  externalReference: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  artifactIds: string[];
  contextRecordIds: string[];
  assertionIds: string[];
  signalKeys: string[];
}

export interface LivingContextReadModel {
  person: {
    personId: string;
    workspacePersonId: string;
    applicationId: string | null;
    displayName: string | null;
    primaryEmail: string | null;
    primaryPhone: string | null;
    relationshipSummary: string | null;
    applicationStatus: string | null;
    pipelineId: string | null;
    roles: Array<{
      id: string;
      roleType: string;
      label: string | null;
      applicationId: string | null;
      attributes: Record<string, unknown>;
      activeFrom: string | null;
      activeTo: string | null;
    }>;
  } | null;
  summary: {
    interactionCount: number;
    artifactCount: number;
    contextRecordCount: number;
    assertionCount: number;
    signalCount: number;
    sourceSpanCount: number;
  };
  interactions: LivingContextInteraction[];
  artifacts: LivingContextArtifact[];
  contextRecords: LivingContextRecord[];
  assertions: LivingContextAssertion[];
  signals: LivingContextSignal[];
  relationships: Array<{
    id: string;
    fromEntityType: string;
    fromEntityId: string;
    predicate: string;
    toEntityType: string | null;
    toEntityId: string | null;
    toValue: unknown;
    qualifiers: Record<string, unknown>;
    confidence: number | null;
    sourceAssertionId: string | null;
  }>;
}

export interface LivingContextResponse {
  livingContext: LivingContextReadModel;
}

export interface ScopedLivingContextReadModel {
  scope: {
    scopeType: string;
    scopeId: string;
    label: string | null;
    status: string | null;
    ownerId: string | null;
    pipelineId: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    metadata: Record<string, unknown>;
  };
  summary: LivingContextReadModel['summary'];
  interactions: LivingContextInteraction[];
  artifacts: LivingContextArtifact[];
  contextRecords: LivingContextRecord[];
  assertions: LivingContextAssertion[];
  signals: LivingContextSignal[];
  relationships: LivingContextReadModel['relationships'];
}

export interface ScopedLivingContextResponse {
  livingContext: ScopedLivingContextReadModel;
}

// ─── Evidence Lineage ─────────────────────────────────────────────────────────

export interface EvidenceLineageSourceSpan {
  sourceSpanId: string;
  artifactVersionId: string;
  contentHash: string;
  exactText: string;
  byteStart: number | null;
  byteEnd: number | null;
  charStart: number | null;
  charEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  timestampStartMs: number | null;
  timestampEndMs: number | null;
  stableSegmentId: string | null;
}

export interface EvidenceLineageArtifact {
  artifactId: string;
  artifactType: string;
  logicalKey: string | null;
  mediaType: string | null;
  versionNumber: number;
}

export interface EvidenceLineageInteraction {
  interactionId: string;
  interactionType: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface EvidenceLineageNode {
  assertion: {
    assertionId: string;
    narrative: string;
    predicate: string;
    confidence: number | null;
    polarity: number;
    observedAt: string | null;
    concepts: Array<{ canonicalKey: string; namespace: string; weight: number }>;
    sources: EvidenceLineageSourceSpan[];
  };
  signalEvidence: {
    evidenceLevel: string;
    strength: number;
  } | null;
  artifact: EvidenceLineageArtifact;
  interaction: EvidenceLineageInteraction;
  decayMultiplier: number;
  effectiveStrength: number;
}

export interface EvidenceLineageResponse {
  candidateId: string;
  nodes: EvidenceLineageNode[];
  conceptSummary: Array<{
    canonicalKey: string;
    avgEffectiveStrength: number;
    nodeCount: number;
  }>;
}

// ─── Evidence Freshness ───────────────────────────────────────────────────────

export type FreshnessLevel = 'fresh' | 'recent' | 'aging' | 'stale';

export interface EvidenceFreshnessEntry {
  id: string;
  observedAt: string | null;
  ageDays: number;
  decayMultiplier: number;
  freshnessLevel: FreshnessLevel;
  effectiveWeight: number;
}

export interface EvidenceFreshnessResponse {
  candidateId: string;
  totalEntries: number;
  freshCount: number;
  recentCount: number;
  agingCount: number;
  staleCount: number;
  averageDecay: number;
  medianAgeDays: number;
  oldestObservedAt: string | null;
  newestObservedAt: string | null;
  entries: EvidenceFreshnessEntry[];
}

// ─── Evidence Gap Analysis ────────────────────────────────────────────────────

export type CoverageLevel = 'strong' | 'partial' | 'weak' | 'none';

export interface GapSupportingAssertion {
  assertionId: string;
  narrative: string;
  conceptKey: string;
  strength: number;
  decayMultiplier: number;
  effectiveStrength: number;
  observedAt: string | null;
  exactText: string | null;
}

export interface DemandCoverage {
  demandId: string;
  demandNarrative: string;
  demandWeight: number;
  demandConcepts: string[];
  coverageLevel: CoverageLevel;
  matchedConcepts: string[];
  missingConcepts: string[];
  evidenceCount: number;
  bestEvidenceLevel: string | null;
  bestStrength: number;
  effectiveStrength: number;
  supportingAssertions: GapSupportingAssertion[];
}

export interface GapSummary {
  strongCount: number;
  partialCount: number;
  weakCount: number;
  noneCount: number;
  totalDemands: number;
  coverageScore: number;
  weightedCoverageScore: number;
}

export interface EvidenceGapReport {
  candidateId: string;
  workspacePersonId: string | null;
  challengeId: string;
  demands: DemandCoverage[];
  summary: GapSummary;
  recommendations: string[];
}

// ─── Match Provenance Chain ───────────────────────────────────────────────────

export interface ProvenanceMatchDecision {
  matchRunId: string;
  candidateId: string;
  status: string;
  selectedPacketId: string | null;
  policyVersion: string;
  createdAt: number;
}

export interface ProvenanceDemandLink {
  demandId: string;
  demandNarrative: string;
  demandWeight: number;
  demandConcepts: string[];
  atomId: string;
  pairScore: number;
  stretch: {
    atomConcept: string;
    demandConcept: string;
    dimension: string;
  } | null;
}

export interface ProvenanceSignalNode {
  atomId: string;
  episodeId: string;
  narrative: string;
  purpose: string;
  evidenceLevel: string | null;
  evidenceStrength: number | null;
  concepts: string[];
  sourceRefs: Array<{
    artifactId: string;
    contentHash: string;
    exactText: string | null;
    startOffset: number;
    endOffset: number;
  }>;
}

export interface ProvenanceAssertionNode {
  assertionId: string;
  narrative: string;
  predicate: string;
  confidence: number | null;
  polarity: number;
  observedAt: string | null;
  decayMultiplier: number;
  concepts: string[];
  sourceSpans: Array<{
    sourceSpanId: string;
    exactText: string;
    lineStart: number | null;
    lineEnd: number | null;
    charStart: number | null;
    charEnd: number | null;
  }>;
}

export interface ProvenanceArtifactNode {
  artifactId: string;
  artifactType: string;
  logicalKey: string | null;
  mediaType: string | null;
  versionNumber: number;
  contentHash: string;
}

export interface ProvenanceInteractionNode {
  interactionId: string;
  interactionType: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ProvenanceChainEntry {
  demandLink: ProvenanceDemandLink;
  signals: ProvenanceSignalNode[];
  assertions: ProvenanceAssertionNode[];
  artifacts: ProvenanceArtifactNode[];
  interactions: ProvenanceInteractionNode[];
}

export interface MatchProvenanceChain {
  decision: ProvenanceMatchDecision;
  challengeId: string | null;
  repoId: string | null;
  prNumber: number | null;
  totalDemands: number;
  alignedDemands: number;
  unmatchedDemands: number;
  stretchCount: number;
  chain: ProvenanceChainEntry[];
}

// ─── Interview State Machine (mirrors workers/api/src/lib/agents/interview/types.ts)

export type InterviewPhase = 'CONTEXT' | 'DISCOVERY' | 'PRIORITIZE' | 'EVP_FRICTION' | 'WRAP_UP';

export interface InterviewStateExchange {
  questionId: string;
  question: string;
  acknowledgment: string;
  answer?: string;
  input?: RoleContextQuestionInput;
}

export interface InterviewQueuedQuestion {
  questionId: string;
  text: string;
  acknowledgment: string;
  goal?: string;
  expectedCoverage?: { domain: string; from: DomainCoverage; to: DomainCoverage };
  probeAlignment?: string;
  questionType?: string;
  input: RoleContextQuestionInput;
  suggestedAnswers?: string[];
  knowledgeStateUpdate: Record<string, Record<string, unknown>>;
  domainCoverage: Record<string, DomainCoverage>;
}

export type DomainCompletionStatus =
  | 'pending'
  | 'generating'
  | 'asking'
  | 'depth_check'
  | 'follow_up'
  | 'complete';

export interface InterviewState {
  baseline: Record<string, unknown>;
  participantRole: ParticipantRole | null;
  questionBudget: number;
  exchanges: InterviewStateExchange[];
  knowledgeState: Record<string, Record<string, unknown>>;
  coverage: Record<string, DomainCoverage>;
  phase: InterviewPhase;
  questionsAsked: number;
  synthesisReady: boolean;
  /** Why the current phase was selected (human-readable). */
  reasoning?: string;
  /** List of gaps that prevented synthesis (if any). */
  urgentGaps?: string[];
  /** Pre-generated questions served instantly without LLM latency. */
  questionStack: InterviewQueuedQuestion[];

  // ── Domain-driven column tracking ──
  /** Which domain we're currently interviewing. Null before DISCOVERY starts. */
  currentDomain?: Domain | null;
  /** Per-domain completion status. */
  domainCompletion?: Record<string, DomainCompletionStatus>;
  /** Cached generated questions per domain (populated when entering 'asking'). */
  domainQuestions?: Record<string, { id: string; text: string; intent: string; drillingHints?: string[]; ladderingTarget?: string }[]>;
  /** How many questions have been asked per domain so far. */
  domainQuestionsDelivered?: Record<string, number>;
  /** How many follow-up questions asked in the current domain (during follow_up phase). */
  domainFollowUpsDelivered?: number;
}

export interface PostStateRequest {
  state?: InterviewState;
  action:
    | { type: 'ANSWER'; answer: string; knowledgeStateUpdate?: Record<string, Record<string, unknown>>; domainCoverage?: Record<string, DomainCoverage> }
    | { type: 'SKIP' }
    | { type: 'FORCE_SYNTHESIZE' };
}

export interface PostStateResponse {
  state: InterviewState;
}

export interface PostQuestionRequest {
  state: InterviewState;
  enableEval?: boolean;
}

export interface PostQuestionResponse {
  reasoning: string;
  acknowledgment: string;
  question: RoleContextQuestion & {
    goal?: string;
    expectedCoverage?: { domain: string; from: DomainCoverage; to: DomainCoverage };
    probeAlignment?: string;
    questionType?: string;
  };
  knowledgeStateUpdate: Record<string, Record<string, unknown>>;
  domainCoverage: Record<string, DomainCoverage>;
  /** Remaining pre-generated questions to pop from the stack. */
  questionStack?: InterviewQueuedQuestion[];
  eval?: {
    approved: boolean;
    dimensions: Array<{ id: string; verdict: 'pass' | 'fail' | 'warn'; score: number; reason: string }>;
    rewrite?: string;
  };
}

export interface PostQuestionPrefetchResponse {
  questionStack: InterviewQueuedQuestion[];
  prefetched: boolean;
  reason?: string;
  added?: number;
  error?: string;
}

/** Response from POST /:id/respond — single-turn question or synthesis. */
export interface PostRespondResponse {
  participantId: string;
  type: 'question' | 'synthesis';
  acknowledgment: string;
  question?: RoleContextQuestion & {
    goal?: string;
    expectedCoverage?: { domain: string; from: DomainCoverage; to: DomainCoverage };
    probeAlignment?: string;
    questionType?: string;
  };
  state: InterviewState;
  progress: {
    asked: number;
    budget: number;
    domains: Record<string, DomainCoverage>;
  };
  status: 'INTERVIEWING' | 'COMPLETE';
  participantRole?: string;
  // Synthesis fields (when type === 'synthesis')
  synthesis?: string;
  persona?: CandidatePersona;
  jobDescription?: GeneratedJobDescription;
  rcd?: RoleContextDocument | null;
}

export interface RematchResult {
  candidateId: string;
  status: string;
  matchRunId: string | null;
  repoId: number | null;
  prNumber: number | null;
  evaluatedCount: number;
  topChallenge: {
    challengeId: string;
    repoId: number;
    prNumber: number;
    rank: number | null;
    alignedDemandCount: number;
    stretchCount: number;
    eligible: boolean;
  } | null;
  reason?: string;
}

export interface ConceptGraphConcept {
  id: string;
  canonicalKey: string;
  namespace: string;
  label: string;
  description: string | null;
  aliases: string[];
  metadata: Record<string, unknown>;
  observationCount: number;
  firstObservedAt: number | null;
  lastObservedAt: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConceptGraphAdjacency {
  fromConceptKey: string;
  toConceptKey: string;
  dimension: string;
  stretchAllowed: boolean;
  confidence: number | null;
}

export interface ConceptGraphResponse {
  totalConcepts: number;
  concepts: ConceptGraphConcept[];
  adjacencies?: ConceptGraphAdjacency[];
}

export interface MatchHistoryEntry {
  matchRunId: string;
  status: string;
  selectedPacketId: string | null;
  policyVersion: string | null;
  evaluatedCount: number;
  excludedCount: number;
  topChallenge: {
    challengeId: string;
    repoId: string;
    prNumber: number;
    rank: number | null;
    score: number;
    alignedDemandCount: number;
    stretchCount: number;
  } | null;
  createdAt: string;
}

export interface MatchHistoryDelta {
  fromRunId: string;
  toRunId: string;
  statusChanged: boolean;
  selectedPacketChanged: boolean;
  evaluatedCountDelta: number;
  topScoreDelta: number | null;
  newTopChallenge: boolean;
}

export interface MatchHistoryResponse {
  runs: MatchHistoryEntry[];
  deltas: MatchHistoryDelta[];
  totalRuns: number;
}

export interface PostSynthesizeRequest {
  state: InterviewState;
}

export type ReadinessDimension =
  | 'resume'
  | 'interview'
  | 'assessment'
  | 'code_review'
  | 'meeting'
  | 'phone_call'
  | 'culture'
  | 'concepts';

export interface DimensionScore {
  dimension: ReadinessDimension;
  label: string;
  score: number;
  maxScore: number;
  level: 'none' | 'minimal' | 'partial' | 'strong' | 'comprehensive';
  evidenceCount: number;
  sourceSpanCount: number;
  freshestAt: string | null;
  decayMultiplier: number;
  recommendation: string | null;
}

export interface EvidenceReadinessReport {
  candidateId: string;
  workspacePersonId: string | null;
  overallScore: number;
  overallLevel: 'not_ready' | 'minimal' | 'ready' | 'strong' | 'comprehensive';
  dimensions: DimensionScore[];
  weakest: ReadinessDimension[];
  strongest: ReadinessDimension[];
  recommendations: string[];
  computedAt: string;
}

// ─── Evidence Conflicts ────────────────────────────────────────────────────────

export type ConflictType = 'polarity' | 'strength_divergence';
export type ConflictSeverity = 'high' | 'medium' | 'low';

export interface ConflictAssertion {
  assertionId: string;
  narrative: string;
  conceptKey: string;
  strength: number;
  confidence: number;
  polarity: number;
  effectiveStrength: number;
  observedAt: string | null;
  interactionType: string;
  exactText: string | null;
  sourceSpanId: string | null;
}

export interface EvidenceConflict {
  conflictId: string;
  conceptKey: string;
  conflictType: ConflictType;
  severity: ConflictSeverity;
  description: string;
  positiveAssertions: ConflictAssertion[];
  negativeAssertions: ConflictAssertion[];
  strengthDivergence: number;
  impactOnMatch: string;
}

export interface EvidenceConflictReport {
  candidateId: string;
  workspacePersonId: string | null;
  totalConflicts: number;
  highSeverity: number;
  mediumSeverity: number;
  lowSeverity: number;
  conflicts: EvidenceConflict[];
  analyzedAt: string;
}

export interface PostSynthesizeResponse {
  reasoning: string;
  persona: CandidatePersona;
  jobDescription: GeneratedJobDescription;
  synthesis: string;
  knowledgeStateUpdate: Record<string, Record<string, unknown>>;
  domainCoverage: Record<string, DomainCoverage>;
  /** Full Role Context Document — present when backend has cut over to RCD synthesis. */
  rcd?: RoleContextDocument | null;
}

// ─── Match Decision Audit Trail ─────────────────────────────────────────────

export type MatchDecisionVerdict = 'accepted' | 'rejected' | 'deferred';

export interface MatchDecisionHistoryEntry {
  decisionId: string;
  matchRunId: string;
  challengeId: string;
  repoId: string;
  prNumber: number;
  verdict: MatchDecisionVerdict;
  reason: string | null;
  notes: string | null;
  recruiterId: string;
  recordedAt: string;
}

export interface MatchDecisionResult {
  success: boolean;
  decisionId: string;
  contextRecordId: string;
  candidateId: string;
}

export interface MatchDecisionHistory {
  candidateId: string;
  decisions: MatchDecisionHistoryEntry[];
  totalDecisions: number;
  acceptedCount: number;
  rejectedCount: number;
  deferredCount: number;
}

export type AlertSeverity = 'critical' | 'warning' | 'info';

export type AlertCategory =
  | 'stale_evidence'
  | 'aging_dimension'
  | 'missing_dimension'
  | 'low_coverage'
  | 'single_source';

export interface StalenessAlert {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  dimension: string | null;
  title: string;
  detail: string;
  ageDays: number | null;
  decayMultiplier: number | null;
  recommendation: string;
}

export type StalenessOverallHealth = 'healthy' | 'attention_needed' | 'at_risk' | 'critical';

export interface StalenessAlertSummary {
  candidateId: string;
  workspacePersonId: string | null;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  overallHealth: StalenessOverallHealth;
  alerts: StalenessAlert[];
  computedAt: string;
}

// ─── Repo decomposition overlay ───────────────────────────────────────────────

export interface RepoFileNode {
  path: string;
  language: string | null;
  artifactType: string;
  lineCount: number | null;
  symbolCount: number;
  demandCount: number;
  candidateAlignmentScore: number | null;
}

export interface RepoSymbolNode {
  id: string;
  qualifiedName: string;
  kind: string;
  language: string;
  signature: string | null;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  containingSymbolId: string | null;
  demandIds: string[];
  candidateAlignmentScore: number | null;
}

export interface RepoDemandNode {
  id: string;
  family: string;
  narrative: string;
  conceptKeys: string[];
  weight: number;
  sourceFilePaths: string[];
  symbolIds: string[];
  candidateAlignmentScore: number | null;
  candidateEvidenceCount: number;
}

export interface RepoStructuralFactNode {
  id: string;
  factType: string;
  subjectSymbolId: string | null;
  objectSymbolId: string | null;
  sourceFilePath: string | null;
}

export interface CandidateEvidenceOverlayEntry {
  conceptKey: string;
  evidenceCount: number;
  totalStrength: number;
  sourceTypes: string[];
}

export interface RepoDecompositionOverlay {
  packetId: string;
  repoSnapshotId: string;
  repoName: string;
  prNumber: number;
  prTitle: string;
  primaryLanguage: string;
  files: RepoFileNode[];
  symbols: RepoSymbolNode[];
  demands: RepoDemandNode[];
  structuralFacts: RepoStructuralFactNode[];
  candidateEvidenceOverlay: CandidateEvidenceOverlayEntry[];
  coverageSummary: {
    totalDemands: number;
    coveredDemands: number;
    partialDemands: number;
    uncoveredDemands: number;
    overallScore: number;
  };
}

// ─── Batch rematch ────────────────────────────────────────────────────────────

export interface BatchRematchResultEntry {
  candidateId: string;
  status: string;
  matchRunId: string | null;
  repoId: number | null;
  prNumber: number | null;
  evaluatedCount: number;
  topChallenge: {
    challengeId: string;
    repoId: string;
    prNumber: number;
    rank: number | null;
    alignedDemandCount: number;
    stretchCount: number;
    eligible: boolean;
  } | null;
  priorDecisions: {
    excludedCount: number;
    deferredCount: number;
    totalDecisions: number;
  } | null;
  error: string | null;
}

export interface BatchRematchResult {
  totalCandidates: number;
  processedCount: number;
  results: BatchRematchResultEntry[];
  skippedCandidateIds: string[];
}

// ─── Match confidence scoring ─────────────────────────────────────────────────

export type MatchConfidenceLevel = 'high' | 'moderate' | 'low' | 'insufficient';

export interface DemandConfidence {
  demandId: string;
  demandNarrative: string;
  demandWeight: number;
  demandConcepts: string[];
  matchedConcepts: string[];
  missingConcepts: string[];
  coverageRatio: number;
  averageRecency: number;
  corroboratingSourceCount: number;
  bestStrength: number;
  effectiveStrength: number;
  confidenceScore: number;
  confidenceLevel: MatchConfidenceLevel;
  isStretch: boolean;
  stretchReason: string | null;
}

export interface ConfidenceDimension {
  name: 'coverage' | 'recency' | 'depth' | 'consistency';
  label: string;
  score: number;
  weight: number;
  detail: string;
}

export interface MatchConfidenceReport {
  candidateId: string;
  workspacePersonId: string | null;
  challengeId: string;
  compositeScore: number;
  compositeLevel: MatchConfidenceLevel;
  dimensions: ConfidenceDimension[];
  demands: DemandConfidence[];
  stretchAreas: DemandConfidence[];
  strongMatches: DemandConfidence[];
  recommendations: string[];
  computedAt: string;
}

// ─── Unified Match Report ───────────────────────────────────────────────────

export type MatchVerdict = 'strong_match' | 'likely_match' | 'needs_review' | 'weak_match' | 'insufficient_evidence';

export interface VerdictRationale {
  verdict: MatchVerdict;
  score: number;
  label: string;
  primaryReasons: string[];
  riskFactors: string[];
}

export interface MatchReportSection {
  loaded: boolean;
  errorMessage: string | null;
}

export interface MatchReportConfidence extends MatchReportSection {
  report: MatchConfidenceReport | null;
}

export interface MatchReportGaps extends MatchReportSection {
  report: EvidenceGapReport | null;
}

export interface MatchReportStaleness extends MatchReportSection {
  summary: StalenessAlertSummary | null;
}

export interface MatchReportProvenance extends MatchReportSection {
  chain: unknown;
}

export interface MatchReportDecisionHistory extends MatchReportSection {
  exclusions: {
    excludedPacketIds: string[];
    exclusions: Array<{ packetId: string; verdict: string; decidedAt: string }>;
    deferredCount: number;
    totalDecisions: number;
  } | null;
}

export interface UnifiedMatchReport {
  candidateId: string;
  challengePacketId: string;
  matchRunId: string | null;
  verdict: VerdictRationale;
  confidence: MatchReportConfidence;
  gaps: MatchReportGaps;
  staleness: MatchReportStaleness;
  provenance: MatchReportProvenance;
  decisionHistory: MatchReportDecisionHistory;
  generatedAt: string;
  pipelineVersion: string;
}

// ── Graph Traversal ─────────────────────────────────────────────────────────

export type GraphEntityType =
  | 'person'
  | 'workspace_person'
  | 'interaction'
  | 'artifact'
  | 'assertion'
  | 'concept'
  | 'signal_evidence'
  | 'source_span'
  | 'match_run';

export interface GraphNode {
  id: string;
  entityType: GraphEntityType;
  label: string;
  metadata: Record<string, unknown>;
  depth: number;
}

export interface GraphEdge {
  fromId: string;
  fromType: GraphEntityType;
  toId: string;
  toType: GraphEntityType;
  relationship: string;
  sourceEvidence: EdgeSourceEvidence | null;
}

export interface EdgeSourceEvidence {
  sourceSpanId: string | null;
  exactText: string | null;
  confidence: number | null;
}

export interface GraphTraversalResult {
  root: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export interface GraphTraversalOptions {
  maxDepth?: number;
  maxNodes?: number;
  entityTypeFilter?: GraphEntityType[];
}

// ── Evidence timeline ────────────────────────────────────────────────────────

export interface TimelineEntry {
  id: string;
  timestamp: string;
  entryType: 'interaction' | 'assertion' | 'context_record' | 'artifact';
  interactionId: string | null;
  interactionType: string | null;
  narrative: string;
  concepts: string[];
  sourceCount: number;
  confidence: number | null;
}

export interface PersonEvidenceTimeline {
  workspacePersonId: string;
  totalEntries: number;
  entries: TimelineEntry[];
}

// ── Cross-candidate comparison ──────────────────────────────────────────────

export interface ComparisonConceptEvidence {
  conceptKey: string;
  label: string;
  evidenceCount: number;
  bestStrength: number;
  effectiveStrength: number;
  sources: string[];
}

export interface CandidateEvidenceProfile {
  candidateId: string;
  workspacePersonId: string | null;
  candidateName: string;
  totalInteractions: number;
  totalAssertions: number;
  totalSourceSpans: number;
  sourceDiversity: number;
  interactionBreakdown: Record<string, number>;
  topConcepts: ComparisonConceptEvidence[];
  latestInteractionAt: string | null;
  freshestEvidenceAt: string | null;
}

export interface ConceptComparison {
  conceptKey: string;
  label: string;
  candidates: Array<{
    candidateId: string;
    evidenceCount: number;
    bestStrength: number;
    effectiveStrength: number;
    coverageLevel: 'strong' | 'partial' | 'weak' | 'none';
  }>;
}

export interface ComparisonSummary {
  totalCandidates: number;
  comparedConceptCount: number;
  sharedConceptCount: number;
  uniqueConceptsPerCandidate: Record<string, number>;
  evidenceDiversityRanking: Array<{ candidateId: string; score: number }>;
  evidenceDepthRanking: Array<{ candidateId: string; totalAssertions: number }>;
  evidenceFreshnessRanking: Array<{ candidateId: string; freshestAt: string | null }>;
}

export interface CandidateComparisonReport {
  pipelineId: string | null;
  candidateProfiles: CandidateEvidenceProfile[];
  conceptComparisons: ConceptComparison[];
  summary: ComparisonSummary;
}

// ── Concept Evolution ─────────────────────────────────────────────────────────

export type EvolutionEventType = 'merge' | 'split' | 'alias_added' | 'superseded';

export interface ConceptEvolutionEvent {
  id: string;
  eventType: EvolutionEventType;
  conceptId: string;
  relatedConceptId: string | null;
  reason: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface ConceptEvolutionTimeline {
  conceptId: string;
  canonicalKey: string;
  label: string;
  events: ConceptEvolutionEvent[];
  supersessionChain: SupersessionLink[];
}

export interface SupersessionLink {
  fromConceptId: string;
  toConceptId: string;
  eventType: EvolutionEventType;
  occurredAt: string;
}

export interface MergeConceptsResult {
  survivorConceptId: string;
  survivorCanonicalKey: string;
  mergedCount: number;
  surfacesRepointed: number;
  adjacenciesRepointed: number;
  evolutionEventIds: string[];
}

export interface SplitConceptResult {
  newConceptId: string;
  newCanonicalKey: string;
  surfacesMoved: number;
  evolutionEventId: string;
}

// ── Evidence Semantic Search ──────────────────────────────────────────────────

export type SearchStrategy = 'text' | 'concept' | 'hybrid';
export type EvidenceHitType = 'source_span' | 'assertion' | 'signal_evidence';

export interface EvidenceHitProvenance {
  interactionId: string | null;
  interactionType: string | null;
  interactionOccurredAt: string | null;
}

export interface EvidenceSearchHit {
  id: string;
  hitType: EvidenceHitType;
  content: string;
  score: number;
  conceptKeys: string[];
  confidence: number | null;
  provenance: EvidenceHitProvenance;
  sourceSpanId: string | null;
  charStart: number | null;
  charEnd: number | null;
}

export interface EvidenceSearchResult {
  query: string;
  strategy: SearchStrategy;
  totalHits: number;
  hits: EvidenceSearchHit[];
}


