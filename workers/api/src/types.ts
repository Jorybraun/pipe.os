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
