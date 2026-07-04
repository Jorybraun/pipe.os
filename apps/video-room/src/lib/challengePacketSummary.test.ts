import { describe, expect, it } from 'vitest';
import { parseChallengePacketContract } from './challengePacketSummary';

describe('parseChallengePacketContract', () => {
  it('keeps matched challenge proof separate from success criteria and evidence', () => {
    const contract = parseChallengePacketContract([
      'Repo: https://github.com/pipe/source-backed-worker',
      'Task: Fix deterministic retry handling.',
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
});
