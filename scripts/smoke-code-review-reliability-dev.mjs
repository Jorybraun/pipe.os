import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const DEFAULT_CHILD_TIMEOUT_MS = 900_000;
const DEFAULT_OUT_DIR = 'tmp/code-review-reliability';
const DEFAULT_DEV_D1_DATABASE_ID = '0abe92df-9296-46f5-9f9d-a1fb1bcd3be1';
const DEFAULT_LANE_IDS = [
  'manual-ready',
  'no-cv-handoff',
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
      'manual-ready',
      {
        id: 'manual-ready',
        label: 'Manual source-backed PR ready assignment',
        command: ['npm', 'run', 'smoke:code-review-assess-dev'],
        env: {
          CODE_REVIEW_SMOKE_RECRUITER_CANDIDATE_LINK: '1',
        },
        parser: 'assess-smoke',
      },
    ],
    [
      'no-cv-handoff',
      {
        id: 'no-cv-handoff',
        label: 'Fresh no-CV CODE_REVIEW /assess profile-received handoff',
        command: ['npm', 'run', 'smoke:code-review-assess-dev:no-cv-boundary'],
        parser: 'assess-smoke',
      },
    ],
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
    candidateLinkState: proof?.candidateLinkProof?.state ?? null,
    candidateLinkSessionStatus: proof?.candidateLinkProof?.sessionStatus ?? null,
    candidateLinkSetupStatus: proof?.candidateLinkProof?.setupStatus ?? null,
    candidateHandoffType: proof?.candidateHandoff?.type ?? null,
    candidateHandoffStageId: proof?.candidateHandoff?.stageId ?? null,
    candidateHandoffStageTitle: proof?.candidateHandoff?.stageTitle ?? null,
    candidateHandoffChallengeCount: proof?.candidateHandoff?.challengeCount ?? null,
    candidateBrowserSmokeSkipped: proof?.browserSmoke?.skipped ?? null,
    recruiterBrowserSmokeSkipped: proof?.recruiterBrowserSmoke?.skipped ?? null,
    recruiterReadoutContract: proof?.recruiterBrowserSmoke?.readoutContract ?? null,
    recruiterReadinessReady: proof?.recruiterBrowserSmoke?.readiness?.ready ?? null,
    recruiterAssessmentSetupStatus: proof?.recruiterBrowserSmoke?.readiness?.assessmentSetupStatus ?? null,
    recruiterAssessmentSetupKind: proof?.recruiterBrowserSmoke?.readiness?.assessmentSetupKind ?? null,
    recruiterAssessmentSetupSource: proof?.recruiterBrowserSmoke?.readiness?.assessmentSetupSource ?? null,
    recruiterInterviewStatus: proof?.submissionSmoke?.recruiterResults?.interviewStatus ?? null,
    recruiterProfileInterviewStatus: proof?.submissionSmoke?.recruiterResults?.profileInterviewStatus ?? null,
    recruiterProfileSubmitted: proof?.submissionSmoke?.recruiterResults?.profileSubmitted ?? null,
    recruiterMatchStatus: proof?.submissionSmoke?.recruiterResults?.codeReviewMatchStatus ?? null,
    validatorVerdict: proof?.submissionSmoke?.recruiterResults?.validatorVerdict ?? null,
    roleSourceCount: proof?.submissionSmoke?.recruiterResults?.roleSourceCount ?? null,
    reviewSessionId: proof?.submissionSmoke?.reviewSessionId ?? null,
    agentResponseCount: proof?.submissionSmoke?.agentResponseCount ?? null,
    threadCount: proof?.submissionSmoke?.threadCount ?? null,
    reviewScore: proof?.submissionSmoke?.scorePersistence?.reviewScore ?? null,
    reviewBand: proof?.submissionSmoke?.scorePersistence?.reviewBand ?? null,
    scoreStatus: proof?.submissionSmoke?.scorePersistence?.reviewStatus ?? null,
    challengeSubmissionScore: proof?.submissionSmoke?.scorePersistence?.challengeSubmissionScore ?? null,
    assessmentScore: proof?.submissionSmoke?.scorePersistence?.assessmentScore ?? null,
    scoreD1Target: proof?.submissionSmoke?.scorePersistence?.d1Target ?? null,
    reviewStatusPhase: proof?.submissionSmoke?.reviewStatusPipeline?.phase ?? null,
    reviewStatusCurrentRound: proof?.submissionSmoke?.reviewStatusPipeline?.currentRound ?? null,
    reviewStatusMaxRounds: proof?.submissionSmoke?.reviewStatusPipeline?.maxRounds ?? null,
    reviewStatusScoreOverall: proof?.submissionSmoke?.reviewStatusPipeline?.scoreOverall ?? null,
    reviewStatusScoreBand: proof?.submissionSmoke?.reviewStatusPipeline?.scoreBand ?? null,
    reviewPipelineReviewStatus: Array.isArray(proof?.submissionSmoke?.reviewStatusPipeline?.pipeline)
      ? (proof.submissionSmoke.reviewStatusPipeline.pipeline.find((step) => step?.id === 'review')?.status ?? null)
      : null,
    reviewPipelineScoringStatus: Array.isArray(proof?.submissionSmoke?.reviewStatusPipeline?.pipeline)
      ? (proof.submissionSmoke.reviewStatusPipeline.pipeline.find((step) => step?.id === 'scoring')?.status ?? null)
      : null,
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
    candidateBrowserSmokeSkipped: first?.candidateBrowserSmokeSkipped ?? null,
    recruiterBrowserSmokeSkipped: first?.recruiterBrowserSmokeSkipped ?? null,
    recruiterReadoutContract: first?.recruiterReadoutContract ?? null,
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

function finiteNumberAtLeast(value, minimum) {
  return Number.isFinite(Number(value)) && Number(value) >= minimum;
}

function noFailures(value) {
  return Array.isArray(value) && value.length === 0;
}

export function validateLaneSummary(laneId, summary) {
  const failures = [];
  const require = (condition, message) => {
    if (!condition) failures.push(message);
  };

  require(summary?.ok === true, 'summary ok must be true');

  switch (laneId) {
    case 'manual-ready':
      require(summary?.matchMode === 'manual_override', 'manual-ready must use manual_override');
      require(summary?.matchStatus === 'MATCHED', 'manual-ready must be MATCHED');
      require(summary?.qualityGate === 'PASSED', 'manual-ready quality gate must pass');
      require(summary?.assessmentQuality === 'USABLE', 'manual-ready assessment quality must be USABLE');
      require(summary?.candidateLinkState === 'active', 'manual-ready candidate link must remain active before browser smoke');
      require(summary?.candidateLinkSessionStatus === 'INVITED', 'manual-ready resolved session must remain INVITED before intake');
      require(summary?.candidateLinkSetupStatus === 'reviewable_task_assigned', 'manual-ready setup status must be reviewable_task_assigned');
      require(summary?.candidateBrowserSmokeSkipped === false, 'manual-ready candidate browser smoke must run');
      require(summary?.recruiterBrowserSmokeSkipped === false, 'manual-ready recruiter browser smoke must run');
      require(summary?.recruiterReadoutContract === 'matched-code-review-hiring-manager-readout', 'manual-ready recruiter smoke must prove matched hiring-manager readout contract');
      require(summary?.recruiterReadinessReady === true, 'manual-ready recruiter readiness must be proven');
      require(summary?.recruiterAssessmentSetupStatus === 'reviewable_task_assigned', 'manual-ready recruiter setup must be reviewable_task_assigned');
      require(Boolean(summary?.repoUrl), 'manual-ready must include repoUrl');
      require(finiteNumberAtLeast(summary?.prNumber, 1), 'manual-ready must include a positive prNumber');
      break;
    case 'no-cv-handoff':
      require(summary?.matchMode === 'auto_match', 'no-cv-handoff must use auto_match setup');
      require(summary?.candidateHandoffType === 'PROFILE_RECEIVED', 'no-cv-handoff must return PROFILE_RECEIVED');
      require(summary?.candidateHandoffStageId === 'candidate-intake-queued', 'no-cv-handoff stage must be candidate-intake-queued');
      require(summary?.candidateHandoffStageTitle === 'Profile received', 'no-cv-handoff stage title must be Profile received');
      require(Number(summary?.candidateHandoffChallengeCount) === 0, 'no-cv-handoff must expose zero candidate challenges');
      require(summary?.candidateBrowserSmokeSkipped === false, 'no-cv-handoff candidate browser smoke must run');
      require(summary?.recruiterBrowserSmokeSkipped === false, 'no-cv-handoff recruiter browser smoke must run');
      require(summary?.recruiterReadoutContract === 'blocked-code-review-action-readout', 'no-cv-handoff recruiter smoke must prove blocked action readout contract');
      require(summary?.recruiterReadinessReady === true, 'no-cv-handoff recruiter readiness must be proven');
      require(summary?.recruiterAssessmentSetupStatus === 'waiting_for_source_backed_match', 'no-cv-handoff recruiter setup must wait for source-backed match');
      require(summary?.repoUrl === null, 'no-cv-handoff must not assign a repo');
      require(summary?.prNumber === null, 'no-cv-handoff must not assign a PR');
      require(summary?.reviewSessionId === null, 'no-cv-handoff must not create a review session');
      break;
    case 'blocked-handoff':
      require(summary?.matchMode === 'auto_match', 'blocked-handoff must use auto_match setup');
      require(summary?.candidateHandoffType === 'PROFILE_RECEIVED', 'blocked-handoff must return PROFILE_RECEIVED');
      require(summary?.candidateHandoffStageId === 'candidate-intake-queued', 'blocked-handoff stage must be candidate-intake-queued');
      require(summary?.candidateBrowserSmokeSkipped === false, 'blocked-handoff candidate browser smoke must run');
      require(summary?.recruiterBrowserSmokeSkipped === false, 'blocked-handoff recruiter browser smoke must run');
      require(summary?.recruiterReadoutContract === 'blocked-code-review-action-readout', 'blocked-handoff recruiter smoke must prove blocked action readout contract');
      require(summary?.recruiterReadinessReady === true, 'blocked-handoff recruiter readiness must be proven');
      require(summary?.recruiterAssessmentSetupStatus === 'waiting_for_source_backed_match', 'blocked-handoff recruiter setup must wait for source-backed match');
      require(summary?.repoUrl === null, 'blocked-handoff must not assign a repo');
      require(summary?.prNumber === null, 'blocked-handoff must not assign a PR');
      require(summary?.reviewSessionId === null, 'blocked-handoff must not create a review session');
      break;
    case 'role-backed-full-submit':
      require(summary?.matchMode === 'role_backed_auto_match', 'role-backed-full-submit must use role_backed_auto_match');
      require(summary?.matchStatus === 'MATCHED', 'role-backed-full-submit must be MATCHED');
      require(summary?.qualityGate === 'PASSED', 'role-backed-full-submit quality gate must pass');
      require(Boolean(summary?.assessmentQuality), 'role-backed-full-submit must report assessment quality');
      require(summary?.candidateBrowserSmokeSkipped === false, 'role-backed-full-submit candidate browser smoke must run');
      require(summary?.recruiterBrowserSmokeSkipped === false, 'role-backed-full-submit recruiter browser smoke must run');
      require(summary?.recruiterReadoutContract === 'scored-code-review-hiring-manager-readout', 'role-backed-full-submit recruiter smoke must prove scored hiring-manager readout contract');
      require(summary?.recruiterReadinessReady === true, 'role-backed-full-submit recruiter readiness must be proven');
      require(summary?.recruiterAssessmentSetupStatus === 'reviewable_task_assigned', 'role-backed-full-submit recruiter setup must be reviewable_task_assigned');
      require(summary?.recruiterInterviewStatus === 'COMPLETED', 'role-backed-full-submit recruiter interview status must be COMPLETED');
      require(summary?.recruiterProfileInterviewStatus === 'COMPLETED', 'role-backed-full-submit person profile interview status must be COMPLETED');
      require(summary?.recruiterProfileSubmitted === true, 'role-backed-full-submit recruiter profile must expose submitted result');
      require(summary?.recruiterMatchStatus === 'MATCHED', 'role-backed-full-submit recruiter match status must be MATCHED');
      require(summary?.validatorVerdict === 'PASSED', 'role-backed-full-submit recruiter validator verdict must be PASSED');
      require(finiteNumberAtLeast(summary?.roleSourceCount, 1), 'role-backed-full-submit must expose role source proof');
      require(Boolean(summary?.repoUrl), 'role-backed-full-submit must include repoUrl');
      require(finiteNumberAtLeast(summary?.prNumber, 1), 'role-backed-full-submit must include a positive prNumber');
      require(Boolean(summary?.reviewSessionId), 'role-backed-full-submit must persist review session id');
      require(finiteNumberAtLeast(summary?.agentResponseCount, 1), 'role-backed-full-submit must include author pushback response');
      require(finiteNumberAtLeast(summary?.threadCount, 1), 'role-backed-full-submit must include review thread');
      require(summary?.scoreStatus === 'scored', 'role-backed-full-submit score status must be scored');
      require(finiteNumberAtLeast(summary?.reviewScore, 0), 'role-backed-full-submit must persist numeric score');
      require(Boolean(summary?.reviewBand), 'role-backed-full-submit must persist review band');
      require(finiteNumberAtLeast(summary?.challengeSubmissionScore, 0), 'role-backed-full-submit must persist challenge submission score');
      require(finiteNumberAtLeast(summary?.assessmentScore, 0), 'role-backed-full-submit must persist assessment score');
      require(summary?.scoreD1Target === 'remote', 'role-backed-full-submit scoring proof must target remote D1');
      require(summary?.reviewStatusPhase === 'scoring', 'role-backed-full-submit review pipeline phase must be scoring');
      require(finiteNumberAtLeast(summary?.reviewStatusCurrentRound, 2), 'role-backed-full-submit must reach at least round 2');
      require(finiteNumberAtLeast(summary?.reviewStatusMaxRounds, 2), 'role-backed-full-submit must report max rounds');
      require(Number(summary?.reviewStatusScoreOverall) === Number(summary?.reviewScore), 'role-backed-full-submit review pipeline score must match persisted score');
      require(summary?.reviewStatusScoreBand === summary?.reviewBand, 'role-backed-full-submit review pipeline band must match persisted band');
      require(summary?.reviewPipelineReviewStatus === 'complete', 'role-backed-full-submit review pipeline review step must be complete');
      require(summary?.reviewPipelineScoringStatus === 'complete', 'role-backed-full-submit review pipeline scoring step must be complete');
      require(finiteNumberAtLeast(summary?.evidenceHyperedgeCount, 1), 'role-backed-full-submit must expose evidence hyperedges');
      require(summary?.personRoleRepoHyperedge === true, 'role-backed-full-submit must expose person-role-repo bridge');
      break;
    case 'workers-sdk-matrix':
      require(finiteNumberAtLeast(summary?.profileCount, 1), 'workers-sdk-matrix must evaluate at least one profile');
      require(Number(summary?.failed) === 0, 'workers-sdk-matrix failed profile count must be 0');
      require(Number(summary?.passed) === Number(summary?.profileCount), 'workers-sdk-matrix must pass every evaluated profile');
      require(summary?.profileId === 'workers-sdk-runtime', 'workers-sdk-matrix must run the Workers SDK profile');
      require(summary?.repoUrl === 'https://github.com/cloudflare/workers-sdk', 'workers-sdk-matrix must select cloudflare/workers-sdk');
      require(finiteNumberAtLeast(summary?.prNumber, 1), 'workers-sdk-matrix must include a positive prNumber');
      require(summary?.matchStatus === 'MATCHED', 'workers-sdk-matrix must be MATCHED');
      require(summary?.qualityGate === 'PASSED', 'workers-sdk-matrix quality gate must pass');
      require(summary?.assessmentQuality === 'STRONG', 'workers-sdk-matrix assessment quality must be STRONG');
      require(finiteNumberAtLeast(summary?.contrastScore, 1), 'workers-sdk-matrix contrast score must be at least 1');
      require(summary?.candidateBrowserSmokeSkipped === false, 'workers-sdk-matrix candidate browser smoke must run');
      require(summary?.recruiterBrowserSmokeSkipped === false, 'workers-sdk-matrix recruiter browser smoke must run');
      require(summary?.recruiterReadoutContract === 'matched-code-review-hiring-manager-readout', 'workers-sdk-matrix recruiter smoke must prove matched hiring-manager readout contract');
      break;
    case 'match-quality-readiness':
      require(Boolean(summary?.corpusId), 'match-quality-readiness must include corpusId');
      require(finiteNumberAtLeast(summary?.totalPairs, 1), 'match-quality-readiness must include evaluated pairs');
      require(Number(summary?.accuracy) === 1, 'match-quality-readiness accuracy must be 1');
      require(Number(summary?.falsePositiveCount) === 0, 'match-quality-readiness falsePositiveCount must be 0');
      require(Number(summary?.falseNegativeCount) === 0, 'match-quality-readiness falseNegativeCount must be 0');
      require(finiteNumberAtLeast(summary?.averageScoreSeparation, 0.01), 'match-quality-readiness averageScoreSeparation must be positive');
      require(Number(summary?.usableChallengeRate) === 1, 'match-quality-readiness usableChallengeRate must be 1');
      require(noFailures(summary?.gateFailures), 'match-quality-readiness gateFailures must be empty');
      break;
    default:
      require(false, `unknown reliability lane ${JSON.stringify(laneId)}`);
      break;
  }

  return {
    ok: failures.length === 0,
    failures,
  };
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
    ...(lane.env ?? {}),
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
  const summaryValidation = validateLaneSummary(lane.id, proof.summary);
  const ok = result.status === 0
    && !result.error
    && proof.parsed
    && summaryValidation.ok;
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
    laneEnv: lane.env ?? null,
    stdoutPath,
    stderrPath,
    parsed: proof.parsed,
    summary: proof.summary,
    summaryValidation,
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
