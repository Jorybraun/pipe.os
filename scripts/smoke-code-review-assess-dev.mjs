import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const APP_BASE = (process.env.APP_BASE || 'https://app-dev.hire-pipe.com').replace(/\/$/, '');
const API_BASE = (process.env.API_BASE || 'https://api-dev.hire-pipe.com').replace(/\/$/, '');
const RECRUITER_API_BASE = (process.env.RECRUITER_API_BASE || APP_BASE).replace(/\/$/, '');
const RPC_BASE = (process.env.RPC_BASE || API_BASE).replace(/\/$/, '');
const VIDEO_ROOM_BASE = (process.env.VIDEO_ROOM_BASE || process.env.ROOM_BASE || 'https://room-dev.hire-pipe.com').replace(/\/$/, '');
export function resolveAppDevBasicAuth(env = process.env) {
  return {
    user: env.PIPE_APP_DEV_BASIC_AUTH_USER
      || env.APP_DEV_BASIC_AUTH_USER
      || env.PIPE_DEV_BASIC_AUTH_USER
      || env.DEV_BASIC_AUTH_USER
      || '',
    password: env.PIPE_APP_DEV_BASIC_AUTH_PASSWORD
      || env.APP_DEV_BASIC_AUTH_PASSWORD
      || env.PIPE_DEV_BASIC_AUTH_PASSWORD
      || env.DEV_BASIC_AUTH_PASSWORD
      || '',
  };
}
const { user: BASIC_USER, password: BASIC_PASSWORD } = resolveAppDevBasicAuth();
const REQUEST_TIMEOUT_MS = Math.max(
  1,
  Number.parseInt(process.env.CODE_REVIEW_SMOKE_REQUEST_TIMEOUT_MS || '60000', 10) || 60_000,
);
const SEND_EMAIL = process.env.CODE_REVIEW_SMOKE_SEND_EMAIL === '1';
const SKIP_BROWSER = process.env.CODE_REVIEW_SMOKE_SKIP_BROWSER === '1';
const SKIP_RECRUITER_BROWSER = process.env.CODE_REVIEW_SMOKE_SKIP_RECRUITER_BROWSER === '1';
const VERIFY_RECRUITER_CANDIDATE_LINK = process.env.CODE_REVIEW_SMOKE_RECRUITER_CANDIDATE_LINK === '1';
const AUTO_MATCH = process.env.CODE_REVIEW_SMOKE_AUTO_MATCH === '1';
const NO_CV_BOUNDARY = process.env.CODE_REVIEW_SMOKE_NO_CV_BOUNDARY === '1';
const ROLE_BACKED_EXPLICIT = process.env.CODE_REVIEW_SMOKE_ROLE_BACKED === '1';
const SUBMIT_REVIEW = process.env.CODE_REVIEW_SMOKE_SUBMIT === '1'
  || process.env.CODE_REVIEW_SMOKE_FULL_SUBMIT === '1';
const DEFAULT_REPO_URL = AUTO_MATCH ? '' : 'https://github.com/mui/base-ui';
const DEFAULT_PR_NUMBER = AUTO_MATCH ? '' : '973';
const REPO_URL = (process.env.CODE_REVIEW_SMOKE_REPO_URL ?? DEFAULT_REPO_URL).trim();
const PR_NUMBER_RAW = (process.env.CODE_REVIEW_SMOKE_PR_NUMBER ?? DEFAULT_PR_NUMBER).trim();
const PR_NUMBER = PR_NUMBER_RAW ? Number(PR_NUMBER_RAW) : null;
const EXPECT_AUTOMATCH = process.env.CODE_REVIEW_EXPECT_AUTOMATCH
  ?? (AUTO_MATCH ? '1' : '0');
const REQUIRE_CONTRAST = process.env.CODE_REVIEW_REQUIRE_CONTRAST
  ?? (!REPO_URL && !PR_NUMBER ? '1' : '0');
const EXPECT_BLOCKED_MATCH = process.env.CODE_REVIEW_EXPECT_BLOCKED_MATCH === '1';
const ROLE_BACKED = ROLE_BACKED_EXPLICIT
  || (
    AUTO_MATCH
    && !EXPECT_BLOCKED_MATCH
    && !REPO_URL
    && PR_NUMBER === null
    && process.env.CODE_REVIEW_SMOKE_ROLE_BACKED !== '0'
  );
const PERSON_RELATED_BOUNDARY = process.env.CODE_REVIEW_SMOKE_PERSON_RELATED_BOUNDARY === '1';
const RELATED_BOUNDARY_REPO_URL = (
  process.env.CODE_REVIEW_SMOKE_RELATED_BOUNDARY_REPO_URL
  || 'https://github.com/facebook/react'
).trim();
const RELATED_BOUNDARY_PR_NUMBER = Number(
  (process.env.CODE_REVIEW_SMOKE_RELATED_BOUNDARY_PR_NUMBER || '1').trim(),
);

const DEFAULT_RESUME_TEXT = [
  'Senior frontend platform engineer shipping React and TypeScript popup infrastructure for a component library.',
  'Recently implemented usePopoverRoot hover and click handoff logic with clickEnabled, clickEnabledTimeoutRef, PATIENT_CLICK_THRESHOLD, and ReactDOM.flushSync.',
  'Reviewed onOpenChange handling for hover, safe-polygon, click, and escape-key transitions so impatient trigger clicks do not unexpectedly close popovers.',
  'Debugged popupStoreUtils ownership bugs around activeTriggerId, triggerCount, queueMicrotask reconciliation, and rendered DOM ids diverging from internal trigger registries.',
  'Wrote JavaScript test runner regressions for multi-trigger handoff, implicit active trigger ownership, accessibility state, and maintainability trade-offs.',
  'I routinely explain request-changes review decisions to implementation authors and defend risk-based bug calls with concrete evidence.',
].join(' ');

const RESUME_TEXT = (process.env.CODE_REVIEW_SMOKE_RESUME_TEXT || DEFAULT_RESUME_TEXT).trim();
const GITHUB_HANDLE = (process.env.CODE_REVIEW_SMOKE_GITHUB_HANDLE || 'code-review-smoke').trim();
const ROLE_TITLE = (process.env.CODE_REVIEW_SMOKE_ROLE_TITLE || 'Senior Frontend Platform Engineer').trim();
const DEFAULT_ROLE_JOB_DESCRIPTION = [
  `## Role Title\n${ROLE_TITLE}`,
  '## Role Scope',
  'The role reviews React and TypeScript component-library pull requests that change popup and popover trigger behavior.',
  'The engineer must reason about usePopoverRoot, patient click thresholds, rendered trigger id ownership, DOM id versus internal registry state, JavaScript test runner regression tests, accessibility state, and maintainability trade-offs.',
  'The assessment should reveal whether the candidate can defend request-changes decisions against implementation pushback.',
].join('\n\n');
const ROLE_JOB_DESCRIPTION = (
  process.env.CODE_REVIEW_SMOKE_ROLE_JD
  || DEFAULT_ROLE_JOB_DESCRIPTION
).trim();
const ROLE_SELECTED_TERMS = (
  process.env.CODE_REVIEW_SMOKE_ROLE_TERMS
    ? process.env.CODE_REVIEW_SMOKE_ROLE_TERMS.split(',').map((term) => term.trim()).filter(Boolean)
    : [
        'React',
        'TypeScript',
        'usePopoverRoot',
        'rendered trigger id ownership',
        'DOM id versus internal registry state',
        'patient click thresholds',
        'JavaScript test runner regression tests',
      ]
);
const DEFAULT_REVIEW_SUMMARY = [
  'Request changes: the interaction threshold logic is reviewable and relevant,',
  'but this PR needs a regression test and a clearer explanation of timeout cleanup risk before merge.',
].join(' ');
const REVIEW_SUMMARY = (process.env.CODE_REVIEW_SMOKE_REVIEW_SUMMARY || DEFAULT_REVIEW_SUMMARY).trim();

function assertEnv() {
  const remote = !APP_BASE.includes('localhost') && !APP_BASE.includes('127.0.0.1');
  if (remote && (!BASIC_USER || !BASIC_PASSWORD)) {
    throw new Error(
      'Set PIPE_APP_DEV_BASIC_AUTH_USER/PASSWORD, APP_DEV_BASIC_AUTH_USER/PASSWORD, or PIPE_DEV_BASIC_AUTH_USER/PASSWORD to smoke deployed app-dev.',
    );
  }
  if (Boolean(REPO_URL) !== Boolean(PR_NUMBER)) {
    throw new Error(
      'Set both CODE_REVIEW_SMOKE_REPO_URL and CODE_REVIEW_SMOKE_PR_NUMBER for a manual override, or set CODE_REVIEW_SMOKE_AUTO_MATCH=1.',
    );
  }
  if (ROLE_BACKED && (!AUTO_MATCH || REPO_URL || PR_NUMBER)) {
    throw new Error('CODE_REVIEW_SMOKE_ROLE_BACKED=1 requires CODE_REVIEW_SMOKE_AUTO_MATCH=1 with no manual repo override.');
  }
  if (PR_NUMBER !== null && (!Number.isInteger(PR_NUMBER) || PR_NUMBER <= 0)) {
    throw new Error(`CODE_REVIEW_SMOKE_PR_NUMBER must be a positive integer, got ${PR_NUMBER_RAW}`);
  }
  if (!RESUME_TEXT) {
    throw new Error('CODE_REVIEW_SMOKE_RESUME_TEXT must not be empty.');
  }
  if (PERSON_RELATED_BOUNDARY) {
    if (!RELATED_BOUNDARY_REPO_URL || !Number.isInteger(RELATED_BOUNDARY_PR_NUMBER) || RELATED_BOUNDARY_PR_NUMBER <= 0) {
      throw new Error('Set CODE_REVIEW_SMOKE_RELATED_BOUNDARY_REPO_URL and CODE_REVIEW_SMOKE_RELATED_BOUNDARY_PR_NUMBER to valid values.');
    }
  }
  if (NO_CV_BOUNDARY && (!AUTO_MATCH || REPO_URL || PR_NUMBER)) {
    throw new Error('CODE_REVIEW_SMOKE_NO_CV_BOUNDARY=1 requires CODE_REVIEW_SMOKE_AUTO_MATCH=1 with no manual repo/PR override.');
  }
}

function authHeaders() {
  if (!BASIC_USER && !BASIC_PASSWORD) return {};
  const value = Buffer.from(`${BASIC_USER}:${BASIC_PASSWORD}`).toString('base64');
  return { Authorization: `Basic ${value}` };
}

function candidateHeaders(sessionToken) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${sessionToken}`,
  };
}

function requestBaseFor(path, options) {
  if (options.baseUrl) return options.baseUrl;
  if (path.startsWith('/rpc/')) return RPC_BASE;
  return RECRUITER_API_BASE;
}

async function requestJsonWithTimeout(path, init = {}, options = {}) {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const useBasicAuth = options.basicAuth !== false;
  const url = `${requestBaseFor(path, options)}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(useBasicAuth ? authHeaders() : {}),
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
      throw new Error(`${init.method ?? 'GET'} ${path} failed (${response.status}): ${text}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestJson(path, init = {}, options = {}) {
  const useBasicAuth = options.basicAuth !== false;
  const url = `${requestBaseFor(path, options)}${path}`;
  const maxAttempts = options.retryTransient === false ? 1 : 3;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const method = init.method ?? 'GET';
  let response;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error(`${method} ${path} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    try {
      response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(useBasicAuth ? authHeaders() : {}),
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
      });
      break;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const causeCode = error instanceof Error && error.cause && typeof error.cause === 'object'
        ? error.cause.code
        : null;
      const errorName = error instanceof Error ? error.name : '';
      const transient = message.includes('fetch failed')
        || message.includes('timed out')
        || message.includes('timeout')
        || errorName === 'AbortError'
        || causeCode === 'ECONNRESET'
        || causeCode === 'EPIPE'
        || causeCode === 'ECONNREFUSED';
      if (!transient || attempt === maxAttempts) {
        throw error;
      }
      await sleep(500 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!response) {
    throw lastError ?? new Error(`${method} ${path} did not return a response`);
  }

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
    throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
  }
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function challengePreview(challenge) {
  if (!challenge || typeof challenge !== 'object') return challenge ?? null;
  const contrastMetric = assessmentQualityMetric(challenge, 'contrast_separation');
  const sourceBridge = challenge.matchExplanation?.validatorAgent?.sourceBridge ?? null;
  return {
    id: challenge.id ?? null,
    type: challenge.type ?? null,
    title: challenge.title ?? null,
    githubRepoUrl: challenge.githubRepoUrl ?? null,
    githubPrNumber: challenge.githubPrNumber ?? null,
    hasCachedDiffJson: Boolean(challenge.cachedDiffJson),
    hasMatchExplanation: Boolean(challenge.matchExplanation),
    matchStatus: challenge.matchExplanation?.status ?? null,
    qualityGate: challenge.matchExplanation?.qualityGate?.verdict ?? null,
    assessmentQuality: challenge.matchExplanation?.assessmentQuality?.verdict ?? null,
    contrastSeparation: contrastMetric
      ? { score: contrastMetric.score ?? null, reason: contrastMetric.reason ?? null }
      : null,
    hasValidatorAgent: Boolean(challenge.matchExplanation?.validatorAgent),
    sourceBridge: sourceBridge
      ? {
          candidateSourceCount: sourceBridge.candidateSourceCount ?? null,
          roleSourceCount: sourceBridge.roleSourceCount ?? null,
          repoSourceCount: sourceBridge.repoSourceCount ?? null,
          alignedDemandCount: sourceBridge.alignedDemandCount ?? null,
        }
      : null,
    hasReviewSession: Boolean(challenge.reviewSession),
  };
}

function assessmentQualityMetric(challenge, metricId) {
  const metrics = challenge?.matchExplanation?.assessmentQuality?.metrics;
  if (!Array.isArray(metrics)) return null;
  return metrics.find((metric) => metric?.id === metricId) ?? null;
}

function parseMaybeJson(value) {
  let parsed = value;
  for (let depth = 0; depth < 2 && typeof parsed === 'string'; depth += 1) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === 'object' ? parsed : null;
}

function isDeletionLine(line) {
  const type = typeof line?.type === 'string' ? line.type : '';
  return type === 'deletion' || type === 'deleted' || type === 'removed';
}

function isDiffMetadataContent(content) {
  const trimmed = typeof content === 'string' ? content.trim() : '';
  return !trimmed
    || trimmed === '---'
    || trimmed === '+++'
    || trimmed.startsWith('@@')
    || trimmed.startsWith('diff --git')
    || trimmed.startsWith('--- ')
    || trimmed.startsWith('+++ ');
}

function lineNumberFor(line, fallback) {
  const candidates = [line?.lineNumber, line?.num, line?.newLineNumber, line?.new_lineno];
  for (const candidate of candidates) {
    if (Number.isInteger(candidate) && candidate > 0) return candidate;
  }
  return fallback;
}

function pickAnnotationTarget(challenge) {
  const diff = parseMaybeJson(challenge.cachedDiffJson) ?? challenge.cachedDiffJson;
  const files = Array.isArray(diff?.files) ? diff.files : [];
  for (const file of files) {
    const filePath = file?.path ?? file?.filename;
    if (typeof filePath !== 'string' || filePath.length === 0) continue;

    const hunks = Array.isArray(file?.hunks) ? file.hunks : [];
    for (const hunk of hunks) {
      const lines = Array.isArray(hunk?.lines) ? hunk.lines : [];
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (isDeletionLine(line)) continue;
        if (isDiffMetadataContent(line?.content)) continue;
        return {
          file: filePath,
          line: lineNumberFor(line, index + 1),
          content: typeof line?.content === 'string' ? line.content : null,
        };
      }
    }

    if (typeof file.patch === 'string') {
      const patchLines = file.patch.split('\n');
      let currentLine = 1;
      for (const patchLine of patchLines) {
        const hunkMatch = patchLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunkMatch) {
          currentLine = Number(hunkMatch[1]);
          continue;
        }
        if (patchLine.startsWith('-')) continue;
        if (patchLine.startsWith('+') || patchLine.startsWith(' ')) {
          return {
            file: filePath,
            line: currentLine,
            content: patchLine.slice(1),
          };
        }
        currentLine += 1;
      }
    }
  }

  throw new Error(`Could not find an annotatable diff line in challenge: ${JSON.stringify(challengePreview(challenge))}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanUrl(rawUrl) {
  if (!rawUrl) return null;
  const url = new URL(rawUrl);
  url.username = '';
  url.password = '';
  return url.toString()
    .replace(/\/assess\/[^/?#]+/, '/assess/<token>')
    .replace(/\/room\/[^/?#]+/, '/room/<token>');
}

function assertAssessUrl(rawUrl) {
  assert(typeof rawUrl === 'string' && rawUrl.length > 0, 'Invite response missing deliveredUrl.');
  const url = new URL(rawUrl);
  const match = url.pathname.match(/\/assess\/([^/?#]+)/);
  assert(match, `Delivered URL is not an assess link: ${cleanUrl(rawUrl)}`);
  return decodeURIComponent(match[1]);
}

function canonicalUrl(rawUrl) {
  if (!rawUrl) return null;
  const url = new URL(rawUrl);
  url.username = '';
  url.password = '';
  return url.toString();
}

function currentMatchMode() {
  if (ROLE_BACKED) return 'role_backed_auto_match';
  return REPO_URL && PR_NUMBER ? 'manual_override' : 'auto_match';
}

async function createRoleBackedCodeReviewInvite() {
  const unique = Date.now();
  const recipientEmail = `code-review-role-smoke-${unique}@pipe-test.dev`;
  const recipientName = 'Code Review Role Smoke';

  const roleContext = await requestJson('/api/v1/role-contexts/simple-job-description', {
    method: 'POST',
    body: JSON.stringify({
      title: ROLE_TITLE,
      jobDescriptionMd: ROLE_JOB_DESCRIPTION,
      selectedTerms: ROLE_SELECTED_TERMS,
    }),
  });
  assert(roleContext?.id, `Role context response missing id: ${JSON.stringify(roleContext)}`);
  assert(
    Array.isArray(roleContext.selectedTerms) && roleContext.selectedTerms.length >= ROLE_SELECTED_TERMS.length,
    `Role context did not persist selected terms: ${JSON.stringify(roleContext)}`,
  );

  const autoBuilt = await requestJson('/api/v1/pipelines/auto-build', {
    method: 'POST',
    body: JSON.stringify({
      role_context_id: roleContext.id,
      pipeline_title: `${ROLE_TITLE} CODE_REVIEW Smoke ${unique}`,
      match_config: {
        match_philosophy: 'tailored',
        tolerance: 'moderate',
        stage_linkage: 'shared-repo',
        automation_granularity: 'per-candidate',
        hybrid_mix_ratio: null,
        non_negotiable_skills: roleContext.selectedTerms,
      },
      selected_stages: ['CODE_REVIEW'],
    }),
  });
  const pipelineId = autoBuilt?.pipeline?.id;
  const codeReviewStage = Array.isArray(autoBuilt?.stages)
    ? autoBuilt.stages.find((stage) => stage?.type === 'CODE_REVIEW')
    : null;
  const stageId = codeReviewStage?.id;
  assert(pipelineId, `Auto-build response missing pipeline id: ${JSON.stringify(autoBuilt)}`);
  assert(stageId, `Auto-build response missing CODE_REVIEW stage id: ${JSON.stringify(autoBuilt)}`);

  const candidateCreated = await requestJson(`/api/v1/pipelines/${pipelineId}/candidates`, {
    method: 'POST',
    body: JSON.stringify({
      name: recipientName,
      email: recipientEmail,
      currentStageId: stageId,
      skipEmail: true,
    }),
  });
  const candidateId = candidateCreated?.candidate?.id;
  assert(candidateId, `Pipeline candidate response missing candidate id: ${JSON.stringify(candidateCreated)}`);

  const created = await requestJson('/api/v1/scheduling/interviews', {
    method: 'POST',
    body: JSON.stringify({
      candidateId,
      pipelineId,
      stageId,
      meetingType: 'DIRECT_VIDEO_CALL',
      interviewType: 'CODE_REVIEW',
    }),
  });
  const interviewId = created?.interview?.id;
  assert(interviewId, `Create role-backed interview response missing id: ${JSON.stringify(created)}`);
  assert(created?.interview?.interviewType === 'CODE_REVIEW', 'Created role-backed interview is not CODE_REVIEW.');

  const invited = await requestJson(`/api/v1/scheduling/interviews/${interviewId}/invite`, {
    method: 'POST',
    body: JSON.stringify({
      email: recipientEmail,
      sendEmail: SEND_EMAIL,
      message: 'Automated smoke for the role-backed async CODE_REVIEW assess-link path.',
    }),
  });
  assert(invited?.success === true, `Role-backed invite did not report success: ${JSON.stringify(invited)}`);
  assert(invited?.emailSent === SEND_EMAIL, `Unexpected role-backed emailSent value: ${JSON.stringify(invited)}`);

  const deliveredUrl = invited?.deliveredUrl ?? invited?.meetingUrl;
  const inviteToken = assertAssessUrl(deliveredUrl);
  assert(
    !canonicalUrl(deliveredUrl)?.includes('/room/'),
    `Role-backed CODE_REVIEW delivered URL must not be a room URL: ${cleanUrl(deliveredUrl)}`,
  );

  return {
    interviewId,
    recipientEmail,
    recipientName,
    deliveredUrl,
    inviteToken,
    invited,
    roleContextId: roleContext.id,
    pipelineId,
    stageId,
    candidateId,
  };
}

async function createCodeReviewInvite() {
  if (ROLE_BACKED) return createRoleBackedCodeReviewInvite();

  const unique = Date.now();
  const recipientEmail = `code-review-assess-smoke-${unique}@pipe-test.dev`;
  const recipientName = 'Code Review Assess Smoke';
  const createPayload = {
    recipientName,
    recipientEmail,
    meetingType: 'DIRECT_VIDEO_CALL',
    interviewType: 'CODE_REVIEW',
    ...(REPO_URL ? { githubRepoUrl: REPO_URL } : {}),
    ...(PR_NUMBER ? { githubPrNumber: PR_NUMBER } : {}),
  };

  const created = await requestJson('/api/v1/scheduling/interviews', {
    method: 'POST',
    body: JSON.stringify(createPayload),
  });
  const interviewId = created?.interview?.id;
  assert(interviewId, `Create interview response missing interview id: ${JSON.stringify(created)}`);
  assert(created?.interview?.interviewType === 'CODE_REVIEW', 'Created interview is not CODE_REVIEW.');

  const invited = await requestJson(`/api/v1/scheduling/interviews/${interviewId}/invite`, {
    method: 'POST',
    body: JSON.stringify({
      email: recipientEmail,
      sendEmail: SEND_EMAIL,
      message: 'Automated smoke for the async CODE_REVIEW assess-link path.',
    }),
  });
  assert(invited?.success === true, `Invite did not report success: ${JSON.stringify(invited)}`);
  assert(invited?.emailSent === SEND_EMAIL, `Unexpected emailSent value: ${JSON.stringify(invited)}`);

  const deliveredUrl = invited?.deliveredUrl ?? invited?.meetingUrl;
  const inviteToken = assertAssessUrl(deliveredUrl);
  assert(
    !canonicalUrl(deliveredUrl)?.includes('/room/'),
    `CODE_REVIEW delivered URL must not be a room URL: ${cleanUrl(deliveredUrl)}`,
  );
  if (invited?.room?.guestUrl) {
    assert(
      canonicalUrl(deliveredUrl) !== canonicalUrl(invited.room.guestUrl),
      'CODE_REVIEW deliveredUrl must be distinct from the generated guest room URL.',
    );
  }

  return { interviewId, recipientEmail, recipientName, deliveredUrl, inviteToken, invited };
}

async function createRelatedPersonBoundaryInterview(invite) {
  if (!PERSON_RELATED_BOUNDARY) return null;

  const created = await requestJson('/api/v1/scheduling/interviews', {
    method: 'POST',
    body: JSON.stringify({
      recipientName: invite.recipientName,
      recipientEmail: invite.recipientEmail,
      meetingType: 'DIRECT_VIDEO_CALL',
      interviewType: 'CODE_REVIEW',
      githubRepoUrl: RELATED_BOUNDARY_REPO_URL,
      githubPrNumber: RELATED_BOUNDARY_PR_NUMBER,
      recruiterNotes: [
        'Automated same-person boundary smoke.',
        'This related CODE_REVIEW invite intentionally has no candidate submission.',
        'The person profile must not use it as the completed recommendation.',
      ].join(' '),
    }),
  });

  const interview = created?.interview;
  assert(interview?.id, `Related boundary interview response missing id: ${JSON.stringify(created)}`);
  assert(interview?.interviewType === 'CODE_REVIEW', `Related boundary interview is not CODE_REVIEW: ${JSON.stringify(created)}`);
  assert(
    interview?.recipientEmail === invite.recipientEmail,
    `Related boundary interview did not preserve same recipient email: ${JSON.stringify(created)}`,
  );

  return {
    interviewId: interview.id,
    contactId: interview.contactId ?? null,
    status: interview.status ?? null,
    repoUrl: interview.githubRepoUrl ?? RELATED_BOUNDARY_REPO_URL,
    prNumber: interview.githubPrNumber ?? RELATED_BOUNDARY_PR_NUMBER,
    assessmentSetupStatus: interview.assessmentSetup?.status ?? null,
  };
}

export function assertPersonRelatedBoundaryProfile({
  profile,
  selectedInterviewId,
  selectedInterviewDetail = null,
  selectedRepoUrl,
  selectedPrNumber,
  relatedBoundaryInterview,
}) {
  if (!relatedBoundaryInterview) return {
    verified: false,
    reason: 'no related boundary interview requested',
  };

  const scheduledInterviews = Array.isArray(profile?.scheduledInterviews)
    ? profile.scheduledInterviews
    : [];
  const selected = scheduledInterviews.find((candidateInterview) =>
    candidateInterview?.id === selectedInterviewId
  ) ?? selectedInterviewDetail;
  const relatedFromCandidateProfile = scheduledInterviews.find((candidateInterview) =>
    candidateInterview?.id === relatedBoundaryInterview.interviewId
  );
  const relatedFromInterviewDetail = Array.isArray(selectedInterviewDetail?.relatedEvidenceInterviews)
    ? selectedInterviewDetail.relatedEvidenceInterviews.find((candidateInterview) =>
        candidateInterview?.id === relatedBoundaryInterview.interviewId
      )
    : null;
  const related = relatedFromCandidateProfile ?? relatedFromInterviewDetail;
  assert(
    selected?.status === 'COMPLETED',
    `Person profile boundary missing completed selected interview ${selectedInterviewId}: ${JSON.stringify(scheduledInterviews)}`,
  );
  assert(
    related?.id === relatedBoundaryInterview.interviewId,
    `Person profile boundary missing related same-person interview ${relatedBoundaryInterview.interviewId}: ${JSON.stringify(scheduledInterviews)}`,
  );

  const match = profile?.standaloneReviewMatch ?? null;
  assert(
    match?.submitted === true
      && match?.matchStatus === 'MATCHED'
      && match?.repoUrl === selectedRepoUrl
      && String(match?.prNumber ?? '') === String(selectedPrNumber),
    `Person profile selected code-review recommendation does not point at submitted interview ${selectedInterviewId}: ${JSON.stringify(match)}`,
  );
  assert(
    match?.interviewId === undefined
      || match.interviewId === selectedInterviewId,
    `Person profile selected code-review recommendation points at related interview ${relatedBoundaryInterview.interviewId}: ${JSON.stringify(match)}`,
  );
  assert(
    match.repoUrl !== relatedBoundaryInterview.repoUrl
      || String(match.prNumber ?? '') !== String(relatedBoundaryInterview.prNumber ?? ''),
    `Person profile selected code-review recommendation promoted related repo/PR ${relatedBoundaryInterview.repoUrl}#${relatedBoundaryInterview.prNumber}: ${JSON.stringify(match)}`,
  );

  return {
    verified: true,
    selectedInterviewId,
    relatedInterviewId: relatedBoundaryInterview.interviewId,
    relatedSource: relatedFromCandidateProfile ? 'candidate_profile' : 'interview_detail',
    selectedRepoUrl,
    selectedPrNumber,
    relatedRepoUrl: relatedBoundaryInterview.repoUrl,
    relatedPrNumber: relatedBoundaryInterview.prNumber,
    scheduledCodeReviewCount: scheduledInterviews.filter((candidateInterview) =>
      candidateInterview?.interviewType === 'CODE_REVIEW'
    ).length,
  };
}

async function verifyPersonRelatedBoundaryProfile({
  candidateId,
  selectedInterviewId,
  selectedRepoUrl,
  selectedPrNumber,
  relatedBoundaryInterview,
}) {
  if (!relatedBoundaryInterview) return null;
  const profile = await requestJson(`/api/v1/candidates/${candidateId}`);
  const detail = await requestJson(`/api/v1/scheduling/interviews/${selectedInterviewId}`);
  return assertPersonRelatedBoundaryProfile({
    profile,
    selectedInterviewId,
    selectedInterviewDetail: detail?.interview ?? null,
    selectedRepoUrl,
    selectedPrNumber,
    relatedBoundaryInterview,
  });
}

async function resolveInvite(inviteToken) {
  return requestJson('/rpc/resolve-token', {
    method: 'POST',
    body: JSON.stringify({ inviteToken }),
  });
}

async function verifyFreshRecruiterCandidateAssessmentLink({
  interviewId,
  deliveredUrl,
  session,
}) {
  const detail = await requestJsonWithTimeout(
    `/api/v1/scheduling/interviews/${interviewId}`,
    {},
    { timeoutMs: 12_000 },
  );
  const setup = detail?.interview?.assessmentSetup ?? null;
  assert(setup, `Recruiter detail missing assessment setup for candidate link proof: ${JSON.stringify(detail).slice(0, 1200)}`);
  assert(
    typeof setup.lastDeliveredUrl === 'string' && setup.lastDeliveredUrl.length > 0,
    `Recruiter detail missing delivered candidate assessment URL: ${JSON.stringify(setup)}`,
  );
  assert(
    canonicalUrl(setup.lastDeliveredUrl) === canonicalUrl(deliveredUrl),
    `Recruiter candidate assessment URL does not match delivered invite URL: ${JSON.stringify({
      recruiterUrl: cleanUrl(setup.lastDeliveredUrl),
      deliveredUrl: cleanUrl(deliveredUrl),
    })}`,
  );
  assert(
    setup.lastDeliveredUrlState === 'active',
    `Expected fresh recruiter candidate assessment URL to be active before intake, got ${setup.lastDeliveredUrlState}: ${JSON.stringify(setup)}`,
  );
  assertAssessUrl(setup.lastDeliveredUrl);
  assert(
    typeof session?.sessionToken === 'string' && session.sessionToken.length > 0,
    `Resolved invite did not return a candidate session token before intake: ${JSON.stringify(session)}`,
  );

  return {
    verified: true,
    state: setup.lastDeliveredUrlState,
    recruiterUrl: cleanUrl(setup.lastDeliveredUrl),
    sessionStatus: session.status ?? null,
    setupStatus: setup.status ?? null,
    setupKind: setup.kind ?? null,
  };
}

async function submitIntake(sessionToken) {
  const intake = await requestJson('/rpc/submit-challenge-response', {
    method: 'POST',
    headers: candidateHeaders(sessionToken),
    body: JSON.stringify({
      order: 0,
      submission: {
        resumeText: RESUME_TEXT,
        githubHandle: GITHUB_HANDLE,
      },
    }),
  }, { basicAuth: false });
  assert(intake?.success === true, `Intake submission did not succeed: ${JSON.stringify(intake)}`);
  return intake;
}

async function getChallenge(sessionToken, order = 0) {
  return requestJson('/rpc/get-challenge', {
    method: 'POST',
    headers: candidateHeaders(sessionToken),
    body: JSON.stringify({ order }),
  }, { basicAuth: false });
}

async function getStageConfig(sessionToken) {
  return requestJson('/rpc/get-stage-config', {
    method: 'POST',
    headers: candidateHeaders(sessionToken),
    body: JSON.stringify({}),
  }, { basicAuth: false });
}

function assertProfileReceivedHandoff({ stageConfig, challenge }) {
  assert(
    stageConfig?.isComplete === true
      && stageConfig?.stageId === 'candidate-intake-queued',
    `Expected candidate-intake-queued complete stage config, got: ${JSON.stringify(stageConfig)}`,
  );
  assert(
    stageConfig?.stageTitle === 'Profile received',
    `Expected Profile received stage title, got: ${JSON.stringify(stageConfig)}`,
  );
  assert(
    Array.isArray(stageConfig?.challenges)
      && stageConfig.challenges.length === 0,
    `Expected no candidate-facing intake or matching challenges, got: ${JSON.stringify(stageConfig)}`,
  );
  assert(
    challenge?.type === 'PROFILE_RECEIVED',
    `Expected PROFILE_RECEIVED handoff, got: ${JSON.stringify(challenge)}`,
  );
  assert(
    challenge?.id === 'profile-received',
    `Expected profile-received challenge id, got: ${JSON.stringify(challenge)}`,
  );
  assert(
    typeof challenge?.instructions === 'string'
      && challenge.instructions.includes('email you when your code review is ready'),
    `Expected candidate-safe email handoff instructions, got: ${JSON.stringify(challenge)}`,
  );

  const serialized = JSON.stringify({ stageConfig, challenge });
  assert(
    !serialized.includes('WAITING_FOR_MATCH')
      && !serialized.includes('Upload Your CV')
      && !serialized.includes('Profile & Resume')
      && !serialized.includes('Building your personalized challenge'),
    `Candidate handoff leaked intake or matching UI state: ${serialized.slice(0, 1200)}`,
  );
}

async function bootstrapStageConfig(sessionToken) {
  const stageConfig = await getStageConfig(sessionToken);

  assert(stageConfig?.isComplete !== true, `Stage config unexpectedly complete before CODE_REVIEW: ${JSON.stringify(stageConfig)}`);
  assert(stageConfig?.stageId, `Stage config missing stage id: ${JSON.stringify(stageConfig)}`);
  assert(
    Array.isArray(stageConfig.challenges) && stageConfig.challenges.length > 0,
    `Stage config missing challenges: ${JSON.stringify(stageConfig)}`,
  );

  return stageConfig;
}

async function waitForBootstrapStageConfig(sessionToken) {
  if (!AUTO_MATCH) return bootstrapStageConfig(sessionToken);

  const deadline = Date.now() + 120_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await getStageConfig(sessionToken);
    if (
      last?.isComplete !== true
      && last?.stageId
      && Array.isArray(last.challenges)
      && last.challenges.length > 0
    ) {
      return last;
    }
    if (
      last?.isComplete === true
      && last?.stageId === 'candidate-intake-queued'
    ) {
      await sleep(5_000);
      continue;
    }
    throw new Error(`Unexpected stage config while waiting for CODE_REVIEW: ${JSON.stringify(last).slice(0, 1200)}`);
  }
  throw new Error(`CODE_REVIEW stage config did not become ready after upstream matching. Last response: ${JSON.stringify(last).slice(0, 1200)}`);
}

async function pollCodeReviewChallenge(sessionToken, order = 0, options = {}) {
  const deadline = Date.now() + 120_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await getChallenge(sessionToken, order);
    if (options.expectBlocked) {
      if (last?.type === 'PROFILE_RECEIVED') return last;
      if (last?.type === 'CODE_REVIEW') {
        throw new Error(`Expected repo matching to block, but CODE_REVIEW became ready: ${JSON.stringify(challengePreview(last))}`);
      }
      if (last?.type === 'WAITING_FOR_MATCH') {
        throw new Error(`Standalone CODE_REVIEW blocked handoff must return PROFILE_RECEIVED, not candidate-visible WAITING_FOR_MATCH: ${JSON.stringify(last).slice(0, 800)}`);
      }
      throw new Error(`Expected PROFILE_RECEIVED blocked handoff, got: ${JSON.stringify(last).slice(0, 800)}`);
    }
    if (last?.type === 'CODE_REVIEW') {
      return last;
    }
    if (AUTO_MATCH && last?.type === 'PROFILE_RECEIVED') {
      await sleep(5_000);
      continue;
    }
    if (last?.type === 'WAITING_FOR_MATCH') {
      throw new Error(`CODE_REVIEW /assess must not expose candidate-visible WAITING_FOR_MATCH; expected ready CODE_REVIEW or PROFILE_RECEIVED handoff: ${JSON.stringify(last).slice(0, 800)}`);
    }
    throw new Error(`Expected CODE_REVIEW or PROFILE_RECEIVED handoff, got: ${JSON.stringify(last).slice(0, 800)}`);
  }
  throw new Error(`CODE_REVIEW challenge did not become ready. Last response: ${JSON.stringify(last).slice(0, 1200)}`);
}

function runBrowserSmoke({
  deliveredUrl,
  inviteToken,
  session,
  expectedMatchProofVerdict,
  expectProfileReceived = false,
}) {
  if (SKIP_BROWSER) return { skipped: true };

  const result = spawnSync(
    'npx',
    [
      'playwright',
      'test',
      'e2e/code-review-assess-smoke.unauth.spec.ts',
      '--project=unauthenticated',
      '--reporter=line',
    ],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: buildCodeReviewAssessBrowserSmokeEnv({
        baseEnv: process.env,
        appBase: APP_BASE,
        apiBase: API_BASE,
        videoRoomBase: VIDEO_ROOM_BASE,
        deliveredUrl,
        inviteToken,
        session,
        expectedMatchProofVerdict,
        expectProfileReceived,
        expectAutomatch: EXPECT_AUTOMATCH,
        expectManualOverride: REPO_URL && PR_NUMBER ? '1' : '0',
        requireHyperedges: REPO_URL && PR_NUMBER ? '0' : '1',
        submitReview: SUBMIT_REVIEW,
      }),
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Playwright assess smoke failed with exit code ${result.status}`);
  }
  return { skipped: false };
}

export function buildCodeReviewAssessBrowserSmokeEnv({
  baseEnv,
  appBase,
  apiBase,
  videoRoomBase,
  deliveredUrl,
  inviteToken,
  session,
  expectedMatchProofVerdict,
  expectProfileReceived = false,
  expectAutomatch,
  expectManualOverride,
  requireHyperedges,
  submitReview,
}) {
  const candidate = JSON.stringify({
    id: session.id,
    pipelineId: session.pipelineId ?? null,
    status: session.status ?? 'IN_PROGRESS',
    name: session.name ?? 'CODE_REVIEW Smoke Candidate',
  });
  const { user: browserBasicAuthUser, password: browserBasicAuthPassword } = resolveAppDevBasicAuth(baseEnv);

  return {
    ...baseEnv,
    ...(browserBasicAuthUser && browserBasicAuthPassword
      ? {
          PIPE_DEV_BASIC_AUTH_USER: browserBasicAuthUser,
          PIPE_DEV_BASIC_AUTH_PASSWORD: browserBasicAuthPassword,
        }
      : {}),
    APP_BASE: appBase,
    API_BASE: apiBase,
    VIDEO_ROOM_BASE: videoRoomBase,
    PIPE_SKIP_CLERK_GLOBAL_SETUP: '1',
    CODE_REVIEW_ASSESS_TOKEN: deliveredUrl,
    CODE_REVIEW_SESSION_TOKEN: session.sessionToken,
    CODE_REVIEW_SESSION_INVITE_TOKEN: inviteToken,
    CODE_REVIEW_SESSION_CANDIDATE_JSON: candidate,
    CODE_REVIEW_EXPECT_AUTOMATCH: expectAutomatch,
    CODE_REVIEW_EXPECT_MANUAL_OVERRIDE: expectManualOverride,
    CODE_REVIEW_EXPECT_PROFILE_RECEIVED: expectProfileReceived ? '1' : '0',
    CODE_REVIEW_EXPECT_MATCH_PROOF_VERDICT: expectedMatchProofVerdict,
    CODE_REVIEW_REQUIRE_HYPEREDGES: requireHyperedges,
    CODE_REVIEW_BROWSER_SUBMIT_ROUND: submitReview ? '1' : '0',
  };
}

export function recruiterDetailReady(interview, {
  expectedOutcome,
  expectedRepoUrl = '',
  expectedPrNumber = '',
  expectSubmission = false,
  expectScore = false,
  allowInvitedForCandidateLink = false,
}) {
  if (!interview || typeof interview !== 'object') {
    return { ready: false, reason: 'detail missing interview object' };
  }
  if (expectedOutcome === 'blocked') {
    const setupStatus = interview.assessmentSetup?.status ?? null;
    const progressStage = interview.assessmentProgress?.stage ?? null;
    const progressNextAction = interview.assessmentProgress?.nextAction ?? null;
    const blocked = [
      'missing_reviewable_task',
      'waiting_for_candidate_evidence',
      'waiting_for_source_backed_match',
    ].includes(setupStatus)
      || progressStage === 'NEEDS_ATTENTION'
      || progressNextAction === 'ASSIGN_CHALLENGE'
      || progressNextAction === 'RESOLVE_DIAGNOSTIC'
      || interview.assessmentSetup?.lastDeliveredUrlState === 'claimed';
    return blocked || interview.assessmentSetup
      ? { ready: true, reason: 'blocked projection ready' }
      : { ready: false, reason: 'blocked projection missing setup/progress' };
  }

  const acceptableStatuses = expectSubmission || expectScore
    ? ['COMPLETED']
    : allowInvitedForCandidateLink
      ? ['INVITED', 'ACTIVE', 'COMPLETED']
      : ['ACTIVE', 'COMPLETED'];
  if (!acceptableStatuses.includes(interview.status)) {
    return {
      ready: false,
      reason: `interview status is ${interview.status ?? 'missing'}`,
    };
  }
  if (expectedRepoUrl && interview.githubRepoUrl !== expectedRepoUrl) {
    return { ready: false, reason: `repo is ${interview.githubRepoUrl ?? 'missing'}` };
  }
  if (expectedPrNumber && String(interview.githubPrNumber ?? '') !== String(expectedPrNumber)) {
    return { ready: false, reason: `PR is ${interview.githubPrNumber ?? 'missing'}` };
  }
  if (interview.codeReviewMatch?.status !== 'MATCHED') {
    return { ready: false, reason: 'codeReviewMatch is not MATCHED' };
  }
  if (expectSubmission && !interview.submissionJson) {
    return { ready: false, reason: 'submissionJson missing' };
  }
  if (expectScore) {
    const score = interview.codeReviewScore;
    if (!score || score.status !== 'scored' || !Number.isFinite(Number(score.score))) {
      return { ready: false, reason: 'scored codeReviewScore missing' };
    }
  }
  return { ready: true, reason: 'matched recruiter projection ready' };
}

async function waitForRecruiterDetailProjection(input) {
  const deadlineMs = Date.now() + (input.timeoutMs ?? 90_000);
  let attempt = 0;
  let lastReason = 'not checked';
  while (Date.now() < deadlineMs) {
    attempt += 1;
    try {
      const detail = await requestJsonWithTimeout(
        `/api/v1/scheduling/interviews/${input.interviewId}`,
        {},
        { timeoutMs: 12_000 },
      );
      const readiness = recruiterDetailReady(detail?.interview, input);
      lastReason = readiness.reason;
      if (readiness.ready) {
        return {
          ready: true,
          attempts: attempt,
          reason: readiness.reason,
          assessmentSetupStatus: detail?.interview?.assessmentSetup?.status ?? null,
          assessmentSetupKind: detail?.interview?.assessmentSetup?.kind ?? null,
          assessmentSetupSource: detail?.interview?.assessmentSetup?.source ?? null,
          githubRepoUrl: detail?.interview?.githubRepoUrl ?? null,
          githubPrNumber: detail?.interview?.githubPrNumber ?? null,
        };
      }
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
    }
    await sleep(Math.min(2_000 + attempt * 250, 5_000));
  }
  throw new Error(
    `Recruiter detail projection was not ready for ${input.interviewId}: ${lastReason}`,
  );
}

function runRecruiterDetailPlaywright({
  interviewId,
  expectedOutcome,
  expectedRepoUrl = '',
  expectedPrNumber = '',
  expectSubmission = false,
  expectScore = false,
  requireHyperedges = false,
  expectPersonProfileDecision = false,
  expectPersonProfilePending = false,
  expectPersonProfileRelatedBoundary = false,
  expectCandidateLink = false,
  expectedCandidateLinkKind = '',
}) {
  if (SKIP_BROWSER || SKIP_RECRUITER_BROWSER) {
    return {
      skipped: true,
      reason: SKIP_BROWSER
        ? 'CODE_REVIEW_SMOKE_SKIP_BROWSER=1'
        : 'CODE_REVIEW_SMOKE_SKIP_RECRUITER_BROWSER=1',
    };
  }

  const result = spawnSync(
    'npx',
    buildRecruiterDetailPlaywrightArgs(process.env),
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: buildRecruiterDetailPlaywrightEnv({
        baseEnv: process.env,
        appBase: APP_BASE,
        apiBase: API_BASE,
        videoRoomBase: VIDEO_ROOM_BASE,
        interviewId,
        expectedOutcome,
        expectedRepoUrl,
        expectedPrNumber,
        expectSubmission,
        expectScore,
        requireHyperedges,
        expectPersonProfileDecision,
        expectPersonProfilePending,
        expectPersonProfileRelatedBoundary,
        expectCandidateLink,
        expectedCandidateLinkKind,
      }),
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Playwright recruiter detail smoke failed with exit code ${result.status}`);
  }
  const readoutContract = expectedOutcome === 'blocked'
    ? 'blocked-code-review-action-readout'
    : expectSubmission || expectScore
      ? 'scored-code-review-hiring-manager-readout'
      : 'matched-code-review-hiring-manager-readout';
  return { skipped: false, readoutContract };
}

export function buildRecruiterDetailPlaywrightEnv({
  baseEnv = process.env,
  appBase = APP_BASE,
  apiBase = API_BASE,
  videoRoomBase = VIDEO_ROOM_BASE,
  interviewId,
  expectedOutcome,
  expectedRepoUrl = '',
  expectedPrNumber = '',
  expectSubmission = false,
  expectScore = false,
  requireHyperedges = false,
  expectPersonProfileDecision = false,
  expectPersonProfilePending = false,
  expectPersonProfileRelatedBoundary = false,
  expectCandidateLink = false,
  expectedCandidateLinkKind = '',
} = {}) {
  const { user: browserBasicAuthUser, password: browserBasicAuthPassword } = resolveAppDevBasicAuth(baseEnv);
  return {
    ...baseEnv,
    ...(browserBasicAuthUser && browserBasicAuthPassword
      ? {
          PIPE_APP_DEV_BASIC_AUTH_USER: browserBasicAuthUser,
          PIPE_APP_DEV_BASIC_AUTH_PASSWORD: browserBasicAuthPassword,
          PIPE_DEV_BASIC_AUTH_USER: browserBasicAuthUser,
          PIPE_DEV_BASIC_AUTH_PASSWORD: browserBasicAuthPassword,
        }
      : {}),
    APP_BASE: appBase,
    API_BASE: apiBase,
    VIDEO_ROOM_BASE: videoRoomBase,
    CODE_REVIEW_RECRUITER_INTERVIEW_ID: interviewId,
    CODE_REVIEW_RECRUITER_EXPECT_OUTCOME: expectedOutcome,
    CODE_REVIEW_RECRUITER_EXPECT_MATCH_MODE: currentMatchMode(),
    CODE_REVIEW_RECRUITER_EXPECT_REPO_URL: expectedRepoUrl,
    CODE_REVIEW_RECRUITER_EXPECT_PR_NUMBER: String(expectedPrNumber ?? ''),
    CODE_REVIEW_RECRUITER_EXPECT_SUBMISSION: expectSubmission ? '1' : '0',
    CODE_REVIEW_RECRUITER_EXPECT_SCORE: expectScore ? '1' : '0',
    CODE_REVIEW_RECRUITER_REQUIRE_HYPEREDGES: requireHyperedges ? '1' : '0',
    CODE_REVIEW_RECRUITER_EXPECT_PERSON_PROFILE_DECISION: expectPersonProfileDecision ? '1' : '0',
    CODE_REVIEW_RECRUITER_EXPECT_PERSON_PROFILE_PENDING: expectPersonProfilePending ? '1' : '0',
    CODE_REVIEW_RECRUITER_EXPECT_PERSON_PROFILE_RELATED_BOUNDARY: expectPersonProfileRelatedBoundary ? '1' : '0',
    CODE_REVIEW_RECRUITER_EXPECT_CANDIDATE_LINK: expectCandidateLink ? '1' : '0',
    CODE_REVIEW_RECRUITER_EXPECT_CANDIDATE_LINK_KIND: expectedCandidateLinkKind,
    CODE_REVIEW_RECRUITER_RELATED_BOUNDARY_REPO_URL: RELATED_BOUNDARY_REPO_URL,
    CODE_REVIEW_RECRUITER_RELATED_BOUNDARY_PR_NUMBER: String(RELATED_BOUNDARY_PR_NUMBER),
  };
}

export function buildRecruiterDetailPlaywrightArgs(env = process.env) {
  return [
    'playwright',
    'test',
    'e2e/code-review-recruiter-detail-smoke.spec.ts',
    '--project=authenticated',
    '--reporter=line',
    ...(shouldSkipPlaywrightProjectDependencies(env) ? ['--no-deps'] : []),
  ];
}

export function shouldSkipPlaywrightProjectDependencies(env = process.env) {
  return env.PIPE_SKIP_CLERK_GLOBAL_SETUP === '1'
    || env.PLAYWRIGHT_SKIP_CLERK_GLOBAL_SETUP === '1';
}

async function runRecruiterDetailBrowserSmoke(input) {
  const mode = recruiterProjectionVerificationMode({
    skipBrowser: SKIP_BROWSER,
    skipRecruiterBrowser: SKIP_RECRUITER_BROWSER,
  });
  if (mode === 'skip_all') {
    return {
      skipped: true,
      reason: 'CODE_REVIEW_SMOKE_SKIP_BROWSER=1',
    };
  }

  const readiness = await waitForRecruiterDetailProjection(input);
  if (mode === 'api_only') {
    return {
      skipped: true,
      reason: 'CODE_REVIEW_SMOKE_SKIP_RECRUITER_BROWSER=1',
      readiness,
    };
  }
  try {
    return {
      ...runRecruiterDetailPlaywright(input),
      readiness,
      attempts: 1,
    };
  } catch (error) {
    const firstError = error instanceof Error ? error.message : String(error);
    const retryReadiness = await waitForRecruiterDetailProjection({
      ...input,
      timeoutMs: 45_000,
    });
    try {
      return {
        ...runRecruiterDetailPlaywright(input),
        readiness: retryReadiness,
        attempts: 2,
        firstError,
      };
    } catch (retryError) {
      const message = retryError instanceof Error ? retryError.message : String(retryError);
      throw new Error(`${message}; first recruiter smoke failure: ${firstError}`);
    }
  }
}

export function recruiterProjectionVerificationMode({
  skipBrowser,
  skipRecruiterBrowser,
}) {
  if (skipBrowser) return 'skip_all';
  if (skipRecruiterBrowser) return 'api_only';
  return 'browser';
}

async function initReviewSession(sessionToken, challenge) {
  const challengeId = challenge.reviewSession?.challengeId ?? challenge.id;
  assert(challenge.reviewSession?.requiresInit === true, 'CODE_REVIEW challenge does not require review session init.');
  assert(typeof challengeId === 'string' && challengeId.length > 0, 'CODE_REVIEW challenge missing backing challenge id.');

  const body = await requestJson('/rpc/review/session/init', {
    method: 'POST',
    headers: candidateHeaders(sessionToken),
    body: JSON.stringify({ challengeId }),
  }, { basicAuth: false });

  assert(typeof body?.sessionId === 'string' && body.sessionId.length > 0, `review/session/init missing sessionId: ${JSON.stringify(body)}`);
  assert(body.status === 'pending' || body.status === 'in_progress', `Unexpected review session status: ${JSON.stringify(body)}`);
  return body;
}

async function sendFirstReviewRound(sessionToken, sessionId, challenge) {
  const target = pickAnnotationTarget(challenge);
  const annotation = {
    id: 'smoke-annotation-1',
    file: target.file,
    line: target.line,
    severity: 'major',
    comment: [
      'This source-backed line is relevant to the candidate profile, but the PR needs regression coverage',
      'and an explicit defense of the interaction timing trade-off before merge.',
    ].join(' '),
  };

  const body = await requestJson(`/rpc/review/session/${sessionId}/message`, {
    method: 'POST',
    headers: candidateHeaders(sessionToken),
    body: JSON.stringify({
      summary: REVIEW_SUMMARY,
      message: REVIEW_SUMMARY,
      annotations: [annotation],
      newAnnotations: [annotation],
    }),
  }, { basicAuth: false });

  assert(Number.isInteger(body?.round) && body.round >= 1, `review/session/message missing round: ${JSON.stringify(body)}`);
  assert(Array.isArray(body?.agentResponse) && body.agentResponse.length > 0, `Implementation author response missing: ${JSON.stringify(body)}`);
  assert(Array.isArray(body?.threads) && body.threads.length > 0, `Implementation author thread missing: ${JSON.stringify(body)}`);

  return {
    target,
    annotation,
    round: body.round,
    agentResponseCount: body.agentResponse.length,
    threadCount: body.threads.length,
    firstAgentMove: body.agentResponse[0]?.move ?? null,
  };
}

async function completeReviewSession(sessionToken, sessionId) {
  const body = await requestJson(`/rpc/review/session/${sessionId}/complete`, {
    method: 'POST',
    headers: candidateHeaders(sessionToken),
    body: JSON.stringify({
      verdict: 'request_changes',
      summary: REVIEW_SUMMARY,
    }),
  }, { basicAuth: false });

  assert(body?.status === 'verdict_submitted', `review/session/complete did not submit verdict: ${JSON.stringify(body)}`);
  assert(body?.sessionId === sessionId, `review/session/complete returned wrong sessionId: ${JSON.stringify(body)}`);
  return body;
}

async function submitReviewSessionReference(sessionToken, sessionId) {
  const body = await requestJson('/rpc/submit-challenge-response', {
    method: 'POST',
    headers: candidateHeaders(sessionToken),
    body: JSON.stringify({
      order: ROLE_BACKED ? 1 : 0,
      submission: JSON.stringify({ reviewSessionId: sessionId }),
    }),
  }, { basicAuth: false });

  assert(body?.success === true, `submit-challenge-response did not accept reviewSessionId: ${JSON.stringify(body)}`);
  return body;
}

function assertSubmissionJson(submissionJson, sessionId, annotation) {
  const submission = parseMaybeJson(submissionJson);
  assert(submission, `Missing or invalid submissionJson: ${String(submissionJson).slice(0, 300)}`);
  assert(submission.reviewSessionId === sessionId, `submissionJson missing reviewSessionId ${sessionId}: ${JSON.stringify(submission)}`);
  assert(submission.verdict === 'request_changes', `submissionJson verdict was not request_changes: ${JSON.stringify(submission)}`);
  assert(submission.summary === REVIEW_SUMMARY, `submissionJson summary mismatch: ${JSON.stringify(submission)}`);
  assert(Array.isArray(submission.annotations), `submissionJson missing annotations: ${JSON.stringify(submission)}`);
  assert(
    submission.annotations.some((candidate) =>
      candidate?.file === annotation.file
      && candidate?.line === annotation.line
      && candidate?.severity === annotation.severity
      && typeof candidate?.comment === 'string'
    ),
    `submissionJson missing smoke annotation: ${JSON.stringify(submission.annotations)}`,
  );
  const rounds = Array.isArray(submission.transcript?.rounds) ? submission.transcript.rounds : [];
  assert(rounds.length > 0, `submissionJson missing review transcript rounds: ${JSON.stringify(submission)}`);
  assert(
    rounds.some((round) =>
      Array.isArray(round?.reviewer_comments)
      && round.reviewer_comments.some((comment) =>
        typeof comment?.what === 'string'
        && comment.what.length > 0
      )
    ),
    `submissionJson missing reviewer comments in transcript: ${JSON.stringify(rounds)}`,
  );
  assert(
    rounds.some((round) =>
      Array.isArray(round?.implementer_responses)
      && round.implementer_responses.some((response) =>
        typeof response?.content === 'string'
        && response.content.length > 0
      )
    ),
    `submissionJson missing implementation-author pushback in transcript: ${JSON.stringify(rounds)}`,
  );
  return submission;
}

async function verifyRecruiterResults({ interviewId, candidateId, challenge, reviewSessionId, annotation }) {
  const detail = await requestJson(`/api/v1/scheduling/interviews/${interviewId}`);
  const interview = detail?.interview;
  assert(interview?.id === interviewId, `Interview detail returned wrong id: ${JSON.stringify(detail)}`);
  assert(interview.status === 'COMPLETED', `Interview was not completed: ${JSON.stringify(interview)}`);
  assert(interview.githubRepoUrl === challenge.githubRepoUrl, `Interview detail repo mismatch: ${JSON.stringify(interview)}`);
  assert(interview.githubPrNumber === challenge.githubPrNumber, `Interview detail PR mismatch: ${JSON.stringify(interview)}`);
  assertSubmissionJson(interview.submissionJson, reviewSessionId, annotation);

  const codeReviewMatch = interview.codeReviewMatch ?? null;
  if (!REPO_URL || !PR_NUMBER) {
    assert(codeReviewMatch?.status === 'MATCHED', `Auto-match detail missing MATCHED codeReviewMatch: ${JSON.stringify(codeReviewMatch)}`);
    assert(codeReviewMatch?.validatorAgent, `Auto-match detail missing validatorAgent match proof: ${JSON.stringify(codeReviewMatch)}`);
    assert(
      Array.isArray(codeReviewMatch.evidenceHyperedges) && codeReviewMatch.evidenceHyperedges.length > 0,
      `Auto-match detail missing evidence hyperedges: ${JSON.stringify(codeReviewMatch)}`,
    );
    if (ROLE_BACKED) {
      assert(
        Number(codeReviewMatch.validatorAgent?.sourceBridge?.roleSourceCount ?? 0) > 0,
        `Role-backed detail missing role source bridge: ${JSON.stringify(codeReviewMatch)}`,
      );
      assert(
        codeReviewMatch.evidenceHyperedges.some((edge) => edge?.relation === 'candidate_role_repo_alignment'),
        `Role-backed detail missing person-role-repo hyperedge: ${JSON.stringify(codeReviewMatch.evidenceHyperedges)}`,
      );
    }
  } else if (codeReviewMatch) {
    assert(codeReviewMatch.status === 'MATCHED', `Manual detail codeReviewMatch is not MATCHED: ${JSON.stringify(codeReviewMatch)}`);
    assert(
      codeReviewMatch.validatorAgent?.verdict === 'PASSED',
      `Manual detail missing PASSED validator proof: ${JSON.stringify(codeReviewMatch)}`,
    );
    assert(
      codeReviewMatch.assessmentQuality?.verdict === 'USABLE',
      `Manual detail missing USABLE assessment quality: ${JSON.stringify(codeReviewMatch)}`,
    );
  } else {
    throw new Error('Manual detail missing source-backed codeReviewMatch proof.');
  }

  const profile = await requestJson(`/api/v1/candidates/${candidateId}`);
  const scheduledInterviews = Array.isArray(profile?.scheduledInterviews)
    ? profile.scheduledInterviews
    : [];
  const profileInterview = scheduledInterviews.find((candidateInterview) =>
    candidateInterview?.interviewType === 'CODE_REVIEW'
    && candidateInterview?.id === interviewId
  ) ?? scheduledInterviews.find((candidateInterview) =>
    candidateInterview?.interviewType === 'CODE_REVIEW'
  );
  assert(profileInterview?.status === 'COMPLETED', `Candidate profile missing completed CODE_REVIEW interview: ${JSON.stringify(profileInterview)}`);

  if (ROLE_BACKED) {
    return {
      interviewStatus: interview.status,
      profileInterviewStatus: profileInterview.status,
      profileSubmitted: true,
      profileAnnotationCount: null,
      codeReviewMatchStatus: codeReviewMatch?.status ?? null,
      evidenceHyperedgeCount: Array.isArray(codeReviewMatch?.evidenceHyperedges)
        ? codeReviewMatch.evidenceHyperedges.length
        : 0,
      validatorVerdict: codeReviewMatch?.validatorAgent?.verdict ?? null,
      roleSourceCount: codeReviewMatch?.validatorAgent?.sourceBridge?.roleSourceCount ?? null,
      personRoleRepoHyperedge: codeReviewMatch?.evidenceHyperedges?.some((edge) =>
        edge?.relation === 'candidate_role_repo_alignment'
      ) ?? false,
    };
  }

  const match = profile?.standaloneReviewMatch ?? null;
  assert(match?.submitted === true, `Candidate profile missing submitted standalone review match: ${JSON.stringify(match)}`);
  assert(match.matchStatus === 'MATCHED', `Candidate profile match is not MATCHED: ${JSON.stringify(match)}`);
  assert(match.repoUrl === challenge.githubRepoUrl, `Candidate profile repo mismatch: ${JSON.stringify(match)}`);
  assert(match.prNumber === challenge.githubPrNumber, `Candidate profile PR mismatch: ${JSON.stringify(match)}`);
  assert(match.submission?.verdict === 'request_changes', `Candidate profile verdict mismatch: ${JSON.stringify(match.submission)}`);
  assert(match.submission?.summary === REVIEW_SUMMARY, `Candidate profile summary mismatch: ${JSON.stringify(match.submission)}`);
  assert(match.submission?.annotationCount >= 1, `Candidate profile annotation count missing: ${JSON.stringify(match.submission)}`);

  return {
    interviewStatus: interview.status,
    profileInterviewStatus: profileInterview.status,
    profileSubmitted: match.submitted,
    profileAnnotationCount: match.submission?.annotationCount ?? null,
    codeReviewMatchStatus: codeReviewMatch?.status ?? null,
    evidenceHyperedgeCount: Array.isArray(codeReviewMatch?.evidenceHyperedges)
      ? codeReviewMatch.evidenceHyperedges.length
      : 0,
    validatorVerdict: codeReviewMatch?.validatorAgent?.verdict ?? null,
  };
}

async function verifyJudgeExample(reviewSessionId) {
  const body = await requestJson('/api/v1/review-sessions/judge-examples?limit=100');
  const examples = Array.isArray(body?.examples) ? body.examples : [];
  const example = examples.find((candidate) => candidate?.sessionId === reviewSessionId);

  assert(example, `Judge example queue missing review session ${reviewSessionId}: ${JSON.stringify(body).slice(0, 1200)}`);
  assert(
    example.status === 'READY' || example.status === 'LABELLED',
    `Judge example ${example.id ?? reviewSessionId} has unexpected status: ${JSON.stringify(example)}`,
  );
  assert(
    example.promptInput?.task === 'score_and_improve_code_review_judge',
    `Judge example missing replay task: ${JSON.stringify(example.promptInput)}`,
  );
  assert(
    Array.isArray(example.promptInput?.candidateReview?.comments)
      && example.promptInput.candidateReview.comments.length > 0,
    `Judge example missing candidate review comments: ${JSON.stringify(example.promptInput)}`,
  );
  assert(
    Array.isArray(example.promptInput?.aiDeveloperPushback)
      && example.promptInput.aiDeveloperPushback.length > 0,
    `Judge example missing implementation-author pushback: ${JSON.stringify(example.promptInput)}`,
  );
  assert(
    Array.isArray(example.promptInput?.improvementUses)
      && example.promptInput.improvementUses.includes('human_label_queue')
      && example.promptInput.improvementUses.includes('cross_model_calibration'),
    `Judge example missing improvement-loop uses: ${JSON.stringify(example.promptInput?.improvementUses)}`,
  );

  return {
    id: example.id ?? null,
    status: example.status,
    commentCount: example.promptInput.candidateReview.comments.length,
    pushbackCount: example.promptInput.aiDeveloperPushback.length,
    improvementUses: example.promptInput.improvementUses,
  };
}

function isLocalBase(url) {
  return url.includes('localhost') || url.includes('127.0.0.1') || url.includes('[::1]');
}

export function resolveCodeReviewSmokeD1Target({
  apiBase = API_BASE,
  rpcBase = RPC_BASE,
  env = process.env,
} = {}) {
  const remote = !isLocalBase(apiBase) && !isLocalBase(rpcBase);
  return {
    remote,
    databaseName: env.CODE_REVIEW_SMOKE_D1_DATABASE || (remote ? 'pipe-db-test' : 'pipe-db'),
    label: remote ? 'remote' : 'local',
  };
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function smokeD1DatabaseName(remote) {
  return process.env.CODE_REVIEW_SMOKE_D1_DATABASE || (remote ? 'pipe-db-test' : 'pipe-db');
}

function d1Query(command, { remote }) {
  const databaseName = smokeD1DatabaseName(remote);
  const args = [
    'wrangler',
    'd1',
    'execute',
    databaseName,
    remote ? '--remote' : '--local',
    '--json',
    '--command',
    command,
  ];
  const result = spawnSync(
    'npx',
    args,
    {
      cwd: `${process.cwd()}/workers/api`,
      encoding: 'utf8',
      env: process.env,
    },
  );
  if (result.status !== 0) {
    const target = remote ? 'remote' : 'local';
    throw new Error(`${target} D1 query failed (${result.status}) for ${databaseName}: ${result.stderr || result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed?.[0]?.results) ? parsed[0].results : [];
}

function scoreD1Query(command) {
  const target = resolveCodeReviewSmokeD1Target();
  return d1Query(command, { remote: target.remote });
}

async function verifyAssessmentEvidence(reviewSessionId) {
  const target = resolveCodeReviewSmokeD1Target();
  const sessionKey = `assessment-session:code-review:${reviewSessionId}`;
  const command = `
    WITH target_session AS (
      SELECT id, state
        FROM assessment_sessions
       WHERE ingestion_key = ${sqlString(sessionKey)}
       LIMIT 1
    )
    SELECT
      (SELECT id FROM target_session) AS session_id,
      (SELECT state FROM target_session) AS state,
      (SELECT COUNT(*)
         FROM assessment_evidence_events e
        WHERE e.session_id = (SELECT id FROM target_session)) AS event_count,
      (SELECT COUNT(*)
         FROM assessment_event_source_refs r
         JOIN assessment_evidence_events e ON e.id = r.event_id
        WHERE e.session_id = (SELECT id FROM target_session)) AS event_source_ref_count,
      (SELECT COUNT(*)
         FROM assessment_evaluation_reports r
        WHERE r.session_id = (SELECT id FROM target_session)) AS report_count,
      (SELECT COUNT(*)
         FROM assessment_evaluation_claims c
         JOIN assessment_evaluation_reports r ON r.id = c.report_id
        WHERE r.session_id = (SELECT id FROM target_session)) AS claim_count,
      (SELECT COUNT(*)
         FROM assessment_claim_source_refs sr
         JOIN assessment_evaluation_claims c ON c.id = sr.claim_id
         JOIN assessment_evaluation_reports r ON r.id = c.report_id
        WHERE r.session_id = (SELECT id FROM target_session)) AS claim_source_ref_count,
      (SELECT GROUP_CONCAT(kind, ',')
         FROM assessment_evidence_events e
        WHERE e.session_id = (SELECT id FROM target_session)
        ORDER BY e.sequence) AS event_kinds
  `;

  const deadline = Date.now() + 60_000;
  let latest = null;
  while (Date.now() < deadline) {
    latest = d1Query(command, { remote: target.remote })[0] ?? null;
    if (
      latest?.state === 'EVALUATED'
      && Number(latest.event_count) >= 2
      && Number(latest.event_source_ref_count) >= 2
      && Number(latest.report_count) >= 1
      && Number(latest.claim_count) >= 1
      && Number(latest.claim_source_ref_count) >= 1
    ) {
      return {
        skipped: false,
        sessionId: latest.session_id,
        state: latest.state,
        eventCount: Number(latest.event_count),
        eventSourceRefCount: Number(latest.event_source_ref_count),
        reportCount: Number(latest.report_count),
        claimCount: Number(latest.claim_count),
        claimSourceRefCount: Number(latest.claim_source_ref_count),
        eventKinds: typeof latest.event_kinds === 'string' ? latest.event_kinds.split(',') : [],
        d1Target: target.label,
      };
    }
    await sleep(2_000);
  }

  throw new Error(
    `Assessment evidence did not become durable in ${target.label} D1 for review session ${reviewSessionId}: ${JSON.stringify(latest)}`,
  );
}

async function verifyScorePersistence(reviewSessionId) {
  const command = `
    WITH target_session AS (
      SELECT id, assessment_id, challenge_id, status, score_report
        FROM review_sessions
       WHERE id = ${sqlString(reviewSessionId)}
       LIMIT 1
    ),
    target_submission AS (
      SELECT id, score, score_report_json, scored_at
        FROM challenge_submissions
       WHERE assessment_id = (SELECT assessment_id FROM target_session)
         AND challenge_id = (SELECT challenge_id FROM target_session)
       LIMIT 1
    )
    SELECT
      (SELECT id FROM target_session) AS review_session_id,
      (SELECT status FROM target_session) AS review_status,
      (SELECT score_report IS NOT NULL AND length(score_report) > 0 FROM target_session) AS review_score_report_present,
      json_extract((SELECT score_report FROM target_session), '$.overall.score') AS review_score,
      json_extract((SELECT score_report FROM target_session), '$.overall.band') AS review_band,
      (SELECT id FROM target_submission) AS challenge_submission_id,
      (SELECT score FROM target_submission) AS challenge_submission_score,
      (SELECT score_report_json IS NOT NULL AND length(score_report_json) > 0 FROM target_submission) AS challenge_submission_score_report_present,
      (SELECT scored_at FROM target_submission) AS challenge_submission_scored_at,
      (SELECT score FROM assessments WHERE id = (SELECT assessment_id FROM target_session)) AS assessment_score
  `;

  const deadline = Date.now() + 90_000;
  let latest = null;
  while (Date.now() < deadline) {
    latest = scoreD1Query(command)[0] ?? null;
    const reviewScore = Number(latest?.review_score);
    const challengeSubmissionScore = Number(latest?.challenge_submission_score);
    const assessmentScore = Number(latest?.assessment_score);
    if (
      latest?.review_session_id === reviewSessionId
      && latest.review_status === 'scored'
      && Number(latest.review_score_report_present) === 1
      && Number.isFinite(reviewScore)
      && latest.challenge_submission_id
      && Number.isFinite(challengeSubmissionScore)
      && Number(latest.challenge_submission_score_report_present) === 1
      && Number.isFinite(assessmentScore)
    ) {
      return {
        skipped: false,
        reviewStatus: latest.review_status,
        reviewScore,
        reviewBand: latest.review_band ?? null,
        challengeSubmissionId: latest.challenge_submission_id,
        challengeSubmissionScore,
        challengeSubmissionScoredAt: latest.challenge_submission_scored_at ?? null,
        assessmentScore,
        d1Target: isLocalBase(API_BASE) || isLocalBase(RPC_BASE) ? 'local' : 'remote',
      };
    }
    await sleep(2_000);
  }

  throw new Error(`Score persistence did not become durable for review session ${reviewSessionId}: ${JSON.stringify(latest)}`);
}

async function verifyReviewStatusPipeline(sessionToken, reviewSessionId) {
  const deadline = Date.now() + 60_000;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await requestJson(`/rpc/review/${reviewSessionId}/status`, {
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
    }, { basicAuth: false });
    const pipeline = Array.isArray(latest?.pipeline) ? latest.pipeline : [];
    const reviewStep = pipeline.find((step) => step?.id === 'review');
    const scoringStep = pipeline.find((step) => step?.id === 'scoring');
    if (
      latest?.status === 'scored'
      && latest?.phase === 'scoring'
      && reviewStep?.status === 'complete'
      && scoringStep?.status === 'complete'
      && Number.isFinite(Number(latest?.scoreReport?.overall))
      && typeof latest?.scoreReport?.band === 'string'
    ) {
      return {
        status: latest.status,
        phase: latest.phase,
        currentRound: latest.currentRound ?? null,
        maxRounds: latest.maxRounds ?? null,
        scoreOverall: latest.scoreReport.overall,
        scoreBand: latest.scoreReport.band,
        pipeline: pipeline.map((step) => ({
          id: step.id ?? null,
          status: step.status ?? null,
          detail: step.detail ?? null,
        })),
      };
    }
    await sleep(2_000);
  }

  throw new Error(`Review status pipeline did not expose durable scoring for ${reviewSessionId}: ${JSON.stringify(latest)}`);
}

async function runFullSubmissionSmoke({ session, challenge, interviewId }) {
  if (!SUBMIT_REVIEW) return { skipped: true };

  const init = await initReviewSession(session.sessionToken, challenge);
  const firstRound = await sendFirstReviewRound(session.sessionToken, init.sessionId, challenge);
  await completeReviewSession(session.sessionToken, init.sessionId);
  await submitReviewSessionReference(session.sessionToken, init.sessionId);
  const recruiterResults = await verifyRecruiterResults({
    interviewId,
    candidateId: session.id,
    challenge,
    reviewSessionId: init.sessionId,
    annotation: firstRound.annotation,
  });
  const judgeExample = await verifyJudgeExample(init.sessionId);
  const assessmentEvidence = await verifyAssessmentEvidence(init.sessionId);
  const scorePersistence = await verifyScorePersistence(init.sessionId);
  const reviewStatusPipeline = await verifyReviewStatusPipeline(session.sessionToken, init.sessionId);

  return {
    skipped: false,
    reviewSessionId: init.sessionId,
    annotationTarget: firstRound.target,
    round: firstRound.round,
    agentResponseCount: firstRound.agentResponseCount,
    threadCount: firstRound.threadCount,
    firstAgentMove: firstRound.firstAgentMove,
    judgeExample,
    recruiterResults,
    assessmentEvidence,
    scorePersistence,
    reviewStatusPipeline,
  };
}

async function main() {
  assertEnv();

  const invite = await createCodeReviewInvite();
  try {
    const session = await resolveInvite(invite.inviteToken);
    assert(session?.sessionToken, `resolve-token response missing session token: ${JSON.stringify(session)}`);
    const preIntakeCandidateLink = VERIFY_RECRUITER_CANDIDATE_LINK
      ? await verifyFreshRecruiterCandidateAssessmentLink({
          interviewId: invite.interviewId,
          deliveredUrl: invite.deliveredUrl,
          session,
        })
      : null;

    if (NO_CV_BOUNDARY) {
      const initialStageConfig = await getStageConfig(session.sessionToken);
      const challenge = await getChallenge(session.sessionToken, 0);
      assertProfileReceivedHandoff({ stageConfig: initialStageConfig, challenge });

      const browserSmoke = runBrowserSmoke({
        deliveredUrl: invite.deliveredUrl,
        inviteToken: invite.inviteToken,
        session,
        expectedMatchProofVerdict: '',
        expectProfileReceived: true,
      });
      const recruiterBrowserSmoke = await runRecruiterDetailBrowserSmoke({
        interviewId: invite.interviewId,
        expectedOutcome: 'blocked',
      });

      console.log(JSON.stringify({
        ok: true,
        interviewId: invite.interviewId,
        roleContextId: invite.roleContextId ?? null,
        pipelineId: invite.pipelineId ?? session.pipelineId ?? null,
        stageId: invite.stageId ?? null,
        emailSent: SEND_EMAIL,
        matchMode: currentMatchMode(),
        expectedOutcome: 'no_cv_profile_received',
        deliveredUrl: cleanUrl(invite.deliveredUrl),
        roomGuestUrl: cleanUrl(invite.invited?.room?.guestUrl),
        candidateHandoff: {
          type: challenge.type,
          id: challenge.id,
          title: challenge.title ?? null,
          instructions: challenge.instructions ?? null,
          stageId: initialStageConfig.stageId,
          stageTitle: initialStageConfig.stageTitle ?? null,
          isComplete: initialStageConfig.isComplete,
          challengeCount: initialStageConfig.challenges.length,
        },
        browserSmoke,
        recruiterBrowserSmoke,
        candidateLinkProof: preIntakeCandidateLink,
        stageConfig: {
          initialStageId: initialStageConfig.stageId,
          initialStageTitle: initialStageConfig.stageTitle ?? null,
          initialIsComplete: initialStageConfig.isComplete ?? null,
          initialCurrentIndex: initialStageConfig.currentIndex ?? null,
          initialChallengeTypes: [],
        },
      }, null, 2));
      return;
    }

    await submitIntake(session.sessionToken);
    const initialStageConfig = EXPECT_BLOCKED_MATCH
      ? await getStageConfig(session.sessionToken)
      : await waitForBootstrapStageConfig(session.sessionToken);
    const challengeOrder = ROLE_BACKED ? 1 : 0;
    const challenge = await pollCodeReviewChallenge(session.sessionToken, challengeOrder, {
      expectBlocked: EXPECT_BLOCKED_MATCH,
    });
    if (EXPECT_BLOCKED_MATCH) {
      assertProfileReceivedHandoff({ stageConfig: initialStageConfig, challenge });

      const browserSmoke = runBrowserSmoke({
        deliveredUrl: invite.deliveredUrl,
        inviteToken: invite.inviteToken,
        session,
        expectedMatchProofVerdict: '',
        expectProfileReceived: true,
      });
      const recruiterBrowserSmoke = await runRecruiterDetailBrowserSmoke({
        interviewId: invite.interviewId,
        expectedOutcome: 'blocked',
      });

      console.log(JSON.stringify({
        ok: true,
        interviewId: invite.interviewId,
        roleContextId: invite.roleContextId ?? null,
        pipelineId: invite.pipelineId ?? session.pipelineId ?? null,
        stageId: invite.stageId ?? null,
        emailSent: SEND_EMAIL,
        matchMode: currentMatchMode(),
        expectedOutcome: 'blocked',
        deliveredUrl: cleanUrl(invite.deliveredUrl),
        roomGuestUrl: cleanUrl(invite.invited?.room?.guestUrl),
        candidateHandoff: {
          type: challenge.type,
          id: challenge.id,
          title: challenge.title ?? null,
          instructions: challenge.instructions ?? null,
          stageId: initialStageConfig.stageId,
          isComplete: initialStageConfig.isComplete,
        },
        browserSmoke,
        recruiterBrowserSmoke,
        candidateLinkProof: preIntakeCandidateLink,
        stageConfig: {
          initialStageId: initialStageConfig.stageId,
          initialIsComplete: initialStageConfig.isComplete ?? null,
          initialCurrentIndex: initialStageConfig.currentIndex ?? null,
          initialChallengeTypes: Array.isArray(initialStageConfig.challenges)
            ? initialStageConfig.challenges.map((candidateChallenge) => candidateChallenge?.type ?? null)
            : [],
        },
      }, null, 2));
      return;
    }
    const readyStageConfig = await waitForBootstrapStageConfig(session.sessionToken);
    const preview = challengePreview(challenge);
    assert(challenge.githubRepoUrl, `CODE_REVIEW challenge missing githubRepoUrl: ${JSON.stringify(preview)}`);
    assert(challenge.githubPrNumber, `CODE_REVIEW challenge missing githubPrNumber: ${JSON.stringify(preview)}`);
    assert(challenge.cachedDiffJson, `CODE_REVIEW challenge missing cachedDiffJson: ${JSON.stringify(preview)}`);
    assert(challenge.matchExplanation, `CODE_REVIEW challenge missing matchExplanation: ${JSON.stringify(preview)}`);
    assert(
      challenge.matchExplanation.validatorAgent,
      `CODE_REVIEW challenge missing validatorAgent match proof: ${JSON.stringify(preview)}`,
    );
    if (REQUIRE_CONTRAST === '1') {
      assert(
        challenge.matchExplanation.qualityGate?.verdict === 'PASSED',
        `Auto-match quality gate did not pass: ${JSON.stringify(preview)}`,
      );
    }
    if (REQUIRE_CONTRAST === '1') {
      const contrastMetric = assessmentQualityMetric(challenge, 'contrast_separation');
      assert(
        contrastMetric,
        `Auto-match challenge missing contrast_separation metric: ${JSON.stringify(preview)}`,
      );
      assert(
        typeof contrastMetric.reason === 'string'
          && !contrastMetric.reason.includes('No second eligible challenge'),
        `Auto-match did not compare against a second eligible challenge: ${JSON.stringify(preview)}`,
      );
      assert(
        Number(contrastMetric.score) >= 1,
        `Auto-match contrast separation is too weak: ${JSON.stringify(preview)}`,
      );
    }
    if (ROLE_BACKED) {
      const roleSourceCount = Number(
        challenge.matchExplanation?.roleSourceCount
          ?? challenge.matchExplanation?.validatorAgent?.sourceBridge?.roleSourceCount
          ?? 0,
      );
      assert(roleSourceCount > 0, `Role-backed challenge missing role source proof: ${JSON.stringify(preview)}`);
      assert(
        Array.isArray(challenge.matchExplanation?.evidenceHyperedges)
          && challenge.matchExplanation.evidenceHyperedges.some((edge) => edge?.relation === 'candidate_role_repo_alignment'),
        `Role-backed challenge missing candidate_role_repo_alignment hyperedge: ${JSON.stringify(preview)}`,
      );
    }

    const browserSmoke = runBrowserSmoke({
      deliveredUrl: invite.deliveredUrl,
      inviteToken: invite.inviteToken,
      session,
      expectedMatchProofVerdict: challenge.matchExplanation?.qualityGate?.verdict ?? 'PASSED',
    });
    const submissionSmoke = await runFullSubmissionSmoke({
      session,
      challenge,
      interviewId: invite.interviewId,
    });
    const relatedBoundaryInterview = await createRelatedPersonBoundaryInterview(invite);
    const relatedBoundaryProfile = await verifyPersonRelatedBoundaryProfile({
      candidateId: session.id,
      selectedInterviewId: invite.interviewId,
      selectedRepoUrl: challenge.githubRepoUrl,
      selectedPrNumber: challenge.githubPrNumber,
      relatedBoundaryInterview,
    });
    const recruiterBrowserSmoke = await runRecruiterDetailBrowserSmoke({
      interviewId: invite.interviewId,
      expectedOutcome: 'matched',
      expectedRepoUrl: challenge.githubRepoUrl,
      expectedPrNumber: challenge.githubPrNumber,
      expectSubmission: SUBMIT_REVIEW,
      expectScore: SUBMIT_REVIEW,
      requireHyperedges: !REPO_URL && !PR_NUMBER,
      expectPersonProfileDecision: SUBMIT_REVIEW,
      expectPersonProfilePending: !SUBMIT_REVIEW,
      expectPersonProfileRelatedBoundary: Boolean(relatedBoundaryInterview),
    });

    console.log(JSON.stringify({
      ok: true,
      interviewId: invite.interviewId,
      roleContextId: invite.roleContextId ?? null,
      pipelineId: invite.pipelineId ?? session.pipelineId ?? null,
      stageId: invite.stageId ?? null,
      emailSent: SEND_EMAIL,
      matchMode: currentMatchMode(),
      deliveredUrl: cleanUrl(invite.deliveredUrl),
      roomGuestUrl: cleanUrl(invite.invited?.room?.guestUrl),
      candidateLinkProof: preIntakeCandidateLink,
      repoUrl: challenge.githubRepoUrl,
      prNumber: challenge.githubPrNumber,
      matchSummary: challenge.matchExplanation?.summary ?? null,
      matchStatus: challenge.matchExplanation?.status ?? null,
      qualityGate: challenge.matchExplanation?.qualityGate?.verdict ?? null,
      assessmentQuality: challenge.matchExplanation?.assessmentQuality?.verdict ?? null,
      contrastSeparation: assessmentQualityMetric(challenge, 'contrast_separation'),
      stageConfig: {
        initialStageId: initialStageConfig.stageId,
        initialCurrentIndex: initialStageConfig.currentIndex ?? null,
        initialChallengeTypes: Array.isArray(initialStageConfig.challenges)
          ? initialStageConfig.challenges.map((candidateChallenge) => candidateChallenge?.type ?? null)
          : [],
        readyStageId: readyStageConfig.stageId,
        readyCurrentIndex: readyStageConfig.currentIndex ?? null,
        readyChallengeTypes: Array.isArray(readyStageConfig.challenges)
          ? readyStageConfig.challenges.map((candidateChallenge) => candidateChallenge?.type ?? null)
          : [],
      },
      browserSmoke,
      recruiterBrowserSmoke,
      submissionSmoke,
      relatedBoundaryInterview,
      relatedBoundaryProfile,
    }, null, 2));
  } catch (error) {
    const context = {
      ok: false,
      interviewId: invite.interviewId,
      roleContextId: invite.roleContextId ?? null,
      pipelineId: invite.pipelineId ?? null,
      stageId: invite.stageId ?? null,
      emailSent: SEND_EMAIL,
      matchMode: currentMatchMode(),
      deliveredUrl: cleanUrl(invite.deliveredUrl),
      roomGuestUrl: cleanUrl(invite.invited?.room?.guestUrl),
    };
    const suffix = `\nSmoke context: ${JSON.stringify(context, null, 2)}`;
    if (error instanceof Error) {
      error.message += suffix;
      throw error;
    }
    throw new Error(`${String(error)}${suffix}`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
