import { useState, useCallback, useMemo } from 'react';
import { CheckCircle, ExternalLink, GitPullRequest, Loader2 } from 'lucide-react';
import {
  DiffPanel,
  type DiffJson,
  type Annotation,
  type InlineThread,
  type ResolvedLine,
} from '../components/Assessment/DiffPanel';
import { ConversationPanel } from '../components/Panels/ConversationPanel';
import { MatchProofPanel, type CodeReviewMatchExplanation } from '../components/Panels/ProblemPanel';
import {
  GoodReviewChecklist,
  ReviewProfileCard,
  type CodeReviewReviewProfile,
} from '../components/Assessment/CodeReviewChallenge';
import { useReviewSessionV2 } from '../hooks/useReviewSessionV2';
import type { ReviewVerdict, ReviewRound } from '../types/conversation';
import { buildThreadsFromRounds } from '../types/conversation';

const INITIAL_INLINE_REVIEW_SUMMARY = 'Initial review submitted with inline comments.';

export interface ReviewSessionPageProps {
  sessionId: string;
  pr: {
    title?: string | undefined;
    description?: string | undefined;
    diff: DiffJson;
    repoUrl?: string | null | undefined;
    prNumber?: number | null | undefined;
    instructions?: string | null | undefined;
    matchExplanation?: CodeReviewMatchExplanation | null | undefined;
    reviewProfile?: CodeReviewReviewProfile | null | undefined;
  };
  maxRounds: number;
  initialStatus?: string;
  initialCompleted?: boolean;
  initialRounds?: ReviewRound[];
  initialCurrentRound?: number;
  onComplete: () => void;
}

const BRAND_SURFACE = 'rgba(6, 16, 27, 0.74)';
const BRAND_BORDER = 'rgba(178, 214, 255, 0.14)';
const BRAND_BORDER_STRONG = 'rgba(178, 214, 255, 0.24)';
const BRAND_MUTED = 'rgba(244,248,255,0.62)';
const BRAND_DIM = 'rgba(244,248,255,0.38)';
const BRAND_SHADOW = '0 18px 60px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.055)';
const LABEL_FONT = '"Space Mono", monospace';
const BODY_FONT = '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

function repoLabelFromUrl(repoUrl: string | null | undefined): string {
  if (!repoUrl) return 'Repository pending';
  try {
    const parsed = new URL(repoUrl);
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
    return owner && repo ? `${owner}/${repo.replace(/\.git$/, '')}` : repoUrl;
  } catch {
    return repoUrl;
  }
}

function annotationsFromRounds(rounds: ReviewRound[]): Annotation[] {
  return rounds.flatMap((round) =>
    round.reviewer_comments
      .filter((comment) => comment.file !== undefined && comment.line !== undefined)
      .map((comment) => {
        const severity = comment.severity === 'blocking'
          ? 'critical'
          : comment.severity === 'major'
            ? 'major'
            : 'minor';

        return {
          id: `round-${round.round}-comment-${comment.id}`,
          file: comment.file ?? '',
          line: comment.line ?? 0,
          severity,
          comment: comment.what,
          createdAt: new Date(0).toISOString(),
        } satisfies Annotation;
      }),
  );
}

export function ReviewSessionPage({
  sessionId,
  pr,
  maxRounds,
  initialStatus,
  initialCompleted = false,
  initialRounds = [],
  initialCurrentRound = 1,
  onComplete,
}: ReviewSessionPageProps): JSX.Element {
  const { sendMessage, completeSession, isLoading, error } = useReviewSessionV2(sessionId);
  const initialAnnotations = useMemo(() => annotationsFromRounds(initialRounds), [initialRounds]);
  const [annotations, setAnnotations] = useState<Annotation[]>(initialAnnotations);
  const [submittedAnnotationIds, setSubmittedAnnotationIds] = useState<Set<string>>(
    () => new Set(initialAnnotations.map((annotation) => annotation.id)),
  );
  const [rounds, setRounds] = useState<ReviewRound[]>(initialRounds);
  const [currentRound, setCurrentRound] = useState(initialCurrentRound);
  const [verdict, setVerdict] = useState<ReviewVerdict | null>(null);
  const [summary, setSummary] = useState('');
  const [isComplete, setIsComplete] = useState(
    initialCompleted
      || ['verdict_submitted', 'scoring', 'scored', 'scoring_failed'].includes(initialStatus ?? ''),
  );
  const [threadReplies, setThreadReplies] = useState<Record<number, string>>({});

  const threads = buildThreadsFromRounds(rounds);
  const inlineThreads = useMemo<InlineThread[]>(
    () => threads
      .filter((thread) => thread.comment.file !== undefined && thread.comment.line !== undefined)
      .map((thread) => ({
        file: thread.comment.file ?? '',
        line: thread.comment.line ?? 0,
        exchanges: thread.exchanges.map((exchange) => ({
          actor: exchange.actor,
          content: exchange.content,
          round: exchange.round,
          ...(exchange.move !== undefined ? { move: exchange.move } : {}),
          ...(exchange.updated_code !== undefined ? { updated_code: exchange.updated_code } : {}),
        })),
      })),
    [threads],
  );
  const resolvedLines = useMemo<ResolvedLine[]>(
    () => threads
      .filter((thread) =>
        thread.comment.file !== undefined
        && thread.comment.line !== undefined
        && thread.exchanges.some((exchange) => exchange.actor === 'implementer' && exchange.move === 'change'),
      )
      .map((thread) => ({
        file: thread.comment.file ?? '',
        line: thread.comment.line ?? 0,
      })),
    [threads],
  );
  const isAwaitingResponse = isLoading;

  const handleAnnotationAdd = useCallback(
    (a: { file: string; line: number; severity: 'critical' | 'major' | 'minor'; comment: string }) => {
      const annotation: Annotation = {
        ...a,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      setAnnotations((prev) => [...prev, annotation]);
    },
    [],
  );

  const handleSubmitRound = useCallback(async () => {
    try {
      const newAnnotations = annotations.filter((a) => !submittedAnnotationIds.has(a.id));
      const replies = Object.entries(threadReplies)
        .filter(([, content]) => content.trim() !== '')
        .map(([commentId, content]) => ({
          toCommentId: Number(commentId),
          content,
        }));

      const roundSummary =
        summary.trim() || (rounds.length === 0 ? INITIAL_INLINE_REVIEW_SUMMARY : '');

      const result = await sendMessage(
        roundSummary,
        newAnnotations.length > 0 ? newAnnotations : undefined,
        replies.length > 0 ? replies : undefined,
      );

      setRounds(result.rounds);
      setCurrentRound(result.currentRound);
      setSubmittedAnnotationIds(new Set(annotations.map((a) => a.id)));
      setThreadReplies({});
    } catch {
      // error is surfaced via hook error state
    }
  }, [sendMessage, summary, rounds.length, annotations, submittedAnnotationIds, threadReplies]);

  const handleSubmitVerdict = useCallback(async () => {
    try {
      await completeSession(verdict ?? 'comment_only', summary);
      setIsComplete(true);
    } catch {
      // error is surfaced via hook error state
    }
  }, [completeSession, verdict, summary]);

  if (isComplete) {
    return (
      <div
        data-testid="review-session-completion"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          background: '#0c0c0e',
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 480, padding: 48 }}>
          <CheckCircle size={64} color="#10b981" style={{ marginBottom: 32 }} />
          <h2
            style={{
              fontSize: 32,
              fontWeight: 800,
              color: 'var(--pipe-text, #fff)',
              marginBottom: 16,
              letterSpacing: '-0.02em',
            }}
          >
            Review Submitted
          </h2>
          <p
            style={{
              fontSize: 13,
              color: 'var(--pipe-text-muted)',
              lineHeight: 1.7,
              fontFamily: '"Space Mono", monospace',
              textAlign: 'left',
              marginBottom: 0,
            }}
          >
            Your code review has been delivered. Here's what happens next:
          </p>
          <ol
            style={{
              marginTop: 20,
              marginBottom: 0,
              paddingLeft: 22,
              fontSize: 13,
              lineHeight: 1.7,
              textAlign: 'left',
              color: 'var(--pipe-text-muted)',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            <li>Your review is scored from the evidence in your comments and verdict.</li>
            <li>Our team reviews the resulting report.</li>
            <li>You'll hear back through your recruiter.</li>
          </ol>
          <button
            data-testid="review-session-continue-btn"
            onClick={onComplete}
            style={{
              marginTop: 32,
              padding: '12px 24px',
              background: 'var(--pipe-surface-hover)',
              border: '1px solid var(--pipe-border)',
              color: 'var(--pipe-text, #fff)',
              fontSize: 10,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer',
              borderRadius: 4,
            }}
          >
            CONTINUE
          </button>
        </div>
      </div>
    );
  }

  const repoLabel = repoLabelFromUrl(pr.repoUrl);
  const prUrl = pr.repoUrl && pr.prNumber ? `${pr.repoUrl.replace(/\/$/, '')}/pull/${pr.prNumber}` : null;

  return (
    <div
      className="pipe-code-review-challenge"
      data-testid="code-review-challenge"
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        fontFamily: BODY_FONT,
        background:
          'linear-gradient(180deg, rgba(8,22,35,0.9) 0%, rgba(12,12,14,0.98) 100%), linear-gradient(rgba(185,221,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(185,221,255,0.035) 1px, transparent 1px)',
        backgroundSize: 'auto, 88px 88px, 88px 88px',
      }}
    >
      <div
        className="pipe-code-review-left"
        style={{
          width: 'clamp(280px, 28vw, 380px)',
          flexShrink: 0,
          borderRight: `1px solid ${BRAND_BORDER}`,
          display: 'flex',
          flexDirection: 'column',
          background: BRAND_SURFACE,
          boxShadow: BRAND_SHADOW,
          backdropFilter: 'blur(18px)',
          overflowY: 'auto',
        }}
      >
        <div style={{ padding: 24, borderBottom: `1px solid ${BRAND_BORDER}` }}>
          <div style={{ fontSize: 9, letterSpacing: '0.2em', color: BRAND_DIM, marginBottom: 12, fontFamily: LABEL_FONT }}>
            INSTRUCTIONS
          </div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#f4f8ff', margin: 0, marginBottom: 12, lineHeight: 1.5 }}>
            Code Review
          </h3>
          <p style={{ fontSize: 11, color: BRAND_MUTED, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {pr.instructions ?? 'Review this pull request as if a teammate opened it: leave inline comments, respond to the implementation author, choose a verdict, and explain your reasoning.'}
          </p>
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <GitPullRequest size={12} color="#34d399" />
            <span style={{ fontSize: 9, letterSpacing: '0.2em', color: BRAND_DIM, fontFamily: LABEL_FONT }}>
              PULL REQUEST
            </span>
          </div>

          <div
            style={{
              padding: 16,
              borderRadius: 6,
              background: 'linear-gradient(180deg, rgba(244,248,255,0.06), rgba(98,143,185,0.055))',
              border: `1px solid ${BRAND_BORDER_STRONG}`,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 8, letterSpacing: '0.16em', color: BRAND_DIM, fontFamily: LABEL_FONT, marginBottom: 4 }}>
                REPOSITORY
              </div>
              {pr.repoUrl ? (
                <a
                  data-testid="code-review-repo-link"
                  href={pr.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#b9ddff', fontSize: 12, fontWeight: 700, textDecoration: 'none', wordBreak: 'break-word' }}
                >
                  {repoLabel}
                  <ExternalLink size={11} />
                </a>
              ) : (
                <span style={{ color: BRAND_MUTED, fontSize: 12 }}>{repoLabel}</span>
              )}
            </div>

            {pr.prNumber != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.15em', padding: '3px 8px', background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.2)', color: '#34d399', borderRadius: 4, fontFamily: LABEL_FONT }}>
                  OPEN
                </span>
                {prUrl ? (
                  <a
                    data-testid="code-review-pr-link"
                    href={prUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: BRAND_MUTED, fontWeight: 700, fontFamily: LABEL_FONT, textDecoration: 'none' }}
                  >
                    #{pr.prNumber}
                    <ExternalLink size={10} />
                  </a>
                ) : (
                  <span style={{ fontSize: 11, color: BRAND_MUTED, fontWeight: 700, fontFamily: LABEL_FONT }}>
                    #{pr.prNumber}
                  </span>
                )}
              </div>
            )}

            {pr.title && (
              <p style={{ fontSize: 11, color: 'rgba(244,248,255,0.76)', lineHeight: 1.5, margin: 0, marginBottom: 10 }}>
                {pr.title}
              </p>
            )}
            {pr.description && (
              <p style={{ fontSize: 11, color: BRAND_DIM, lineHeight: 1.65, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {pr.description}
              </p>
            )}
          </div>
        </div>

        {pr.matchExplanation && (
          <div style={{ padding: '0 24px 24px' }}>
            <MatchProofPanel matchExplanation={pr.matchExplanation} />
          </div>
        )}

        {pr.reviewProfile && (
          <div style={{ padding: '0 24px 24px' }}>
            <ReviewProfileCard profile={pr.reviewProfile} />
          </div>
        )}
      </div>

      <div
        data-testid="diff-panel"
        className="pipe-code-review-main"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <DiffPanel
          diff={pr.diff}
          annotations={annotations}
          inlineThreads={inlineThreads}
          resolvedLines={resolvedLines}
          onAnnotationAdd={handleAnnotationAdd}
        />
      </div>

      <div
        className="pipe-code-review-right"
        style={{
          width: 'clamp(300px, 27vw, 420px)',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflow: 'hidden',
          background: BRAND_SURFACE,
          borderLeft: `1px solid ${BRAND_BORDER}`,
          boxShadow: BRAND_SHADOW,
          backdropFilter: 'blur(18px)',
        }}
      >
        {error && (
          <div
            style={{
              padding: '10px 16px',
              background: 'rgba(239, 68, 68, 0.1)',
              borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
              fontSize: 11,
              color: '#f87171',
              fontFamily: LABEL_FONT,
            }}
          >
            Something went wrong: {error}
          </div>
        )}
        {pr.reviewProfile && (
          <div style={{ padding: '24px 24px 0' }}>
            <GoodReviewChecklist />
            <p
              data-testid="code-review-ai-use-note"
              style={{
                margin: '12px 0 0',
                padding: '10px 12px',
                borderRadius: 4,
                background: 'rgba(244,248,255,0.04)',
                border: `1px solid ${BRAND_BORDER}`,
                fontSize: 10,
                lineHeight: 1.6,
                color: BRAND_DIM,
                fontFamily: BODY_FONT,
              }}
            >
              You may use AI tools during this review. Any AI use captured in this workspace is recorded transparently alongside your submission — nothing beyond that record is assumed either way.
            </p>
          </div>
        )}
        {isLoading && rounds.length === 0 && (
          <div
            data-testid="review-session-loader"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
            }}
          >
            <Loader2
              size={24}
              color="var(--pipe-text-dim)"
              style={{ animation: 'spin 1s linear infinite' }}
            />
            <span
              style={{
                fontSize: 10,
                letterSpacing: '0.15em',
                color: 'var(--pipe-text-dim)',
                fontFamily: LABEL_FONT,
              }}
            >
              PREPARING YOUR REVIEW SESSION...
            </span>
          </div>
        )}
        <ConversationPanel
          threads={threads}
          currentRound={currentRound}
          maxRounds={maxRounds}
          verdict={verdict}
          summary={summary}
          isAwaitingResponse={isAwaitingResponse}
          annotationCount={annotations.length}
          onVerdictChange={setVerdict}
          onSummaryChange={setSummary}
          onSubmitRound={handleSubmitRound}
          onSubmitVerdict={handleSubmitVerdict}
          onThreadReplyChange={(commentId, value) =>
            setThreadReplies((prev) => ({ ...prev, [commentId]: value }))
          }
        />
      </div>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @media (max-width: 980px) {
          .pipe-code-review-challenge {
            display: grid !important;
            grid-template-columns: minmax(0, 1fr);
            grid-template-rows: auto minmax(560px, 1fr) auto;
            overflow: auto !important;
          }
          .pipe-code-review-left,
          .pipe-code-review-right {
            width: auto !important;
            border-left: 0 !important;
            border-right: 0 !important;
          }
          .pipe-code-review-main {
            min-height: 560px;
            border-top: 1px solid ${BRAND_BORDER};
            border-bottom: 1px solid ${BRAND_BORDER};
          }
        }
      `}</style>
    </div>
  );
}
