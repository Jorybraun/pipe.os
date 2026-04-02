import { useState } from 'react';
import { FileCode, MessageSquare, AlignJustify, Rows3, ChevronRight, Check, X, ExternalLink } from 'lucide-react';

export interface DiffLine {
  type: 'addition' | 'deletion' | 'context';
  num: number;
  content: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffJson {
  files: DiffFile[];
  stats: {
    filesChanged: number;
    additions: number;
    deletions: number;
  };
}

export interface Annotation {
  id: string;
  file: string;
  line: number;
  severity: 'critical' | 'major' | 'minor';
  comment: string;
  createdAt: string;
}

export interface ResolvedLine {
  file: string;
  line: number;
}

/** A thread exchange to display inline under an annotation */
export interface InlineThreadExchange {
  actor: 'implementer' | 'reviewer';
  move?: 'comment' | 'change' | 'pushback';
  content: string;
  updated_code?: string;
  round: number;
}

/** Thread data matched to a file+line for inline display */
export interface InlineThread {
  file: string;
  line: number;
  exchanges: InlineThreadExchange[];
}

export interface DiffPanelProps {
  diff: DiffJson;
  annotations?: Annotation[];
  onAnnotationAdd?: (annotation: {
    file: string;
    line: number;
    severity: 'critical' | 'major' | 'minor';
    comment: string;
  }) => void;
  readOnly?: boolean;
  /** Lines that received a move=change response from the implementer */
  resolvedLines?: ResolvedLine[];
  /** Thread exchanges to display inline under annotations */
  inlineThreads?: InlineThread[];
  /** Called when the candidate accepts an implementer's proposed code change */
  onAcceptChange?: (file: string, line: number) => void;
  /** Called when the candidate declines a proposed code change with a reason */
  onDeclineChange?: (file: string, line: number, reason: string) => void;
  /** Inline reply values keyed by "file:line" */
  inlineReplies?: Record<string, string>;
  /** Called when inline reply text changes */
  onInlineReplyChange?: (file: string, line: number, value: string) => void;
  /** Called when the user wants to view the full file in the file viewer */
  onViewFile?: (path: string) => void;
}

// ============================================================================
// Severity colour map
// ============================================================================

const severityColors = {
  critical: {
    bg: 'rgba(248, 113, 113, 0.08)',
    border: 'rgba(248, 113, 113, 0.2)',
    text: '#f87171',
    badge: 'rgba(248, 113, 113, 0.15)',
  },
  major: {
    bg: 'rgba(251, 191, 36, 0.08)',
    border: 'rgba(251, 191, 36, 0.2)',
    text: '#fbbf24',
    badge: 'rgba(251, 191, 36, 0.15)',
  },
  minor: {
    bg: 'rgba(96, 165, 250, 0.08)',
    border: 'rgba(96, 165, 250, 0.2)',
    text: '#60a5fa',
    badge: 'rgba(96, 165, 250, 0.15)',
  },
} as const;

// ============================================================================
// Sub-component: inline code change with See changes → Approve/Decline flow
// ============================================================================

function InlineCodeChange(props: {
  code: string;
  resolved: boolean;
  onAccept?: (() => void) | undefined;
  onDecline?: ((reason: string) => void) | undefined;
}): JSX.Element {
  const { code, resolved, onAccept, onDecline } = props;
  const [expanded, setExpanded] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState('');

  if (resolved) {
    return (
      <div style={{
        marginTop: 8,
        padding: '6px 10px',
        background: 'rgba(52,211,153,0.06)',
        border: '1px solid rgba(52,211,153,0.15)',
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <Check size={10} color="#34d399" />
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: '#34d399', fontFamily: '"Space Mono", monospace' }}>
          CHANGE_ACCEPTED
        </span>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        style={{
          marginTop: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          background: 'rgba(52,211,153,0.06)',
          border: '1px solid rgba(52,211,153,0.15)',
          borderRadius: 4,
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}
        data-testid="see-changes-btn"
      >
        <ChevronRight size={10} color="#34d399" />
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#34d399', fontFamily: '"Space Mono", monospace' }}>
          See changes
        </span>
        <span style={{ fontSize: 8, color: 'rgba(52,211,153,0.5)', fontFamily: '"Space Mono", monospace' }}>
          {code.split('\n').length} lines
        </span>
      </button>
    );
  }

  return (
    <div style={{
      marginTop: 8,
      background: 'rgba(52,211,153,0.04)',
      border: '1px solid rgba(52,211,153,0.12)',
      borderRadius: 4,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 10px',
        background: 'rgba(52,211,153,0.06)',
        borderBottom: '1px solid rgba(52,211,153,0.1)',
      }}>
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', color: '#34d399', fontFamily: '"Space Mono", monospace' }}>
          PROPOSED_CHANGE
        </span>
        <button
          onClick={() => setExpanded(false)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
            color: 'var(--pipe-text-dim)', fontSize: 10,
          }}
        >
          collapse
        </button>
      </div>

      {/* Code */}
      <pre style={{
        margin: 0,
        padding: '8px 12px',
        fontSize: 10,
        lineHeight: 1.6,
        color: 'rgba(255,255,255,0.75)',
        fontFamily: '"Space Mono", monospace',
        overflowX: 'auto',
        whiteSpace: 'pre',
      }}>
        {code}
      </pre>

      {/* Action buttons */}
      {!declining ? (
        <div style={{
          padding: '8px 10px',
          borderTop: '1px solid rgba(52,211,153,0.1)',
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
        }}>
          {onDecline && (
            <button
              onClick={() => setDeclining(true)}
              style={{
                padding: '5px 14px',
                background: 'transparent',
                border: '1px solid rgba(248,113,113,0.2)',
                borderRadius: 4,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.06em',
                color: 'rgba(248,113,113,0.6)',
                cursor: 'pointer',
                fontFamily: '"Space Mono", monospace',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
              data-testid="decline-change-btn"
            >
              <X size={10} />
              Decline
            </button>
          )}
          {onAccept && (
            <button
              onClick={onAccept}
              style={{
                padding: '5px 14px',
                background: 'rgba(52,211,153,0.12)',
                border: '1px solid rgba(52,211,153,0.3)',
                borderRadius: 4,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.06em',
                color: '#34d399',
                cursor: 'pointer',
                fontFamily: '"Space Mono", monospace',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
              data-testid="approve-change-btn"
            >
              <Check size={10} />
              Approve
            </button>
          )}
        </div>
      ) : (
        <div style={{
          padding: '10px',
          borderTop: '1px solid rgba(248,113,113,0.1)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          <span style={{ fontSize: 9, color: 'rgba(248,113,113,0.6)', fontWeight: 600, letterSpacing: '0.05em', fontFamily: '"Space Mono", monospace' }}>
            Why are you declining this change?
          </span>
          <textarea
            value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)}
            placeholder="Explain why this change isn't right..."
            autoFocus
            rows={3}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(248,113,113,0.15)',
              borderRadius: 4,
              color: 'var(--pipe-text, #fff)',
              fontSize: 11,
              padding: '8px 10px',
              fontFamily: '"Space Mono", monospace',
              outline: 'none',
              resize: 'vertical',
              lineHeight: 1.6,
            }}
            data-testid="decline-reason-input"
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setDeclining(false); setDeclineReason(''); }}
              style={{
                padding: '5px 12px', background: 'transparent',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4,
                fontSize: 9, color: 'var(--pipe-text-dim)', cursor: 'pointer',
                fontFamily: '"Space Mono", monospace',
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => { onDecline?.(declineReason); setDeclining(false); setDeclineReason(''); }}
              disabled={!declineReason.trim()}
              style={{
                padding: '5px 14px',
                background: declineReason.trim() ? 'rgba(248,113,113,0.12)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${declineReason.trim() ? 'rgba(248,113,113,0.3)' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: 4,
                fontSize: 9,
                fontWeight: 700,
                color: declineReason.trim() ? '#f87171' : 'rgba(255,255,255,0.15)',
                cursor: declineReason.trim() ? 'pointer' : 'not-allowed',
                fontFamily: '"Space Mono", monospace',
              }}
              data-testid="submit-decline-btn"
            >
              Submit decline
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Sub-component: renders the lines + hunks for a single file
// ============================================================================

interface FileDiffBodyProps {
  file: DiffFile;
  annotations: Annotation[];
  readOnly: boolean;
  annotatingLine: number | null;
  annotatingFilePath: string | null;
  annotationSeverity: 'critical' | 'major' | 'minor';
  annotationComment: string;
  resolvedLines: ResolvedLine[];
  inlineThreads: InlineThread[];
  onLineClick: (filePath: string, lineNum: number) => void;
  onSeverityChange: (s: 'critical' | 'major' | 'minor') => void;
  onCommentChange: (c: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onAcceptChange?: (file: string, line: number) => void;
  onDeclineChange?: (file: string, line: number, reason: string) => void;
  inlineReplies: Record<string, string>;
  onInlineReplyChange?: (file: string, line: number, value: string) => void;
}

function FileDiffBody({
  file,
  annotations,
  readOnly,
  annotatingLine,
  annotatingFilePath,
  annotationSeverity,
  annotationComment,
  resolvedLines,
  inlineThreads,
  onLineClick,
  onSeverityChange,
  onCommentChange,
  onSave,
  onCancel,
  onAcceptChange,
  onDeclineChange,
  inlineReplies,
  onInlineReplyChange,
}: FileDiffBodyProps): JSX.Element {
  const getAnnotationsForLine = (lineNum: number): Annotation[] =>
    annotations.filter(a => a.file === file.path && a.line === lineNum);

  const getThreadForLine = (lineNum: number): InlineThread | undefined =>
    inlineThreads.find(t => t.file === file.path && t.line === lineNum);

  const isResolved = (lineNum: number): boolean =>
    resolvedLines.some(r => r.file === file.path && r.line === lineNum);

  const isAnnotatingThisFile = annotatingFilePath === file.path;

  return (
    <>
      {file.hunks.map((hunk, hunkIdx) => (
        <div key={hunkIdx}>
          <div style={{
            padding: '8px 24px',
            background: 'rgba(96, 165, 250, 0.04)',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            borderTop: hunkIdx > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none',
            fontSize: 10,
            color: 'rgba(96, 165, 250, 0.5)',
            fontFamily: '"Space Mono", monospace',
          }}>
            {hunk.header}
          </div>

          {hunk.lines.map((line, lineIdx) => {
            const bgColor =
              line.type === 'addition' ? 'rgba(74, 222, 128, 0.04)' :
              line.type === 'deletion' ? 'rgba(248, 113, 113, 0.04)' :
              'transparent';

            const borderLeft =
              line.type === 'addition' ? '2px solid rgba(74, 222, 128, 0.3)' :
              line.type === 'deletion' ? '2px solid rgba(248, 113, 113, 0.3)' :
              '2px solid transparent';

            const lineAnnotations = getAnnotationsForLine(line.num);
            const isAnnotatingThisLine = isAnnotatingThisFile && annotatingLine === line.num;

            return (
              <div key={lineIdx}>
                <div
                  onClick={() => {
                    if (!readOnly && line.type !== 'deletion') {
                      onLineClick(file.path, line.num);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'stretch',
                    background: bgColor,
                    borderLeft,
                    cursor: !readOnly && line.type !== 'deletion' ? 'pointer' : 'default',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => {
                    if (!readOnly && line.type !== 'deletion') {
                      (e.currentTarget as HTMLDivElement).style.background =
                        line.type === 'addition'
                          ? 'rgba(74, 222, 128, 0.08)'
                          : 'rgba(255,255,255,0.03)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = bgColor;
                  }}
                  data-testid={`diff-line-${line.num}`}
                >
                  {/* Line number + resolved indicator */}
                  <div style={{
                    width: 56,
                    padding: '4px 12px',
                    textAlign: 'right',
                    fontSize: 10,
                    color: isResolved(line.num) ? '#34d399' : 'rgba(255,255,255,0.15)',
                    userSelect: 'none',
                    flexShrink: 0,
                    fontFamily: '"Space Mono", monospace',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 4,
                  }}>
                    {isResolved(line.num) && (
                      <span
                        data-testid={`fixed-indicator-${line.num}`}
                        style={{
                          fontSize: 6,
                          fontWeight: 700,
                          letterSpacing: '0.05em',
                          color: '#34d399',
                          background: 'rgba(52,211,153,0.12)',
                          padding: '1px 3px',
                          borderRadius: 2,
                        }}
                      >
                        FIXED
                      </span>
                    )}
                    {line.num}
                  </div>

                  {/* Marker */}
                  <div style={{
                    width: 20,
                    padding: '4px 4px',
                    textAlign: 'center',
                    fontSize: 10,
                    color: line.type === 'addition' ? 'rgba(74, 222, 128, 0.5)' :
                           line.type === 'deletion' ? 'rgba(248, 113, 113, 0.5)' :
                           'transparent',
                    userSelect: 'none',
                    flexShrink: 0,
                    fontFamily: '"Space Mono", monospace',
                  }}>
                    {line.type === 'addition' ? '+' : line.type === 'deletion' ? '−' : ' '}
                  </div>

                  {/* Code */}
                  <div style={{
                    flex: 1,
                    padding: '4px 16px',
                    fontSize: 11,
                    color: line.type === 'deletion' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)',
                    whiteSpace: 'pre',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textDecoration: line.type === 'deletion' ? 'line-through' : 'none',
                    opacity: line.type === 'deletion' ? 0.6 : 1,
                    fontFamily: '"Space Mono", monospace',
                  }}>
                    {line.content}
                  </div>

                  {/* Annotation indicator */}
                  {lineAnnotations.length > 0 && (() => {
                    const firstAnn = lineAnnotations[0];
                    const sev = firstAnn?.severity ?? 'minor';
                    const sevColor = severityColors[sev];
                    return (
                      <div style={{
                        width: 24,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <div
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            background: sevColor?.badge ?? 'rgba(251,191,36,0.15)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 8,
                            color: sevColor?.text ?? '#fbbf24',
                            fontWeight: 700,
                          }}
                          title={`${lineAnnotations.length} annotation(s)`}
                          data-testid={`annotation-badge-${line.num}`}
                        >
                          {lineAnnotations.length}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* GitHub-style inline comment form */}
                {isAnnotatingThisLine && (
                  <div style={{
                    margin: '0 24px 0 78px',
                    background: 'rgba(167, 139, 250, 0.03)',
                    border: '1px solid rgba(167, 139, 250, 0.2)',
                    borderRadius: 6,
                    overflow: 'hidden',
                    marginTop: 4,
                    marginBottom: 4,
                  }} data-testid="annotation-editor-form">
                    {/* Header */}
                    <div style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid rgba(167, 139, 250, 0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      background: 'rgba(167, 139, 250, 0.04)',
                    }}>
                      <MessageSquare size={12} color="#a78bfa" />
                      <span style={{
                        fontSize: 10,
                        color: 'var(--pipe-text-muted)',
                        fontFamily: '"Space Mono", monospace',
                      }}>
                        Add a comment on line {line.num}
                      </span>
                      {/* Severity pills */}
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                        {(['critical', 'major', 'minor'] as const).map((sev) => {
                          const isActive = annotationSeverity === sev;
                          const sevCfg = severityColors[sev];
                          return (
                            <button
                              key={sev}
                              onClick={() => onSeverityChange(sev)}
                              data-testid={`severity-${sev}`}
                              style={{
                                padding: '3px 8px',
                                fontSize: 8,
                                fontWeight: 700,
                                letterSpacing: '0.08em',
                                fontFamily: '"Space Mono", monospace',
                                textTransform: 'uppercase',
                                border: `1px solid ${isActive ? sevCfg.border : 'rgba(255,255,255,0.06)'}`,
                                borderRadius: 3,
                                background: isActive ? sevCfg.bg : 'transparent',
                                color: isActive ? sevCfg.text : 'rgba(255,255,255,0.25)',
                                cursor: 'pointer',
                                transition: 'all 0.15s',
                              }}
                            >
                              {sev}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Textarea */}
                    <div style={{ padding: '12px 14px' }}>
                      <textarea
                        value={annotationComment}
                        onChange={e => onCommentChange(e.target.value.slice(0, 500))}
                        placeholder="Leave a comment..."
                        autoFocus
                        rows={4}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          background: 'rgba(255,255,255,0.02)',
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: 4,
                          color: 'var(--pipe-text, #fff)',
                          fontSize: 12,
                          padding: '12px 14px',
                          fontFamily: '"Space Mono", monospace',
                          outline: 'none',
                          resize: 'vertical',
                          lineHeight: 1.6,
                        }}
                        onFocus={(e) => {
                          (e.currentTarget as HTMLTextAreaElement).style.borderColor = 'rgba(167,139,250,0.4)';
                        }}
                        onBlur={(e) => {
                          (e.currentTarget as HTMLTextAreaElement).style.borderColor = 'rgba(255,255,255,0.08)';
                        }}
                        data-testid="annotation-input"
                      />
                    </div>

                    {/* Footer with actions */}
                    <div style={{
                      padding: '10px 14px',
                      borderTop: '1px solid rgba(167, 139, 250, 0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      gap: 8,
                    }}>
                      <span style={{
                        fontSize: 8,
                        color: 'rgba(255,255,255,0.15)',
                        fontFamily: '"Space Mono", monospace',
                        marginRight: 'auto',
                      }}>
                        {annotationComment.length}/500
                      </span>
                      <button
                        onClick={onCancel}
                        style={{
                          padding: '7px 16px',
                          background: 'transparent',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: 4,
                          color: 'var(--pipe-text-dim)',
                          fontSize: 10,
                          fontWeight: 600,
                          cursor: 'pointer',
                          fontFamily: '"Space Mono", monospace',
                          transition: 'all 0.15s',
                        }}
                        data-testid="cancel-annotation-btn"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={onSave}
                        disabled={!annotationComment.trim()}
                        style={{
                          padding: '7px 20px',
                          background: annotationComment.trim() ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${annotationComment.trim() ? 'rgba(167,139,250,0.35)' : 'rgba(255,255,255,0.06)'}`,
                          borderRadius: 4,
                          color: annotationComment.trim() ? '#a78bfa' : 'rgba(255,255,255,0.15)',
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: '0.05em',
                          cursor: annotationComment.trim() ? 'pointer' : 'not-allowed',
                          fontFamily: '"Space Mono", monospace',
                          transition: 'all 0.15s',
                        }}
                        data-testid="save-annotation-btn"
                      >
                        Comment
                      </button>
                    </div>
                  </div>
                )}

                {/* Display annotations + inline thread responses */}
                {lineAnnotations.map((annotation) => {
                  const thread = getThreadForLine(line.num);
                  const lineResolved = isResolved(line.num);
                  return (
                    <div key={annotation.id} data-testid={`annotation-thread-${annotation.id}`}>
                      {/* Reviewer's annotation */}
                      <div style={{
                        padding: '10px 24px 10px 78px',
                        background: severityColors[annotation.severity].bg,
                        borderTop: `1px solid ${severityColors[annotation.severity].border}`,
                        borderBottom: thread?.exchanges.length ? 'none' : `1px solid ${severityColors[annotation.severity].border}`,
                      }} data-testid={`annotation-display-${annotation.id}`}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          marginBottom: 4,
                        }}>
                          <MessageSquare size={10} color={severityColors[annotation.severity].text} />
                          <span style={{
                            fontSize: 9,
                            fontWeight: 700,
                            color: severityColors[annotation.severity].text,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                          }}>
                            {annotation.severity}
                          </span>
                          <span style={{ fontSize: 8, color: 'var(--pipe-text-dim)', letterSpacing: '0.05em' }}>YOU</span>
                        </div>
                        <p style={{
                          fontSize: 11,
                          color: 'rgba(255,255,255,0.65)',
                          lineHeight: 1.6,
                          margin: 0,
                          fontFamily: '"Space Mono", monospace',
                        }}>
                          {annotation.comment}
                        </p>
                      </div>

                      {/* Implementer responses nested under annotation */}
                      {thread?.exchanges.map((exchange, exIdx) => {
                        const isImplementer = exchange.actor === 'implementer';
                        const moveColorMap = {
                          change: { color: '#34d399', bg: 'rgba(52,211,153,0.05)', border: 'rgba(52,211,153,0.15)' },
                          pushback: { color: '#f87171', bg: 'rgba(248,113,113,0.05)', border: 'rgba(248,113,113,0.15)' },
                          comment: { color: '#a78bfa', bg: 'rgba(167,139,250,0.05)', border: 'rgba(167,139,250,0.15)' },
                        } as const;
                        type MoveKey = keyof typeof moveColorMap;
                        const moveKey: MoveKey = (exchange.move ?? 'comment') as MoveKey;
                        const mc = moveColorMap[moveKey in moveColorMap ? moveKey : 'comment'];

                        return (
                          <div
                            key={`ex-${exIdx}`}
                            style={{
                              padding: '10px 14px',
                              background: mc.bg,
                              borderLeft: `3px solid ${mc.color}`,
                              marginLeft: 78,
                            }}
                            data-testid={`inline-exchange-${exIdx}`}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                              {isImplementer && exchange.move && (
                                <span style={{
                                  fontSize: 8,
                                  fontWeight: 700,
                                  letterSpacing: '0.1em',
                                  color: mc.color,
                                  padding: '1px 6px',
                                  background: `${mc.color}15`,
                                  border: `1px solid ${mc.border}`,
                                  borderRadius: 3,
                                }}>
                                  {exchange.move.toUpperCase()}
                                </span>
                              )}
                              <span style={{
                                fontSize: 8,
                                color: isImplementer ? 'rgba(167,139,250,0.6)' : 'rgba(96,165,250,0.6)',
                                letterSpacing: '0.08em',
                                fontWeight: 600,
                              }}>
                                {isImplementer ? 'AUTHOR' : 'YOU'}
                              </span>
                              <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.15)' }}>R{exchange.round}</span>
                            </div>
                            <p style={{
                              fontSize: 11,
                              color: 'rgba(255,255,255,0.6)',
                              lineHeight: 1.6,
                              margin: 0,
                              fontFamily: '"Space Mono", monospace',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}>
                              {exchange.content}
                            </p>

                            {/* Code change: See changes → Approve/Decline flow */}
                            {exchange.updated_code && (
                              <InlineCodeChange
                                code={exchange.updated_code}
                                resolved={lineResolved}
                                onAccept={onAcceptChange ? () => onAcceptChange(file.path, line.num) : undefined}
                                onDecline={onDeclineChange ? (reason) => onDeclineChange(file.path, line.num, reason) : undefined}
                              />
                            )}
                          </div>
                        );
                      })}

                      {/* Inline reply + resolve (GitHub-style, shown when thread has exchanges) */}
                      {thread && thread.exchanges.length > 0 && !lineResolved && (() => {
                        const replyKey = `${file.path}:${line.num}`;
                        const replyValue = inlineReplies[replyKey] ?? '';
                        return (
                          <div style={{
                            marginLeft: 78,
                            borderLeft: '3px solid rgba(255,255,255,0.06)',
                            padding: '8px 14px',
                            background: 'rgba(255,255,255,0.01)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                          }}>
                            <input
                              type="text"
                              value={replyValue}
                              onChange={(e) => onInlineReplyChange?.(file.path, line.num, e.target.value)}
                              placeholder="Write a reply..."
                              style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                background: 'rgba(255,255,255,0.02)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: 4,
                                color: 'var(--pipe-text, #fff)',
                                fontSize: 11,
                                padding: '8px 12px',
                                fontFamily: '"Space Mono", monospace',
                                outline: 'none',
                              }}
                              onFocus={(e) => { (e.currentTarget).style.borderColor = 'rgba(96,165,250,0.3)'; }}
                              onBlur={(e) => { (e.currentTarget).style.borderColor = 'rgba(255,255,255,0.08)'; }}
                              data-testid={`inline-reply-${line.num}`}
                            />
                            {onAcceptChange && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onAcceptChange(file.path, line.num); }}
                                style={{
                                  alignSelf: 'flex-start',
                                  padding: '5px 12px',
                                  background: 'rgba(255,255,255,0.03)',
                                  border: '1px solid rgba(255,255,255,0.1)',
                                  borderRadius: 4,
                                  fontSize: 9,
                                  fontWeight: 600,
                                  color: 'var(--pipe-text-dim)',
                                  cursor: 'pointer',
                                  fontFamily: '"Space Mono", monospace',
                                }}
                                data-testid={`resolve-thread-${line.num}`}
                              >
                                Resolve comment
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

// ============================================================================
// Main component
// ============================================================================

/**
 * DiffPanel — Renders a PR diff with inline annotation support.
 *
 * Supports two view modes:
 * - TABBED (default): one file at a time with file tabs across the top
 * - LONG_FORM: all files rendered vertically with sticky file-header dividers
 *
 * Annotations are keyed by file path + line number in both modes.
 */
export function DiffPanel({
  diff,
  annotations = [],
  onAnnotationAdd,
  readOnly = false,
  resolvedLines,
  inlineThreads,
  onAcceptChange,
  onDeclineChange,
  inlineReplies,
  onInlineReplyChange,
  onViewFile,
}: DiffPanelProps): JSX.Element {
  const [viewMode, setViewMode] = useState<'TABBED' | 'LONG_FORM'>('TABBED');
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [annotatingLine, setAnnotatingLine] = useState<number | null>(null);
  const [annotatingFilePath, setAnnotatingFilePath] = useState<string | null>(null);
  const [annotationSeverity, setAnnotationSeverity] = useState<'critical' | 'major' | 'minor'>('critical');
  const [annotationComment, setAnnotationComment] = useState('');

  const activeFile = diff.files.length > 0 ? diff.files[activeFileIdx] : null;

  if (!activeFile || diff.files.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(12, 12, 14, 0.5)' }}>
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--pipe-text-dim)',
          fontSize: 12,
        }}>
          No diff files available
        </div>
      </div>
    );
  }

  const handleLineClick = (filePath: string, lineNum: number): void => {
    if (annotatingFilePath === filePath && annotatingLine === lineNum) {
      // toggle off
      setAnnotatingLine(null);
      setAnnotatingFilePath(null);
    } else {
      setAnnotatingLine(lineNum);
      setAnnotatingFilePath(filePath);
      setAnnotationComment('');
      setAnnotationSeverity('critical');
    }
  };

  const handleSave = (): void => {
    if (annotatingLine !== null && annotatingFilePath !== null && annotationComment.trim() && onAnnotationAdd) {
      onAnnotationAdd({
        file: annotatingFilePath,
        line: annotatingLine,
        severity: annotationSeverity,
        comment: annotationComment,
      });
      setAnnotationComment('');
      setAnnotationSeverity('critical');
      setAnnotatingLine(null);
      setAnnotatingFilePath(null);
    }
  };

  const handleCancel = (): void => {
    setAnnotatingLine(null);
    setAnnotatingFilePath(null);
    setAnnotationComment('');
  };

  // Shared props for FileDiffBody
  const bodyProps = {
    annotations,
    readOnly,
    annotatingLine,
    annotatingFilePath,
    annotationSeverity,
    annotationComment,
    resolvedLines: resolvedLines ?? [],
    inlineThreads: inlineThreads ?? [],
    onLineClick: handleLineClick,
    onSeverityChange: setAnnotationSeverity,
    onCommentChange: setAnnotationComment,
    onSave: handleSave,
    onCancel: handleCancel,
    inlineReplies: inlineReplies ?? {},
    ...(onAcceptChange ? { onAcceptChange } : {}),
    ...(onDeclineChange ? { onDeclineChange } : {}),
    ...(onInlineReplyChange ? { onInlineReplyChange } : {}),
  };

  // ---------------------------------------------------------------------------
  // View mode toggle button (shared across both modes)
  // ---------------------------------------------------------------------------

  const viewToggle = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', padding: '0 12px' }}>
      <button
        onClick={() => setViewMode('TABBED')}
        title="Tabbed view — one file at a time"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          background: viewMode === 'TABBED' ? 'rgba(255,255,255,0.08)' : 'transparent',
          border: viewMode === 'TABBED' ? '1px solid rgba(255,255,255,0.12)' : '1px solid transparent',
          borderRadius: 3,
          color: viewMode === 'TABBED' ? '#fff' : 'rgba(255,255,255,0.3)',
          fontSize: 9,
          fontFamily: '"Space Mono", monospace',
          letterSpacing: '0.08em',
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}
        data-testid="view-mode-tabbed"
      >
        <Rows3 size={11} />
        TABBED
      </button>
      <button
        onClick={() => setViewMode('LONG_FORM')}
        title="Long-form view — all files in one scroll"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          background: viewMode === 'LONG_FORM' ? 'rgba(255,255,255,0.08)' : 'transparent',
          border: viewMode === 'LONG_FORM' ? '1px solid rgba(255,255,255,0.12)' : '1px solid transparent',
          borderRadius: 3,
          color: viewMode === 'LONG_FORM' ? '#fff' : 'rgba(255,255,255,0.3)',
          fontSize: 9,
          fontFamily: '"Space Mono", monospace',
          letterSpacing: '0.08em',
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}
        data-testid="view-mode-longform"
      >
        <AlignJustify size={11} />
        LONG_FORM
      </button>
    </div>
  );

  // ---------------------------------------------------------------------------
  // TABBED mode
  // ---------------------------------------------------------------------------

  if (viewMode === 'TABBED') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(12, 12, 14, 0.5)' }}>
        {/* File tabs + view toggle */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(12, 12, 14, 0.6)',
          alignItems: 'center',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', overflowX: 'auto', flex: 1, minWidth: 0 }}>
          {diff.files.map((f, i) => (
            <button
              key={f.path}
              onClick={() => setActiveFileIdx(i)}
              style={{
                padding: '12px 20px',
                background: i === activeFileIdx ? 'rgba(255,255,255,0.04)' : 'transparent',
                border: 'none',
                borderBottom: i === activeFileIdx ? '2px solid #a78bfa' : '2px solid transparent',
                color: i === activeFileIdx ? '#fff' : 'rgba(255,255,255,0.3)',
                fontSize: 10,
                fontFamily: '"Space Mono", monospace',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                whiteSpace: 'nowrap',
                transition: 'all 0.2s',
                flexShrink: 0,
              }}
              aria-selected={i === activeFileIdx}
              data-testid={`file-tab-${i}`}
            >
              <FileCode size={12} color={i === activeFileIdx ? '#a78bfa' : 'rgba(255,255,255,0.2)'} />
              {f.path.split('/').pop()}
              <span style={{
                fontSize: 8,
                padding: '2px 6px',
                borderRadius: 3,
                background: f.status === 'added'
                  ? 'rgba(74, 222, 128, 0.1)'
                  : f.status === 'deleted'
                  ? 'rgba(248, 113, 113, 0.1)'
                  : 'rgba(255,255,255,0.04)',
                color: f.status === 'added'
                  ? '#4ade80'
                  : f.status === 'deleted'
                  ? '#f87171'
                  : 'rgba(255,255,255,0.3)',
                fontWeight: 700,
                letterSpacing: '0.1em',
              }}>
                {f.status === 'added' ? 'NEW' : f.status === 'deleted' ? 'DEL' : 'MOD'}
              </span>
            </button>
          ))}
          </div>
          {viewToggle}
        </div>

        {/* Active file header */}
        <div style={{
          padding: '12px 24px',
          background: 'rgba(255,255,255,0.02)',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, color: 'var(--pipe-text-muted)', fontFamily: '"Space Mono", monospace' }}>
            {activeFile.path}
          </span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontFamily: '"Space Mono", monospace' }}>
            <span style={{ color: '#4ade80' }}>+{activeFile.additions}</span>
            {' / '}
            <span style={{ color: '#f87171' }}>-{activeFile.deletions}</span>
          </span>
          {onViewFile && (
            <button
              onClick={() => onViewFile(activeFile.path)}
              title="View full file"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 3,
                color: 'var(--pipe-text-dim)',
                fontSize: 9,
                fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.06em',
                cursor: 'pointer',
                transition: 'all 0.15s',
                marginLeft: 8,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                e.currentTarget.style.color = 'rgba(255,255,255,0.4)';
              }}
              data-testid="view-full-file"
            >
              <ExternalLink size={10} />
              VIEW FILE
            </button>
          )}
        </div>

        {/* Diff content */}
        <div style={{ flex: 1, overflowY: 'auto' }} data-testid="diff-content">
          <FileDiffBody file={activeFile} {...bodyProps} />
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // LONG_FORM mode — all files in one scrollable view
  // ---------------------------------------------------------------------------

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(12, 12, 14, 0.5)' }}>
      {/* Header bar with stats + view toggle */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(12, 12, 14, 0.6)',
        padding: '0 12px',
        flexShrink: 0,
        minHeight: 44,
      }}>
        <span style={{
          fontSize: 9,
          fontFamily: '"Space Mono", monospace',
          color: 'var(--pipe-text-dim)',
          letterSpacing: '0.12em',
          padding: '0 8px',
        }}>
          {diff.stats.filesChanged} FILES
          {'  '}
          <span style={{ color: '#4ade80' }}>+{diff.stats.additions}</span>
          {'  '}
          <span style={{ color: '#f87171' }}>-{diff.stats.deletions}</span>
        </span>
        {viewToggle}
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto' }} data-testid="diff-content">
        {diff.files.map((f) => (
          <div key={f.path}>
            {/* Sticky file-header divider */}
            <div style={{
              position: 'sticky',
              top: 0,
              zIndex: 10,
              padding: '10px 24px',
              background: 'rgba(18, 18, 22, 0.95)',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              borderTop: '1px solid rgba(255,255,255,0.04)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              backdropFilter: 'blur(4px)',
            }}>
              <FileCode size={12} color="#a78bfa" />
              <span style={{
                flex: 1,
                fontSize: 11,
                color: 'rgba(255,255,255,0.7)',
                fontFamily: '"Space Mono", monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {f.path}
              </span>
              <span style={{
                fontSize: 8,
                padding: '2px 6px',
                borderRadius: 3,
                background: f.status === 'added'
                  ? 'rgba(74, 222, 128, 0.1)'
                  : f.status === 'deleted'
                  ? 'rgba(248, 113, 113, 0.1)'
                  : 'rgba(255,255,255,0.04)',
                color: f.status === 'added'
                  ? '#4ade80'
                  : f.status === 'deleted'
                  ? '#f87171'
                  : 'rgba(255,255,255,0.3)',
                fontWeight: 700,
                letterSpacing: '0.1em',
                flexShrink: 0,
              }}>
                {f.status === 'added' ? 'NEW' : f.status === 'deleted' ? 'DEL' : 'MOD'}
              </span>
              <span style={{
                fontSize: 10,
                color: 'rgba(255,255,255,0.25)',
                fontFamily: '"Space Mono", monospace',
                flexShrink: 0,
              }}>
                <span style={{ color: '#4ade80' }}>+{f.additions}</span>
                {' / '}
                <span style={{ color: '#f87171' }}>-{f.deletions}</span>
              </span>
              {onViewFile && (
                <button
                  onClick={() => onViewFile(f.path)}
                  title="View full file"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 8px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 3,
                    color: 'var(--pipe-text-dim)',
                    fontSize: 9,
                    fontFamily: '"Space Mono", monospace',
                    letterSpacing: '0.06em',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                    e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                    e.currentTarget.style.color = 'rgba(255,255,255,0.4)';
                  }}
                >
                  <ExternalLink size={10} />
                  VIEW FILE
                </button>
              )}
            </div>

            <FileDiffBody file={f} {...bodyProps} />
          </div>
        ))}
      </div>
    </div>
  );
}
