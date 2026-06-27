import { describe, expect, it } from 'vitest';
import { qualityGateFor, selectPreferredMatchExplanation } from '../rpc';

const passedValidator = {
  agentName: 'source_backed_match_validator',
  agentVersion: 'v1',
  mode: 'deterministic' as const,
  verdict: 'PASSED' as const,
  rationale: 'Selected PR has source-backed evidence.',
  checks: [],
  sourceBridge: {
    prNumber: 973,
    candidateSourceCount: 2,
    repoSourceCount: 3,
    roleSourceCount: 1,
    alignedDemandCount: 2,
    stretchCount: 0,
    provenanceComplete: true,
  },
};

const usableQualityWithoutComparableChallenge = {
  verdict: 'USABLE',
  score: 9,
  maxScore: 12,
  metrics: [
    {
      id: 'skill_stack_overlap',
      label: 'Skill/stack overlap',
      score: 2,
      maxScore: 2,
      reason: 'Candidate evidence overlaps with the selected PR.',
    },
    {
      id: 'contrast_separation',
      label: 'Contrast separation',
      score: 0,
      maxScore: 2,
      reason: 'No second eligible challenge was available in this explanation context.',
    },
  ],
};

describe('qualityGateFor', () => {
  it('requires review for role-backed automatic matches without contrast separation', () => {
    expect(qualityGateFor(
      'MATCHED',
      2,
      3,
      1,
      passedValidator,
      usableQualityWithoutComparableChallenge,
    )).toEqual({
      verdict: 'NEEDS_REVIEW',
      checks: [
        'candidate_source_evidence',
        'repo_source_spans',
        'role_context_alignment',
        'assessment_quality_verified',
        'agent_validated_match',
      ],
    });
  });

  it('passes roleless source-backed matches without contrast separation', () => {
    expect(qualityGateFor(
      'MATCHED',
      2,
      3,
      0,
      {
        ...passedValidator,
        sourceBridge: {
          ...passedValidator.sourceBridge,
          roleSourceCount: 0,
        },
      },
      usableQualityWithoutComparableChallenge,
    )).toEqual({
      verdict: 'PASSED',
      checks: [
        'candidate_source_evidence',
        'repo_source_spans',
        'assessment_quality_verified',
        'contrast_separation_not_required_roleless',
        'agent_validated_match',
      ],
    });
  });
});

describe('selectPreferredMatchExplanation', () => {
  const needsReviewExplanation = {
    status: 'MATCHED' as const,
    summary: 'Matched but contrast was not measured.',
    score: 0.69,
    qualityGate: {
      verdict: 'NEEDS_REVIEW' as const,
      checks: ['candidate_source_evidence', 'repo_source_spans'],
    },
    candidateSourceCount: 2,
    repoSourceCount: 3,
    roleSourceCount: 1,
    evidence: [],
    evidenceHyperedges: [],
  };
  const passedExplanation = {
    ...needsReviewExplanation,
    summary: 'Matched with measured contrast.',
    qualityGate: {
      verdict: 'PASSED' as const,
      checks: ['candidate_source_evidence', 'repo_source_spans', 'contrast_separation_verified'],
    },
  };

  it('preserves NEEDS_REVIEW proof instead of hiding the match explanation', () => {
    expect(selectPreferredMatchExplanation([null, needsReviewExplanation])).toEqual(needsReviewExplanation);
  });

  it('still prefers a PASSED proof when one is available', () => {
    expect(selectPreferredMatchExplanation([needsReviewExplanation, passedExplanation])).toEqual(passedExplanation);
  });
});
