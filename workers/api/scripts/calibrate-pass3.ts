#!/usr/bin/env tsx
/**
 * Pass 3 calibration harness — Karpathy-style evaluation loop.
 *
 * Runs the full Gemma + validate + judge pipeline on a sample of repos
 * WITHOUT writing to D1 or Vectorize. Use this to measure approval rates,
 * tune prompts, and compare metrics before/after changes.
 *
 * Usage:
 *   npx tsx scripts/calibrate-pass3.ts [--limit N] [--repo-id N] [--only-missing]
 *
 * Output:
 *   fixtures/pass3-calibration-runs/{timestamp}/
 *     {repo_id}-{sanitized_name}.json  — per-repo pipeline trace
 *     summary.json                     — aggregate stats
 *
 * Env: loaded from workers/api/.dev.vars (same as pass3/run.ts)
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, '..');
dotenv.config({ path: resolve(apiRoot, '.dev.vars') });

import { D1Client, loadD1Config } from './crawl-repos/shared/d1Client.js';
import { logger } from './crawl-repos/shared/logger.js';
import { fetchBatch } from './crawl-repos/pass3/fetch.js';
import { computeContentHash } from './crawl-repos/pass3/hash.js';
import { validatePass3 } from './crawl-repos/pass3/validate.js';
import { judgeOutput } from './crawl-repos/pass3/judge.js';
import {
  getAccessToken,
  callGemma,
  buildSummarizerPrompt,
  parseGemmaResponse,
} from './crawl-repos/pass3/run.js';
import { classifyTestStyle } from './crawl-repos/pass3/testStyleClassifier.js';
import { classifyChallengeSurfaces } from './crawl-repos/pass3/challengeSurfaceClassifier.js';
import { computeDeterministicStats, computeComplexityBand } from './crawl-repos/pass3/deterministicStats.js';
import type { Pass3Input, FetchOptions } from './crawl-repos/pass3/types.js';
import type { JudgeResult } from './crawl-repos/pass3/judge.js';
import type { ValidationResult } from './crawl-repos/pass3/types.js';
import type { Pass3Data } from './crawl-repos/shared/types.js';

// ─── Constants ─────────────────────────────────────────────────────────────

const SIGNALS_VERSION = 'v2.0.0';
const FIXTURES_DIR = resolve(apiRoot, 'fixtures/pass3-calibration-runs');

// ─── Types ──────────────────────────────────────────────────────────────────

interface CalibrationRecord {
  repo_id: number;
  full_name: string;
  run_timestamp: string;
  pipeline: {
    gemma_attempt1: {
      success: boolean;
      error?: string;
      parse_success?: boolean;
      parse_error?: string;
      narrative_words?: number;
      profile_words?: number;
    };
    validation_attempt1: ValidationResult | null;
    judge_attempt1: JudgeResult | null;
    gemma_attempt2?: {
      success: boolean;
      error?: string;
      parse_success?: boolean;
      parse_error?: string;
      narrative_words?: number;
      profile_words?: number;
    };
    validation_attempt2?: ValidationResult | null;
    judge_attempt2?: JudgeResult | null;
    final_status: 'approved' | 'approved_on_retry' | 'validation_failed' | 'judge_failed' | 'gemma_error' | 'parse_error';
  };
  raw_gemma_attempt1?: string;
  raw_gemma_attempt2?: string;
  input_fingerprint: {
    repo_id: number;
    full_name: string;
    primary_language: string;
    stars: number;
    has_tests: boolean;
    detected_domain: string | null;
  };
}

interface CalibrationSummary {
  run_timestamp: string;
  total_repos: number;
  gemma_attempt1_success_rate: number;
  validation_attempt1_pass_rate: number;
  judge_attempt1_approval_rate: number;
  judge_approval_after_retry_rate: number;
  final_approval_rate: number;
  status_distribution: Record<string, number>;
  judge_dimension_failure_rates: {
    constraint_pass: number;
    accuracy_pass: number;
    architecture_pass: number;
    completeness_pass: number;
  };
  most_common_validation_failures: string[];
  most_common_judge_failures: string[];
  avg_narrative_words_attempt1: number;
  avg_profile_words_attempt1: number;
  repos: Array<{ repo_id: number; full_name: string; final_status: string }>;
}

// ─── Word count helper ──────────────────────────────────────────────────────

function wordCount(s: string): number {
  const t = s.trim();
  return t.length === 0 ? 0 : t.split(/\s+/).length;
}

// ─── Calibrate a single repo ────────────────────────────────────────────────

async function calibrateRepo(
  accessToken: string,
  projectId: string,
  input: Pass3Input,
  mistralKey: string | undefined,
  progress: { index: number; total: number },
): Promise<CalibrationRecord> {
  const tag = `[${progress.index}/${progress.total}]`;
  const runTimestamp = new Date().toISOString();

  const record: CalibrationRecord = {
    repo_id: input.repo_id,
    full_name: input.full_name,
    run_timestamp: runTimestamp,
    pipeline: {
      gemma_attempt1: { success: false },
      validation_attempt1: null,
      judge_attempt1: null,
      final_status: 'gemma_error',
    },
    input_fingerprint: {
      repo_id: input.repo_id,
      full_name: input.full_name,
      primary_language: input.primary_language,
      stars: input.stars,
      has_tests: input.has_tests === 1,
      detected_domain: input.detected_domain ?? null,
    },
  };

  // Compute deterministic facts (same logic as run.ts)
  const stats = computeDeterministicStats(input.sample_prs);
  const testStyle = classifyTestStyle({
    test_touch_rate: stats.test_touch_rate,
    detected_stack_json: input.detected_stack_json,
  });
  const challengeSurfaces = classifyChallengeSurfaces({
    detected_stack_json: input.detected_stack_json,
    primary_language: input.primary_language,
    constructs: input.constructs,
    detected_domain: input.detected_domain,
  });
  const facts = {
    ...stats,
    complexity_band: computeComplexityBand(input.mean_ccn),
    test_style: testStyle,
    challenge_surfaces: challengeSurfaces as unknown as Record<string, number>,
    business_logic_ratio: input.business_logic_ratio,
    cross_module_change_rate: input.cross_module_change_rate,
    open_pr_count: input.open_pr_count,
    open_feature_issue_count: input.open_feature_issue_count,
  };

  const contentHash = computeContentHash(input, SIGNALS_VERSION);
  const { system, user: factsPrompt } = buildSummarizerPrompt(input, facts);

  // ── Attempt 1: Gemma ────────────────────────────────────────────────────
  logger.info(`[calibrate] ${tag} ${input.full_name} — Gemma attempt 1`);
  let raw1 = '';
  try {
    raw1 = await callGemma(accessToken, projectId, system, factsPrompt);
    record.raw_gemma_attempt1 = raw1;
    record.pipeline.gemma_attempt1.success = true;
  } catch (err) {
    record.pipeline.gemma_attempt1.success = false;
    record.pipeline.gemma_attempt1.error = err instanceof Error ? err.message : String(err);
    record.pipeline.final_status = 'gemma_error';
    return record;
  }

  let output1: Pass3Data;
  try {
    output1 = parseGemmaResponse(raw1, input, contentHash, facts);
    record.pipeline.gemma_attempt1.parse_success = true;
    record.pipeline.gemma_attempt1.narrative_words = wordCount(output1.engineering_narrative);
    record.pipeline.gemma_attempt1.profile_words = wordCount(output1.repo_searchable_profile);
  } catch (err) {
    record.pipeline.gemma_attempt1.parse_success = false;
    record.pipeline.gemma_attempt1.parse_error = err instanceof Error ? err.message : String(err);
    record.pipeline.final_status = 'parse_error';
    return record;
  }

  // ── Validate attempt 1 ─────────────────────────────────────────────────
  const validation1 = validatePass3(input, output1);
  record.pipeline.validation_attempt1 = validation1;

  if (!validation1.valid) {
    record.pipeline.final_status = 'validation_failed';
    return record;
  }

  // ── Judge attempt 1 ────────────────────────────────────────────────────
  if (!mistralKey) {
    logger.warn(`[calibrate] ${tag} ${input.full_name} — no MISTRAL_API_KEY, skipping judge`);
    record.pipeline.final_status = 'approved';
    return record;
  }

  logger.info(`[calibrate] ${tag} ${input.full_name} — judge attempt 1`);
  const judge1 = await judgeOutput({
    factsBlock: factsPrompt,
    narrative: output1.engineering_narrative,
    profile: output1.repo_searchable_profile,
    architectureStyle: output1.architecture_style,
    apiKey: mistralKey,
  });
  record.pipeline.judge_attempt1 = judge1;

  if (judge1.approved) {
    record.pipeline.final_status = 'approved';
    return record;
  }

  // ── Retry: Gemma attempt 2 ─────────────────────────────────────────────
  logger.info(`[calibrate] ${tag} ${input.full_name} — judge denied, Gemma attempt 2 (${judge1.failures.length} failures)`);
  const retryPrompt =
    `${factsPrompt}\n\n---\nPREVIOUS ATTEMPT REJECTED by quality gate. Fix ALL of the following issues in your new response:\n` +
    judge1.failures.map((f) => `- ${f}`).join('\n');

  record.pipeline.gemma_attempt2 = { success: false };
  let raw2 = '';
  try {
    raw2 = await callGemma(accessToken, projectId, system, retryPrompt);
    record.raw_gemma_attempt2 = raw2;
    record.pipeline.gemma_attempt2.success = true;
  } catch (err) {
    record.pipeline.gemma_attempt2.success = false;
    record.pipeline.gemma_attempt2.error = err instanceof Error ? err.message : String(err);
    record.pipeline.final_status = 'judge_failed';
    return record;
  }

  let output2: Pass3Data;
  try {
    output2 = parseGemmaResponse(raw2, input, contentHash, facts);
    record.pipeline.gemma_attempt2.parse_success = true;
    record.pipeline.gemma_attempt2.narrative_words = wordCount(output2.engineering_narrative);
    record.pipeline.gemma_attempt2.profile_words = wordCount(output2.repo_searchable_profile);
  } catch (err) {
    record.pipeline.gemma_attempt2.parse_success = false;
    record.pipeline.gemma_attempt2.parse_error = err instanceof Error ? err.message : String(err);
    record.pipeline.final_status = 'judge_failed';
    return record;
  }

  const validation2 = validatePass3(input, output2);
  record.pipeline.validation_attempt2 = validation2;

  if (!validation2.valid) {
    record.pipeline.final_status = 'judge_failed';
    return record;
  }

  logger.info(`[calibrate] ${tag} ${input.full_name} — judge attempt 2`);
  const judge2 = await judgeOutput({
    factsBlock: factsPrompt,
    narrative: output2.engineering_narrative,
    profile: output2.repo_searchable_profile,
    architectureStyle: output2.architecture_style,
    apiKey: mistralKey,
  });
  record.pipeline.judge_attempt2 = judge2;

  record.pipeline.final_status = judge2.approved ? 'approved_on_retry' : 'judge_failed';
  return record;
}

// ─── Aggregate summary ──────────────────────────────────────────────────────

function buildSummary(records: CalibrationRecord[], timestamp: string): CalibrationSummary {
  const total = records.length;
  if (total === 0) {
    return {
      run_timestamp: timestamp,
      total_repos: 0,
      gemma_attempt1_success_rate: 0,
      validation_attempt1_pass_rate: 0,
      judge_attempt1_approval_rate: 0,
      judge_approval_after_retry_rate: 0,
      final_approval_rate: 0,
      status_distribution: {},
      judge_dimension_failure_rates: { constraint_pass: 0, accuracy_pass: 0, architecture_pass: 0, completeness_pass: 0 },
      most_common_validation_failures: [],
      most_common_judge_failures: [],
      avg_narrative_words_attempt1: 0,
      avg_profile_words_attempt1: 0,
      repos: [],
    };
  }

  const gemmaSucceeded = records.filter((r) => r.pipeline.gemma_attempt1.success).length;
  const validationPassed = records.filter((r) => r.pipeline.validation_attempt1?.valid).length;
  const judgedRepos = records.filter((r) => r.pipeline.judge_attempt1 !== null);
  const judge1Approved = judgedRepos.filter((r) => r.pipeline.judge_attempt1?.approved).length;
  const afterRetryApproved = records.filter(
    (r) => r.pipeline.judge_attempt2?.approved,
  ).length;
  const finalApproved = records.filter(
    (r) => r.pipeline.final_status === 'approved' || r.pipeline.final_status === 'approved_on_retry',
  ).length;

  // Status distribution
  const statusDist: Record<string, number> = {};
  for (const r of records) {
    statusDist[r.pipeline.final_status] = (statusDist[r.pipeline.final_status] ?? 0) + 1;
  }

  // Judge dimension failure rates (across all judge calls)
  const allJudgeResults: JudgeResult[] = [];
  for (const r of records) {
    if (r.pipeline.judge_attempt1) allJudgeResults.push(r.pipeline.judge_attempt1);
    if (r.pipeline.judge_attempt2) allJudgeResults.push(r.pipeline.judge_attempt2);
  }
  const dimensionFailRates = {
    constraint_pass: allJudgeResults.length === 0 ? 0 : allJudgeResults.filter((j) => !j.constraint_pass).length / allJudgeResults.length,
    accuracy_pass: allJudgeResults.length === 0 ? 0 : allJudgeResults.filter((j) => !j.accuracy_pass).length / allJudgeResults.length,
    architecture_pass: allJudgeResults.length === 0 ? 0 : allJudgeResults.filter((j) => !j.architecture_pass).length / allJudgeResults.length,
    completeness_pass: allJudgeResults.length === 0 ? 0 : allJudgeResults.filter((j) => !j.completeness_pass).length / allJudgeResults.length,
  };

  // Common validation failures
  const valFailCounts: Record<string, number> = {};
  for (const r of records) {
    for (const f of r.pipeline.validation_attempt1?.failures ?? []) {
      // Normalise: strip specific numbers to find pattern
      const pattern = f.replace(/\d+/g, 'N');
      valFailCounts[pattern] = (valFailCounts[pattern] ?? 0) + 1;
    }
  }
  const topValFailures = Object.entries(valFailCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([msg, count]) => `(${count}x) ${msg}`);

  // Common judge failures
  const judgeFailCounts: Record<string, number> = {};
  for (const j of allJudgeResults) {
    for (const f of j.failures) {
      const pattern = f.replace(/\d+/g, 'N');
      judgeFailCounts[pattern] = (judgeFailCounts[pattern] ?? 0) + 1;
    }
  }
  const topJudgeFailures = Object.entries(judgeFailCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([msg, count]) => `(${count}x) ${msg}`);

  // Average word counts
  const narrativeWords = records
    .map((r) => r.pipeline.gemma_attempt1.narrative_words ?? 0)
    .filter((n) => n > 0);
  const profileWords = records
    .map((r) => r.pipeline.gemma_attempt1.profile_words ?? 0)
    .filter((n) => n > 0);
  const avg = (arr: number[]): number =>
    arr.length === 0 ? 0 : Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);

  return {
    run_timestamp: timestamp,
    total_repos: total,
    gemma_attempt1_success_rate: pct(gemmaSucceeded, total),
    validation_attempt1_pass_rate: pct(validationPassed, gemmaSucceeded),
    judge_attempt1_approval_rate: judgedRepos.length === 0 ? 0 : pct(judge1Approved, judgedRepos.length),
    judge_approval_after_retry_rate: pct(afterRetryApproved, records.filter((r) => r.pipeline.judge_attempt2 !== undefined).length),
    final_approval_rate: pct(finalApproved, total),
    status_distribution: statusDist,
    judge_dimension_failure_rates: dimensionFailRates,
    most_common_validation_failures: topValFailures,
    most_common_judge_failures: topJudgeFailures,
    avg_narrative_words_attempt1: avg(narrativeWords),
    avg_profile_words_attempt1: avg(profileWords),
    repos: records.map((r) => ({
      repo_id: r.repo_id,
      full_name: r.full_name,
      final_status: r.pipeline.final_status,
    })),
  };
}

function pct(n: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((n / total) * 10000) / 100; // e.g. 87.50
}

// ─── Print summary to console ───────────────────────────────────────────────

function printSummary(s: CalibrationSummary, outputDir: string): void {
  console.log('\n═══ Pass 3 Calibration Results ═══');
  console.log(`Repos tested:          ${s.total_repos}`);
  console.log(`Gemma success:         ${s.gemma_attempt1_success_rate}%`);
  console.log(`Validation pass:       ${s.validation_attempt1_pass_rate}% (of Gemma successes)`);
  console.log(`Judge approved (1st):  ${s.judge_attempt1_approval_rate}%`);
  console.log(`Judge approved (retry):${s.judge_approval_after_retry_rate}%`);
  console.log(`Final approval rate:   ${s.final_approval_rate}%`);
  console.log('\nStatus distribution:');
  for (const [status, count] of Object.entries(s.status_distribution).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status.padEnd(20)} ${count}`);
  }
  console.log('\nJudge dimension failure rates:');
  for (const [dim, rate] of Object.entries(s.judge_dimension_failure_rates)) {
    const pctStr = (rate as number * 100).toFixed(1);
    console.log(`  ${dim.padEnd(22)} ${pctStr}% fail`);
  }
  if (s.most_common_validation_failures.length > 0) {
    console.log('\nTop validation failures:');
    for (const f of s.most_common_validation_failures) console.log(`  ${f}`);
  }
  if (s.most_common_judge_failures.length > 0) {
    console.log('\nTop judge failures:');
    for (const f of s.most_common_judge_failures) console.log(`  ${f}`);
  }
  console.log(`\nAvg narrative words:   ${s.avg_narrative_words_attempt1} (target 200–400)`);
  console.log(`Avg profile words:     ${s.avg_profile_words_attempt1} (target 400–600)`);
  console.log(`\nOutput:                ${outputDir}/`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function run(opts: FetchOptions): Promise<void> {
  const projectId = process.env['VERTEX_AI_PROJECT_ID'] ?? 'pipe-493116';
  const mistralKey = process.env['MISTRAL_API_KEY'];

  if (!mistralKey) {
    logger.warn('[calibrate] MISTRAL_API_KEY not set — judge gate will be skipped');
  }

  const accessToken = await getAccessToken();
  const db = new D1Client(loadD1Config());

  logger.info('[calibrate] Fetching repos from D1...');
  const batch = await fetchBatch(db, opts);
  logger.info(`[calibrate] ${batch.length} repos to calibrate`);

  if (batch.length === 0) {
    console.log('[calibrate] Nothing to calibrate.');
    return;
  }

  const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputDir = resolve(FIXTURES_DIR, runTimestamp);
  await mkdir(outputDir, { recursive: true });

  const records: CalibrationRecord[] = [];
  for (let i = 0; i < batch.length; i++) {
    const input = batch[i] as Pass3Input;
    const record = await calibrateRepo(accessToken, projectId, input, mistralKey, {
      index: i + 1,
      total: batch.length,
    });
    records.push(record);

    // Write per-repo file
    const safeName = input.full_name.replace(/\//g, '__').replace(/[^a-zA-Z0-9_\-]/g, '');
    const filename = `${String(input.repo_id).padStart(5, '0')}-${safeName}.json`;
    await writeFile(resolve(outputDir, filename), JSON.stringify(record, null, 2), 'utf-8');

    logger.info(`[calibrate] ${input.full_name} → ${record.pipeline.final_status}`);
  }

  const summary = buildSummary(records, runTimestamp);
  await writeFile(resolve(outputDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

  printSummary(summary, outputDir);
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): FetchOptions {
  const opts: FetchOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') {
      opts.limit = Number(argv[++i]);
    } else if (a === '--repo-id') {
      opts.repoId = Number(argv[++i]);
    } else if (a === '--only-missing') {
      opts.onlyMissing = true;
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: npx tsx scripts/calibrate-pass3.ts [--limit N] [--repo-id N] [--only-missing]');
      process.exit(0);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
run(opts).catch((err: unknown) => {
  console.error('[calibrate] Fatal:', err);
  process.exit(1);
});
