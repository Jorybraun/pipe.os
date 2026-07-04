import type {
  RoomCommitChangedFile,
  RoomCommitChangedFileStatus,
  RoomCommitSubmissionRequest,
  RoomWorkspaceChallengePacket,
} from '../types';
import { summarizeChallengePacket } from './challengePacketSummary';

export interface CommitSubmissionFormFields {
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

export interface CommitSubmissionDefaultInput {
  repositoryUrl?: string | null;
  challengePacket?: RoomWorkspaceChallengePacket | null;
  assessmentBranchName?: string | null;
}

export interface CommitSubmissionDefaults {
  repositoryUrl: string;
  branchName: string;
  baseCommitSha: string;
}

const CHANGED_FILE_STATUSES: ReadonlySet<RoomCommitChangedFileStatus> = new Set([
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
]);
const DEFAULT_ASSESSMENT_BRANCH = 'pipe-assessment';
const GIT_COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/i;

function firstNonBlankLine(value: string): string | null {
  const line = value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  return line ?? null;
}

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

function githubRepositoryUrlFromPullRequestUrl(value: string): string {
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
  return `https://github.com/${owner}/${repo}`;
}

function validateGithubPullRequestUrl(value: string, repositoryUrl: string): string {
  const parsed = parseHttpsUrl(value, 'Upstream PR URL');
  const parts = githubPathParts(parsed, 'Upstream PR URL');
  const pullIndex = parts.findIndex((part) => part === 'pull');
  const prNumber = pullIndex >= 0 ? Number(parts[pullIndex + 1]) : NaN;
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error('Upstream PR URL must point to a GitHub pull request.');
  }
  if (githubRepositoryUrlFromPullRequestUrl(value) !== repositoryUrl) {
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

function challengePacketLineValue(exactText: string, labels: readonly string[]): string | null {
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const match = exactText.match(new RegExp(`^\\s*(?:${escapedLabels.join('|')})\\s*:\\s*(.+)$`, 'im'));
  return match?.[1]?.trim() || null;
}

function diffMentionsChangedFile(diffText: string, changedFiles: RoomCommitChangedFile[]): boolean {
  const normalizedDiff = diffText.toLowerCase();
  return changedFiles.some((file) => {
    const paths = [file.path, file.previousPath].filter((path): path is string => Boolean(path));
    return paths.some((path) => normalizedDiff.includes(path.toLowerCase()));
  });
}

export function buildCommitSubmissionDefaults(
  input: CommitSubmissionDefaultInput,
): CommitSubmissionDefaults {
  const summary = summarizeChallengePacket(input.challengePacket ?? null);
  const exactText = input.challengePacket?.exactText ?? '';
  const packetRepositoryUrl = summary.repositoryUrl
    ?? challengePacketLineValue(exactText, ['Repo', 'Repository']);
  const baseCommitSha = summary.baseCommitSha
    ?? challengePacketLineValue(exactText, ['Base commit', 'Base commit SHA', 'Base']);
  const normalizedBaseCommitSha = baseCommitSha && GIT_COMMIT_SHA_PATTERN.test(baseCommitSha)
    ? baseCommitSha.toLowerCase()
    : '';

  return {
    repositoryUrl: packetRepositoryUrl ?? input.repositoryUrl?.trim() ?? '',
    branchName: normalizedBaseCommitSha
      ? input.assessmentBranchName?.trim() || DEFAULT_ASSESSMENT_BRANCH
      : '',
    baseCommitSha: normalizedBaseCommitSha,
  };
}

export function parseChangedFiles(value: string): RoomCommitChangedFile[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [head, ...tail] = line.split(/\s+/);
      const maybeStatus = head?.toLowerCase() as RoomCommitChangedFileStatus | undefined;
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

export async function buildCommitSubmissionPayload(
  fields: CommitSubmissionFormFields,
): Promise<RoomCommitSubmissionRequest> {
  const repositoryUrl = fields.repositoryUrl.trim();
  const branchName = fields.branchName.trim();
  const rawBaseCommitSha = fields.baseCommitSha.trim();
  const rawCommitSha = fields.commitSha.trim();
  const changedFiles = parseChangedFiles(fields.changedFilesText);
  const commitEvidenceText = fields.commitEvidenceText.trim();
  const diffText = fields.diffText.trim();
  const testEvidenceText = fields.testEvidenceText.trim();
  const verificationNotesText = fields.verificationNotesText.trim();
  const testEvidenceCommand = firstNonBlankLine(testEvidenceText);
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
        metadata: {
          source: 'assessment_commit_submission_panel',
        },
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
        metadata: {
          source: 'assessment_commit_submission_panel',
        },
      },
      ...(testEvidenceText
        ? [{
            sourceRefType: 'test_run',
            sourceRefId: `${commitSha}:test-run`,
            evidenceRole: 'verification_test_output',
            locator: {
              repositoryUrl: sourceRepositoryUrl,
              commitSha,
              command: testEvidenceCommand,
            },
            exactText: testEvidenceText,
            contentHash: await sha256ContentHash(testEvidenceText),
            metadata: {
              source: 'assessment_commit_submission_panel',
            },
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
