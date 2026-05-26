// ---------------------------------------------------------------------------
// Stage & Challenge config types — the single source of truth for what
// gets rendered. resolveStageConfig() produces these from raw DB data.
// StageRenderer reads them and builds the component tree.
// ---------------------------------------------------------------------------

/** A panel slot position in the layout grid */
export interface PanelSlots {
  left?: string[];
  center: string[];
  right?: string[];
  bottom?: string[];
}

/** A single challenge in the queue */
export interface ChallengeNode {
  id: string;
  type: string;
  title: string;
  instructions: string | null;
  /** Type-specific payload: starterCode, options, diffJson, prDescription, etc. */
  data: Record<string, unknown>;
  /** Challenge-level behavioral wrappers (shell type strings) */
  shells: string[];
  /** Layout component key from the component map */
  layout: string;
  /** Panel component keys mapped to layout slots */
  panels: PanelSlots;
  /** Per-challenge time limit in minutes (null = untimed) */
  timeLimit?: number | null;
  /** When true, submitting this challenge triggers follow-up generation */
  followUp?: { enabled: boolean };
  /** Initial submission shape — set by resolver, consumed by provider */
  initialSubmission: Record<string, unknown>;
  /** Returns true when submission is complete enough to advance. Set by resolver. */
  isComplete: (submission: Record<string, unknown>) => boolean;
}

/** Full stage configuration — describes the entire assessment experience */
export interface StageConfig {
  id: string;
  /** Human-readable stage title */
  title?: string;
  /** Stage-level behavioral wrappers: ['timer'], ['timer', 'video'], etc. */
  shells: string[];
  /** Ordered challenge queue (mutable — follow-ups get inserted at runtime) */
  challenges: ChallengeNode[];
}

/** Run state for CODE_IMPLEMENTATION console */
export interface RunState {
  status: 'idle' | 'running' | 'success' | 'error';
  logs: string[];
  error?: string;
  durationMs?: number;
}

// Re-export VirtualFS types for convenience
export type { VirtualFile, VirtualFS, TestCaseResult, EnhancedRunResult } from './virtualFS';
