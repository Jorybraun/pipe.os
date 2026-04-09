/**
 * Environment bindings injected by the Cloudflare Workers runtime.
 * Add new bindings here as they are declared in wrangler.jsonc.
 */
export interface Env {
  /** D1 database binding — all SQL queries go through this. */
  DB: D1Database;
  /** R2 bucket binding for candidate documents (CVs, resumes). */
  STORAGE: R2Bucket;
  /** Workers AI binding — Qwen, Nemotron, etc. No API key needed. */
  AI: Ai;
  /** Clerk secret key for JWT verification. Set via .dev.vars in dev. */
  CLERK_SECRET_KEY: string;
  /** Session token secret for candidate JWT signing/verification. */
  SESSION_TOKEN_SECRET: string;
  /**
   * GitHub personal access token for the PR fetch proxy.
   * Set via .dev.vars in dev, Worker secret in production.
   * Optional — unauthenticated requests are rate-limited at 60/hour.
   */
  GITHUB_TOKEN?: string;
  /**
   * Mistral API key for the implementer agent (Devstral model).
   * Set via .dev.vars in dev, Worker secret in production.
   * Optional — falls back to Workers AI when not set.
   */
  MISTRAL_API_KEY?: string;
  GOOGLE_AI_API_KEY?: string;
  /** 'mistral' | 'google-ai' — selects the role agent provider. Default: 'mistral'. */
  ROLE_AGENT_PROVIDER?: string;
  /**
   * Anthropic API key — alternative provider for the implementer agent.
   * Only used if MISTRAL_API_KEY and Workers AI are not available.
   */
  ANTHROPIC_API_KEY?: string;
  /**
   * When set to "true", AI agents return deterministic canned responses.
   * Used in E2E/integration tests to avoid real LLM calls.
   */
  MOCK_AI?: string;
  /** Durable Object binding for video call signaling rooms. */
  VIDEO_ROOM: DurableObjectNamespace;
  /** Metered.ca API key for TURN credential fetching. */
  METERED_API_KEY?: string;
  /** Calendly OAuth client ID. */
  CALENDLY_CLIENT_ID?: string;
  /** Calendly OAuth client secret. */
  CALENDLY_CLIENT_SECRET?: string;
  /** Cal.com OAuth client ID. */
  CALCOM_CLIENT_ID?: string;
  /** Cal.com OAuth client secret. */
  CALCOM_CLIENT_SECRET?: string;
  /** Google OAuth client ID for Gmail send-as integration. */
  GOOGLE_OAUTH_CLIENT_ID?: string;
  /** Google OAuth client secret for Gmail send-as integration. */
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  /** Microsoft OAuth client ID for Outlook send-as integration. */
  MICROSOFT_OAUTH_CLIENT_ID?: string;
  /** Microsoft OAuth client secret for Outlook send-as integration. */
  MICROSOFT_OAUTH_CLIENT_SECRET?: string;
  /**
   * Resend API key for transactional emails (invitations, notifications).
   * Set via .dev.vars in dev, Worker secret in production.
   * Optional — emails are silently skipped when not set.
   */
  RESEND_API_KEY?: string;
  /**
   * Base URL for candidate-facing assessment links.
   * Defaults to 'https://pipe.build' in production.
   */
  APP_BASE_URL?: string;
  /** Twilio Account SID for phone screening. */
  TWILIO_ACCOUNT_SID?: string;
  /** Twilio Auth Token for webhook signature validation. */
  TWILIO_AUTH_TOKEN?: string;
  /** Twilio phone number (E.164) for outbound calls. */
  TWILIO_PHONE_NUMBER?: string;
  /** Twilio TwiML App SID for browser-based calling. */
  TWILIO_TWIML_APP_SID?: string;
  /** Twilio API Key SID for Access Token (JWT) generation. */
  TWILIO_API_KEY_SID?: string;
  /** Twilio API Key Secret for Access Token (JWT) generation. */
  TWILIO_API_KEY_SECRET?: string;
  /** Deepgram API key for call transcription. */
  DEEPGRAM_API_KEY?: string;
  /** Libraries.io API key for dependency-based repo discovery. Free tier: 60 req/min. */
  LIBRARIES_IO_API_KEY?: string;
}

/**
 * Hono context variables set by middleware.
 * Available via `c.var.userId` in route handlers after auth middleware runs.
 */
export interface Variables {
  /** Clerk user ID extracted from the verified JWT. */
  userId: string;
}

// ─── DB Row shapes (snake_case) ───────────────────────────────────────────────

export interface PipelineRow {
  id: string;
  owner_id: string;
  title: string;
  level: string | null;
  stack: string | null;
  description: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  creation_mode: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineWithCountsRow extends PipelineRow {
  stage_count: number;
  candidate_count: number;
}

export interface StageRow {
  id: string;
  pipeline_id: string;
  title: string;
  description: string | null;
  sort_order: number;
  time_limit: number | null;
  mode: string | null;
  stage_type: string | null;
  is_scheduled: number;
  created_at: string;
  updated_at: string;
}

export interface ChallengeRow {
  id: string;
  stage_id: string;
  type: 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER' | 'FOLLOW_UP' | 'AGENT_INTERVIEW';
  sort_order: number;
  title: string;
  instructions: string | null;
  config: string | null;
  server_config: string | null;
  owner_id: string | null;
  github_repo_url: string | null;
  github_pr_number: number | null;
  github_pr_title: string | null;
  github_pr_description: string | null;
  cached_diff_json: string | null;
  cached_metadata: string | null;
  diff_cached_at: string | null;
  ground_truth_annotations: string | null;
  ground_truth: string | null;
  practice_repo: string | null;
  pr_number: number | null;
  feature_branch: string | null;
  base_branch: string | null;
  repo_s3_key: string | null;
  repo_version: number | null;
  repo_branch: string | null;
  repo_base_branch: string | null;
  repo_metadata_s3_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface StageWithOwnerRow extends StageRow {
  owner_id: string | null;
  notification_templates: string | null;
  scheduling_event_type_id: string | null;
  video_config: string | null;
}

export interface PhoneCallRow {
  id: string;
  candidate_id: string;
  pipeline_id: string;
  owner_id: string;
  direction: 'OUTBOUND' | 'INBOUND';
  status: string;
  from_number: string;
  to_number: string;
  twilio_call_sid: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  recording_s3_key: string | null;
  transcription: string | null;
  transcription_status: string | null;
  recruiter_notes: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Role Context ────────────────────────────────────────────────────────────

export type RoleContextStatus = 'BASELINE' | 'INTERVIEWING' | 'COMPLETE' | 'ABANDONED';

export interface RoleContextRow {
  id: string;
  pipeline_id: string | null;
  owner_id: string;
  baseline: string | null;
  knowledge_state: string | null;
  exchanges: string | null;
  question_budget: number;
  questions_asked: number;
  status: RoleContextStatus;
  /** Persisted CandidatePersona JSON (stringified). Null until synthesis runs. */
  persona_json: string | null;
  /** Generated job description in Markdown. Null until synthesis runs. */
  job_description_md: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Structured candidate persona — the internal hiring truth derived from the
 * Discovery interview. Shared across stakeholders (merged per ADR-028).
 * Drives downstream matching and scoring; also seeds the generated JD.
 */
export interface CandidatePersona {
  /** e.g. "Mid-to-senior, 5–8 years" */
  seniority: string;
  /** e.g. "Backend-leaning fullstack from Series A-C startup" */
  archetype: string;
  /** 70% of skills the candidate should have day one. */
  mustHaveSkills: string[];
  /** 30% of skills that can be grown into. */
  niceToHaveSkills: string[];
  /** Cultural / working-style traits. e.g. "Comfortable pushing back on PMs". */
  disposition: string[];
  /** One-line career arc signal. e.g. "Has shipped at least one greenfield system end-to-end". */
  careerSignal: string;
  /** Watchouts — not absolute NOs. */
  redFlags: string[];
  /** Hard NOs — reject on contact if any of these are true. */
  dealbreakers: string[];
}

/**
 * Generated job description — the public-facing artifact ready to post on
 * a job board or send directly to a candidate. Derived from the persona + the
 * interview's knowledge state. Rendered as Markdown in the UI.
 */
export interface GeneratedJobDescription {
  jobTitle: string;
  companySummary: string;
  roleOverview: string;
  responsibilities: string[];
  mustHaves: string[];
  niceToHaves: string[];
  compAndBenefits: string;
  callToAction: string;
}

/** A single exchange (turn) in the role discovery interview. */
export interface RoleExchange {
  questionId: string;
  acknowledgment: string;
  question: string;
  input: {
    type: 'text' | 'textarea' | 'tags' | 'select' | 'radio';
    options?: string[];
    placeholder?: string;
  };
  answer?: string;
  /** Recruiter feedback on this question — free text, stored for prompt tuning. */
  feedback?: string;
}

/** Six Domains coverage levels. */
export type DomainCoverage = 'none' | 'sparse' | 'partial' | 'covered' | 'deep';

/** Progress snapshot returned with each turn. */
export interface RoleAgentProgress {
  asked: number;
  budget: number;
  domains: Record<string, DomainCoverage>;
}

// ─── Role Context Participants (ADR-028) ───────────────────────────────────

export type ParticipantRole = 'HIRING_MANAGER' | 'INTERNAL_RECRUITER' | 'EXTERNAL_RECRUITER' | 'TEAM_MEMBER';

export type ParticipantStatus = 'PENDING' | 'INVITED' | 'CALIBRATING' | 'INTERVIEWING' | 'COMPLETE';

export interface RoleContextParticipantRow {
  id: string;
  role_context_id: string;
  name: string | null;
  email: string | null;
  participant_role: ParticipantRole | null;
  invite_token: string | null;
  is_creator: number; // SQLite boolean
  exchanges: string | null;
  questions_asked: number;
  question_budget: number;
  status: ParticipantStatus;
  created_at: string;
  updated_at: string;
}

// ─── API Response shapes (camelCase) ─────────────────────────────────────────

export interface PipelineResponse {
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

export interface PipelineCreatedResponse {
  id: string;
  title: string;
  level: string | null;
  status: string;
  stageCount: number;
  createdAt: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

// ─── Stage API response shapes ────────────────────────────────────────────────

export interface ChallengeResponse {
  id: string;
  stageId: string;
  type: 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER' | 'FOLLOW_UP' | 'AGENT_INTERVIEW';
  order: number;
  title: string;
  instructions: string | null;
  /** Parsed JSON object — never a raw string in API responses. */
  config: Record<string, unknown> | null;
  githubRepoUrl: string | null;
  githubPrNumber: number | null;
  githubPrTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StageDetailResponse {
  id: string;
  pipelineId: string;
  title: string;
  description: string | null;
  order: number;
  timeLimit: number | null;
  mode: string;
  notificationTemplates: Array<{
    trigger: 'INVITATION' | 'SUCCESS' | 'FAILURE';
    subject: string;
    body: string;
  }>;
  schedulingEventTypeId: string | null;
  createdAt: string;
  updatedAt: string;
  challenges: ChallengeResponse[];
}

// ─── Challenge Authoring (ADR-034) ──────────────────────────────────────────

export type ChallengeTemplateType = 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER';
export type TemplateDifficulty = 'JUNIOR' | 'MID' | 'SENIOR';
export type TemplateSource = 'SYSTEM' | 'AI_GENERATED' | 'USER_CREATED';
export type BloomLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
export type PackRoleType = 'FRONTEND' | 'BACKEND' | 'FULLSTACK' | 'DATA_ENGINEERING' | 'DEVOPS' | 'MOBILE' | 'CUSTOM';
export type PackSeniority = 'JUNIOR' | 'MID' | 'SENIOR' | 'ANY';
export type PackSource = 'SYSTEM' | 'USER_CREATED';

export interface ChallengeTemplateRow {
  id: string;
  type: ChallengeTemplateType;
  title: string;
  instructions: string;
  difficulty: TemplateDifficulty;
  primary_skill: string;
  secondary_skills: string | null;
  bloom_level: BloomLevel | null;
  estimated_minutes: number | null;
  config: string;
  server_config: string | null;
  source: TemplateSource;
  is_published: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChallengeLanguageVariantRow {
  id: string;
  challenge_template_id: string;
  language: string;
  starter_code: string;
  test_suite: string;
  test_framework: string;
  test_command: string;
  solution_code: string | null;
}

export interface TemplatePackRow {
  id: string;
  name: string;
  description: string | null;
  role_type: PackRoleType;
  seniority: PackSeniority;
  version: number;
  skills: string;
  supported_languages: string | null;
  source: PackSource;
  is_published: number;
  created_by: string | null;
  created_at: string;
}

export interface TemplatePackItemRow {
  template_pack_id: string;
  template_pack_version: number;
  challenge_template_id: string;
  sort_order: number;
  weight: number;
  is_required: number;
}

// ─── Challenge Authoring API responses ──────────────────────────────────────

export interface ChallengeTemplateResponse {
  id: string;
  type: ChallengeTemplateType;
  title: string;
  instructions: string;
  difficulty: TemplateDifficulty;
  primarySkill: string;
  secondarySkills: string[];
  bloomLevel: BloomLevel | null;
  estimatedMinutes: number | null;
  config: Record<string, unknown>;
  /** Only included for owner / admin requests. */
  serverConfig?: Record<string, unknown>;
  source: TemplateSource;
  isPublished: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Language variants — only included on single-template GET. */
  variants?: LanguageVariantResponse[];
}

export interface LanguageVariantResponse {
  id: string;
  language: string;
  starterCode: string;
  testSuite: string;
  testFramework: string;
  testCommand: string;
  /** Only included for owner / admin. */
  solutionCode?: string | null;
}

export interface TemplatePackResponse {
  id: string;
  name: string;
  description: string | null;
  roleType: PackRoleType;
  seniority: PackSeniority;
  version: number;
  skills: string[];
  supportedLanguages: string[];
  source: PackSource;
  isPublished: boolean;
  createdBy: string | null;
  createdAt: string;
  /** Included on single-pack GET. */
  items?: TemplatePackItemResponse[];
}

export interface TemplatePackItemResponse {
  challengeTemplateId: string;
  sortOrder: number;
  weight: number;
  isRequired: boolean;
  /** Included when pack is fetched with ?expand=challenges. */
  challenge?: ChallengeTemplateResponse;
}

// ─── Discovered Repos (CR-13, repo-discovery-pipeline.md) ─────────────────

export type DiscoverySource = 'LIBRARIES_IO' | 'GITHUB_TOPICS' | 'SOURCEGRAPH' | 'MANUAL';
export type RepoStatus =
  | 'DISCOVERING' | 'DISCOVERED' | 'ASSESSED'
  | 'ACCEPTED' | 'REJECTED'
  | 'CONVERTING' | 'CHALLENGE_READY' | 'FAILED';
export type SeniorityBand = 'JUNIOR' | 'MID' | 'SENIOR' | 'STAFF';

export interface DiscoveredRepoRow {
  id: string;
  pipeline_id: string;
  role_context_id: string | null;
  owner_id: string;
  github_owner: string;
  github_repo: string;
  github_url: string;
  default_branch: string | null;
  discovery_source: DiscoverySource;
  discovery_query: string | null;
  stars: number | null;
  last_pushed_at: string | null;
  license: string | null;
  is_archived: number;
  is_fork: number;
  has_ci: number | null;
  primary_language: string | null;
  topics: string | null;
  detected_stack: string | null;
  stack_match_score: number | null;
  sloc: number | null;
  mean_cyclomatic_complexity: number | null;
  source_file_count: number | null;
  seniority_band: SeniorityBand | null;
  quality_score: number | null;
  quality_details: string | null;
  status: RepoStatus;
  rejection_reason: string | null;
  error_message: string | null;
  challenge_template_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiscoveredRepoResponse {
  id: string;
  pipelineId: string;
  githubOwner: string;
  githubRepo: string;
  githubUrl: string;
  discoverySource: DiscoverySource;
  stars: number | null;
  lastPushedAt: string | null;
  license: string | null;
  primaryLanguage: string | null;
  topics: string[];
  stackMatchScore: number | null;
  sloc: number | null;
  meanCyclomaticComplexity: number | null;
  sourceFileCount: number | null;
  seniorityBand: SeniorityBand | null;
  qualityScore: number | null;
  status: RepoStatus;
  rejectionReason: string | null;
  challengeTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveryJobRow {
  id: string;
  pipeline_id: string;
  role_context_id: string | null;
  owner_id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  skills_queried: string | null;
  total_candidates: number;
  total_passed: number;
  total_rejected: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface DiscoveryJobResponse {
  id: string;
  pipelineId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  skillsQueried: string[];
  totalCandidates: number;
  totalPassed: number;
  totalRejected: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/** Maps a D1 row to the camelCase API response shape. */
export function toRepoResponse(row: DiscoveredRepoRow): DiscoveredRepoResponse {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    githubOwner: row.github_owner,
    githubRepo: row.github_repo,
    githubUrl: row.github_url,
    discoverySource: row.discovery_source,
    stars: row.stars,
    lastPushedAt: row.last_pushed_at,
    license: row.license,
    primaryLanguage: row.primary_language,
    topics: row.topics ? JSON.parse(row.topics) as string[] : [],
    stackMatchScore: row.stack_match_score,
    sloc: row.sloc,
    meanCyclomaticComplexity: row.mean_cyclomatic_complexity,
    sourceFileCount: row.source_file_count,
    seniorityBand: row.seniority_band,
    qualityScore: row.quality_score,
    status: row.status,
    rejectionReason: row.rejection_reason,
    challengeTemplateId: row.challenge_template_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Maps a D1 job row to the camelCase API response shape. */
export function toJobResponse(row: DiscoveryJobRow): DiscoveryJobResponse {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    status: row.status,
    skillsQueried: row.skills_queried ? JSON.parse(row.skills_queried) as string[] : [],
    totalCandidates: row.total_candidates,
    totalPassed: row.total_passed,
    totalRejected: row.total_rejected,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}
