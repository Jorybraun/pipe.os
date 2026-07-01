import { lazy, Suspense, useMemo } from 'react';
import { MessageSquare } from 'lucide-react';
import type { ComponentType } from 'react';
import type { DiffLineAnnotation, PatchDiffProps } from '@pierre/diffs/react';
import type { FileDiffOptions, OnDiffLineClickProps, PostRenderPhase } from '@pierre/diffs';
import type {
  Annotation,
  DiffFile,
  DiffJson,
  InlineThread,
  ResolvedLine,
} from '../DiffPanel';
import { diffFileToPatch } from './diffJsonToPatch';

interface PierreDiffViewerProps {
  /** Render a single file or full multi-file diff. */
  mode: 'single-file' | 'multi-file';
  /** Full diff data, used for multi-file mode. */
  diff?: DiffJson;
  /** Single file to render, used for single-file mode. */
  file?: DiffFile;
  /** Existing annotations to display inline. */
  annotations?: Annotation[];
  /** Whether annotation interaction is disabled. */
  readOnly?: boolean;
  /** Lines that have been resolved. */
  resolvedLines?: ResolvedLine[];
  /** Thread exchanges for inline display. */
  inlineThreads?: InlineThread[];
  /** Called when user clicks to add annotation on a line. */
  onLineClick?: (filePath: string, lineNum: number) => void;
}

interface PipeDiffAnnotationMetadata {
  annotation: Annotation;
  thread: InlineThread | undefined;
  resolved: boolean;
}

type PipeDiffLineAnnotation = DiffLineAnnotation<PipeDiffAnnotationMetadata>;

function inlineMoveLabel(move: InlineThread['exchanges'][number]['move']): string {
  if (!move) return '';
  if (move === 'pushback') return 'AUTHOR REPLY';
  return move.toUpperCase();
}

const PierrePatchDiff = lazy(async () => {
  const module = await import('@pierre/diffs/react');
  return {
    default: module.PatchDiff as ComponentType<PatchDiffProps<PipeDiffAnnotationMetadata>>,
  };
});

const severityColors = {
  critical: {
    bg: 'rgba(248, 113, 113, 0.08)',
    border: 'rgba(248, 113, 113, 0.2)',
    text: '#f87171',
  },
  major: {
    bg: 'rgba(251, 191, 36, 0.08)',
    border: 'rgba(251, 191, 36, 0.2)',
    text: '#fbbf24',
  },
  minor: {
    bg: 'rgba(96, 165, 250, 0.08)',
    border: 'rgba(96, 165, 250, 0.2)',
    text: '#60a5fa',
  },
} as const;

const PIERRE_UNSAFE_CSS = `
  :host {
    --diffs-font-family: "Space Mono", monospace;
    --diffs-header-font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --diffs-font-size: 12px;
    --diffs-line-height: 21px;
    --diffs-dark-bg: rgba(7, 12, 20, 0.72);
    --diffs-dark: rgba(244, 248, 255, 0.9);
    --diffs-bg-context-override: rgba(244, 248, 255, 0.025);
    --diffs-bg-context-gutter-override: rgba(185, 221, 255, 0.06);
    --diffs-bg-separator-override: rgba(73, 127, 171, 0.14);
    --diffs-bg-addition-override: rgba(52, 211, 153, 0.13);
    --diffs-bg-deletion-override: rgba(248, 113, 113, 0.13);
    --diffs-addition-color-override: #5ee787;
    --diffs-deletion-color-override: #fca5a5;
    --diffs-fg-number-override: rgba(185, 221, 255, 0.42);
    --diffs-bg-hover-override: #b9ddff;
    border: 0;
    background: transparent;
  }

  [data-diff] {
    min-width: 760px;
  }

  [data-line],
  [data-column-number],
  [data-line-annotation],
  [data-gutter-buffer] {
    border-bottom: 1px solid rgba(244, 248, 255, 0.025);
  }

  [data-line] {
    cursor: pointer;
  }

  [data-line-type="change-deletion"] {
    cursor: default;
  }

  [data-separator] {
    color: rgba(185, 221, 255, 0.7);
    border-block: 1px solid rgba(73, 127, 171, 0.18);
  }

  [data-line-annotation] {
    padding-block: 0;
  }
`;

function isAnnotatableLine(props: OnDiffLineClickProps): boolean {
  return props.lineType !== 'change-deletion';
}

function toLineAnnotations(
  file: DiffFile,
  annotations: Annotation[],
  inlineThreads: InlineThread[],
  resolvedLines: ResolvedLine[],
): PipeDiffLineAnnotation[] {
  return annotations
    .filter((annotation) => annotation.file === file.path)
    .map((annotation): PipeDiffLineAnnotation => {
      const thread = inlineThreads.find(
        (candidateThread) => candidateThread.file === file.path && candidateThread.line === annotation.line,
      );
      const resolved = resolvedLines.some(
        (candidateLine) => candidateLine.file === file.path && candidateLine.line === annotation.line,
      );

      return {
        side: 'additions',
        lineNumber: annotation.line,
        metadata: {
          annotation,
          thread,
          resolved,
        },
      };
    });
}

function renderThread(thread: InlineThread): JSX.Element {
  const moveColorMap = {
    change: '#34d399',
    pushback: '#f87171',
    comment: '#b9ddff',
  } as const;

  return (
    <div style={{ marginTop: 8 }}>
      {thread.exchanges.map((exchange, index) => {
        const isImplementer = exchange.actor === 'implementer';
        const move = exchange.move ?? 'comment';
        const color = moveColorMap[move];

        return (
          <div
            key={`${exchange.actor}-${exchange.round}-${index}`}
            style={{
              padding: '8px 12px',
              borderLeft: `3px solid ${color}`,
              marginTop: 6,
              background: 'rgba(244,248,255,0.035)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
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
                  {inlineMoveLabel(exchange.move)}
                </span>
              )}
              <span
                style={{
                  fontSize: 8,
                  color: isImplementer ? '#b9ddff' : 'rgba(96,165,250,0.72)',
                  letterSpacing: '0.08em',
                  fontWeight: 700,
                }}
              >
                {isImplementer ? 'AUTHOR' : 'YOU'}
              </span>
              <span style={{ fontSize: 7, color: 'rgba(244,248,255,0.26)' }}>
                R{exchange.round}
              </span>
            </div>
            <p
              style={{
                fontSize: 11,
                color: 'rgba(244,248,255,0.7)',
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
  );
}

function AnnotationBlock({
  annotation,
  thread,
  resolved,
}: PipeDiffAnnotationMetadata): JSX.Element {
  const colors = severityColors[annotation.severity];

  return (
    <div
      data-testid={`annotation-badge-${annotation.line}`}
      style={{
        padding: '10px 16px 10px 92px',
        background: colors.bg,
        borderTop: `1px solid ${colors.border}`,
        borderBottom: `1px solid ${colors.border}`,
        fontFamily: '"Space Mono", monospace',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <MessageSquare size={10} color={colors.text} />
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: colors.text,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          {annotation.severity}
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
      <p
        style={{
          fontSize: 11,
          color: 'rgba(244,248,255,0.72)',
          lineHeight: 1.6,
          margin: 0,
          fontFamily: '"Space Mono", monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {annotation.comment}
      </p>
      {thread ? renderThread(thread) : null}
    </div>
  );
}

function annotateRenderedPierreLines(
  node: HTMLElement,
  phase: PostRenderPhase,
): void {
  if (phase === 'unmount') return;

  const roots: Array<DocumentFragment | HTMLElement> = [node];
  if (node.shadowRoot) roots.push(node.shadowRoot);

  roots.forEach((root) => root.querySelectorAll<HTMLElement>('[data-line]').forEach((lineElement) => {
    const lineNumber = lineElement.dataset.line;
    if (!lineNumber) return;
    lineElement.dataset.testid = `diff-line-${lineNumber}`;
    lineElement.setAttribute('role', 'button');
    lineElement.setAttribute('aria-label', `Comment on diff line ${lineNumber}`);
  }));
}

function PierrePatchFile({
  file,
  annotations,
  inlineThreads,
  resolvedLines,
  readOnly,
  onLineClick,
}: {
  file: DiffFile;
  annotations: Annotation[];
  inlineThreads: InlineThread[];
  resolvedLines: ResolvedLine[];
  readOnly: boolean;
  onLineClick: ((filePath: string, lineNum: number) => void) | undefined;
}): JSX.Element {
  const patch = useMemo(() => diffFileToPatch(file), [file]);
  const lineAnnotations = useMemo(
    () => toLineAnnotations(file, annotations, inlineThreads, resolvedLines),
    [annotations, file, inlineThreads, resolvedLines],
  );
  const options = useMemo<FileDiffOptions<PipeDiffAnnotationMetadata>>(
    () => ({
      theme: 'pierre-dark-soft',
      themeType: 'dark',
      diffStyle: 'unified',
      diffIndicators: 'bars',
      disableFileHeader: true,
      hunkSeparators: 'line-info-basic',
      overflow: 'scroll',
      lineDiffType: 'word',
      lineHoverHighlight: 'line',
      disableVirtualizationBuffers: true,
      unsafeCSS: PIERRE_UNSAFE_CSS,
      onLineClick: (props) => {
        if (readOnly || !onLineClick || !isAnnotatableLine(props)) return;
        onLineClick(file.path, props.lineNumber);
      },
      onPostRender: (node, _instance, phase) => annotateRenderedPierreLines(node, phase),
    }),
    [file.path, onLineClick, readOnly],
  );

  return (
    <section
      className="pierre-diff-viewer__file"
      data-testid={`pierre-diff-file-${file.path}`}
      style={{
        minWidth: 'max-content',
        borderBottom: '1px solid rgba(244,248,255,0.06)',
      }}
    >
      <Suspense
        fallback={(
          <div
            style={{
              padding: 24,
              color: 'rgba(185,221,255,0.62)',
              fontFamily: '"Space Mono", monospace',
              fontSize: 11,
              letterSpacing: '0.12em',
            }}
          >
            LOADING_DIFF_RENDERER...
          </div>
        )}
      >
        <PierrePatchDiff
          patch={patch}
          options={options}
          lineAnnotations={lineAnnotations}
          renderAnnotation={(annotation) => (
            <AnnotationBlock
              annotation={annotation.metadata.annotation}
              thread={annotation.metadata.thread}
              resolved={annotation.metadata.resolved}
            />
          )}
          disableWorkerPool
          style={{
            display: 'block',
            background: 'transparent',
          }}
        />
      </Suspense>
    </section>
  );
}

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
  const files = useMemo(() => {
    if (mode === 'single-file' && file) return [file];
    if (mode === 'multi-file' && diff) return diff.files;
    return [];
  }, [mode, file, diff]);

  if (files.length === 0) {
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
      className="pierre-diff-viewer"
      data-testid="pierre-diff-viewer"
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        position: 'relative',
        background: 'rgba(0,0,0,0.16)',
      }}
    >
      {files.map((diffFile) => (
        <PierrePatchFile
          key={diffFile.path}
          file={diffFile}
          annotations={annotations}
          readOnly={readOnly}
          resolvedLines={resolvedLines}
          inlineThreads={inlineThreads}
          onLineClick={onLineClick}
        />
      ))}
    </div>
  );
}
