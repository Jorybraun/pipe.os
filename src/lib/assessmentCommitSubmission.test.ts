import { describe, expect, it } from 'vitest';

import { buildCandidateCommitSubmissionPayload } from './assessmentCommitSubmission';

describe('candidate assessment commit submission payloads', () => {
  it('keeps the pasted verification command on test-run source refs', async () => {
    const commitSha = 'b'.repeat(40);
    const payload = await buildCandidateCommitSubmissionPayload({
      narrative: 'Submitted retry fix with focused evidence.',
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      forkRepositoryUrl: 'https://github.com/candidate/source-backed-worker',
      branchName: 'pipe-assessment/retry-fix',
      baseCommitSha: 'a'.repeat(40),
      commitSha,
      commitUrl: `https://github.com/candidate/source-backed-worker/commit/${commitSha}`,
      upstreamPullRequestUrl: '',
      upstreamPrConsent: false,
      changedFilesText: 'modified src/retry.ts',
      commitEvidenceText: `commit ${commitSha}\nAuthor: Candidate`,
      diffText: 'diff --git a/src/retry.ts b/src/retry.ts\n+export const retry = true;',
      testEvidenceText: 'npm test -- retry\nPASS src/retry.test.ts',
      verificationNotesText: '',
    });

    expect(payload.sourceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceRefType: 'test_run',
        locator: expect.objectContaining({
          command: 'npm test -- retry',
        }),
      }),
    ]));
  });

  it('rejects commit URLs outside the assigned repository or declared fork', async () => {
    const commitSha = 'b'.repeat(40);
    const validFields = {
      narrative: 'Submitted retry fix with focused evidence.',
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      forkRepositoryUrl: 'https://github.com/candidate/source-backed-worker',
      branchName: 'pipe-assessment/retry-fix',
      baseCommitSha: 'a'.repeat(40),
      commitSha,
      commitUrl: `https://github.com/unrelated/source-backed-worker/commit/${commitSha}`,
      upstreamPullRequestUrl: '',
      upstreamPrConsent: false,
      changedFilesText: 'modified src/retry.ts',
      commitEvidenceText: `commit ${commitSha}\nAuthor: Candidate`,
      diffText: 'diff --git a/src/retry.ts b/src/retry.ts\n+export const retry = true;',
      testEvidenceText: 'npm test -- retry\nPASS src/retry.test.ts',
      verificationNotesText: '',
    };

    await expect(buildCandidateCommitSubmissionPayload(validFields)).rejects.toThrow(
      'Commit URL must belong to the assigned repository or declared fork.',
    );
  });
});
