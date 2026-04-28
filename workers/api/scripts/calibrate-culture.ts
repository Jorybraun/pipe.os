#!/usr/bin/env node
/**
 * Culture Scorer Calibration — CAL-6 (Gemma + Devstral)
 *
 * Port of `calibrate-scorer.ts` for the culture domain. Runs every fixture in
 * workers/api/fixtures/culture-calibration/*.json through the Worker's
 * `POST /internal/calibrate/score` endpoint under each provider override and
 * writes the returned CultureScoreReport to
 *
 *   workers/api/fixtures/culture-calibration-runs/{ISO-timestamp}/{provider}/{fixture}.json
 *
 * Usage:
 *   node_modules/.bin/tsx workers/api/scripts/calibrate-culture.ts
 *   node_modules/.bin/tsx workers/api/scripts/calibrate-culture.ts --only gemma
 *   node_modules/.bin/tsx workers/api/scripts/calibrate-culture.ts --only devstral
 *   node_modules/.bin/tsx workers/api/scripts/calibrate-culture.ts --fixture-ids seed-001,seed-002
 *   node_modules/.bin/tsx workers/api/scripts/calibrate-culture.ts --run-dir 2026-04-11T18-00-00
 *   node_modules/.bin/tsx workers/api/scripts/calibrate-culture.ts --endpoint http://127.0.0.1:8787
 *
 * Required env vars (loaded from workers/api/.dev.vars):
 *   CALIBRATE_TOKEN — Shared secret; must match the value the Worker reads.
 */

import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { CultureScoreReport, OrgCultureBenchmark } from '../src/lib/cultureScorer';
import type { CultureTranscript } from '../src/lib/cultureAgent';
import type { CultureCalibrationFixture, CultureDimensionId } from '../fixtures/culture-calibration/types';
import { updateCultureCalibration, loadCultureRegistry } from '../calibrations';

// ─── CLI args ────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    only:          { type: 'string' },
    'fixture-ids': { type: 'string' },
    'run-dir':     { type: 'string' },
    endpoint:      { type: 'string' },
    help:          { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log(`Usage: tsx workers/api/scripts/calibrate-culture.ts [options]

Prerequisite: run \`wrangler dev\` in another terminal from workers/api/.

Options:
  --only <provider>        Run only one of: gemma, devstral
  --fixture-ids a,b,c      Run only specified fixture IDs (comma-separated)
  --run-dir NAME           Resume an existing run directory instead of creating one
  --endpoint URL           Worker base URL (default: http://127.0.0.1:8787)
  --help                   Show this help
`);
  process.exit(0);
}

type ProviderName = 'gemma' | 'devstral';
const ALL_PROVIDERS: ProviderName[] = ['gemma', 'devstral'];
const REQUESTED_PROVIDERS: ProviderName[] = args.only
  ? [args.only as ProviderName]
  : ALL_PROVIDERS;

for (const p of REQUESTED_PROVIDERS) {
  if (!ALL_PROVIDERS.includes(p)) {
    console.error(`[calibrate-culture] --only must be one of ${ALL_PROVIDERS.join(', ')}, got: ${p}`);
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
const FIXTURES_DIR = path.join(WORKERS_API, 'fixtures/culture-calibration');
const RUNS_ROOT = path.join(WORKERS_API, 'fixtures/culture-calibration-runs');

// ─── Env loading (.dev.vars) ─────────────────────────────────────────────────

function loadDevVars(): Record<string, string> {
  const devVarsPath = path.join(WORKERS_API, '.dev.vars');
  if (!existsSync(devVarsPath)) {
    console.error(`[calibrate-culture] workers/api/.dev.vars not found at ${devVarsPath}`);
    console.error('[calibrate-culture] Copy .dev.vars.example and fill in CALIBRATE_TOKEN.');
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
    console.error(`[calibrate-culture] Missing or unconfigured env var: ${key}`);
    console.error('[calibrate-culture] Fill in workers/api/.dev.vars before running.');
    process.exit(2);
  }
  return v;
}

const CALIBRATE_TOKEN = requireEnv('CALIBRATE_TOKEN');

// ─── Wire provider mapping ───────────────────────────────────────────────────

type WireProvider = 'workers-ai' | 'mistral' | 'google-ai' | 'anthropic' | 'vertex-ai';

interface CultureCalibrateScoreRequest {
  domain: 'culture_interview';
  provider: WireProvider;
  scorerInput: {
    transcript: CultureTranscript;
    orgBenchmark: OrgCultureBenchmark;
    groundTruth?: unknown;
    dispositionalWeights?: Record<string, number>;
    questionBankVersion?: string;
  };
}

interface CultureCalibrateScoreResponse {
  domain: 'culture_interview';
  provider: WireProvider;
  score_report: CultureScoreReport;
}

async function postScore(body: CultureCalibrateScoreRequest): Promise<CultureScoreReport> {
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
    throw new Error(`[calibrate-culture] Worker ${res.status}: ${errText.slice(0, 600)}`);
  }
  const data = (await res.json()) as CultureCalibrateScoreResponse;
  if (!data.score_report) {
    throw new Error(`[calibrate-culture] Worker returned no score_report: ${JSON.stringify(data).slice(0, 400)}`);
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
      console.error(`[calibrate-culture] Pre-flight health check failed: ${res.status} ${body.slice(0, 300)}`);
      if (res.status === 401) {
        console.error('[calibrate-culture] CALIBRATE_TOKEN in .dev.vars does not match the value wrangler dev sees.');
        console.error('[calibrate-culture] Restart `wrangler dev` after editing .dev.vars.');
      } else if (res.status === 503) {
        console.error('[calibrate-culture] CALIBRATE_TOKEN is not set in the Worker env. Add it to workers/api/.dev.vars and restart wrangler dev.');
      }
      process.exit(2);
    }
    const data = (await res.json()) as { status?: string; ai_binding?: boolean; domains?: string[] };
    if (data.status !== 'ok') {
      console.error(`[calibrate-culture] Health check returned non-ok: ${JSON.stringify(data)}`);
      process.exit(2);
    }
    if (!Array.isArray(data.domains) || !data.domains.includes('culture_interview')) {
      console.error('[calibrate-culture] Worker does not report culture_interview domain support.');
      process.exit(2);
    }
    if (REQUESTED_PROVIDERS.includes('gemma') && data.ai_binding !== true) {
      console.error('[calibrate-culture] Worker reports no env.AI binding — gemma provider will fail. Check wrangler.jsonc [ai] block.');
      process.exit(2);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[calibrate-culture] Cannot reach Worker at ${ENDPOINT_BASE}: ${msg}`);
    console.error('[calibrate-culture] Start the Worker with: cd workers/api && npx wrangler dev');
    process.exit(2);
  }
}

// ─── Fixture loading ─────────────────────────────────────────────────────────

function convertToCultureTranscript(simple: CultureCalibrationFixture['transcript']): CultureTranscript {
  const turns: CultureTranscript['turns'] = [];
  let pendingIdx = -1;
  let questionCounter = 0;
  let lastQuestionId: string | null = null;

  for (let i = 0; i < simple.length; i++) {
    const turn = simple[i];
    if (!turn) continue;
    if (turn.speaker === 'agent') {
      // Heuristic: if the next turn is also agent, this is a probe of the same question.
      const nextTurn = simple[i + 1];
      const isProbe = nextTurn != null && nextTurn.speaker === 'agent';
      const questionId: string = (isProbe && lastQuestionId) ? lastQuestionId : `q-${questionCounter++}`;
      pendingIdx = turns.length;
      turns.push({
        idx: turns.length,
        questionId,
        questionText: turn.text,
        probeOf: (isProbe && lastQuestionId) ? lastQuestionId : null,
        candidateResponse: null,
        starSlots: null,
        timestamp: new Date().toISOString(),
      });
      lastQuestionId = questionId;
    } else {
      if (pendingIdx >= 0) {
        const pendingTurn = turns[pendingIdx];
        if (pendingTurn) {
          pendingTurn.candidateResponse = turn.text;
          pendingIdx = -1;
        }
      }
    }
  }

  return {
    turns,
    scratchpad: {
      dimensionCoverage: {
        ownership: 0,
        collaboration: 0,
        'learning-orientation': 0,
        'conflict-handling': 0,
        'self-awareness': 0,
      },
      probesUsedForCurrentQ: 0,
      runningThemes: [],
      mode: 'profile_builder',
      questionMetadata: [],
    },
  };
}

async function loadFixtures(): Promise<CultureCalibrationFixture[]> {
  let files: string[];
  try {
    files = await readdir(FIXTURES_DIR);
  } catch {
    console.warn(`[calibrate-culture] Fixtures directory not found: ${FIXTURES_DIR}`);
    return [];
  }
  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  const fixtures: CultureCalibrationFixture[] = [];
  for (const file of jsonFiles) {
    const raw = await readFile(path.join(FIXTURES_DIR, file), 'utf8');
    const parsed = JSON.parse(raw) as CultureCalibrationFixture;
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
  model: string;
  buildBody: (fixture: CultureCalibrationFixture) => CultureCalibrateScoreRequest;
}

const DEFAULT_ORG_BENCHMARK: OrgCultureBenchmark = {
  autonomy: 3,
  riskTolerance: 3,
  workPace: 3,
  collaborationStyle: 3,
  feedbackOrientation: 3,
};

function buildProviderConfigs(): ProviderConfig[] {
  const configs: ProviderConfig[] = [];

  if (REQUESTED_PROVIDERS.includes('gemma')) {
    configs.push({
      name: 'gemma',
      wireProvider: 'workers-ai',
      model: '@cf/google/gemma-4-26b-a4b-it',
      buildBody: (fixture) => ({
        domain: 'culture_interview',
        provider: 'workers-ai',
        scorerInput: {
          transcript: convertToCultureTranscript(fixture.transcript),
          orgBenchmark: DEFAULT_ORG_BENCHMARK,
          ...(Object.keys(fixture.expectedScores).length > 0 && { groundTruth: fixture.expectedScores }),
          ...(fixture.dispositionalWeights !== undefined && { dispositionalWeights: fixture.dispositionalWeights }),
          ...(fixture.questionBankVersion !== undefined && { questionBankVersion: fixture.questionBankVersion }),
        },
      }),
    });
  }

  if (REQUESTED_PROVIDERS.includes('devstral')) {
    configs.push({
      name: 'devstral',
      wireProvider: 'mistral',
      model: '@cf/mistralai/mistral-small-3.1-24b-instruct',
      buildBody: (fixture) => ({
        domain: 'culture_interview',
        provider: 'mistral',
        scorerInput: {
          transcript: convertToCultureTranscript(fixture.transcript),
          orgBenchmark: DEFAULT_ORG_BENCHMARK,
          ...(Object.keys(fixture.expectedScores).length > 0 && { groundTruth: fixture.expectedScores }),
          ...(fixture.dispositionalWeights !== undefined && { dispositionalWeights: fixture.dispositionalWeights }),
          ...(fixture.questionBankVersion !== undefined && { questionBankVersion: fixture.questionBankVersion }),
        },
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
      console.warn(`[calibrate-culture] ${label} attempt ${attempt} failed (${msg.slice(0, 80)}) — retrying in ${delayMs}ms`);
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
  score_report?: CultureScoreReport;
  meta: {
    wall_clock_ms: number;
    attempts: number;
    status: 'ok' | 'failed';
    error?: string;
  };
}

// ─── Metrics computation ─────────────────────────────────────────────────────

const ALL_DIMENSIONS: CultureDimensionId[] = [
  'ownership',
  'collaboration',
  'learning-orientation',
  'conflict-handling',
  'self-awareness',
  'autonomy',
  'risk-tolerance',
  'work-pace',
  'collaboration-style',
  'feedback-orientation',
];

interface DimensionMetrics {
  qwk: number;
  mae: number;
  count: number;
}

interface CultureMetricsResult {
  perDimension: Record<CultureDimensionId, DimensionMetrics>;
  overallQwk: number;
  overallMae: number;
  icc: number;
  fixtureCount: number;
}

/**
 * Compute Quadratic Weighted Kappa between two arrays of integer ratings.
 * Both arrays must contain values in the range [1, numCategories].
 */
function quadraticWeightedKappa(ratingsA: number[], ratingsB: number[], numCategories = 5): number {
  if (ratingsA.length === 0 || ratingsB.length === 0) return 0;
  if (ratingsA.length !== ratingsB.length) return 0;

  const n = numCategories;
  const N = ratingsA.length;

  const weights: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => Math.pow(i - j, 2) / Math.pow(n - 1, 2)),
  );

  const a0 = ratingsA.map((r) => r - 1);
  const b0 = ratingsB.map((r) => r - 1);

  const confusion: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let k = 0; k < N; k++) {
    const ai = a0[k];
    const bi = b0[k];
    if (ai === undefined || bi === undefined) continue;
    if (ai < 0 || ai >= n || bi < 0 || bi >= n) continue;
    const row = confusion[ai];
    if (row !== undefined) row[bi] = (row[bi] ?? 0) + 1;
  }

  const rowHist = new Array<number>(n).fill(0);
  const colHist = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cell = confusion[i]?.[j] ?? 0;
      rowHist[i] = (rowHist[i] ?? 0) + cell;
      colHist[j] = (colHist[j] ?? 0) + cell;
    }
  }

  const expected: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => ((rowHist[i] ?? 0) * (colHist[j] ?? 0)) / N),
  );

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const w = weights[i]?.[j] ?? 0;
      numerator += w * (confusion[i]?.[j] ?? 0);
      denominator += w * (expected[i]?.[j] ?? 0);
    }
  }

  if (denominator === 0) return 1.0;
  return 1 - numerator / denominator;
}

/**
 * Compute ICC(2,1) — two-way random effects, single measures.
 * Simplified formula for single rater consistency.
 */
function computeICC(observed: number[], expected: number[]): number {
  if (observed.length !== expected.length || observed.length < 2) return 0;

  const n = observed.length;
  const k = 2; // two raters (model vs gold)

  const ratings: number[][] = observed.map((o, i) => [o, expected[i]!]);

  let grandSum = 0;
  for (const row of ratings) {
    grandSum += row[0]! + row[1]!;
  }
  const grandMean = grandSum / (n * k);

  let ssRows = 0;
  for (const row of ratings) {
    const rowMean = (row[0]! + row[1]!) / k;
    ssRows += k * Math.pow(rowMean - grandMean, 2);
  }
  const msRows = ssRows / (n - 1);

  let ssError = 0;
  for (const row of ratings) {
    const rowMean = (row[0]! + row[1]!) / k;
    for (const val of row) {
      ssError += Math.pow(val - rowMean, 2);
    }
  }
  const msError = ssError / (n * (k - 1));

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
    sum += Math.abs(observed[i]! - expected[i]!);
  }
  return sum / observed.length;
}

/**
 * Extract model score for a dimension from a CultureScoreReport.
 */
function getModelScore(report: CultureScoreReport, dim: CultureDimensionId): number | undefined {
  const competency = report.competencyScores.find((s) => s.dimension === dim);
  if (competency) return competency.score;
  const profile = report.profileScores.find((s) => s.dimension === dim);
  if (profile) return profile.candidatePosition;
  return undefined;
}

/**
 * Compute metrics for a provider's calibration run.
 */
function computeMetrics(
  results: FixtureRunResult[],
  fixtures: CultureCalibrationFixture[],
): CultureMetricsResult {
  const fixtureMap = new Map(fixtures.map((f) => [f.id, f]));

  const perDimension: Record<CultureDimensionId, { observed: number[]; expected: number[] }> = {
    ownership: { observed: [], expected: [] },
    collaboration: { observed: [], expected: [] },
    'learning-orientation': { observed: [], expected: [] },
    'conflict-handling': { observed: [], expected: [] },
    'self-awareness': { observed: [], expected: [] },
    autonomy: { observed: [], expected: [] },
    'risk-tolerance': { observed: [], expected: [] },
    'work-pace': { observed: [], expected: [] },
    'collaboration-style': { observed: [], expected: [] },
    'feedback-orientation': { observed: [], expected: [] },
  };

  let successfulFixtures = 0;

  for (const result of results) {
    if (result.meta.status !== 'ok' || !result.score_report) continue;

    const fixture = fixtureMap.get(result.fixture_id);
    if (!fixture) continue;

    successfulFixtures++;

    for (const dim of ALL_DIMENSIONS) {
      const modelScore = getModelScore(result.score_report, dim);
      const range = fixture.expectedScores[dim];
      if (modelScore !== undefined && range != null) {
        // Use midpoint of the expected range for QWK/MAE computation.
        const expectedScore = Math.round((range.min + range.max) / 2);
        perDimension[dim].observed.push(modelScore);
        perDimension[dim].expected.push(expectedScore);
      }
    }
  }

  // Per-dimension metrics
  const perDimensionMetrics: Record<CultureDimensionId, DimensionMetrics> = {
    ownership: { qwk: 0, mae: 0, count: 0 },
    collaboration: { qwk: 0, mae: 0, count: 0 },
    'learning-orientation': { qwk: 0, mae: 0, count: 0 },
    'conflict-handling': { qwk: 0, mae: 0, count: 0 },
    'self-awareness': { qwk: 0, mae: 0, count: 0 },
    autonomy: { qwk: 0, mae: 0, count: 0 },
    'risk-tolerance': { qwk: 0, mae: 0, count: 0 },
    'work-pace': { qwk: 0, mae: 0, count: 0 },
    'collaboration-style': { qwk: 0, mae: 0, count: 0 },
    'feedback-orientation': { qwk: 0, mae: 0, count: 0 },
  };

  const allObserved: number[] = [];
  const allExpected: number[] = [];

  for (const dim of ALL_DIMENSIONS) {
    const { observed, expected } = perDimension[dim];
    const count = observed.length;
    perDimensionMetrics[dim] = {
      qwk: count > 0 ? quadraticWeightedKappa(observed, expected, 5) : 0,
      mae: count > 0 ? computeMAE(observed, expected) : 0,
      count,
    };
    allObserved.push(...observed);
    allExpected.push(...expected);
  }

  return {
    perDimension: perDimensionMetrics,
    overallQwk: allObserved.length > 0 ? quadraticWeightedKappa(allObserved, allExpected, 5) : 0,
    overallMae: allObserved.length > 0 ? computeMAE(allObserved, allExpected) : 0,
    icc: computeICC(allObserved, allExpected),
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
  fixtures: CultureCalibrationFixture[],
  runDir: string,
): Promise<ProviderRunResult> {
  const providerDir = path.join(runDir, config.name);
  await mkdir(providerDir, { recursive: true });

  let ok = 0;
  let failed = 0;
  const results: FixtureRunResult[] = [];

  for (const fixture of fixtures) {
    const outPath = path.join(providerDir, `${fixture.id}.json`);
    console.log(`[calibrate-culture] ${config.name} ← ${fixture.id}`);
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
      const c = outcome.value.competencyScores.map((s) => `${s.dimension}=${s.score}`).join(' ');
      const p = outcome.value.profileScores.map((s) => `${s.dimension}=${s.candidatePosition}`).join(' ');
      console.log(`[calibrate-culture]   ✓ ${wallClockMs}ms  competency: ${c}  profile: ${p}`);
      ok++;
    } else {
      console.error(`[calibrate-culture]   ✗ ${outcome.error.slice(0, 120)}`);
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
    console.log(`[calibrate-culture] No fixtures found in ${FIXTURES_DIR} — running empty state.`);
    console.log('[calibrate-culture] Place JSON fixtures in the directory above to populate the run.');
  }

  const timestamp = args['run-dir'] ?? new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
  const runDir = path.join(RUNS_ROOT, timestamp);
  await mkdir(runDir, { recursive: true });

  console.log(`[calibrate-culture] Endpoint: ${ENDPOINT_BASE}/internal/calibrate/score`);
  console.log(`[calibrate-culture] Run directory: ${path.relative(REPO_ROOT, runDir)}`);
  console.log(`[calibrate-culture] Fixtures: ${fixtures.map((f) => f.id).join(', ') || '(none)'}`);
  console.log(`[calibrate-culture] Providers: ${REQUESTED_PROVIDERS.join(', ')}`);
  console.log('');

  const configs = buildProviderConfigs();

  // Run providers in parallel.
  const providerResults = await Promise.all(
    configs.map((config) => runProviderAgainstFixtures(config, fixtures, runDir)),
  );

  const totalOk = providerResults.reduce((acc, r) => acc + r.ok, 0);
  const totalFailed = providerResults.reduce((acc, r) => acc + r.failed, 0);

  // Compute metrics and update registry for each provider
  console.log('\n[calibrate-culture] Computing metrics and updating registry...\n');

  const metricsMap: Record<string, CultureMetricsResult> = {};
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i]!;
    const result = providerResults[i]!;

    if (result.ok === 0) {
      console.log(`[calibrate-culture] ${config.name}: skipped (no successful runs)`);
      continue;
    }

    const metrics = computeMetrics(result.results, fixtures);
    metricsMap[config.name] = metrics;

    try {
      const updated = updateCultureCalibration(config.name, {
        qwk: metrics.overallQwk,
        icc: metrics.icc,
        mae: metrics.overallMae,
        fixtureCount: metrics.fixtureCount,
        runPath: path.relative(REPO_ROOT, path.join(runDir, config.name)),
      });

      const approvalStatus = updated.approved ? '✓ APPROVED' : '✗ not approved';
      console.log(
        `[calibrate-culture] ${config.name}: QWK=${metrics.overallQwk.toFixed(3)} ICC=${metrics.icc.toFixed(3)} MAE=${metrics.overallMae.toFixed(2)} (${metrics.fixtureCount} fixtures) → ${approvalStatus}`,
      );

      // Per-dimension breakdown
      for (const dim of ALL_DIMENSIONS) {
        const dm = metrics.perDimension[dim];
        if (dm.count > 0) {
          console.log(`[calibrate-culture]   ${dim.padEnd(24)} QWK=${dm.qwk.toFixed(3)} MAE=${dm.mae.toFixed(2)} n=${dm.count}`);
        }
      }
    } catch (err) {
      console.warn(`[calibrate-culture] ${config.name}: registry update failed — ${err instanceof Error ? err.message : err}`);
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
    domain: 'culture_interview',
    fixtures: fixtures.map((f) => ({ id: f.id, tags: f.tags })),
    providers: Object.fromEntries(
      configs.map((c, i) => [
        c.name,
        {
          model: c.model,
          wire_provider: c.wireProvider,
          ok_count: providerResults[i]!.ok,
          failed_count: providerResults[i]!.failed,
          metrics: metricsMap[c.name] ?? null,
        },
      ]),
    ),
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  console.log('');
  console.log(`[calibrate-culture] Complete — ${totalOk} ok, ${totalFailed} failed across ${REQUESTED_PROVIDERS.length} provider(s) × ${fixtures.length} fixture(s).`);
  console.log(`[calibrate-culture] Manifest: ${path.relative(REPO_ROOT, manifestPath)}`);

  // Show updated registry
  console.log('\n[calibrate-culture] Updated registry:');
  const registry = loadCultureRegistry();
  for (const [name, model] of Object.entries(registry.models)) {
    if (REQUESTED_PROVIDERS.includes(name as ProviderName)) {
      const status = model.approved ? '✓' : ' ';
      const qwk = model.qwk !== null ? model.qwk.toFixed(3) : '  -  ';
      console.log(`  ${status} ${name.padEnd(20)} QWK=${qwk}`);
    }
  }

  if (totalFailed > 0) {
    console.error('\n[calibrate-culture] One or more fixtures failed.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[calibrate-culture] Fatal error:', err);
  process.exit(1);
});
