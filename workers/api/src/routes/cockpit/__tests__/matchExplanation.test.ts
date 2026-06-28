import { describe, expect, it } from 'vitest';
import { buildStandaloneReviewMatchSummary } from '../candidates';

describe('match explanation — criteria #5/#6: evidence-based matching with explanations', () => {
  it('MATCHED summary includes demand count and stretch count', () => {
    const result = buildStandaloneReviewMatchSummary('MATCHED', {
      rank: 1,
      recallRank: 1,
      challengeId: 'challenge-1',
      repoId: 'repo-1',
      prNumber: 42,
      score: 0.85,
      alignedDemandCount: 5,
      stretchCount: 2,
      provenanceComplete: true,
      eligible: true,
      alignments: [],
      stretchAreas: [],
      unmatchedDemandIds: [],
      rejectionReasons: [],
    } as Parameters<typeof buildStandaloneReviewMatchSummary>[1]);
    expect(result.summary).toContain('5 source-backed demand');
    expect(result.summary).toContain('2 stretch');
  });

  it('NEEDS_MORE_EVIDENCE summary reports no evidence', () => {
    const result = buildStandaloneReviewMatchSummary('NEEDS_MORE_EVIDENCE', null);
    expect(result.summary).toContain('more candidate evidence');
    expect(result.evidence).toHaveLength(0);
    expect(result.gaps.length).toBeGreaterThan(0);
  });

  it('NO_ROLE_SAFE_CHALLENGE summary reports guardrail failures', () => {
    const result = buildStandaloneReviewMatchSummary('NO_ROLE_SAFE_CHALLENGE', {
      rank: null,
      recallRank: 1,
      challengeId: 'challenge-1',
      repoId: 'repo-1',
      prNumber: 42,
      score: 0.40,
      alignedDemandCount: 1,
      stretchCount: 0,
      provenanceComplete: false,
      eligible: false,
      alignments: [],
      stretchAreas: [],
      unmatchedDemandIds: ['demand-orphan-1'],
      rejectionReasons: ['PROVENANCE_INCOMPLETE'],
    } as Parameters<typeof buildStandaloneReviewMatchSummary>[1]);
    expect(result.summary).toContain('guardrails');
    expect(result.gaps).toContain('PROVENANCE_INCOMPLETE');
  });

  it('PENDING_INTAKE summary reports waiting for evidence', () => {
    const result = buildStandaloneReviewMatchSummary('PENDING_INTAKE', null);
    expect(result.summary).toContain('Waiting');
    expect(result.gaps).toHaveLength(1);
  });
});
