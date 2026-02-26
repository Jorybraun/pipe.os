import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { LiquidMetalCard } from './ui/LiquidMetalCard';

// ============================================================================
// Types
// ============================================================================

export interface Annotation {
  line: number;
  comment: string;
  severity: 'critical' | 'major' | 'minor';
}

interface ReviewCanvasProps {
  snippet: {
    code: string;
    language?: string;
  };
  onAnnotationsChange: (annotations: Annotation[]) => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * ReviewCanvas - Displays a code snippet for candidate review.
 *
 * Provides a syntax-highlighted code viewer with line numbers.
 * In Phase 1, it's read-only. Phase 2 will add the annotation UI.
 *
 * Design: Brutalist Glassmorphic / Dark
 */
export function ReviewCanvas({
  snippet,
  // onAnnotationsChange is ready for Phase 2
}: ReviewCanvasProps): JSX.Element {
  return (
    <div style={{ position: 'relative' }}>
      <LiquidMetalCard variant="dark" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Header */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: '0.2em',
              color: 'rgba(255,255,255,0.4)',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            CODE_REVIEW_CANVAS
          </div>
          <div
            style={{
              fontSize: 10,
              color: 'rgba(255,255,255,0.25)',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            {snippet.language?.toUpperCase() || 'TYPESCRIPT'}
          </div>
        </div>

        {/* Code Viewer */}
        <div style={{ padding: 0, position: 'relative' }}>
          <SyntaxHighlighter
            language={snippet.language || 'typescript'}
            style={vscDarkPlus}
            showLineNumbers
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
              color: 'rgba(255,255,255,0.15)',
              textAlign: 'right',
              userSelect: 'none',
            }}
          >
            {snippet.code}
          </SyntaxHighlighter>
        </div>

        {/* Footer / Instruction */}
        <div
          style={{
            padding: '20px 24px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(255,255,255,0.01)',
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.35)',
              fontFamily: '"Space Mono", monospace',
              lineHeight: 1.5,
            }}
          >
            PHASE_1_PREVIEW: Read through the code snippet carefully. In the next phase, you will be able to click on line numbers to add annotations.
          </div>
        </div>
      </LiquidMetalCard>
    </div>
  );
}
