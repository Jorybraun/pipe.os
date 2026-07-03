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

const allowedSmokeModes = new Set(['submit-text', 'upload-text', 'upload-docx', 'upload-pdf-gap']);
const smokeMode = argumentValue('--mode') ?? process.env.TALENT_POOL_SMOKE_MODE ?? 'submit-text';
if (!allowedSmokeModes.has(smokeMode)) {
  throw new Error(`Unsupported --mode "${smokeMode}". Use submit-text, upload-text, upload-docx, or upload-pdf-gap.`);
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
  ?? appBase
).replace(/\/$/, '');

const recruiterApiBase = (
  argumentValue('--recruiter-api-base')
  ?? process.env.RECRUITER_API_BASE
  ?? appBase
).replace(/\/$/, '');

function hostnameForBase(baseUrl) {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return '';
  }
}

function inferredD1EnvironmentName() {
  const hostnames = [recruiterApiBase, rpcBase, appBase].map(hostnameForBase);
  if (hostnames.some((hostname) => hostname === 'app-dev.hire-pipe.com' || hostname === 'api-dev.hire-pipe.com')) {
    return 'dev';
  }
  if (hostnames.some((hostname) => hostname === 'pipe-app-test.pages.dev' || hostname === 'pipe-api-test.workers.dev')) {
    return 'test';
  }
  if (hostnames.some((hostname) => hostname === 'app.hire-pipe.com' || hostname === 'api.hire-pipe.com')) {
    return 'production';
  }
  return null;
}

function d1DatabaseIdForEnvironment(envName) {
  const configPath = path.join(repoRoot, 'workers/api/wrangler.jsonc');
  if (!envName || !existsSync(configPath)) return null;
  const configText = readFileSync(configPath, 'utf8');
  const match = configText.match(
    new RegExp(`"${envName}"\\s*:\\s*\\{[\\s\\S]*?"d1_databases"\\s*:\\s*\\[[\\s\\S]*?"database_id"\\s*:\\s*"([^"]+)"`),
  );
  return match?.[1] ?? null;
}

const inferredD1DatabaseId = d1DatabaseIdForEnvironment(inferredD1EnvironmentName());
const databaseId = (
  argumentValue('--d1-database-id')
  ?? process.env.TALENT_POOL_SMOKE_D1_DATABASE_ID
  ?? inferredD1DatabaseId
  ?? process.env.CLOUDFLARE_D1_DATABASE_ID
  ?? ''
).trim();

const failOnNextActions = booleanArgument('--fail-on-next-actions');
const expectsEvidenceGap = smokeMode === 'upload-pdf-gap';
const verifyRecruiterReads = !expectsEvidenceGap && !booleanArgument('--skip-recruiter-reads');
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

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function buildStoredDocx(documentXml) {
  const encoder = new TextEncoder();
  const fileName = encoder.encode('word/document.xml');
  const content = encoder.encode(documentXml);
  const localHeaderLength = 30 + fileName.length + content.length;
  const centralHeaderLength = 46 + fileName.length;
  const eocdLength = 22;
  const bytes = new Uint8Array(localHeaderLength + centralHeaderLength + eocdLength);
  const view = new DataView(bytes.buffer);
  let offset = 0;

  view.setUint32(offset, 0x04034b50, true);
  view.setUint16(offset + 4, 20, true);
  view.setUint16(offset + 8, 0, true);
  view.setUint32(offset + 14, 0, true);
  view.setUint32(offset + 18, content.length, true);
  view.setUint32(offset + 22, content.length, true);
  view.setUint16(offset + 26, fileName.length, true);
  bytes.set(fileName, offset + 30);
  bytes.set(content, offset + 30 + fileName.length);

  const centralOffset = localHeaderLength;
  offset = centralOffset;
  view.setUint32(offset, 0x02014b50, true);
  view.setUint16(offset + 4, 20, true);
  view.setUint16(offset + 6, 20, true);
  view.setUint16(offset + 10, 0, true);
  view.setUint32(offset + 16, 0, true);
  view.setUint32(offset + 20, content.length, true);
  view.setUint32(offset + 24, content.length, true);
  view.setUint16(offset + 28, fileName.length, true);
  view.setUint32(offset + 42, 0, true);
  bytes.set(fileName, offset + 46);

  offset = centralOffset + centralHeaderLength;
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, 1, true);
  view.setUint16(offset + 10, 1, true);
  view.setUint32(offset + 12, centralHeaderLength, true);
  view.setUint32(offset + 16, centralOffset, true);

  return bytes.buffer;
}

function smokeUploadFile() {
  if (smokeMode === 'upload-pdf-gap') {
    return {
      blob: new Blob(['not a real pdf'], { type: 'application/pdf' }),
      fileName: `talent-smoke-${runId}.pdf`,
    };
  }

  if (smokeMode === 'upload-docx') {
    const paragraphs = [
      `Talent Pool live ${smokeMode} smoke proof ${runId}.`,
      'Recently implemented source-backed candidate evidence ingestion for public Talent Pool DOCX profile uploads.',
      'Built Cloudflare Workers ingestion replay with TypeScript and exact source-span proof.',
      'This DOCX text is intentionally unique so exact source spans can be audited back to the uploaded profile.',
    ];
    const documentXml = [
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
      ...paragraphs.map((paragraph) => `<w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p>`),
      '</w:body></w:document>',
    ].join('');
    return {
      blob: new Blob([buildStoredDocx(documentXml)], { type: DOCX_CONTENT_TYPE }),
      fileName: `talent-smoke-${runId}.docx`,
    };
  }

  return {
    blob: new Blob([profileText], { type: 'text/plain' }),
    fileName: `talent-smoke-${runId}.txt`,
  };
}

function isLocalBase(baseUrl) {
  return baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');
}

function shouldSendDevBasicAuth(baseUrl) {
  const hostname = hostnameForBase(baseUrl);
  if (hostname === 'api-dev.hire-pipe.com') return false;
  return !isLocalBase(baseUrl);
}

function basicAuthHeader(baseUrl) {
  if (!shouldSendDevBasicAuth(baseUrl)) return {};
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

function assertConfigured() {
  if (!shouldSendDevBasicAuth(recruiterApiBase)) return;
  const headers = basicAuthHeader(recruiterApiBase);
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
      ...basicAuthHeader(baseUrl),
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
      ...basicAuthHeader(baseUrl),
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

function assertString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected ${label} to be a non-empty string.`);
  }
  return value;
}

function assertAtLeast(value, minimum, label) {
  if (typeof value !== 'number' || value < minimum) {
    throw new Error(`Expected ${label} to be at least ${minimum}, got ${value}.`);
  }
}

function assertCandidateDashboardSafe(body, candidateId, label) {
  const encoded = JSON.stringify(body);
  const forbiddenTerms = [
    candidateId,
    'workspacePersonId',
    'workspace_person',
    'personId',
    'sourceSpanId',
    'artifactVersionId',
    'profile_r2_key',
    'resume_s3_key',
    'applicationId',
    'pipelineId',
  ].filter((term) => term.length > 0);
  const leakedTerm = forbiddenTerms.find((term) => encoded.includes(term));
  if (leakedTerm) {
    throw new Error(`${label} candidate dashboard exposed recruiter/internal evidence field "${leakedTerm}".`);
  }
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
  if (report.rawCapture?.contentAddressedProfileStorageKeyCount !== 1) return false;
  if (report.rawCapture?.nonContentAddressedProfileStorageKeyCount !== 0) return false;
  if (report.sourceProof?.candidateNodeExactSourceQuoteCount < 1) return false;
  if (report.sourceProof?.submittedIntakeWithoutExactCandidateNodeCount !== 0) return false;
  if (report.sourceProof?.contextSourceRefCount < 1) return false;
  if (smokeMode.startsWith('upload-') && report.sourceProof?.profileUploadArtifactVersionCount < 1) return false;
  if (smokeMode === 'upload-docx' && report.rawCapture?.documentProfileStorageKeyCount !== 1) return false;
  if (smokeMode === 'upload-docx' && report.sourceProof?.documentProfileSourceSpanCount < 1) return false;
  if (report.personProjection?.talentPoolWorkspacePersonCount !== 1) return false;
  if (report.sourceLessPositiveClaimCount !== 0) return false;
  if (report.duplicateProjectedEdgeCount !== 0) return false;
  if (report.personProjection?.unprovenChallengeAssignmentCount !== 0) return false;
  return !failOnNextActions || (report.nextActions?.length ?? 0) === 0;
}

function listContains(list, expected) {
  return Array.isArray(list) && list.includes(expected);
}

function countByField(list, field, expected) {
  if (!Array.isArray(list)) return 0;
  const match = list.find((item) => item?.[field] === expected);
  return typeof match?.count === 'number' ? match.count : 0;
}

function auditHasExpectedEvidenceGap(report) {
  if (report.status !== 'not_ready') return false;
  if (report.rawCapture?.submittedIntakeCount !== 1) return false;
  if (report.rawCapture?.contentAddressedProfileStorageKeyCount !== 1) return false;
  if (report.rawCapture?.nonContentAddressedProfileStorageKeyCount !== 0) return false;
  if (report.rawCapture?.documentProfileStorageKeyCount !== 1) return false;
  if (report.ingestionState?.failedRowCount !== 0) return false;
  if (report.ingestionState?.errorTextRowCount !== 0) return false;
  if (countByField(report.ingestionState?.steps, 'currentStep', 'profile_text_extraction_needed') !== 1) return false;
  if (report.sourceProof?.candidateNodeCount !== 0) return false;
  if (report.sourceProof?.profileUploadArtifactVersionCount < 1) return false;
  if (report.sourceProof?.documentProfileSourceSpanCount !== 0) return false;
  if (report.sourceProof?.candidateNodeExactSourceQuoteCount !== 0) return false;
  if (report.sourceProof?.submittedIntakeWithoutExactCandidateNodeCount !== 1) return false;
  if (report.sourceProof?.contextSourceRefCount < 1) return false;
  if (report.personProjection?.talentPoolWorkspacePersonCount !== 1) return false;
  if (report.personProjection?.designQueueCount !== 1) return false;
  if (report.sourceLessPositiveClaimCount !== 0) return false;
  if (report.sourceLessDesignQueueSuggestionCount !== 0) return false;
  if (report.duplicateProjectedEdgeCount !== 0) return false;
  if (!listContains(
    report.failures,
    '1 PDF/DOCX Talent Pool profile upload(s) lack extracted source spans for the current profile key',
  )) {
    return false;
  }
  if (Array.isArray(report.failures) && report.failures.some((failure) => failure.includes('candidate_ingestion'))) {
    return false;
  }
  return listContains(
    report.nextActions,
    'Replay or repair PDF/DOCX profile extraction so the current profile storage key has exact source spans.',
  );
}

function auditMatchesExpectedState(report) {
  return expectsEvidenceGap ? auditHasExpectedEvidenceGap(report) : auditIsReady(report);
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
    if (auditMatchesExpectedState(lastReport)) return lastReport;
    console.log(`[talent-smoke] audit did not match expected state on attempt ${attempt}:`, {
      status: lastReport.status,
      failures: lastReport.failures,
      nextActions: lastReport.nextActions,
    });
    await sleep(2500);
  }
  throw new Error(`Audit did not reach expected state:\n${JSON.stringify(lastReport, null, 2)}`);
}

function recruiterReadNeedle() {
  if (smokeMode === 'upload-docx') return 'DOCX text is intentionally unique';
  return 'source spans can be audited back';
}

async function verifyRecruiterEvidenceReads(candidateId) {
  if (!verifyRecruiterReads) return null;

  const needle = recruiterReadNeedle();
  const encodedCandidateId = encodeURIComponent(candidateId);
  const candidateGraph = await requestJson(
    recruiterApiBase,
    `/api/v1/candidates/${encodedCandidateId}/living-context`,
  );
  const person = candidateGraph?.livingContext?.person;
  const personId = assertString(person?.personId, 'candidate living-context personId');
  const workspacePersonId = assertString(
    person?.workspacePersonId,
    'candidate living-context workspacePersonId',
  );
  if (person?.applicationId !== null) {
    throw new Error(`Expected roleless Talent Pool candidate to read without applicationId, got ${person?.applicationId}.`);
  }
  if (!JSON.stringify(candidateGraph).includes(needle)) {
    throw new Error(`Candidate living-context graph did not include submitted source text "${needle}".`);
  }

  const contactsList = await requestJson(recruiterApiBase, '/api/v1/contacts?limit=200');
  const unifiedPerson = Array.isArray(contactsList?.contacts)
    ? contactsList.contacts.find((contact) => contact?.id === personId || contact?.email === candidateEmail)
    : null;
  if (!unifiedPerson) {
    throw new Error('Unified People list did not include the ingested Talent Pool person.');
  }
  if (unifiedPerson.type !== 'candidate') {
    throw new Error(`Unified People list returned type "${unifiedPerson.type}" instead of candidate.`);
  }

  const candidateSearch = await requestJson(
    recruiterApiBase,
    `/api/v1/candidates/${encodedCandidateId}/living-context/search?q=${encodeURIComponent(needle)}`,
  );
  if (candidateSearch?.personId !== workspacePersonId) {
    throw new Error('Candidate source search did not resolve the canonical workspace person.');
  }
  if (!Array.isArray(candidateSearch?.hits) || !candidateSearch.hits.some((hit) => String(hit?.exactText ?? '').includes(needle))) {
    throw new Error('Candidate source search did not return the submitted exact source text.');
  }

  const candidateEvidenceDepth = await requestJson(
    recruiterApiBase,
    `/api/v1/candidates/${encodedCandidateId}/living-context/evidence-depth`,
  );
  if (candidateEvidenceDepth?.workspacePersonId !== workspacePersonId) {
    throw new Error('Candidate evidence-depth did not resolve the canonical workspace person.');
  }
  assertAtLeast(candidateEvidenceDepth?.totalSourceSpans, 1, 'candidate evidence-depth source spans');
  assertAtLeast(candidateEvidenceDepth?.totalContextRecords, 1, 'candidate evidence-depth context records');

  const encodedPersonId = encodeURIComponent(personId);
  const personSearch = await requestJson(
    recruiterApiBase,
    `/api/v1/contacts/${encodedPersonId}/living-context/search?q=${encodeURIComponent(needle)}`,
  );
  if (personSearch?.personId !== workspacePersonId) {
    throw new Error('Person source search did not resolve the canonical workspace person.');
  }
  if (!Array.isArray(personSearch?.hits) || !personSearch.hits.some((hit) => String(hit?.exactText ?? '').includes(needle))) {
    throw new Error('Person source search did not return the submitted exact source text.');
  }

  const personTimeline = await requestJson(
    recruiterApiBase,
    `/api/v1/contacts/${encodedPersonId}/living-context/timeline`,
  );
  if (personTimeline?.workspacePersonId !== workspacePersonId) {
    throw new Error('Person evidence timeline did not resolve the canonical workspace person.');
  }
  assertAtLeast(personTimeline?.totalEntries, 1, 'person evidence timeline entries');
  if (!JSON.stringify(personTimeline?.entries ?? []).includes('Candidate submitted Talent Pool profile evidence.')) {
    throw new Error('Person evidence timeline did not include the Talent Pool profile evidence event.');
  }

  const personEvidenceDepth = await requestJson(
    recruiterApiBase,
    `/api/v1/contacts/${encodedPersonId}/living-context/evidence-depth`,
  );
  if (personEvidenceDepth?.workspacePersonId !== workspacePersonId) {
    throw new Error('Person evidence-depth did not resolve the canonical workspace person.');
  }
  assertAtLeast(personEvidenceDepth?.totalSourceSpans, 1, 'person evidence-depth source spans');
  assertAtLeast(personEvidenceDepth?.totalContextRecords, 1, 'person evidence-depth context records');

  return {
    personId,
    workspacePersonId,
    unifiedPeopleType: unifiedPerson.type,
    candidateSearchHits: candidateSearch.hits.length,
    personSearchHits: personSearch.hits.length,
    timelineEntries: personTimeline.totalEntries,
    personEvidenceSourceSpans: personEvidenceDepth.totalSourceSpans,
    personEvidenceContextRecords: personEvidenceDepth.totalContextRecords,
  };
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
  const candidateId = assertString(created?.candidate?.id, 'created candidate id');

  const initialDashboard = await requestJson(rpcBase, '/rpc/talent/resolve-token', {
    method: 'POST',
    body: { inviteToken },
  });
  if (initialDashboard?.status !== 'PROFILE_NEEDED') {
    throw new Error(`Expected PROFILE_NEEDED before submit, got ${initialDashboard?.status}`);
  }
  assertCandidateDashboardSafe(initialDashboard, candidateId, 'resolve-token');

  const submittedDashboard = smokeMode === 'upload-text'
    || smokeMode === 'upload-docx'
    || smokeMode === 'upload-pdf-gap'
    ? await (async () => {
        const uploadFile = smokeUploadFile();
        const formData = new FormData();
        formData.set('inviteToken', inviteToken);
        formData.set(
          'file',
          uploadFile.blob,
          uploadFile.fileName,
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
  assertCandidateDashboardSafe(submittedDashboard, candidateId, 'submit-profile');

  const report = await pollAudit(inviteToken);
  const recruiterReadProof = await verifyRecruiterEvidenceReads(candidateId);
  console.log(expectsEvidenceGap ? '[talent-smoke] expected evidence gap' : '[talent-smoke] ready', {
    inviteToken,
    expectedEvidenceGap: expectsEvidenceGap,
    status: report.status,
    checkedAt: report.checkedAt,
    ingestionSteps: report.ingestionState.steps,
    sourceLessPositiveClaimCount: report.sourceLessPositiveClaimCount,
    sourceLessDesignQueueSuggestionCount: report.sourceLessDesignQueueSuggestionCount,
    duplicateProjectedEdgeCount: report.duplicateProjectedEdgeCount,
    candidateNodeCount: report.sourceProof.candidateNodeCount,
    candidateNodeExactSourceQuoteCount: report.sourceProof.candidateNodeExactSourceQuoteCount,
    submittedIntakeWithoutExactCandidateNodeCount: report.sourceProof.submittedIntakeWithoutExactCandidateNodeCount,
    contextSourceRefCount: report.sourceProof.contextSourceRefCount,
    contentAddressedProfileStorageKeyCount: report.rawCapture.contentAddressedProfileStorageKeyCount,
    nonContentAddressedProfileStorageKeyCount: report.rawCapture.nonContentAddressedProfileStorageKeyCount,
    documentProfileStorageKeyCount: report.rawCapture.documentProfileStorageKeyCount,
    documentProfileSourceSpanCount: report.sourceProof.documentProfileSourceSpanCount,
    profileUploadArtifactVersionCount: report.sourceProof.profileUploadArtifactVersionCount,
    talentPoolWorkspacePersonCount: report.personProjection.talentPoolWorkspacePersonCount,
    designQueueCount: report.personProjection.designQueueCount,
    recruiterReadProof,
    failures: report.failures,
    nextActions: report.nextActions,
  });
}

main().catch((error) => {
  console.error('[talent-smoke] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
