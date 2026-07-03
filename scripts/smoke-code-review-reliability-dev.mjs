import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const DEFAULT_CHILD_TIMEOUT_MS = 900_000;
const DEFAULT_OUT_DIR = 'tmp/code-review-reliability';
const DEFAULT_DEV_D1_DATABASE_ID = '0abe92df-9296-46f5-9f9d-a1fb1bcd3be1';
const DEFAULT_LANE_IDS = [
  'blocked-handoff',
  'role-backed-full-submit',
  'workers-sdk-matrix',
  'match-quality-readiness',
];

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseJsonObjectAt(clean, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < clean.length; index += 1) {
    const char = clean[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(clean.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

export function extractLastJsonObject(text, accepts = () => true) {
  const clean = stripAnsi(text);
  for (
    let start = clean.lastIndexOf('{');
    start >= 0;
    start = clean.lastIndexOf('{', start - 1)
  ) {
    const parsed = parseJsonObjectAt(clean, start);
    if (
      parsed
      && typeof parsed === 'object'
      && !Array.isArray(parsed)
      && accepts(parsed)
    ) {
      return parsed;
    }
  }
  return null;
}

export function extractMatrixSummary(text) {
  const marker = '===== CODE_REVIEW app-dev profile matrix summary =====';
  const clean = stripAnsi(text);
  const markerIndex = clean.lastIndexOf(marker);
  if (markerIndex < 0) return extractLastJsonObject(clean);
  const source = clean.slice(markerIndex + marker.length);
  const start = source.indexOf('{');
  return start >= 0 ? parseJsonObjectAt(source, start) : null;
}

export function resolveAppDevDatabaseId({
  env = process.env,
  wranglerConfigPath = 'workers/api/wrangler.jsonc',
  readFile = readFileSync,
} = {}) {
  const explicit = env.CODE_REVIEW_RELIABILITY_D1_DATABASE_ID
    || env.MATCHING_EVALUATION_D1_DATABASE_ID
    || env.CODE_REVIEW_EXPERT_SEED_D1_DATABASE_ID;
  if (explicit) return explicit;

  try {
    const text = readFile(wranglerConfigPath, 'utf8');
    const devDbMatch = text.match(
      /"database_name"\s*:\s*"pipe-db-test"[\s\S]{0,160}?"database_id"\s*:\s*"([^"]+)"/,
    );
    if (devDbMatch?.[1]) return devDbMatch[1];
  } catch {
    // Fall through to the known app-dev D1 id used by api-dev.hire-pipe.com.
  }

  return DEFAULT_DEV_D1_DATABASE_ID;
}

export function selectedLaneIds(env = process.env) {
  const raw = env.CODE_REVIEW_RELIABILITY_LANES ?? '';
  if (!raw.trim()) return DEFAULT_LANE_IDS;
  return raw
    .split(',')
    .map((lane) => lane.trim())
    .filter(Boolean);
}

export function buildReliabilityLanes({
  env = process.env,
  databaseId = resolveAppDevDatabaseId({ env }),
} = {}) {
  const laneMap = new Map([
    [
      'blocked-handoff',
      {
        id: 'blocked-handoff',
        label: 'Candidate-safe blocked /assess handoff',
        command: ['npm', 'run', 'smoke:code-review-assess-dev:blocked'],
        parser: 'assess-smoke',
      },
    ],
    [
      'role-backed-full-submit',
      {
        id: 'role-backed-full-submit',
        label: 'Role-backed auto-match full submit and scoring',
        command: ['npm', 'run', 'smoke:code-review-assess-dev:role-backed-full-submit'],
        parser: 'assess-smoke',
      },
    ],
    [
      'workers-sdk-matrix',
      {
        id: 'workers-sdk-matrix',
        label: 'Non-MUI Workers SDK automatic matching breadth',
        command: ['npm', 'run', 'smoke:code-review-assess-dev:workers-matrix'],
        parser: 'matrix',
      },
    ],
    [
      'match-quality-readiness',
      {
        id: 'match-quality-readiness',
        label: 'Latest expert-labelled match-quality readiness gate',
        command: [
          'npm',
          '--prefix',
          'workers/api',
          'run',
          'living-context:match-quality:readiness',
          '--',
          '--database-id',
          databaseId,
        ],
        parser: 'match-quality',
      },
    ],
  ]);

  return selectedLaneIds(env).map((id) => {
    const lane = laneMap.get(id);
    if (!lane) {
      throw new Error(
        `Unknown CODE_REVIEW reliability lane ${JSON.stringify(id)}. Known lanes: ${[...laneMap.keys()].join(', ')}`,
      );
    }
    return lane;
  });
}

function summarizeAssessSmoke(proof) {
  return {
    ok: proof?.ok === true,
    interviewId: proof?.interviewId ?? null,
    matchMode: proof?.matchMode ?? null,
    repoUrl: proof?.repoUrl ?? null,
    prNumber: proof?.prNumber ?? null,
    matchStatus: proof?.matchStatus ?? null,
    qualityGate: proof?.qualityGate ?? null,
    assessmentQuality: proof?.assessmentQuality ?? null,
    candidateHandoffType: proof?.candidateHandoff?.type ?? null,
    candidateHandoffStageId: proof?.candidateHandoff?.stageId ?? null,
    reviewSessionId: proof?.submissionSmoke?.reviewSessionId ?? null,
    reviewScore: proof?.submissionSmoke?.scorePersistence?.reviewScore ?? null,
    reviewBand: proof?.submissionSmoke?.scorePersistence?.reviewBand ?? null,
    scoreStatus: proof?.submissionSmoke?.scorePersistence?.reviewStatus ?? null,
    evidenceHyperedgeCount: proof?.submissionSmoke?.recruiterResults?.evidenceHyperedgeCount ?? null,
    personRoleRepoHyperedge: proof?.submissionSmoke?.recruiterResults?.personRoleRepoHyperedge ?? null,
  };
}

function summarizeMatrix(proof) {
  const first = Array.isArray(proof?.summaries) ? proof.summaries[0] : null;
  return {
    ok: proof?.ok === true,
    profileCount: proof?.profileCount ?? null,
    passed: proof?.passed ?? null,
    failed: proof?.failed ?? null,
    profileId: first?.profileId ?? null,
    interviewId: first?.interviewId ?? null,
    repoUrl: first?.repoUrl ?? null,
    prNumber: first?.prNumber ?? null,
    matchStatus: first?.matchStatus ?? null,
    qualityGate: first?.qualityGate ?? null,
    assessmentQuality: first?.assessmentQuality ?? null,
    contrastScore: first?.contrastScore ?? null,
  };
}

function summarizeMatchQuality(proof) {
  return {
    ok: proof?.passed === true,
    corpusId: proof?.corpusId ?? null,
    totalPairs: proof?.metrics?.totalPairs ?? null,
    accuracy: proof?.metrics?.verdictAccuracy ?? null,
    falsePositiveCount: proof?.metrics?.falsePositiveCount ?? null,
    falseNegativeCount: proof?.metrics?.falseNegativeCount ?? null,
    averageScoreSeparation: proof?.metrics?.averageScoreSeparation ?? null,
    usableChallengeRate: proof?.metrics?.usableChallengeRate ?? null,
    gateFailures: proof?.gateFailures ?? null,
  };
}

export function summarizeLaneProof(parser, stdout) {
  const proof = parser === 'matrix'
    ? extractMatrixSummary(stdout)
    : parser === 'match-quality'
      ? extractLastJsonObject(stdout, (candidate) =>
          typeof candidate.corpusId === 'string'
          && candidate.metrics
          && typeof candidate.passed === 'boolean')
      : extractLastJsonObject(stdout, (candidate) =>
          candidate.ok === true
          && (
            typeof candidate.interviewId === 'string'
            || candidate.candidateHandoff
            || candidate.submissionSmoke
          ));
  if (!proof) return { parsed: false, summary: null };

  if (parser === 'matrix') return { parsed: true, summary: summarizeMatrix(proof) };
  if (parser === 'match-quality') return { parsed: true, summary: summarizeMatchQuality(proof) };
  return { parsed: true, summary: summarizeAssessSmoke(proof) };
}

export function runReliabilityLane({
  lane,
  env = process.env,
  outDir = DEFAULT_OUT_DIR,
  childTimeoutMs = DEFAULT_CHILD_TIMEOUT_MS,
  cwd = process.cwd(),
}) {
  mkdirSync(outDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const childEnv = {
    ...env,
    CODE_REVIEW_SMOKE_REQUEST_TIMEOUT_MS: env.CODE_REVIEW_SMOKE_REQUEST_TIMEOUT_MS ?? '150000',
  };
  const result = spawnSync(lane.command[0], lane.command.slice(1), {
    cwd,
    env: childEnv,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 80,
    timeout: childTimeoutMs,
  });
  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startedMs;
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const base = join(outDir, `${timestamp()}-${lane.id}`);
  const stdoutPath = `${base}.stdout.log`;
  const stderrPath = `${base}.stderr.log`;
  writeFileSync(stdoutPath, stdout);
  writeFileSync(stderrPath, stderr);

  const proof = summarizeLaneProof(lane.parser, stdout);
  const ok = result.status === 0
    && !result.error
    && proof.parsed
    && proof.summary?.ok === true;
  const laneResult = {
    id: lane.id,
    label: lane.label,
    ok,
    exitCode: result.status,
    error: result.error?.message ?? null,
    timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'),
    durationMs,
    startedAt,
    finishedAt,
    command: lane.command.join(' '),
    stdoutPath,
    stderrPath,
    parsed: proof.parsed,
    summary: proof.summary,
  };
  writeFileSync(`${base}.summary.json`, JSON.stringify(laneResult, null, 2));
  return laneResult;
}

function loadEnv() {
  dotenv.config({ path: '.env.local', quiet: true });
  dotenv.config({ path: '.env', quiet: true });
}

function main() {
  loadEnv();
  const outDir = process.env.CODE_REVIEW_RELIABILITY_OUT_DIR || DEFAULT_OUT_DIR;
  const childTimeoutMs = Math.max(
    60_000,
    Number.parseInt(process.env.CODE_REVIEW_RELIABILITY_CHILD_TIMEOUT_MS || String(DEFAULT_CHILD_TIMEOUT_MS), 10)
      || DEFAULT_CHILD_TIMEOUT_MS,
  );
  const databaseId = resolveAppDevDatabaseId({ env: process.env });
  const lanes = buildReliabilityLanes({ env: process.env, databaseId });
  const suiteStartedAt = new Date().toISOString();
  const results = [];

  for (const lane of lanes) {
    process.stdout.write(`\n===== CODE_REVIEW reliability lane: ${lane.id} =====\n`);
    process.stdout.write(`${lane.command.join(' ')}\n`);
    const result = runReliabilityLane({
      lane,
      env: process.env,
      outDir,
      childTimeoutMs,
    });
    results.push(result);
    process.stdout.write(`${JSON.stringify({
      id: result.id,
      ok: result.ok,
      durationMs: result.durationMs,
      stdoutPath: result.stdoutPath,
      summary: result.summary,
    }, null, 2)}\n`);
    if (!result.ok) break;
  }

  const suite = {
    ok: results.length === lanes.length && results.every((result) => result.ok),
    startedAt: suiteStartedAt,
    finishedAt: new Date().toISOString(),
    outDir,
    databaseId,
    laneCount: lanes.length,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
  mkdirSync(outDir, { recursive: true });
  const suitePath = join(outDir, `${timestamp()}-suite.summary.json`);
  writeFileSync(suitePath, JSON.stringify(suite, null, 2));
  process.stdout.write(`\n===== CODE_REVIEW reliability suite summary =====\n${JSON.stringify({
    ok: suite.ok,
    laneCount: suite.laneCount,
    passed: suite.passed,
    failed: suite.failed,
    suitePath,
    results: suite.results.map((result) => ({
      id: result.id,
      ok: result.ok,
      stdoutPath: result.stdoutPath,
      summary: result.summary,
    })),
  }, null, 2)}\n`);
  if (!suite.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main();
}
