import type {
  RoomCommitChangedFile,
  RoomCommitChangedFileStatus,
  RoomCommitSubmissionRequest,
  RoomWorkspaceChallengePacket,
} from '../types';

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

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstLocatorString(locator: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = locator[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function buildCommitSubmissionDefaults(
  input: CommitSubmissionDefaultInput,
): CommitSubmissionDefaults {
  const packet = input.challengePacket ?? null;
  const packetRepositoryUrl = packet
    ? firstLocatorString(packet.locator, ['repositoryUrl', 'githubRepoUrl', 'repoUrl'])
    : null;
  const baseCommitSha = packet
    ? firstLocatorString(packet.locator, [
      'baseCommitSha',
      'baseCommit',
      'base_commit_sha',
      'base_commit',
    ])
    : null;
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
  const baseCommitSha = fields.baseCommitSha.trim();
  const commitSha = fields.commitSha.trim();
  const changedFiles = parseChangedFiles(fields.changedFilesText);
  const commitEvidenceText = fields.commitEvidenceText.trim();
  const diffText = fields.diffText.trim();
  const testEvidenceText = fields.testEvidenceText.trim();
  const narrative = fields.narrative.trim();

  if (!narrative) throw new Error('Submission note is required.');
  if (!repositoryUrl) throw new Error('Repository URL is required.');
  if (!branchName) throw new Error('Branch name is required.');
  if (!baseCommitSha) throw new Error('Base commit SHA is required.');
  if (!commitSha) throw new Error('Commit SHA is required.');
  if (changedFiles.length === 0) throw new Error('At least one changed file is required.');
  if (!commitEvidenceText) throw new Error('Commit evidence text is required.');
  if (!commitEvidenceText.toLowerCase().includes(commitSha.toLowerCase())) {
    throw new Error('Commit evidence text must contain the submitted commit SHA.');
  }
  if (!diffText) throw new Error('Diff text is required.');

  const sourceRepositoryUrl = normalizeOptionalText(fields.forkRepositoryUrl) ?? repositoryUrl;
  return {
    narrative,
    repositoryUrl,
    forkRepositoryUrl: normalizeOptionalText(fields.forkRepositoryUrl),
    branchName,
    baseCommitSha,
    commitSha,
    commitUrl: normalizeOptionalText(fields.commitUrl),
    upstreamPullRequestUrl: normalizeOptionalText(fields.upstreamPullRequestUrl),
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
          commitUrl: normalizeOptionalText(fields.commitUrl),
        },
        exactText: commitEvidenceText,
        contentHash: await sha256ContentHash(commitEvidenceText),
        metadata: {
          source: 'win95_commit_submission_window',
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
          source: 'win95_commit_submission_window',
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
            },
            exactText: testEvidenceText,
            contentHash: await sha256ContentHash(testEvidenceText),
            metadata: {
              source: 'win95_commit_submission_window',
            },
          }]
        : []),
    ],
  };
}
