import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LOOP_COUNT = Math.max(
  1,
  Number.parseInt(process.env.CODE_REVIEW_SMOKE_LOOP_RUNS || '2', 10) || 2,
);
const STOP_ON_FAILURE = process.env.CODE_REVIEW_SMOKE_LOOP_STOP_ON_FAILURE !== '0';
const OUT_DIR = process.env.CODE_REVIEW_SMOKE_LOOP_OUT_DIR || 'tmp/code-review-smoke-runs';

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function extractJsonObject(text) {
  const clean = stripAnsi(text);
  const start = clean.indexOf('{');
  if (start < 0) return null;

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

function extractMatrixProof(stdout) {
  const marker = '===== CODE_REVIEW app-dev profile matrix summary =====';
  const clean = stripAnsi(stdout);
  const markerIndex = clean.lastIndexOf(marker);
  const source = markerIndex >= 0 ? clean.slice(markerIndex + marker.length) : clean;
  return extractJsonObject(source);
}

function summarizeMatrix(proof) {
  const summaries = Array.isArray(proof?.summaries) ? proof.summaries : [];
  const matchedFullSubmits = summaries.filter((summary) =>
    summary?.ok === true
    && summary.expectedOutcome === 'matched'
    && typeof summary.reviewSessionId === 'string'
    && summary.reviewSessionId.length > 0
    && Number.isFinite(Number(summary.reviewScore))
    && typeof summary.reviewBand === 'string'
    && summary.recruiterMatchStatus === 'MATCHED'
    && Number(summary.evidenceHyperedgeCount) > 0
  );
  const blockedNoAutoRefresh = summaries.filter((summary) =>
    summary?.ok === true
    && summary.expectedOutcome === 'blocked'
    && summary.blockedState === 'blocked'
    && summary.blockedPhase === 'repo_matching'
    && summary.blockedAutoRefresh === false
  );

  return {
    profileCount: summaries.length,
    passed: Number(proof?.passed ?? 0),
    failed: Number(proof?.failed ?? 0),
    matchedFullSubmitCount: matchedFullSubmits.length,
    matchedInterviews: matchedFullSubmits.map((summary) => ({
      profileId: summary.profileId,
      interviewId: summary.interviewId,
      repoUrl: summary.repoUrl,
      prNumber: summary.prNumber,
      reviewSessionId: summary.reviewSessionId,
      reviewScore: summary.reviewScore,
      reviewBand: summary.reviewBand,
      evidenceHyperedgeCount: summary.evidenceHyperedgeCount,
    })),
    blockedNoAutoRefreshCount: blockedNoAutoRefresh.length,
    blockedInterviews: blockedNoAutoRefresh.map((summary) => ({
      profileId: summary.profileId,
      interviewId: summary.interviewId,
      phase: summary.blockedPhase,
      state: summary.blockedState,
      reason: summary.blockedReason,
      matchableNodeCount: summary.blockedMatchableNodeCount,
    })),
  };
}

function runMatrix(iteration) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const result = spawnSync(
    process.execPath,
    ['scripts/smoke-code-review-assess-dev-matrix.mjs'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CODE_REVIEW_SMOKE_MATRIX_STOP_ON_FAILURE: process.env.CODE_REVIEW_SMOKE_MATRIX_STOP_ON_FAILURE || '1',
      },
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 60,
    },
  );
  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startedMs;
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const proof = extractMatrixProof(stdout);
  const summary = summarizeMatrix(proof);
  const iterationOk = result.status === 0
    && !result.error
    && proof?.ok === true
    && summary.matchedFullSubmitCount >= 1
    && summary.blockedNoAutoRefreshCount >= 1;

  mkdirSync(OUT_DIR, { recursive: true });
  const base = join(OUT_DIR, `${timestamp()}-iteration-${iteration}`);
  writeFileSync(`${base}.stdout.log`, stdout);
  writeFileSync(`${base}.stderr.log`, stderr);
  writeFileSync(`${base}.summary.json`, JSON.stringify({
    iteration,
    ok: iterationOk,
    startedAt,
    finishedAt,
    durationMs,
    exitCode: result.status,
    error: result.error?.message ?? null,
    proof,
    summary,
  }, null, 2));

  return {
    iteration,
    ok: iterationOk,
    startedAt,
    finishedAt,
    durationMs,
    exitCode: result.status,
    error: result.error?.message ?? (
      iterationOk ? null : stripAnsi(stderr || stdout).split('\n').filter(Boolean).slice(-12).join('\n')
    ),
    artifactPaths: {
      stdout: `${base}.stdout.log`,
      stderr: `${base}.stderr.log`,
      summary: `${base}.summary.json`,
    },
    summary,
  };
}

function main() {
  const startedAt = new Date().toISOString();
  const runs = [];
  for (let iteration = 1; iteration <= LOOP_COUNT; iteration += 1) {
    process.stdout.write(`\n===== CODE_REVIEW app-dev reliability loop ${iteration}/${LOOP_COUNT} =====\n`);
    const run = runMatrix(iteration);
    runs.push(run);
    process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
    if (!run.ok && STOP_ON_FAILURE) break;
  }

  const failed = runs.filter((run) => !run.ok);
  const totals = runs.reduce((accumulator, run) => ({
    profileCount: accumulator.profileCount + run.summary.profileCount,
    passedProfiles: accumulator.passedProfiles + run.summary.passed,
    failedProfiles: accumulator.failedProfiles + run.summary.failed,
    matchedFullSubmitCount: accumulator.matchedFullSubmitCount + run.summary.matchedFullSubmitCount,
    blockedNoAutoRefreshCount: accumulator.blockedNoAutoRefreshCount + run.summary.blockedNoAutoRefreshCount,
  }), {
    profileCount: 0,
    passedProfiles: 0,
    failedProfiles: 0,
    matchedFullSubmitCount: 0,
    blockedNoAutoRefreshCount: 0,
  });

  const proof = {
    ok: failed.length === 0 && runs.length === LOOP_COUNT,
    startedAt,
    finishedAt: new Date().toISOString(),
    requestedLoopCount: LOOP_COUNT,
    completedLoopCount: runs.length,
    matrixPasses: runs.length - failed.length,
    matrixFailures: failed.length,
    stopOnFailure: STOP_ON_FAILURE,
    outDir: OUT_DIR,
    totals,
    runs,
  };

  process.stdout.write(`\n===== CODE_REVIEW app-dev reliability loop summary =====\n${JSON.stringify(proof, null, 2)}\n`);
  if (!proof.ok) {
    process.exitCode = 1;
  }
}

main();
