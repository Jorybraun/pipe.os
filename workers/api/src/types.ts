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
  type: 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER' | 'FOLLOW_UP';
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
  created_at: string;
  updated_at: string;
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
  type: 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER' | 'FOLLOW_UP';
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
