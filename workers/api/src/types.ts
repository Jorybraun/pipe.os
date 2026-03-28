/**
 * Environment bindings injected by the Cloudflare Workers runtime.
 * Add new bindings here as they are declared in wrangler.jsonc.
 */
export interface Env {
  /** D1 database binding — all SQL queries go through this. */
  DB: D1Database;
  /** Clerk secret key for JWT verification. Set via .dev.vars in dev. */
  CLERK_SECRET_KEY: string;
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
