/**
 * Pass 3 — shared types for the TS helper split.
 *
 * `Pass3Input` is what `fetch.ts` produces and what `hash.ts`, `validate.ts`,
 * and the Devstral summarizer prompt consume. It's the deterministic per-repo
 * substrate — every field comes from a real D1 query, never from an LLM.
 *
 * `ValidationResult` is the fingerprint check's output shape — used by the
 * orchestrator to decide whether to persist or skip a Devstral response.
 */

export interface SamplePRSummary {
  pr_number: number;
  title: string | null;
  changed_file_count: number;
  modifies_tests: 0 | 1;
  resolves_issue_number: number | null;
  additions: number | null;
  deletions: number | null;
  construct_slugs_json: string | null;
  swe_bench_eligible: 0 | 1;
  changed_file_paths_json: string | null;
}

export interface RepoIssueSummary {
  issue_number: number;
  title: string;
  state_at_crawl: string;
  labels_json: string | null;
  comment_count: number;
  has_merged_pr: 0 | 1;
}

export interface Pass3Input {
  repo_id: number;
  full_name: string;
  primary_language: string;
  stars: number;
  sloc: number | null;
  file_count: number | null;
  mean_ccn: number | null;
  seniority_band: 'junior' | 'mid' | 'senior' | 'staff' | null;
  has_ci: 0 | 1;
  has_tests: 0 | 1;
  test_framework: string | null;
  detected_domain: string | null;
  detected_stack_json: string | null;
  pr_quality_score: number;
  /** Pass 1 open-work counts (drive the challenge-ready gate). */
  open_pr_count: number | null;
  open_feature_issue_count: number | null;
  /** Pass 2 deterministic aggregates from sampled PR paths. */
  business_logic_ratio: number | null;
  cross_module_change_rate: number | null;
  constructs: Array<{ slug: string; evidence_count: number }>;
  sample_prs: SamplePRSummary[];
  /** Up to ~3KB of README content captured at Pass 2. */
  readme_excerpt: string | null;
  /** JSON-encoded array of root-tree entries captured at Pass 2. */
  root_tree_json: string | null;
  prior_content_hash: string | null;
  prior_signals_version: string | null;
  issues: RepoIssueSummary[];
}

export interface FetchOptions {
  limit?: number;
  repoId?: number;
  onlyMissing?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  failures: string[];
  warnings: string[];
}

export interface PersistResult {
  persisted: boolean;
  verified: boolean;
  expectedHash: string;
  actualHash: string | null;
}
