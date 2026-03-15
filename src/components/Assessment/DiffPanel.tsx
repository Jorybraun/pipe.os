import { useState } from 'react';
import { FileCode, MessageSquare } from 'lucide-react';

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
}

export function DiffPanel({
  diff,
  annotations = [],
  onAnnotationAdd,
  readOnly = false,
}: DiffPanelProps): JSX.Element {
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [annotatingLine, setAnnotatingLine] = useState<number | null>(null);
  const [annotationSeverity, setAnnotationSeverity] = useState<'critical' | 'major' | 'minor'>('critical');
  const [annotationComment, setAnnotationComment] = useState('');

  const file = diff.files.length > 0 ? diff.files[activeFileIdx] : null;

  if (!file) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(12, 12, 14, 0.5)' }}>
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,255,255,0.3)',
          fontSize: 12,
        }}>
          No diff files available
        </div>
      </div>
    );
  }

  const handleAddAnnotation = (): void => {
    if (annotatingLine !== null && annotationComment.trim() && onAnnotationAdd) {
      onAnnotationAdd({
        file: file.path,
        line: annotatingLine,
        severity: annotationSeverity,
        comment: annotationComment,
      });
      setAnnotationComment('');
      setAnnotationSeverity('critical');
      setAnnotatingLine(null);
    }
  };

  const getAnnotationsForLine = (lineNum: number): Annotation[] => {
    return annotations.filter(a => a.file === file.path && a.line === lineNum);
  };

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
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'rgba(12, 12, 14, 0.5)' }}>
      {/* File tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(12, 12, 14, 0.6)',
        overflowX: 'auto',
      }}>
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

      {/* File header */}
      <div style={{
        padding: '12px 24px',
        background: 'rgba(255,255,255,0.02)',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: '"Space Mono", monospace' }}>
          {file.path}
        </span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontFamily: '"Space Mono", monospace' }}>
          <span style={{ color: '#4ade80' }}>+{file.additions}</span>
          {' / '}
          <span style={{ color: '#f87171' }}>-{file.deletions}</span>
        </span>
      </div>

      {/* Diff content */}
      <div style={{ flex: 1, overflowY: 'auto' }} data-testid="diff-content">
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

              return (
                <div key={lineIdx}>
                  <div
                    onClick={() => {
                      if (!readOnly && line.type !== 'deletion') {
                        setAnnotatingLine(annotatingLine === line.num ? null : line.num);
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
                    {/* Line number */}
                    <div style={{
                      width: 56,
                      padding: '4px 12px',
                      textAlign: 'right',
                      fontSize: 10,
                      color: 'rgba(255,255,255,0.15)',
                      userSelect: 'none',
                      flexShrink: 0,
                      fontFamily: '"Space Mono", monospace',
                    }}>
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
                    {lineAnnotations.length > 0 && (
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
                            background: severityColors[lineAnnotations[0].severity].badge,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 8,
                            color: severityColors[lineAnnotations[0].severity].text,
                            fontWeight: 700,
                          }}
                          title={`${lineAnnotations.length} annotation(s)`}
                          data-testid={`annotation-badge-${line.num}`}
                        >
                          {lineAnnotations.length}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Annotation input form */}
                  {annotatingLine === line.num && !readOnly && (
                    <div style={{
                      padding: '12px 24px 12px 78px',
                      background: 'rgba(167, 139, 250, 0.03)',
                      borderTop: '1px solid rgba(167, 139, 250, 0.1)',
                      borderBottom: '1px solid rgba(167, 139, 250, 0.1)',
                      display: 'flex',
                      gap: 8,
                      flexDirection: 'column',
                    }} data-testid="annotation-editor-form">
                      <div style={{ display: 'flex', gap: 8 }}>
                        <select
                          value={annotationSeverity}
                          onChange={e => setAnnotationSeverity(e.target.value as any)}
                          style={{
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            color: '#fff',
                            fontSize: 10,
                            padding: '8px 10px',
                            fontFamily: '"Space Mono", monospace',
                            outline: 'none',
                            borderRadius: 2,
                            cursor: 'pointer',
                          }}
                          data-testid="severity-selector"
                        >
                          <option value="critical">🔴 CRITICAL</option>
                          <option value="major">🟠 MAJOR</option>
                          <option value="minor">🔵 MINOR</option>
                        </select>
                        <input
                          type="text"
                          value={annotationComment}
                          onChange={e => setAnnotationComment(e.target.value.slice(0, 500))}
                          placeholder="Add comment (max 500 chars)..."
                          autoFocus
                          style={{
                            flex: 1,
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            color: '#fff',
                            fontSize: 10,
                            padding: '8px 12px',
                            fontFamily: '"Space Mono", monospace',
                            outline: 'none',
                            borderRadius: 2,
                          }}
                          data-testid="annotation-input"
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={handleAddAnnotation}
                          disabled={!annotationComment.trim()}
                          style={{
                            flex: 1,
                            padding: '8px 16px',
                            background: annotationComment.trim() ? 'rgba(167,139,250,0.15)' : 'rgba(167,139,250,0.05)',
                            border: annotationComment.trim() ? '1px solid rgba(167,139,250,0.3)' : '1px solid rgba(167,139,250,0.1)',
                            color: annotationComment.trim() ? '#a78bfa' : 'rgba(167,139,250,0.3)',
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: '0.1em',
                            cursor: annotationComment.trim() ? 'pointer' : 'not-allowed',
                            fontFamily: 'inherit',
                            borderRadius: 2,
                            transition: 'all 0.2s',
                          }}
                          data-testid="save-annotation-btn"
                        >
                          SAVE
                        </button>
                        <button
                          onClick={() => {
                            setAnnotatingLine(null);
                            setAnnotationComment('');
                          }}
                          style={{
                            padding: '8px 16px',
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            color: 'rgba(255,255,255,0.3)',
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: '0.1em',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            borderRadius: 2,
                          }}
                          data-testid="cancel-annotation-btn"
                        >
                          CANCEL
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Display annotations */}
                  {lineAnnotations.map((annotation) => (
                    <div key={annotation.id} style={{
                      padding: '10px 24px 10px 78px',
                      background: severityColors[annotation.severity].bg,
                      borderTop: `1px solid ${severityColors[annotation.severity].border}`,
                      borderBottom: `1px solid ${severityColors[annotation.severity].border}`,
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
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
