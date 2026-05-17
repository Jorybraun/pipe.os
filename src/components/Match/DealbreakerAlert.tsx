/**
 * DealbreakerAlert — red alert card for failed dealbreakers.
 */

import { AlertTriangle } from 'lucide-react';
import type { DealbreakerFailure } from '../../lib/api/types';

interface DealbreakerAlertProps {
  failure: DealbreakerFailure;
}

export function DealbreakerAlert({ failure }: DealbreakerAlertProps): JSX.Element {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 8,
        background: 'rgba(248,113,113,0.06)',
        border: '1px solid rgba(248,113,113,0.25)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <AlertTriangle size={14} color="#f87171" />
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.15em',
            color: '#f87171',
            fontFamily: '"Space Mono", monospace',
            textTransform: 'uppercase',
          }}
        >
          DEALBREAKER FLAG
        </span>
      </div>

      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--pipe-text, #fff)',
          lineHeight: 1.5,
          paddingLeft: 22,
        }}
      >
        "{failure.narrative}"
      </div>

      <div
        style={{
          fontSize: 11,
          color: '#fbbf24',
          fontFamily: '"Space Mono", monospace',
          paddingLeft: 22,
        }}
      >
        Best evidence match: {failure.matchedSimilarity.toFixed(2)} (below 0.75 threshold)
      </div>
    </div>
  );
}
