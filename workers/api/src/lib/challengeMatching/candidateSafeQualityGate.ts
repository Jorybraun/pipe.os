export type CandidateSafeMatchStatus =
  | 'MATCHED'
  | 'NEEDS_MORE_EVIDENCE'
  | 'NO_ROLE_SAFE_CHALLENGE';

export type CandidateSafeQualityGateVerdict = 'PASSED' | 'NEEDS_REVIEW';
export type CandidateSafeQualityGateDiagnostic =
  | 'MISSING_CANDIDATE_SOURCE_EVIDENCE'
  | 'MISSING_REPO_SOURCE_EVIDENCE'
  | 'EMBEDDING_ONLY_MATCH_REJECTED'
  | 'PROVENANCE_INCOMPLETE'
  | 'MATCH_QUALITY_NOT_USABLE'
  | 'CONTRAST_SEPARATION_UNVERIFIED';

export interface CandidateSafeQualityGateInput {
  status: CandidateSafeMatchStatus;
  candidateSourceCount: number;
  repoSourceCount: number;
  roleSourceCount: number;
  validatorVerdict?: 'PASSED' | 'NEEDS_REVIEW' | 'REJECTED';
  assessmentQualityVerdict?: string;
  assessmentQualityMetrics?: Array<{
    id?: string;
    score?: number;
  }>;
  requireContrastSeparation?: boolean;
}

export interface CandidateSafeQualityGate {
  verdict: CandidateSafeQualityGateVerdict;
  checks: string[];
  diagnostics: CandidateSafeQualityGateDiagnostic[];
}

function assessmentQualityPasses(verdict: string | undefined): boolean {
  return verdict === 'STRONG' || verdict === 'USABLE';
}

function contrastSeparationPasses(
  metrics: CandidateSafeQualityGateInput['assessmentQualityMetrics'],
): boolean {
  const contrast = metrics?.find((metric) => metric.id === 'contrast_separation');
  return typeof contrast?.score === 'number' && Number.isFinite(contrast.score) && contrast.score > 0;
}

export function candidateSafeQualityGateFor(
  input: CandidateSafeQualityGateInput,
): CandidateSafeQualityGate {
  const validatorPassed = input.validatorVerdict === 'PASSED';
  const qualityPassed = assessmentQualityPasses(input.assessmentQualityVerdict);
  const contrastPassed = contrastSeparationPasses(input.assessmentQualityMetrics);
  const contrastRequired = input.requireContrastSeparation !== false;
  const contrastAccepted = contrastRequired ? contrastPassed : true;
  const checks = [
    ...(input.candidateSourceCount > 0 ? ['candidate_source_evidence'] : []),
    ...(input.repoSourceCount > 0 ? ['repo_source_spans'] : []),
    ...(input.roleSourceCount > 0 ? ['role_context_alignment'] : []),
    ...(qualityPassed && input.assessmentQualityVerdict ? ['assessment_quality_verified'] : []),
    ...(contrastPassed ? ['contrast_separation_verified'] : []),
    ...(!contrastRequired && !contrastPassed ? ['contrast_separation_not_required_roleless'] : []),
    ...(input.validatorVerdict === 'PASSED' ? ['agent_validated_match'] : []),
  ];
  const diagnostics: CandidateSafeQualityGateDiagnostic[] = [
    ...(input.candidateSourceCount > 0 ? [] : ['MISSING_CANDIDATE_SOURCE_EVIDENCE' as const]),
    ...(input.repoSourceCount > 0 ? [] : ['MISSING_REPO_SOURCE_EVIDENCE' as const]),
    ...(input.status === 'MATCHED' && input.candidateSourceCount <= 0 && input.repoSourceCount <= 0
      ? ['EMBEDDING_ONLY_MATCH_REJECTED' as const]
      : []),
    ...(validatorPassed ? [] : ['PROVENANCE_INCOMPLETE' as const]),
    ...(qualityPassed ? [] : ['MATCH_QUALITY_NOT_USABLE' as const]),
    ...(contrastAccepted ? [] : ['CONTRAST_SEPARATION_UNVERIFIED' as const]),
  ];

  return {
    verdict: input.status === 'MATCHED'
      && input.candidateSourceCount > 0
      && input.repoSourceCount > 0
      && validatorPassed
      && qualityPassed
      && contrastAccepted
      ? 'PASSED'
      : 'NEEDS_REVIEW',
    checks,
    diagnostics,
  };
}
