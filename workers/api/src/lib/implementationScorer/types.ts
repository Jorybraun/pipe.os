/**
 * Implementation Scorer Types — Sherlock-based CODE_IMPLEMENTATION assessment.
 *
 * Scores candidate code submissions across 4 BARS dimensions derived from
 * the Sherlock research rubric (Part 3 strategy).
 */

export type SherlockDimension =
  | 'reasoning_decomposition'
  | 'code_construction'
  | 'adaptability'
  | 'debugging_maintenance';

export const SHERLOCK_DIMENSIONS: SherlockDimension[] = [
  'reasoning_decomposition',
  'code_construction',
  'adaptability',
  'debugging_maintenance',
];

export interface ImplementationScoreDimension {
  dimension: SherlockDimension;
  bars_score: number; // 1–5
  evidence_quotes: string[];
  reasoning: string;
  confidence: number; // 0–1
}

export interface TelemetryFeatures {
  /** Ratio of test files to implementation files (0–1) */
  tdd_ratio: number | null;
  /** Pattern observed in debug approach (e.g. 'systematic', 'ad-hoc', 'tool-assisted') */
  debug_strategy_pattern: string | null;
  /** How the candidate used AI assistance (e.g. 'minimal', 'collaborative', 'heavy') */
  ai_collaboration_style: string | null;
  /** Commit frequency descriptor (requires git telemetry) */
  commit_frequency: string | null;
}

export interface ImplementationScoreReport {
  dimensions: ImplementationScoreDimension[];
  telemetry_features: TelemetryFeatures;
  synthesis: string;
  overall_confidence: number;
  scored_at: number; // unix epoch seconds
}

// ─── BARS Anchors ────────────────────────────────────────────────────────────

export const REASONING_DECOMPOSITION_ANCHORS = `
Level 1 (1): Jumps directly to coding without identifying sub-problems. No plan or structure visible.
Level 2 (2): Identifies at least one sub-problem but misses key dependencies. Plan is present but incomplete.
Level 3 (3): Breaks problem into coherent sub-problems with clear dependencies. Plan matches solution structure.
Level 4 (4): Decomposes elegantly with reusable abstractions. Anticipates edge cases in the decomposition.
Level 5 (5): Decomposition reveals deep domain insight. Architecture decisions are justified and extensible.
`;

export const CODE_CONSTRUCTION_ANCHORS = `
Level 1 (1): Syntax errors or uncompilable code. Naming is cryptic or misleading.
Level 2 (2): Compiles but violates conventions. Inconsistent style. Some dead code.
Level 3 (3): Clean, consistent code following language conventions. Proper error handling.
Level 4 (4): Idiomatic, well-documented code. Efficient use of language features. Defensive programming.
Level 5 (5): Exemplary craft. Self-documenting. Performance-conscious. Anticipates maintenance needs.
`;

export const ADAPTABILITY_ANCHORS = `
Level 1 (1): Rigid solution that breaks with any requirement change. Hard-coded assumptions throughout.
Level 2 (2): Some parameterization but core logic is fixed. Minimal use of configuration or generics.
Level 3 (3): Handles known variations gracefully. Uses patterns that allow extension.
Level 4 (4): Designs for change. Polymorphism, configuration, or strategy patterns used appropriately.
Level 5 (5): Architecture inherently adapts to unforeseen requirements. Minimal rework needed for new cases.
`;

export const DEBUGGING_MAINTENANCE_ANCHORS = `
Level 1 (1): No error handling. Silent failures or crashes. No logging or diagnostics.
Level 2 (2): Basic try/catch but poor error messages. Debugging would require significant effort.
Level 3 (3): Consistent error handling with meaningful messages. Logs key operations.
Level 4 (4): Observability built-in. Errors are actionable. Tests cover failure paths.
Level 5 (5): Defensive by design. Failures are contained and reported with full context. Self-healing where appropriate.
`;

export const ANCHOR_BY_DIMENSION: Record<SherlockDimension, string> = {
  reasoning_decomposition: REASONING_DECOMPOSITION_ANCHORS,
  code_construction: CODE_CONSTRUCTION_ANCHORS,
  adaptability: ADAPTABILITY_ANCHORS,
  debugging_maintenance: DEBUGGING_MAINTENANCE_ANCHORS,
};
