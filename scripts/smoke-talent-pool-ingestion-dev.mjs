#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    if (process.env[key]) continue;
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnv(path.join(repoRoot, '.env.local'));
loadDotEnv(path.join(repoRoot, '.env'));
loadDotEnv(path.join(repoRoot, 'workers/api/.dev.vars'));

function argumentValue(name) {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function booleanArgument(name) {
  return process.argv.includes(name);
}

const allowedSmokeModes = new Set(['submit-text', 'upload-text']);
const smokeMode = argumentValue('--mode') ?? process.env.TALENT_POOL_SMOKE_MODE ?? 'submit-text';
if (!allowedSmokeModes.has(smokeMode)) {
  throw new Error(`Unsupported --mode "${smokeMode}". Use submit-text or upload-text.`);
}

const appBase = (
  argumentValue('--app-base')
  ?? process.env.TALENT_POOL_SMOKE_APP_BASE
  ?? process.env.APP_BASE
  ?? 'https://app-dev.hire-pipe.com'
).replace(/\/$/, '');

const rpcBase = (
  argumentValue('--rpc-base')
  ?? process.env.TALENT_POOL_SMOKE_RPC_BASE
  ?? process.env.API_BASE
  ?? 'https://api-dev.hire-pipe.com'
).replace(/\/$/, '');

const recruiterApiBase = (
  argumentValue('--recruiter-api-base')
  ?? process.env.RECRUITER_API_BASE
  ?? appBase
).replace(/\/$/, '');

const databaseId = (
  argumentValue('--d1-database-id')
  ?? process.env.TALENT_POOL_SMOKE_D1_DATABASE_ID
  ?? process.env.CLOUDFLARE_D1_DATABASE_ID
  ?? ''
).trim();

const failOnNextActions = booleanArgument('--fail-on-next-actions');
const slug = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const runId = `${slug}-${randomUUID().slice(0, 8)}`;
const candidateName = argumentValue('--name') ?? `Talent Smoke ${runId}`;
const candidateEmail = (
  argumentValue('--email')
  ?? process.env.TALENT_POOL_SMOKE_EMAIL
  ?? `talent-smoke-${smokeMode}-${runId}@example.test`
).toLowerCase();

const profileText = [
  `Talent Pool live ${smokeMode} smoke proof ${runId}.`,
  'Recently implemented source-backed candidate evidence ingestion for public Talent Pool profile submissions.',
  'Built TypeScript Workers APIs, React accessibility flows, and source-provenance test harnesses.',
  'This text is intentionally unique so exact source spans can be audited back to the submitted profile.',
].join(' ');

function basicAuthHeader() {
  const user = process.env.PIPE_DEV_BASIC_AUTH_USER
    ?? process.env.DEV_BASIC_AUTH_USER
    ?? process.env.VIDEO_ROOM_DEV_AUTH_USER
    ?? '';
  const password = process.env.PIPE_DEV_BASIC_AUTH_PASSWORD
    ?? process.env.DEV_BASIC_AUTH_PASSWORD
    ?? process.env.VIDEO_ROOM_DEV_AUTH_PASSWORD
    ?? '';
  if (!user || !password) return {};
  return { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` };
}

function isLocalBase(baseUrl) {
  return baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');
}

function assertConfigured() {
  if (isLocalBase(recruiterApiBase)) return;
  const headers = basicAuthHeader();
  if (!headers.Authorization) {
    throw new Error(
      'Set PIPE_DEV_BASIC_AUTH_USER and PIPE_DEV_BASIC_AUTH_PASSWORD to create dev Talent Pool candidates through app-dev.',
    );
  }
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      ...basicAuthHeader(),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${baseUrl}${pathname} failed ${response.status}: ${text}`);
  }
  return body;
}

async function requestMultipart(baseUrl, pathname, formData) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      ...basicAuthHeader(),
    },
    body: formData,
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  if (!response.ok) {
    throw new Error(`POST ${baseUrl}${pathname} failed ${response.status}: ${text}`);
  }
  return body;
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error(`Audit command did not print JSON:\n${text}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

function runAudit(inviteToken) {
  if (!databaseId) {
    throw new Error('Set CLOUDFLARE_D1_DATABASE_ID or TALENT_POOL_SMOKE_D1_DATABASE_ID for remote audit proof.');
  }
  const result = spawnSync(
    'npm',
    [
      '--prefix',
      'workers/api',
      'run',
      'candidate-ingestion:audit',
      '--',
      '--remote',
      '--invite-token',
      inviteToken,
      '--require-context-records',
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLOUDFLARE_D1_DATABASE_ID: databaseId,
      },
    },
  );
  if (result.status !== 0) {
    if (result.stdout.trim()) {
      try {
        return extractJson(result.stdout);
      } catch {
        // Fall through to include stdout/stderr in the failure.
      }
    }
    throw new Error(`Audit command failed:\n${result.stdout}\n${result.stderr}`);
  }
  return extractJson(result.stdout);
}

function auditIsReady(report) {
  if (report.status !== 'ready') return false;
  if (report.rawCapture?.submittedIntakeCount !== 1) return false;
  if (report.sourceProof?.candidateNodeExactSourceQuoteCount < 1) return false;
  if (report.sourceProof?.contextSourceRefCount < 1) return false;
  if (smokeMode === 'upload-text' && report.sourceProof?.profileUploadArtifactVersionCount < 1) return false;
  if (report.personProjection?.talentPoolWorkspacePersonCount !== 1) return false;
  if (report.sourceLessPositiveClaimCount !== 0) return false;
  if (report.duplicateProjectedEdgeCount !== 0) return false;
  if (report.personProjection?.unprovenChallengeAssignmentCount !== 0) return false;
  return !failOnNextActions || (report.nextActions?.length ?? 0) === 0;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function pollAudit(inviteToken) {
  let lastReport = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    lastReport = runAudit(inviteToken);
    if (auditIsReady(lastReport)) return lastReport;
    console.log(`[talent-smoke] audit not ready on attempt ${attempt}:`, {
      status: lastReport.status,
      failures: lastReport.failures,
      nextActions: lastReport.nextActions,
    });
    await sleep(2500);
  }
  throw new Error(`Audit did not become ready:\n${JSON.stringify(lastReport, null, 2)}`);
}

async function main() {
  assertConfigured();
  console.log('[talent-smoke] creating standalone Talent Pool candidate', {
    recruiterApiBase,
    rpcBase,
    email: candidateEmail,
    mode: smokeMode,
  });

  const created = await requestJson(recruiterApiBase, '/api/v1/candidates', {
    method: 'POST',
    body: {
      name: candidateName,
      email: candidateEmail,
      skipEmail: true,
      message: `Dev smoke seed for ${runId}.`,
    },
  });

  const inviteToken = created?.candidate?.inviteToken;
  if (typeof inviteToken !== 'string' || inviteToken.length === 0) {
    throw new Error(`Candidate creation did not return inviteToken:\n${JSON.stringify(created, null, 2)}`);
  }

  const initialDashboard = await requestJson(rpcBase, '/rpc/talent/resolve-token', {
    method: 'POST',
    body: { inviteToken },
  });
  if (initialDashboard?.status !== 'PROFILE_NEEDED') {
    throw new Error(`Expected PROFILE_NEEDED before submit, got ${initialDashboard?.status}`);
  }

  const submittedDashboard = smokeMode === 'upload-text'
    ? await (async () => {
        const formData = new FormData();
        formData.set('inviteToken', inviteToken);
        formData.set(
          'file',
          new Blob([profileText], { type: 'text/plain' }),
          `talent-smoke-${runId}.txt`,
        );
        formData.set('githubUrl', `https://github.com/talent-smoke-${smokeMode}-${runId}`);
        formData.set('linkedinUrl', `https://linkedin.com/in/talent-smoke-${smokeMode}-${runId}`);
        formData.set('portfolioUrl', `https://talent-smoke-${smokeMode}-${runId}.example.dev`);
        formData.set('phoneScreenerConsent', 'true');
        formData.set('phoneNumber', '+15551234567');
        formData.set('timezone', 'America/Vancouver');
        formData.set('availability', 'Weekday afternoons after 2 PM.');
        return requestMultipart(rpcBase, '/rpc/talent/upload-profile', formData);
      })()
    : await requestJson(rpcBase, '/rpc/talent/submit-profile', {
        method: 'POST',
        body: {
          inviteToken,
          resumeText: profileText,
          githubUrl: `https://github.com/talent-smoke-${runId}`,
          linkedinUrl: `https://linkedin.com/in/talent-smoke-${runId}`,
          portfolioUrl: `https://talent-smoke-${runId}.example.dev`,
          phoneScreenerConsent: true,
          phoneNumber: '+15551234567',
          timezone: 'America/Vancouver',
          availability: 'Weekday afternoons after 2 PM.',
        },
      });
  if (submittedDashboard?.status !== 'CHALLENGE_PREPARING') {
    throw new Error(`Expected CHALLENGE_PREPARING after submit, got ${submittedDashboard?.status}`);
  }
  if (Array.isArray(submittedDashboard?.readyChallenges) && submittedDashboard.readyChallenges.length > 0) {
    throw new Error('Talent Pool smoke unexpectedly exposed ready challenges immediately after profile submit.');
  }

  const report = await pollAudit(inviteToken);
  console.log('[talent-smoke] ready', {
    inviteToken,
    checkedAt: report.checkedAt,
    sourceLessPositiveClaimCount: report.sourceLessPositiveClaimCount,
    duplicateProjectedEdgeCount: report.duplicateProjectedEdgeCount,
    candidateNodeExactSourceQuoteCount: report.sourceProof.candidateNodeExactSourceQuoteCount,
    contextSourceRefCount: report.sourceProof.contextSourceRefCount,
    profileUploadArtifactVersionCount: report.sourceProof.profileUploadArtifactVersionCount,
    talentPoolWorkspacePersonCount: report.personProjection.talentPoolWorkspacePersonCount,
    nextActions: report.nextActions,
  });
}

main().catch((error) => {
  console.error('[talent-smoke] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
