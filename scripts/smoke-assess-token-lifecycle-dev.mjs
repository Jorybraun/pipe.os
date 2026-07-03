import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });

const APP_BASE = (process.env.APP_BASE || 'https://app-dev.hire-pipe.com').replace(/\/$/, '');
const API_BASE = (process.env.API_BASE || 'https://api-dev.hire-pipe.com').replace(/\/$/, '');
const RECRUITER_API_BASE = (process.env.RECRUITER_API_BASE || APP_BASE).replace(/\/$/, '');
const BASIC_USER = process.env.PIPE_APP_DEV_BASIC_AUTH_USER
  || process.env.APP_DEV_BASIC_AUTH_USER
  || process.env.PIPE_DEV_BASIC_AUTH_USER
  || process.env.DEV_BASIC_AUTH_USER
  || '';
const BASIC_PASSWORD = process.env.PIPE_APP_DEV_BASIC_AUTH_PASSWORD
  || process.env.APP_DEV_BASIC_AUTH_PASSWORD
  || process.env.PIPE_DEV_BASIC_AUTH_PASSWORD
  || process.env.DEV_BASIC_AUTH_PASSWORD
  || '';
const REPO_URL = (process.env.ASSESS_TOKEN_LIFECYCLE_REPO_URL || 'https://github.com/mui/base-ui').trim();
const PR_NUMBER = Number((process.env.ASSESS_TOKEN_LIFECYCLE_PR_NUMBER || '973').trim());

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function authHeaders() {
  if (!BASIC_USER && !BASIC_PASSWORD) return {};
  const value = Buffer.from(`${BASIC_USER}:${BASIC_PASSWORD}`).toString('base64');
  return { Authorization: `Basic ${value}` };
}

function assertEnv() {
  const remote = !APP_BASE.includes('localhost') && !APP_BASE.includes('127.0.0.1');
  if (remote && (!BASIC_USER || !BASIC_PASSWORD)) {
    throw new Error('Set PIPE_DEV_BASIC_AUTH_USER and PIPE_DEV_BASIC_AUTH_PASSWORD to smoke deployed app-dev.');
  }
  if (!Number.isInteger(PR_NUMBER) || PR_NUMBER <= 0) {
    throw new Error('ASSESS_TOKEN_LIFECYCLE_PR_NUMBER must be a positive integer.');
  }
}

async function requestJson(path, init = {}) {
  const response = await fetch(`${RECRUITER_API_BASE}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} failed (${response.status}): ${text}`);
  }
  return body;
}

function cleanUrl(rawUrl) {
  if (!rawUrl) return null;
  const url = new URL(rawUrl);
  url.username = '';
  url.password = '';
  return url.toString().replace(/\/assess\/[^/?#]+/, '/assess/<token>');
}

function inviteTokenFromAssessUrl(rawUrl) {
  const url = new URL(rawUrl);
  const match = url.pathname.match(/\/assess\/([^/?#]+)/);
  assert(match?.[1], `Delivered URL is not an assess link: ${cleanUrl(rawUrl)}`);
  return decodeURIComponent(match[1]);
}

async function createCodeReviewInvite(label) {
  const unique = `${Date.now()}-${label.toLowerCase()}`;
  const recipientName = `Token ${label} Lifecycle Candidate`;
  const recipientEmail = `assess-token-${label.toLowerCase()}-${unique}@pipe-test.dev`;
  const created = await requestJson('/api/v1/scheduling/interviews', {
    method: 'POST',
    body: JSON.stringify({
      recipientName,
      recipientEmail,
      meetingType: 'DIRECT_VIDEO_CALL',
      interviewType: 'CODE_REVIEW',
      githubRepoUrl: REPO_URL,
      githubPrNumber: PR_NUMBER,
    }),
  });
  const interviewId = created?.interview?.id;
  assert(interviewId, `Create interview response missing id: ${JSON.stringify(created)}`);

  const invited = await requestJson(`/api/v1/scheduling/interviews/${interviewId}/invite`, {
    method: 'POST',
    body: JSON.stringify({
      email: recipientEmail,
      sendEmail: false,
      message: `Automated same-browser assess token lifecycle smoke ${label}.`,
    }),
  });
  assert(invited?.success === true, `Invite did not report success: ${JSON.stringify(invited)}`);
  const deliveredUrl = invited?.deliveredUrl ?? invited?.meetingUrl;
  const inviteToken = inviteTokenFromAssessUrl(deliveredUrl);

  const detail = await requestJson(`/api/v1/scheduling/interviews/${interviewId}`);
  const candidateId = detail?.interview?.candidateId;
  const candidateName = detail?.interview?.candidateName ?? recipientName;
  assert(candidateId, `Interview detail missing candidateId after invite: ${JSON.stringify(detail)}`);
  assert(candidateName === recipientName, `Unexpected candidate name for ${label}: ${candidateName}`);

  return {
    label,
    interviewId,
    candidateId,
    candidateName,
    recipientEmail,
    deliveredUrl,
    inviteToken,
  };
}

function runBrowserSmoke(tokenA, tokenB) {
  const result = spawnSync(
    'npx',
    [
      'playwright',
      'test',
      'e2e/assess-token-lifecycle-dev.unauth.spec.ts',
      '--project=unauthenticated',
      '--reporter=line',
    ],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        APP_BASE,
        API_BASE,
        ASSESS_TOKEN_A_URL: tokenA.deliveredUrl,
        ASSESS_TOKEN_A_CANDIDATE_ID: tokenA.candidateId,
        ASSESS_TOKEN_A_CANDIDATE_NAME: tokenA.candidateName,
        ASSESS_TOKEN_B_URL: tokenB.deliveredUrl,
        ASSESS_TOKEN_B_CANDIDATE_ID: tokenB.candidateId,
        ASSESS_TOKEN_B_CANDIDATE_NAME: tokenB.candidateName,
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Playwright assess token lifecycle smoke failed with exit code ${result.status}`);
  }
  return { skipped: false };
}

async function main() {
  assertEnv();
  const tokenA = await createCodeReviewInvite('A');
  const tokenB = await createCodeReviewInvite('B');
  const browserSmoke = runBrowserSmoke(tokenA, tokenB);

  console.log(JSON.stringify({
    ok: true,
    repoUrl: REPO_URL,
    prNumber: PR_NUMBER,
    tokenA: {
      interviewId: tokenA.interviewId,
      candidateId: tokenA.candidateId,
      candidateName: tokenA.candidateName,
      deliveredUrl: cleanUrl(tokenA.deliveredUrl),
    },
    tokenB: {
      interviewId: tokenB.interviewId,
      candidateId: tokenB.candidateId,
      candidateName: tokenB.candidateName,
      deliveredUrl: cleanUrl(tokenB.deliveredUrl),
    },
    browserSmoke,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
