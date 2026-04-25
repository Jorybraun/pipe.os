// ---------------------------------------------------------------------------
// ConsolePanel — docked console with per-test results display
// Replaces the floating ConsoleStrip for CODE_IMPLEMENTATION editors.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { ChevronUp, ChevronDown, Copy, Trash2 } from 'lucide-react';
import type { EnhancedRunResult, TestCaseResult } from '../../lib/challenge/virtualFS';
import type { RunResult } from '../../lib/challenge/testRunner';

interface ConsolePanelProps {
  result: EnhancedRunResult | RunResult | null;
  isRunning: boolean;
  onClear: () => void;
}

function isEnhanced(r: EnhancedRunResult | RunResult): r is EnhancedRunResult {
  return 'tests' in r && Array.isArray((r as EnhancedRunResult).tests);
}

function TestRow({ test }: { test: TestCaseResult }): JSX.Element {
  const color = test.status === 'pass' ? '#34d399' : test.status === 'fail' ? '#f87171' : '#fbbf24';
  const label = test.status === 'pass' ? 'PASS' : test.status === 'fail' ? 'FAIL' : 'ERR';
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '6px 0',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}>
      <span style={{
        fontSize: 9,
        fontWeight: 800,
        fontFamily: 'Space Mono',
        color,
        width: 32,
        letterSpacing: '0.05em',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 11,
        fontFamily: 'Space Mono',
        color: 'var(--pipe-text-muted)',
        flex: 1,
      }}>
        {test.name}
      </span>
      {test.durationMs !== undefined && (
        <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>
          {test.durationMs}ms
        </span>
      )}
      {test.error && (
        <span style={{
          fontSize: 10,
          color: '#fca5a5',
          fontFamily: 'Space Mono',
          maxWidth: 300,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {test.error}
        </span>
      )}
    </div>
  );
}

export function ConsolePanel({ result, isRunning, onClear }: ConsolePanelProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);

  const status = isRunning ? 'running' : result?.status ?? 'idle';
  const dotColor =
    status === 'success' ? '#34d399' :
    status === 'error' ? '#f87171' :
    status === 'partial' ? '#fbbf24' :
    status === 'running' ? '#60a5fa' :
    'rgba(255,255,255,0.2)';

  const statusLabel =
    status === 'running' ? 'RUNNING' :
    status === 'success' ? 'PASS' :
    status === 'partial' ? 'PARTIAL' :
    status === 'error' ? 'FAIL' :
    'IDLE';

  const enhanced = result && isEnhanced(result) ? result : null;
  const logs = result?.logs ?? [];

  const handleCopy = async (): Promise<void> => {
    const parts: string[] = [];
    if (enhanced) {
      for (const t of enhanced.tests) {
        parts.push(`${t.status === 'pass' ? 'PASS' : 'FAIL'} ${t.name}${t.error ? ': ' + t.error : ''}`);
      }
    }
    if (result?.error) parts.push(`ERROR: ${result.error}`);
    parts.push(...logs);
    try { await navigator.clipboard.writeText(parts.join('\n')); } catch { /* noop */ }
  };

  const smallBtn: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid var(--pipe-border)',
    color: 'rgba(255,255,255,0.45)',
    padding: '4px 8px',
    fontSize: 9,
    fontFamily: 'Space Mono',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  };

  return (
    <div style={{
      background: '#0a0a0c',
      borderTop: '1px solid var(--pipe-border)',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 36,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 16px',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor }} />
          <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--pipe-text-muted)', fontFamily: 'Space Mono', letterSpacing: '0.1em' }}>
            CONSOLE
          </span>
          <span style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: 'Space Mono' }}>
            {statusLabel}
            {enhanced && enhanced.total > 0 && ` / ${enhanced.passed}/${enhanced.total}`}
            {result && 'durationMs' in result && typeof result.durationMs === 'number' ? ` / ${result.durationMs}ms` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={handleCopy} style={smallBtn}><Copy size={10} /> COPY</button>
          <button onClick={onClear} style={smallBtn}><Trash2 size={10} /> CLEAR</button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{ background: 'none', border: 'none', color: 'var(--pipe-text-dim)', cursor: 'pointer', padding: 4 }}
          >
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '0 16px 12px',
          maxHeight: 280,
        }}>
          {/* Per-test results */}
          {enhanced && enhanced.tests.length > 0 && (
            <div style={{ marginBottom: logs.length > 0 ? 12 : 0 }}>
              {enhanced.tests.map((t, i) => <TestRow key={i} test={t} />)}
            </div>
          )}

          {/* Error */}
          {result?.error && !enhanced && (
            <div style={{
              fontSize: 11,
              color: '#fca5a5',
              fontFamily: 'Space Mono',
              marginBottom: 8,
              whiteSpace: 'pre-wrap',
            }}>
              {result.error}
            </div>
          )}

          {/* Logs */}
          {logs.length > 0 && (
            <div style={{
              fontFamily: 'Space Mono',
              fontSize: 11,
              color: 'rgba(255,255,255,0.55)',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.6,
            }}>
              {logs.join('\n')}
            </div>
          )}

          {/* Empty state */}
          {!isRunning && !result && (
            <div style={{
              fontSize: 10,
              color: 'var(--pipe-text-dim)',
              fontFamily: 'Space Mono',
              fontStyle: 'italic',
            }}>
              Run tests to see output.
            </div>
          )}

          {isRunning && (
            <div style={{
              fontSize: 10,
              color: 'rgba(96,165,250,0.6)',
              fontFamily: 'Space Mono',
            }}>
              Running...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
