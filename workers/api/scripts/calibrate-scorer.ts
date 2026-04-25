#!/usr/bin/env node
/**
 * Scorer Calibration — Phase A (Gemma + Devstral only)
 *
 * CAL-2 per knowledge/STRATEGY.md §"Scorer model calibration" and the full
 * runbook at knowledge/calibration/runbook.md. This script runs every fixture
 * in workers/api/fixtures/scorer-calibration/*.json through the Worker's
 * `POST /internal/calibrate/score` endpoint under each provider override and
 * writes the returned ScoreReport to
 *
 *   workers/api/fixtures/scorer-calibration-runs/{ISO-timestamp}/{provider}/{fixture}.json
 *
 * Prerequisite: `wrangler dev` must be running in another terminal. The
 * endpoint lives inside the Worker so `env.AI` uses Cloudflare's internal
 * binding — not the public REST API. The REST path used to hit "AiError: Max
 * retries exhausted" 503s on Gemma 4 26B ~50% of the time; the binding path
 * does not.
 *
 * Phase B (Sonnet via Claude Code subagent) is launched by the /calibrate-scorer
 * skill AFTER this script exits cleanly. This script intentionally does NOT touch
 * Anthropic — routing the expensive half through the Claude Code subscription
 * instead of the API takes per-run cost from ~$5 to ~$0.35.
 *
 * Usage:
 *   node_modules/.bin/tsx workers/api/scripts/calibrate-scorer.ts
 *   node_modules/.bin/tsx workers/api/scripts/calibrate-scorer.ts --only gemma
 *   node_modules/.bin/tsx workers/api/scripts/calibrate-scorer.ts --only devstral
 *   node_modules/.bin/tsx workers/api/scripts/calibrate-scorer.ts --fixture-ids seed-001,seed-002
 *   node_modules/.bin/tsx workers/api/scripts/calibrate-scorer.ts --run-dir 2026-04-11T18-00-00
 *   node_modules/.bin/tsx workers/api/scripts/calibrate-scorer.ts --endpoint http://127.0.0.1:8787
 *
 * Required env vars (loaded from workers/api/.dev.vars):
 *   CALIBRATE_TOKEN           — Shared secret; must match the value the Worker
 *                               reads from the same .dev.vars file.
 *
 * Re-run behavior:
 *   - Each invocation without --run-dir creates a new timestamped directory.
 *   - --run-dir <name> resumes an existing run (writes into the same directory).
 *   - --only <provider> skips the other provider, preserving any existing results.
 *   - Every fixture result is written to disk immediately after it completes,
 *     so a crash mid-run does not lose prior work.
 */

import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { ScoreReport } from '../src/lib/scorerAgent';
import type { ScorerCalibrationFixture, DimensionId } from '../fixtures/scorer-calibration/types';
import { updateCalibration, loadRegistry } from '../calibrations';

// ─── CLI args ────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    only:          { type: 'string' },                     // 'gemma' | 'devstral'
    'fixture-ids': { type: 'string' },                     // comma-separated
    'run-dir':     { type: 'string' },                     // resume an existing run
    endpoint:      { type: 'string' },                     // override Worker base URL
    help:          { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log(`Usage: tsx workers/api/scripts/calibrate-scorer.ts [options]

Prerequisite: run \`wrangler dev\` in another terminal from workers/api/.

Options:
  --only <provider>        Run only one of: gemma, devstral, gemini
  --fixture-ids a,b,c      Run only specified fixture IDs (comma-separated)
  --run-dir NAME           Resume an existing run directory instead of creating one
  --endpoint URL           Worker base URL (default: http://127.0.0.1:8787)
  --help                   Show this help

Phase B (Sonnet subagent) is launched separately by /calibrate-scorer after
this script exits 0.
`);
  process.exit(0);
}

type ProviderName = 'gemma' | 'devstral' | 'gemini';
const ALL_PROVIDERS: ProviderName[] = ['gemma', 'devstral', 'gemini'];
const REQUESTED_PROVIDERS: ProviderName[] = args.only
  ? [args.only as ProviderName]
  : ALL_PROVIDERS;

for (const p of REQUESTED_PROVIDERS) {
  if (!ALL_PROVIDERS.includes(p)) {
    console.error(`[calibrate] --only must be one of ${ALL_PROVIDERS.join(', ')}, got: ${p}`);
    process.exit(2);
  }
}

const FIXTURE_IDS_FILTER = args['fixture-ids']
  ? new Set(args['fixture-ids'].split(',').map((s) => s.trim()))
  : null;

const ENDPOINT_BASE = (args.endpoint ?? 'http://127.0.0.1:8787').replace(/\/$/, '');

// ─── Paths ───────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '../../..');
const WORKERS_API = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(WORKERS_API, 'fixtures/scorer-calibration');
const RUNS_ROOT = path.join(WORKERS_API, 'fixtures/scorer-calibration-runs');

// ─── Env loading (.dev.vars) ─────────────────────────────────────────────────

function loadDevVars(): Record<string, string> {
  const devVarsPath = path.join(WORKERS_API, '.dev.vars');
  if (!existsSync(devVarsPath)) {
    console.error(`[calibrate] workers/api/.dev.vars not found at ${devVarsPath}`);
    console.error('[calibrate] Copy .dev.vars.example and fill in CALIBRATE_TOKEN.');
    process.exit(2);
  }
  const raw = readFileSync(devVarsPath, 'utf8');
  const env: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^"(.*)"$/, '$1');
    env[key] = value;
  }
  return env;
}

const ENV = loadDevVars();

function requireEnv(key: string): string {
  const v = ENV[key];
  if (!v || v.length === 0 || v.includes('your_') || v.includes('_here')) {
    console.error(`[calibrate] Missing or unconfigured env var: ${key}`);
    console.error('[calibrate] Fill in workers/api/.dev.vars before running.');
    process.exit(2);
  }
  return v;
}

const CALIBRATE_TOKEN = requireEnv('CALIBRATE_TOKEN');

// ─── Worker endpoint client ──────────────────────────────────────────────────

type WireProvider = 'workers-ai' | 'mistral' | 'google-ai' | 'anthropic' | 'vertex-ai';

interface CalibrateScoreRequest {
  domain: 'code_review';
  provider: WireProvider;
  scorerInput: {
    transcript: unknown;
    groundTruth: unknown;
    diff?: string | null;
    prTitle?: string | null;
    prDescription?: string | null;
    instructions?: string | null;
    level?: 'junior' | 'mid' | 'senior';
  };
}

interface CalibrateScoreResponse {
  domain: 'code_review';
  provider: WireProvider;
  score_report: ScoreReport;
}

async function postScore(body: CalibrateScoreRequest): Promise<ScoreReport> {
  const url = `${ENDPOINT_BASE}/internal/calibrate/score`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Calibrate-Token': CALIBRATE_TOKEN,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[calibrate] Worker ${res.status}: ${errText.slice(0, 600)}`);
  }
  const data = (await res.json()) as CalibrateScoreResponse;
  if (!data.score_report) {
    throw new Error(`[calibrate] Worker returned no score_report: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return data.score_report;
}

async function preflightHealth(): Promise<void> {
  const url = `${ENDPOINT_BASE}/internal/calibrate/health`;
  try {
    const res = await fetch(url, {
      headers: { 'X-Calibrate-Token': CALIBRATE_TOKEN },
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[calibrate] Pre-flight health check failed: ${res.status} ${body.slice(0, 300)}`);
      if (res.status === 401) {
        console.error('[calibrate] CALIBRATE_TOKEN in .dev.vars does not match the value wrangler dev sees.');
        console.error('[calibrate] Restart `wrangler dev` after editing .dev.vars.');
      } else if (res.status === 503) {
        console.error('[calibrate] CALIBRATE_TOKEN is not set in the Worker env. Add it to workers/api/.dev.vars and restart wrangler dev.');
      }
      process.exit(2);
    }
    const data = (await res.json()) as { status?: string; ai_binding?: boolean };
    if (data.status !== 'ok') {
      console.error(`[calibrate] Health check returned non-ok: ${JSON.stringify(data)}`);
      process.exit(2);
    }
    if (REQUESTED_PROVIDERS.includes('gemma') && data.ai_binding !== true) {
      console.error('[calibrate] Worker reports no env.AI binding — gemma provider will fail. Check wrangler.jsonc [ai] block.');
      process.exit(2);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[calibrate] Cannot reach Worker at ${ENDPOINT_BASE}: ${msg}`);
    console.error('[calibrate] Start the Worker with: cd workers/api && npx wrangler dev');
    process.exit(2);
  }
}

// ─── Fixture loading ─────────────────────────────────────────────────────────

async function loadFixtures(): Promise<ScorerCalibrationFixture[]> {
  const files = await readdir(FIXTURES_DIR);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  const fixtures: ScorerCalibrationFixture[] = [];
  for (const file of jsonFiles) {
    const raw = await readFile(path.join(FIXTURES_DIR, file), 'utf8');
    const parsed = JSON.parse(raw) as ScorerCalibrationFixture;
    if (FIXTURE_IDS_FILTER && !FIXTURE_IDS_FILTER.has(parsed.id)) continue;
    fixtures.push(parsed);
  }
  fixtures.sort((a, b) => a.id.localeCompare(b.id));
  return fixtures;
}

// ─── Per-provider scoring ────────────────────────────────────────────────────

interface ProviderConfig {
  name: ProviderName;
  wireProvider: WireProvider;
  /** Informational — the script does not pick the model; the Worker does. */
  model: string;
  buildBody: (fixture: ScorerCalibrationFixture) => CalibrateScoreRequest;
}

function buildProviderConfigs(): ProviderConfig[] {
  const configs: ProviderConfig[] = [];

  const buildScorerInput = (fixture: ScorerCalibrationFixture): CalibrateScoreRequest['scorerInput'] => ({
    transcript: fixture.transcript,
    groundTruth: fixture.groundTruth,
    diff: fixture.prContext.diff,
    prTitle: fixture.prContext.title,
    prDescription: fixture.prContext.description,
    instructions: fixture.prContext.instructions,
    level: fixture.seniority === 'senior' ? 'senior' : fixture.seniority === 'junior' ? 'junior' : 'mid',
  });

  if (REQUESTED_PROVIDERS.includes('gemma')) {
    configs.push({
      name: 'gemma',
      wireProvider: 'workers-ai',
      model: '@cf/google/gemma-4-26b-a4b-it',
      buildBody: (fixture) => ({
        domain: 'code_review',
        provider: 'workers-ai',
        scorerInput: buildScorerInput(fixture),
      }),
    });
  }

  if (REQUESTED_PROVIDERS.includes('devstral')) {
    configs.push({
      name: 'devstral',
      wireProvider: 'mistral',
      model: 'devstral-latest',
      buildBody: (fixture) => ({
        domain: 'code_review',
        provider: 'mistral',
        scorerInput: buildScorerInput(fixture),
      }),
    });
  }

  if (REQUESTED_PROVIDERS.includes('gemini')) {
    configs.push({
      name: 'gemini',
      wireProvider: 'google-ai',
      model: 'gemma-3-27b-it',
      buildBody: (fixture) => ({
        domain: 'code_review',
        provider: 'google-ai',
        scorerInput: buildScorerInput(fixture),
      }),
    });
  }

  return configs;
}

// ─── Retry wrapper ───────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 5,
): Promise<{ ok: true; value: T; attempts: number } | { ok: false; error: string; attempts: number }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await fn();
      return { ok: true, value, attempts: attempt };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = /429|5\d\d|timeout|ECONNRESET|AiError|Max retries/i.test(msg);
      if (!retryable || attempt === maxAttempts) {
        return { ok: false, error: msg, attempts: attempt };
      }
      const delayMs = 1000 * Math.pow(2, attempt - 1);
      console.warn(`[calibrate] ${label} attempt ${attempt} failed (${msg.slice(0, 80)}) — retrying in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return { ok: false, error: String(lastErr), attempts: maxAttempts };
}

// ─── Result shape written to disk ────────────────────────────────────────────

interface FixtureRunResult {
  fixture_id: string;
  provider: ProviderName;
  model: string;
  score_report?: ScoreReport;
  meta: {
    wall_clock_ms: number;
    attempts: number;
    status: 'ok' | 'failed';
    error?: string;
  };
}

// ─── Metrics computation ─────────────────────────────────────────────────────

const ALL_DIMENSIONS: DimensionId[] = [
  'issue_identification',
  'prioritization',
  'revision_evaluation',
  'reasoning_quality',
  'question_formation',
  'ai_direction',
];

interface MetricsResult {
  kappa: number;
  icc: number;
  mae: number;
  fixtureCount: number;
}

/**
 * Compute Cohen's weighted kappa for ordinal ratings (1-5 scale).
 * Uses linear weights: w(i,j) = 1 - |i-j| / (k-1) where k=5.
 */
function computeWeightedKappa(observed: number[], expected: number[]): number {
  if (observed.length !== expected.length || observed.length === 0) return 0;

  const n = observed.length;
  const k = 5; // rating scale

  // Build confusion matrix
  const matrix: number[][] = Array(k).fill(null).map(() => Array(k).fill(0));
  for (let i = 0; i < n; i++) {
    const o = Math.round(observed[i]) - 1; // 0-indexed
    const e = Math.round(expected[i]) - 1;
    if (o >= 0 && o < k && e >= 0 && e < k) {
      matrix[o][e]++;
    }
  }

  // Row and column totals
  const rowTotals = matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const colTotals = Array(k).fill(0);
  for (let j = 0; j < k; j++) {
    for (let i = 0; i < k; i++) {
      colTotals[j] += matrix[i][j];
    }
  }

  // Linear weights
  const weights: number[][] = Array(k).fill(null).map((_, i) =>
    Array(k).fill(null).map((__, j) => 1 - Math.abs(i - j) / (k - 1))
  );

  // Observed agreement (weighted)
  let po = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      po += weights[i][j] * matrix[i][j] / n;
    }
  }

  // Expected agreement (weighted)
  let pe = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      pe += weights[i][j] * (rowTotals[i] / n) * (colTotals[j] / n);
    }
  }

  if (pe === 1) return 1; // Perfect agreement expected
  return (po - pe) / (1 - pe);
}

/**
 * Compute ICC(2,1) — two-way random effects, single measures.
 * Simplified formula for single rater consistency.
 */
function computeICC(observed: number[], expected: number[]): number {
  if (observed.length !== expected.length || observed.length < 2) return 0;

  const n = observed.length;
  const k = 2; // two raters (model vs gold)

  // Combine into matrix
  const ratings: number[][] = observed.map((o, i) => [o, expected[i]]);

  // Grand mean
  let grandSum = 0;
  for (const row of ratings) {
    grandSum += row[0] + row[1];
  }
  const grandMean = grandSum / (n * k);

  // Between-subjects variance (MSR)
  let ssRows = 0;
  for (const row of ratings) {
    const rowMean = (row[0] + row[1]) / k;
    ssRows += k * Math.pow(rowMean - grandMean, 2);
  }
  const msRows = ssRows / (n - 1);

  // Within-subjects variance (MSE)
  let ssError = 0;
  for (const row of ratings) {
    const rowMean = (row[0] + row[1]) / k;
    for (const val of row) {
      ssError += Math.pow(val - rowMean, 2);
    }
  }
  const msError = ssError / (n * (k - 1));

  // ICC(2,1)
  if (msRows + msError === 0) return 1;
  return (msRows - msError) / (msRows + (k - 1) * msError);
}

/**
 * Compute Mean Absolute Error between observed and expected scores.
 */
function computeMAE(observed: number[], expected: number[]): number {
  if (observed.length !== expected.length || observed.length === 0) return 0;

  let sum = 0;
  for (let i = 0; i < observed.length; i++) {
    sum += Math.abs(observed[i] - expected[i]);
  }
  return sum / observed.length;
}

/**
 * Compute metrics for a provider's calibration run.
 */
function computeMetrics(
  results: FixtureRunResult[],
  fixtures: ScorerCalibrationFixture[],
): MetricsResult {
  const fixtureMap = new Map(fixtures.map((f) => [f.id, f]));

  const observed: number[] = [];
  const expected: number[] = [];

  for (const result of results) {
    if (result.meta.status !== 'ok' || !result.score_report) continue;

    const fixture = fixtureMap.get(result.fixture_id);
    if (!fixture) continue;

    // Collect all dimension scores
    for (const dim of ALL_DIMENSIONS) {
      const modelScore = result.score_report.dimensions[dim];
      const expectedBand = fixture.expectedBands[dim];
      // Use midpoint of expected range as gold standard
      const goldScore = (expectedBand.min + expectedBand.max) / 2;

      observed.push(modelScore);
      expected.push(goldScore);
    }
  }

  const successfulFixtures = results.filter((r) => r.meta.status === 'ok').length;

  return {
    kappa: computeWeightedKappa(observed, expected),
    icc: computeICC(observed, expected),
    mae: computeMAE(observed, expected),
    fixtureCount: successfulFixtures,
  };
}

interface ProviderRunResult {
  ok: number;
  failed: number;
  results: FixtureRunResult[];
}

async function runProviderAgainstFixtures(
  config: ProviderConfig,
  fixtures: ScorerCalibrationFixture[],
  runDir: string,
): Promise<ProviderRunResult> {
  const providerDir = path.join(runDir, config.name);
  await mkdir(providerDir, { recursive: true });

  let ok = 0;
  let failed = 0;
  const results: FixtureRunResult[] = [];

  for (const fixture of fixtures) {
    const outPath = path.join(providerDir, `${fixture.id}.json`);
    console.log(`[calibrate] ${config.name} ← ${fixture.id}`);
    const start = Date.now();
    const outcome = await withRetry(
      () => postScore(config.buildBody(fixture)),
      `${config.name}/${fixture.id}`,
    );
    const wallClockMs = Date.now() - start;

    const result: FixtureRunResult = outcome.ok
      ? {
          fixture_id: fixture.id,
          provider: config.name,
          model: config.model,
          score_report: outcome.value,
          meta: { wall_clock_ms: wallClockMs, attempts: outcome.attempts, status: 'ok' },
        }
      : {
          fixture_id: fixture.id,
          provider: config.name,
          model: config.model,
          meta: {
            wall_clock_ms: wallClockMs,
            attempts: outcome.attempts,
            status: 'failed',
            error: outcome.error,
          },
        };

    results.push(result);
    await writeFile(outPath, JSON.stringify(result, null, 2));

    if (outcome.ok) {
      const d = outcome.value.dimensions;
      console.log(
        `[calibrate]   ✓ ${wallClockMs}ms  bands: ii=${d.issue_identification} pri=${d.prioritization} rev=${d.revision_evaluation} rq=${d.reasoning_quality} qf=${d.question_formation} aid=${d.ai_direction}`,
      );
      ok++;
    } else {
      console.error(`[calibrate]   ✗ ${outcome.error.slice(0, 120)}`);
      failed++;
    }
  }

  return { ok, failed, results };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await preflightHealth();

  const fixtures = await loadFixtures();
  if (fixtures.length === 0) {
    console.error(`[calibrate] No fixtures found in ${FIXTURES_DIR}`);
    if (FIXTURE_IDS_FILTER) {
      console.error(`[calibrate] Filter was: ${[...FIXTURE_IDS_FILTER].join(', ')}`);
    }
    process.exit(2);
  }

  const timestamp = args['run-dir'] ?? new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
  const runDir = path.join(RUNS_ROOT, timestamp);
  await mkdir(runDir, { recursive: true });

  console.log(`[calibrate] Endpoint: ${ENDPOINT_BASE}/internal/calibrate/score`);
  console.log(`[calibrate] Run directory: ${path.relative(REPO_ROOT, runDir)}`);
  console.log(`[calibrate] Fixtures: ${fixtures.map((f) => f.id).join(', ')}`);
  console.log(`[calibrate] Providers: ${REQUESTED_PROVIDERS.join(', ')}`);
  console.log('');

  const configs = buildProviderConfigs();

  // Run providers in parallel — independent rate limits + independent APIs.
  // The shared-state race in scorerAgent._ai was fixed on 2026-04-11 when `ai`
  // became a callLLM parameter, and now that scoring runs inside the Worker
  // (one ScorerInput per request, no module-level state), parallelism is safe.
  const providerResults = await Promise.all(
    configs.map((config) => runProviderAgainstFixtures(config, fixtures, runDir)),
  );

  const totalOk = providerResults.reduce((acc, r) => acc + r.ok, 0);
  const totalFailed = providerResults.reduce((acc, r) => acc + r.failed, 0);

  // Compute metrics and update registry for each provider
  console.log('\n[calibrate] Computing metrics and updating registry...\n');

  const metricsMap: Record<string, MetricsResult> = {};
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    const result = providerResults[i];

    if (result.ok === 0) {
      console.log(`[calibrate] ${config.name}: skipped (no successful runs)`);
      continue;
    }

    const metrics = computeMetrics(result.results, fixtures);
    metricsMap[config.name] = metrics;

    // Update registry
    try {
      const updated = updateCalibration(config.name, {
        kappa: metrics.kappa,
        icc: metrics.icc,
        mae: metrics.mae,
        fixtureCount: metrics.fixtureCount,
        runPath: path.relative(REPO_ROOT, path.join(runDir, config.name)),
      });

      const approvalStatus = updated.approved ? '✓ APPROVED' : '✗ not approved';
      console.log(
        `[calibrate] ${config.name}: κ=${metrics.kappa.toFixed(3)} ICC=${metrics.icc.toFixed(3)} MAE=${metrics.mae.toFixed(2)} (${metrics.fixtureCount} fixtures) → ${approvalStatus}`,
      );
    } catch (err) {
      console.warn(`[calibrate] ${config.name}: registry update failed — ${err instanceof Error ? err.message : err}`);
    }
  }

  const manifestPath = path.join(runDir, 'manifest.json');
  const existingManifest = existsSync(manifestPath)
    ? JSON.parse(await readFile(manifestPath, 'utf8'))
    : {};
  const manifest = {
    ...existingManifest,
    run_dir: path.relative(REPO_ROOT, runDir),
    started_at: existingManifest.started_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
    endpoint: `${ENDPOINT_BASE}/internal/calibrate/score`,
    fixtures: fixtures.map((f) => ({ id: f.id, seniority: f.seniority, tags: f.tags })),
    phase_a: {
      providers: REQUESTED_PROVIDERS,
      ok_count: totalOk,
      failed_count: totalFailed,
      models: Object.fromEntries(configs.map((c) => [c.name, c.model])),
      metrics: metricsMap,
    },
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  console.log('');
  console.log(`[calibrate] Phase A complete — ${totalOk} ok, ${totalFailed} failed across ${REQUESTED_PROVIDERS.length} provider(s) × ${fixtures.length} fixture(s).`);
  console.log(`[calibrate] Manifest: ${path.relative(REPO_ROOT, manifestPath)}`);

  // Show updated registry
  console.log('\n[calibrate] Updated registry:');
  const registry = loadRegistry();
  for (const [name, model] of Object.entries(registry.models)) {
    if (REQUESTED_PROVIDERS.includes(name as ProviderName)) {
      const status = model.approved ? '✓' : ' ';
      const kappa = model.kappa !== null ? model.kappa.toFixed(3) : '  -  ';
      console.log(`  ${status} ${name.padEnd(20)} κ=${kappa}`);
    }
  }

  if (totalFailed > 0) {
    console.error('\n[calibrate] One or more fixtures failed. Phase B skill should check status before proceeding.');
    process.exit(1);
  }

  console.log('\n[calibrate] Ready for Phase B — /calibrate-scorer will now launch the Sonnet subagent.');
}

main().catch((err) => {
  console.error('[calibrate] Fatal error:', err);
  process.exit(1);
});
