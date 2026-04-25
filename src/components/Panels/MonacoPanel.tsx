import Editor from '@monaco-editor/react';
import type { ReactNode } from 'react';

interface MonacoPanelProps {
  language: string;
  value: string;
  onChange: (code: string | undefined) => void;
  readOnly?: boolean;
  label?: string;
  headerRight?: ReactNode;
  hideHeader?: boolean;
}

/**
 * MonacoPanel - Professional code editor panel for Pipe assessments.
 */
export function MonacoPanel({
  language,
  value,
  onChange,
  readOnly = false,
  label,
  headerRight,
  hideHeader = false,
}: MonacoPanelProps): JSX.Element {
  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', background: '#0c0c0e' }}>
      {!hideHeader && (
        <header style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--pipe-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--pipe-surface)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#60a5fa' }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono', letterSpacing: '0.1em' }}>
              {label || `${(language ?? 'javascript').toUpperCase()}_EDITOR`}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {headerRight}
            {readOnly && (
              <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>READ_ONLY</span>
            )}
          </div>
        </header>
      )}
      
      <div style={{ flex: 1, position: 'relative' }}>
        <Editor
          height="100%"
          language={(language ?? 'javascript').toLowerCase()}
          value={value}
          onChange={onChange}
          theme="vs-dark"
          options={{
            fontSize: 14,
            fontFamily: '"Space Mono", monospace',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'off',
            lineNumbers: 'on',
            readOnly: readOnly,
            padding: { top: 20 },
            automaticLayout: true,
            glyphMargin: false,
            folding: true,
            lineDecorationsWidth: 10,
            lineNumbersMinChars: 3,
          }}
        />
      </div>
    </div>
  );
}
