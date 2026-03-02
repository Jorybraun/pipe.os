import { Play, Terminal, Monitor, RefreshCw } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

type PreviewMode = 'browser' | 'console';

interface PreviewTabProps {
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
  /** For browser mode: the srcdoc HTML string for the iframe */
  iframeSrc?: string;
  /** For console mode: the execution output */
  consoleOutput?: string;
  /** Whether code is currently executing */
  isRunning?: boolean;
  onRun: () => void;
  onRefresh: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * PreviewTab - Live preview panel for challenge output.
 *
 * Two modes:
 * - **browser**: Renders an iframe with the candidate's UI (for React/frontend challenges).
 *   Uses srcdoc with ESM imports from esm.sh — no server needed.
 * - **console**: Shows text output from code execution (for algorithm challenges via Piston API).
 */
export function PreviewTab({
  mode,
  onModeChange,
  iframeSrc,
  consoleOutput,
  isRunning = false,
  onRun,
  onRefresh,
}: PreviewTabProps): JSX.Element {
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        background: 'rgba(0,0,0,0.2)',
        flexShrink: 0,
      }}>
        {/* Left: mode toggle */}
        <div style={{
          display: 'flex',
          gap: 0,
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 4,
          overflow: 'hidden',
        }}>
          {([
            { id: 'browser' as const, label: 'BROWSER', icon: Monitor },
            { id: 'console' as const, label: 'CONSOLE', icon: Terminal },
          ]).map((m) => {
            const isActive = mode === m.id;
            const MIcon = m.icon;
            return (
              <button
                key={m.id}
                onClick={() => onModeChange(m.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 12px',
                  background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
                  border: 'none',
                  color: isActive ? '#fff' : 'rgba(255,255,255,0.25)',
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  fontFamily: 'Space Mono, monospace',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <MIcon size={10} />
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Right: action buttons */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onRefresh}
            title="Refresh preview"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 4,
              color: 'rgba(255,255,255,0.3)',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <RefreshCw size={11} />
          </button>

          <button
            onClick={onRun}
            disabled={isRunning}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 14px',
              background: 'rgba(74, 222, 128, 0.12)',
              border: '1px solid rgba(74, 222, 128, 0.25)',
              borderRadius: 4,
              color: '#4ade80',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.08em',
              fontFamily: 'Space Mono, monospace',
              cursor: isRunning ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <Play size={10} />
            {isRunning ? 'RUNNING...' : 'RUN'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {mode === 'browser' ? (
          /* Browser preview: iframe */
          iframeSrc ? (
            <iframe
              srcDoc={iframeSrc}
              sandbox="allow-scripts allow-modals"
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                background: '#fff',
              }}
              title="Challenge preview"
            />
          ) : (
            /* No content yet */
            <div style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
            }}>
              <Monitor size={40} color="rgba(255,255,255,0.06)" />
              <div style={{
                fontSize: 11,
                color: 'rgba(255,255,255,0.15)',
                fontFamily: 'Space Mono, monospace',
              }}>
                No preview available
              </div>
              <div style={{
                fontSize: 9,
                color: 'rgba(255,255,255,0.08)',
                fontFamily: 'Space Mono, monospace',
                textAlign: 'center',
                maxWidth: 300,
                lineHeight: 1.6,
              }}>
                Click RUN to build and preview the component.
                Uses React via esm.sh CDN — no server required.
              </div>
            </div>
          )
        ) : (
          /* Console output */
          <div style={{
            height: '100%',
            overflow: 'auto',
            padding: '16px 20px',
            background: 'rgba(0,0,0,0.3)',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255,255,255,0.1) transparent',
          }}>
            {consoleOutput ? (
              <pre style={{
                margin: 0,
                color: 'rgba(255,255,255,0.7)',
                fontSize: 12,
                fontFamily: 'Space Mono, monospace',
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {consoleOutput}
              </pre>
            ) : (
              <div style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
              }}>
                <Terminal size={32} color="rgba(255,255,255,0.06)" />
                <div style={{
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.12)',
                  fontFamily: 'Space Mono, monospace',
                }}>
                  Console output will appear here
                </div>
                <div style={{
                  fontSize: 9,
                  color: 'rgba(255,255,255,0.08)',
                  fontFamily: 'Space Mono, monospace',
                  textAlign: 'center',
                  maxWidth: 320,
                  lineHeight: 1.6,
                }}>
                  Click RUN to execute the code via the Piston API.
                  Supports JavaScript, TypeScript, Python, Java, Go, and more.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
