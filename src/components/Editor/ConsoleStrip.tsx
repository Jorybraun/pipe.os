import { useState, useEffect } from 'react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';
import type { RunResult } from '../../lib/challenge/testRunner';

interface ConsoleStripProps {
  result: RunResult | null;
  isRunning: boolean;
  onClear: () => void;
}

export function ConsoleStrip({ result, isRunning, onClear }: ConsoleStripProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(true);
  const [visible, setVisible] = useState(true);

  // Re-show when a new run starts
  useEffect(() => {
    if (isRunning) setVisible(true);
  }, [isRunning]);

  const status = isRunning ? 'running' : result?.status ?? 'idle';
  const dotColor =
    status === 'success' ? '#34d399' :
    status === 'error' ? '#f87171' :
    status === 'running' ? '#60a5fa' :
    'rgba(255,255,255,0.2)';

  const statusLabel =
    status === 'running' ? 'RUNNING' :
    status === 'success' ? 'PASS' :
    status === 'error' ? 'FAIL' :
    'IDLE';

  if (!visible) return <></>;

  const smallBtn: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.55)',
    padding: '6px 10px',
    borderRadius: 6,
    fontSize: 10,
    fontFamily: 'Space Mono',
    cursor: 'pointer',
  };

  const handleCopy = async () => {
    const content = [
      ...(result?.error ? [`ERROR: ${result.error}`] : []),
      ...(result?.logs || []),
    ].join('\n');
    try { await navigator.clipboard.writeText(content); } catch { /* noop */ }
  };

  return (
    <div style={{ position: 'fixed', left: 24, right: 24, bottom: 16, zIndex: 10000 }}>
      <LiquidMetalCard variant="dark" style={{ padding: 12, borderRadius: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor }} />
            <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.7)', fontFamily: 'Space Mono', letterSpacing: '0.12em' }}>
              CONSOLE
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: 'Space Mono', letterSpacing: '0.12em' }}>
              {statusLabel}
              {typeof result?.durationMs === 'number' ? ` / ${result.durationMs}ms` : ''}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => { onClear(); }} style={smallBtn}>CLEAR</button>
            <button onClick={handleCopy} style={smallBtn}>COPY</button>
            <button
              onClick={() => setIsOpen(!isOpen)}
              style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title={isOpen ? 'Collapse' : 'Expand'}
            >
              {isOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
            <button
              onClick={() => setVisible(false)}
              style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title="Hide"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {isOpen && (
          <div style={{ marginTop: 10 }}>
            {result?.error && (
              <div style={{ fontSize: 11, color: '#fca5a5', fontFamily: 'Space Mono', marginBottom: 10, whiteSpace: 'pre-wrap' }}>
                {result.error}
              </div>
            )}
            <div style={{
              height: 180, overflow: 'auto', background: 'rgba(0,0,0,0.25)',
              border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: 12,
              fontFamily: 'Space Mono', fontSize: 11, color: 'rgba(255,255,255,0.75)', whiteSpace: 'pre-wrap',
            }}>
              {(result?.logs?.length ?? 0) > 0
                ? result!.logs.join('\n')
                : isRunning
                  ? 'Running...'
                  : 'No output.'}
            </div>
          </div>
        )}
      </LiquidMetalCard>
    </div>
  );
}
