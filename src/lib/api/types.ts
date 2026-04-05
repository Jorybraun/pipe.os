/**
 * API response and request types for the Cloudflare Worker API.
 *
 * These types mirror the Worker's response shapes (camelCase) and must stay
 * in sync with workers/api/src/types.ts. The canonical source of truth for
 * valid field values is workers/api/src/validation/pipelines.ts.
 */

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
  | 'FOLLOW_UP';

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
}

export interface OverviewResponse {
  pipeline: PipelineListItem;
  stages: OverviewStage[];
  candidates: OverviewCandidate[];
  interviews: unknown[];
  roleContext: OverviewRoleContext | null;
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
  level?: string;
  stack?: string[];
  department?: string;
  workModel?: string;
  location?: string;
  teamSize?: string;
  reportsTo?: string;
}

export interface ParseJDResponse {
  parsed: {
    title?: string;
    level?: string;
    stack?: string[];
    department?: string;
    workModel?: string;
    location?: string;
    teamSize?: string;
    reportsTo?: string;
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
  status: 'BASELINE';
  baseline: RoleContextBaseline;
  questionBudget: number;
  questionsAsked: number;
}

export interface StartRoleContextResponse {
  acknowledgment: string;
  question: RoleContextQuestion;
  progress: RoleContextProgress;
  status: 'INTERVIEWING';
}

export interface RespondRoleContextRequest {
  answer: string;
  questionId: string;
}

export interface RespondQuestionResponse {
  acknowledgment: string;
  question: RoleContextQuestion;
  progress: RoleContextProgress;
  status: 'INTERVIEWING';
}

export interface RespondSynthesisResponse {
  synthesis: string;
  knowledgeState: Record<string, Record<string, unknown>>;
  progress: RoleContextProgress;
  status: 'COMPLETE';
}

export type RespondRoleContextResponse = RespondQuestionResponse | RespondSynthesisResponse;

export interface RoleContextFullState {
  id: string;
  pipelineId: string | null;
  status: 'BASELINE' | 'INTERVIEWING' | 'COMPLETE' | 'ABANDONED';
  baseline: RoleContextBaseline;
  knowledgeState: Record<string, Record<string, unknown>>;
  exchanges: Array<{
    questionId: string;
    acknowledgment: string;
    question: string;
    input: RoleContextQuestionInput;
    answer?: string;
  }>;
  questionBudget: number;
  questionsAsked: number;
  createdAt: string;
  updatedAt: string;
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

export interface CandidateProfileResponse {
  candidate: CandidateProfileRecord;
  stages: ProfileStage[];
  phoneCalls: PhoneCallRecord[];
}
