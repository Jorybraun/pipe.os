import type { CSSProperties, ReactNode } from 'react';
import { FileText } from 'lucide-react';
import type { AssessmentProgressSnapshot } from '../../lib/scheduling/types';
import {
  RECRUITER_FONT,
  recruiterFieldLabelStyle,
  recruiterFieldValueStyle,
  recruiterInlineLinkStyle,
  recruiterSectionStyle,
  recruiterSectionTitleStyle,
  recruiterTagStyle,
} from '../../styles/recruiterSurface';

export type CodeReviewReportTone = 'positive' | 'watch' | 'blocked' | 'neutral';

/**
 * Structural subset of the page-level CodeReviewDecisionProjection.
 * The report is a read-only projection of the living context graph;
 * it renders existing decision data and never invents new signal.
 */
export interface CodeReviewReportDecision {
  recommendation: string;
  recommendationDetail: string;
  uncertainty: string;
  uncertaintyDetail: string;
  missingContext: string[];
  assessmentValidity: string;
  assessmentValidityDetail: string;
  nextAction: string;
  nextActionDetail: string;
  scoreLabel: string | null;
  challengeLabel: string;
  challengeUrl: string | null;
  narrative: string;
  proofItems: Array<{ id: string; label: string; text: string }>;
  basisItems: Array<{ label: string; value: string; satisfied: boolean }>;
}

export interface CodeReviewReportDefenseExchange {
  actor: 'candidate' | 'ai_developer';
  round: number | null;
  move: string | null;
  content: string;
}

export interface CodeReviewReportDefenseThread {
  commentId: string;
  file: string;
  line: number | null;
  severity: string | null;
  comment: string;
  exchanges: CodeReviewReportDefenseExchange[];
}

export interface CodeReviewAssessmentReportProps {
  decision: CodeReviewReportDecision;
  outcome: string;
  nextStepTone: CodeReviewReportTone;
  validityTone: CodeReviewReportTone;
  progress: AssessmentProgressSnapshot | null;
  defenseThreads: CodeReviewReportDefenseThread[];
  decisionFormSlot?: ReactNode;
}

function evaluationRecommendationLabel(recommendation: string | null | undefined): string | null {
  if (!recommendation) return null;
  switch (recommendation) {
    case 'strong_evidence_to_advance':
      return 'Strong evidence to advance';
    case 'mixed_evidence_human_review':
      return 'Human review needed';
    case 'insufficient_evidence':
      return 'Insufficient evidence';
    case 'not_demonstrated':
      return 'Not demonstrated';
    default:
      return 'Unvalidated recommendation';
  }
}

function humanDecisionLabel(decision: string): string {
  switch (decision) {
    case 'advance':
      return 'Advance';
    case 'hold':
      return 'Hold';
    case 'reject':
      return 'Reject';
    case 'needs_more_evidence':
      return 'Needs more evidence';
    default:
      return decision.replace(/[_-]+/g, ' ');
  }
}

function claimPolarityLabel(polarity: string): string {
  switch (polarity) {
    case 'positive':
      return 'Strength';
    case 'negative':
      return 'Risk';
    case 'diagnostic':
      return 'Diagnostic';
    default:
      return polarity.replace(/[_-]+/g, ' ');
  }
}

function claimConfidenceLabel(confidence: number | null | undefined): string | null {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  return `${Math.round(confidence * 100)}% confidence`;
}

function readableToken(value: string): string {
  const words = value.toLowerCase().split(/[_-]+/).filter(Boolean);
  return words
    .map((word, index) => (index === 0 ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word))
    .join(' ');
}

function sourceRefCount(progress: AssessmentProgressSnapshot | null, kind: string): number {
  return progress?.sourceRefCounts.find((entry) => entry.kind === kind)?.count ?? 0;
}

function pluralCount(count: number, singular: string, plural?: string): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? singular : plural ?? `${singular}s`}`;
}

function readableList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

interface AiUseReadout {
  value: string;
  detail: string;
}

function aiUseReadout(progress: AssessmentProgressSnapshot | null): AiUseReadout {
  const promptCount = sourceRefCount(progress, 'ai_user_prompt');
  const blockedPromptCount = sourceRefCount(progress, 'ai_user_prompt_blocked');
  const responseCount = sourceRefCount(progress, 'ai_agent_response') + sourceRefCount(progress, 'agent_response');
  const diagnosticCount = sourceRefCount(progress, 'ai_agent_diagnostic') + sourceRefCount(progress, 'agent_diagnostic');
  const statusCount = sourceRefCount(progress, 'agent_status');
  const evidenceParts = [
    pluralCount(promptCount, 'prompt'),
    pluralCount(blockedPromptCount, 'blocked prompt'),
    pluralCount(responseCount, 'agent response'),
    pluralCount(diagnosticCount, 'bridge diagnostic'),
    pluralCount(statusCount, 'bridge status', 'bridge statuses'),
  ].filter((part): part is string => Boolean(part));
  const hasAssistanceEvidence = promptCount + blockedPromptCount + responseCount > 0;
  const hasBridgeEvidence = Boolean(progress?.hasAiInteraction) || evidenceParts.length > 0;
  return {
    value: hasAssistanceEvidence
      ? 'AI use observed'
      : hasBridgeEvidence
        ? 'AI bridge observed'
        : 'No AI evidence captured',
    detail: hasBridgeEvidence
      ? evidenceParts.length > 0
        ? `${readableList(evidenceParts)} captured from the real agent bridge.`
        : 'AI prompts, responses, or bridge traces are part of the source-backed evidence trail.'
      : 'No candidate AI-assistance evidence is attached; treat AI use as unobserved, not absent.',
  };
}

export function CodeReviewAssessmentReport({
  decision,
  outcome,
  nextStepTone,
  validityTone,
  progress,
  defenseThreads,
  decisionFormSlot,
}: CodeReviewAssessmentReportProps): JSX.Element {
  const evaluation = progress?.evaluation ?? null;
  const recommendationValue = evaluationRecommendationLabel(evaluation?.recommendation) ?? decision.recommendation;
  const recommendationDetail = evaluation?.recommendation
    ? evaluation.summary || decision.recommendationDetail
    : decision.recommendationDetail;
  const recommendationTone: CodeReviewReportTone = evaluation?.recommendation === 'strong_evidence_to_advance'
    ? 'positive'
    : evaluation?.recommendation
      ? 'watch'
      : nextStepTone;
  const claims = (evaluation?.claims ?? [])
    .filter((claim) => claim.sourceRefCount > 0)
    .slice(0, 5);
  const diagnostics = (evaluation?.diagnostics ?? []).slice(0, 3);
  const aiUse = aiUseReadout(progress);
  const humanDecision = progress?.humanDecision ?? null;

  return (
    <section data-testid="interview-code-review-assessment-report" style={REPORT_SECTION}>
      <div style={REPORT_TITLE}>
        <FileText size={15} />
        Assessment report
      </div>
      <div style={REPORT_LEDE}>
        One readout for this code review: the recommendation, the evidence behind it, and the
        risks that still need a human call. Everything below is backed by captured evidence.
      </div>
      <div style={REPORT_BODY}>
        <div data-testid="assessment-report-recommendation" style={{ ...REPORT_CARD, ...REPORT_TONE[recommendationTone] }}>
          <div style={CARD_LABEL}>Recommendation</div>
          <div style={CARD_HEADLINE}>{recommendationValue}</div>
          <div style={CARD_DETAIL}>{recommendationDetail}</div>
          <div style={CHIP_ROW}>
            <span style={CHIP}>Review outcome: {outcome}</span>
            {decision.scoreLabel && <span style={CHIP}>Score: {decision.scoreLabel}</span>}
            <span style={{ ...CHIP, ...REPORT_TONE[validityTone] }}>
              Score validity: {decision.assessmentValidity}
            </span>
          </div>
        </div>

        <div data-testid="assessment-report-evidence" style={REPORT_CARD}>
          <div style={CARD_LABEL}>Evidence summary</div>
          {claims.length > 0 ? (
            <div style={CLAIM_LIST}>
              {claims.map((claim) => (
                <div key={claim.id} style={CLAIM_ROW}>
                  <div style={CLAIM_HEAD}>
                    <span>{claimPolarityLabel(claim.polarity)}</span>
                    <span>{readableToken(claim.dimension)}</span>
                    {claimConfidenceLabel(claim.confidence) && (
                      <span>{claimConfidenceLabel(claim.confidence)}</span>
                    )}
                  </div>
                  <div style={CARD_DETAIL}>{claim.narrative}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={CARD_DETAIL}>
              No evidence-backed claims yet. The evaluator report appears after the candidate
              submits their review.
            </div>
          )}
          {decision.basisItems.length > 0 && (
            <div style={CHECKLIST}>
              <div style={CARD_LABEL}>Proof checklist</div>
              {decision.basisItems.map((item) => (
                <div key={item.label} style={CHECKLIST_ROW}>
                  <span style={item.satisfied ? CHECK_OK : CHECK_PENDING}>
                    {item.satisfied ? '\u2713' : '\u00b7'}
                  </span>
                  <span style={CHECKLIST_TEXT}>
                    <strong>{item.label}</strong> — {item.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div data-testid="assessment-report-risks" style={REPORT_CARD}>
          <div style={CARD_LABEL}>Risks &amp; uncertainty</div>
          <div style={CARD_VALUE}>{decision.uncertainty}</div>
          <div style={CARD_DETAIL}>{decision.uncertaintyDetail}</div>
          {decision.missingContext.length > 0 && (
            <div style={CHECKLIST}>
              <div style={CARD_LABEL}>Missing context</div>
              <ul style={RISK_LIST}>
                {decision.missingContext.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {diagnostics.length > 0 && (
            <div style={CHECKLIST}>
              <div style={CARD_LABEL}>Evaluator cautions</div>
              <ul style={RISK_LIST}>
                {diagnostics.map((diagnostic) => (
                  <li key={diagnostic.id}>
                    {readableToken(diagnostic.severity)}: {diagnostic.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div data-testid="assessment-report-ai-use" style={REPORT_CARD}>
          <div style={CARD_LABEL}>AI use</div>
          <div style={CARD_VALUE}>{aiUse.value}</div>
          <div style={CARD_DETAIL}>{aiUse.detail}</div>
        </div>

        <div data-testid="assessment-report-next-action" style={{ ...REPORT_CARD, ...REPORT_TONE[nextStepTone] }}>
          <div style={CARD_LABEL}>Next action</div>
          <div style={CARD_VALUE}>{decision.nextAction}</div>
          <div style={CARD_DETAIL}>{decision.nextActionDetail}</div>
          {humanDecision && (
            <div style={CARD_DETAIL}>
              <strong>Human decision recorded: {humanDecisionLabel(humanDecision.decision)}.</strong>{' '}
              {humanDecision.summary}
            </div>
          )}
          {decisionFormSlot}
        </div>

        <details data-testid="assessment-report-audit-trail" style={AUDIT_DETAILS}>
          <summary style={AUDIT_SUMMARY}>
            Audit trail
            <span style={AUDIT_HINT}>
              Provenance for this assignment and the reviewer &harr; implementation-author
              interaction. Expand for the full trail.
            </span>
          </summary>
          <div style={AUDIT_BODY}>
            <div style={AUDIT_ROW}>
              <span style={CARD_LABEL}>Assignment</span>
              {decision.challengeUrl ? (
                <a href={decision.challengeUrl} target="_blank" rel="noopener noreferrer" style={recruiterInlineLinkStyle}>
                  {decision.challengeLabel}
                </a>
              ) : (
                <span style={CARD_DETAIL}>{decision.challengeLabel}</span>
              )}
            </div>
            {decision.proofItems.map((item) => (
              <div key={item.id} style={AUDIT_ROW}>
                <span style={CARD_LABEL}>{item.label}</span>
                <span style={CARD_DETAIL}>{item.text}</span>
              </div>
            ))}
            {defenseThreads.length > 0 ? (
              <div style={AUDIT_THREADS}>
                <div style={CARD_LABEL}>Reviewer interaction</div>
                {defenseThreads.slice(0, 4).map((thread) => (
                  <div key={thread.commentId} style={AUDIT_THREAD}>
                    <div style={THREAD_META}>
                      Candidate comment
                      {thread.line !== null ? ` · line ${thread.line}` : ''}
                      {thread.severity ? ` · ${thread.severity}` : ''}
                    </div>
                    <div style={CARD_DETAIL}>{thread.comment}</div>
                    {thread.exchanges.map((exchange, index) => (
                      <div
                        key={`${thread.commentId}:${exchange.actor}:${exchange.round ?? 'x'}:${index}`}
                        style={exchange.actor === 'ai_developer' ? THREAD_REPLY_AI : THREAD_REPLY_CANDIDATE}
                      >
                        <div style={THREAD_META}>
                          {exchange.actor === 'ai_developer' ? 'Implementation author' : 'Candidate defense'}
                          {exchange.round !== null ? ` · round ${exchange.round}` : ''}
                        </div>
                        <div style={CARD_DETAIL}>{exchange.content}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div style={CARD_DETAIL}>No implementation-author replies captured yet.</div>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}

const REPORT_SECTION: CSSProperties = {
  ...recruiterSectionStyle,
  order: -50,
  gridColumn: '1 / -1',
  borderColor: 'var(--pipe-accent-border)',
  boxShadow: '0 18px 42px var(--pipe-shadow)',
};

const REPORT_TITLE: CSSProperties = {
  ...recruiterSectionTitleStyle,
  marginBottom: 6,
};

const REPORT_LEDE: CSSProperties = {
  marginBottom: 14,
  color: 'var(--pipe-text-dim)',
  fontFamily: RECRUITER_FONT,
  fontSize: 11,
  lineHeight: 1.6,
  maxWidth: 880,
};

const REPORT_BODY: CSSProperties = {
  display: 'grid',
  gap: 10,
  minWidth: 0,
};

const REPORT_CARD: CSSProperties = {
  display: 'grid',
  gap: 7,
  alignContent: 'start',
  minWidth: 0,
  padding: 12,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'var(--pipe-surface)',
};

const REPORT_TONE: Record<CodeReviewReportTone, CSSProperties> = {
  positive: {
    borderColor: 'rgba(74,222,128,0.32)',
    background: 'rgba(74,222,128,0.08)',
  },
  watch: {
    borderColor: 'rgba(251,191,36,0.36)',
    background: 'rgba(251,191,36,0.08)',
  },
  blocked: {
    borderColor: 'rgba(248,113,113,0.36)',
    background: 'rgba(248,113,113,0.08)',
  },
  neutral: {},
};

const CARD_LABEL: CSSProperties = {
  ...recruiterFieldLabelStyle,
  marginBottom: 0,
};

const CARD_HEADLINE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontFamily: RECRUITER_FONT,
  fontSize: 17,
  fontWeight: 800,
  lineHeight: 1.2,
  overflowWrap: 'anywhere',
};

const CARD_VALUE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontFamily: RECRUITER_FONT,
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1.35,
  overflowWrap: 'anywhere',
};

const CARD_DETAIL: CSSProperties = {
  ...recruiterFieldValueStyle,
  color: 'var(--pipe-text-dim)',
  fontSize: 12,
  lineHeight: 1.55,
};

const CHIP_ROW: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginTop: 2,
};

const CHIP: CSSProperties = {
  ...recruiterTagStyle,
};

const CLAIM_LIST: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const CLAIM_ROW: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '8px 10px',
  border: '1px solid var(--pipe-border-light)',
  borderRadius: 6,
  background: 'var(--pipe-surface-solid)',
};

const CLAIM_HEAD: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  color: 'var(--pipe-text)',
  fontFamily: RECRUITER_FONT,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const CHECKLIST: CSSProperties = {
  display: 'grid',
  gap: 5,
  marginTop: 4,
};

const CHECKLIST_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
};

const CHECK_OK: CSSProperties = {
  color: '#4ade80',
  fontFamily: RECRUITER_FONT,
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1.55,
};

const CHECK_PENDING: CSSProperties = {
  color: 'var(--pipe-text-dim)',
  fontFamily: RECRUITER_FONT,
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1.55,
};

const CHECKLIST_TEXT: CSSProperties = {
  ...recruiterFieldValueStyle,
  color: 'var(--pipe-text-dim)',
  fontSize: 12,
  lineHeight: 1.55,
};

const RISK_LIST: CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: 'var(--pipe-text-dim)',
  fontSize: 12,
  lineHeight: 1.55,
};

const AUDIT_DETAILS: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: 12,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'var(--pipe-surface)',
};

const AUDIT_SUMMARY: CSSProperties = {
  cursor: 'pointer',
  color: 'var(--pipe-text)',
  fontFamily: RECRUITER_FONT,
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const AUDIT_HINT: CSSProperties = {
  display: 'block',
  marginTop: 5,
  color: 'var(--pipe-text-dim)',
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: 0,
  textTransform: 'none',
};

const AUDIT_BODY: CSSProperties = {
  display: 'grid',
  gap: 10,
};

const AUDIT_ROW: CSSProperties = {
  display: 'grid',
  gap: 4,
};

const AUDIT_THREADS: CSSProperties = {
  display: 'grid',
  gap: 10,
};

const AUDIT_THREAD: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 10,
  border: '1px solid var(--pipe-border-light)',
  borderRadius: 6,
  background: 'var(--pipe-surface-solid)',
};

const THREAD_META: CSSProperties = {
  color: 'var(--pipe-text-dim)',
  fontFamily: RECRUITER_FONT,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const THREAD_REPLY_AI: CSSProperties = {
  display: 'grid',
  gap: 4,
  marginLeft: 10,
  padding: '8px 10px',
  borderLeft: '2px solid rgba(96,165,250,0.5)',
  background: 'rgba(96,165,250,0.06)',
  borderRadius: 4,
};

const THREAD_REPLY_CANDIDATE: CSSProperties = {
  display: 'grid',
  gap: 4,
  marginLeft: 10,
  padding: '8px 10px',
  borderLeft: '2px solid rgba(74,222,128,0.5)',
  background: 'rgba(74,222,128,0.06)',
  borderRadius: 4,
};
