import { describe, expect, it } from 'vitest';

import {
  buildReviewCliArgs,
  resolveExpertSeedDatabaseId,
  resolveExpertSeedOutputDir,
  validateExpertReviewMarkdown,
  validateExpertSeedPacket,
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
    draftPersisted: true,
    draftCorpusHash: 'sha256:draft-corpus',
    sourceCorpusHash: 'sha256:draft-corpus',
    reviewPacketPath: '/tmp/review-packet.json',
    reviewTemplatePath: '/tmp/review-template.json',
    reviewMarkdownPath: '/tmp/review.md',
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

function readyPacket(overrides = {}) {
  return {
    items: [
      {
        labelId: 'label-a',
        draft: {
          relevanceGrade: 'borderline',
          eligibleChallengeIds: ['packet-a'],
        },
        expectedPacket: { challengeId: 'packet-a', prNumber: 1 },
        suggestedContrastCandidates: [{ candidateId: 'candidate-b' }],
      },
      {
        labelId: 'label-b',
        draft: {
          relevanceGrade: 'relevant',
          eligibleChallengeIds: ['packet-b'],
        },
        expectedPacket: { challengeId: 'packet-b', prNumber: 2 },
        suggestedContrastCandidates: [{ candidateId: 'candidate-a' }],
      },
      {
        labelId: 'label-c',
        draft: {
          relevanceGrade: 'highly_relevant',
          eligibleChallengeIds: ['packet-c'],
        },
        expectedPacket: { challengeId: 'packet-c', prNumber: 3 },
        suggestedContrastCandidates: [{ candidateId: 'candidate-d' }],
      },
    ],
    ...overrides,
  };
}

describe('CODE_REVIEW expert seed smoke contract', () => {
  it('defaults review artifacts to a durable ignored repo-local directory', () => {
    expect(resolveExpertSeedOutputDir({}, () => 12345, '/repo/root'))
      .toBe('/repo/root/tmp/code-review-expert-seed/12345');
  });

  it('honors explicit expert seed output directory overrides', () => {
    expect(resolveExpertSeedOutputDir({
      CODE_REVIEW_EXPERT_SEED_OUTPUT_DIR: '/var/tmp/pipe-review',
    }, () => 12345, '/repo/root')).toBe('/var/tmp/pipe-review');
  });

  it('requires a CODE_REVIEW evaluation D1 instead of falling back to the generic app D1', () => {
    expect(resolveExpertSeedDatabaseId({
      CODE_REVIEW_EXPERT_SEED_D1_DATABASE_ID: 'expert-seed-db',
      MATCHING_EVALUATION_D1_DATABASE_ID: 'matching-eval-db',
      CLOUDFLARE_D1_DATABASE_ID: 'generic-app-db',
    })).toBe('expert-seed-db');
    expect(resolveExpertSeedDatabaseId({
      MATCHING_EVALUATION_D1_DATABASE_ID: 'matching-eval-db',
      CLOUDFLARE_D1_DATABASE_ID: 'generic-app-db',
    })).toBe('matching-eval-db');
    expect(resolveExpertSeedDatabaseId({
      CLOUDFLARE_D1_DATABASE_ID: 'generic-app-db',
    })).toBe('');
  });

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

  it('rejects expert seed summaries that did not persist the draft source corpus', () => {
    const result = validateExpertSeedSummary({
      ...readySummary(),
      draftPersisted: false,
      draftCorpusHash: '',
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      'draftPersisted must be true so expert review has an immutable source corpus; got false',
    );
    expect(result.failures).toContain('draftCorpusHash is required');
  });

  it('rejects expert seed summaries whose source hash drifts from the persisted draft hash', () => {
    const result = validateExpertSeedSummary({
      ...readySummary(),
      sourceCorpusHash: 'sha256:other-corpus',
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      'sourceCorpusHash must match draftCorpusHash for the persisted draft corpus',
    );
  });

  it('accepts an expert review packet with eligible draft labels and contrast suggestions', () => {
    expect(validateExpertSeedPacket(readyPacket(), {
      minEligibleLabels: 3,
    })).toEqual({
      ok: true,
      failures: [],
      metrics: {
        itemCount: 3,
        eligibleDraftLabelCount: 3,
        eligibleLabelsWithContrastSuggestions: 3,
      },
    });
  });

  it('accepts a readable expert review markdown artifact with editable label instructions', () => {
    const markdown = [
      '# CODE_REVIEW Expert Corpus Review',
      '## Reviewer Instructions',
      '### Candidate Evidence',
      '### Role Requirements',
      '### Repo / PR Challenge',
      '### Suggested Contrast Candidates',
      'Edit `labels[0].explanation` in the JSON template.',
      'Edit `labels[1].explanation` in the JSON template.',
      'Edit `labels[2].explanation` in the JSON template.',
    ].join('\n\n');

    expect(validateExpertReviewMarkdown(markdown, { minLabels: 3 })).toEqual({
      ok: true,
      failures: [],
      metrics: { editableLabelCount: 3 },
    });
  });

  it('rejects expert review markdown without source evidence sections', () => {
    const result = validateExpertReviewMarkdown('# CODE_REVIEW Expert Corpus Review', { minLabels: 3 });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain('review markdown must include "### Candidate Evidence"');
    expect(result.failures).toContain('editableLabelCount must be >= 3; got 0');
  });

  it('rejects expert review packets with only irrelevant draft labels', () => {
    const result = validateExpertSeedPacket(readyPacket({
      items: readyPacket().items.map((item) => ({
        ...item,
        draft: {
          relevanceGrade: 'irrelevant',
          eligibleChallengeIds: [],
        },
      })),
    }), {
      minEligibleLabels: 3,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain('eligibleDraftLabelCount must be >= 3; got 0');
  });

  it('rejects eligible draft labels without suggested contrast candidates', () => {
    const result = validateExpertSeedPacket(readyPacket({
      items: [
        {
          ...readyPacket().items[0],
          suggestedContrastCandidates: [],
        },
        ...readyPacket().items.slice(1),
      ],
    }), {
      minEligibleLabels: 3,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      'eligible draft labels must include suggested contrast candidates; missing label-a',
    );
  });

  it('builds review CLI args with remote D1, seeded draft source, and artifact exports', () => {
    expect(buildReviewCliArgs({
      databaseId: 'db-123',
      seedLimit: 6,
      seedSelectionPoolLimit: 250,
      reviewPacketPath: '/tmp/packet.json',
      reviewTemplatePath: '/tmp/template.json',
      reviewMarkdownPath: '/tmp/review.md',
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
      '--persist-draft',
      '--review-packet',
      '/tmp/packet.json',
      '--review-template',
      '/tmp/template.json',
      '--review-markdown',
      '/tmp/review.md',
      '--json',
      '/tmp/summary.json',
    ]);
  });
});
