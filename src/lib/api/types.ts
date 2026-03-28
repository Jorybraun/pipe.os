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
