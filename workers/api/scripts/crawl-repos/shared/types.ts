/**
 * Shared types for the repo crawler pipeline.
 * Used by both Pass 1 and Pass 2 modules.
 */

// ─── GitHub API shapes ────────────────────────────────────────────────────────

export interface GitHubRepoBasic {
  full_name: string;
  html_url: string;
  description: string | null;
  homepage: string | null;
  language: string | null;
  stargazers_count: number;
  pushed_at: string;
  archived: boolean;
  fork: boolean;
  default_branch: string;
  license: { spdx_id: string } | null;
  topics?: string[];
  created_at: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  body: string | null;
  user: { login: string };
  merged_at: string | null;
  state: string;
  changed_files: number;
  additions: number;
  deletions: number;
}

export interface GitHubPRFile {
  filename: string;
  status: string;
}

// ─── Pass-1 row (minimal — no clone) ─────────────────────────────────────────

export interface Pass1Row {
  github_url: string;
  full_name: string;
  description: string | null;
  homepage: string | null;
  primary_language: string;
  license_spdx: string;
  stars: number;
  last_pushed_at: string;
  is_archived: 0 | 1;
  is_fork: 0 | 1;
  contamination_risk: number;
  /** Open PRs (any state). Drives challenge-readiness gate in matchRepos. */
  open_pr_count: number | null;
  /** Open issues with `enhancement` label. Drives challenge-readiness gate. */
  open_feature_issue_count: number | null;
  /** Skills detected from manifest only (no clone) */
  manifest_skills: Array<{ slug: string; source: 'manifest' | 'topic'; confidence: number }>;
  pass: 1;
  crawled_at: string;
}

// ─── Pass-2 augmentation ──────────────────────────────────────────────────────

export interface SeniorityBand {
  value: 'junior' | 'mid' | 'senior' | 'staff';
}

export interface Pass2Data {
  repo_id: number;
  sloc: number;
  file_count: number;
  mean_ccn: number;
  has_ci: 0 | 1;
  has_tests: 0 | 1;
  test_framework: string | null;
  seniority_band: 'junior' | 'mid' | 'senior' | 'staff';
  detected_domain: string;
  domain_confidence: number;
  pr_quality_score: number;
  detected_stack_json: string;
  disqualified: 0 | 1;
  disqualified_reason: string | null;
  /** Fraction of sampled PRs touching ≥1 path classified as `domain_logic`. */
  business_logic_ratio: number | null;
  /** Fraction of sampled PRs spanning ≥2 distinct top-level dirs. */
  cross_module_change_rate: number | null;
  skills: Array<{ slug: string; source: 'manifest' | 'import' | 'topic' | 'readme'; confidence: number }>;
  constructs: Array<{ slug: string; evidence_count: number }>;
  sample_prs: SamplePR[];
  /** Up to ~3KB of README content captured at clone-time. Feeds Pass 3 Gemma. */
  readme_excerpt: string | null;
  /** JSON-encoded array of top-level file/dir names (max 60). Feeds Pass 3 Gemma. */
  root_tree_json: string | null;
}

export interface SamplePR {
  pr_number: number;
  pr_url: string;
  title: string;
  merged_at: string;
  resolves_issue_number: number | null;
  changed_file_count: number;
  modifies_tests: 0 | 1;
  additions: number;
  deletions: number;
  construct_slugs_json: string;
  swe_bench_eligible: 0 | 1;
  /** JSON array of changed file paths. Feeds Pass-2 path classifier (business_logic_ratio, cross_module_change_rate). */
  changed_file_paths_json: string;
  /** Gemma-generated 2–3 sentence narrative describing what the PR does. */
  pr_narrative?: string | null;
  /** BGE-large-en-v1.5 embedding of pr_narrative (document side). */
  pr_narrative_embedding_json?: string | null;
  /** Version stamp for the narrative prompt / model. */
  pr_narrative_version?: string | null;
}

// ─── Construct extractor ──────────────────────────────────────────────────────

export interface ConstructExtractor {
  slug: string;
  /** Returns evidence count: 0 = not present, >0 = present (count = weight) */
  match: (ctx: ExtractorContext) => number;
}

export interface ExtractorContext {
  /** All relative file paths in the cloned repo */
  filePaths: string[];
  /** Contents of the repo directory (for manifest reads) */
  repoDir: string;
  /** Detected skills/packages (slugs) */
  skills: string[];
  /** Raw dependency names (package names, not slugs) */
  rawDeps: string[];
}

// ─── Pass-3 engineering signals ───────────────────────────────────────────────

export type ArchitectureStyle =
  | 'monolith'
  | 'layered_service'
  | 'microservice'
  | 'library'
  | 'unknown';

export type TestStyle =
  | 'unit_only'
  | 'integration_heavy'
  | 'e2e_present'
  | 'minimal'
  | 'unknown';

export type ChallengeSuitabilityVerdict = 'suitable' | 'hold' | 'reject';

export interface TopPrPick {
  pr_number: number;
  why: string;
}

/**
 * Bug-template-aligned challenge surface scores (0–1 each), keyed 1:1 to the
 * 10 ADR-032:131 templates. Computed deterministically in Pass 3 from
 * detected_stack + primary_language + constructs (never LLM-estimated).
 */
export interface ChallengeSurfaces {
  off_by_one_potential: number;
  toctou_race_potential: number;
  stale_cache_potential: number;
  unvalidated_input_potential: number;
  type_confusion_potential: number;
  dangling_reference_potential: number;
  sql_injection_potential: number;
  cors_misconfig_potential: number;
  n_plus_one_potential: number;
  missing_null_check_potential: number;
}

export type RepoNodeType =
  | 'Feature'
  | 'ArchitecturalPattern'
  | 'TechnicalStack'
  | 'Construct'
  | 'ChallengeSurface'
  | 'QualitySignal'
  | 'DomainContext'
  | 'PRSample'
  | 'IssueCandidate';

export interface RepoSubElement {
  node_type: RepoNodeType;
  slug: string;
  narrative_text: string;
  extracted_properties?: Record<string, unknown>;
  source_reference?: string;
}

export interface Pass3Data {
  repo_id: number;
  signals_version: string;
  content_hash: string;
  test_touch_rate: number | null;
  mean_changed_files: number | null;
  p90_changed_files: number | null;
  issue_link_rate: number | null;
  complexity_band: 'low' | 'medium' | 'high' | 'mixed' | null;
  swe_bench_eligibility_rate: number | null;
  architecture_style: ArchitectureStyle | null;
  review_density: number | null;
  commit_cadence: number | null;
  satd_density: number | null;
  /** Deterministic classifier output from test_touch_rate + detected_stack. */
  test_style: TestStyle | null;
  /** JSON-serialized ChallengeSurfaces. Deterministic, fed to Gemma as facts. */
  challenge_surfaces: string | null;
  /** 400–600 word Gemma-narrated profile, embedded into Vectorize REPO_INDEX. */
  repo_searchable_profile: string;
  engineering_narrative: string;
  signal_json: string;
  model_used: string;
  model_version: string;
  /** AI verdict on challenge-suitability: suitable | hold | reject. */
  challenge_suitability_verdict: ChallengeSuitabilityVerdict | null;
  /** One-sentence rationale for the verdict (≤ 200 chars). */
  challenge_suitability_reason: string | null;
  /** AI-ranked top PR picks for code-review challenge material. */
  top_pr_picks: TopPrPick[];
  /** AI-spotted red flags the mechanical Pass 2 checks missed. */
  red_flags: string[];
  /** Prose (2–4 sentences) explaining why the mechanical seniority_band fits or misses. */
  seniority_justification: string | null;
  /** Short role label, e.g. "senior backend engineer". */
  ideal_role_match: string | null;
  /** Cross-family confidence score: unweighted mean of coverage, accuracy, groundedness, specificity (0–1). */
  confidence_score: number | null;
  /** JSON-serialized per-criterion scores. */
  confidence_scores_json: string | null;
  /** Auto-approval verdict derived from confidence_score. */
  confidence_verdict: 'auto_approve' | 'manual_review' | 'auto_reject' | 'not_scored' | null;
  /** Epoch seconds when confidence was last scored. */
  confidence_scored_at: number | null;
}

/** Pass 3 output including decomposed sub-elements. */
export interface Pass3Output extends Pass3Data {
  subElements: RepoSubElement[];
}

// ─── D1 write helpers ─────────────────────────────────────────────────────────

export interface D1Config {
  accountId: string;
  apiToken: string;
  databaseId: string;
}

export interface D1QueryResult {
  success: boolean;
  errors: Array<{ message: string }>;
  result: Array<{
    results: Record<string, unknown>[];
    meta: { rows_read: number; rows_written: number };
  }>;
}
