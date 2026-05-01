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
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  creationMode: string | null;
  stageCount: number;
  candidateCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PipelinesResponse {
  pipelines: PipelineListItem[];
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
  level: PipelineLevel;
  stack?: string[];
  description?: string;
  /** Defaults to 'DRAFT' on the server when omitted. */
  status?: 'DRAFT' | 'ACTIVE';
  /** Defaults to 'BLANK' on the server when omitted. */
  creationMode?: 'BLANK' | 'PRESET';
  presetId?: string;
}

export interface CreatePipelineResponse {
  pipeline: {
    id: string;
    title: string;
    level: string;
    status: string;
    stageCount: number;
    createdAt: string;
  };
}

// ─── Stage ────────────────────────────────────────────────────────────────────

export type ChallengeType =
  | 'CODE_REVIEW'
  | 'CODE_IMPLEMENTATION'
  | 'QUIZ_MCQ'
  | 'QUIZ_SHORT_ANSWER'
  | 'FOLLOW_UP'
  | 'AGENT_INTERVIEW';

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
  name: string | null;
  email: string | null;
  phoneNumber: string | null;
  status: string;
  pipelineId: string;
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
}

export interface CandidateProfileResponse {
  candidate: CandidateProfileRecord;
  stages: ProfileStage[];
  phoneCalls: PhoneCallRecord[];
  reviewSessions?: ReviewSessionListItem[];
  ingestion: CandidateEnrichmentRecord | null;
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

export interface PostSynthesizeRequest {
  state: InterviewState;
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
