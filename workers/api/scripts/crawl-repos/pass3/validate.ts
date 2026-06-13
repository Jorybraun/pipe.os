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

const SUITABILITY_VERDICTS = new Set(['suitable', 'hold', 'reject']);

const REASON_MAX_CHARS = 200;
const ROLE_MAX_CHARS = 60;
const PR_PICK_MIN = 1;
const PR_PICK_MAX = 5;
const PR_PICK_WHY_MAX = 200;
const RED_FLAGS_MAX = 6;
const RED_FLAG_MAX_CHARS = 200;
const SENIORITY_JUSTIFICATION_MIN_WORDS = 15;
const SENIORITY_JUSTIFICATION_MAX_WORDS = 120;

const NARRATIVE_WORDS_MIN = 150;
const NARRATIVE_WORDS_MAX = 600;
const PROFILE_WORDS_MIN = 120;
const PROFILE_WORDS_MAX = 800;

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
export function allowedNumericStrings(input: Pass3Input, output: Pass3Data): Set<string> {
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

  // Output-derived stats (computed deterministically before Gemma call)
  push(output.test_touch_rate);
  push(output.mean_changed_files);
  push(output.p90_changed_files);
  push(output.issue_link_rate);
  push(output.swe_bench_eligibility_rate);
  push(output.review_density);
  push(output.commit_cadence);
  push(output.satd_density);

  // Input-derived FACTS block values (sent verbatim to Gemma in the prompt)
  push(input.file_count);
  push(input.sloc);
  // stars intentionally excluded — star counts are too prone to drift to block on.
  // push(input.stars);
  push(input.mean_ccn);
  push(input.pr_quality_score);
  push(input.business_logic_ratio);
  push(input.cross_module_change_rate);
  push(input.open_pr_count);
  push(input.open_feature_issue_count);

  // Construct evidence counts (shown as "slug (N)" in the FACTS top-constructs line)
  for (const c of input.constructs ?? []) {
    push(c.evidence_count);
  }

  // Sample PR fields (shown in the sample_prs JSON array in FACTS)
  for (const pr of input.sample_prs ?? []) {
    push(pr.pr_number);
    push(pr.changed_file_count);
  }

  // Challenge surface scores (shown as "surface=0.80" in FACTS top-3 line)
  try {
    const surfaces = (
      typeof output.challenge_surfaces === 'string'
        ? JSON.parse(output.challenge_surfaces)
        : output.challenge_surfaces
    ) as Record<string, number>;
    for (const score of Object.values(surfaces)) {
      push(score);
    }
  } catch { /* ignore parse errors — surface scores just won't be in the allow-list */ }

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
    const digitRuns = profile.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
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
  const primaryLangLower = input.primary_language?.toLowerCase() ?? '';
  const languageMatched = primaryLangLower.length > 0
    && narrativeLower.includes(primaryLangLower);
  if (narrativeWords > 0 && !languageMatched) {
    failures.push(
      `language fingerprint failed: narrative does not mention the observed source value ` +
        `"${input.primary_language}". Possible hallucination.`,
    );
  }

  // ─── Construct fingerprint (warning only) ────────────────────────────────
  // At least one of the top-5 constructs Devstral was given should appear in
  // the narrative or signal_json. Soft check because constructs can be
  // abstracted away in a role-agnostic summary ("uses dependency injection"
  // instead of "nest_js_module").

  if ((input.constructs ?? []).length > 0) {
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

  // ─── Assessment fields (challenge_suitability, picks, flags, role) ──────

  if (
    output.challenge_suitability_verdict !== null &&
    !SUITABILITY_VERDICTS.has(output.challenge_suitability_verdict)
  ) {
    failures.push(
      `challenge_suitability_verdict invalid: "${output.challenge_suitability_verdict}"`,
    );
  }

  if (output.challenge_suitability_verdict !== null) {
    if (
      output.challenge_suitability_reason == null ||
      output.challenge_suitability_reason.trim().length === 0
    ) {
      failures.push('challenge_suitability_reason is empty but verdict was provided');
    } else if (output.challenge_suitability_reason.length > REASON_MAX_CHARS) {
      failures.push(
        `challenge_suitability_reason too long: ${output.challenge_suitability_reason.length} chars (max ${REASON_MAX_CHARS})`,
      );
    }
  }

  const validPrNumbers = new Set((input.sample_prs ?? []).map((pr) => pr.pr_number));
  if ((output.top_pr_picks ?? []).length > 0) {
    if (output.top_pr_picks.length < PR_PICK_MIN) {
      failures.push(`top_pr_picks too few: ${output.top_pr_picks.length} (min ${PR_PICK_MIN})`);
    }
    if (output.top_pr_picks.length > PR_PICK_MAX) {
      failures.push(`top_pr_picks too many: ${output.top_pr_picks.length} (max ${PR_PICK_MAX})`);
    }
    for (const pick of output.top_pr_picks) {
      if (!validPrNumbers.has(pick.pr_number)) {
        failures.push(
          `top_pr_picks pr_number ${pick.pr_number} not in sample_prs (hallucinated)`,
        );
      }
      if (!pick.why || pick.why.trim().length === 0) {
        failures.push(`top_pr_picks entry for PR ${pick.pr_number} has empty "why"`);
      } else if (pick.why.length > PR_PICK_WHY_MAX) {
        failures.push(
          `top_pr_picks entry for PR ${pick.pr_number} "why" too long: ${pick.why.length} chars (max ${PR_PICK_WHY_MAX})`,
        );
      }
    }
  } else if ((input.sample_prs ?? []).length > 0) {
    // Only warn — reject verdict may legitimately have no picks.
    warnings.push('top_pr_picks is empty despite sample_prs being present');
  }

  if ((output.red_flags ?? []).length > RED_FLAGS_MAX) {
    failures.push(`red_flags too many: ${output.red_flags.length} (max ${RED_FLAGS_MAX})`);
  }
  for (const flag of output.red_flags ?? []) {
    if (flag.length > RED_FLAG_MAX_CHARS) {
      failures.push(`red_flag too long: ${flag.length} chars (max ${RED_FLAG_MAX_CHARS})`);
      break;
    }
  }

  if (output.seniority_justification != null) {
    const words = wordCount(output.seniority_justification);
    if (words < SENIORITY_JUSTIFICATION_MIN_WORDS) {
      failures.push(
        `seniority_justification too short: ${words} words (min ${SENIORITY_JUSTIFICATION_MIN_WORDS})`,
      );
    } else if (words > SENIORITY_JUSTIFICATION_MAX_WORDS) {
      failures.push(
        `seniority_justification too long: ${words} words (max ${SENIORITY_JUSTIFICATION_MAX_WORDS})`,
      );
    }
  }

  if (output.ideal_role_match != null) {
    if (output.ideal_role_match.trim().length === 0) {
      failures.push('ideal_role_match is empty');
    } else if (output.ideal_role_match.length > ROLE_MAX_CHARS) {
      failures.push(
        `ideal_role_match too long: ${output.ideal_role_match.length} chars (max ${ROLE_MAX_CHARS})`,
      );
    }
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
