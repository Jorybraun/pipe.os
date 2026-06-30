import { describe, expect, it } from 'vitest';

import {
  buildCommitSubmissionDefaults,
  buildCommitSubmissionPayload,
  parseChangedFiles,
  sha256ContentHash,
} from './commitSubmission';

describe('commit submission payloads', () => {
  it('derives safe submission defaults from the source-backed challenge packet', () => {
    expect(buildCommitSubmissionDefaults({
      repositoryUrl: 'https://github.com/fallback/repo',
      challengePacket: {
        sourceRefType: 'open_source_challenge_packet',
        evidenceRole: 'assigned_challenge',
        exactText: 'Repo and base commit packet',
        contentHash: 'sha256:packet',
        locator: {
          repositoryUrl: 'https://github.com/pipe/source-backed-worker',
          baseCommitSha: 'ABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD',
        },
      },
    })).toEqual({
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      branchName: 'pipe-assessment',
      baseCommitSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    });
  });

  it('does not invent a base commit or assessment branch without a valid packet SHA', () => {
    expect(buildCommitSubmissionDefaults({
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      challengePacket: {
        sourceRefType: 'open_source_challenge_packet',
        evidenceRole: 'assigned_challenge',
        exactText: 'Repo without valid base commit',
        contentHash: 'sha256:packet',
        locator: {
          baseCommitSha: 'branch-main',
        },
      },
    })).toEqual({
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      branchName: '',
      baseCommitSha: '',
    });
  });

  it('parses changed files with explicit statuses and modified-by-default paths', () => {
    expect(parseChangedFiles('added src/new.ts\nsrc/existing.ts\nrenamed src/new-name.ts')).toEqual([
      { path: 'src/new.ts', status: 'added' },
      { path: 'src/existing.ts', status: 'modified' },
      { path: 'src/new-name.ts', status: 'renamed' },
    ]);
  });

  it('builds exact git commit, code diff, and test run source refs with content hashes', async () => {
    const baseCommitSha = 'a'.repeat(40);
    const commitSha = 'B'.repeat(40);
    const normalizedCommitSha = commitSha.toLowerCase();
    const commitEvidenceText = `commit ${commitSha}\nAuthor: Candidate\n\nFix retry flow`;
    const diffText = 'diff --git a/src/retry.ts b/src/retry.ts\n+export const retry = true;';
    const testEvidenceText = 'npm test -- retry\nPASS src/retry.test.ts';

    const payload = await buildCommitSubmissionPayload({
      narrative: 'Submitted retry fix with local tests passing.',
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      forkRepositoryUrl: 'https://github.com/candidate/source-backed-worker',
      branchName: 'pipe-assessment/retry-fix',
      baseCommitSha,
      commitSha,
      commitUrl: `https://github.com/candidate/source-backed-worker/commit/${normalizedCommitSha}`,
      upstreamPullRequestUrl: '',
      upstreamPrConsent: false,
      changedFilesText: 'modified src/retry.ts',
      commitEvidenceText,
      diffText,
      testEvidenceText,
      verificationNotesText: '',
    });

    expect(payload).toMatchObject({
      narrative: 'Submitted retry fix with local tests passing.',
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      forkRepositoryUrl: 'https://github.com/candidate/source-backed-worker',
      branchName: 'pipe-assessment/retry-fix',
      baseCommitSha,
      commitSha: normalizedCommitSha,
      upstreamPrConsent: false,
      changedFiles: [{ path: 'src/retry.ts', status: 'modified' }],
    });
    expect(payload.sourceRefs).toEqual([
      expect.objectContaining({
        sourceRefType: 'git_commit',
        sourceRefId: normalizedCommitSha,
        evidenceRole: 'submitted_commit',
        exactText: commitEvidenceText,
        contentHash: await sha256ContentHash(commitEvidenceText),
      }),
      expect.objectContaining({
        sourceRefType: 'code_diff',
        sourceRefId: `${baseCommitSha}..${normalizedCommitSha}`,
        evidenceRole: 'submitted_diff',
        exactText: diffText,
        contentHash: await sha256ContentHash(diffText),
      }),
      expect.objectContaining({
        sourceRefType: 'test_run',
        sourceRefId: `${normalizedCommitSha}:test-run`,
        evidenceRole: 'verification_test_output',
        exactText: testEvidenceText,
        contentHash: await sha256ContentHash(testEvidenceText),
      }),
    ]);
  });

  it('captures optional upstream PR tracking only with explicit consent', async () => {
    const baseCommitSha = 'a'.repeat(40);
    const commitSha = 'b'.repeat(40);
    const upstreamPullRequestUrl = 'https://github.com/pipe/source-backed-worker/pull/42';

    const payload = await buildCommitSubmissionPayload({
      narrative: 'Submitted retry fix with an approved upstream PR link.',
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      forkRepositoryUrl: 'https://github.com/candidate/source-backed-worker',
      branchName: 'pipe-assessment/retry-fix',
      baseCommitSha,
      commitSha,
      commitUrl: `https://github.com/candidate/source-backed-worker/commit/${commitSha}`,
      upstreamPullRequestUrl,
      upstreamPrConsent: true,
      changedFilesText: 'modified src/retry.ts',
      commitEvidenceText: `commit ${commitSha}\nAuthor: Candidate`,
      diffText: 'diff --git a/src/retry.ts b/src/retry.ts',
      testEvidenceText: '',
      verificationNotesText: 'Focused upstream PR link test; test output not captured in this fixture.',
    });

    expect(payload.upstreamPullRequestUrl).toBe(upstreamPullRequestUrl);
    expect(payload.upstreamPrConsent).toBe(true);
    expect(payload.sourceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceRefType: 'upstream_pull_request',
        sourceRefId: upstreamPullRequestUrl,
        evidenceRole: 'optional_upstream_pr_tracking',
        exactText: upstreamPullRequestUrl,
        contentHash: await sha256ContentHash(upstreamPullRequestUrl),
        metadata: expect.objectContaining({
          source: 'assessment_commit_submission_window',
          upstreamPrConsent: true,
        }),
      }),
    ]));
  });

  it('rejects upstream PR links without explicit candidate approval', async () => {
    const commitSha = 'b'.repeat(40);

    await expect(buildCommitSubmissionPayload({
      narrative: 'Submitted retry fix.',
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      forkRepositoryUrl: 'https://github.com/candidate/source-backed-worker',
      branchName: 'pipe-assessment/retry-fix',
      baseCommitSha: 'a'.repeat(40),
      commitSha,
      commitUrl: `https://github.com/candidate/source-backed-worker/commit/${commitSha}`,
      upstreamPullRequestUrl: 'https://github.com/pipe/source-backed-worker/pull/42',
      upstreamPrConsent: false,
      changedFilesText: 'modified src/retry.ts',
      commitEvidenceText: `commit ${commitSha}\nAuthor: Candidate`,
      diffText: 'diff --git a/src/retry.ts b/src/retry.ts',
      testEvidenceText: '',
      verificationNotesText: 'Focused upstream consent validation; test output not captured in this fixture.',
    })).rejects.toThrow('Upstream PR URL requires explicit candidate approval.');
  });

  it('records a source-backed verification gap when the candidate leaves test output blank', async () => {
    const commitSha = 'b'.repeat(40);
    const verificationNotesText = 'I did not run tests because dependency installation failed before the suite could start.';
    const payload = await buildCommitSubmissionPayload({
      narrative: 'Submitted retry fix; tests were not captured.',
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      forkRepositoryUrl: '',
      branchName: 'pipe-assessment/retry-fix',
      baseCommitSha: 'a'.repeat(40),
      commitSha,
      commitUrl: '',
      upstreamPullRequestUrl: '',
      upstreamPrConsent: false,
      changedFilesText: 'modified src/retry.ts',
      commitEvidenceText: `commit ${commitSha}\nAuthor: Candidate`,
      diffText: 'diff --git a/src/retry.ts b/src/retry.ts',
      testEvidenceText: '   ',
      verificationNotesText,
    });

    expect(payload.sourceRefs.map((ref) => ref.sourceRefType)).toEqual([
      'git_commit',
      'code_diff',
      'verification_gap',
    ]);
    expect(payload.sourceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceRefType: 'verification_gap',
        sourceRefId: `${commitSha}:test-evidence-missing`,
        evidenceRole: 'missing_test_evidence_note',
        exactText: verificationNotesText,
        contentHash: await sha256ContentHash(verificationNotesText),
        metadata: expect.objectContaining({
          source: 'assessment_commit_submission_window',
          missingEvidence: 'test_run',
        }),
      }),
    ]));
  });

  it('rejects submissions that provide neither test output nor a missing-test note', async () => {
    const commitSha = 'b'.repeat(40);

    await expect(buildCommitSubmissionPayload({
      narrative: 'Submitted retry fix; verification omitted.',
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      forkRepositoryUrl: '',
      branchName: 'pipe-assessment/retry-fix',
      baseCommitSha: 'a'.repeat(40),
      commitSha,
      commitUrl: '',
      upstreamPullRequestUrl: '',
      upstreamPrConsent: false,
      changedFilesText: 'modified src/retry.ts',
      commitEvidenceText: `commit ${commitSha}\nAuthor: Candidate`,
      diffText: 'diff --git a/src/retry.ts b/src/retry.ts',
      testEvidenceText: '   ',
      verificationNotesText: '   ',
    })).rejects.toThrow('Paste test output or explain why test evidence is missing.');
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
      testEvidenceText: '',
      verificationNotesText: 'Focused SHA validation; test output not captured in this fixture.',
    })).rejects.toThrow('Commit evidence text must contain the submitted commit SHA.');
  });

  it('rejects fake repositories, short SHAs, default branches, and unrelated diffs before submission', async () => {
    const validFields = {
      narrative: 'Submitted retry fix with local tests passing.',
      repositoryUrl: 'https://github.com/pipe/source-backed-worker',
      forkRepositoryUrl: 'https://github.com/candidate/source-backed-worker',
      branchName: 'pipe-assessment/retry-fix',
      baseCommitSha: 'a'.repeat(40),
      commitSha: 'b'.repeat(40),
      commitUrl: `https://github.com/candidate/source-backed-worker/commit/${'b'.repeat(40)}`,
      upstreamPullRequestUrl: '',
      upstreamPrConsent: false,
      changedFilesText: 'modified src/retry.ts',
      commitEvidenceText: `commit ${'b'.repeat(40)}\nAuthor: Candidate`,
      diffText: 'diff --git a/src/retry.ts b/src/retry.ts\n+export const retry = true;',
      testEvidenceText: 'npm test -- retry\nPASS src/retry.test.ts',
      verificationNotesText: '',
    };

    await expect(buildCommitSubmissionPayload({
      ...validFields,
      repositoryUrl: 'https://example.com/pipe/source-backed-worker',
    })).rejects.toThrow('Repository URL must be a GitHub URL.');

    await expect(buildCommitSubmissionPayload({
      ...validFields,
      commitSha: 'abc123',
    })).rejects.toThrow('Commit SHA must be a full 40-character Git commit SHA.');

    await expect(buildCommitSubmissionPayload({
      ...validFields,
      branchName: 'main',
    })).rejects.toThrow('Branch must be pipe-assessment or a pipe-assessment/* branch.');

    await expect(buildCommitSubmissionPayload({
      ...validFields,
      branchName: 'candidate-fix',
    })).rejects.toThrow('Branch must be pipe-assessment or a pipe-assessment/* branch.');

    await expect(buildCommitSubmissionPayload({
      ...validFields,
      commitUrl: `https://github.com/candidate/source-backed-worker/commit/${'c'.repeat(40)}`,
    })).rejects.toThrow('Commit URL must point to the submitted commit SHA.');

    await expect(buildCommitSubmissionPayload({
      ...validFields,
      upstreamPullRequestUrl: 'https://github.com/pipe/source-backed-worker/issues/42',
      upstreamPrConsent: true,
    })).rejects.toThrow('Upstream PR URL must point to a GitHub pull request.');

    await expect(buildCommitSubmissionPayload({
      ...validFields,
      diffText: 'diff --git a/docs/readme.md b/docs/readme.md\n+notes',
    })).rejects.toThrow('Diff evidence must mention at least one submitted changed file path.');
  });
});
