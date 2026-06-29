import { describe, expect, it } from 'vitest';

import {
  buildCommitSubmissionPayload,
  parseChangedFiles,
  sha256ContentHash,
} from './commitSubmission';

describe('commit submission payloads', () => {
  it('parses changed files with explicit statuses and modified-by-default paths', () => {
    expect(parseChangedFiles('added src/new.ts\nsrc/existing.ts\nrenamed src/new-name.ts')).toEqual([
      { path: 'src/new.ts', status: 'added' },
      { path: 'src/existing.ts', status: 'modified' },
      { path: 'src/new-name.ts', status: 'renamed' },
    ]);
  });

  it('builds exact git commit and code diff source refs with content hashes', async () => {
    const baseCommitSha = 'a'.repeat(40);
    const commitSha = 'b'.repeat(40);
    const commitEvidenceText = `commit ${commitSha}\nAuthor: Candidate\n\nFix retry flow`;
    const diffText = 'diff --git a/src/retry.ts b/src/retry.ts\n+export const retry = true;';

    const payload = await buildCommitSubmissionPayload({
      narrative: 'Submitted retry fix with local tests passing.',
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      forkRepositoryUrl: 'https://github.com/candidate/source-backed-worker',
      branchName: 'pipe-assessment/retry-fix',
      baseCommitSha,
      commitSha,
      commitUrl: `https://github.com/candidate/source-backed-worker/commit/${commitSha}`,
      upstreamPullRequestUrl: '',
      upstreamPrConsent: false,
      changedFilesText: 'modified src/retry.ts',
      commitEvidenceText,
      diffText,
    });

    expect(payload).toMatchObject({
      narrative: 'Submitted retry fix with local tests passing.',
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      forkRepositoryUrl: 'https://github.com/candidate/source-backed-worker',
      branchName: 'pipe-assessment/retry-fix',
      baseCommitSha,
      commitSha,
      upstreamPrConsent: false,
      changedFiles: [{ path: 'src/retry.ts', status: 'modified' }],
    });
    expect(payload.sourceRefs).toEqual([
      expect.objectContaining({
        sourceRefType: 'git_commit',
        sourceRefId: commitSha,
        evidenceRole: 'submitted_commit',
        exactText: commitEvidenceText,
        contentHash: await sha256ContentHash(commitEvidenceText),
      }),
      expect.objectContaining({
        sourceRefType: 'code_diff',
        sourceRefId: `${baseCommitSha}..${commitSha}`,
        evidenceRole: 'submitted_diff',
        exactText: diffText,
        contentHash: await sha256ContentHash(diffText),
      }),
    ]);
  });

  it('rejects commit evidence that does not contain the submitted commit SHA', async () => {
    await expect(buildCommitSubmissionPayload({
      narrative: 'Submitted retry fix.',
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      forkRepositoryUrl: '',
      branchName: 'pipe-assessment/retry-fix',
      baseCommitSha: 'a'.repeat(40),
      commitSha: 'b'.repeat(40),
      commitUrl: '',
      upstreamPullRequestUrl: '',
      upstreamPrConsent: false,
      changedFilesText: 'src/retry.ts',
      commitEvidenceText: 'commit missing-sha',
      diffText: 'diff --git a/src/retry.ts b/src/retry.ts',
    })).rejects.toThrow('Commit evidence text must contain the submitted commit SHA.');
  });
});
