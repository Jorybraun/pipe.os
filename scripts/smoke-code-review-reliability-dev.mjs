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
  'token-lifecycle',
  'no-cv-handoff',
  'blocked-handoff',
  'role-backed-full-submit',
  'person-boundary',
  'judge-example-readiness',
  'workers-sdk-matrix',
  'packet-catalog-readiness',
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
      'token-lifecycle',
      {
        id: 'token-lifecycle',
        label: 'Same-browser /assess token lifecycle isolation',
        command: ['npm', 'run', 'smoke:assess-token-lifecycle-dev'],
        parser: 'token-lifecycle',
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
      'judge-example-readiness',
      {
        id: 'judge-example-readiness',
        label: 'CODE_REVIEW judge replay and calibration example readiness',
        command: [
          'npm',
          '--prefix',
          'workers/api',
          'run',
          'review-judge:verify',
          '--',
          '--remote',
          '--database-id',
          databaseId,
          '--limit',
          '20',
          '--require-calibration',
          '--json',
        ],
        parser: 'judge-examples',
      },
    ],
    [
      'person-boundary',
      {
        id: 'person-boundary',
        label: 'Completed CODE_REVIEW person-profile evidence boundary',
        command: ['npm', 'run', 'smoke:code-review-assess-dev:person-boundary'],
        parser: 'assess-smoke',
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
    [
      'packet-catalog-readiness',
      {
        id: 'packet-catalog-readiness',
        label: 'Source-backed PR packet catalog breadth gate',
        command: [
          'npm',
          'run',
          'smoke:code-review-packet-catalog-dev',
          '--',
          '--database-id',
          databaseId,
          '--require-pass',
        ],
        parser: 'packet-catalog',
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
    candidateSurfaceContract: proof?.browserSmoke?.surfaceContract ?? null,
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
    relatedBoundaryVerified: proof?.relatedBoundaryProfile?.verified ?? null,
    relatedBoundarySelectedInterviewId: proof?.relatedBoundaryProfile?.selectedInterviewId ?? null,
    relatedBoundaryRelatedInterviewId: proof?.relatedBoundaryProfile?.relatedInterviewId ?? null,
    relatedBoundarySelectedRepoUrl: proof?.relatedBoundaryProfile?.selectedRepoUrl ?? null,
    relatedBoundarySelectedPrNumber: proof?.relatedBoundaryProfile?.selectedPrNumber ?? null,
    relatedBoundaryRelatedRepoUrl: proof?.relatedBoundaryProfile?.relatedRepoUrl ?? null,
    relatedBoundaryRelatedPrNumber: proof?.relatedBoundaryProfile?.relatedPrNumber ?? null,
    relatedBoundarySource: proof?.relatedBoundaryProfile?.relatedSource ?? null,
    relatedBoundaryScheduledCodeReviewCount: proof?.relatedBoundaryProfile?.scheduledCodeReviewCount ?? null,
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
    candidateSurfaceContract: first?.candidateSurfaceContract ?? null,
    recruiterBrowserSmokeSkipped: first?.recruiterBrowserSmokeSkipped ?? null,
    recruiterReadoutContract: first?.recruiterReadoutContract ?? null,
  };
}

function summarizeTokenLifecycle(proof) {
  return {
    ok: proof?.ok === true,
    repoUrl: proof?.repoUrl ?? null,
    prNumber: proof?.prNumber ?? null,
    tokenAInterviewId: proof?.tokenA?.interviewId ?? null,
    tokenACandidateId: proof?.tokenA?.candidateId ?? null,
    tokenACandidateName: proof?.tokenA?.candidateName ?? null,
    tokenADeliveredUrl: proof?.tokenA?.deliveredUrl ?? null,
    tokenBInterviewId: proof?.tokenB?.interviewId ?? null,
    tokenBCandidateId: proof?.tokenB?.candidateId ?? null,
    tokenBCandidateName: proof?.tokenB?.candidateName ?? null,
    tokenBDeliveredUrl: proof?.tokenB?.deliveredUrl ?? null,
    browserSmokeSkipped: proof?.browserSmoke?.skipped ?? null,
  };
}

function isPositiveMatchVerdict(verdict) {
  return verdict === 'strong_match' || verdict === 'likely_match';
}

function summarizeMatchQuality(proof) {
  const caseResults = Array.isArray(proof?.caseResults) ? proof.caseResults : [];
  const failedCases = Array.isArray(proof?.failedCases) ? proof.failedCases : null;
  const positiveCases = caseResults.filter((result) =>
    isPositiveMatchVerdict(result?.expectedVerdict));
  const sourceBackedPrCaseCount = caseResults.filter((result) =>
    result?.sourceBackedPr === true).length;
  const candidateEvidencePositiveCaseCount = positiveCases.filter((result) =>
    result?.candidateEvidencePresent === true).length;
  const repoEvidenceCaseCount = caseResults.filter((result) =>
    result?.repoEvidencePresent === true).length;
  const usableChallengeCaseCount = caseResults.filter((result) =>
    result?.usableChallenge === true).length;
  return {
    ok: proof?.passed === true,
    corpusId: proof?.corpusId ?? null,
    totalPairs: proof?.metrics?.totalPairs ?? null,
    successfulPairs: proof?.metrics?.successfulPairs ?? null,
    failedPairs: proof?.metrics?.failedPairs ?? null,
    negativeCaseCount: proof?.metrics?.negativeCaseCount ?? null,
    insufficientEvidenceCaseCount: proof?.metrics?.insufficientEvidenceCaseCount ?? null,
    contrastCaseCount: proof?.metrics?.contrastCaseCount ?? null,
    reasonCategoryExpectationCount: proof?.metrics?.reasonCategoryExpectationCount ?? null,
    accuracy: proof?.metrics?.verdictAccuracy ?? null,
    falsePositiveCount: proof?.metrics?.falsePositiveCount ?? null,
    falseNegativeCount: proof?.metrics?.falseNegativeCount ?? null,
    averageScoreSeparation: proof?.metrics?.averageScoreSeparation ?? null,
    usableChallengeRate: proof?.metrics?.usableChallengeRate ?? null,
    caseResultsCount: caseResults.length,
    failedCaseCount: Array.isArray(failedCases) ? failedCases.length : null,
    positiveCaseCount: positiveCases.length,
    sourceBackedPrCaseCount,
    candidateEvidencePositiveCaseCount,
    repoEvidenceCaseCount,
    usableChallengeCaseCount,
    gateFailures: proof?.gateFailures ?? null,
  };
}

function summarizePacketCatalog(proof) {
  return {
    ok: proof?.ok === true,
    databaseId: proof?.databaseId ?? null,
    totalPackets: proof?.metrics?.totalPackets ?? null,
    productionReadyPackets: proof?.metrics?.productionReadyPackets ?? null,
    productionReadyRepoCount: proof?.metrics?.productionReadyRepoCount ?? null,
    productionReadyPullRequestCount: proof?.metrics?.productionReadyPullRequestCount ?? null,
    reviewProfileReadyPackets: proof?.metrics?.reviewProfileReadyPackets ?? null,
    repoNames: Array.isArray(proof?.repos)
      ? proof.repos.map((repo) => repo?.repoName).filter(Boolean)
      : [],
    failures: proof?.failures ?? null,
  };
}

function summarizeJudgeExamples(proof) {
  const database = Array.isArray(proof?.databases) ? proof.databases[0] : null;
  const audit = database?.audit ?? null;
  const firstExample = Array.isArray(audit?.examples) ? audit.examples[0] : null;
  return {
    ok: audit?.replayReady === true
      && audit?.calibrationReady === true
      && noFailures(audit?.failures ?? []),
    databasePath: database?.databasePath ?? null,
    status: audit?.status ?? null,
    replayReady: audit?.replayReady ?? null,
    calibrationReady: audit?.calibrationReady ?? null,
    totalExamples: audit?.counts?.total ?? null,
    readyExamples: audit?.counts?.ready ?? null,
    labelledExamples: audit?.counts?.labelled ?? null,
    archivedExamples: audit?.counts?.archived ?? null,
    invalidStatusExamples: audit?.counts?.invalidStatus ?? null,
    replayableExamples: audit?.counts?.replayable ?? null,
    calibrationReadyExamples: audit?.counts?.calibrationReady ?? null,
    failureModes: Array.isArray(audit?.failureModes) ? audit.failureModes : [],
    failures: Array.isArray(audit?.failures) ? audit.failures : null,
    nextActions: Array.isArray(audit?.nextActions) ? audit.nextActions : [],
    exampleId: firstExample?.id ?? null,
    exampleSessionId: firstExample?.sessionId ?? null,
    exampleStatus: firstExample?.status ?? null,
    exampleCommentCount: firstExample?.commentCount ?? null,
    examplePushbackCount: firstExample?.pushbackCount ?? null,
    exampleReplayable: firstExample?.replayable ?? null,
    exampleCalibrationReady: firstExample?.calibrationReady ?? null,
  };
}

export function summarizeLaneProof(parser, stdout) {
  const proof = parser === 'matrix'
    ? extractMatrixSummary(stdout)
    : parser === 'token-lifecycle'
      ? extractLastJsonObject(stdout, (candidate) =>
          candidate.ok === true
          && candidate.tokenA
          && candidate.tokenB
          && candidate.browserSmoke)
    : parser === 'match-quality'
      ? extractLastJsonObject(stdout, (candidate) =>
          typeof candidate.corpusId === 'string'
          && candidate.metrics
          && typeof candidate.passed === 'boolean')
      : parser === 'packet-catalog'
        ? extractLastJsonObject(stdout, (candidate) =>
            candidate.metrics
            && Array.isArray(candidate.repos)
            && typeof candidate.ok === 'boolean')
      : parser === 'judge-examples'
        ? extractLastJsonObject(stdout, (candidate) =>
            Array.isArray(candidate.databases)
            && candidate.databases.some((database) => database?.audit))
      : extractLastJsonObject(stdout, (candidate) =>
          candidate.ok === true
          && (
            typeof candidate.interviewId === 'string'
            || candidate.candidateHandoff
            || candidate.submissionSmoke
          ));
  if (!proof) return { parsed: false, summary: null };

  if (parser === 'matrix') return { parsed: true, summary: summarizeMatrix(proof) };
  if (parser === 'token-lifecycle') return { parsed: true, summary: summarizeTokenLifecycle(proof) };
  if (parser === 'match-quality') return { parsed: true, summary: summarizeMatchQuality(proof) };
  if (parser === 'packet-catalog') return { parsed: true, summary: summarizePacketCatalog(proof) };
  if (parser === 'judge-examples') return { parsed: true, summary: summarizeJudgeExamples(proof) };
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
      require(summary?.candidateSurfaceContract === 'source-backed-code-review-challenge', 'manual-ready candidate browser smoke must prove source-backed code-review surface');
      require(summary?.recruiterBrowserSmokeSkipped === false, 'manual-ready recruiter browser smoke must run');
      require(summary?.recruiterReadoutContract === 'matched-code-review-hiring-manager-readout', 'manual-ready recruiter smoke must prove matched hiring-manager readout contract');
      require(summary?.recruiterReadinessReady === true, 'manual-ready recruiter readiness must be proven');
      require(summary?.recruiterAssessmentSetupStatus === 'reviewable_task_assigned', 'manual-ready recruiter setup must be reviewable_task_assigned');
      require(Boolean(summary?.repoUrl), 'manual-ready must include repoUrl');
      require(finiteNumberAtLeast(summary?.prNumber, 1), 'manual-ready must include a positive prNumber');
      break;
    case 'token-lifecycle':
      require(Boolean(summary?.repoUrl), 'token-lifecycle must include repoUrl');
      require(finiteNumberAtLeast(summary?.prNumber, 1), 'token-lifecycle must include a positive prNumber');
      require(Boolean(summary?.tokenAInterviewId), 'token-lifecycle must include token A interview id');
      require(Boolean(summary?.tokenBInterviewId), 'token-lifecycle must include token B interview id');
      require(summary?.tokenAInterviewId !== summary?.tokenBInterviewId, 'token-lifecycle token A and token B interview ids must differ');
      require(Boolean(summary?.tokenACandidateId), 'token-lifecycle must include token A candidate id');
      require(Boolean(summary?.tokenBCandidateId), 'token-lifecycle must include token B candidate id');
      require(summary?.tokenACandidateId !== summary?.tokenBCandidateId, 'token-lifecycle token A and token B candidate ids must differ');
      require(Boolean(summary?.tokenACandidateName), 'token-lifecycle must include token A candidate name');
      require(Boolean(summary?.tokenBCandidateName), 'token-lifecycle must include token B candidate name');
      require(summary?.tokenACandidateName !== summary?.tokenBCandidateName, 'token-lifecycle token A and token B candidate names must differ');
      require(String(summary?.tokenADeliveredUrl ?? '').includes('/assess/<token>'), 'token-lifecycle token A URL must be a redacted /assess link');
      require(String(summary?.tokenBDeliveredUrl ?? '').includes('/assess/<token>'), 'token-lifecycle token B URL must be a redacted /assess link');
      require(summary?.browserSmokeSkipped === false, 'token-lifecycle browser smoke must run');
      break;
    case 'no-cv-handoff':
      require(summary?.matchMode === 'auto_match', 'no-cv-handoff must use auto_match setup');
      require(summary?.candidateHandoffType === 'PROFILE_RECEIVED', 'no-cv-handoff must return PROFILE_RECEIVED');
      require(summary?.candidateHandoffStageId === 'candidate-intake-queued', 'no-cv-handoff stage must be candidate-intake-queued');
      require(summary?.candidateHandoffStageTitle === 'Profile received', 'no-cv-handoff stage title must be Profile received');
      require(Number(summary?.candidateHandoffChallengeCount) === 0, 'no-cv-handoff must expose zero candidate challenges');
      require(summary?.candidateBrowserSmokeSkipped === false, 'no-cv-handoff candidate browser smoke must run');
      require(summary?.candidateSurfaceContract === 'profile-received-candidate-handoff', 'no-cv-handoff candidate browser smoke must prove profile-received handoff surface');
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
      require(summary?.candidateSurfaceContract === 'profile-received-candidate-handoff', 'blocked-handoff candidate browser smoke must prove profile-received handoff surface');
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
      require(summary?.candidateSurfaceContract === 'source-backed-code-review-with-review-round', 'role-backed-full-submit candidate browser smoke must prove source-backed review-round surface');
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
    case 'person-boundary':
      require(summary?.matchMode === 'manual_override', 'person-boundary must use manual_override');
      require(summary?.matchStatus === 'MATCHED', 'person-boundary must be MATCHED');
      require(summary?.qualityGate === 'PASSED', 'person-boundary quality gate must pass');
      require(summary?.assessmentQuality === 'USABLE', 'person-boundary assessment quality must be USABLE');
      require(summary?.candidateBrowserSmokeSkipped === false, 'person-boundary candidate browser smoke must run');
      require(summary?.candidateSurfaceContract === 'source-backed-code-review-with-review-round', 'person-boundary candidate browser smoke must prove source-backed review-round surface');
      require(summary?.recruiterBrowserSmokeSkipped === false, 'person-boundary recruiter browser smoke must run');
      require(summary?.recruiterReadoutContract === 'scored-code-review-hiring-manager-readout', 'person-boundary recruiter smoke must prove scored hiring-manager readout contract');
      require(summary?.recruiterInterviewStatus === 'COMPLETED', 'person-boundary recruiter interview status must be COMPLETED');
      require(summary?.recruiterProfileInterviewStatus === 'COMPLETED', 'person-boundary person profile interview status must be COMPLETED');
      require(summary?.recruiterProfileSubmitted === true, 'person-boundary recruiter profile must expose submitted result');
      require(summary?.recruiterMatchStatus === 'MATCHED', 'person-boundary recruiter match status must be MATCHED');
      require(summary?.validatorVerdict === 'PASSED', 'person-boundary recruiter validator verdict must be PASSED');
      require(Boolean(summary?.repoUrl), 'person-boundary must include selected repoUrl');
      require(finiteNumberAtLeast(summary?.prNumber, 1), 'person-boundary must include selected prNumber');
      require(Boolean(summary?.reviewSessionId), 'person-boundary must persist review session id');
      require(finiteNumberAtLeast(summary?.agentResponseCount, 1), 'person-boundary must include author pushback response');
      require(finiteNumberAtLeast(summary?.threadCount, 1), 'person-boundary must include review thread');
      require(summary?.scoreStatus === 'scored', 'person-boundary score status must be scored');
      require(finiteNumberAtLeast(summary?.reviewScore, 0), 'person-boundary must persist numeric score');
      require(summary?.scoreD1Target === 'remote', 'person-boundary scoring proof must target remote D1');
      require(summary?.reviewPipelineReviewStatus === 'complete', 'person-boundary review pipeline review step must be complete');
      require(summary?.reviewPipelineScoringStatus === 'complete', 'person-boundary review pipeline scoring step must be complete');
      require(summary?.relatedBoundaryVerified === true, 'person-boundary must verify same-person related interview boundary');
      require(summary?.relatedBoundarySelectedInterviewId === summary?.interviewId, 'person-boundary selected profile decision must point at the submitted interview');
      require(Boolean(summary?.relatedBoundaryRelatedInterviewId), 'person-boundary must include the related unsubmitted interview id');
      require(summary?.relatedBoundarySelectedRepoUrl === summary?.repoUrl, 'person-boundary selected profile repo must match the submitted review repo');
      require(String(summary?.relatedBoundarySelectedPrNumber ?? '') === String(summary?.prNumber ?? ''), 'person-boundary selected profile PR must match the submitted review PR');
      require(
        summary?.relatedBoundaryRelatedRepoUrl !== summary?.repoUrl
          || String(summary?.relatedBoundaryRelatedPrNumber ?? '') !== String(summary?.prNumber ?? ''),
        'person-boundary related interview must not be promoted as the selected recommendation',
      );
      require(finiteNumberAtLeast(summary?.relatedBoundaryScheduledCodeReviewCount, 1), 'person-boundary must expose at least one CODE_REVIEW row on the person graph');
      break;
    case 'judge-example-readiness':
      require(Boolean(summary?.databasePath), 'judge-example-readiness must include databasePath');
      require(summary?.status === 'calibration_ready', 'judge-example-readiness status must be calibration_ready');
      require(summary?.replayReady === true, 'judge-example-readiness must be replay-ready');
      require(summary?.calibrationReady === true, 'judge-example-readiness must be calibration-ready');
      require(finiteNumberAtLeast(summary?.totalExamples, 1), 'judge-example-readiness must include stored examples');
      require(finiteNumberAtLeast(summary?.labelledExamples, 1), 'judge-example-readiness must include labelled examples');
      require(finiteNumberAtLeast(summary?.replayableExamples, 1), 'judge-example-readiness must include replayable examples');
      require(finiteNumberAtLeast(summary?.calibrationReadyExamples, 1), 'judge-example-readiness must include calibration-ready examples');
      require(Number(summary?.invalidStatusExamples) === 0, 'judge-example-readiness invalid statuses must be 0');
      require(noFailures(summary?.failures), 'judge-example-readiness failures must be empty');
      require(Array.isArray(summary?.nextActions) && summary.nextActions.length === 0, 'judge-example-readiness next actions must be empty');
      require(Boolean(summary?.exampleId), 'judge-example-readiness must include an example id');
      require(Boolean(summary?.exampleSessionId), 'judge-example-readiness must include an example session id');
      require(summary?.exampleReplayable === true, 'judge-example-readiness first example must be replayable');
      require(summary?.exampleCalibrationReady === true, 'judge-example-readiness first example must be calibration-ready');
      require(finiteNumberAtLeast(summary?.exampleCommentCount, 1), 'judge-example-readiness first example must include candidate comments');
      require(finiteNumberAtLeast(summary?.examplePushbackCount, 1), 'judge-example-readiness first example must include AI pushback');
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
      require(summary?.candidateSurfaceContract === 'source-backed-code-review-challenge', 'workers-sdk-matrix candidate browser smoke must prove source-backed code-review surface');
      require(summary?.recruiterBrowserSmokeSkipped === false, 'workers-sdk-matrix recruiter browser smoke must run');
      require(summary?.recruiterReadoutContract === 'matched-code-review-hiring-manager-readout', 'workers-sdk-matrix recruiter smoke must prove matched hiring-manager readout contract');
      break;
    case 'packet-catalog-readiness':
      require(Boolean(summary?.databaseId), 'packet-catalog-readiness must include the evaluated D1 database id');
      require(finiteNumberAtLeast(summary?.productionReadyPackets, 3), 'packet-catalog-readiness must have at least 3 production-ready packets');
      require(finiteNumberAtLeast(summary?.productionReadyRepoCount, 3), 'packet-catalog-readiness must have at least 3 production-ready repos');
      require(finiteNumberAtLeast(summary?.productionReadyPullRequestCount, 3), 'packet-catalog-readiness must have at least 3 production-ready PRs');
      require(finiteNumberAtLeast(summary?.reviewProfileReadyPackets, 2), 'packet-catalog-readiness must have at least 2 persisted reviewProfile-ready packets');
      require(Array.isArray(summary?.repoNames) && summary.repoNames.length >= 3, 'packet-catalog-readiness must list at least 3 production-ready repo names');
      require(noFailures(summary?.failures), 'packet-catalog-readiness failures must be empty');
      break;
    case 'match-quality-readiness':
      require(summary?.ok === true, 'match-quality-readiness must pass the internal gate');
      require(Boolean(summary?.corpusId), 'match-quality-readiness must include corpusId');
      require(finiteNumberAtLeast(summary?.totalPairs, 3), 'match-quality-readiness must include labelled positive, negative, and contrast pairs');
      require(Number(summary?.successfulPairs) === Number(summary?.totalPairs), 'match-quality-readiness all labelled pairs must execute successfully');
      require(Number(summary?.failedPairs) === 0, 'match-quality-readiness failedPairs must be 0');
      require(finiteNumberAtLeast(summary?.negativeCaseCount, 1), 'match-quality-readiness must include negative labelled cases');
      require(finiteNumberAtLeast(summary?.insufficientEvidenceCaseCount, 1), 'match-quality-readiness must include insufficient-evidence labelled cases');
      require(finiteNumberAtLeast(summary?.contrastCaseCount, 1), 'match-quality-readiness must include contrast cases');
      require(finiteNumberAtLeast(summary?.reasonCategoryExpectationCount, 1), 'match-quality-readiness must include reason-category expectations');
      require(Number(summary?.accuracy) === 1, 'match-quality-readiness accuracy must be 1');
      require(Number(summary?.falsePositiveCount) === 0, 'match-quality-readiness falsePositiveCount must be 0');
      require(Number(summary?.falseNegativeCount) === 0, 'match-quality-readiness falseNegativeCount must be 0');
      require(finiteNumberAtLeast(summary?.averageScoreSeparation, 0.01), 'match-quality-readiness averageScoreSeparation must be positive');
      require(Number(summary?.usableChallengeRate) === 1, 'match-quality-readiness usableChallengeRate must be 1');
      require(Number(summary?.caseResultsCount) === Number(summary?.totalPairs), 'match-quality-readiness must summarize every labelled case result');
      require(Number(summary?.failedCaseCount) === 0, 'match-quality-readiness failedCases must be empty');
      require(finiteNumberAtLeast(summary?.positiveCaseCount, 1), 'match-quality-readiness must include positive labelled cases');
      require(Number(summary?.sourceBackedPrCaseCount) === Number(summary?.totalPairs), 'match-quality-readiness every labelled case must use a source-backed PR challenge');
      require(Number(summary?.repoEvidenceCaseCount) === Number(summary?.totalPairs), 'match-quality-readiness every labelled case must include repo-side provenance');
      require(Number(summary?.usableChallengeCaseCount) === Number(summary?.totalPairs), 'match-quality-readiness every labelled case must be usable as a challenge');
      require(Number(summary?.candidateEvidencePositiveCaseCount) === Number(summary?.positiveCaseCount), 'match-quality-readiness every positive labelled case must include candidate-side evidence');
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
