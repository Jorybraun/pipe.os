import { useMemo, useCallback, useRef } from 'react';
import { PatchDiff } from '@pierre/diffs/react';
import type { DiffLineAnnotation } from '@pierre/diffs/react';
import { MessageSquare, Plus } from 'lucide-react';
import type { DiffFile, Annotation, InlineThread, ResolvedLine } from '../DiffPanel';
import { diffFileToPatch, diffJsonToPatch } from './diffJsonToPatch';
import type { DiffJson } from '../DiffPanel';

// ============================================================================
// Types
// ============================================================================

/** Metadata attached to each Pierre DiffLineAnnotation */
interface AnnotationMeta {
  annotation?: Annotation;
  thread?: InlineThread | undefined;
  resolved?: boolean;
}

interface PierreDiffViewerProps {
  /** Render a single file or full multi-file diff */
  mode: 'single-file' | 'multi-file';
  /** Full diff data (used for multi-file mode) */
  diff?: DiffJson;
  /** Single file to render (used for single-file mode) */
  file?: DiffFile;
  /** Existing annotations to display inline */
  annotations?: Annotation[];
  /** Whether annotation interaction is disabled */
  readOnly?: boolean;
  /** Lines that have been resolved */
  resolvedLines?: ResolvedLine[];
  /** Thread exchanges for inline display */
  inlineThreads?: InlineThread[];
  /** Called when user clicks to add annotation on a line */
  onLineClick?: (filePath: string, lineNum: number) => void;
}

// ============================================================================
// Severity styling
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
// Component
// ============================================================================

export function PierreDiffViewer({
  mode,
  diff,
  file,
  annotations = [],
  readOnly = false,
  resolvedLines = [],
  inlineThreads = [],
  onLineClick,
}: PierreDiffViewerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  // Build the patch string from DiffJson
  const patchString = useMemo(() => {
    if (mode === 'single-file' && file) {
      return diffFileToPatch(file);
    }
    if (mode === 'multi-file' && diff) {
      return diffJsonToPatch(diff);
    }
    return '';
  }, [mode, file, diff]);

  // Convert our Annotation[] to DiffLineAnnotation<AnnotationMeta>[]
  const lineAnnotations = useMemo((): DiffLineAnnotation<AnnotationMeta>[] => {
    const result: DiffLineAnnotation<AnnotationMeta>[] = [];

    for (const ann of annotations) {
      // Find if there's a matching thread
      const thread = inlineThreads.find(
        (t) => t.file === ann.file && t.line === ann.line
      );
      const resolved = resolvedLines.some(
        (r) => r.file === ann.file && r.line === ann.line
      );

      result.push({
        side: 'additions' as const,
        lineNumber: ann.line,
        metadata: { annotation: ann, thread: thread ?? undefined, resolved },
      });
    }

    return result;
  }, [annotations, inlineThreads, resolvedLines]);

  // Custom annotation renderer
  const renderAnnotation = useCallback(
    (annData: DiffLineAnnotation<AnnotationMeta>) => {
      const meta = annData.metadata;
      if (!meta?.annotation) return null;

      const { annotation: ann, thread, resolved } = meta;
      const sevColors = severityColors[ann.severity];

      return (
        <div
          style={{
            padding: '10px 16px',
            background: sevColors.bg,
            borderTop: `1px solid ${sevColors.border}`,
            borderBottom: `1px solid ${sevColors.border}`,
            fontFamily: '"Space Mono", monospace',
          }}
        >
          {/* Annotation header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 6,
            }}
          >
            <MessageSquare size={10} color={sevColors.text} />
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: sevColors.text,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              {ann.severity}
            </span>
            {resolved && (
              <span
                style={{
                  fontSize: 7,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: '#34d399',
                  background: 'rgba(52,211,153,0.12)',
                  padding: '2px 5px',
                  borderRadius: 2,
                }}
              >
                RESOLVED
              </span>
            )}
          </div>

          {/* Comment body */}
          <p
            style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.65)',
              lineHeight: 1.6,
              margin: 0,
              fontFamily: '"Space Mono", monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {ann.comment}
          </p>

          {/* Thread exchanges */}
          {thread && thread.exchanges.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {thread.exchanges.map((exchange, idx) => {
                const isImplementer = exchange.actor === 'implementer';
                const moveColorMap = {
                  change: '#34d399',
                  pushback: '#f87171',
                  comment: 'var(--pipe-accent, #a78bfa)',
                } as const;
                type MoveKey = keyof typeof moveColorMap;
                const moveKey: MoveKey = (exchange.move ?? 'comment') as MoveKey;
                const color = moveColorMap[moveKey in moveColorMap ? moveKey : 'comment'];

                return (
                  <div
                    key={`ex-${idx}`}
                    style={{
                      padding: '8px 12px',
                      borderLeft: `3px solid ${color}`,
                      marginTop: 6,
                      background: 'rgba(255,255,255,0.02)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginBottom: 4,
                      }}
                    >
                      {isImplementer && exchange.move && (
                        <span
                          style={{
                            fontSize: 8,
                            fontWeight: 700,
                            letterSpacing: '0.1em',
                            color,
                            padding: '1px 6px',
                            background: `${color}15`,
                            borderRadius: 3,
                          }}
                        >
                          {exchange.move.toUpperCase()}
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: 8,
                          color: isImplementer
                            ? 'var(--pipe-accent, #a78bfa)'
                            : 'rgba(96,165,250,0.6)',
                          letterSpacing: '0.08em',
                          fontWeight: 600,
                        }}
                      >
                        {isImplementer ? 'AUTHOR' : 'YOU'}
                      </span>
                      <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.15)' }}>
                        R{exchange.round}
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: 11,
                        color: 'var(--pipe-text-muted, rgba(255,255,255,0.5))',
                        lineHeight: 1.6,
                        margin: 0,
                        fontFamily: '"Space Mono", monospace',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {exchange.content}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    },
    []
  );

  // Gutter utility: "+" button to add annotation on hover
  const renderGutterUtility = useCallback(
    (getHoveredLine: () => { lineNumber: number; side: string } | undefined) => {
      if (readOnly) return null;

      return (
        <button
          onClick={() => {
            const hovered = getHoveredLine();
            if (hovered && onLineClick) {
              // Determine file path from the file prop or first file in diff
              const filePath =
                file?.path ?? diff?.files[0]?.path ?? 'unknown';
              onLineClick(filePath, hovered.lineNumber);
            }
          }}
          style={{
            width: 20,
            height: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(167, 139, 250, 0.1)',
            border: '1px solid rgba(167, 139, 250, 0.3)',
            borderRadius: 4,
            cursor: 'pointer',
            color: '#a78bfa',
            transition: 'all 0.15s',
          }}
          title="Add comment"
        >
          <Plus size={12} />
        </button>
      );
    },
    [readOnly, onLineClick, file, diff]
  );

  if (!patchString) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: 'center',
          color: 'var(--pipe-text-dim)',
          fontFamily: '"Space Mono", monospace',
          fontSize: 12,
        }}
      >
        NO_DIFF_DATA_AVAILABLE
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="pierre-diff-viewer"
      style={{ flex: 1, minHeight: 0, overflow: 'auto' }}
    >
      <PatchDiff<AnnotationMeta>
        patch={patchString}
        options={{
          themeType: 'dark',
          diffStyle: 'unified',
          diffIndicators: 'bars',
          hunkSeparators: 'line-info',
          overflow: 'scroll',
          disableLineNumbers: false,
          disableBackground: false,
          lineDiffType: 'word-alt',
          unsafeCSS: `
            :host {
              --font-family: "Space Mono", monospace;
              --font-size: 12px;
              --line-height: 1.6;
              font-family: "Space Mono", monospace;
            }
          `,
        }}
        lineAnnotations={lineAnnotations}
        renderAnnotation={renderAnnotation}
        renderGutterUtility={renderGutterUtility}
      />
    </div>
  );
}
