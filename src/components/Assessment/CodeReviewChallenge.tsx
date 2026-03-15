import { useState, useEffect } from 'react';
import {
  GitBranch,
  ChevronRight,
  GitPullRequest,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Send,
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
  onSubmit: (s: {
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
  onSubmit,
}: CodeReviewChallengeProps): JSX.Element {
  const [verdict, setVerdict] = useState<string | null>(submission.verdict);
  const [summary, setSummary] = useState(submission.summary);

  // Sync local verdict/summary to parent whenever they change
  useEffect(() => {
    onSubmissionChange({
      annotations: submission.annotations,
      verdict,
      summary,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdict, summary]);

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

  const handleSubmit = (): void => {
    onSubmit({ annotations: submission.annotations, verdict, summary });
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
        <div style={{ padding: 24, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.2em',
              color: 'rgba(255,255,255,0.3)',
              marginBottom: 12,
            }}
          >
            INSTRUCTIONS
          </div>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: '#fff',
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
                color: 'rgba(255,255,255,0.5)',
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
                color: 'rgba(255,255,255,0.35)',
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
                color: 'rgba(255,255,255,0.3)',
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
                    color: 'rgba(255,255,255,0.5)',
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
                  color: 'rgba(255,255,255,0.7)',
                  lineHeight: 1.5,
                  margin: 0,
                  marginBottom: 10,
                }}
              >
                {challenge.githubPrTitle}
              </p>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <GitBranch size={10} color="rgba(255,255,255,0.2)" />
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{branch}</span>
              <ChevronRight size={10} color="rgba(255,255,255,0.15)" />
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>{base}</span>
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
              color: 'rgba(255,255,255,0.3)',
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
              color: 'rgba(255,255,255,0.2)',
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
          <div style={{ padding: 24, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: '0.2em',
                color: 'rgba(255,255,255,0.3)',
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
                    onClick={() => setVerdict(opt.key)}
                    style={{
                      padding: '14px 16px',
                      background: isActive ? opt.bg : 'rgba(255,255,255,0.02)',
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
                          color: isActive ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)',
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
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                fontSize: 9,
                letterSpacing: '0.2em',
                color: 'rgba(255,255,255,0.3)',
                marginBottom: 12,
              }}
            >
              REVIEW_SUMMARY
            </div>

            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value.slice(0, 1000))}
              placeholder="Summarize your code review findings..."
              style={{
                minHeight: 120,
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 4,
                color: '#fff',
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
                color: 'rgba(255,255,255,0.3)',
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
                color: 'rgba(255,255,255,0.3)',
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
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 4,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Annotations</span>
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
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Verdict</span>
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
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Summary</span>
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

        {/* Submit footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <button
            onClick={handleSubmit}
            disabled={!isReady}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: '12px 20px',
              background: isReady ? '#fff' : 'rgba(255,255,255,0.05)',
              color: isReady ? '#000' : 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: isReady ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
            }}
          >
            SUBMIT_REVIEW
            <Send size={14} />
          </button>
          {!isReady && (
            <div
              style={{
                marginTop: 8,
                fontSize: 9,
                color: 'rgba(255,255,255,0.2)',
                textAlign: 'center',
                letterSpacing: '0.05em',
              }}
            >
              SELECT VERDICT + ADD SUMMARY
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
