/**
 * Pass 3 — validator regression tests.
 *
 * Guards the digit-regex check that prevents Gemma from fabricating numeric
 * claims in `repo_searchable_profile`. Also covers length gates, enum gates,
 * and the language fingerprint check.
 *
 * Run: npx vitest run scripts/crawl-repos/pass3/validate.test.ts
 */

import { describe, it, expect } from 'vitest';
import type { Pass3Data } from '../shared/types.js';
import type { Pass3Input } from './types.js';
import { allowedNumericStrings, validatePass3 } from './validate.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/**
 * Returns a minimal Pass3Input that will pass all validator checks when paired
 * with a matching baseOutput(). Callers spread-override individual fields.
 */
function baseInput(overrides: Partial<Pass3Input> = {}): Pass3Input {
  return {
    repo_id: 42,
    full_name: 'acme/widget',
    primary_language: 'TypeScript',
    stars: 500,
    sloc: 10000,
    file_count: 200,
    mean_ccn: 3.5,
    seniority_band: 'mid',
    has_ci: 1,
    has_tests: 1,
    test_framework: 'vitest',
    detected_domain: 'web',
    detected_stack_json: JSON.stringify({ packages: ['react', 'typescript'] }),
    pr_quality_score: 0.75,
    open_pr_count: 10,
    open_feature_issue_count: 5,
    business_logic_ratio: 0.6,
    cross_module_change_rate: 0.4,
    constructs: [{ slug: 'react_component', evidence_count: 12 }],
    sample_prs: [],
    issues: [],
    prior_content_hash: null,
    prior_signals_version: null,
    ...overrides,
  };
}

/**
 * Generates a string of exactly `n` space-separated words.
 */
function words(n: number, word = 'word'): string {
  return Array(n).fill(word).join(' ');
}

/**
 * Returns a minimal Pass3Data that will pass all validator checks when paired
 * with baseInput(). Callers spread-override individual fields.
 *
 * The narrative contains "TypeScript" to pass the language fingerprint.
 * All numeric values in the profile are single-digit or drawn from FACTS.
 */
function baseOutput(overrides: Partial<Pass3Data> = {}): Pass3Data {
  return {
    repo_id: 42,
    signals_version: '3.0.0',
    content_hash: 'abc123',
    test_touch_rate: 0.5,
    mean_changed_files: 8,
    p90_changed_files: 15,
    issue_link_rate: 0.3,
    complexity_band: 'medium',
    swe_bench_eligibility_rate: 0.2,
    architecture_style: 'layered_service',
    review_density: 2,
    commit_cadence: 4,
    satd_density: 0.1,
    test_style: 'unit_only',
    challenge_surfaces: null,
    // 200-word narrative containing "TypeScript" for language fingerprint
    engineering_narrative: 'TypeScript ' + words(199),
    // 400-word profile using only single-digit numerals and FACTS values
    repo_searchable_profile: words(400),
    signal_json: '{}',
    model_used: 'gemma',
    model_version: '4-31b',
    ...overrides,
  };
}

// ─── Group 1: allowedNumericStrings unit tests ────────────────────────────────

describe('allowedNumericStrings', () => {
  it('integer field: adds its string representation', () => {
    const input = baseInput({ file_count: 200 });
    const output = baseOutput({ mean_changed_files: 1234 });
    const allowed = allowedNumericStrings(input, output);
    expect(allowed.has('1234')).toBe(true);
  });

  it('float field: adds raw string, toFixed(2), and ×100 integer form', () => {
    const output = baseOutput({ test_touch_rate: 0.723 });
    const allowed = allowedNumericStrings(baseInput(), output);
    expect(allowed.has('0.723')).toBe(true);
    // toFixed(2) form
    expect(allowed.has('0.72')).toBe(true);
    // ×100 rounded — Math.round(0.723 * 100) = 72
    expect(allowed.has('72')).toBe(true);
  });

  it('null field contributes nothing extra for that field', () => {
    // Build a fresh output where ONLY test_touch_rate is null; track what
    // integers would have been added vs what is actually present.
    const output = baseOutput({
      test_touch_rate: null,
      mean_changed_files: null,
      p90_changed_files: null,
      issue_link_rate: null,
      swe_bench_eligibility_rate: null,
      review_density: null,
      commit_cadence: null,
      satd_density: null,
    });
    const input = baseInput({ file_count: null });
    const allowed = allowedNumericStrings(input, output);

    // Only single digits 0–9 should be present (no FACTS floats/ints pushed).
    // No multi-digit values except the single-digit set.
    for (let i = 0; i <= 9; i++) {
      expect(allowed.has(String(i))).toBe(true);
    }
    // Multi-digit values that were nulled out should NOT be present.
    expect(allowed.has('500')).toBe(false); // stars is NOT pushed by allowedNumericStrings
  });

  it('single digits 0–9 are always present', () => {
    const allowed = allowedNumericStrings(baseInput(), baseOutput());
    for (let i = 0; i <= 9; i++) {
      expect(allowed.has(String(i))).toBe(true);
    }
  });

  it('multiple float fields do not shadow each other (set is a union)', () => {
    const output = baseOutput({
      test_touch_rate: 0.5,     // → "0.5", "0.50", "50"
      issue_link_rate: 0.3,     // → "0.3", "0.30", "30"
    });
    const allowed = allowedNumericStrings(baseInput(), output);
    expect(allowed.has('0.5')).toBe(true);
    expect(allowed.has('50')).toBe(true);
    expect(allowed.has('0.3')).toBe(true);
    expect(allowed.has('30')).toBe(true);
  });
});

// ─── Group 2: digit-regex inside validatePass3 profile check ─────────────────

describe('validatePass3 — digit regex (repo_searchable_profile)', () => {
  it('valid profile mentioning only FACTS-allowed numbers passes', () => {
    // test_touch_rate: 0.5 → "0.5", "0.50", "50" all allowed
    const output = baseOutput({
      test_touch_rate: 0.5,
      repo_searchable_profile: words(400) + ' the touch rate is 0.5',
    });
    const result = validatePass3(baseInput(), output);
    // Filter only digit-related failures
    const digitFails = result.failures.filter((f) => f.includes('invented numbers'));
    expect(digitFails).toHaveLength(0);
  });

  it('invented integer: profile includes a number absent from FACTS → fails', () => {
    // 1500 is not in any FACTS field (file_count=200, mean_changed_files=8, etc.)
    const output = baseOutput({
      repo_searchable_profile: words(400) + ' merged 1500 PRs in total',
    });
    const result = validatePass3(baseInput(), output);
    expect(result.valid).toBe(false);
    const digitFail = result.failures.find((f) => f.includes('invented numbers'));
    expect(digitFail).toBeDefined();
    expect(digitFail).toContain('1500');
  });

  it('invented float: profile includes an absent float → fails', () => {
    // 0.85 is not produced by any FACTS field in baseOutput/baseInput
    const output = baseOutput({
      test_touch_rate: 0.5,
      repo_searchable_profile: words(400) + ' with a score of 0.85',
    });
    const result = validatePass3(baseInput(), output);
    expect(result.valid).toBe(false);
    const digitFail = result.failures.find((f) => f.includes('invented numbers'));
    expect(digitFail).toBeDefined();
    // 0.85 is the fabricated number; confirm it is named in the failure message
    expect(digitFail).toContain('0.85');
  });

  it('percent form of float fact: test_touch_rate=0.72 → "72%" passes', () => {
    const output = baseOutput({
      test_touch_rate: 0.72,
      // "72" is Math.round(0.72 * 100); "72%" → regex matches "72" which is allowed
      repo_searchable_profile: words(400) + ' touch rate is 72%',
    });
    const result = validatePass3(baseInput(), output);
    const digitFails = result.failures.filter((f) => f.includes('invented numbers'));
    expect(digitFails).toHaveLength(0);
  });

  it('two-decimal form of three-decimal fact: test_touch_rate=0.723, profile "0.72" passes', () => {
    const output = baseOutput({
      test_touch_rate: 0.723,
      // toFixed(2) → "0.72" is in the allow set
      repo_searchable_profile: words(400) + ' touch rate is approximately 0.72',
    });
    const result = validatePass3(baseInput(), output);
    const digitFails = result.failures.filter((f) => f.includes('invented numbers'));
    expect(digitFails).toHaveLength(0);
  });

  it('mixed valid + invalid: only the invented number triggers failure', () => {
    // FACTS: mean_changed_files=8 (single digit, always allowed), test_touch_rate=0.5 → 50
    // "50" is allowed; "9999" is not
    const output = baseOutput({
      test_touch_rate: 0.5,
      mean_changed_files: 8,
      repo_searchable_profile: words(400) + ' about 50 commits and 9999 lines changed',
    });
    const result = validatePass3(baseInput(), output);
    expect(result.valid).toBe(false);
    const digitFail = result.failures.find((f) => f.includes('invented numbers'));
    expect(digitFail).toBeDefined();
    // 9999 is the fabricated value; 50 should NOT appear in the failure message
    expect(digitFail).toContain('9999');
    expect(digitFail).not.toContain('50');
  });

  it('deduped failure list: same invented number repeated → listed once', () => {
    const output = baseOutput({
      repo_searchable_profile: words(400) + ' 9999 issues then 9999 bugs plus 9999 alerts',
    });
    const result = validatePass3(baseInput(), output);
    expect(result.valid).toBe(false);
    const digitFail = result.failures.find((f) => f.includes('invented numbers'));
    expect(digitFail).toBeDefined();

    // Count occurrences of "9999" in the failure message — must be exactly 1.
    const occurrences = (digitFail as string).split('9999').length - 1;
    expect(occurrences).toBe(1);
  });

  it('single-digit always allowed: "3 reviewers" passes even with no FACTS producing 3', () => {
    // All FACTS numerics reset to avoid accidentally producing "3"
    const input = baseInput({ file_count: null });
    const output = baseOutput({
      test_touch_rate: null,
      mean_changed_files: null,
      p90_changed_files: null,
      issue_link_rate: null,
      swe_bench_eligibility_rate: null,
      review_density: null,
      commit_cadence: null,
      satd_density: null,
      repo_searchable_profile: words(400) + ' typically 3 reviewers per PR',
    });
    const result = validatePass3(input, output);
    const digitFails = result.failures.filter((f) => f.includes('invented numbers'));
    expect(digitFails).toHaveLength(0);
  });
});

// ─── Group 3: length gates ────────────────────────────────────────────────────

describe('validatePass3 — length gates', () => {
  it('engineering_narrative 149 words → fails with "too short"', () => {
    const output = baseOutput({ engineering_narrative: 'TypeScript ' + words(148) });
    const result = validatePass3(baseInput(), output);
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes('too short'))).toBe(true);
  });

  it('engineering_narrative 601 words → fails with "too long"', () => {
    const output = baseOutput({ engineering_narrative: 'TypeScript ' + words(600) });
    const result = validatePass3(baseInput(), output);
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes('too long'))).toBe(true);
  });

  it('repo_searchable_profile 119 words → fails with "too short"', () => {
    const output = baseOutput({ repo_searchable_profile: words(119) });
    const result = validatePass3(baseInput(), output);
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes('too short'))).toBe(true);
  });

  it('repo_searchable_profile 801 words → fails with "too long"', () => {
    const output = baseOutput({ repo_searchable_profile: words(801) });
    const result = validatePass3(baseInput(), output);
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes('too long'))).toBe(true);
  });

  it('empty engineering_narrative → fails with "empty"', () => {
    const output = baseOutput({ engineering_narrative: '' });
    const result = validatePass3(baseInput(), output);
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes('empty'))).toBe(true);
  });

  it('empty repo_searchable_profile → fails with "empty"', () => {
    const output = baseOutput({ repo_searchable_profile: '' });
    const result = validatePass3(baseInput(), output);
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes('empty'))).toBe(true);
  });
});

// ─── Group 4: enum gates ──────────────────────────────────────────────────────

describe('validatePass3 — enum gates', () => {
  it('architecture_style "layered_service" → passes enum gate', () => {
    const output = baseOutput({ architecture_style: 'layered_service' });
    const result = validatePass3(baseInput(), output);
    expect(result.failures.some((f) => f.includes('architecture_style invalid'))).toBe(false);
  });

  it('architecture_style "modular_monolith" (legacy, removed) → fails', () => {
    const output = baseOutput({
      // Cast required because the type union doesn't include removed values.
      architecture_style: 'modular_monolith' as Pass3Data['architecture_style'],
    });
    const result = validatePass3(baseInput(), output);
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes('architecture_style invalid'))).toBe(true);
  });

  it('architecture_style "serverless" (legacy, removed) → fails', () => {
    const output = baseOutput({
      architecture_style: 'serverless' as Pass3Data['architecture_style'],
    });
    const result = validatePass3(baseInput(), output);
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes('architecture_style invalid'))).toBe(true);
  });

  it('test_style "integration_heavy" → passes enum gate', () => {
    const output = baseOutput({ test_style: 'integration_heavy' });
    const result = validatePass3(baseInput(), output);
    expect(result.failures.some((f) => f.includes('test_style invalid'))).toBe(false);
  });

  it('test_style "fictional_style" → fails', () => {
    const output = baseOutput({
      test_style: 'fictional_style' as Pass3Data['test_style'],
    });
    const result = validatePass3(baseInput(), output);
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes('test_style invalid'))).toBe(true);
  });
});

// ─── Group 5: language fingerprint ───────────────────────────────────────────

describe('validatePass3 — language fingerprint', () => {
  it('primary_language "TypeScript", narrative contains "TypeScript" → passes', () => {
    const output = baseOutput({
      // baseOutput already has "TypeScript" as first word
      engineering_narrative: 'TypeScript ' + words(199),
    });
    const result = validatePass3(baseInput({ primary_language: 'TypeScript' }), output);
    expect(result.failures.some((f) => f.includes('language fingerprint'))).toBe(false);
  });

  it('primary_language "TypeScript", narrative contains only "JavaScript" → fails', () => {
    // Alias table for TypeScript does NOT include javascript (kept narrow on purpose per lines 28-45)
    const output = baseOutput({
      engineering_narrative: 'JavaScript ' + words(199),
    });
    const result = validatePass3(baseInput({ primary_language: 'TypeScript' }), output);
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes('language fingerprint'))).toBe(true);
  });

  it('primary_language "C#", narrative contains ".NET" → passes (alias)', () => {
    const output = baseOutput({
      engineering_narrative: '.NET framework ' + words(198),
    });
    const result = validatePass3(baseInput({ primary_language: 'C#' }), output);
    expect(result.failures.some((f) => f.includes('language fingerprint'))).toBe(false);
  });
});
