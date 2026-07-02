export type CandidateCommitChangedFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface CandidateCommitChangedFile {
  path: string;
  status: CandidateCommitChangedFileStatus;
  previousPath?: string | null;
  additions?: number | null;
  deletions?: number | null;
}

export interface CandidateAssessmentSourceRef {
  sourceRefType: string;
  sourceRefId: string;
  sourceSpanId?: string | null;
  evidenceRole?: string;
  locator?: JsonObject;
  exactText: string;
  contentHash: string;
  metadata?: JsonObject;
}

export interface CandidateCommitSubmissionRequest {
  narrative: string;
  repositoryUrl: string;
  forkRepositoryUrl?: string | null;
  branchName: string;
  baseCommitSha: string;
  commitSha: string;
  commitUrl?: string | null;
  upstreamPullRequestUrl?: string | null;
  upstreamPrConsent?: boolean;
  changedFiles: CandidateCommitChangedFile[];
  occurredAt?: string | null;
  sourceRefs: CandidateAssessmentSourceRef[];
}

export interface CandidateAssessmentProgress {
  mode: string;
  state: string;
  stage: string;
  nextAction: string;
  nextActionLabel: string;
  assignmentTrust?: JsonObject | null;
  readiness?: {
    label: string;
    detail: string;
    isReadyForEvaluation: boolean;
    missingRequiredCount: number;
    required: Array<{
      id?: string;
      label: string;
      required?: boolean;
      satisfied: boolean;
      sourceRefTypes?: string[];
      missingImpact?: string;
    }>;
    confidence?: Array<{
      id?: string;
      label: string;
      required?: boolean;
      satisfied: boolean;
      sourceRefTypes?: string[];
      missingImpact?: string;
    }>;
  } | null;
  hasChallengePacket: boolean;
  hasWorkEvidence: boolean;
  hasMessageEvidence?: boolean;
  hasDevContainerEvidence: boolean;
  hasToolUsageEvidence?: boolean;
  hasCommitSubmission: boolean;
  hasFinalSubmission?: boolean;
  hasAiInteraction?: boolean;
  hasTranscriptEvidence?: boolean;
  hasTestEvidence: boolean;
  hasVerificationGap: boolean;
  evidenceCounts?: Array<{ kind: string; count: number }>;
  sourceRefCounts?: Array<{ kind: string; count: number }>;
  evidenceSnippets?: unknown[];
  challengePacketContract?: {
    schemaVersion?: string;
    isComplete: boolean;
    missingFields: string[];
    hasRepositoryUrl?: boolean;
    hasBaseCommitSha?: boolean;
    hasTask?: boolean;
    hasSuccessCriteria?: boolean;
    hasExpectedEvidence?: boolean;
  } | null;
  challenge: {
    sourceRefType: string;
    evidenceRole: string;
    exactText: string;
    contentHash: string;
    locator: JsonObject;
  } | null;
  latestEvent?: JsonObject | null;
  commit: {
    repositoryUrl: string;
    forkRepositoryUrl: string | null;
    branchName: string;
    baseCommitSha: string;
    commitSha: string;
    commitUrl: string | null;
    upstreamPullRequestUrl?: string | null;
    upstreamPrConsent?: boolean;
    submissionSource: string;
    submissionSourceLabel: string;
    integrity: { label: string; detail: string } | null;
    challengeBinding?: { label: string; detail: string } | null;
    changedFiles: CandidateCommitChangedFile[];
    occurredAt: string;
  } | null;
  evaluation?: JsonObject | null;
}

export interface CandidateAssessmentProgressResponse {
  progress: CandidateAssessmentProgress | null;
}

export interface CandidateCommitSubmissionResponse {
  submission: {
    accepted: boolean;
    repositoryUrl: string;
    branchName: string;
    commitSha: string;
    commitUrl: string | null;
    upstreamPullRequestUrl?: string | null;
    upstreamPrConsent?: boolean;
  };
  progress: CandidateAssessmentProgress;
}

export interface CandidateCommitSubmissionFormFields {
  narrative: string;
  repositoryUrl: string;
  forkRepositoryUrl: string;
  branchName: string;
  baseCommitSha: string;
  commitSha: string;
  commitUrl: string;
  upstreamPullRequestUrl: string;
  upstreamPrConsent: boolean;
  changedFilesText: string;
  commitEvidenceText: string;
  diffText: string;
  testEvidenceText: string;
  verificationNotesText: string;
}

export interface CandidateCommitSubmissionDefaults {
  repositoryUrl: string;
  branchName: string;
  baseCommitSha: string;
}

const CHANGED_FILE_STATUSES: ReadonlySet<CandidateCommitChangedFileStatus> = new Set([
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
]);
const DEFAULT_ASSESSMENT_BRANCH = 'pipe-assessment';
const GIT_COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/i;
const API_BASE = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || '';

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeGitCommitSha(value: string, label: string): string {
  const trimmed = value.trim();
  if (!GIT_COMMIT_SHA_PATTERN.test(trimmed)) {
    throw new Error(`${label} must be a full 40-character Git commit SHA.`);
  }
  return trimmed.toLowerCase();
}

function parseHttpsUrl(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be a valid https:// URL.`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use https://.`);
  }
  return parsed;
}

function githubPathParts(parsed: URL, label: string): string[] {
  if (parsed.hostname.toLowerCase() !== 'github.com') {
    throw new Error(`${label} must be a GitHub URL.`);
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`${label} must include a GitHub owner and repository.`);
  }
  return parts;
}

function normalizedGithubRepositoryUrl(value: string, label: string): string {
  const parsed = parseHttpsUrl(value, label);
  const parts = githubPathParts(parsed, label);
  const [owner, repoWithSuffix] = parts;
  const repo = repoWithSuffix?.endsWith('.git') ? repoWithSuffix.slice(0, -4) : repoWithSuffix;
  if (!owner || !repo) {
    throw new Error(`${label} must include a GitHub owner and repository.`);
  }
  return `https://github.com/${owner}/${repo}`;
}

function validateGithubRepositoryUrl(value: string, label: string): string {
  return normalizedGithubRepositoryUrl(value, label);
}

function commitUrlRepositoryUrl(value: string, commitSha: string): { commitUrl: string; repositoryUrl: string } {
  const parsed = parseHttpsUrl(value, 'Commit URL');
  const parts = githubPathParts(parsed, 'Commit URL');
  const commitIndex = parts.findIndex((part) => part === 'commit');
  const urlSha = commitIndex >= 0 ? parts[commitIndex + 1] : null;
  if (!urlSha || urlSha.toLowerCase() !== commitSha.toLowerCase()) {
    throw new Error('Commit URL must point to the submitted commit SHA.');
  }
  const [owner, repoWithSuffix] = parts;
  const repo = repoWithSuffix?.endsWith('.git') ? repoWithSuffix.slice(0, -4) : repoWithSuffix;
  if (!owner || !repo) {
    throw new Error('Commit URL must include a GitHub owner and repository.');
  }
  parsed.search = '';
  parsed.hash = '';
  return {
    commitUrl: parsed.toString(),
    repositoryUrl: `https://github.com/${owner}/${repo}`,
  };
}

function validateGithubCommitUrl(
  value: string,
  commitSha: string,
  allowedRepositoryUrls: readonly string[],
): string {
  const parsed = commitUrlRepositoryUrl(value, commitSha);
  if (!new Set(allowedRepositoryUrls).has(parsed.repositoryUrl)) {
    throw new Error('Commit URL must belong to the assigned repository or declared fork.');
  }
  return parsed.commitUrl;
}

function validateGithubPullRequestUrl(value: string, repositoryUrl: string): string {
  const parsed = parseHttpsUrl(value, 'Upstream PR URL');
  const parts = githubPathParts(parsed, 'Upstream PR URL');
  const pullIndex = parts.findIndex((part) => part === 'pull');
  const prNumber = pullIndex >= 0 ? Number(parts[pullIndex + 1]) : NaN;
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error('Upstream PR URL must point to a GitHub pull request.');
  }
  const [owner, repoWithSuffix] = parts;
  const repo = repoWithSuffix?.endsWith('.git') ? repoWithSuffix.slice(0, -4) : repoWithSuffix;
  if (!owner || !repo) {
    throw new Error('Upstream PR URL must include a GitHub owner and repository.');
  }
  if (`https://github.com/${owner}/${repo}` !== repositoryUrl) {
    throw new Error('Upstream PR URL must belong to the assigned repository.');
  }
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function validateAssessmentBranchName(branchName: string): string {
  if (
    branchName !== DEFAULT_ASSESSMENT_BRANCH
    && !branchName.startsWith(`${DEFAULT_ASSESSMENT_BRANCH}/`)
  ) {
    throw new Error('Branch must be pipe-assessment or a pipe-assessment/* branch.');
  }
  return branchName;
}

function diffMentionsChangedFile(diffText: string, changedFiles: CandidateCommitChangedFile[]): boolean {
  const normalizedDiff = diffText.toLowerCase();
  return changedFiles.some((file) => {
    const paths = [file.path, file.previousPath].filter((path): path is string => Boolean(path));
    return paths.some((path) => normalizedDiff.includes(path.toLowerCase()));
  });
}

function firstLocatorString(locator: JsonObject | null | undefined, keys: string[]): string | null {
  if (!locator) return null;
  for (const key of keys) {
    const value = locator[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function authHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function parseRpcError(response: Response): Promise<Error> {
  const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return new Error(data?.error?.message ?? `Request failed with ${response.status}`);
}

export function buildCandidateCommitSubmissionDefaults(
  progress: CandidateAssessmentProgress | null,
): CandidateCommitSubmissionDefaults {
  const locator = progress?.challenge?.locator ?? null;
  const repositoryUrl = progress?.commit?.repositoryUrl
    ?? firstLocatorString(locator, ['repositoryUrl', 'githubRepoUrl', 'repoUrl'])
    ?? '';
  const baseCommitSha = progress?.commit?.baseCommitSha
    ?? firstLocatorString(locator, ['baseCommitSha', 'baseCommit', 'base_commit_sha', 'base_commit'])
    ?? '';
  const normalizedBaseCommitSha = GIT_COMMIT_SHA_PATTERN.test(baseCommitSha)
    ? baseCommitSha.toLowerCase()
    : '';

  return {
    repositoryUrl,
    branchName: progress?.commit?.branchName ?? (normalizedBaseCommitSha ? DEFAULT_ASSESSMENT_BRANCH : ''),
    baseCommitSha: normalizedBaseCommitSha,
  };
}

export function parseCandidateChangedFiles(value: string): CandidateCommitChangedFile[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [head, ...tail] = line.split(/\s+/);
      const maybeStatus = head?.toLowerCase() as CandidateCommitChangedFileStatus | undefined;
      if (maybeStatus && CHANGED_FILE_STATUSES.has(maybeStatus) && tail.length > 0) {
        return {
          path: tail.join(' '),
          status: maybeStatus,
        };
      }
      return {
        path: line,
        status: 'modified',
      };
    });
}

export async function sha256ContentHash(text: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Browser crypto is required to hash commit evidence.');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

export async function buildCandidateCommitSubmissionPayload(
  fields: CandidateCommitSubmissionFormFields,
): Promise<CandidateCommitSubmissionRequest> {
  const repositoryUrl = fields.repositoryUrl.trim();
  const branchName = fields.branchName.trim();
  const rawBaseCommitSha = fields.baseCommitSha.trim();
  const rawCommitSha = fields.commitSha.trim();
  const changedFiles = parseCandidateChangedFiles(fields.changedFilesText);
  const commitEvidenceText = fields.commitEvidenceText.trim();
  const diffText = fields.diffText.trim();
  const testEvidenceText = fields.testEvidenceText.trim();
  const verificationNotesText = fields.verificationNotesText.trim();
  const narrative = fields.narrative.trim();

  if (!narrative) throw new Error('Submission note is required.');
  if (!repositoryUrl) throw new Error('Repository URL is required.');
  if (!branchName) throw new Error('Branch name is required.');
  const validatedBranchName = validateAssessmentBranchName(branchName);
  if (!rawBaseCommitSha) throw new Error('Base commit SHA is required.');
  if (!rawCommitSha) throw new Error('Commit SHA is required.');
  const baseCommitSha = normalizeGitCommitSha(rawBaseCommitSha, 'Base commit SHA');
  const commitSha = normalizeGitCommitSha(rawCommitSha, 'Commit SHA');
  const validatedRepositoryUrl = validateGithubRepositoryUrl(repositoryUrl, 'Repository URL');
  const forkRepositoryUrl = normalizeOptionalText(fields.forkRepositoryUrl);
  const validatedForkRepositoryUrl = forkRepositoryUrl
    ? validateGithubRepositoryUrl(forkRepositoryUrl, 'Fork URL')
    : null;
  const commitUrl = normalizeOptionalText(fields.commitUrl);
  const validatedCommitUrl = commitUrl
    ? validateGithubCommitUrl(
        commitUrl,
        commitSha,
        [validatedRepositoryUrl, validatedForkRepositoryUrl].filter((url): url is string => Boolean(url)),
      )
    : null;
  if (changedFiles.length === 0) throw new Error('At least one changed file is required.');
  if (!commitEvidenceText) throw new Error('Commit evidence text is required.');
  if (!commitEvidenceText.toLowerCase().includes(commitSha.toLowerCase())) {
    throw new Error('Commit evidence text must contain the submitted commit SHA.');
  }
  if (!diffText) throw new Error('Diff text is required.');
  if (!diffMentionsChangedFile(diffText, changedFiles)) {
    throw new Error('Diff evidence must mention at least one submitted changed file path.');
  }
  if (!testEvidenceText && !verificationNotesText) {
    throw new Error('Paste test output or explain why test evidence is missing.');
  }
  const upstreamPullRequestUrl = normalizeOptionalText(fields.upstreamPullRequestUrl);
  if (upstreamPullRequestUrl && !fields.upstreamPrConsent) {
    throw new Error('Upstream PR URL requires explicit candidate approval.');
  }
  const validatedUpstreamPullRequestUrl = upstreamPullRequestUrl
    ? validateGithubPullRequestUrl(upstreamPullRequestUrl, validatedRepositoryUrl)
    : null;

  const sourceRepositoryUrl = validatedForkRepositoryUrl ?? validatedRepositoryUrl;
  const sourceMetadata: JsonObject = { source: 'assessment_commit_submission_panel' };
  return {
    narrative,
    repositoryUrl: validatedRepositoryUrl,
    forkRepositoryUrl: validatedForkRepositoryUrl,
    branchName: validatedBranchName,
    baseCommitSha,
    commitSha,
    commitUrl: validatedCommitUrl,
    upstreamPullRequestUrl: validatedUpstreamPullRequestUrl,
    upstreamPrConsent: fields.upstreamPrConsent,
    changedFiles,
    occurredAt: new Date().toISOString(),
    sourceRefs: [
      {
        sourceRefType: 'git_commit',
        sourceRefId: commitSha,
        evidenceRole: 'submitted_commit',
        locator: {
          repositoryUrl: sourceRepositoryUrl,
          commitSha,
          commitUrl: validatedCommitUrl,
        },
        exactText: commitEvidenceText,
        contentHash: await sha256ContentHash(commitEvidenceText),
        metadata: sourceMetadata,
      },
      {
        sourceRefType: 'code_diff',
        sourceRefId: `${baseCommitSha}..${commitSha}`,
        evidenceRole: 'submitted_diff',
        locator: {
          repositoryUrl: sourceRepositoryUrl,
          baseCommitSha,
          commitSha,
        },
        exactText: diffText,
        contentHash: await sha256ContentHash(diffText),
        metadata: sourceMetadata,
      },
      ...(testEvidenceText
        ? [{
            sourceRefType: 'test_run',
            sourceRefId: `${commitSha}:test-run`,
            evidenceRole: 'verification_test_output',
            locator: {
              repositoryUrl: sourceRepositoryUrl,
              commitSha,
            },
            exactText: testEvidenceText,
            contentHash: await sha256ContentHash(testEvidenceText),
            metadata: sourceMetadata,
          }]
        : [{
            sourceRefType: 'verification_gap',
            sourceRefId: `${commitSha}:test-evidence-missing`,
            evidenceRole: 'missing_test_evidence_note',
            locator: {
              repositoryUrl: sourceRepositoryUrl,
              commitSha,
              expectedSourceRefType: 'test_run',
            },
            exactText: verificationNotesText,
            contentHash: await sha256ContentHash(verificationNotesText),
            metadata: {
              source: 'assessment_commit_submission_panel',
              missingEvidence: 'test_run',
            },
          }]),
      ...(validatedUpstreamPullRequestUrl && fields.upstreamPrConsent
        ? [{
            sourceRefType: 'upstream_pull_request',
            sourceRefId: validatedUpstreamPullRequestUrl,
            evidenceRole: 'optional_upstream_pr_tracking',
            locator: {
              repositoryUrl: validatedRepositoryUrl,
              forkRepositoryUrl: validatedForkRepositoryUrl,
              commitSha,
              upstreamPullRequestUrl: validatedUpstreamPullRequestUrl,
            },
            exactText: validatedUpstreamPullRequestUrl,
            contentHash: await sha256ContentHash(validatedUpstreamPullRequestUrl),
            metadata: {
              source: 'assessment_commit_submission_panel',
              upstreamPrConsent: true,
            },
          }]
        : []),
    ],
  };
}

export async function getCandidateAssessmentProgress(
  token: string | null,
): Promise<CandidateAssessmentProgressResponse> {
  const response = await fetch(`${API_BASE}/rpc/assessment/progress`, {
    method: 'GET',
    headers: authHeaders(token),
  });
  if (!response.ok) throw await parseRpcError(response);
  return await response.json() as CandidateAssessmentProgressResponse;
}

export async function submitCandidateAssessmentCommit(
  payload: CandidateCommitSubmissionRequest,
  token: string | null,
): Promise<CandidateCommitSubmissionResponse> {
  const response = await fetch(`${API_BASE}/rpc/assessment/commit-submission`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw await parseRpcError(response);
  return await response.json() as CandidateCommitSubmissionResponse;
}
