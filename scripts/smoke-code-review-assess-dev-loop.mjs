import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LOOP_COUNT = Math.max(
  1,
  Number.parseInt(process.env.CODE_REVIEW_SMOKE_LOOP_RUNS || '2', 10) || 2,
);
const STOP_ON_FAILURE = process.env.CODE_REVIEW_SMOKE_LOOP_STOP_ON_FAILURE !== '0';
const OUT_DIR = process.env.CODE_REVIEW_SMOKE_LOOP_OUT_DIR || 'tmp/code-review-smoke-runs';
const CHILD_TIMEOUT_MS = Math.max(
  60_000,
  Number.parseInt(process.env.CODE_REVIEW_SMOKE_CHILD_TIMEOUT_MS || '600000', 10) || 600_000,
);

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

function extractJsonObject(text) {
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
      && Object.prototype.hasOwnProperty.call(parsed, 'ok')
    ) {
      return parsed;
    }
  }
  return null;
}

function extractMatrixProof(stdout) {
  const marker = '===== CODE_REVIEW app-dev profile matrix summary =====';
  const clean = stripAnsi(stdout);
  const markerIndex = clean.lastIndexOf(marker);
  if (markerIndex < 0) return extractJsonObject(clean);
  const source = clean.slice(markerIndex + marker.length);
  const start = source.indexOf('{');
  return start >= 0 ? parseJsonObjectAt(source, start) : null;
}

function summarizeMatrix(proof) {
  const summaries = Array.isArray(proof?.summaries) ? proof.summaries : [];
  const blockedNoAutoRefresh = summaries.filter((summary) =>
    summary?.ok === true
    && (
      (
        summary.expectedOutcome === 'blocked'
        && summary.blockedState === 'blocked'
        && summary.blockedPhase === 'repo_matching'
        && summary.blockedAutoRefresh === false
      )
      || (
        summary.expectedOutcome === 'blocked'
        && summary.candidateHandoffType === 'PROFILE_RECEIVED'
        && summary.candidateHandoffStageId === 'candidate-intake-queued'
        && summary.candidateHandoffComplete === true
      )
    )
  );

  return {
    profileCount: summaries.length,
    passed: Number(proof?.passed ?? 0),
    failed: Number(proof?.failed ?? 0),
    matchedFullSubmitCount: 0,
    matchedInterviews: [],
    blockedNoAutoRefreshCount: blockedNoAutoRefresh.length,
    blockedInterviews: blockedNoAutoRefresh.map((summary) => ({
      profileId: summary.profileId,
      interviewId: summary.interviewId,
      phase: summary.blockedPhase ?? 'candidate-intake-queued',
      state: summary.blockedState ?? summary.candidateHandoffType,
      reason: summary.blockedReason ?? summary.candidateHandoffTitle,
      matchableNodeCount: summary.blockedMatchableNodeCount ?? null,
    })),
  };
}

function summarizeReadySubmit(proof) {
  const submission = proof?.submissionSmoke ?? {};
  const scorePersistence = submission.scorePersistence ?? {};
  const reviewStatusPipeline = submission.reviewStatusPipeline ?? {};
  const recruiterResults = submission.recruiterResults ?? {};
  const matchedFullSubmit = proof?.ok === true
    && proof.matchMode === 'manual_override'
    && proof.matchStatus === 'MATCHED'
    && proof.qualityGate === 'PASSED'
    && proof.assessmentQuality === 'USABLE'
    && submission.skipped === false
    && typeof submission.reviewSessionId === 'string'
    && submission.reviewSessionId.length > 0
    && scorePersistence.skipped === false
    && scorePersistence.reviewStatus === 'scored'
    && Number.isFinite(Number(scorePersistence.reviewScore))
    && typeof scorePersistence.reviewBand === 'string'
    && reviewStatusPipeline.status === 'scored'
    && reviewStatusPipeline.phase === 'scoring'
    && reviewStatusPipeline.reviewPipelineScoringStatus !== 'blocked'
    && recruiterResults.interviewStatus === 'COMPLETED'
    && recruiterResults.profileInterviewStatus === 'COMPLETED'
    && recruiterResults.codeReviewMatchStatus === 'MATCHED'
    && recruiterResults.validatorVerdict === 'PASSED';

  return {
    profileCount: 0,
    passed: matchedFullSubmit ? 1 : 0,
    failed: matchedFullSubmit ? 0 : 1,
    matchedFullSubmitCount: matchedFullSubmit ? 1 : 0,
    matchedInterviews: matchedFullSubmit
      ? [{
          interviewId: proof.interviewId,
          repoUrl: proof.repoUrl,
          prNumber: proof.prNumber,
          reviewSessionId: submission.reviewSessionId,
          reviewScore: scorePersistence.reviewScore,
          reviewBand: scorePersistence.reviewBand,
          reviewStatus: scorePersistence.reviewStatus,
          reviewStatusPhase: reviewStatusPipeline.phase,
          reviewPipelineScoringStatus: reviewStatusPipeline.pipeline?.find((step) => step?.id === 'scoring')?.status ?? null,
          evidenceHyperedgeCount: recruiterResults.evidenceHyperedgeCount ?? null,
        }]
      : [],
    blockedNoAutoRefreshCount: 0,
    blockedInterviews: [],
  };
}

function runReadySubmit(iteration) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const readyEnv = {
    ...process.env,
    CODE_REVIEW_SMOKE_SUBMIT: '1',
    CODE_REVIEW_SMOKE_AUTO_MATCH: '',
    CODE_REVIEW_EXPECT_BLOCKED_MATCH: '',
  };
  if (!process.env.CODE_REVIEW_SMOKE_REPO_URL) {
    delete readyEnv.CODE_REVIEW_SMOKE_REPO_URL;
  }
  if (!process.env.CODE_REVIEW_SMOKE_PR_NUMBER) {
    delete readyEnv.CODE_REVIEW_SMOKE_PR_NUMBER;
  }
  const result = spawnSync(
    process.execPath,
    ['scripts/smoke-code-review-assess-dev.mjs'],
    {
      cwd: process.cwd(),
      env: readyEnv,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 60,
      timeout: CHILD_TIMEOUT_MS,
    },
  );
  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - startedMs;
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const proof = extractJsonObject(stdout);
  const summary = summarizeReadySubmit(proof);
  const runOk = result.status === 0
    && !result.error
    && proof?.ok === true
    && summary.matchedFullSubmitCount >= 1;

  mkdirSync(OUT_DIR, { recursive: true });
  const base = join(OUT_DIR, `${timestamp()}-iteration-${iteration}-ready-submit`);
  writeFileSync(`${base}.stdout.log`, stdout);
  writeFileSync(`${base}.stderr.log`, stderr);
  writeFileSync(`${base}.summary.json`, JSON.stringify({
    iteration,
    kind: 'ready-submit',
    ok: runOk,
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
    kind: 'ready-submit',
    ok: runOk,
    startedAt,
    finishedAt,
    durationMs,
    exitCode: result.status,
    error: result.error?.message ?? (
      runOk ? null : stripAnsi(stderr || stdout).split('\n').filter(Boolean).slice(-12).join('\n')
    ),
    artifactPaths: {
      stdout: `${base}.stdout.log`,
      stderr: `${base}.stderr.log`,
      summary: `${base}.summary.json`,
    },
    summary,
  };
}

function runBlockedMatrix(iteration) {
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
      timeout: CHILD_TIMEOUT_MS,
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
    && summary.blockedNoAutoRefreshCount >= 1;

  mkdirSync(OUT_DIR, { recursive: true });
  const base = join(OUT_DIR, `${timestamp()}-iteration-${iteration}-blocked-matrix`);
  writeFileSync(`${base}.stdout.log`, stdout);
  writeFileSync(`${base}.stderr.log`, stderr);
  writeFileSync(`${base}.summary.json`, JSON.stringify({
    iteration,
    kind: 'blocked-matrix',
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
    kind: 'blocked-matrix',
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
    process.stdout.write(`\n===== CODE_REVIEW app-dev reliability loop ${iteration}/${LOOP_COUNT}: ready submit =====\n`);
    const readyRun = runReadySubmit(iteration);
    runs.push(readyRun);
    process.stdout.write(`${JSON.stringify(readyRun, null, 2)}\n`);
    if (!readyRun.ok && STOP_ON_FAILURE) break;

    process.stdout.write(`\n===== CODE_REVIEW app-dev reliability loop ${iteration}/${LOOP_COUNT}: blocked matrix =====\n`);
    const blockedRun = runBlockedMatrix(iteration);
    runs.push(blockedRun);
    process.stdout.write(`${JSON.stringify(blockedRun, null, 2)}\n`);
    if (!blockedRun.ok && STOP_ON_FAILURE) break;
  }

  const failed = runs.filter((run) => !run.ok);
  const totals = runs.reduce((accumulator, run) => ({
    profileCount: accumulator.profileCount + Number(run.summary.profileCount ?? 0),
    passedProfiles: accumulator.passedProfiles + Number(run.summary.passed ?? 0),
    failedProfiles: accumulator.failedProfiles + Number(run.summary.failed ?? 0),
    matchedFullSubmitCount: accumulator.matchedFullSubmitCount + Number(run.summary.matchedFullSubmitCount ?? 0),
    blockedNoAutoRefreshCount: accumulator.blockedNoAutoRefreshCount + Number(run.summary.blockedNoAutoRefreshCount ?? 0),
  }), {
    profileCount: 0,
    passedProfiles: 0,
    failedProfiles: 0,
    matchedFullSubmitCount: 0,
    blockedNoAutoRefreshCount: 0,
  });

  const proof = {
    ok: failed.length === 0
      && runs.length === LOOP_COUNT * 2
      && totals.matchedFullSubmitCount >= LOOP_COUNT
      && totals.blockedNoAutoRefreshCount >= LOOP_COUNT,
    startedAt,
    finishedAt: new Date().toISOString(),
    requestedLoopCount: LOOP_COUNT,
    completedLoopCount: Math.floor(runs.length / 2),
    matrixPasses: runs.length - failed.length,
    matrixFailures: failed.length,
    stopOnFailure: STOP_ON_FAILURE,
    childTimeoutMs: CHILD_TIMEOUT_MS,
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
