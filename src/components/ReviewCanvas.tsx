import { useState, MouseEvent } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { LiquidMetalCard } from './ui/LiquidMetalCard';
import { AlertTriangle, AlertCircle, X } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

export interface Annotation {
  line: number;
  comment: string;
  severity: 'critical' | 'major' | 'minor';
}

interface Snippet {
  id: string;
  code: string;
  language?: string;
  title?: string;
}

interface ReviewCanvasProps {
  snippets: Snippet[];
  onAnnotationsChange: (annotations: Record<string, Annotation[]>) => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * ReviewCanvas - Displays a code snippet for candidate review and allows inline annotation.
 *
 * Provides a syntax-highlighted code viewer with line numbers.
 * Candidates can click on line numbers to add comments and specify severity.
 * Supports multiple snippets with navigation.
 */
export function ReviewCanvas({
  snippets = [],
  onAnnotationsChange,
}: ReviewCanvasProps): JSX.Element {
  const [currentSnippetIndex, setCurrentSnippetIndex] = useState(0);
  const [annotations, setAnnotations] = useState<Record<string, Annotation[]>>({});
  const [activeLine, setActiveLine] = useState<{ snippetId: string; line: number } | null>(null);
  const [comment, setComment] = useState('');
  const [severity, setSeverity] = useState<Annotation['severity']>('major');

  if (!snippets || snippets.length === 0) {
    return (
      <LiquidMetalCard variant="dark" style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', fontSize: 12 }}>
          NO_SNIPPETS_AVAILABLE_FOR_REVIEW
        </div>
      </LiquidMetalCard>
    );
  }

  const currentSnippet = snippets[currentSnippetIndex];
  if (!currentSnippet) {
    return (
      <LiquidMetalCard variant="dark" style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', fontSize: 12 }}>
          NO_SNIPPETS_AVAILABLE_FOR_REVIEW
        </div>
      </LiquidMetalCard>
    );
  }

  const handleLineClick = (line: number): void => {
    setActiveLine({ snippetId: currentSnippet.id, line });
    
    // Check if there's an existing annotation for this line
    const existing = (annotations[currentSnippet.id] || []).find(a => a.line === line);
    if (existing) {
      setComment(existing.comment);
      setSeverity(existing.severity);
    } else {
      setComment('');
      setSeverity('major');
    }
  };

  const saveAnnotation = (): void => {
    if (!activeLine) return;

    const snippetAnnotations = annotations[currentSnippet.id] || [];
    const otherAnnotations = snippetAnnotations.filter(a => a.line !== activeLine.line);
    
    let newSnippetAnnotations;
    if (comment.trim() === '') {
      // Delete annotation if comment is empty
      newSnippetAnnotations = otherAnnotations;
    } else {
      newSnippetAnnotations = [
        ...otherAnnotations,
        { line: activeLine.line, comment: comment.trim(), severity }
      ];
    }

    const newAnnotations = {
      ...annotations,
      [currentSnippet.id]: newSnippetAnnotations
    };

    setAnnotations(newAnnotations);
    onAnnotationsChange(newAnnotations);
    setActiveLine(null);
  };

  const handleNext = (): void => {
    if (currentSnippetIndex < snippets.length - 1) {
      setCurrentSnippetIndex(currentSnippetIndex + 1);
      setActiveLine(null);
    }
  };

  const handlePrev = (): void => {
    if (currentSnippetIndex > 0) {
      setCurrentSnippetIndex(currentSnippetIndex - 1);
      setActiveLine(null);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <LiquidMetalCard variant="dark" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Header */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid var(--pipe-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--pipe-surface)',
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.2em',
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                marginBottom: 4
              }}
            >
              CODE_REVIEW_CANVAS
            </div>
            <div style={{ color: 'var(--pipe-text, #fff)', fontSize: 14, fontWeight: 700 }}>
              {currentSnippet.title || 'Untitled Snippet'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontSize: 10,
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                marginBottom: 4
              }}
            >
              SNIPPET {currentSnippetIndex + 1} OF {snippets.length}
            </div>
            <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
              {currentSnippet.language?.toUpperCase() || 'TYPESCRIPT'}
            </div>
          </div>
        </div>

        {/* Code Viewer */}
        <div style={{ padding: 0, position: 'relative' }}>
          <SyntaxHighlighter
            language={currentSnippet.language || 'typescript'}
            style={vscDarkPlus}
            showLineNumbers
            wrapLines={true}
            lineProps={(line: number) => {
              const hasAnnotation = (annotations[currentSnippet.id] || []).some(a => a.line === line);
              return {
                style: { 
                  cursor: 'pointer',
                  display: 'block',
                  background: hasAnnotation 
                    ? 'rgba(255,255,255,0.08)' 
                    : 'transparent',
                  transition: 'background 0.2s ease',
                },
                onClick: () => handleLineClick(line),
                onMouseEnter: (e: MouseEvent<HTMLElement>) => {
                  if (!hasAnnotation) e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                },
                onMouseLeave: (e: MouseEvent<HTMLElement>) => {
                  if (!hasAnnotation) e.currentTarget.style.background = 'transparent';
                }
              };
            }}
            customStyle={{
              margin: 0,
              padding: '24px',
              background: 'transparent',
              fontSize: 13,
              lineHeight: 1.6,
              fontFamily: '"Space Mono", monospace',
            }}
            lineNumberStyle={{
              minWidth: '3em',
              paddingRight: '1em',
              color: 'var(--pipe-text-dim)',
              textAlign: 'right',
              userSelect: 'none',
            }}
          >
            {currentSnippet.code}
          </SyntaxHighlighter>

          {/* Annotation Popup */}
          {activeLine && (
            <div
              style={{
                position: 'absolute', // Absolute instead of fixed to stay inside LiquidMetalCard context
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 100,
                width: 'calc(100% - 48px)',
                maxWidth: 400,
                background: '#161618',
                border: '1px solid var(--pipe-border)',
                borderRadius: 8,
                boxShadow: '0 24px 48px rgba(0,0,0,0.8)',
                padding: 24,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--pipe-text, #fff)' }}>
                  ANNOTATION: LINE {activeLine.line}
                </div>
                <button 
                  onClick={() => setActiveLine(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--pipe-text-dim)', cursor: 'pointer' }}
                >
                  <X size={16} />
                </button>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 10, color: 'var(--pipe-text-dim)', marginBottom: 8, fontFamily: '"Space Mono", monospace' }}>
                  SEVERITY
                </label>
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
                        borderRadius: 4,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      {s.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 10, color: 'var(--pipe-text-dim)', marginBottom: 8, fontFamily: '"Space Mono", monospace' }}>
                  OBSERVATION / FIX
                </label>
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
                    borderRadius: 4,
                    color: 'var(--pipe-text, #fff)',
                    padding: 12,
                    fontSize: 13,
                    fontFamily: 'inherit',
                    resize: 'none',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  onClick={saveAnnotation}
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: '#fff',
                    color: '#000',
                    border: 'none',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: '"Space Mono", monospace',
                    cursor: 'pointer',
                  }}
                >
                  SAVE_ANNOTATION
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer / Controls */}
        <div
          style={{
            padding: '20px 24px',
            borderTop: '1px solid var(--pipe-border)',
            background: 'var(--pipe-surface)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertCircle size={10} color="#f87171" />
              <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
                {(annotations[currentSnippet.id] || []).filter(a => a.severity === 'critical').length} CRITICAL
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={10} color="#fbbf24" />
              <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
                {(annotations[currentSnippet.id] || []).filter(a => a.severity === 'major').length} MAJOR
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handlePrev}
              disabled={currentSnippetIndex === 0}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                border: '1px solid var(--pipe-border)',
                color: currentSnippetIndex === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.4)',
                fontSize: 9,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                cursor: currentSnippetIndex === 0 ? 'not-allowed' : 'pointer'
              }}
            >
              PREVIOUS
            </button>
            <button
              onClick={handleNext}
              disabled={currentSnippetIndex === snippets.length - 1}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                border: '1px solid var(--pipe-border)',
                color: currentSnippetIndex === snippets.length - 1 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.4)',
                fontSize: 9,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                cursor: currentSnippetIndex === snippets.length - 1 ? 'not-allowed' : 'pointer'
              }}
            >
              NEXT
            </button>
          </div>
        </div>
      </LiquidMetalCard>
    </div>
  );
}
