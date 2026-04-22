import { useState, useCallback } from 'react';
import { CheckCircle, Loader2 } from 'lucide-react';
import { DiffPanel, type DiffJson, type Annotation } from '../components/Assessment/DiffPanel';
import { ConversationPanel } from '../components/Panels/ConversationPanel';
import { useReviewSessionV2 } from '../hooks/useReviewSessionV2';
import type { ReviewVerdict, ReviewRound } from '../types/conversation';
import { buildThreadsFromRounds } from '../types/conversation';

export interface ReviewSessionPageProps {
  sessionId: string;
  pr: {
    title?: string;
    description?: string;
    diff: DiffJson;
  };
  maxRounds: number;
  onComplete: () => void;
}

export function ReviewSessionPage({ sessionId, pr, maxRounds, onComplete }: ReviewSessionPageProps): JSX.Element {
  const { sendMessage, completeSession, isLoading, error } = useReviewSessionV2(sessionId);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [submittedAnnotationIds, setSubmittedAnnotationIds] = useState<Set<string>>(new Set());
  const [rounds, setRounds] = useState<ReviewRound[]>([]);
  const [currentRound, setCurrentRound] = useState(1);
  const [verdict, setVerdict] = useState<ReviewVerdict | null>(null);
  const [summary, setSummary] = useState('');
  const [isComplete, setIsComplete] = useState(false);
  const [threadReplies, setThreadReplies] = useState<Record<number, string>>({});

  const threads = buildThreadsFromRounds(rounds);
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

      const result = await sendMessage(
        summary,
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
  }, [sendMessage, summary, annotations, submittedAnnotationIds, threadReplies]);

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
              fontSize: 14,
              color: 'var(--pipe-text-muted)',
              lineHeight: 1.6,
              fontFamily: '"Space Mono", monospace',
            }}
          >
            Your code review has been delivered. The team will review your submission and get back
            to you soon.
          </p>
          <button
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

  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        background: '#0c0c0e',
      }}
    >
      {/* Left panel: Diff */}
      <div
        style={{
          width: '60%',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <DiffPanel
          diff={pr.diff}
          annotations={annotations}
          onAnnotationAdd={handleAnnotationAdd}
        />
      </div>

      {/* Right panel: Chat */}
      <div
        style={{
          width: '40%',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflow: 'hidden',
          borderLeft: '1px solid var(--pipe-border)',
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
              fontFamily: '"Space Mono", monospace',
            }}
          >
            ERROR: {error}
          </div>
        )}
        {isLoading && rounds.length === 0 && (
          <div
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
                fontFamily: '"Space Mono", monospace',
              }}
            >
              INITIALISING_REVIEW_SESSION...
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
      `}</style>
    </div>
  );
}
