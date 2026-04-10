/**
 * Crawler configuration: search queries, thresholds, band boundaries.
 *
 * The SEARCH_QUERIES list is the mouth of the funnel — curate it carefully.
 * A bad query list means a bad DB. Default: Tier 1 stacks (TypeScript, Python, Go).
 */

export interface SearchQuery {
  lang: string;
  topics: string[];
  minStars: number;
  /** Optional domain hint — used to pre-classify before pass-2 domain inference */
  domainHint?: string;
}

// ─── Search queries ──────────────────────────────────────────────────────────

export const SEARCH_QUERIES: SearchQuery[] = [
  // TypeScript / React ecosystem
  { lang: 'typescript', topics: ['react'],           minStars: 100 },
  { lang: 'typescript', topics: ['nextjs'],          minStars: 100 },
  { lang: 'typescript', topics: ['graphql'],         minStars: 100 },
  { lang: 'typescript', topics: ['tailwindcss'],     minStars: 100 },
  { lang: 'typescript', topics: ['prisma'],          minStars: 100 },
  { lang: 'typescript', topics: ['trpc'],            minStars: 100 },
  { lang: 'typescript', topics: ['nestjs'],          minStars: 100 },
  { lang: 'typescript', topics: ['hono'],            minStars:  50 },
  { lang: 'typescript', topics: ['testing'],         minStars: 100 },
  // Python ecosystem
  { lang: 'python',     topics: ['fastapi'],         minStars: 100 },
  { lang: 'python',     topics: ['django'],          minStars: 100 },
  { lang: 'python',     topics: ['flask'],           minStars: 100 },
  { lang: 'python',     topics: ['sqlalchemy'],      minStars: 100 },
  { lang: 'python',     topics: ['pytest'],          minStars: 100 },
  { lang: 'python',     topics: ['pydantic'],        minStars: 100 },
  // Go ecosystem
  { lang: 'go',         topics: ['api'],             minStars: 100 },
  { lang: 'go',         topics: ['gin'],             minStars: 100 },
  { lang: 'go',         topics: ['rest-api'],        minStars: 100 },
  { lang: 'go',         topics: ['microservices'],   minStars: 100 },
  // Rust ecosystem
  { lang: 'rust',       topics: ['axum'],            minStars:  50 },
  { lang: 'rust',       topics: ['actix-web'],       minStars:  50 },
  { lang: 'rust',       topics: ['tokio'],           minStars: 100 },
  // Java ecosystem
  { lang: 'java',       topics: ['spring-boot'],     minStars: 100 },
  { lang: 'kotlin',     topics: ['spring-boot'],     minStars:  50 },
  // Ruby
  { lang: 'ruby',       topics: ['rails'],           minStars: 100 },
];

// ─── License allowlist ────────────────────────────────────────────────────────

/** Only repos with these SPDX identifiers are accepted. */
export const ALLOWED_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MPL-2.0',
  'LGPL-2.1',
  'LGPL-3.0',
]);

// ─── Contamination risk thresholds ───────────────────────────────────────────

/** Very high star counts suggest the repo is "memorized" by LLMs. */
export const CONTAMINATION_THRESHOLDS = {
  /** stars > this → risk = 0.9 (soft penalty only — not a hard reject) */
  veryHigh: 100_000,
  /** stars > this → risk = 0.7 */
  high: 50_000,
  /** stars > this → risk = 0.5 */
  moderate: 20_000,
  /** default → risk = 0.3 */
  base: 0.3,
};

export function computeContaminationRisk(stars: number): number {
  if (stars > CONTAMINATION_THRESHOLDS.veryHigh) return 0.9;
  if (stars > CONTAMINATION_THRESHOLDS.high) return 0.7;
  if (stars > CONTAMINATION_THRESHOLDS.moderate) return 0.5;
  return CONTAMINATION_THRESHOLDS.base;
}

// ─── Seniority band boundaries ────────────────────────────────────────────────

/**
 * Derives seniority from SLOC, file count, and mean CCN.
 * Uses first matching rule (priority order).
 */
export function computeSeniorityBand(
  sloc: number,
  fileCount: number,
  meanCcn: number,
): 'junior' | 'mid' | 'senior' | 'staff' {
  if (sloc > 100_000 || fileCount > 500 || meanCcn > 12) return 'staff';
  if (sloc > 30_000  || fileCount > 200 || meanCcn > 6)  return 'senior';
  if (sloc > 5_000   || fileCount > 50  || meanCcn > 3)  return 'mid';
  return 'junior';
}

// ─── Domain deny-list ─────────────────────────────────────────────────────────

/** Topic keywords that signal domain-specific repos unsuitable for general assessment. */
export const DOMAIN_DENYLIST_KEYWORDS = [
  'genomics', 'bioinformatics', 'physics-simulation', 'quant-finance',
  'quantitative-finance', 'high-frequency-trading', 'drug-discovery',
  'protein-folding', 'astronomy', 'seismology',
];

// ─── Pass-2 batch settings ────────────────────────────────────────────────────

export const PASS2_BATCH_SIZE = parseInt(process.env['PASS2_BATCH_SIZE'] ?? '200', 10);
export const PASS2_CONCURRENCY = parseInt(process.env['PASS2_CONCURRENCY'] ?? '4', 10);
export const PASS2_PR_SCAN_LIMIT = 200;
export const PASS2_PR_ELIGIBLE_LIMIT = 20;
export const PASS2_MIN_ELIGIBLE_PRS = 3;

// ─── Staleness gate ───────────────────────────────────────────────────────────

/** Repos not pushed in this many months are marked stale. */
export const STALE_MONTHS = 6;

export function staleCutoff(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - STALE_MONTHS);
  return d.toISOString();
}
