import { useState } from 'react';
import {
  GitBranch,
  ChevronRight,
  GitPullRequest,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Loader2,
} from 'lucide-react';
import { DiffPanel, type DiffJson, type Annotation } from './DiffPanel';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';

// ============================================================================
// Types
// ============================================================================

interface CachedMeta {
  prNumber?: number;
  branch?: string;
  base?: string;
  author?: string;
  additions?: number;
  deletions?: number;
  filesChanged?: number;
  title?: string;
}

export interface CodeReviewChallengeProps {
  challenge: {
    id: string;
    title: string;
    instructions: string | null;
    githubRepoUrl?: string | null;
    githubPrNumber?: number | null;
    githubPrTitle?: string | null;
    githubPrDescription?: string | null;
    cachedMetadata?: unknown;
  };
  diff: DiffJson | null;
  isFetchingDiff: boolean;
  submission: {
    annotations: Annotation[];
    verdict: string | null;
    summary: string;
  };
  onSubmissionChange: (s: {
    annotations: Annotation[];
    verdict: string | null;
    summary: string;
  }) => void;
}

const VERDICT_OPTIONS = [
  {
    key: 'approve' as const,
    label: 'APPROVE',
    icon: CheckCircle2,
    color: '#34d399',
    bg: 'rgba(52,211,153,0.08)',
    border: 'rgba(52,211,153,0.2)',
    description: 'Code is ready to merge',
  },
  {
    key: 'request_changes' as const,
    label: 'REQUEST_CHANGES',
    icon: XCircle,
    color: '#f87171',
    bg: 'rgba(248,113,113,0.08)',
    border: 'rgba(248,113,113,0.2)',
    description: 'Changes needed before merge',
  },
  {
    key: 'comment_only' as const,
    label: 'COMMENT',
    icon: MessageSquare,
    color: '#fbbf24',
    bg: 'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.2)',
    description: 'Informational review only',
  },
];

// ============================================================================
// Component
// ============================================================================

/**
 * CodeReviewChallenge - Full-page layout for CODE_REVIEW challenges.
 *
 * Left: challenge instructions + PR metadata
 * Center: DiffPanel with inline annotations
 * Right: verdict selection + summary + submit
 */
export function CodeReviewChallenge({
  challenge,
  diff,
  isFetchingDiff,
  submission,
  onSubmissionChange,
}: CodeReviewChallengeProps): JSX.Element {
  const [verdict, setVerdict] = useState<string | null>(submission.verdict);
  const [summary, setSummary] = useState(submission.summary);

  // Call parent synchronously so canAdvance updates in the same render cycle.
  // Using useEffect caused a stale-closure / async-hop problem where the parent
  // state lagged behind local state and the SUBMIT button stayed disabled.
  const handleVerdictChange = (v: string): void => {
    setVerdict(v);
    onSubmissionChange({ annotations: submission.annotations, verdict: v, summary });
  };

  const handleSummaryChange = (s: string): void => {
    const trimmed = s.slice(0, 1000);
    setSummary(trimmed);
    onSubmissionChange({ annotations: submission.annotations, verdict, summary: trimmed });
  };

  // When parent updates annotations, keep local state consistent
  const handleAnnotationAdd = (a: {
    file: string;
    line: number;
    severity: 'critical' | 'major' | 'minor';
    comment: string;
  }): void => {
    const annotation: Annotation = {
      ...a,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const next = { annotations: [...submission.annotations, annotation], verdict, summary };
    onSubmissionChange(next);
  };

  const isReady = !!verdict && summary.trim().length > 0;

  // Extract PR meta from cachedMetadata if available
  const meta = (typeof challenge.cachedMetadata === 'object' && challenge.cachedMetadata !== null
    ? challenge.cachedMetadata
    : {}) as CachedMeta;

  const prNumber = meta.prNumber ?? challenge.githubPrNumber;
  const branch = meta.branch ?? 'feature-branch';
  const base = meta.base ?? 'main';
  const additions = meta.additions ?? diff?.stats.additions ?? 0;
  const deletions = meta.deletions ?? diff?.stats.deletions ?? 0;
  const filesChanged = meta.filesChanged ?? diff?.stats.filesChanged ?? 0;

  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        fontFamily: '"Space Mono", monospace',
      }}
    >
      {/* ── Left Panel: Instructions + PR Context ─────────────── */}
      <div
        style={{
          width: 340,
          flexShrink: 0,
          borderRight: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(12, 12, 14, 0.5)',
          overflowY: 'auto',
        }}
      >
        {/* Instructions */}
        <div style={{ padding: 24, borderBottom: '1px solid var(--pipe-border)' }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.2em',
              color: 'var(--pipe-text-dim)',
              marginBottom: 12,
            }}
          >
            INSTRUCTIONS
          </div>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--pipe-text, #fff)',
              margin: 0,
              marginBottom: 12,
              lineHeight: 1.5,
              letterSpacing: '0.01em',
            }}
          >
            {challenge.title}
          </h3>
          {challenge.instructions && (
            <p
              style={{
                fontSize: 11,
                color: 'var(--pipe-text-muted)',
                lineHeight: 1.7,
                margin: 0,
                whiteSpace: 'pre-wrap',
              }}
            >
              {challenge.instructions}
            </p>
          )}
          {challenge.githubPrDescription && (
            <p
              style={{
                fontSize: 11,
                color: 'var(--pipe-text-dim)',
                lineHeight: 1.7,
                margin: 0,
                marginTop: 12,
                whiteSpace: 'pre-wrap',
              }}
            >
              {challenge.githubPrDescription}
            </p>
          )}
        </div>

        {/* PR Meta */}
        <div style={{ padding: 24 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 16,
            }}
          >
            <GitPullRequest size={12} color="#34d399" />
            <span
              style={{
                fontSize: 9,
                letterSpacing: '0.2em',
                color: 'var(--pipe-text-dim)',
              }}
            >
              PULL_REQUEST
            </span>
          </div>

          <LiquidMetalCard variant="default" style={{ padding: 16, borderRadius: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 800,
                  letterSpacing: '0.15em',
                  padding: '3px 8px',
                  background: 'rgba(52, 211, 153, 0.1)',
                  border: '1px solid rgba(52, 211, 153, 0.2)',
                  color: '#34d399',
                  borderRadius: 4,
                }}
              >
                OPEN
              </span>
              {prNumber != null && (
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--pipe-text-muted)',
                    fontWeight: 700,
                  }}
                >
                  #{prNumber}
                </span>
              )}
            </div>

            {challenge.githubPrTitle && (
              <p
                style={{
                  fontSize: 11,
                  color: 'var(--pipe-text-muted)',
                  lineHeight: 1.5,
                  margin: 0,
                  marginBottom: 10,
                }}
              >
                {challenge.githubPrTitle}
              </p>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <GitBranch size={10} color="var(--pipe-text-dim)" />
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{branch}</span>
              <ChevronRight size={10} color="var(--pipe-text-dim)" />
              <span style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>{base}</span>
            </div>

            <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
                <span style={{ color: '#4ade80', fontWeight: 700 }}>+{additions}</span>
                {' / '}
                <span style={{ color: '#f87171', fontWeight: 700 }}>-{deletions}</span>
              </span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
                {filesChanged} {filesChanged === 1 ? 'file' : 'files'}
              </span>
            </div>
          </LiquidMetalCard>
        </div>
      </div>

      {/* ── Center Panel: Diff ─────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {isFetchingDiff && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              color: 'var(--pipe-text-dim)',
            }}
          >
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
            <div style={{ fontSize: 10, letterSpacing: '0.15em' }}>FETCHING_DIFF...</div>
          </div>
        )}

        {!isFetchingDiff && diff && (
          <DiffPanel
            diff={diff}
            annotations={submission.annotations}
            onAnnotationAdd={handleAnnotationAdd}
          />
        )}

        {!isFetchingDiff && !diff && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              color: 'var(--pipe-text-dim)',
            }}
          >
            <div style={{ fontSize: 10, letterSpacing: '0.1em' }}>DIFF_UNAVAILABLE</div>
            <div style={{ fontSize: 10 }}>No diff data found for this PR.</div>
          </div>
        )}
      </div>

      {/* ── Right Panel: Verdict + Submit ─────────────────────── */}
      <div
        style={{
          width: 300,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(12, 12, 14, 0.5)',
          borderLeft: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Verdict */}
          <div style={{ padding: 24, borderBottom: '1px solid var(--pipe-border)' }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: '0.2em',
                color: 'var(--pipe-text-dim)',
                marginBottom: 16,
              }}
            >
              REVIEW_VERDICT
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {VERDICT_OPTIONS.map((opt) => {
                const isActive = verdict === opt.key;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.key}
                    onClick={() => handleVerdictChange(opt.key)}
                    style={{
                      padding: '14px 16px',
                      background: isActive ? opt.bg : 'var(--pipe-surface)',
                      border: `1px solid ${isActive ? opt.border : 'rgba(255,255,255,0.06)'}`,
                      borderRadius: 4,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      textAlign: 'left',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        flex: 1,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon
                          size={14}
                          color={isActive ? opt.color : 'rgba(255,255,255,0.2)'}
                        />
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: '0.05em',
                            color: isActive ? opt.color : 'rgba(255,255,255,0.35)',
                          }}
                        >
                          {opt.label}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: 9,
                          color: isActive ? 'rgba(255,255,255,0.5)' : 'var(--pipe-text-dim)',
                          marginLeft: 22,
                          marginTop: 4,
                        }}
                      >
                        {opt.description}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Summary */}
          <div
            style={{
              padding: 24,
              borderBottom: '1px solid var(--pipe-border)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                fontSize: 9,
                letterSpacing: '0.2em',
                color: 'var(--pipe-text-dim)',
                marginBottom: 12,
              }}
            >
              REVIEW_SUMMARY
            </div>

            <textarea
              value={summary}
              onChange={(e) => handleSummaryChange(e.target.value)}
              placeholder="Summarize your code review findings..."
              style={{
                minHeight: 120,
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4,
                color: 'var(--pipe-text, #fff)',
                fontSize: 11,
                padding: 12,
                fontFamily: '"Space Mono", monospace',
                outline: 'none',
                resize: 'vertical',
                lineHeight: 1.6,
              }}
            />

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 8,
                fontSize: 9,
                color: 'var(--pipe-text-dim)',
              }}
            >
              <span>MAX 1000 CHARACTERS</span>
              <span>
                {summary.length} / 1000
              </span>
            </div>
          </div>

          {/* Stats */}
          <div style={{ padding: 24 }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: '0.2em',
                color: 'var(--pipe-text-dim)',
                marginBottom: 12,
              }}
            >
              SUBMISSION_STATS
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 12,
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>Annotations</span>
                <span
                  style={{
                    fontSize: 10,
                    color:
                      submission.annotations.length > 0 ? '#a78bfa' : 'rgba(255,255,255,0.3)',
                    fontWeight: 700,
                  }}
                >
                  {submission.annotations.length}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>Verdict</span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: verdict ? '#34d399' : 'rgba(255,255,255,0.15)',
                  }}
                >
                  {verdict
                    ? verdict.replace('_', ' ').toUpperCase()
                    : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>Summary</span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: summary.trim() ? '#34d399' : 'rgba(255,255,255,0.15)',
                  }}
                >
                  {summary.trim() ? 'PROVIDED' : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Review status indicator — submit is handled by StageShell footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--pipe-border)',
          }}
        >
          {isReady ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '10px 16px',
                background: 'rgba(52,211,153,0.08)',
                border: '1px solid rgba(52,211,153,0.25)',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.12em',
                fontFamily: '"Space Mono", monospace',
                color: '#34d399',
              }}
            >
              <CheckCircle2 size={13} />
              REVIEW_READY — click SUBMIT below
            </div>
          ) : (
            <div
              style={{
                padding: '10px 16px',
                fontSize: 9,
                color: 'var(--pipe-text-dim)',
                textAlign: 'center',
                letterSpacing: '0.08em',
                fontFamily: '"Space Mono", monospace',
              }}
            >
              SELECT VERDICT + ADD SUMMARY TO ENABLE SUBMIT
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
