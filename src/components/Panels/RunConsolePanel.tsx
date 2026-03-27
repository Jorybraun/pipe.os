// ---------------------------------------------------------------------------
// RunConsolePanel — candidate-facing docked console with Run button +
// per-test pass/fail badges.
// ---------------------------------------------------------------------------

import { useState, useCallback } from 'react';
import { Play, ChevronUp, ChevronDown } from 'lucide-react';
import { runTestsVFS } from '../../lib/challenge/testRunner';
import type { VirtualFS, EnhancedRunResult, TestCaseResult } from '../../lib/challenge/virtualFS';

interface RunConsolePanelProps {
  /** Candidate's current files (from submission) */
  candidateFiles: VirtualFS;
  /** Sample test files visible to candidate (from challenge data) */
  sampleTestFiles: VirtualFS;
  /** Language for the runner */
  language: string;
  /** External run state override (from InterviewContext) */
  runState?: { status: string };
  /** Callback when run completes */
  onRunComplete?: (result: EnhancedRunResult) => void;
}

function TestRow({ test }: { test: TestCaseResult }): JSX.Element {
  const color = test.status === 'pass' ? '#34d399' : test.status === 'fail' ? '#f87171' : '#fbbf24';
  const label = test.status === 'pass' ? 'PASS' : test.status === 'fail' ? 'FAIL' : 'ERR';
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '5px 0',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}>
      <span style={{ fontSize: 9, fontWeight: 800, fontFamily: 'Space Mono', color, width: 32, letterSpacing: '0.05em' }}>
        {label}
      </span>
      <span style={{ fontSize: 11, fontFamily: 'Space Mono', color: 'rgba(255,255,255,0.7)', flex: 1 }}>
        {test.name}
      </span>
      {test.error && (
        <span style={{ fontSize: 10, color: '#fca5a5', fontFamily: 'Space Mono', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {test.error}
        </span>
      )}
    </div>
  );
}

export function RunConsolePanel({
  candidateFiles,
  sampleTestFiles,
  language,
  onRunComplete,
}: RunConsolePanelProps): JSX.Element {
  const [result, setResult] = useState<EnhancedRunResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const handleRun = useCallback(async () => {
    setIsRunning(true);
    setResult(null);
    const r = await runTestsVFS(candidateFiles, sampleTestFiles, language);
    setResult(r);
    setIsRunning(false);
    onRunComplete?.(r);
  }, [candidateFiles, sampleTestFiles, language, onRunComplete]);

  const dotColor =
    isRunning ? '#60a5fa' :
    result?.status === 'success' ? '#34d399' :
    result?.status === 'partial' ? '#fbbf24' :
    result?.status === 'error' ? '#f87171' :
    'rgba(255,255,255,0.2)';

  return (
    <div style={{
      background: '#0a0a0c',
      borderTop: '1px solid rgba(255,255,255,0.08)',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
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
          <span style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.5)', fontFamily: 'Space Mono', letterSpacing: '0.1em' }}>
            OUTPUT
          </span>
          {result && result.total > 0 && (
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'Space Mono' }}>
              {result.passed}/{result.total} passed
              {typeof result.durationMs === 'number' ? ` / ${result.durationMs}ms` : ''}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', padding: 4 }}
          >
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            onClick={handleRun}
            disabled={isRunning}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: isRunning ? 'rgba(255,255,255,0.04)' : 'rgba(167,139,250,0.15)',
              border: isRunning ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(167,139,250,0.3)',
              color: isRunning ? 'rgba(255,255,255,0.3)' : '#a78bfa',
              padding: '6px 14px',
              fontSize: 10,
              fontWeight: 800,
              fontFamily: 'Space Mono',
              cursor: isRunning ? 'not-allowed' : 'pointer',
              letterSpacing: '0.05em',
            }}
          >
            <Play size={12} />
            {isRunning ? 'RUNNING' : 'RUN'}
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div style={{ flex: 1, overflow: 'auto', padding: '0 16px 12px' }}>
          {result && result.tests.length > 0 && (
            <div style={{ marginBottom: result.logs.length > 0 ? 10 : 0 }}>
              {result.tests.map((t, i) => <TestRow key={i} test={t} />)}
            </div>
          )}

          {result?.error && result.tests.length === 0 && (
            <div style={{ fontSize: 11, color: '#fca5a5', fontFamily: 'Space Mono', whiteSpace: 'pre-wrap', marginBottom: 8 }}>
              {result.error}
            </div>
          )}

          {result && result.logs.length > 0 && (
            <div style={{ fontFamily: 'Space Mono', fontSize: 11, color: 'rgba(255,255,255,0.5)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {result.logs.join('\n')}
            </div>
          )}

          {!result && !isRunning && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'Space Mono', fontStyle: 'italic' }}>
              Click RUN to execute sample tests.
            </div>
          )}
          {isRunning && (
            <div style={{ fontSize: 10, color: 'rgba(96,165,250,0.6)', fontFamily: 'Space Mono' }}>
              Running tests...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
