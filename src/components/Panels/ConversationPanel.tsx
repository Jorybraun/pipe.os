import { useState } from 'react';
import { CheckCircle2, XCircle, MessageSquare, Clock, AlertTriangle, Info, ChevronRight, Loader2, GitMerge, Code2, ChevronDown } from 'lucide-react';
import type {
  Thread,
  ThreadExchange,
  ReviewComment,
  CommentSeverity,
  ImplementerMove,
  ReviewVerdict,
} from '../../types/conversation';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ConversationPanelProps {
  threads: Thread[];
  currentRound: number;
  maxRounds: number;
  verdict: ReviewVerdict | null;
  summary: string;
  isAwaitingResponse: boolean;
  annotationCount?: number;
  onVerdictChange: (verdict: ReviewVerdict) => void;
  onSummaryChange: (summary: string) => void;
  onSubmitRound: () => void;
  onSubmitVerdict: () => void;
  onThreadReplyChange?: (commentId: number, value: string) => void;
}

// ---------------------------------------------------------------------------
// Badge config helpers
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG: Record<CommentSeverity, { label: string; color: string; bg: string; border: string; icon: typeof AlertTriangle }> = {
  blocking: {
    label: 'BLOCKING',
    color: '#f87171',
    bg: 'rgba(248,113,113,0.10)',
    border: 'rgba(248,113,113,0.25)',
    icon: AlertTriangle,
  },
  major: {
    label: 'MAJOR',
    color: '#fbbf24',
    bg: 'rgba(251,191,36,0.10)',
    border: 'rgba(251,191,36,0.25)',
    icon: AlertTriangle,
  },
  suggestion: {
    label: 'SUGGESTION',
    color: '#60a5fa',
    bg: 'rgba(96,165,250,0.10)',
    border: 'rgba(96,165,250,0.20)',
    icon: Info,
  },
  nit: {
    label: 'NIT',
    color: '#94a3b8',
    bg: 'rgba(148,163,184,0.10)',
    border: 'rgba(148,163,184,0.20)',
    icon: Info,
  },
};

const MOVE_CONFIG: Record<ImplementerMove, { label: string; color: string; bg: string; border: string }> = {
  change: {
    label: 'CHANGE',
    color: '#34d399',
    bg: 'rgba(52,211,153,0.10)',
    border: 'rgba(52,211,153,0.25)',
  },
  pushback: {
    label: 'PUSHBACK',
    color: '#f87171',
    bg: 'rgba(248,113,113,0.10)',
    border: 'rgba(248,113,113,0.25)',
  },
  comment: {
    label: 'COMMENT',
    color: '#a78bfa',
    bg: 'rgba(167,139,250,0.10)',
    border: 'rgba(167,139,250,0.25)',
  },
};

const VERDICT_OPTIONS: Array<{ key: ReviewVerdict; label: string; description: string; color: string; bg: string; border: string; icon: typeof CheckCircle2 }> = [
  {
    key: 'approve',
    label: 'APPROVE',
    description: 'Code is ready to merge',
    icon: CheckCircle2,
    color: '#34d399',
    bg: 'rgba(52,211,153,0.08)',
    border: 'rgba(52,211,153,0.2)',
  },
  {
    key: 'request_changes',
    label: 'REQUEST_CHANGES',
    description: 'Changes needed before merge',
    icon: XCircle,
    color: '#f87171',
    bg: 'rgba(248,113,113,0.08)',
    border: 'rgba(248,113,113,0.2)',
  },
  {
    key: 'comment_only',
    label: 'COMMENT',
    description: 'Informational review only',
    icon: MessageSquare,
    color: '#fbbf24',
    bg: 'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.2)',
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }: { severity: CommentSeverity }): JSX.Element {
  const cfg = SEVERITY_CONFIG[severity];
  const Icon = cfg.icon;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 3,
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: '0.1em',
        color: cfg.color,
        fontFamily: '"Space Mono", monospace',
      }}
    >
      <Icon size={9} />
      {cfg.label}
    </span>
  );
}

function MoveBadge({ move }: { move: ImplementerMove }): JSX.Element {
  const cfg = MOVE_CONFIG[move];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 3,
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: '0.1em',
        color: cfg.color,
        fontFamily: '"Space Mono", monospace',
      }}
    >
      {cfg.label}
    </span>
  );
}

/** Renders the initial reviewer comment that started the thread */
function CommentCard({ comment }: { comment: ReviewComment }): JSX.Element {
  return (
    <div
      style={{
        padding: '12px 14px',
        background: 'rgba(96,165,250,0.04)',
        border: '1px solid rgba(96,165,250,0.12)',
        borderRadius: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {comment.severity && <SeverityBadge severity={comment.severity} />}
          <span
            style={{
              fontSize: 9,
              color: 'rgba(96,165,250,0.7)',
              letterSpacing: '0.1em',
              fontWeight: 600,
            }}
          >
            YOU
          </span>
          <span style={{ fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.05em' }}>
            #{comment.id}
          </span>
        </div>
      </div>

      <p
        style={{
          margin: 0,
          fontSize: 11,
          lineHeight: 1.6,
          color: 'rgba(255,255,255,0.75)',
          fontFamily: '"Space Mono", monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {comment.what}
      </p>

      {comment.why && (
        <p
          style={{
            margin: 0,
            fontSize: 10,
            lineHeight: 1.5,
            color: 'rgba(255,255,255,0.45)',
            fontFamily: '"Space Mono", monospace',
            fontStyle: 'italic',
          }}
        >
          {comment.why}
        </p>
      )}
    </div>
  );
}

/** Renders an updated_code block with green left border (collapsible if >10 lines) */
function CodeChangeBlock({ code }: { code: string }): JSX.Element {
  const lines = code.split('\n');
  const isLong = lines.length > 10;
  const [expanded, setExpanded] = useState(!isLong);

  return (
    <div
      data-testid="code-change-block"
      style={{
        borderLeft: '3px solid #34d399',
        borderRadius: 4,
        overflow: 'hidden',
        background: 'rgba(52,211,153,0.04)',
        border: '1px solid rgba(52,211,153,0.12)',
        borderLeftWidth: 3,
        borderLeftColor: '#34d399',
      }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded((p) => !p)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          background: 'rgba(52,211,153,0.06)',
          border: 'none',
          borderBottom: expanded ? '1px solid rgba(52,211,153,0.1)' : 'none',
          cursor: 'pointer',
        }}
      >
        <Code2 size={10} color="#34d399" />
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', color: '#34d399', fontFamily: '"Space Mono", monospace' }}>
          UPDATED_CODE
        </span>
        <span style={{ fontSize: 8, color: 'rgba(52,211,153,0.5)', fontFamily: '"Space Mono", monospace' }}>
          {lines.length} lines
        </span>
        {isLong && (
          <ChevronDown
            size={10}
            color="rgba(52,211,153,0.5)"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', marginLeft: 'auto' }}
          />
        )}
      </button>

      {/* Code */}
      {expanded && (
        <pre
          style={{
            margin: 0,
            padding: '10px 12px',
            fontSize: 10,
            lineHeight: 1.6,
            color: 'rgba(255,255,255,0.8)',
            fontFamily: '"Space Mono", monospace',
            overflowX: 'auto',
            whiteSpace: 'pre',
          }}
        >
          {code}
        </pre>
      )}
    </div>
  );
}

/** Renders a single exchange (implementer or reviewer follow-up) */
function ExchangeCard({ exchange }: { exchange: ThreadExchange }): JSX.Element {
  const isReviewer = exchange.actor === 'reviewer';
  const hasCodeChange = !isReviewer && exchange.move === 'change' && typeof exchange.updated_code === 'string';

  return (
    <div
      style={{
        padding: '12px 14px',
        background: isReviewer ? 'rgba(96,165,250,0.04)' : 'rgba(167,139,250,0.04)',
        border: `1px solid ${isReviewer ? 'rgba(96,165,250,0.12)' : 'rgba(167,139,250,0.12)'}`,
        borderRadius: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {!isReviewer && exchange.move && <MoveBadge move={exchange.move} />}
        <span
          style={{
            fontSize: 9,
            color: isReviewer ? 'rgba(96,165,250,0.7)' : 'rgba(167,139,250,0.7)',
            letterSpacing: '0.1em',
            fontWeight: 600,
          }}
        >
          {isReviewer ? 'YOU' : 'AUTHOR'}
        </span>
        <span style={{ fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.05em' }}>
          ROUND {exchange.round}
        </span>
      </div>

      <p
        style={{
          margin: 0,
          fontSize: 11,
          lineHeight: 1.6,
          color: 'rgba(255,255,255,0.75)',
          fontFamily: '"Space Mono", monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {exchange.content}
      </p>

      {hasCodeChange && <CodeChangeBlock code={exchange.updated_code!} />}
    </div>
  );
}

function ThreadCard({
  thread,
  currentRound,
  replyValue,
  onReplyChange,
}: {
  thread: Thread;
  currentRound: number;
  replyValue: string;
  onReplyChange: (value: string) => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const hasImplementerResponse = thread.exchanges.some((e) => e.actor === 'implementer');
  const isReplyRound = currentRound > 1 && hasImplementerResponse;

  return (
    <div
      data-testid="conversation-thread"
      style={{
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.07)',
        overflow: 'hidden',
        background: 'rgba(255,255,255,0.01)',
      }}
    >
      {/* Thread header */}
      <button
        onClick={() => setExpanded((prev) => !prev)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'rgba(255,255,255,0.03)',
          border: 'none',
          borderBottom: expanded ? '1px solid rgba(255,255,255,0.06)' : 'none',
          cursor: 'pointer',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {thread.comment.file && (
            <span
              style={{
                fontSize: 9,
                color: '#60a5fa',
                fontFamily: '"Space Mono", monospace',
                fontWeight: 700,
                letterSpacing: '0.05em',
              }}
            >
              {thread.comment.file}
              {thread.comment.line != null && `:${thread.comment.line}`}
            </span>
          )}
          {!thread.comment.file && (
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>
              GENERAL COMMENT
            </span>
          )}
          {hasImplementerResponse && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '1px 6px',
                background: 'rgba(167,139,250,0.12)',
                border: '1px solid rgba(167,139,250,0.25)',
                borderRadius: 3,
                fontSize: 8,
                color: '#a78bfa',
                fontWeight: 700,
                letterSpacing: '0.08em',
              }}
            >
              RESPONDED
            </span>
          )}
          {thread.resolution === 'fix_agreed' && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '1px 6px',
                background: 'rgba(52,211,153,0.12)',
                border: '1px solid rgba(52,211,153,0.25)',
                borderRadius: 3,
                fontSize: 8,
                color: '#34d399',
                fontWeight: 700,
                letterSpacing: '0.08em',
              }}
            >
              <GitMerge size={8} />
              RESOLVED
            </span>
          )}
        </div>
        <ChevronRight
          size={12}
          color="rgba(255,255,255,0.3)"
          style={{
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        />
      </button>

      {/* Thread body: initial comment + exchanges */}
      {expanded && (
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Initial reviewer comment */}
          <CommentCard comment={thread.comment} />

          {/* Exchanges (implementer responses + reviewer follow-ups) */}
          {thread.exchanges.map((exchange, i) => (
            <ExchangeCard key={`${thread.comment_id}-ex-${i}`} exchange={exchange} />
          ))}

          {/* Reply textarea for rounds 2+ when implementer has responded */}
          {isReplyRound && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em', marginBottom: 6 }}>
                YOUR REPLY
              </div>
              <textarea
                value={replyValue}
                onChange={(e) => onReplyChange(e.target.value)}
                placeholder="Reply to the author's response..."
                rows={3}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 4,
                  color: 'var(--pipe-text, #fff)',
                  fontSize: 11,
                  padding: '10px 12px',
                  fontFamily: '"Space Mono", monospace',
                  outline: 'none',
                  resize: 'vertical',
                  lineHeight: 1.6,
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState(): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: '40px 24px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: 'rgba(96,165,250,0.08)',
          border: '1px solid rgba(96,165,250,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MessageSquare size={18} color="rgba(96,165,250,0.5)" />
      </div>
      <div>
        <h3
          style={{
            margin: '0 0 6px',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: 'rgba(255,255,255,0.6)',
            fontFamily: '"Space Mono", monospace',
          }}
        >
          Leave your review
        </h3>
        <p
          style={{
            margin: 0,
            fontSize: 10,
            color: 'var(--pipe-text-dim)',
            lineHeight: 1.6,
            maxWidth: 200,
            fontFamily: '"Space Mono", monospace',
          }}
        >
          Add inline comments on the diff, then submit your review. The author will respond.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * ConversationPanel — GitHub-style PR conversation UI for multi-turn code review.
 *
 * Renders Thread[] with initial ReviewComment + ThreadExchange[] exchanges.
 * Move badges (comment/change/pushback), severity indicators (blocking/major/suggestion/nit),
 * thread resolution status, and round-based submit controls.
 */
export function ConversationPanel({
  threads,
  currentRound,
  maxRounds,
  verdict,
  summary,
  isAwaitingResponse,
  onVerdictChange,
  onSummaryChange,
  onSubmitRound,
  onSubmitVerdict,
  onThreadReplyChange,
  annotationCount = 0,
}: ConversationPanelProps): JSX.Element {
  const [localSummary, setLocalSummary] = useState(summary);
  const [threadReplies, setThreadReplies] = useState<Record<number, string>>({});

  const handleSummaryChange = (s: string): void => {
    const trimmed = s.slice(0, 1000);
    setLocalSummary(trimmed);
    onSummaryChange(trimmed);
  };

  const handleReplyChange = (commentId: number, value: string): void => {
    setThreadReplies((prev) => ({ ...prev, [commentId]: value }));
    onThreadReplyChange?.(commentId, value);
  };

  const hasThreads = threads.length > 0;
  const hasImplementerResponses = threads.some((t) =>
    t.exchanges.some((e) => e.actor === 'implementer'),
  );

  // Determine submit button label
  const isVerdictReady = !!verdict && localSummary.trim().length > 0;
  const isFinalRound = currentRound >= maxRounds;

  let submitLabel: string;
  let submitAction: (() => void) | null = null;

  if (verdict && isVerdictReady) {
    submitLabel = 'SUBMIT_VERDICT';
    submitAction = onSubmitVerdict;
  } else if (currentRound === 1) {
    submitLabel = 'SUBMIT_REVIEW';
    submitAction = (hasThreads || annotationCount > 0) ? onSubmitRound : null;
  } else {
    submitLabel = 'SUBMIT_RESPONSE';
    submitAction = onSubmitRound;
  }

  // Unread badge: implementer responded but we're still on same round
  const hasUnread = hasImplementerResponses && !isAwaitingResponse;

  return (
    <div
      data-testid="conversation-panel"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(12, 12, 14, 0.5)',
        fontFamily: '"Space Mono", monospace',
        position: 'relative',
      }}
    >
      {/* Awaiting response overlay */}
      {isAwaitingResponse && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            background: 'rgba(12,12,14,0.75)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            backdropFilter: 'blur(2px)',
          }}
        >
          <Loader2
            size={24}
            color="#a78bfa"
            style={{ animation: 'spin 1s linear infinite' }}
          />
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: 'var(--pipe-text-muted)',
            }}
          >
            AUTHOR IS REVIEWING...
          </span>
        </div>
      )}

      {/* Header */}
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontWeight: 700 }}>
          REVIEW_CONVERSATION
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {hasUnread && (
            <span
              style={{
                padding: '2px 8px',
                background: 'rgba(167,139,250,0.15)',
                border: '1px solid rgba(167,139,250,0.3)',
                borderRadius: 3,
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: '#a78bfa',
              }}
            >
              UNREAD
            </span>
          )}
          <span
            data-testid="round-indicator"
            style={{
              padding: '3px 10px',
              background: 'rgba(96,165,250,0.08)',
              border: '1px solid rgba(96,165,250,0.2)',
              borderRadius: 3,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.1em',
              color: isFinalRound ? '#fbbf24' : '#60a5fa',
            }}
          >
            ROUND {currentRound} OF {maxRounds}
          </span>
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Thread list or empty state */}
        <div style={{ padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!hasThreads ? (
            <EmptyState />
          ) : (
            threads.map((thread) => (
              <ThreadCard
                key={thread.comment_id}
                thread={thread}
                currentRound={currentRound}
                replyValue={threadReplies[thread.comment_id] ?? ''}
                onReplyChange={(value) => handleReplyChange(thread.comment_id, value)}
              />
            ))
          )}
        </div>

        {/* Verdict section — shown when we're in verdict-ready state */}
        {(isFinalRound || hasImplementerResponses) && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            <div
              style={{
                padding: '12px 14px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 6,
              }}
            >
              <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginBottom: 12, fontWeight: 700 }}>
                REVIEW_VERDICT
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {VERDICT_OPTIONS.map((opt) => {
                  const isActive = verdict === opt.key;
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => onVerdictChange(opt.key)}
                      style={{
                        padding: '10px 12px',
                        background: isActive ? opt.bg : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${isActive ? opt.border : 'rgba(255,255,255,0.06)'}`,
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        textAlign: 'left',
                      }}
                    >
                      <Icon size={13} color={isActive ? opt.color : 'rgba(255,255,255,0.2)'} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', color: isActive ? opt.color : 'rgba(255,255,255,0.35)' }}>
                          {opt.label}
                        </span>
                        <span style={{ fontSize: 8, color: isActive ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.2)', letterSpacing: '0.03em' }}>
                          {opt.description}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Summary textarea */}
            <div
              style={{
                padding: '12px 14px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 6,
              }}
            >
              <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginBottom: 10, fontWeight: 700 }}>
                REVIEW_SUMMARY
              </div>
              <textarea
                value={localSummary}
                onChange={(e) => handleSummaryChange(e.target.value)}
                placeholder="Summarize your code review findings..."
                rows={4}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 4,
                  color: 'var(--pipe-text, #fff)',
                  fontSize: 11,
                  padding: '10px 12px',
                  fontFamily: '"Space Mono", monospace',
                  outline: 'none',
                  resize: 'vertical',
                  lineHeight: 1.6,
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6, fontSize: 8, color: 'rgba(255,255,255,0.25)' }}>
                {localSummary.length} / 1000
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer: round progress + submit button */}
      <div style={{ padding: '14px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        {/* Round progress dots */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12, justifyContent: 'center' }}>
          {Array.from({ length: maxRounds }).map((_, i) => {
            const roundNum = i + 1;
            const isPast = roundNum < currentRound;
            const isCurrent = roundNum === currentRound;
            return (
              <div
                key={roundNum}
                style={{
                  width: isCurrent ? 24 : 8,
                  height: 4,
                  borderRadius: 2,
                  background: isPast ? '#34d399' : isCurrent ? '#60a5fa' : 'rgba(255,255,255,0.1)',
                  transition: 'all 0.3s',
                }}
              />
            );
          })}
        </div>

        {/* Submit button */}
        {submitAction ? (
          <button
            onClick={submitAction}
            disabled={submitLabel === 'SUBMIT_VERDICT' && !isVerdictReady}
            style={{
              width: '100%',
              padding: '12px 16px',
              background:
                submitLabel === 'SUBMIT_VERDICT' && isVerdictReady
                  ? 'rgba(52,211,153,0.12)'
                  : submitLabel === 'SUBMIT_VERDICT'
                    ? 'rgba(255,255,255,0.02)'
                    : 'rgba(96,165,250,0.08)',
              border: `1px solid ${
                submitLabel === 'SUBMIT_VERDICT' && isVerdictReady
                  ? 'rgba(52,211,153,0.3)'
                  : submitLabel === 'SUBMIT_VERDICT'
                    ? 'rgba(255,255,255,0.06)'
                    : 'rgba(96,165,250,0.25)'
              }`,
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color:
                submitLabel === 'SUBMIT_VERDICT' && isVerdictReady
                  ? '#34d399'
                  : submitLabel === 'SUBMIT_VERDICT'
                    ? 'rgba(255,255,255,0.2)'
                    : '#60a5fa',
              cursor:
                submitLabel === 'SUBMIT_VERDICT' && !isVerdictReady ? 'not-allowed' : 'pointer',
              fontFamily: '"Space Mono", monospace',
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {submitLabel === 'SUBMIT_VERDICT' && isVerdictReady && <CheckCircle2 size={12} />}
            {submitLabel === 'SUBMIT_REVIEW' && <ChevronRight size={12} />}
            {submitLabel === 'SUBMIT_RESPONSE' && <ChevronRight size={12} />}
            {submitLabel}
          </button>
        ) : (
          <div
            style={{
              padding: '10px 16px',
              fontSize: 9,
              color: 'var(--pipe-text-dim)',
              textAlign: 'center',
              letterSpacing: '0.08em',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Clock size={10} color="rgba(255,255,255,0.2)" />
              ADD INLINE COMMENTS ON THE DIFF TO ENABLE SUBMIT
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
