import { useState, useEffect } from 'react';
import { FileCode, MessageSquare, AlignJustify, Rows3, ExternalLink } from 'lucide-react';
import { PierreDiffViewer } from './CodeReview/PierreDiffViewer';

export interface DiffLine {
  type: 'addition' | 'deletion' | 'context' | 'added' | 'deleted';
  num?: number;
  lineNumber?: number;
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
  onAcceptChange: _onAcceptChange,
  onDeclineChange: _onDeclineChange,
  inlineReplies: _inlineReplies,
  onInlineReplyChange: _onInlineReplyChange,
  onViewFile,
}: DiffPanelProps): JSX.Element {
  // These props are part of the DiffPanelProps API for the legacy renderer.
  // In the @pierre/diffs integration, annotations + threads are rendered inline.
  void _onAcceptChange;
  void _onDeclineChange;
  void _inlineReplies;
  void _onInlineReplyChange;
  const [viewMode, setViewMode] = useState<'TABBED' | 'LONG_FORM'>('TABBED');
  const [activeFileIdx, setActiveFileIdx] = useState(0);

  // Clamp active file index when diff changes (e.g., fewer files after reload)
  useEffect(() => {
    if (diff.files.length > 0 && activeFileIdx >= diff.files.length) {
      setActiveFileIdx(0);
    }
  }, [diff.files.length, activeFileIdx]);

  const [annotatingLine, setAnnotatingLine] = useState<number | null>(null);
  const [annotatingFilePath, setAnnotatingFilePath] = useState<string | null>(null);
  const [annotationSeverity, setAnnotationSeverity] = useState<'critical' | 'major' | 'minor'>('critical');
  const [annotationComment, setAnnotationComment] = useState('');

  const activeFile = diff.files.length > 0 ? diff.files[activeFileIdx] : null;

  if (!activeFile || diff.files.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0c0c0e' }}>
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
        File tabs
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
        Full diff
      </button>
    </div>
  );

  // ---------------------------------------------------------------------------
  // TABBED mode
  // ---------------------------------------------------------------------------

  if (viewMode === 'TABBED') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0c0c0e' }}>
        {/* File tabs + view toggle */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--pipe-border)',
          background: '#0c0c0e',
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
                borderBottom: i === activeFileIdx ? '2px solid var(--pipe-accent)' : '2px solid transparent',
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
              <FileCode size={12} color={i === activeFileIdx ? 'var(--pipe-accent)' : 'rgba(255,255,255,0.2)'} />
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
                {f.status === 'added' ? 'New' : f.status === 'deleted' ? 'Deleted' : 'Modified'}
              </span>
            </button>
          ))}
          </div>
          {viewToggle}
        </div>

        {/* Active file header */}
        <div style={{
          padding: '12px 24px',
          background: 'var(--pipe-surface)',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, color: 'var(--pipe-text-muted)', fontFamily: '"Space Mono", monospace' }}>
            {activeFile.path}
          </span>
          <span style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
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
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
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

        {/* Diff content — powered by @pierre/diffs */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }} data-testid="diff-content">
          <PierreDiffViewer
            mode="single-file"
            file={activeFile}
            annotations={annotations}
            readOnly={readOnly}
            resolvedLines={resolvedLines ?? []}
            inlineThreads={inlineThreads ?? []}
            onLineClick={handleLineClick}
          />

          {/* Inline annotation form (shown when user clicks to annotate) */}
          {annotatingLine !== null && annotatingFilePath === activeFile.path && (
            <div style={{
              padding: '12px 24px',
              background: 'rgba(167, 139, 250, 0.03)',
              border: '1px solid rgba(167, 139, 250, 0.2)',
              borderRadius: 6,
              margin: '8px 16px',
            }} data-testid="annotation-editor-form">
              <div style={{
                padding: '8px 0',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <MessageSquare size={12} color="var(--pipe-accent)" />
                <span style={{
                  fontSize: 10,
                  color: 'var(--pipe-text-muted)',
                  fontFamily: '"Space Mono", monospace',
                }}>
                  Comment on line {annotatingLine}
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  {(['critical', 'major', 'minor'] as const).map((sev) => {
                    const isActive = annotationSeverity === sev;
                    const sevCfg = severityColors[sev];
                    return (
                      <button
                        key={sev}
                        onClick={() => setAnnotationSeverity(sev)}
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
                          color: isActive ? sevCfg.text : 'var(--pipe-text-dim)',
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
              <textarea
                value={annotationComment}
                onChange={e => setAnnotationComment(e.target.value.slice(0, 500))}
                placeholder="Leave a comment..."
                autoFocus
                rows={4}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 4,
                  color: 'var(--pipe-text, #fff)',
                  fontSize: 12,
                  padding: '12px 14px',
                  fontFamily: '"Space Mono", monospace',
                  outline: 'none',
                  resize: 'vertical',
                  lineHeight: 1.6,
                }}
                data-testid="annotation-input"
              />
              <div style={{
                marginTop: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 8,
              }}>
                <span style={{
                  fontSize: 8,
                  color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                  marginRight: 'auto',
                }}>
                  {annotationComment.length}/500
                </span>
                <button
                  onClick={handleCancel}
                  style={{
                    padding: '7px 16px',
                    background: 'transparent',
                    border: '1px solid var(--pipe-border)',
                    borderRadius: 4,
                    color: 'var(--pipe-text-dim)',
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: '"Space Mono", monospace',
                  }}
                  data-testid="cancel-annotation-btn"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!annotationComment.trim()}
                  style={{
                    padding: '7px 20px',
                    background: annotationComment.trim() ? 'var(--pipe-accent-surface)' : 'var(--pipe-surface)',
                    border: `1px solid ${annotationComment.trim() ? 'var(--pipe-accent-border)' : 'rgba(255,255,255,0.06)'}`,
                    borderRadius: 4,
                    color: annotationComment.trim() ? 'var(--pipe-accent)' : 'rgba(255,255,255,0.15)',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    cursor: annotationComment.trim() ? 'pointer' : 'not-allowed',
                    fontFamily: '"Space Mono", monospace',
                  }}
                  data-testid="save-annotation-btn"
                >
                  Comment
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // LONG_FORM mode — all files via @pierre/diffs multi-file patch
  // ---------------------------------------------------------------------------

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0c0c0e' }}>
      {/* Header bar with stats + view toggle */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: '1px solid var(--pipe-border)',
        background: '#0c0c0e',
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

      {/* Diff content — powered by @pierre/diffs (one PatchDiff per file) */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }} data-testid="diff-content">
        {diff.files.map((file) => (
          <PierreDiffViewer
            key={file.path}
            mode="single-file"
            file={file}
            annotations={annotations.filter((a) => a.file === file.path)}
            readOnly={readOnly}
            resolvedLines={(resolvedLines ?? []).filter((r) => r.file === file.path)}
            inlineThreads={(inlineThreads ?? []).filter((t) => t.file === file.path)}
            onLineClick={handleLineClick}
          />
        ))}

        {/* Inline annotation form (shown when user clicks to annotate) */}
        {annotatingLine !== null && annotatingFilePath !== null && (
          <div style={{
            padding: '12px 24px',
            background: 'rgba(167, 139, 250, 0.03)',
            border: '1px solid rgba(167, 139, 250, 0.2)',
            borderRadius: 6,
            margin: '8px 16px',
          }} data-testid="annotation-editor-form">
            <div style={{
              padding: '8px 0',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <MessageSquare size={12} color="var(--pipe-accent)" />
              <span style={{
                fontSize: 10,
                color: 'var(--pipe-text-muted)',
                fontFamily: '"Space Mono", monospace',
              }}>
                Comment on {annotatingFilePath}:{annotatingLine}
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {(['critical', 'major', 'minor'] as const).map((sev) => {
                  const isActive = annotationSeverity === sev;
                  const sevCfg = severityColors[sev];
                  return (
                    <button
                      key={sev}
                      onClick={() => setAnnotationSeverity(sev)}
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
                        color: isActive ? sevCfg.text : 'var(--pipe-text-dim)',
                        cursor: 'pointer',
                      }}
                    >
                      {sev}
                    </button>
                  );
                })}
              </div>
            </div>
            <textarea
              value={annotationComment}
              onChange={e => setAnnotationComment(e.target.value.slice(0, 500))}
              placeholder="Leave a comment..."
              autoFocus
              rows={4}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4,
                color: 'var(--pipe-text, #fff)',
                fontSize: 12,
                padding: '12px 14px',
                fontFamily: '"Space Mono", monospace',
                outline: 'none',
                resize: 'vertical',
                lineHeight: 1.6,
              }}
              data-testid="annotation-input"
            />
            <div style={{
              marginTop: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 8,
            }}>
              <span style={{
                fontSize: 8,
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                marginRight: 'auto',
              }}>
                {annotationComment.length}/500
              </span>
              <button
                onClick={handleCancel}
                style={{
                  padding: '7px 16px',
                  background: 'transparent',
                  border: '1px solid var(--pipe-border)',
                  borderRadius: 4,
                  color: 'var(--pipe-text-dim)',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: '"Space Mono", monospace',
                }}
                data-testid="cancel-annotation-btn"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!annotationComment.trim()}
                style={{
                  padding: '7px 20px',
                  background: annotationComment.trim() ? 'var(--pipe-accent-surface)' : 'var(--pipe-surface)',
                  border: `1px solid ${annotationComment.trim() ? 'var(--pipe-accent-border)' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: 4,
                  color: annotationComment.trim() ? 'var(--pipe-accent)' : 'rgba(255,255,255,0.15)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  cursor: annotationComment.trim() ? 'pointer' : 'not-allowed',
                  fontFamily: '"Space Mono", monospace',
                }}
                data-testid="save-annotation-btn"
              >
                Comment
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
