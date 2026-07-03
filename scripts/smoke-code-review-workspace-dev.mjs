import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import { chromium, expect } from '@playwright/test';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const execFileAsync = promisify(execFile);

const APP_BASE = (process.env.APP_BASE || 'https://app-dev.hire-pipe.com').replace(/\/$/, '');
const ROOM_BASE = (process.env.ROOM_BASE || 'https://room-dev.hire-pipe.com').replace(/\/$/, '');
const APP_BASIC_USER = process.env.PIPE_APP_DEV_BASIC_AUTH_USER
  || process.env.APP_DEV_BASIC_AUTH_USER
  || process.env.PIPE_DEV_BASIC_AUTH_USER
  || process.env.DEV_BASIC_AUTH_USER
  || '';
const APP_BASIC_PASSWORD = process.env.PIPE_APP_DEV_BASIC_AUTH_PASSWORD
  || process.env.APP_DEV_BASIC_AUTH_PASSWORD
  || process.env.PIPE_DEV_BASIC_AUTH_PASSWORD
  || process.env.DEV_BASIC_AUTH_PASSWORD
  || '';
const ROOM_BASIC_USER = process.env.PIPE_ROOM_DEV_BASIC_AUTH_USER
  || process.env.ROOM_DEV_BASIC_AUTH_USER
  || process.env.VIDEO_ROOM_DEV_AUTH_USER
  || '';
const ROOM_BASIC_PASSWORD = process.env.PIPE_ROOM_DEV_BASIC_AUTH_PASSWORD
  || process.env.ROOM_DEV_BASIC_AUTH_PASSWORD
  || process.env.VIDEO_ROOM_DEV_AUTH_PASSWORD
  || '';
const INTERVIEW_TYPE = process.env.WORKSPACE_SMOKE_INTERVIEW_TYPE || 'OPEN_SOURCE_BUG_FIX';
const CHANGE_MODE = process.env.WORKSPACE_SMOKE_CHANGE_MODE || 'mui-popover-fix';
const TASK_ALIGNED_PROFILES = {
  'mui-popover-fix': {
    repositoryUrl: 'https://github.com/mui/base-ui',
    matchedRepoId: 973,
    expectedGithubPrNumber: 973,
    baseCommitSha: '58dff8444fa56e4444a3a1dd991c76b49cf4ab7e',
    expectedHeadCommitSha: '33e161fd46dfc287dfcde05427594db9a7225335',
    upstreamPullRequestRef: 'pull/973/head',
    upstreamPullRequestBranch: 'pipe-smoke-pr-973',
    changedPaths: [
      'packages/react/src/popover/root/usePopoverRoot.ts',
      'packages/react/src/popover/trigger/PopoverTrigger.test.tsx',
      'packages/react/src/popover/utils/constants.ts',
    ],
    challengeTitle: 'Fix Base UI popover impatient click handling',
    challengeInstructions: [
      'Investigate the hover-open popover trigger behavior from Base UI PR #973.',
      'Make a focused implementation change so a trigger click within 500ms of hover-open is ignored instead of immediately closing the popover.',
      'Add or preserve regression coverage for impatient clicks versus patient clicks.',
    ].join(' '),
    challengeSuccessCriteria: [
      'The submitted diff changes the popover root/trigger behavior instead of unrelated files.',
      'The patch includes regression coverage for fast impatient clicks and patient clicks.',
      'The verification command records the changed files and diff hygiene in source-backed evidence.',
    ],
    challengeExpectedEvidence: [
      'git_commit source ref for the candidate assessment commit',
      'code_diff source ref touching usePopoverRoot, PopoverTrigger tests, and popover constants',
      'test_run source ref showing diff hygiene and changed file verification',
      'terminal_command source ref for the finalizer git/test transcript',
    ],
    narrative: 'Implemented the source-backed Base UI popover impatient-click fix, including the 500ms guard and regression tests for fast versus patient clicks.',
    testCommand: 'git diff --check HEAD~1 HEAD && git diff --name-only HEAD~1 HEAD',
    summaryTerms: ['popover', 'click'],
    challengeTextTerms: ['github.com/mui/base-ui', 'popover', '500', 'usePopoverRoot'],
    acceptedRecommendations: ['strong_evidence_to_advance', 'mixed_evidence_human_review'],
  },
};
const CHANGE_PROFILE = TASK_ALIGNED_PROFILES[CHANGE_MODE] ?? null;
const REPO_URL = process.env.WORKSPACE_SMOKE_REPO_URL || CHANGE_PROFILE?.repositoryUrl || 'https://github.com/octocat/Hello-World';
const RAW_PR_NUMBER = process.env.WORKSPACE_SMOKE_PR_NUMBER || (INTERVIEW_TYPE === 'OPEN_SOURCE_BUG_FIX' ? '' : '1');
const PR_NUMBER = RAW_PR_NUMBER ? Number(RAW_PR_NUMBER) : null;
const FORCE_MANUAL_PACKET = process.env.WORKSPACE_SMOKE_USE_MANUAL_PACKET === '1'
  || process.env.WORKSPACE_SMOKE_FORCE_MANUAL_PACKET === '1';
const RAW_MATCHED_REPO_ID = process.env.WORKSPACE_SMOKE_MATCHED_REPO_ID
  || (!FORCE_MANUAL_PACKET
    && (process.env.WORKSPACE_SMOKE_USE_MATCHED_REPO !== '0')
    && INTERVIEW_TYPE === 'OPEN_SOURCE_BUG_FIX'
    && CHANGE_PROFILE?.matchedRepoId
    ? String(CHANGE_PROFILE.matchedRepoId)
    : '');
const MATCHED_REPO_ID = RAW_MATCHED_REPO_ID ? Number(RAW_MATCHED_REPO_ID) : null;
const BASE_COMMIT_SHA = process.env.WORKSPACE_SMOKE_BASE_COMMIT_SHA || CHANGE_PROFILE?.baseCommitSha || '';
const EXPECTED_BRIDGE_REVISION = process.env.WORKSPACE_SMOKE_EXPECTED_BRIDGE_REVISION
  || '2026-06-30-assessment-branch-v1';
const REQUIRE_ROOM = process.env.WORKSPACE_SMOKE_REQUIRE_ROOM === '1';
const SKIP_RECRUITER_BROWSER = process.env.WORKSPACE_SMOKE_SKIP_RECRUITER_BROWSER === '1';
const SKIP_CANDIDATE_BROWSER = process.env.WORKSPACE_SMOKE_SKIP_CANDIDATE_BROWSER === '1';
const REMOTE = !APP_BASE.includes('localhost') && !APP_BASE.includes('127.0.0.1');

function assertEnv() {
  if (MATCHED_REPO_ID !== null && (!Number.isInteger(MATCHED_REPO_ID) || MATCHED_REPO_ID <= 0)) {
    throw new Error('WORKSPACE_SMOKE_MATCHED_REPO_ID must be a positive integer when provided.');
  }
  if (MATCHED_REPO_ID !== null && INTERVIEW_TYPE !== 'OPEN_SOURCE_BUG_FIX') {
    throw new Error('WORKSPACE_SMOKE_MATCHED_REPO_ID is only supported for OPEN_SOURCE_BUG_FIX smoke runs.');
  }
  if (!['placeholder', 'mui-popover-fix'].includes(CHANGE_MODE)) {
    throw new Error('WORKSPACE_SMOKE_CHANGE_MODE must be placeholder or mui-popover-fix.');
  }
  if (CHANGE_PROFILE && INTERVIEW_TYPE !== 'OPEN_SOURCE_BUG_FIX') {
    throw new Error(`${CHANGE_MODE} is a task-aligned OPEN_SOURCE_BUG_FIX smoke profile; set WORKSPACE_SMOKE_INTERVIEW_TYPE=OPEN_SOURCE_BUG_FIX.`);
  }
  if (
    CHANGE_PROFILE
    && FORCE_MANUAL_PACKET
    && process.env.WORKSPACE_SMOKE_MATCHED_REPO_ID
  ) {
    throw new Error('WORKSPACE_SMOKE_USE_MANUAL_PACKET cannot be combined with WORKSPACE_SMOKE_MATCHED_REPO_ID.');
  }
  if (
    CHANGE_PROFILE
    && MATCHED_REPO_ID !== null
    && CHANGE_PROFILE.matchedRepoId
    && MATCHED_REPO_ID !== CHANGE_PROFILE.matchedRepoId
  ) {
    throw new Error(`${CHANGE_MODE} expects WORKSPACE_SMOKE_MATCHED_REPO_ID=${CHANGE_PROFILE.matchedRepoId}; got ${MATCHED_REPO_ID}.`);
  }
  if (!REMOTE) return;
  if (!APP_BASIC_USER || !APP_BASIC_PASSWORD) {
    throw new Error(
      'Set PIPE_APP_DEV_BASIC_AUTH_USER/PASSWORD or PIPE_DEV_BASIC_AUTH_USER/PASSWORD to smoke deployed app-dev.',
    );
  }
  if (INTERVIEW_TYPE === 'OPEN_SOURCE_BUG_FIX' && MATCHED_REPO_ID === null && !/^[a-f0-9]{40}$/i.test(BASE_COMMIT_SHA)) {
    throw new Error(
      'Set WORKSPACE_SMOKE_BASE_COMMIT_SHA to the real 40-character base commit SHA, or set WORKSPACE_SMOKE_MATCHED_REPO_ID for matched OPEN_SOURCE_BUG_FIX smoke runs.',
    );
  }
}

async function git(args, cwd) {
  return execFileAsync('git', args, {
    cwd,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
}

async function assertReachableBaseCommit(repoUrl, baseCommitSha) {
  if (INTERVIEW_TYPE !== 'OPEN_SOURCE_BUG_FIX') return;
  if (!/^[a-f0-9]{40}$/i.test(baseCommitSha)) {
    throw new Error(`Open-source workspace smoke requires a real 40-character base commit SHA; got ${baseCommitSha || 'empty'}.`);
  }
  const dir = await mkdtemp(join(tmpdir(), 'pipe-workspace-smoke-'));
  try {
    await git(['init', '--quiet'], dir);
    await git(['remote', 'add', 'origin', repoUrl], dir);
    await git(['fetch', '--quiet', '--depth=1', 'origin', baseCommitSha], dir);
    await git(['cat-file', '-e', `${baseCommitSha}^{commit}`], dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Base commit ${baseCommitSha} is not reachable from ${repoUrl}; use a real source-backed commit before launching deployed workspace smoke. ${message}`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function basicAuthHeaders(user, password) {
  if (!user && !password) return {};
  const value = Buffer.from(`${user}:${password}`).toString('base64');
  return { Authorization: `Basic ${value}` };
}

function authHeadersFor(base) {
  return base === ROOM_BASE
    ? basicAuthHeaders(ROOM_BASIC_USER, ROOM_BASIC_PASSWORD)
    : basicAuthHeaders(APP_BASIC_USER, APP_BASIC_PASSWORD);
}

function authHeadersFromUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!url.username && !url.password) return {};
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  return basicAuthHeaders(user, password);
}

function authCredentialsFromUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!url.username && !url.password) return null;
  return {
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

function mergedRoomAuthHeaders(roomHeaders = {}) {
  return {
    ...authHeadersFor(ROOM_BASE),
    ...roomHeaders,
  };
}

function websocketUrl(base, path) {
  const url = new URL(`${base}${path}`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function websocketChunkText(data) {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  return String(data);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function waitForWorkspaceTerminalOutput(proxyBasePath, headers, command, expectedText) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(websocketUrl(ROOM_BASE, `${proxyBasePath}/terminal`), {
      headers: mergedRoomAuthHeaders(headers),
    });
    let output = '';
    let opened = false;
    let settled = false;
    let timeout = null;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      fn(value);
    };
    timeout = setTimeout(() => {
      ws.close();
      settle(reject, new Error(`Timed out waiting for terminal output "${expectedText}" after opened=${opened}. Saw:\n${output}`));
    }, 120_000);

    ws.on('open', () => {
      opened = true;
      ws.send(JSON.stringify({ type: 'TERMINAL_INPUT', data: `${command}\r` }));
    });
    ws.on('message', (data) => {
      output += websocketChunkText(data);
      if (!output.includes(expectedText)) return;
      ws.close();
      settle(resolve, output);
    });
    ws.on('error', (error) => {
      settle(reject, error);
    });
    ws.on('unexpected-response', (_request, response) => {
      settle(reject, new Error(`Terminal WebSocket upgrade failed with HTTP ${response.statusCode}.`));
    });
    ws.on('close', () => {
      if (!settled) {
        settle(reject, new Error(`Terminal WebSocket closed before output "${expectedText}" after opened=${opened}. Saw:\n${output}`));
      }
    });
  });
}

async function commitWorkspaceSmokeChange(proxyBasePath, headers, unique) {
  const sentinel = `__PIPE_COMMIT_OK_${unique}__`;
  const common = [
    'set -e',
    'git config user.name "PIPE Workspace Smoke"',
    'git config user.email "workspace-smoke@pipe-test.dev"',
  ];
  const modeSpecific = CHANGE_MODE === 'mui-popover-fix'
    ? [
        `git fetch --quiet origin ${CHANGE_PROFILE.upstreamPullRequestRef}:${CHANGE_PROFILE.upstreamPullRequestBranch}`,
        `git checkout ${CHANGE_PROFILE.upstreamPullRequestBranch} -- ${CHANGE_PROFILE.changedPaths.join(' ')}`,
        'git diff --check',
        `git add ${CHANGE_PROFILE.changedPaths.join(' ')}`,
        `git commit -m ${shellQuote('fix popover impatient click handling')}`,
      ]
    : [
        `printf ${shellQuote(`\nPIPE workspace smoke ${unique}\n`)} >> PIPE_WORKSPACE_SMOKE.md`,
        'git add PIPE_WORKSPACE_SMOKE.md',
        `git commit -m ${shellQuote(`pipe workspace smoke ${unique}`)}`,
      ];
  const command = [
    ...common,
    ...modeSpecific,
    `printf ${shellQuote(`${sentinel}%s${sentinel}\\n`)} "$(git rev-parse HEAD)"`,
  ].join(' && ');
  const output = await waitForWorkspaceTerminalOutput(proxyBasePath, headers, command, sentinel);
  const match = output.match(new RegExp(`${sentinel}([a-f0-9]{40})${sentinel}`));
  if (!match) {
    throw new Error(`Terminal command completed without a parseable commit SHA. Saw:\n${output}`);
  }
  return {
    commitSha: match[1],
    mode: CHANGE_MODE,
    narrative: CHANGE_PROFILE?.narrative ?? `Workspace smoke submitted real commit ${match[1]}.`,
    testCommand: CHANGE_PROFILE?.testCommand ?? 'git status --short',
    output,
  };
}

async function requestJson(base, path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...authHeadersFor(base),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${base}${path} failed (${response.status}): ${text}`);
  }
  return body;
}

function isTransientFetchError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const causeCode = error instanceof Error && error.cause && typeof error.cause === 'object'
    ? error.cause.code
    : null;
  const errorName = error instanceof Error ? error.name : '';
  return message.includes('fetch failed')
    || message.includes('timed out')
    || message.includes('timeout')
    || errorName === 'AbortError'
    || causeCode === 'UND_ERR_SOCKET'
    || causeCode === 'ECONNRESET'
    || causeCode === 'EPIPE'
    || causeCode === 'ECONNREFUSED';
}

async function startAssessmentEvaluationWithRetry(interviewId) {
  let lastError = null;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestJson(APP_BASE, `/api/v1/scheduling/interviews/${interviewId}/assessment/start-evaluation`, {
        method: 'POST',
      });
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes('/assessment/start-evaluation failed (500)')
        && !isTransientFetchError(error)
      ) {
        throw error;
      }
      await sleep(1_000 * attempt);
    }
  }
  throw lastError;
}

async function pollAssessmentEvaluationComplete(interviewId) {
  const deadline = Date.now() + 300_000;
  let lastProgress = null;
  while (Date.now() < deadline) {
    const detail = await requestJson(APP_BASE, `/api/v1/scheduling/interviews/${interviewId}`);
    const progress = detail?.interview?.assessmentProgress ?? null;
    lastProgress = progress;
    if (
      progress?.stage === 'EVALUATED'
      && progress?.nextAction === 'REVIEW_EVALUATION'
      && progress?.evaluation?.status === 'EVALUATED'
    ) {
      return progress;
    }
    if (progress?.stage === 'NEEDS_ATTENTION' || progress?.nextAction === 'RESOLVE_DIAGNOSTIC') {
      throw new Error(`Workspace assessment evaluation reached a diagnostic state: ${JSON.stringify(progress)}`);
    }
    await sleep(5_000);
  }
  throw new Error(`Workspace assessment evaluation did not complete. Last progress: ${JSON.stringify(lastProgress)}`);
}

function tokenFromRoomUrl(rawUrl) {
  const url = new URL(rawUrl);
  const match = url.pathname.match(/\/room\/([^/]+)/);
  if (!match) throw new Error(`Room URL did not contain a token: ${rawUrl}`);
  return match[1];
}

function cleanRoomUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.username = '';
  url.password = '';
  return url.toString().replace(/\/room\/.+$/, '/room/<token>');
}

function roomUrlWithoutCredentials(rawUrl) {
  const url = new URL(rawUrl);
  url.username = '';
  url.password = '';
  return url.toString();
}

function cleanMaybeAssessUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  try {
    const url = new URL(rawUrl);
    url.username = '';
    url.password = '';
    return url.toString().replace(/\/assess\/[^/?#]+/, '/assess/<token>');
  } catch {
    return null;
  }
}

function githubCompareUrl({ commitUrl, baseCommitSha, commitSha }) {
  const base = typeof baseCommitSha === 'string' ? baseCommitSha.trim() : '';
  const head = typeof commitSha === 'string' ? commitSha.trim() : '';
  const externalCommitUrl = typeof commitUrl === 'string' ? commitUrl.trim() : '';
  if (!externalCommitUrl || !/^[a-f0-9]{7,40}$/i.test(base) || !/^[a-f0-9]{7,40}$/i.test(head)) return null;

  try {
    const url = new URL(externalCommitUrl);
    if (url.hostname !== 'github.com') return null;
    const parts = url.pathname
      .replace(/\.git$/i, '')
      .split('/')
      .filter(Boolean);
    if (parts.length < 4 || parts[2] !== 'commit' || parts[3].toLowerCase() !== head.toLowerCase()) return null;
    return `https://github.com/${parts[0]}/${parts[1]}/compare/${base}...${head}`;
  } catch {
    return null;
  }
}

function repoLabelFromUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  try {
    const url = new URL(rawUrl);
    const parts = url.pathname
      .replace(/\.git$/i, '')
      .split('/')
      .filter(Boolean);
    if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  } catch {
    return null;
  }
  return null;
}

function sourceRefCount(rows, kind) {
  return rows.find((row) => row.kind === kind)?.count ?? 0;
}

async function assertRecruiterAssessmentProjection(interviewId, workspaceCommit, expectedBaseCommitSha) {
  const detail = await requestJson(APP_BASE, `/api/v1/scheduling/interviews/${interviewId}`);
  const progress = detail?.interview?.assessmentProgress ?? null;
  const commit = progress?.commit ?? null;
  if (!progress || !commit) {
    throw new Error(`Recruiter detail did not expose assessment commit progress: ${JSON.stringify(detail?.interview)}`);
  }
  if (commit.commitSha !== workspaceCommit.commitSha) {
    throw new Error(`Recruiter detail exposed the wrong submitted commit: ${JSON.stringify(commit)}`);
  }
  if (commit.baseCommitSha !== expectedBaseCommitSha) {
    throw new Error(`Recruiter detail exposed the wrong base commit: ${JSON.stringify(commit)}`);
  }
  if (!commit.repositoryUrl) {
    throw new Error(`Recruiter detail did not expose a repository for commit review: ${JSON.stringify(commit)}`);
  }
  if (commit.integrity?.status !== 'workspace_captured' || commit.integrity?.tone !== 'verified') {
    throw new Error(`Recruiter detail did not expose trusted workspace commit integrity: ${JSON.stringify(commit.integrity)}`);
  }
  if (commit.challengeBinding?.status !== 'bound_to_assigned_challenge' || commit.challengeBinding?.tone !== 'verified') {
    throw new Error(`Recruiter detail did not bind the commit to the assigned challenge: ${JSON.stringify(commit.challengeBinding)}`);
  }
  const hasRecordedHumanDecision = progress.humanDecision?.decision;
  const isExpectedEvaluatedState = progress.stage === 'EVALUATED'
    && (progress.nextAction === 'REVIEW_EVALUATION'
      || (progress.nextAction === 'NONE' && hasRecordedHumanDecision));
  if (!isExpectedEvaluatedState) {
    throw new Error(`Recruiter detail did not expose the evaluated review state: ${JSON.stringify(progress)}`);
  }
  const compareUrl = githubCompareUrl({
    commitUrl: commit.commitUrl,
    baseCommitSha: commit.baseCommitSha,
    commitSha: commit.commitSha,
  });
  const capturedDiffSnippet = (progress.evidenceSnippets ?? []).find((snippet) =>
    snippet.sourceRefType === 'code_diff'
    && typeof snippet.exactText === 'string'
    && snippet.exactText.trim().length > 0
  ) ?? null;
  const sourceRefTypes = new Set((progress.sourceRefCounts ?? []).map((row) => row.kind));
  for (const requiredSourceRefType of [
    'git_commit',
    'code_diff',
    'test_run',
    'dev_container_workspace_launch',
    'terminal_command',
    'code_server_file_observation',
    'meeting_session_event',
    'room_chat_message',
  ]) {
    if (!sourceRefTypes.has(requiredSourceRefType)) {
      throw new Error(`Recruiter detail is missing ${requiredSourceRefType} proof for source-backed review: ${JSON.stringify(progress.sourceRefCounts)}`);
    }
  }
  if (commit.commitUrl && !compareUrl) {
    throw new Error(`Recruiter detail cannot produce a GitHub compare URL from external commit metadata: ${JSON.stringify(commit)}`);
  }
  if (!compareUrl) {
    if (!capturedDiffSnippet) {
      throw new Error(`Recruiter detail has no compare URL and no captured code_diff exact text: ${JSON.stringify(progress.evidenceSnippets)}`);
    }
    if (!capturedDiffSnippet.exactText.includes('diff --git')) {
      throw new Error(`Recruiter detail captured code_diff does not look reviewable: ${capturedDiffSnippet.exactText.slice(0, 240)}`);
    }
  }

  return {
    compareUrl,
    capturedDiffSnippet,
    sourceRefCounts: progress.sourceRefCounts ?? [],
    humanDecision: progress.humanDecision ?? null,
  };
}

function humanDecisionForRecommendation(recommendation) {
  if (recommendation === 'strong_evidence_to_advance') return 'advance';
  if (recommendation === 'insufficient_evidence' || recommendation === 'not_demonstrated') {
    return 'needs_more_evidence';
  }
  return 'hold';
}

function humanDecisionLabel(decision) {
  if (decision === 'needs_more_evidence') return 'Human: needs more evidence';
  return `Human: ${decision}`;
}

async function recordHumanAssessmentDecision(interviewId, workspaceCommit, recommendation) {
  const decision = humanDecisionForRecommendation(recommendation);
  const commitShort = workspaceCommit.commitSha.slice(0, 12);
  const summary = decision === 'advance'
    ? `Advance after reviewing source-backed commit ${commitShort}, diff, test evidence, and evaluator report.`
    : `Hold for reviewer calibration after inspecting source-backed commit ${commitShort}, diff, tests, and evaluator cautions.`;
  const notes = [
    'Workspace smoke records this decision through the same recruiter API used by the UI.',
    'The decision must attach to the latest evaluated assessment report as source-backed evidence.',
  ].join(' ');

  const body = await requestJson(APP_BASE, `/api/v1/scheduling/interviews/${interviewId}/assessment/human-decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, summary, notes }),
  });
  const recorded = body?.decision ?? null;
  const progress = body?.progress ?? null;
  if (recorded?.decision !== decision || progress?.humanDecision?.decision !== decision) {
    throw new Error(`Human decision response did not echo the recorded decision: ${JSON.stringify(body)}`);
  }
  if (!Number.isInteger(recorded.sourceRefCount) || recorded.sourceRefCount < 1) {
    throw new Error(`Human decision did not include source-backed report refs: ${JSON.stringify(recorded)}`);
  }
  if (!Array.isArray(recorded.sourceRefTypes) || !recorded.sourceRefTypes.includes('assessment_evaluation_report')) {
    throw new Error(`Human decision was not anchored to the assessment evaluation report: ${JSON.stringify(recorded)}`);
  }
  if (progress.nextAction !== 'NONE' || progress.stage !== 'EVALUATED') {
    throw new Error(`Human decision did not leave the assessment in a completed review state: ${JSON.stringify(progress)}`);
  }

  return {
    decision,
    summary,
    sourceRefCount: recorded.sourceRefCount,
    sourceRefTypes: recorded.sourceRefTypes,
    nextAction: progress.nextAction,
  };
}

async function assertRecruiterReviewerReceiptBrowser(
  interviewId,
  workspaceCommit,
  submittedBranchName,
  humanDecision,
  recruiterProjection,
  matchedAssignmentProofText,
) {
  if (SKIP_RECRUITER_BROWSER) {
    return { skipped: true, reason: 'WORKSPACE_SMOKE_SKIP_RECRUITER_BROWSER=1' };
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...(REMOTE ? { httpCredentials: { username: APP_BASIC_USER, password: APP_BASIC_PASSWORD } } : {}),
    viewport: { width: 1440, height: 1000 },
  });

  try {
    const page = await context.newPage();
    await page.goto(`${APP_BASE}/interviews/${interviewId}?workspaceSmoke=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    const assignment = page.getByTestId('interview-assessment-assignment');
    await expect(assignment).toBeVisible({ timeout: 60_000 });
    if (MATCHED_REPO_ID !== null) {
      await expect(assignment).toContainText('PIPE-matched challenge');
      await expect(assignment).toContainText('source-backed candidate evidence');
      if (matchedAssignmentProofText) {
        await expect(assignment).toContainText(matchedAssignmentProofText);
      }
      await expect(assignment).not.toContainText('Manual task assignment');
    } else if (INTERVIEW_TYPE === 'OPEN_SOURCE_BUG_FIX') {
      await expect(assignment).toContainText('Manual task assignment');
      await expect(assignment).toContainText('not as proof that PIPE automatically matched');
    }

    const receipt = page.getByTestId('interview-assessment-reviewer-receipt');
    await expect(receipt).toBeVisible({ timeout: 60_000 });
    await expect(receipt).toContainText('Reviewer receipt');
    await expect(receipt).toContainText('Final human decision tied back to the exact assessment report and commit evidence.');
    await expect(receipt).toContainText('Final decision');
    await expect(receipt).toContainText(humanDecisionLabel(humanDecision.decision));
    await expect(receipt).toContainText('Decision anchor');
    await expect(receipt).toContainText('Assessment evaluation report');
    await expect(receipt).toContainText('Commit reviewed');
    await expect(receipt).toContainText(workspaceCommit.commitSha.slice(0, 10));
    const repoLabel = repoLabelFromUrl(REPO_URL);
    if (repoLabel) await expect(receipt).toContainText(repoLabel);
    if (submittedBranchName) await expect(receipt).toContainText(`Branch ${submittedBranchName}`);
    await expect(receipt).toContainText('Recorded by');
    await expect(receipt).toContainText('Human reviewer');
    await expect(receipt).not.toContainText('dev-user');
    const workPacket = page.getByTestId('interview-assessment-work-packet');
    await expect(workPacket).toBeVisible({ timeout: 60_000 });
    await expect(workPacket).toContainText('Process telemetry');
    await expect(workPacket).toContainText('Workspace/tool telemetry captured');
    await expect(workPacket).toContainText('workspace launch');
    await expect(workPacket).toContainText('terminal command');
    if (sourceRefCount(recruiterProjection.sourceRefCounts, 'code_server_file_observation') > 0) {
      await expect(workPacket).toContainText('file observation');
    }
    await expect(workPacket).toContainText('Collaboration');
    await expect(workPacket).toContainText('Room chat captured');
    if (!recruiterProjection.compareUrl) {
      const capturedDiff = page.getByTestId('interview-assessment-captured-diff');
      await expect(capturedDiff).toBeVisible({ timeout: 60_000 });
      await expect(capturedDiff).toContainText('Captured source-backed diff');
      await expect(capturedDiff).toContainText('diff --git');
      const capturedText = recruiterProjection.capturedDiffSnippet?.exactText ?? '';
      const expectedDiffNeedles = CHANGE_PROFILE?.changedPaths?.slice(0, 2) ?? ['PIPE_WORKSPACE_SMOKE.md'];
      for (const needle of expectedDiffNeedles) {
        if (capturedText.includes(needle)) {
          await expect(capturedDiff).toContainText(needle);
        }
      }
      await expect(page.getByRole('link', { name: 'Compare base to submitted commit' })).toHaveCount(0);
    }

    return { skipped: false };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function assertRecruiterListCardBrowser(
  interviewId,
  workspaceCommit,
  expectedBaseCommitSha,
  humanDecision,
  expectedTaskTitle,
  recruiterProjection,
  matchedAssignmentProofText,
) {
  if (SKIP_RECRUITER_BROWSER) {
    return { skipped: true, reason: 'WORKSPACE_SMOKE_SKIP_RECRUITER_BROWSER=1' };
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...(REMOTE ? { httpCredentials: { username: APP_BASIC_USER, password: APP_BASIC_PASSWORD } } : {}),
    viewport: { width: 1440, height: 1000 },
  });

  try {
    const page = await context.newPage();
    await page.goto(`${APP_BASE}/interviews?workspaceSmoke=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    const card = page.locator(`[data-testid="interview-card"][data-interview-id="${interviewId}"]`);
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText('Workspace Smoke');
    await expect(card).toContainText('Open-source bug fix');
    await expect(card).toContainText('ASSESSMENT');
    await expect(card).toContainText('Evaluated');
    await expect(card).toContainText('DECISION');
    await expect(card).toContainText(humanDecisionLabel(humanDecision.decision));
    await expect(card).toContainText('NEXT');
    await expect(card).toContainText('No further assessment action is required');
    await expect(card).toContainText('REPO');
    const repoLabel = repoLabelFromUrl(REPO_URL);
    if (repoLabel) await expect(card).toContainText(repoLabel);
    await expect(card).toContainText('BASE');
    await expect(card).toContainText(expectedBaseCommitSha.slice(0, 12));
    await expect(card).toContainText('TASK');
    if (expectedTaskTitle) {
      await expect(card).toContainText(expectedTaskTitle);
    }
    if (MATCHED_REPO_ID !== null) {
      await expect(card).toContainText('PIPE-matched challenge');
      await expect(card).toContainText('source-backed candidate evidence');
      if (matchedAssignmentProofText) {
        await expect(card).toContainText(matchedAssignmentProofText);
      }
      await expect(card).not.toContainText('Manual task assignment');
    } else if (INTERVIEW_TYPE === 'OPEN_SOURCE_BUG_FIX') {
      await expect(card).toContainText('Manual task assignment');
      await expect(card).toContainText('not as proof that PIPE automatically matched');
    }
    await expect(card).toContainText('EXPECTED');
    await expect(card).toContainText('git_commit source ref');
    await expect(card).toContainText('COMMIT');
    await expect(card).toContainText(workspaceCommit.commitSha.slice(0, 12));
    await expect(card).toContainText('COMMIT TRUST');
    await expect(card).toContainText('Workspace-captured commit');
    await expect(card).toContainText('Bound to assigned challenge');
    await expect(card).toContainText('REVIEW ARTIFACT');
    if (recruiterProjection.compareUrl) {
      await expect(card).toContainText('GitHub commit available');
      await expect(card).toContainText('External commit URL is captured');
    } else {
      await expect(card).toContainText('Captured diff available');
      await expect(card).toContainText('Workspace-only commit has exact code_diff source evidence ready for review.');
    }
    await expect(card).toContainText('PROCESS');
    await expect(card).toContainText('Workspace telemetry captured');
    await expect(card).toContainText('terminal command');
    if (sourceRefCount(recruiterProjection.sourceRefCounts, 'code_server_file_observation') > 0) {
      await expect(card).toContainText('file observation');
    }
    await expect(card).toContainText('CHAT');
    await expect(card).toContainText('Room chat captured');
    await expect(card).toContainText('EVAL');
    await expect(card).toContainText('Evaluated');
    await expect(card).not.toContainText('assessment-session');
    await expect(card).not.toContainText('assessment_evaluation_report_');

    return { skipped: false };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function enterRoomFromPrejoinIfNeeded(page) {
  const taskBrief = page.getByTestId('assessment-task-brief');
  const enterWithoutDevices = page.getByRole('button', { name: 'Enter without mic/camera' });
  const firstReadySurface = await Promise.race([
    taskBrief.waitFor({ state: 'attached', timeout: 60_000 }).then(() => 'task').catch(() => null),
    enterWithoutDevices.waitFor({ state: 'visible', timeout: 60_000 }).then(() => 'prejoin').catch(() => null),
  ]);

  if (firstReadySurface === 'task') return;

  if (firstReadySurface === 'prejoin') {
    await enterWithoutDevices.click();
    return;
  }

  const enterRoom = page.getByRole('button', { name: /enter room|join room|join/i });
  if (await enterRoom.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await enterRoom.click();
  }
}

async function assertCandidateTaskBriefBrowser(
  guestUrl,
  expectedRepoUrl,
  expectedBaseCommitSha,
  options = {},
) {
  const { expectWorkspaceReady = false } = options;
  if (SKIP_CANDIDATE_BROWSER) {
    return { skipped: true, reason: 'WORKSPACE_SMOKE_SKIP_CANDIDATE_BROWSER=1' };
  }

  const roomCredentials = authCredentialsFromUrl(guestUrl);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...(REMOTE && roomCredentials
      ? { httpCredentials: roomCredentials }
      : {}),
    viewport: { width: 1440, height: 1000 },
  });

  try {
    const page = await context.newPage();
    const url = new URL(roomUrlWithoutCredentials(guestUrl));
    url.searchParams.set('workspaceSmoke', String(Date.now()));
    await page.goto(url.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await enterRoomFromPrejoinIfNeeded(page);

    const assessmentHeader = page.getByTestId('standard-assessment-header');
    const statusStrip = assessmentHeader.getByTestId('assessment-status-strip');
    await expect(statusStrip).toBeVisible({ timeout: 60_000 });
    await expect(statusStrip).toHaveAttribute('data-assessment-mode', 'dev_container_assessment');
    await expect(statusStrip).toContainText('Dev-container assessment');

    const brief = page.getByTestId('assessment-task-brief');
    await expect(brief).toBeVisible({ timeout: 60_000 });
    await expect(brief).toContainText('Assessment task');
    await expect(brief).toContainText('Open-source implementation');
    const repoLabel = repoLabelFromUrl(expectedRepoUrl);
    if (repoLabel) {
      await expect(brief).toContainText(repoLabel);
      await expect(assessmentHeader.getByTestId('assessment-repo')).toContainText(repoLabel);
    }
    if (expectedBaseCommitSha) {
      await expect(brief).toContainText(expectedBaseCommitSha.slice(0, 10));
      await expect(assessmentHeader.getByTestId('assessment-base-commit')).toContainText(
        expectedBaseCommitSha.slice(0, 8),
      );
    }
    await expect(brief).toContainText('Task');
    await expect(brief).toContainText('Success criteria');
    await expect(brief).toContainText('Expected evidence');
    await expect(assessmentHeader.getByTestId('assessment-progress-coverage')).toContainText('challenge', {
      timeout: 60_000,
    });
    await expect(assessmentHeader.getByTestId('assessment-ai-usage-state')).toContainText(
      /AI response captured|AI prompt captured|AI prompt blocked|AI bridge trace captured|No AI use captured/,
      { timeout: 60_000 },
    );

    if (CHANGE_PROFILE) {
      await expect(brief).toContainText('popover');
      await expect(brief).toContainText('git_commit');
      await expect(brief).toContainText('code_diff');
      await expect(assessmentHeader.getByTestId('assessment-next-action')).toContainText('popover');
    }

    if (expectWorkspaceReady) {
      await expect(assessmentHeader.getByTestId('assessment-workspace-status')).toContainText('Workspace ready', {
        timeout: 60_000,
      });
      await expect(assessmentHeader.getByTestId('assessment-open-submission')).toContainText('Submit Work');
      await expect(page.getByTestId('standard-open-submission')).toContainText('Submit Work');
    }

    return { skipped: false };
  } finally {
    await context.close();
    await browser.close();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollWorkspaceReady(token, headers = {}) {
  const deadline = Date.now() + 240_000;
  let last = null;
  while (Date.now() < deadline) {
    const body = await requestJson(ROOM_BASE, `/api/v1/meeting-rooms/${token}/workspace`, {
      headers,
    });
    last = body.workspace?.session ?? null;
    if (last?.status === 'READY' || last?.status === 'SLEEPING') return last;
    if (last?.status === 'ERROR') break;
    await sleep(5_000);
  }
  throw new Error(`Workspace did not become ready. Last state: ${JSON.stringify(last)}`);
}

async function launchWorkspace(token, headers = {}) {
  const launched = await requestJson(ROOM_BASE, `/api/v1/meeting-rooms/${token}/workspace/launch`, {
    method: 'POST',
    headers,
  });
  if (!launched?.workspace?.session?.sessionId) {
    throw new Error(`Launch response missing session: ${JSON.stringify(launched)}`);
  }
  return launched;
}

async function launchWorkspaceUntilReady(token, headers = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await launchWorkspace(token, headers);
    try {
      return await pollWorkspaceReady(token, headers);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= 2 || !message.includes('container is not running')) {
        throw error;
      }
      await sleep(5_000);
    }
  }
  throw lastError ?? new Error('Workspace did not become ready.');
}

async function recordSourceBackedRoomChatEvidence(token, headers, unique) {
  const text = `I would verify the assigned task before changing code. workspace smoke ${unique}`;
  const messageCreatedAt = Date.now();
  const roomMessageId = `workspace-smoke-chat-${unique}`;
  const clientId = `workspace-smoke-client-${unique}`;
  const body = await requestJson(ROOM_BASE, `/api/v1/meeting-rooms/${token}/session-events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'chat_message',
      text,
      actor: 'guest',
      properties: {
        source: 'room_chat_client_submit',
        chatEventSource: 'browser_room_chat_panel',
        actor: 'guest',
        roomMessageId,
        clientId,
        messageCreatedAt,
        messageLength: text.length,
        deliveryStatus: 'accepted',
        surface: 'standard',
        roomPhase: 'connected',
        durableObjectReplayExpected: true,
      },
    }),
  });
  const progress = body?.progress ?? null;
  if (body?.captured !== true || !body?.nodeId) {
    throw new Error(`Room chat evidence was not accepted as a source-backed session event: ${JSON.stringify(body)}`);
  }
  if (progress?.hasMessageEvidence !== true || progress?.hasWorkEvidence !== true) {
    throw new Error(`Room chat evidence did not update assessment message/work proof: ${JSON.stringify(progress)}`);
  }
  const sourceRefTypes = new Set((progress.sourceRefCounts ?? []).map((row) => row.kind));
  for (const requiredSourceRefType of ['meeting_session_event', 'room_chat_message']) {
    if (!sourceRefTypes.has(requiredSourceRefType)) {
      throw new Error(`Room chat evidence missed ${requiredSourceRefType} source ref: ${JSON.stringify(progress.sourceRefCounts)}`);
    }
  }
  if (progress.latestEvent?.kind !== 'message') {
    throw new Error(`Room chat evidence was not the latest message event: ${JSON.stringify(progress.latestEvent)}`);
  }
  return {
    nodeId: body.nodeId,
    text,
    roomMessageId,
    sourceRefTypes: [...sourceRefTypes].sort(),
  };
}

async function main() {
  assertEnv();

  const unique = Date.now();
  const recipientEmail = `workspace-smoke-${unique}@pipe-test.dev`;
  const useMatchedRepo = MATCHED_REPO_ID !== null;
  const openSourceTaskFields = INTERVIEW_TYPE === 'OPEN_SOURCE_BUG_FIX' && !useMatchedRepo
    ? CHANGE_PROFILE
      ? {
          challengeBaseCommitSha: BASE_COMMIT_SHA,
          challengeTitle: CHANGE_PROFILE.challengeTitle,
          challengeInstructions: CHANGE_PROFILE.challengeInstructions,
          challengeSuccessCriteria: CHANGE_PROFILE.challengeSuccessCriteria,
          challengeExpectedEvidence: CHANGE_PROFILE.challengeExpectedEvidence,
          challengeVerificationCommand: CHANGE_PROFILE.testCommand,
        }
      : {
          challengeBaseCommitSha: BASE_COMMIT_SHA,
          challengeTitle: 'Fix deterministic smoke ordering',
          challengeInstructions: 'Make the smallest production-ready change that preserves source-backed evidence and deterministic execution.',
          challengeSuccessCriteria: [
            'Reproduce the ordering failure before changing code.',
            'Keep the fix scoped to the affected behavior.',
            'Leave a clear verification trail for the reviewer.',
          ],
          challengeExpectedEvidence: [
            'Changed files and commit SHA',
            'Test or command output',
            'Candidate explanation of trade-offs',
          ],
        }
    : {};
  const challengeAssignmentFields = useMatchedRepo
    ? { matchedRepoId: MATCHED_REPO_ID }
    : {
        githubRepoUrl: REPO_URL,
        ...(PR_NUMBER ? { githubPrNumber: PR_NUMBER } : {}),
      };
  const created = await requestJson(APP_BASE, '/api/v1/scheduling/interviews', {
    method: 'POST',
    body: JSON.stringify({
      recipientName: 'Workspace Smoke',
      recipientEmail,
      meetingType: 'DIRECT_VIDEO_CALL',
      interviewType: INTERVIEW_TYPE,
      ...challengeAssignmentFields,
      ...openSourceTaskFields,
    }),
  });
  const interviewId = created?.interview?.id;
  if (!interviewId) throw new Error(`Create response missing interview id: ${JSON.stringify(created)}`);
  const expectedRepoUrl = useMatchedRepo
    ? created?.interview?.githubRepoUrl
    : REPO_URL;
  const expectedGithubPrNumber = useMatchedRepo
    ? created?.interview?.githubPrNumber ?? null
    : PR_NUMBER;
  const expectedBaseCommitSha = useMatchedRepo
    ? created?.interview?.assessmentProgress?.challenge?.locator?.baseCommitSha ?? ''
    : BASE_COMMIT_SHA;
  let matchedAssignmentProofText = null;
  if (INTERVIEW_TYPE === 'OPEN_SOURCE_BUG_FIX') {
    const setup = created?.interview?.assessmentSetup;
    matchedAssignmentProofText = useMatchedRepo && typeof setup?.message === 'string'
      ? setup.message
      : null;
    const expectedSetupKind = useMatchedRepo ? 'auto_match' : 'manual_open_source_task';
    if (setup?.kind !== expectedSetupKind || setup?.status !== 'reviewable_task_assigned') {
      throw new Error(`Open-source task setup was not ready: ${JSON.stringify(setup)}`);
    }
    if (!expectedRepoUrl) {
      throw new Error(`Open-source task did not expose a repository URL: ${JSON.stringify(created?.interview)}`);
    }
    if (created?.interview?.assessmentProgress?.challenge?.sourceRefType !== (useMatchedRepo ? 'review_challenge_packet' : 'open_source_challenge_packet')) {
      throw new Error(`Open-source task did not expose the expected challenge source ref: ${JSON.stringify(created?.interview?.assessmentProgress)}`);
    }
    if (CHANGE_PROFILE) {
      const challenge = created?.interview?.assessmentProgress?.challenge ?? null;
      const challengeText = String(challenge?.exactText ?? '');
      const missingTerms = CHANGE_PROFILE.challengeTextTerms.filter((term) => !challengeText.includes(term));
      if (missingTerms.length > 0) {
        throw new Error(`Task-aligned challenge packet missed expected terms ${missingTerms.join(', ')}: ${challengeText}`);
      }
      const locator = challenge?.locator ?? {};
      const locatorBaseCommitSha = typeof locator.baseCommitSha === 'string'
        ? locator.baseCommitSha.toLowerCase()
        : '';
      if (locatorBaseCommitSha !== CHANGE_PROFILE.baseCommitSha) {
        throw new Error(`Task-aligned challenge packet used the wrong base commit: ${JSON.stringify(locator)}`);
      }
      if (useMatchedRepo) {
        if (created?.interview?.matchedRepoId !== CHANGE_PROFILE.matchedRepoId) {
          throw new Error(`Task-aligned matched smoke used the wrong repo id: ${JSON.stringify(created?.interview)}`);
        }
        if (expectedGithubPrNumber !== CHANGE_PROFILE.expectedGithubPrNumber) {
          throw new Error(`Task-aligned matched smoke used the wrong PR: ${JSON.stringify(created?.interview)}`);
        }
        const locatorHeadCommitSha = typeof locator.headCommitSha === 'string'
          ? locator.headCommitSha.toLowerCase()
          : '';
        if (locatorHeadCommitSha !== CHANGE_PROFILE.expectedHeadCommitSha) {
          throw new Error(`Task-aligned matched smoke used the wrong PR head commit: ${JSON.stringify(locator)}`);
        }
        if (challenge?.sourceRefType !== 'review_challenge_packet') {
          throw new Error(`Task-aligned matched smoke did not use a review challenge packet: ${JSON.stringify(challenge)}`);
        }
      }
    }
    await assertReachableBaseCommit(expectedRepoUrl, expectedBaseCommitSha);
  }

  const invited = await requestJson(APP_BASE, `/api/v1/scheduling/interviews/${interviewId}/invite`, {
    method: 'POST',
    body: JSON.stringify({
      email: recipientEmail,
      message: 'Automated dev smoke for the PIPE live code-review workspace.',
    }),
  });
  if (!invited?.room?.hostUrl) {
    if (INTERVIEW_TYPE !== 'CODE_REVIEW') {
      throw new Error(`Workspace smoke expected a room-backed ${INTERVIEW_TYPE} invite but received: ${JSON.stringify({
        interviewId,
        deliveredUrl: cleanMaybeAssessUrl(invited?.deliveredUrl ?? invited?.meetingUrl),
        meetingUrl: cleanMaybeAssessUrl(invited?.meetingUrl),
      })}`);
    }
    const proof = {
      ok: true,
      skipped: true,
      reason: 'assessment_only_handoff',
      interviewId,
      interviewType: INTERVIEW_TYPE,
      deliveredUrl: cleanMaybeAssessUrl(invited?.deliveredUrl ?? invited?.meetingUrl),
      message: 'CODE_REVIEW delivered an assessment-only link. This is expected for the current CODE_REVIEW /assess boundary; set WORKSPACE_SMOKE_REQUIRE_ROOM=1 to fail instead.',
    };
    if (REQUIRE_ROOM) {
      throw new Error(`Workspace smoke requires a room-backed invite but received assessment-only handoff: ${JSON.stringify(proof)}`);
    }
    console.log(JSON.stringify(proof, null, 2));
    return;
  }
  const hostToken = tokenFromRoomUrl(invited?.room?.hostUrl ?? '');
  const roomAuthHeaders = authHeadersFromUrl(invited?.room?.hostUrl ?? '');
  const room = await requestJson(ROOM_BASE, `/api/v1/meeting-rooms/${hostToken}`, {
    headers: roomAuthHeaders,
  });
  const workspace = room?.room?.workspace;
  if (!workspace?.enabled) throw new Error(`Workspace was not enabled: ${JSON.stringify(workspace)}`);
  if (workspace.repoUrl !== expectedRepoUrl) {
    throw new Error(`Workspace repo mismatch: ${JSON.stringify(workspace)}`);
  }
  if (INTERVIEW_TYPE === 'OPEN_SOURCE_BUG_FIX') {
    const challenge = workspace.challenge;
    if (challenge?.status !== 'repo_task_assigned' || challenge?.source !== 'scheduled_interview.challenge_packet') {
      throw new Error(`Workspace challenge did not expose the repo task packet: ${JSON.stringify(challenge)}`);
    }
    if (challenge?.packet?.locator?.baseCommitSha !== expectedBaseCommitSha) {
      throw new Error(`Workspace packet base commit mismatch: ${JSON.stringify(challenge?.packet)}`);
    }
  }
  const readySession = await launchWorkspaceUntilReady(hostToken, roomAuthHeaders);
  if (!readySession.proxyPath) {
    throw new Error(`Ready workspace did not expose a proxy path: ${JSON.stringify(readySession)}`);
  }
  const proxyBasePath = readySession.proxyPath.replace(/\/$/, '');
  const bridgeHealth = await requestJson(ROOM_BASE, `${proxyBasePath}/health`, {
    headers: roomAuthHeaders,
  });
  if (bridgeHealth?.ok !== true) {
    throw new Error(`Workspace bridge health check failed: ${JSON.stringify(bridgeHealth)}`);
  }
  if (REMOTE && bridgeHealth.bridgeRevision !== EXPECTED_BRIDGE_REVISION) {
    throw new Error(
      `Workspace bridge image revision mismatch: expected ${EXPECTED_BRIDGE_REVISION}, got ${JSON.stringify(bridgeHealth)}`,
    );
  }
  const candidateBrowser = await assertCandidateTaskBriefBrowser(
    invited.room.guestUrl,
    expectedRepoUrl,
    expectedBaseCommitSha,
    { expectWorkspaceReady: true },
  );
  const guestToken = tokenFromRoomUrl(invited?.room?.guestUrl ?? '');
  const guestRoomAuthHeaders = authHeadersFromUrl(invited?.room?.guestUrl ?? '');
  const roomChatEvidence = await recordSourceBackedRoomChatEvidence(
    guestToken,
    guestRoomAuthHeaders,
    unique,
  );
  const finalizeResponse = await fetch(`${ROOM_BASE}${proxyBasePath}/assessment/finalize`, {
    method: 'POST',
    headers: {
      ...mergedRoomAuthHeaders(roomAuthHeaders),
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const finalizeText = await finalizeResponse.text();
  let finalizeBody = null;
  if (finalizeText) {
    try {
      finalizeBody = JSON.parse(finalizeText);
    } catch {
      finalizeBody = finalizeText;
    }
  }
  if (
    finalizeResponse.status !== 409
    || finalizeBody?.error?.code !== 'ASSESSMENT_FINALIZE_BLOCKED'
  ) {
    throw new Error(`Workspace finalizer did not honestly block unchanged work: ${JSON.stringify(finalizeBody)}`);
  }

  const workspaceCommit = await commitWorkspaceSmokeChange(proxyBasePath, roomAuthHeaders, unique);
  const submittedResponse = await fetch(`${ROOM_BASE}${proxyBasePath}/assessment/finalize`, {
    method: 'POST',
    headers: {
      ...mergedRoomAuthHeaders(roomAuthHeaders),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      narrative: workspaceCommit.narrative,
      testCommand: workspaceCommit.testCommand,
    }),
  });
  const submittedText = await submittedResponse.text();
  let submittedBody = null;
  if (submittedText) {
    try {
      submittedBody = JSON.parse(submittedText);
    } catch {
      submittedBody = submittedText;
    }
  }
  if (!submittedResponse.ok || submittedBody?.submitted !== true) {
    throw new Error(`Workspace finalizer did not accept committed work: ${JSON.stringify(submittedBody)}`);
  }
  if (submittedBody?.commit?.commitSha !== workspaceCommit.commitSha) {
    throw new Error(`Workspace finalizer submitted the wrong commit: ${JSON.stringify(submittedBody?.commit)}`);
  }
  const submittedBranchName = String(submittedBody?.commit?.branchName ?? '');
  if (
    submittedBranchName !== 'pipe-assessment'
    && !submittedBranchName.startsWith('pipe-assessment/')
  ) {
    throw new Error(`Workspace finalizer did not submit an assessment branch: ${JSON.stringify(submittedBody?.commit)}`);
  }
  const sourceRefTypes = submittedBody?.commit?.sourceRefTypes ?? [];
  for (const requiredSourceRefType of ['git_commit', 'code_diff', 'terminal_command', 'test_run']) {
    if (!sourceRefTypes.includes(requiredSourceRefType)) {
      throw new Error(`Workspace finalizer missed ${requiredSourceRefType} evidence: ${JSON.stringify(sourceRefTypes)}`);
    }
  }
  if (submittedBody?.progress?.hasCommitSubmission !== true) {
    throw new Error(`Workspace progress did not reflect the committed submission: ${JSON.stringify(submittedBody?.progress)}`);
  }
  const evaluationStartBody = await startAssessmentEvaluationWithRetry(interviewId);
  const evaluationStartProgress = evaluationStartBody?.progress ?? null;
  let evaluationProgress = evaluationStartProgress;
  if (
    evaluationStartProgress?.stage === 'EVALUATING'
    && evaluationStartProgress?.nextAction === 'WAIT_FOR_EVALUATION'
  ) {
    evaluationProgress = await pollAssessmentEvaluationComplete(interviewId);
  }
  if (evaluationProgress?.stage !== 'EVALUATED' || evaluationProgress?.nextAction !== 'REVIEW_EVALUATION') {
    throw new Error(`Workspace assessment evaluation did not produce a reviewable report: ${JSON.stringify(evaluationStartBody)}`);
  }
  if (evaluationProgress?.evaluation?.status !== 'EVALUATED') {
    throw new Error(`Workspace assessment progress did not expose evaluated status: ${JSON.stringify(evaluationProgress?.evaluation)}`);
  }
  const recommendation = evaluationProgress?.evaluation?.recommendation
    ?? null;
  if (CHANGE_PROFILE) {
    const acceptedRecommendations = new Set(CHANGE_PROFILE.acceptedRecommendations);
    const summary = `${evaluationProgress?.evaluation?.summary ?? ''}`.toLowerCase();
    if (!acceptedRecommendations.has(recommendation)) {
      throw new Error(`Task-aligned workspace smoke did not receive a useful evaluator recommendation: ${JSON.stringify(evaluationProgress?.evaluation)}`);
    }
    const missingTerms = CHANGE_PROFILE.summaryTerms.filter((term) => !summary.includes(term));
    if (missingTerms.length > 0) {
      throw new Error(`Task-aligned workspace smoke evaluation summary missed challenged behavior terms ${missingTerms.join(', ')}: ${summary}`);
    }
  }
  const humanDecision = await recordHumanAssessmentDecision(
    interviewId,
    workspaceCommit,
    recommendation,
  );
  const recruiterProjection = await assertRecruiterAssessmentProjection(
    interviewId,
    workspaceCommit,
    expectedBaseCommitSha,
  );
  if (recruiterProjection.humanDecision?.decision !== humanDecision.decision) {
    throw new Error(`Recruiter detail did not expose the recorded human decision: ${JSON.stringify(recruiterProjection.humanDecision)}`);
  }
  const recruiterBrowser = await assertRecruiterReviewerReceiptBrowser(
    interviewId,
    workspaceCommit,
    submittedBranchName,
    humanDecision,
    recruiterProjection,
    matchedAssignmentProofText,
  );
  const recruiterListBrowser = await assertRecruiterListCardBrowser(
    interviewId,
    workspaceCommit,
    expectedBaseCommitSha,
    humanDecision,
    useMatchedRepo
      ? null
      : CHANGE_PROFILE?.challengeTitle ?? 'Fix deterministic smoke ordering',
    recruiterProjection,
    matchedAssignmentProofText,
  );

  console.log(JSON.stringify({
    ok: true,
    interviewId,
    hostUrl: cleanRoomUrl(invited.room.hostUrl),
    guestUrl: cleanRoomUrl(invited.room.guestUrl),
    repoUrl: workspace.repoUrl,
    githubPrNumber: expectedGithubPrNumber,
    matchedRepoId: MATCHED_REPO_ID,
    interviewType: INTERVIEW_TYPE,
    challengeTitle: CHANGE_PROFILE?.challengeTitle
      ?? workspace.challenge?.packet?.title
      ?? created?.interview?.assessmentProgress?.challenge?.locator?.title
      ?? null,
    challengeStatus: workspace.challenge?.status ?? null,
    challengeSource: workspace.challenge?.source ?? null,
    candidateTaskBriefVisible: !candidateBrowser.skipped,
    candidateTaskBriefSkippedReason: candidateBrowser.skipped ? candidateBrowser.reason : null,
    candidateAssessmentStatusVisible: !candidateBrowser.skipped,
    candidateAssessmentStatusSkippedReason: candidateBrowser.skipped ? candidateBrowser.reason : null,
    roomChatEvidenceCaptured: true,
    roomChatEvidenceNodeId: roomChatEvidence.nodeId,
    roomChatEvidenceSourceRefs: roomChatEvidence.sourceRefTypes,
    workspaceStatus: readySession.status,
    proxyPathReady: Boolean(readySession.proxyPath),
    bridgeHealthReady: true,
    bridgeAgent: bridgeHealth.agent || null,
    bridgeRevision: bridgeHealth.bridgeRevision || null,
    finalizerEndpointBlocked: true,
    terminalCommitCreated: true,
    workspaceCommitSha: workspaceCommit.commitSha,
    workspaceBranchName: submittedBranchName,
    workspaceChangeMode: workspaceCommit.mode,
    finalizerSubmitted: true,
    finalizerProgressStage: submittedBody.progress?.stage ?? null,
    finalizerNextAction: submittedBody.progress?.nextAction ?? null,
    evaluationStarted: true,
    evaluationStage: evaluationProgress.stage,
    evaluationNextAction: evaluationProgress.nextAction,
    evaluationStatus: evaluationProgress.evaluation?.status ?? null,
    evaluationRecommendation: recommendation,
    evaluationSummary: evaluationProgress.evaluation?.summary ?? null,
    evaluationReportId: evaluationProgress.evaluation?.id ?? null,
    humanDecisionRecorded: true,
    humanDecision: humanDecision.decision,
    humanDecisionNextAction: humanDecision.nextAction,
    humanDecisionSourceRefCount: humanDecision.sourceRefCount,
    humanDecisionSourceRefTypes: humanDecision.sourceRefTypes,
    recruiterDetailReviewable: true,
    recruiterReviewerReceiptVisible: !recruiterBrowser.skipped,
    recruiterReviewerReceiptSkippedReason: recruiterBrowser.skipped ? recruiterBrowser.reason : null,
    recruiterListCardVisible: !recruiterListBrowser.skipped,
    recruiterListCardSkippedReason: recruiterListBrowser.skipped ? recruiterListBrowser.reason : null,
    recruiterCompareUrl: recruiterProjection.compareUrl,
    recruiterCapturedDiffVisible: !recruiterProjection.compareUrl && !recruiterBrowser.skipped,
    recruiterCapturedDiffExactTextLength: recruiterProjection.capturedDiffSnippet?.exactText?.length ?? 0,
    recruiterSourceRefCounts: recruiterProjection.sourceRefCounts,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
