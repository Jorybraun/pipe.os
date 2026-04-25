/**
 * Pass 2 — deterministic path classifier.
 *
 * Maps a repo-relative file path to a coarse category. Used by prSample.ts to
 * compute `business_logic_ratio` and `cross_module_change_rate` from sampled
 * PR file lists. Pure, side-effect-free.
 *
 * Default bucket is `domain_logic` (conservative — unlabeled source is
 * business logic, not util). Order of checks matters: tests and docs must
 * win over domain_logic even when they live under `src/`.
 */

export type PathCategory =
  | 'domain_logic'
  | 'ui'
  | 'util'
  | 'build_config'
  | 'test'
  | 'docs';

const TEST_PATTERNS: RegExp[] = [
  /(^|\/)tests?\//,
  /(^|\/)__tests__\//,
  /\.(test|spec)\.[a-z]+$/i,
  /_test\.(go|py|rb)$/i,
];

const DOCS_PATTERNS: RegExp[] = [
  /(^|\/)docs?\//,
  /^README(\.[a-z]+)?$/i,
  /^CHANGELOG(\.[a-z]+)?$/i,
];

const BUILD_CONFIG_PATTERNS: RegExp[] = [
  /(^|\/)\.github\//,
  /(^|\/)Makefile$/,
  /(^|\/)Dockerfile(\.[a-z]+)?$/i,
  /\.(toml|yaml|yml|ini|cfg)$/i,
  /(^|\/)package(-lock)?\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)go\.(mod|sum)$/,
  /(^|\/)Cargo\.(toml|lock)$/,
  /(^|\/)pyproject\.toml$/,
  /(^|\/)requirements[^/]*\.txt$/,
  /(^|\/)Gemfile(\.lock)?$/,
];

const DOMAIN_LOGIC_PATTERNS: RegExp[] = [
  /(^|\/)src\/(services|domain|core|business)\//,
  /(^|\/)app\/[^/]+\/(services|domain)\//,
  /(^|\/)api\//,
  /(^|\/)server\//,
  /(^|\/)internal\//,
  /(^|\/)handlers?\//,
  /(^|\/)controllers?\//,
  /(^|\/)models?\//,
  /(^|\/)workers?\//,
];

const UI_PATTERNS: RegExp[] = [
  /(^|\/)src\/components\//,
  /(^|\/)components\//,
  /(^|\/)pages\//,
  /(^|\/)app\/.*\/page\.[jt]sx?$/,
  /(^|\/)ui\//,
  /(^|\/)views?\//,
  /\.(css|scss|less)$/i,
];

const UTIL_PATTERNS: RegExp[] = [
  /(^|\/)src\/(utils?|lib|helpers?)\//,
  /(^|\/)(utils?|lib|helpers?|shared)\//,
  /(^|\/)pkg\/(utils?|lib)\//,
];

/**
 * Classify a single repo-relative file path.
 *
 * Check order is significant: tests and docs are matched first so that a
 * file like `src/services/order.test.ts` becomes `test`, not `domain_logic`.
 * The default — `domain_logic` — is conservative: if a path under `src/`
 * doesn't match a UI, util, or test pattern, treat it as business logic.
 */
export function classifyPath(
  path: string,
  _primaryLanguage?: string,
): PathCategory {
  if (TEST_PATTERNS.some((re) => re.test(path))) return 'test';
  if (DOCS_PATTERNS.some((re) => re.test(path))) return 'docs';
  if (BUILD_CONFIG_PATTERNS.some((re) => re.test(path))) return 'build_config';
  if (UI_PATTERNS.some((re) => re.test(path))) return 'ui';
  if (UTIL_PATTERNS.some((re) => re.test(path))) return 'util';
  if (DOMAIN_LOGIC_PATTERNS.some((re) => re.test(path))) return 'domain_logic';

  // Root-level markdown → docs (catches `NOTES.md`, `ARCHITECTURE.md`).
  if (/^[^/]+\.md$/i.test(path)) return 'docs';

  return 'domain_logic';
}

/**
 * Aggregate a set of PRs into business-logic and cross-module ratios.
 *
 * - `business_logic_ratio`: fraction of PRs where at least one path classifies
 *   as `domain_logic`. A PR that only touches tests/docs/config is excluded
 *   from the numerator.
 * - `cross_module_change_rate`: fraction of PRs that span ≥2 distinct
 *   top-level directories (proxy for "touches multiple modules").
 *
 * Returns null ratios when the sample is empty — aggregating zero PRs would
 * give 0/0, which the hybrid ranker must treat as "unknown", not "zero".
 */
export function aggregatePathStats(
  prFilePaths: string[][],
  primaryLanguage: string,
): {
  business_logic_ratio: number | null;
  cross_module_change_rate: number | null;
} {
  if (prFilePaths.length === 0) {
    return { business_logic_ratio: null, cross_module_change_rate: null };
  }

  let domainPrs = 0;
  let crossModulePrs = 0;

  for (const paths of prFilePaths) {
    const hasDomain = paths.some(
      (p) => classifyPath(p, primaryLanguage) === 'domain_logic',
    );
    if (hasDomain) domainPrs++;

    const topDirs = new Set(
      paths.map((p) => {
        const idx = p.indexOf('/');
        return idx === -1 ? p : p.slice(0, idx);
      }),
    );
    if (topDirs.size >= 2) crossModulePrs++;
  }

  return {
    business_logic_ratio: domainPrs / prFilePaths.length,
    cross_module_change_rate: crossModulePrs / prFilePaths.length,
  };
}
