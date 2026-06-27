export type AssessmentMode =
  | 'AUTO_MATCHED'
  | 'ROLE_BACKED_MATCHED'
  | 'RECRUITER_SELECTED_REVIEWABLE_PR'
  | 'NEEDS_MORE_EVIDENCE'
  | 'AI_DEVELOPER_UNAVAILABLE'
  | 'NO_ROLE_SAFE_CHALLENGE';

export type DiagnosticVerdict =
  | 'OK'
  | 'NEEDS_MORE_EVIDENCE'
  | 'AI_DEVELOPER_UNAVAILABLE'
  | 'NO_ROLE_SAFE_CHALLENGE'
  | 'PROVENANCE_INCOMPLETE';

export interface SourceSpan {
  sourceRefType: string;
  sourceRefId: string;
  sourceSpanId?: string;
  locator?: string;
  exactText?: string;
  contentHash?: string;
}

export interface EvidenceHyperedgeNode {
  kind: 'candidate' | 'role' | 'repo' | 'challenge' | 'assessment' | 'agent_run' | 'diagnostic';
  id?: string;
  label?: string;
  sourceRefs?: SourceSpan[];
}

export interface EvidenceHyperedge {
  id: string;
  relation: string;
  nodes: EvidenceHyperedgeNode[];
  sourceRefs: SourceSpan[];
}

export interface AssessmentDiagnostic {
  mode: AssessmentMode;
  verdict: DiagnosticVerdict;
  reason: string;
  provider?: string;
  retryable: boolean;
  details?: Record<string, string | number | boolean | null>;
}

export interface AssessmentEvidencePacket {
  mode: AssessmentMode;
  verdict: DiagnosticVerdict;
  sourceRefs: SourceSpan[];
  hyperedges: EvidenceHyperedge[];
  diagnostics: AssessmentDiagnostic[];
}

export function aiDeveloperUnavailableDiagnostic(input: {
  provider: string;
  reason: string;
  retryable?: boolean;
  details?: Record<string, string | number | boolean | null>;
}): AssessmentDiagnostic {
  return {
    mode: 'AI_DEVELOPER_UNAVAILABLE',
    verdict: 'AI_DEVELOPER_UNAVAILABLE',
    provider: input.provider,
    reason: input.reason,
    retryable: input.retryable ?? true,
    ...(input.details ? { details: input.details } : {}),
  };
}
