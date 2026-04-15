/**
 * Pass 3 — real-time validation (fingerprint check).
 *
 * Runs between the Devstral summarization call and the INSERT. Takes a
 * Pass3Input (what the orchestrator fetched from D1) and a Pass3Data (what
 * Devstral returned) and checks whether the output is plausibly describing
 * the same repo. If not, the orchestrator skips the repo — no bad write
 * lands in production.
 *
 * This is the guardrail for the 2026-04-11 incident where an LLM hallucinated
 * `facebook/react` for repo ID 10 (actually `ionic-team/ionic-framework`).
 * The deterministic TS orchestrator prevents the bug at the architectural
 * level; this validator catches it in the unlikely event the LLM
 * free-associates within a single repo call.
 *
 * Checks are deliberately structural and cheap: no embeddings, no LLM, no
 * network. Every rule is "an input Devstral was given must appear somewhere
 * in the output Devstral produced." If zero inputs survive into the output,
 * Devstral didn't actually summarize the repo you asked about.
 */

import type { Pass3Data } from '../shared/types.js';
import type { Pass3Input, ValidationResult } from './types.js';

// Language fingerprint aliases — Devstral may reasonably surface a sibling name
// (React code is JavaScript/TypeScript; .NET is C#). Keeping this list
// narrow on purpose — a sprawling alias table would mask real hallucinations.
const LANGUAGE_ALIASES: Record<string, readonly string[]> = {
  typescript: ['typescript', 'tsx'],
  javascript: ['javascript', 'jsx'],
  python: ['python'],
  go: ['go', 'golang'],
  rust: ['rust'],
  'c++': ['c++', 'cpp'],
  'c#': ['c#', 'csharp', '.net', 'dotnet'],
  java: ['java'],
  kotlin: ['kotlin'],
  swift: ['swift'],
  ruby: ['ruby'],
  php: ['php'],
  elixir: ['elixir'],
  scala: ['scala'],
  dart: ['dart'],
  shell: ['shell', 'bash'],
};

const COMPLEXITY_BANDS = new Set(['low', 'medium', 'high', 'mixed']);
const ARCHITECTURE_STYLES = new Set([
  'monolith',
  'layered_service',
  'microservice',
  'library',
  'unknown',
]);

const TEST_STYLES = new Set([
  'unit_only',
  'integration_heavy',
  'e2e_present',
  'minimal',
  'unknown',
]);

const NARRATIVE_WORDS_MIN = 200;
const NARRATIVE_WORDS_MAX = 400;
const PROFILE_WORDS_MIN = 400;
const PROFILE_WORDS_MAX = 600;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[_\-\s]/g, '');
}

function wordCount(s: string): number {
  const trimmed = s.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Extract all numeric literals a Gemma narrative is allowed to mention.
 * Any digit sequence appearing in `repo_searchable_profile` must match one of
 * the values from the pre-filled FACTS block; otherwise the LLM invented a
 * statistic and the row is rejected.
 */
function allowedNumericStrings(input: Pass3Input, output: Pass3Data): Set<string> {
  const allowed = new Set<string>();
  const push = (n: number | null | undefined): void => {
    if (n === null || n === undefined) return;
    if (Number.isInteger(n)) {
      allowed.add(String(n));
      return;
    }
    // Float: accept the raw number, 2dp, 3dp, and the integer %-form.
    allowed.add(String(n));
    allowed.add(n.toFixed(2));
    allowed.add(n.toFixed(3));
    allowed.add(String(Math.round(n * 100)));
  };

  push(output.test_touch_rate);
  push(output.mean_changed_files);
  push(output.p90_changed_files);
  push(output.issue_link_rate);
  push(output.swe_bench_eligibility_rate);
  push(output.review_density);
  push(output.commit_cadence);
  push(output.satd_density);
  push(input.file_count);

  // Single-digit numerals are always allowed (they appear in any coherent prose).
  for (let i = 0; i <= 9; i++) allowed.add(String(i));
  return allowed;
}

export function validatePass3(input: Pass3Input, output: Pass3Data): ValidationResult {
  const failures: string[] = [];
  const warnings: string[] = [];

  // ─── Identity checks ─────────────────────────────────────────────────────

  if (output.repo_id !== input.repo_id) {
    failures.push(
      `repo_id mismatch: expected ${input.repo_id} (${input.full_name}), got ${output.repo_id}`,
    );
  }

  // ─── Narrative presence + shape ──────────────────────────────────────────
  // Word counts tightened to canonical RUC §2.3 bounds.

  const narrative = output.engineering_narrative ?? '';
  const narrativeWords = wordCount(narrative);
  if (narrativeWords === 0) {
    failures.push('engineering_narrative is empty');
  } else if (narrativeWords < NARRATIVE_WORDS_MIN) {
    failures.push(`engineering_narrative too short: ${narrativeWords} words (min ${NARRATIVE_WORDS_MIN})`);
  } else if (narrativeWords > NARRATIVE_WORDS_MAX) {
    failures.push(`engineering_narrative too long: ${narrativeWords} words (max ${NARRATIVE_WORDS_MAX})`);
  }

  // ─── Searchable profile (400–600 words; facts-only digits) ───────────────

  const profile = output.repo_searchable_profile ?? '';
  const profileWords = wordCount(profile);
  if (profileWords === 0) {
    failures.push('repo_searchable_profile is empty');
  } else if (profileWords < PROFILE_WORDS_MIN) {
    failures.push(`repo_searchable_profile too short: ${profileWords} words (min ${PROFILE_WORDS_MIN})`);
  } else if (profileWords > PROFILE_WORDS_MAX) {
    failures.push(`repo_searchable_profile too long: ${profileWords} words (max ${PROFILE_WORDS_MAX})`);
  }

  if (profileWords > 0) {
    const allowed = allowedNumericStrings(input, output);
    const digitRuns = profile.match(/\d+(?:\.\d+)?/g) ?? [];
    const invented = digitRuns.filter((d) => !allowed.has(d));
    if (invented.length > 0) {
      failures.push(
        `repo_searchable_profile contains invented numbers not in FACTS block: ` +
          `${[...new Set(invented)].slice(0, 5).join(', ')}`,
      );
    }
  }

  // ─── Language fingerprint ────────────────────────────────────────────────
  // The primary language was in the prompt Devstral received. If it doesn't
  // appear anywhere in the narrative, Devstral probably summarized a different
  // repo. This is the single highest-signal hallucination check.

  const narrativeLower = narrative.toLowerCase();
  const primaryLangLower = input.primary_language.toLowerCase();
  const aliases = LANGUAGE_ALIASES[primaryLangLower] ?? [primaryLangLower];
  const languageMatched = aliases.some((a) => narrativeLower.includes(a));
  if (narrativeWords > 0 && !languageMatched) {
    failures.push(
      `language fingerprint failed: narrative does not mention "${input.primary_language}" ` +
        `or any known alias (${aliases.join(', ')}). Possible hallucination.`,
    );
  }

  // ─── Construct fingerprint (warning only) ────────────────────────────────
  // At least one of the top-5 constructs Devstral was given should appear in
  // the narrative or signal_json. Soft check because constructs can be
  // abstracted away in a role-agnostic summary ("uses dependency injection"
  // instead of "nest_js_module").

  if (input.constructs.length > 0) {
    const top = input.constructs.slice(0, 5).map((c) => normalize(c.slug));
    const haystack = normalize(narrative + ' ' + (output.signal_json ?? ''));
    const constructMatched = top.some((c) => haystack.includes(c));
    if (!constructMatched) {
      warnings.push(
        `construct fingerprint weak: neither narrative nor signal_json mentions any of ` +
          `the top ${top.length} constructs (${input.constructs
            .slice(0, 5)
            .map((c) => c.slug)
            .join(', ')}).`,
      );
    }
  }

  // ─── signal_json must be parseable ───────────────────────────────────────

  if (!output.signal_json) {
    failures.push('signal_json is missing');
  } else {
    try {
      JSON.parse(output.signal_json);
    } catch (err) {
      failures.push(`signal_json is not valid JSON: ${(err as Error).message}`);
    }
  }

  // ─── Enum checks ─────────────────────────────────────────────────────────

  if (
    output.complexity_band !== null &&
    !COMPLEXITY_BANDS.has(output.complexity_band)
  ) {
    failures.push(`complexity_band invalid: "${output.complexity_band}"`);
  }

  if (
    output.architecture_style !== null &&
    !ARCHITECTURE_STYLES.has(output.architecture_style)
  ) {
    failures.push(`architecture_style invalid: "${output.architecture_style}"`);
  }

  if (
    output.test_style !== null &&
    !TEST_STYLES.has(output.test_style)
  ) {
    failures.push(`test_style invalid: "${output.test_style}"`);
  }

  // ─── Rate ranges ─────────────────────────────────────────────────────────

  const rateChecks: Array<[string, number | null]> = [
    ['test_touch_rate', output.test_touch_rate],
    ['issue_link_rate', output.issue_link_rate],
    ['swe_bench_eligibility_rate', output.swe_bench_eligibility_rate],
  ];
  for (const [name, value] of rateChecks) {
    if (value !== null && (value < 0 || value > 1)) {
      failures.push(`${name} out of range [0,1]: ${value}`);
    }
  }

  // ─── Plausibility: mean_changed_files cannot exceed file_count ───────────

  if (
    output.mean_changed_files !== null &&
    input.file_count !== null &&
    output.mean_changed_files > input.file_count
  ) {
    failures.push(
      `mean_changed_files (${output.mean_changed_files}) exceeds repo file_count ` +
        `(${input.file_count}) — LLM fabricated a value larger than the repo.`,
    );
  }

  return {
    valid: failures.length === 0,
    failures,
    warnings,
  };
}

// ─── CLI entry ───────────────────────────────────────────────────────────────
// Reads `{ input: Pass3Input, output: Pass3Data }` on stdin, writes a
// `ValidationResult` on stdout. Exit code 0 if valid, 2 if failures.

async function readStdin(): Promise<string> {
  let buf = '';
  for await (const chunk of process.stdin) buf += chunk;
  return buf;
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const payload = JSON.parse(raw) as { input: Pass3Input; output: Pass3Data };
  const result = validatePass3(payload.input, payload.output);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.valid) process.exit(2);
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error('[pass3/validate] failed:', err);
    process.exit(1);
  });
}
