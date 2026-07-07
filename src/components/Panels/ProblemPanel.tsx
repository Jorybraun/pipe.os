import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BriefcaseBusiness,
  ChevronDown,
  FileCode,
  GitPullRequest,
  Network,
  ShieldCheck,
  Target,
  UserRound,
} from 'lucide-react';
import { useState } from 'react';

interface Example {
  input: string;
  output: string;
  explanation?: string;
}

interface IssueBody {
  title?: string | null;
  body?: string | null;
  labels?: string[];
}

interface MatchSourceRef {
  sourceRefType?: string;
  locator?: string;
  exactText?: string;
  conceptKeys?: string[];
}

interface MatchEvidence {
  roleSourceRefs?: MatchSourceRef[];
  candidateSourceRefs?: MatchSourceRef[];
  challengeSourceRefs?: MatchSourceRef[];
  pairScore?: number;
}

interface MatchEvidenceHyperedgeNode {
  kind?: 'person_evidence' | 'role_source' | 'repo_challenge' | string;
  label?: string;
  sourceRef?: MatchSourceRef;
}

interface MatchEvidenceHyperedge {
  relation?: string;
  label?: string;
  pairScore?: number;
  nodes?: MatchEvidenceHyperedgeNode[];
  stretch?: {
    atomConcept?: string;
    demandConcept?: string;
    dimension?: string;
  };
}

function hyperedgeHasRoleSource(edge: MatchEvidenceHyperedge): boolean {
  if (edge.relation === 'candidate_role_repo_alignment') return true;
  if (edge.relation === 'candidate_repo_evidence_alignment') return false;
  return (edge.nodes ?? []).some((node) => node.kind === 'role_source');
}

function hyperedgeRelationBadge(edge: MatchEvidenceHyperedge): string {
  if (hyperedgeHasRoleSource(edge)) return 'Candidate, role, and repo evidence';
  return 'Candidate and repo evidence';
}

function humanizeMatchToken(value: string | null | undefined): string {
  if (!value) return 'Check';
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanizeVerdict(value: string | null | undefined): string | null {
  if (!value) return null;
  return humanizeMatchToken(value);
}

interface MatchValidatorAgent {
  agentName?: string;
  agentVersion?: string;
  mode?: string;
  verdict?: string;
  rationale?: string;
  checks?: Array<{
    id?: string;
    passed?: boolean;
    reason?: string;
  }>;
  sourceBridge?: {
    prNumber?: number;
    candidateSourceCount?: number;
    repoSourceCount?: number;
    roleSourceCount?: number;
    alignedDemandCount?: number;
    stretchCount?: number;
    provenanceComplete?: boolean;
  };
}

interface MatchAssessmentQualityMetric {
  id?: string;
  label?: string;
  score?: number;
  maxScore?: number;
  reason?: string;
}

interface MatchAssessmentQuality {
  verdict?: string;
  score?: number;
  maxScore?: number;
  metrics?: MatchAssessmentQualityMetric[];
}

export interface CodeReviewMatchExplanation {
  status?: string;
  summary?: string;
  score?: number | null;
  assessmentQuality?: MatchAssessmentQuality;
  qualityGate?: {
    verdict?: string;
    checks?: string[];
    diagnostics?: string[];
  };
  candidateSourceCount?: number;
  repoSourceCount?: number;
  roleSourceCount?: number;
  evidence?: MatchEvidence[];
  evidenceHyperedges?: MatchEvidenceHyperedge[];
  validatorAgent?: MatchValidatorAgent;
}

interface ProblemPanelProps {
  markdown: string;
  prDescription?: string;
  issueBody?: IssueBody | null;
  matchExplanation?: CodeReviewMatchExplanation | null;
  examples?: Example[];
  constraints?: string[];
  linkedArtifact?: {
    label: string;
    code: string;
    language: string;
  };
}

function formatMatchScore(score: number | null | undefined): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'SOURCE';
  return score <= 1 ? `${Math.round(score * 100)}%` : score.toFixed(2);
}

function formatQualityMetricScore(score: number | undefined, maxScore: number | undefined): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '0/2';
  if (typeof maxScore !== 'number' || !Number.isFinite(maxScore) || maxScore <= 0) {
    return `${score}/2`;
  }
  return `${score}/${maxScore}`;
}

const MATCH_CHECK_LABELS: Record<string, string> = {
  agent_validated_match: 'Agent validated',
  assessment_quality_verified: 'Assessment quality',
  bounded_stretch: 'Bounded stretch',
  candidate_source_evidence: 'Candidate evidence',
  contrast_separation_verified: 'Contrast separation',
  eligible_match: 'Eligible match',
  provenance_complete: 'Provenance complete',
  repo_source_spans: 'Repo source spans',
  role_context_alignment: 'Role alignment',
  source_backed_manual_override: 'Manual override',
};

function formatMatchCheckLabel(checkId: string | null | undefined): string {
  if (!checkId) return 'CHECK';
  return MATCH_CHECK_LABELS[checkId] ?? humanizeMatchToken(checkId);
}

function firstSource(refs: MatchSourceRef[] | undefined): MatchSourceRef | null {
  return refs?.find((ref) => ref.exactText || ref.locator) ?? null;
}

function firstHyperedgeSource(
  hyperedges: MatchEvidenceHyperedge[],
  kind: MatchEvidenceHyperedgeNode['kind'],
): MatchSourceRef | null {
  for (const edge of hyperedges) {
    const source = (edge.nodes ?? [])
      .find((node) => node.kind === kind && (node.sourceRef?.exactText || node.sourceRef?.locator))
      ?.sourceRef;
    if (source) return source;
  }
  return null;
}

function formatHyperedgeNodeLabel(node: MatchEvidenceHyperedgeNode): string {
  const label = node.label ?? node.kind ?? 'Evidence';
  return humanizeMatchToken(label);
}

function normalizeConceptLabel(concept: string): string {
  const withoutNamespace = concept.includes(':') ? concept.split(':').at(-1) ?? concept : concept;
  return withoutNamespace.replace(/[_-]+/g, ' ').trim();
}

function collectSourceConcepts(
  evidenceRows: MatchEvidence[],
  evidenceHyperedges: MatchEvidenceHyperedge[],
): string[] {
  const concepts = new Set<string>();
  const collect = (refs: MatchSourceRef[] | undefined): void => {
    for (const ref of refs ?? []) {
      for (const concept of ref.conceptKeys ?? []) {
        const label = normalizeConceptLabel(concept);
        if (label) concepts.add(label);
      }
    }
  };

  for (const entry of evidenceRows) {
    collect(entry.candidateSourceRefs);
    collect(entry.roleSourceRefs);
    collect(entry.challengeSourceRefs);
  }

  for (const edge of evidenceHyperedges) {
    collect((edge.nodes ?? []).map((node) => node.sourceRef).filter((ref): ref is MatchSourceRef => Boolean(ref)));
  }

  return Array.from(concepts).slice(0, 8);
}

function MatchSourceSnippet({
  label,
  sourceRef,
  icon,
}: {
  label: string;
  sourceRef: MatchSourceRef | null;
  icon: JSX.Element;
}): JSX.Element | null {
  if (!sourceRef) return null;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '18px minmax(0, 1fr)',
        gap: 10,
        padding: '10px 0',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div style={{ paddingTop: 2 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 9, color: '#6cc3ff', fontFamily: 'Space Mono', fontWeight: 700, marginBottom: 4 }}>
          {label}
        </div>
        {sourceRef.exactText && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.72)', lineHeight: 1.55, wordBreak: 'break-word' }}>
            {sourceRef.exactText}
          </div>
        )}
        {sourceRef.conceptKeys && sourceRef.conceptKeys.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {sourceRef.conceptKeys.slice(0, 3).map((concept) => (
              <span
                key={concept}
                style={{
                  fontSize: 9,
                  fontFamily: 'Space Mono',
                  color: 'rgba(108,195,255,0.9)',
                  border: '1px solid rgba(108,195,255,0.18)',
                  background: 'rgba(108,195,255,0.07)',
                  borderRadius: 4,
                  padding: '2px 6px',
                  wordBreak: 'break-word',
                }}
              >
                {normalizeConceptLabel(concept)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MatchHyperedgeNodeCard({ node }: { node: MatchEvidenceHyperedgeNode }): JSX.Element | null {
  if (!node.sourceRef) return null;
  return (
    <div
      style={{
        minWidth: 0,
        padding: '9px 10px',
        background: 'rgba(12,12,14,0.3)',
        border: '1px solid rgba(255,255,255,0.065)',
        borderRadius: 5,
      }}
    >
      <div style={{ fontSize: 8, color: '#b9ddff', fontFamily: 'Space Mono', fontWeight: 700, letterSpacing: '0.1em', marginBottom: 5 }}>
        {formatHyperedgeNodeLabel(node)}
      </div>
      {node.sourceRef.exactText && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.68)', lineHeight: 1.45, wordBreak: 'break-word' }}>
          {node.sourceRef.exactText}
        </div>
      )}
      {node.sourceRef.conceptKeys && node.sourceRef.conceptKeys.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 7 }}>
          {node.sourceRef.conceptKeys.slice(0, 3).map((concept) => (
            <span
              key={concept}
              style={{
                fontSize: 8,
                color: 'rgba(185,221,255,0.9)',
                border: '1px solid rgba(185,221,255,0.16)',
                borderRadius: 4,
                padding: '2px 5px',
                fontFamily: 'Space Mono',
              }}
            >
              {normalizeConceptLabel(concept)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MatchHyperedges({ hyperedges }: { hyperedges: MatchEvidenceHyperedge[] }): JSX.Element | null {
  const visibleHyperedges = hyperedges
    .filter((edge) => Array.isArray(edge.nodes) && edge.nodes.length > 0)
    .slice(0, 3);
  if (visibleHyperedges.length === 0) return null;

  return (
    <div
      data-testid="code-review-match-hyperedges"
      style={{
        marginBottom: 14,
        padding: 12,
        background: 'rgba(185,221,255,0.04)',
        border: '1px solid rgba(185,221,255,0.12)',
        borderRadius: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 9, letterSpacing: '0.12em', color: '#b9ddff', fontFamily: 'Space Mono', fontWeight: 700 }}>
          Evidence bridges
        </div>
        <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.48)', fontFamily: 'Space Mono' }}>
          {visibleHyperedges.some((edge) => hyperedgeHasRoleSource(edge))
            ? 'Candidate, role, and repo evidence'
            : 'Candidate and repo evidence'}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {visibleHyperedges.map((edge, index) => (
          <div
            key={`${edge.label ?? edge.relation ?? 'hyperedge'}-${index}`}
            style={{
              paddingTop: index === 0 ? 0 : 10,
              borderTop: index === 0 ? 'none' : '1px solid rgba(255,255,255,0.055)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.76)', fontWeight: 700 }}>
                {edge.label ?? 'Evidence bridge'}
              </div>
              {typeof edge.pairScore === 'number' && Number.isFinite(edge.pairScore) && (
                <span style={{ fontSize: 8, color: '#b9ddff', fontFamily: 'Space Mono', border: '1px solid rgba(185,221,255,0.16)', borderRadius: 4, padding: '2px 5px' }}>
                  {formatMatchScore(edge.pairScore)}
                </span>
                          )}
                        </div>
                        <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.42)', fontFamily: 'Space Mono', marginBottom: 8 }}>
                          {hyperedgeRelationBadge(edge)}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
              {(edge.nodes ?? []).map((node, nodeIndex) => (
                <MatchHyperedgeNodeCard
                  key={`${node.kind ?? node.label ?? 'node'}-${nodeIndex}`}
                  node={node}
                />
              ))}
            </div>
            {edge.stretch && (
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', fontFamily: 'Space Mono', marginTop: 8, lineHeight: 1.45 }}>
                STRETCH {edge.stretch.atomConcept} → {edge.stretch.demandConcept} ({edge.stretch.dimension})
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function conciseSourceText(sourceRef: MatchSourceRef | null): string | null {
  const text = sourceRef?.exactText?.trim() || null;
  if (!text) return null;
  return text.length > 180 ? `${text.slice(0, 177).trim()}...` : text;
}

function matchModeLabel(
  hyperedges: MatchEvidenceHyperedge[],
  roleSource: MatchSourceRef | null,
): string {
  if (roleSource) return 'Candidate, role, and repo evidence';
  return hyperedges.some((edge) => hyperedgeHasRoleSource(edge))
    ? 'Candidate, role, and repo evidence'
    : 'Candidate and repo evidence';
}

function topicPhrase(concepts: string[]): string | null {
  const visible = concepts
    .map((concept) => concept.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (visible.length === 0) return null;
  if (visible.length === 1) return visible[0]!;
  if (visible.length === 2) return `${visible[0]} and ${visible[1]}`;
  return `${visible.slice(0, -1).join(', ')}, and ${visible.at(-1)}`;
}

function buildReadableMatchReason({
  summary,
  mode,
  quality,
  roleSource,
  candidateSource,
  repoSource,
  concepts,
}: {
  summary: string | undefined;
  mode: string;
  quality: string | null;
  roleSource: MatchSourceRef | null;
  candidateSource: MatchSourceRef | null;
  repoSource: MatchSourceRef | null;
  concepts: string[];
}): string {
  const topics = topicPhrase(concepts);
  const qualityText = quality ? `${quality.toLowerCase()} ` : '';

  if (/manual override/i.test(summary ?? '')) {
    return `A recruiter selected this PR, and PIPE verified it as a ${qualityText}source-backed review packet. This path validates reviewability without claiming CV fit.`;
  }

  if (mode === 'Candidate, role, and repo evidence' && candidateSource && roleSource && repoSource) {
    return topics
      ? `We selected this PR because the source evidence points at ${topics}, and this PR asks you to review that same engineering surface.`
      : 'We selected this PR because your profile evidence, the role context, and the PR all point at the same reviewable engineering decision.';
  }

  if (candidateSource && repoSource) {
    return topics
      ? `We selected this PR because the source evidence points at ${topics}, and this PR asks you to review those decisions in real code.`
      : 'We selected this PR because your profile evidence maps to a concrete, source-backed review decision in this PR.';
  }

  if (repoSource) {
    return 'This PR was selected because PIPE has a source-backed review packet for a concrete engineering decision in the repository.';
  }

  return summary ?? 'PIPE selected this PR from source-backed matching evidence and validated it before assigning the assessment.';
}

function WhyThisPrSource({
  label,
  sourceRef,
  icon,
}: {
  label: string;
  sourceRef: MatchSourceRef | null;
  icon: JSX.Element;
}): JSX.Element | null {
  const text = conciseSourceText(sourceRef);
  if (!text) return null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '16px minmax(0, 1fr)',
        gap: 9,
        padding: '9px 0',
        borderTop: '1px solid rgba(185,221,255,0.08)',
      }}
    >
      <div style={{ paddingTop: 2 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 9, color: '#b9ddff', fontFamily: 'Space Mono', fontWeight: 700, marginBottom: 4 }}>
          {label}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.74)', lineHeight: 1.45, wordBreak: 'break-word' }}>
          {text}
        </div>
      </div>
    </div>
  );
}

function WhyThisPrPanel({
  summary,
  roleSource,
  candidateSource,
  repoSource,
  assessmentQuality,
  evidenceHyperedges,
  concepts,
}: {
  summary: string | undefined;
  roleSource: MatchSourceRef | null;
  candidateSource: MatchSourceRef | null;
  repoSource: MatchSourceRef | null;
  assessmentQuality: MatchAssessmentQuality | undefined;
  evidenceHyperedges: MatchEvidenceHyperedge[];
  concepts: string[];
}): JSX.Element | null {
  const hasAnySource = Boolean(candidateSource?.exactText || roleSource?.exactText || repoSource?.exactText);
  if (!hasAnySource && !summary) return null;

  const mode = matchModeLabel(evidenceHyperedges, roleSource);
  const quality = humanizeVerdict(assessmentQuality?.verdict) ?? null;
  const readableReason = buildReadableMatchReason({
    summary,
    mode,
    quality,
    roleSource,
    candidateSource,
    repoSource,
    concepts,
  });

  return (
    <div
      data-testid="code-review-match-why"
      style={{
        marginBottom: 14,
        padding: 13,
        background: 'rgba(12,12,14,0.28)',
        border: '1px solid rgba(185,221,255,0.14)',
        borderRadius: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 9, letterSpacing: '0.12em', color: '#b9ddff', fontFamily: 'Space Mono', fontWeight: 700 }}>
          Why this pull request
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 8, color: '#b9ddff', border: '1px solid rgba(185,221,255,0.18)', borderRadius: 4, padding: '3px 6px', fontFamily: 'Space Mono', fontWeight: 700 }}>
            {mode}
          </span>
          {quality && (
            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.72)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '3px 6px', fontFamily: 'Space Mono' }}>
              {quality}
            </span>
          )}
        </div>
      </div>

      <div
        data-testid="code-review-match-readable-reason"
        style={{
          display: 'grid',
          gap: 8,
          marginBottom: hasAnySource || concepts.length > 0 || !roleSource ? 10 : 0,
          padding: 10,
          background: 'rgba(108,195,255,0.055)',
          border: '1px solid rgba(108,195,255,0.11)',
          borderRadius: 5,
        }}
      >
        <div style={{ fontSize: 9, letterSpacing: '0.12em', color: '#6cc3ff', fontFamily: 'Space Mono', fontWeight: 700 }}>
          Selection reason
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.84)', lineHeight: 1.5 }}>
          {readableReason}
        </div>
        {concepts.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {concepts.slice(0, 4).map((concept) => (
              <span
                key={concept}
                style={{
                  fontSize: 8,
                  color: 'rgba(216,235,255,0.86)',
                  border: '1px solid rgba(108,195,255,0.16)',
                  background: 'rgba(108,195,255,0.055)',
                  borderRadius: 4,
                  padding: '3px 6px',
                  fontFamily: 'Space Mono',
                  wordBreak: 'break-word',
                }}
              >
                {concept}
              </span>
            ))}
          </div>
        )}
      </div>

      <WhyThisPrSource
        label="Candidate evidence"
        sourceRef={candidateSource}
        icon={<UserRound size={12} color="rgba(185,221,255,0.8)" />}
      />
      <WhyThisPrSource
        label="Role requirement"
        sourceRef={roleSource}
        icon={<BriefcaseBusiness size={12} color="rgba(185,221,255,0.8)" />}
      />
      <WhyThisPrSource
        label="Repo challenge"
        sourceRef={repoSource}
        icon={<FileCode size={12} color="rgba(185,221,255,0.8)" />}
      />

      {!roleSource && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.48)', lineHeight: 1.45, marginTop: hasAnySource ? 8 : 0 }}>
          Role context was not supplied for this standalone assessment.
        </div>
      )}
    </div>
  );
}

function AssessmentFocusPanel({
  metrics,
  concepts,
}: {
  metrics: MatchAssessmentQualityMetric[];
  concepts: string[];
}): JSX.Element | null {
  const focusMetrics = metrics
    .filter((metric) => metric.label || metric.reason)
    .slice(0, 3);
  if (focusMetrics.length === 0 && concepts.length === 0) return null;

  return (
    <div
      data-testid="code-review-assessment-focus"
      style={{
        marginBottom: 14,
        padding: 12,
        background: 'rgba(52,211,153,0.045)',
        border: '1px solid rgba(52,211,153,0.13)',
        borderRadius: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: focusMetrics.length > 0 || concepts.length > 0 ? 10 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <Target size={12} color="#4ade80" />
          <div style={{ fontSize: 9, letterSpacing: '0.12em', color: '#4ade80', fontFamily: 'Space Mono', fontWeight: 700 }}>
            Assessment focus
          </div>
        </div>
        {concepts.length > 0 && (
          <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.58)', fontFamily: 'Space Mono', whiteSpace: 'nowrap' }}>
            Source topics
          </span>
        )}
      </div>

      {focusMetrics.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          {focusMetrics.map((metric) => (
            <div
              key={metric.id ?? metric.label ?? metric.reason ?? 'assessment-focus'}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                gap: 10,
                alignItems: 'start',
                paddingTop: 8,
                borderTop: '1px solid rgba(255,255,255,0.055)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.78)', lineHeight: 1.35, fontWeight: 700 }}>
                  {metric.label ?? formatMatchCheckLabel(metric.id)}
                </div>
                {metric.reason && (
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.48)', lineHeight: 1.45, marginTop: 2 }}>
                    {metric.reason}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 9, color: '#4ade80', fontFamily: 'Space Mono', border: '1px solid rgba(74,222,128,0.18)', borderRadius: 4, padding: '2px 5px', whiteSpace: 'nowrap' }}>
                {formatQualityMetricScore(metric.score, metric.maxScore)}
              </span>
            </div>
          ))}
        </div>
      )}

      {concepts.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: focusMetrics.length > 0 ? 10 : 0 }}>
          {concepts.map((concept) => (
            <span
              key={concept}
              style={{
                fontSize: 8,
                color: 'rgba(216,255,235,0.84)',
                border: '1px solid rgba(74,222,128,0.14)',
                background: 'rgba(74,222,128,0.055)',
                borderRadius: 4,
                padding: '3px 6px',
                fontFamily: 'Space Mono',
                wordBreak: 'break-word',
              }}
            >
              {concept}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function MatchProofPanel({ matchExplanation }: { matchExplanation: CodeReviewMatchExplanation }): JSX.Element {
  const evidenceRows = Array.isArray(matchExplanation.evidence) ? matchExplanation.evidence : [];
  const evidenceHyperedges = matchExplanation.evidenceHyperedges ?? [];
  const roleSource = firstSource(evidenceRows.flatMap((entry) => entry.roleSourceRefs ?? []))
    ?? firstHyperedgeSource(evidenceHyperedges, 'role_source');
  const candidateSource = firstSource(evidenceRows.flatMap((entry) => entry.candidateSourceRefs ?? []))
    ?? firstHyperedgeSource(evidenceHyperedges, 'person_evidence');
  const repoSource = firstSource(evidenceRows.flatMap((entry) => entry.challengeSourceRefs ?? []))
    ?? firstHyperedgeSource(evidenceHyperedges, 'repo_challenge');
  const hasSourceBridge = Boolean(roleSource || candidateSource || repoSource);
  const checks = matchExplanation.qualityGate?.checks ?? [];
  const diagnostics = matchExplanation.qualityGate?.diagnostics ?? [];
  const verdict = humanizeVerdict(matchExplanation.qualityGate?.verdict ?? matchExplanation.status ?? 'SOURCE_BACKED');
  const validatorAgent = matchExplanation.validatorAgent;
  const validatorChecks = validatorAgent?.checks ?? [];
  const assessmentQuality = matchExplanation.assessmentQuality;
  const assessmentMetrics = assessmentQuality?.metrics ?? [];
  const sourceConcepts = collectSourceConcepts(evidenceRows, evidenceHyperedges);

  return (
    <section
      data-testid="code-review-match-proof"
      style={{
        marginBottom: 32,
        padding: 18,
        background: 'linear-gradient(180deg, rgba(108,195,255,0.12), rgba(255,255,255,0.035))',
        border: '1px solid rgba(108,195,255,0.24)',
        borderRadius: 8,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          <Network size={15} color="#6cc3ff" />
          <div style={{ fontSize: 9, letterSpacing: '0.14em', color: '#6cc3ff', fontFamily: 'Space Mono', fontWeight: 700 }}>
            Source-backed match
          </div>
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            border: '1px solid rgba(52,211,153,0.24)',
            background: 'rgba(52,211,153,0.08)',
            color: '#34d399',
            borderRadius: 4,
            padding: '4px 7px',
            fontSize: 9,
            fontFamily: 'Space Mono',
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          <ShieldCheck size={11} />
          {verdict}
        </div>
      </div>

      <WhyThisPrPanel
        summary={matchExplanation.summary}
        roleSource={roleSource}
        candidateSource={candidateSource}
        repoSource={repoSource}
        assessmentQuality={assessmentQuality}
        evidenceHyperedges={evidenceHyperedges}
        concepts={sourceConcepts}
      />

      <AssessmentFocusPanel
        metrics={assessmentMetrics}
        concepts={sourceConcepts}
      />

      {matchExplanation.summary && (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', lineHeight: 1.55, marginBottom: 14 }}>
          {matchExplanation.summary}
        </div>
      )}

      {assessmentQuality && (
        <div
          data-testid="code-review-assessment-quality"
          style={{
            marginBottom: 14,
            padding: 12,
            background: 'rgba(185,221,255,0.045)',
            border: '1px solid rgba(185,221,255,0.12)',
            borderRadius: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: assessmentMetrics.length > 0 ? 10 : 0 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.12em', color: '#b9ddff', fontFamily: 'Space Mono', fontWeight: 700 }}>
              Assessment quality
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {assessmentQuality.verdict && (
                <span style={{ fontSize: 8, color: '#b9ddff', border: '1px solid rgba(185,221,255,0.18)', borderRadius: 4, padding: '3px 6px', fontFamily: 'Space Mono', fontWeight: 700 }}>
                  {humanizeVerdict(assessmentQuality.verdict)}
                </span>
              )}
              <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.68)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '3px 6px', fontFamily: 'Space Mono' }}>
                {formatQualityMetricScore(assessmentQuality.score, assessmentQuality.maxScore)}
              </span>
            </div>
          </div>
          {assessmentMetrics.length > 0 && (
            <div style={{ display: 'grid', gap: 7 }}>
              {assessmentMetrics.map((metric) => (
                <div
                  key={metric.id ?? metric.label ?? metric.reason ?? 'quality-metric'}
                  title={metric.reason}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                    gap: 10,
                    alignItems: 'start',
                    paddingTop: 7,
                    borderTop: '1px solid rgba(255,255,255,0.055)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.74)', lineHeight: 1.35 }}>
                      {metric.label ?? formatMatchCheckLabel(metric.id)}
                    </div>
                    {metric.reason && (
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.42)', lineHeight: 1.45, marginTop: 2 }}>
                        {metric.reason}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 9, color: '#b9ddff', fontFamily: 'Space Mono', border: '1px solid rgba(185,221,255,0.16)', borderRadius: 4, padding: '2px 5px', whiteSpace: 'nowrap' }}>
                    {formatQualityMetricScore(metric.score, metric.maxScore)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {validatorAgent && (
        <div
          data-testid="code-review-match-validator"
          style={{
            marginBottom: 14,
            padding: 12,
            background: 'rgba(12,12,14,0.34)',
            border: '1px solid rgba(108,195,255,0.14)',
            borderRadius: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: validatorAgent.rationale ? 8 : 0 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.12em', color: '#6cc3ff', fontFamily: 'Space Mono', fontWeight: 700 }}>
              VALIDATOR_AGENT
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 }}>
              {validatorAgent.mode && (
                <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.62)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '3px 6px', fontFamily: 'Space Mono' }}>
                  {validatorAgent.mode}
                </span>
              )}
              {validatorAgent.verdict && (
                <span style={{ fontSize: 8, color: '#34d399', border: '1px solid rgba(52,211,153,0.22)', background: 'rgba(52,211,153,0.08)', borderRadius: 4, padding: '3px 6px', fontFamily: 'Space Mono', fontWeight: 700 }}>
                  {humanizeVerdict(validatorAgent.verdict)}
                </span>
              )}
            </div>
          </div>
          {validatorAgent.rationale && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.72)', lineHeight: 1.5, marginBottom: validatorChecks.length > 0 ? 10 : 0 }}>
              {validatorAgent.rationale}
            </div>
          )}
          {validatorChecks.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {validatorChecks.map((check) => (
                <span
                  key={check.id ?? check.reason ?? 'validator-check'}
                  title={check.reason}
                  style={{
                    fontSize: 8,
                    fontFamily: 'Space Mono',
                    color: check.passed ? 'rgba(255,255,255,0.7)' : '#fca5a5',
                    border: check.passed ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(248,113,113,0.28)',
                    borderRadius: 4,
                    padding: '3px 6px',
                    wordBreak: 'break-word',
                  }}
                >
                  {formatMatchCheckLabel(check.id)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 8,
          marginBottom: 14,
        }}
      >
        {[
          ['Score', formatMatchScore(matchExplanation.score)],
          ['Person', String(matchExplanation.candidateSourceCount ?? 0)],
          ['Repo', String(matchExplanation.repoSourceCount ?? 0)],
          ['Role', String(matchExplanation.roleSourceCount ?? 0)],
        ].map(([label, value]) => (
          <div key={label} style={{ padding: '8px 6px', background: 'rgba(12,12,14,0.35)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 5 }}>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', fontFamily: 'Space Mono', marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 12, color: '#fff', fontFamily: 'Space Mono', fontWeight: 700 }}>{value}</div>
          </div>
        ))}
      </div>

      {checks.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: diagnostics.length > 0 || hasSourceBridge ? 10 : 0 }}>
          {checks.map((check) => (
            <span
              key={check}
              style={{
                fontSize: 8,
                fontFamily: 'Space Mono',
                color: 'rgba(255,255,255,0.62)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 4,
                padding: '3px 6px',
                wordBreak: 'break-word',
              }}
            >
              {formatMatchCheckLabel(check)}
            </span>
          ))}
        </div>
      )}
      {diagnostics.length > 0 && (
        <div
          data-testid="code-review-match-diagnostics"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginBottom: hasSourceBridge ? 10 : 0,
          }}
        >
          {diagnostics.map((diagnostic) => (
            <span
              key={diagnostic}
              style={{
                fontSize: 8,
                fontFamily: 'Space Mono',
                color: '#fbbf24',
                border: '1px solid rgba(251,191,36,0.24)',
                background: 'rgba(251,191,36,0.08)',
                borderRadius: 4,
                padding: '3px 6px',
                wordBreak: 'break-word',
              }}
            >
              {formatMatchCheckLabel(diagnostic)}
            </span>
          ))}
        </div>
      )}

      <MatchHyperedges hyperedges={evidenceHyperedges} />

      {hasSourceBridge && (
        <div>
          <MatchSourceSnippet
            label="Role source"
            sourceRef={roleSource}
            icon={<BriefcaseBusiness size={13} color="rgba(108,195,255,0.8)" />}
          />
          <MatchSourceSnippet
            label="Person evidence"
            sourceRef={candidateSource}
            icon={<UserRound size={13} color="rgba(108,195,255,0.8)" />}
          />
          <MatchSourceSnippet
            label="Repo challenge"
            sourceRef={repoSource}
            icon={<GitPullRequest size={13} color="rgba(108,195,255,0.8)" />}
          />
        </div>
      )}
    </section>
  );
}

/**
 * ProblemPanel - Displays the challenge description, examples, and constraints.
 */
export function ProblemPanel({
  markdown,
  prDescription,
  issueBody,
  matchExplanation,
  examples,
  constraints,
  linkedArtifact
}: ProblemPanelProps): JSX.Element {
  const [isArtifactOpen, setIsArtifactOpen] = useState(false);

  return (
    <div style={{ padding: '32px', color: 'var(--pipe-text, #fff)', fontSize: 15, lineHeight: 1.6 }}>
      {matchExplanation && (
        <MatchProofPanel matchExplanation={matchExplanation} />
      )}

      {/* PR Description Section */}
      {prDescription && (
        <div style={{ marginBottom: 40, padding: 24, background: 'rgba(96, 165, 250, 0.05)', border: '1px solid rgba(96, 165, 250, 0.1)', borderRadius: 8 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.1em', color: '#60a5fa', marginBottom: 12, fontFamily: 'Space Mono', fontWeight: 700 }}>
            Pull request description
          </div>
          <div style={{ maxWidth: 'none', fontSize: 14 }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {prDescription}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Issue Body Section */}
      {issueBody && (issueBody.title || issueBody.body) && (
        <div style={{ marginBottom: 40, padding: 24, background: 'rgba(74, 222, 128, 0.05)', border: '1px solid rgba(74, 222, 128, 0.12)', borderRadius: 8 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.1em', color: '#4ade80', marginBottom: 12, fontFamily: 'Space Mono', fontWeight: 700 }}>
            Linked issue
          </div>
          {issueBody.title && (
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, fontFamily: 'Space Mono' }}>
              {issueBody.title}
            </div>
          )}
          {issueBody.body && (
            <div style={{ maxWidth: 'none', fontSize: 14 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {issueBody.body}
              </ReactMarkdown>
            </div>
          )}
          {issueBody.labels && issueBody.labels.length > 0 && (
            <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {issueBody.labels.map((label, i) => (
                <span key={i} style={{ fontSize: 10, padding: '2px 8px', background: 'rgba(74, 222, 128, 0.1)', border: '1px solid rgba(74, 222, 128, 0.2)', borderRadius: 3, color: '#4ade80', fontFamily: 'Space Mono' }}>
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Markdown Content */}
      <div style={{ maxWidth: 'none' }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {markdown}
        </ReactMarkdown>
      </div>

      {/* Examples Section */}
      {examples && examples.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <h3 style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--pipe-text-dim)', marginBottom: 16, fontFamily: 'Space Mono' }}>
            EXAMPLES
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {examples.map((ex, i) => (
              <div key={i} style={{ background: 'var(--pipe-surface)', border: '1px solid var(--pipe-border)', borderRadius: 4, padding: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 12, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>INPUT</span>
                  <code style={{ fontSize: 13, color: '#60a5fa', fontFamily: 'Space Mono' }}>{ex.input}</code>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 12 }}>
                  <span style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>OUTPUT</span>
                  <code style={{ fontSize: 13, color: '#34d399', fontFamily: 'Space Mono' }}>{ex.output}</code>
                </div>
                {ex.explanation && (
                  <p style={{ marginTop: 12, fontSize: 12, color: 'var(--pipe-text-dim)', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
                    {ex.explanation}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Constraints Section */}
      {constraints && constraints.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <h3 style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--pipe-text-dim)', marginBottom: 16, fontFamily: 'Space Mono' }}>
            Constraints
          </h3>
          <ul style={{ paddingLeft: 16, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {constraints.map((c, i) => (
              <li key={i} style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Linked Artifact */}
      {linkedArtifact && (
        <div style={{ marginTop: 40, borderTop: '1px solid var(--pipe-border)', paddingTop: 24 }}>
          <button 
            onClick={() => setIsArtifactOpen(!isArtifactOpen)}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 12, 
              background: 'none', 
              border: 'none', 
              color: 'var(--pipe-text, #fff)', 
              fontSize: 12, 
              fontWeight: 700, 
              cursor: 'pointer',
              padding: 0,
              fontFamily: 'Space Mono'
            }}
          >
            <FileCode size={16} color="#60a5fa" />
            {linkedArtifact.label}
            <ChevronDown size={14} style={{ transform: isArtifactOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>

          {isArtifactOpen && (
            <div style={{ marginTop: 16, background: '#000', borderRadius: 4, padding: 16, border: '1px solid var(--pipe-border)' }}>
              <pre style={{ margin: 0, fontSize: 12, color: 'var(--pipe-text-muted)', fontFamily: 'Space Mono', overflowX: 'auto' }}>
                {linkedArtifact.code}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
