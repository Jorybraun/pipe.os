import { describe, expect, it } from 'vitest';
import { candidateSafeQualityGateFor } from '../candidateSafeQualityGate';

describe('candidateSafeQualityGateFor', () => {
  it('passes when a matched PR has source evidence, validator approval, and usable assessment quality', () => {
    expect(candidateSafeQualityGateFor({
      status: 'MATCHED',
      candidateSourceCount: 3,
      repoSourceCount: 4,
      roleSourceCount: 1,
      validatorVerdict: 'PASSED',
      assessmentQualityVerdict: 'USABLE',
      assessmentQualityMetrics: [
        { id: 'contrast_separation', score: 1 },
      ],
    })).toEqual({
      verdict: 'PASSED',
      checks: [
        'candidate_source_evidence',
        'repo_source_spans',
        'role_context_alignment',
        'assessment_quality_verified',
        'contrast_separation_verified',
        'agent_validated_match',
      ],
    });
  });

  it('requires review when contrast separation was not measured', () => {
    expect(candidateSafeQualityGateFor({
      status: 'MATCHED',
      candidateSourceCount: 3,
      repoSourceCount: 4,
      roleSourceCount: 1,
      validatorVerdict: 'PASSED',
      assessmentQualityVerdict: 'USABLE',
      assessmentQualityMetrics: [
        { id: 'contrast_separation', score: 0 },
      ],
    })).toEqual({
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

  it('passes roleless source-backed matches without contrast separation when explicitly allowed', () => {
    expect(candidateSafeQualityGateFor({
      status: 'MATCHED',
      candidateSourceCount: 3,
      repoSourceCount: 4,
      roleSourceCount: 0,
      validatorVerdict: 'PASSED',
      assessmentQualityVerdict: 'USABLE',
      assessmentQualityMetrics: [
        { id: 'contrast_separation', score: 0 },
      ],
      requireContrastSeparation: false,
    })).toEqual({
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

  it('requires review when the assessment-quality rubric is weak', () => {
    expect(candidateSafeQualityGateFor({
      status: 'MATCHED',
      candidateSourceCount: 3,
      repoSourceCount: 4,
      roleSourceCount: 1,
      validatorVerdict: 'PASSED',
      assessmentQualityVerdict: 'WEAK',
      assessmentQualityMetrics: [
        { id: 'contrast_separation', score: 2 },
      ],
    })).toEqual({
      verdict: 'NEEDS_REVIEW',
      checks: [
        'candidate_source_evidence',
        'repo_source_spans',
        'role_context_alignment',
        'contrast_separation_verified',
        'agent_validated_match',
      ],
    });
  });

  it('requires explicit validator approval before passing an automatic match', () => {
    expect(candidateSafeQualityGateFor({
      status: 'MATCHED',
      candidateSourceCount: 3,
      repoSourceCount: 4,
      roleSourceCount: 1,
      assessmentQualityVerdict: 'USABLE',
      assessmentQualityMetrics: [
        { id: 'contrast_separation', score: 2 },
      ],
    })).toEqual({
      verdict: 'NEEDS_REVIEW',
      checks: [
        'candidate_source_evidence',
        'repo_source_spans',
        'role_context_alignment',
        'assessment_quality_verified',
        'contrast_separation_verified',
      ],
    });
  });

  it('requires assessment-quality verification before passing an automatic match', () => {
    expect(candidateSafeQualityGateFor({
      status: 'MATCHED',
      candidateSourceCount: 3,
      repoSourceCount: 4,
      roleSourceCount: 1,
      validatorVerdict: 'PASSED',
    })).toEqual({
      verdict: 'NEEDS_REVIEW',
      checks: [
        'candidate_source_evidence',
        'repo_source_spans',
        'role_context_alignment',
        'agent_validated_match',
      ],
    });
  });
});
