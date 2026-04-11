#!/usr/bin/env node
/**
 * Scorer Calibration — Phase A (Gemma + Devstral only)
 *
 * CAL-2 per knowledge/STRATEGY.md §"Scorer model calibration" and the full
 * runbook at knowledge/calibration/runbook.md. This script runs `scoreReviewSession`
 * against every fixture in workers/api/fixtures/scorer-calibration/*.json under
 * two provider overrides — Gemma on Workers AI (via REST, not a binding) and
 * Devstral on Mistral — and writes the raw results to
 *
 *   workers/api/fixtures/scorer-calibration-runs/{ISO-timestamp}/{provider}/{fixture}.json
 *
 * Phase B (Sonnet via Claude Code subagent) is launched by the /calibrate-scorer
 * skill AFTER this script exits cleanly. This script intentionally does NOT touch
 * Anthropic — routing the expensive half through the Claude Code subscription
 * instead of the API takes per-run cost from ~$5 to ~$0.35.
 *
 * Usage:
 *   tsx workers/api/scripts/calibrate-scorer.ts
 *   tsx workers/api/scripts/calibrate-scorer.ts --only gemma
 *   tsx workers/api/scripts/calibrate-scorer.ts --only devstral
 *   tsx workers/api/scripts/calibrate-scorer.ts --fixture-ids seed-001,seed-002
 *   tsx workers/api/scripts/calibrate-scorer.ts --run-dir 2026-04-11T18-00-00
 *
 * Required env vars (loaded from workers/api/.dev.vars, same names the
 * crawler script uses — see workers/api/scripts/crawl-repos/shared/d1Client.ts):
 *   MISTRAL_API_KEY           — Mistral API key, used for Devstral
 *   CLOUDFLARE_ACCOUNT_ID     — Cloudflare account ID for Workers AI REST
 *   CLOUDFLARE_API_TOKEN      — Cloudflare API token; needs "Workers AI: Read"
 *                               permission (broader scopes work too)
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

import { scoreReviewSession, type ScorerInput, type ScoreReport } from '../src/lib/scorerAgent';
import type { ScorerCalibrationFixture } from '../fixtures/scorer-calibration/types';

// ─── CLI args ────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    only:          { type: 'string' },                     // 'gemma' | 'devstral'
    'fixture-ids': { type: 'string' },                     // comma-separated
    'run-dir':     { type: 'string' },                     // resume an existing run
    help:          { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log(`Usage: tsx workers/api/scripts/calibrate-scorer.ts [options]

Options:
  --only <provider>        Run only one of: gemma, devstral
  --fixture-ids a,b,c      Run only specified fixture IDs (comma-separated)
  --run-dir NAME           Resume an existing run directory instead of creating one
  --help                   Show this help

Phase B (Sonnet subagent) is launched separately by /calibrate-scorer after
this script exits 0.
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
    console.error(`[calibrate] --only must be one of ${ALL_PROVIDERS.join(', ')}, got: ${p}`);
    process.exit(2);
  }
}

const FIXTURE_IDS_FILTER = args['fixture-ids']
  ? new Set(args['fixture-ids'].split(',').map((s) => s.trim()))
  : null;

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
    console.error('[calibrate] Copy .dev.vars.example and fill in MISTRAL_API_KEY, CF_ACCOUNT_ID, CF_AI_TOKEN.');
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

// ─── Fake Ai binding — proxies to Cloudflare AI REST ─────────────────────────
//
// The Worker's scoreReviewSession expects an `Ai` binding whose .run() returns
// either a ReadableStream or { response: string }. We construct a minimal shim
// that calls the public Cloudflare AI REST endpoint directly, matching the
// shape that scorerAgent.callWorkersAI consumes.
//
// Reference: https://developers.cloudflare.com/workers-ai/get-started/rest-api/
// POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}
// Response shape: { result: { response: string }, success: true, errors: [] }

interface CfAiResponse {
  result?: { response?: string };
  success?: boolean;
  errors?: unknown[];
}

function makeCloudflareAiShim(accountId: string, apiToken: string): Ai {
  const shim = {
    run: async (
      model: string,
      input: { messages: Array<{ role: string; content: string }>; max_tokens?: number },
    ): Promise<{ response: string }> => {
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`[calibrate] Cloudflare AI ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as CfAiResponse;
      if (data.success === false || !data.result?.response) {
        throw new Error(`[calibrate] Cloudflare AI non-success: ${JSON.stringify(data.errors ?? data).slice(0, 200)}`);
      }
      return { response: data.result.response };
    },
  };
  // The `Ai` interface has other methods we don't use (gateway, etc). Cast
  // through unknown — the shim only needs to satisfy the callsite in
  // scorerAgent.callWorkersAI which only ever calls .run().
  return shim as unknown as Ai;
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
  model: string;
  buildInput: (fixture: ScorerCalibrationFixture) => ScorerInput;
}

function buildProviderConfigs(): ProviderConfig[] {
  const configs: ProviderConfig[] = [];

  if (REQUESTED_PROVIDERS.includes('gemma')) {
    const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID');
    const apiToken = requireEnv('CLOUDFLARE_API_TOKEN');
    const aiShim = makeCloudflareAiShim(accountId, apiToken);
    configs.push({
      name: 'gemma',
      model: '@cf/google/gemma-4-26b-a4b-it',
      buildInput: (fixture) => ({
        apiKey: '',
        provider: 'workers-ai',
        ai: aiShim,
        transcript: fixture.transcript,
        groundTruth: fixture.groundTruth,
        diff: fixture.prContext.diff,
        prTitle: fixture.prContext.title,
        prDescription: fixture.prContext.description,
        instructions: fixture.prContext.instructions,
        level: fixture.seniority === 'senior' ? 'senior' : fixture.seniority === 'junior' ? 'junior' : 'mid',
      }),
    });
  }

  if (REQUESTED_PROVIDERS.includes('devstral')) {
    const mistralKey = requireEnv('MISTRAL_API_KEY');
    configs.push({
      name: 'devstral',
      model: 'devstral-latest',
      buildInput: (fixture) => ({
        apiKey: mistralKey,
        provider: 'mistral',
        transcript: fixture.transcript,
        groundTruth: fixture.groundTruth,
        diff: fixture.prContext.diff,
        prTitle: fixture.prContext.title,
        prDescription: fixture.prContext.description,
        instructions: fixture.prContext.instructions,
        level: fixture.seniority === 'senior' ? 'senior' : fixture.seniority === 'junior' ? 'junior' : 'mid',
      }),
    });
  }

  return configs;
}

// ─── Retry wrapper ───────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 3,
): Promise<{ ok: true; value: T; attempts: number } | { ok: false; error: string; attempts: number }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await fn();
      return { ok: true, value, attempts: attempt };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = /429|5\d\d|timeout|ECONNRESET|rate/i.test(msg);
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

async function runProviderAgainstFixtures(
  config: ProviderConfig,
  fixtures: ScorerCalibrationFixture[],
  runDir: string,
): Promise<{ ok: number; failed: number }> {
  const providerDir = path.join(runDir, config.name);
  await mkdir(providerDir, { recursive: true });

  let ok = 0;
  let failed = 0;

  for (const fixture of fixtures) {
    const outPath = path.join(providerDir, `${fixture.id}.json`);
    console.log(`[calibrate] ${config.name} ← ${fixture.id}`);
    const start = Date.now();
    const outcome = await withRetry(
      () => scoreReviewSession(config.buildInput(fixture)),
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

  return { ok, failed };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
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

  console.log(`[calibrate] Run directory: ${path.relative(REPO_ROOT, runDir)}`);
  console.log(`[calibrate] Fixtures: ${fixtures.map((f) => f.id).join(', ')}`);
  console.log(`[calibrate] Providers: ${REQUESTED_PROVIDERS.join(', ')}`);
  console.log('');

  const configs = buildProviderConfigs();

  // Run providers in parallel — independent rate limits + independent APIs
  const results = await Promise.all(
    configs.map((config) => runProviderAgainstFixtures(config, fixtures, runDir)),
  );

  const totalOk = results.reduce((acc, r) => acc + r.ok, 0);
  const totalFailed = results.reduce((acc, r) => acc + r.failed, 0);

  // Write / update manifest — Phase B (the /calibrate-scorer skill's Sonnet
  // subagent) reads this to know which fixtures to score and writes its own
  // block under meta.phase_b after completion.
  const manifestPath = path.join(runDir, 'manifest.json');
  const existingManifest = existsSync(manifestPath)
    ? JSON.parse(await readFile(manifestPath, 'utf8'))
    : {};
  const manifest = {
    ...existingManifest,
    run_dir: path.relative(REPO_ROOT, runDir),
    started_at: existingManifest.started_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
    fixtures: fixtures.map((f) => ({ id: f.id, seniority: f.seniority, tags: f.tags })),
    phase_a: {
      providers: REQUESTED_PROVIDERS,
      ok_count: totalOk,
      failed_count: totalFailed,
      models: Object.fromEntries(configs.map((c) => [c.name, c.model])),
    },
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  console.log('');
  console.log(`[calibrate] Phase A complete — ${totalOk} ok, ${totalFailed} failed across ${REQUESTED_PROVIDERS.length} provider(s) × ${fixtures.length} fixture(s).`);
  console.log(`[calibrate] Manifest: ${path.relative(REPO_ROOT, manifestPath)}`);

  if (totalFailed > 0) {
    console.error('[calibrate] One or more fixtures failed. Phase B skill should check status before proceeding.');
    process.exit(1);
  }

  console.log('[calibrate] Ready for Phase B — /calibrate-scorer will now launch the Sonnet subagent.');
}

main().catch((err) => {
  console.error('[calibrate] Fatal:', err);
  process.exit(1);
});
