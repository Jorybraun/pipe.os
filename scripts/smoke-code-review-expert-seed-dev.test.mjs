import { describe, expect, it } from 'vitest';

import {
  buildReviewCliArgs,
  validateExpertSeedSummary,
} from './smoke-code-review-expert-seed-dev.mjs';

function readySummary(overrides = {}) {
  return {
    sourceCorpusId: 'seeded-123',
    seeded: {
      matchRunCount: 6,
      candidateCount: 4,
      roleCount: 4,
      challengeCount: 3,
      labelCount: 4,
      draftLabelCount: 4,
      expertLabelCount: 0,
      syntheticFixtureCount: 0,
      expectedPacketCount: 3,
      warnings: [],
    },
    reviewPacketPath: '/tmp/review-packet.json',
    reviewTemplatePath: '/tmp/review-template.json',
    readinessSummary: {
      nextAction: 'complete_expert_review',
      draftLabelCount: 4,
      labelsNeedingHumanReview: ['a', 'b', 'c', 'd'],
      negativeLabelCount: 1,
      contrastLabelCount: 4,
      labelsMissingContrastCandidate: [],
      labelsMissingCandidateEvidence: [],
      labelsMissingRoleRequirements: [],
      labelsMissingExpectedPacket: [],
      labelsMissingRepoDemandEvidence: [],
    },
    nextAction: 'complete_expert_review',
    ...overrides,
  };
}

describe('CODE_REVIEW expert seed smoke contract', () => {
  it('accepts a warning-free source-backed draft corpus with enough packet breadth', () => {
    expect(validateExpertSeedSummary(readySummary(), {
      minCandidates: 2,
      minRoles: 1,
      minChallenges: 3,
      minLabels: 4,
      minExpectedPackets: 3,
    })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('rejects draft corpora that are still missing repo demand provenance', () => {
    const result = validateExpertSeedSummary(readySummary({
      readinessSummary: {
        ...readySummary().readinessSummary,
        nextAction: 'fix_corpus_source_evidence',
        labelsMissingRepoDemandEvidence: ['label-a'],
      },
      nextAction: 'fix_corpus_source_evidence',
    }), {
      minCandidates: 2,
      minRoles: 1,
      minChallenges: 3,
      minLabels: 4,
      minExpectedPackets: 3,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain('nextAction must be complete_expert_review; got fix_corpus_source_evidence');
    expect(result.failures).toContain('labelsMissingRepoDemandEvidence must be empty; got label-a');
  });

  it('rejects corpora that already claim expert labels or synthetic fixtures', () => {
    const result = validateExpertSeedSummary(readySummary({
      seeded: {
        ...readySummary().seeded,
        expertLabelCount: 1,
        syntheticFixtureCount: 1,
      },
    }), {
      minCandidates: 2,
      minRoles: 1,
      minChallenges: 3,
      minLabels: 4,
      minExpectedPackets: 3,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain('expertLabelCount must be 0 for an expert-seed smoke; got 1');
    expect(result.failures).toContain('syntheticFixtureCount must be 0; got 1');
  });

  it('builds review CLI args with remote D1, seeded draft source, and artifact exports', () => {
    expect(buildReviewCliArgs({
      databaseId: 'db-123',
      seedLimit: 6,
      seedSelectionPoolLimit: 250,
      reviewPacketPath: '/tmp/packet.json',
      reviewTemplatePath: '/tmp/template.json',
      summaryPath: '/tmp/summary.json',
      seedDescription: 'CODE_REVIEW expert seed smoke',
    })).toEqual([
      'run',
      'matching-eval:review',
      '--',
      '--remote',
      '--database-id',
      'db-123',
      '--seed-from-match-runs',
      '--require-role-context',
      '--seed-limit',
      '6',
      '--seed-selection-pool-limit',
      '250',
      '--seed-description',
      'CODE_REVIEW expert seed smoke',
      '--review-packet',
      '/tmp/packet.json',
      '--review-template',
      '/tmp/template.json',
      '--json',
      '/tmp/summary.json',
    ]);
  });
});
