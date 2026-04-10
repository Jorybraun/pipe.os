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
  skills: Array<{ slug: string; source: 'manifest' | 'import' | 'topic' | 'readme'; confidence: number }>;
  constructs: Array<{ slug: string; evidence_count: number }>;
  sample_prs: SamplePR[];
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
