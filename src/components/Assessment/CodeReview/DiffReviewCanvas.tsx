import { useState, useMemo, useCallback } from 'react';
import { parseDiff, Diff, Hunk } from 'react-diff-view';
import 'react-diff-view/style/index.css';
import { formatCustomDiff } from './diffUtils';
import { LiquidMetalCard } from '../../ui/LiquidMetalCard';
import { Annotation } from '../../ReviewCanvas';
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface Snippet {
  id: string;
  code: string;
  language?: string;
  title?: string;
}

interface DiffReviewCanvasProps {
  snippets: Snippet[];
  onAnnotationsChange: (annotations: Record<string, Annotation[]>) => void;
}

// ============================================================================
// Component
// ============================================================================

export function DiffReviewCanvas({
  snippets = [],
  onAnnotationsChange,
}: DiffReviewCanvasProps): JSX.Element {
  const [currentSnippetIndex, setCurrentSnippetIndex] = useState(0);
  const [annotations, setAnnotations] = useState<Record<string, Annotation[]>>({});
  const [activeLine, setActiveLine] = useState<{ snippetId: string; line: number } | null>(null);
  const [comment, setComment] = useState('');
  const [severity, setSeverity] = useState<Annotation['severity']>('major');

  const currentSnippet = snippets[currentSnippetIndex];

  // Parse the code into a "fake" addition diff
  const diff = useMemo(() => {
    if (!currentSnippet) {
      console.warn('[DiffReviewCanvas] No current snippet provided.');
      return null;
    }
    
    if (!currentSnippet.code) {
      console.warn('[DiffReviewCanvas] Snippet code is empty:', currentSnippet.id);
      return null;
    }

    try {
      const diffText = formatCustomDiff(currentSnippet.code, currentSnippet.title || 'file.ts');
      const [parsed] = parseDiff(diffText);
      
      console.log('[DiffReviewCanvas] Parsed diff successfully:', {
        id: currentSnippet.id,
        lineCount: currentSnippet.code.split('\n').length,
        hunkCount: parsed?.hunks?.length
      });
      
      return parsed;
    } catch (err) {
      console.error('[DiffReviewCanvas] Failed to parse diff:', err);
      return null;
    }
  }, [currentSnippet]);

  if (!currentSnippet || !diff) {
    return (
      <LiquidMetalCard variant="dark" style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', fontSize: 12 }}>
          NO_SNIPPETS_AVAILABLE_FOR_REVIEW
        </div>
      </LiquidMetalCard>
    );
  }

  const handleLineClick = useCallback((line: number) => {
    setActiveLine({ snippetId: currentSnippet.id, line });
    const existing = (annotations[currentSnippet.id] || []).find(a => a.line === line);
    if (existing) {
      setComment(existing.comment);
      setSeverity(existing.severity);
    } else {
      setComment('');
      setSeverity('major');
    }
  }, [annotations, currentSnippet.id]);

  const saveAnnotation = useCallback(() => {
    if (!activeLine) return;
    const snippetAnnotations = annotations[currentSnippet.id] || [];
    const otherAnnotations = snippetAnnotations.filter(a => a.line !== activeLine.line);
    
    let newSnippetAnnotations;
    if (comment.trim() === '') {
      newSnippetAnnotations = otherAnnotations;
    } else {
      newSnippetAnnotations = [
        ...otherAnnotations,
        { line: activeLine.line, comment: comment.trim(), severity }
      ];
    }

    const newAnnotations = { ...annotations, [currentSnippet.id]: newSnippetAnnotations };
    setAnnotations(newAnnotations);
    onAnnotationsChange(newAnnotations);
    setActiveLine(null);
  }, [activeLine, annotations, comment, currentSnippet.id, onAnnotationsChange, severity]);

  const handleNext = useCallback(() => {
    if (currentSnippetIndex < snippets.length - 1) {
      setCurrentSnippetIndex(currentSnippetIndex + 1);
      setActiveLine(null);
    }
  }, [currentSnippetIndex, snippets.length]);

  const handlePrev = useCallback(() => {
    if (currentSnippetIndex > 0) {
      setCurrentSnippetIndex(currentSnippetIndex - 1);
      setActiveLine(null);
    }
  }, [currentSnippetIndex]);

  // Create widgets array for react-diff-view
  const widgets = useMemo(() => {
    const currentSnippetAnnotations = annotations[currentSnippet.id] || [];
    const widgetList: Record<string, JSX.Element> = {};

    currentSnippetAnnotations.forEach(a => {
      widgetList[`+${a.line}`] = (
        <div key={`view-${a.line}`} style={{
          padding: '16px 24px',
          background: 'var(--pipe-surface)',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          borderBottom: '1px solid var(--pipe-border-light)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              {a.severity === 'critical' ? <AlertCircle size={14} color="#f87171" /> : 
               a.severity === 'major' ? <AlertTriangle size={14} color="#fbbf24" /> : 
               <Info size={14} color="#60a5fa" />}
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
                {a.severity.toUpperCase()}
              </span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--pipe-text, #fff)', lineHeight: 1.6 }}>{a.comment}</div>
          </div>
          <button 
            onClick={() => handleLineClick(a.line)}
            style={{ background: 'none', border: 'none', color: 'var(--pipe-text-dim)', cursor: 'pointer', fontSize: 11, fontFamily: '"Space Mono", monospace' }}
          >
            EDIT
          </button>
        </div>
      );
    });

    if (activeLine && activeLine.snippetId === currentSnippet.id) {
      widgetList[`+${activeLine.line}`] = (
        <div key="editor" style={{
          padding: 24,
          background: '#161618',
          borderTop: '1px solid var(--pipe-border)',
          borderBottom: '1px solid var(--pipe-border)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pipe-text, #fff)', fontFamily: '"Space Mono", monospace' }}>
              NEW_ANNOTATION: LINE {activeLine.line}
            </div>
            <button onClick={() => setActiveLine(null)} style={{ background: 'none', border: 'none', color: 'var(--pipe-text-dim)', cursor: 'pointer' }}>
              <X size={16} />
            </button>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['critical', 'major', 'minor'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setSeverity(s)}
                  style={{
                    flex: 1,
                    padding: '8px 4px',
                    fontSize: 9,
                    fontFamily: '"Space Mono", monospace',
                    background: severity === s ? 'rgba(255,255,255,0.1)' : 'transparent',
                    border: severity === s ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(255,255,255,0.05)',
                    color: severity === s ? '#fff' : 'rgba(255,255,255,0.3)',
                    cursor: 'pointer'
                  }}
                >
                  {s.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <textarea
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Describe the bug or suggest a fix..."
            style={{
              width: '100%',
              height: 100,
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid var(--pipe-border)',
              color: 'var(--pipe-text, #fff)',
              padding: 12,
              fontSize: 13,
              fontFamily: 'inherit',
              resize: 'none',
              outline: 'none',
              marginBottom: 16
            }}
          />

          <button
            onClick={saveAnnotation}
            style={{
              width: '100%',
              padding: '12px',
              background: '#fff',
              color: '#000',
              border: 'none',
              fontSize: 11,
              fontWeight: 700,
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer',
            }}
          >
            SAVE_ANNOTATION
          </button>
        </div>
      );
    }

    return widgetList;
  }, [annotations, currentSnippet.id, activeLine, comment, severity, handleLineClick, saveAnnotation]);

  return (
    <div className="diff-review-container">
      <LiquidMetalCard variant="dark" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--pipe-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--pipe-surface)' }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 4 }}>CODE_REVIEW_DIFF_VIEW</div>
            <div style={{ color: 'var(--pipe-text, #fff)', fontSize: 14, fontWeight: 700 }}>{currentSnippet.title || 'Untitled Snippet'}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 4 }}>SNIPPET {currentSnippetIndex + 1} OF {snippets.length}</div>
            <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>{currentSnippet.language?.toUpperCase() || 'TYPESCRIPT'}</div>
          </div>
        </div>

        <div style={{ background: '#0c0c0e', padding: '12px 0' }}>
          {diff.hunks ? (
            <Diff 
              hunks={diff.hunks || []} 
              viewType="unified" 
              diffType="add" 
              widgets={widgets}
              gutterEvents={{
                onClick: ({ change }) => {
                  if (change) handleLineClick((change as any).lineNumber || (change as any).newLineNumber);
                }
              }}
              codeEvents={{
                onClick: ({ change }) => {
                  if (change) handleLineClick((change as any).lineNumber || (change as any).newLineNumber);
                }
              }}
            >
              {hunks => hunks.map(hunk => (
                <Hunk key={hunk.content} hunk={hunk} />
              ))}
            </Diff>
          ) : (
            <div style={{ padding: 40 }}>
              <div style={{ color: '#f87171', fontSize: 11, marginBottom: 20, fontFamily: 'Space Mono' }}>DIFF_PARSER_FAILED_SHOWING_RAW_CODE</div>
              <pre style={{ color: 'var(--pipe-text, #fff)', fontSize: 13, fontFamily: 'Space Mono', lineHeight: 1.6 }}>
                {currentSnippet.code}
              </pre>
            </div>
          )}
        </div>

        <div style={{ padding: '20px 24px', borderTop: '1px solid var(--pipe-border)', background: 'var(--pipe-surface)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
            CLICK_LINE_NUMBER_TO_ANNOTATE
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handlePrev} disabled={currentSnippetIndex === 0} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--pipe-border)', color: currentSnippetIndex === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.4)', fontSize: 9, fontFamily: '"Space Mono", monospace', cursor: currentSnippetIndex === 0 ? 'not-allowed' : 'pointer' }}>PREVIOUS</button>
            <button onClick={handleNext} disabled={currentSnippetIndex === snippets.length - 1} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--pipe-border)', color: currentSnippetIndex === snippets.length - 1 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.4)', fontSize: 9, fontFamily: '"Space Mono", monospace', cursor: currentSnippetIndex === snippets.length - 1 ? 'not-allowed' : 'pointer' }}>NEXT</button>
          </div>
        </div>
      </LiquidMetalCard>

      <style>{`
        .diff-review-container .diff {
          font-family: "Space Mono", monospace;
          font-size: 13px;
          border: none;
          background: transparent;
        }
        .diff-review-container .diff-table {
          background: transparent;
          border-collapse: collapse;
          width: 100%;
        }
        .diff-review-container .diff-gutter {
          background: rgba(255,255,255,0.02);
          color: rgba(255,255,255,0.2);
          border-right: 1px solid rgba(255,255,255,0.05);
          cursor: pointer;
          min-width: 50px;
          text-align: right;
          padding-right: 12px !important;
          user-select: none;
        }
        .diff-review-container .diff-gutter:hover {
          color: #fff;
          background: rgba(255,255,255,0.05);
        }
        .diff-review-container .diff-code {
          color: rgba(255,255,255,0.85);
          padding-left: 20px !important;
          background: transparent;
          line-height: 1.6;
          cursor: pointer;
        }
        .diff-review-container .diff-line {
          background: transparent;
        }
        .diff-review-container .diff-line-add {
          background: transparent;
        }
        .diff-review-container .diff-line-add .diff-code {
          background: transparent;
        }
        .diff-review-container .diff-widget-content {
          background: transparent;
          padding: 0;
        }
        .diff-review-container .diff-hunk-header {
          display: none;
        }
        
        /* Syntax highlighting overrides for the diff view */
        .diff-review-container .diff-code .token.keyword { color: #c678dd; }
        .diff-review-container .diff-code .token.function { color: #61afef; }
        .diff-review-container .diff-code .token.string { color: #98c379; }
        .diff-review-container .diff-code .token.comment { color: #5c6370; font-style: italic; }
        .diff-review-container .diff-code .token.operator { color: #56b6c2; }
        .diff-review-container .diff-code .token.class-name { color: #e5c07b; }
        .diff-review-container .diff-code .token.number { color: #d19a66; }
      `}</style>
    </div>
  );
}
