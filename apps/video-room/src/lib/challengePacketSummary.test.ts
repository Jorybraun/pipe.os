import { describe, expect, it } from 'vitest';
import {
  candidateSafeChallengeExactText,
  parseChallengePacketContract,
  summarizeChallengePacket,
} from './challengePacketSummary';

describe('parseChallengePacketContract', () => {
  it('keeps matched challenge proof separate from success criteria and evidence', () => {
    const contract = parseChallengePacketContract([
      'Repo: https://github.com/pipe/source-backed-worker',
      'Task: Fix deterministic retry handling.',
      'Verification command: npm test -- retry-order',
      'Match proof:',
      '- Review packet quality 92% from source-backed repo analysis.',
      '- 2 source-backed repo demands in the selected PR packet.',
      'Assessment fit:',
      '- focused review calibrated for senior candidates.',
      '- 30 minute target from deterministic engineering prior.',
      'Success criteria:',
      '- Retry order remains deterministic.',
      'Expected evidence:',
      '- Commit SHA on assessment branch.',
    ].join('\n'));

    expect(contract).toEqual({
      task: 'Fix deterministic retry handling.',
      verificationCommand: 'npm test -- retry-order',
      matchProof: [
        'Review packet quality 92% from source-backed repo analysis.',
        '2 source-backed repo demands in the selected PR packet.',
      ],
      assessmentFit: [
        'focused review calibrated for senior candidates.',
        '30 minute target from deterministic engineering prior.',
      ],
      successCriteria: ['Retry order remains deterministic.'],
      expectedEvidence: ['Commit SHA on assessment branch.'],
    });
  });

  it('keeps the source-backed upstream pull request URL in the packet summary', () => {
    const summary = summarizeChallengePacket({
      sourceRefType: 'review_challenge_packet',
      evidenceRole: 'assigned_challenge',
      exactText: [
        'Repo: https://github.com/pipe/source-backed-worker',
        'Base commit: dddddddddddddddddddddddddddddddddddddddd',
        'Pull request: #144',
        'Pull request URL: https://github.com/pipe/source-backed-worker/pull/144?conversation=1',
        'Task: Fix deterministic retry handling.',
      ].join('\n'),
      locator: {
        repositoryUrl: 'https://github.com/pipe/source-backed-worker',
        githubPrNumber: 144,
        baseCommitSha: 'dddddddddddddddddddddddddddddddddddddddd',
      },
      contentHash: 'sha256:packet-content-hash',
    });

    expect(summary.pullRequestUrl).toBe('https://github.com/pipe/source-backed-worker/pull/144');
  });

  it('builds a GitHub pull request URL from a trusted repo locator and PR number', () => {
    const summary = summarizeChallengePacket({
      sourceRefType: 'open_source_challenge_packet',
      evidenceRole: 'assigned_challenge',
      exactText: 'Task: Fix deterministic retry handling.',
      locator: {
        repositoryUrl: 'https://github.com/pipe/source-backed-worker.git',
        githubPrNumber: 144,
      },
      contentHash: 'sha256:packet-content-hash',
    });

    expect(summary.pullRequestUrl).toBe('https://github.com/pipe/source-backed-worker/pull/144');
  });

  it('removes solution PR and head commit lines from candidate replay text', () => {
    const safeText = candidateSafeChallengeExactText({
      sourceRefType: 'review_challenge_packet',
      exactText: [
        'Repo: https://github.com/pipe/source-backed-worker',
        'Base commit: dddddddddddddddddddddddddddddddddddddddd',
        'Pull request: #144',
        'Pull request URL: https://github.com/pipe/source-backed-worker/pull/144',
        'Head commit: eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        'Instructions: Use https://github.com/pipe/source-backed-worker/pull/144 as source-backed context without copying hidden ground truth.',
        'Source-backed demands:',
        '- Review source artifact in pull request #144. Source evidence: src/retry.ts:@@ -1 +1',
        'Task: Fix deterministic retry handling.',
        'Success criteria:',
        '- Retry handling remains deterministic.',
      ].join('\n'),
    });

    expect(safeText).toContain('Repo: https://github.com/pipe/source-backed-worker');
    expect(safeText).toContain('Task: Fix deterministic retry handling.');
    expect(safeText).toContain('Instructions: Use [hidden source-backed task] as source-backed context without copying hidden ground truth.');
    expect(safeText).toContain('Success criteria:');
    expect(safeText).toContain('Retry handling remains deterministic.');
    expect(safeText).not.toContain('Source-backed demands');
    expect(safeText).not.toContain('Source evidence');
    expect(safeText).not.toContain('#144');
    expect(safeText).not.toContain('/pull/144');
    expect(safeText).not.toContain('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
  });
});
