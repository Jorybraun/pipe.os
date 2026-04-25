import type { JSX } from 'react';

// ─── ThinkingIndicator ───────────────────────────────────────────────────────

export function ThinkingIndicator({ message }: { message?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '20px 0', alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 5, height: 5, borderRadius: '50%',
              background: 'rgba(74, 222, 128, 0.5)',
              animation: `typingPulse 1.4s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
      {message && (
        <span style={{
          fontSize: 10, letterSpacing: '0.1em',
          color: 'var(--pipe-text-dim)',
          fontFamily: '"Space Mono", monospace',
        }}>
          {message}
        </span>
      )}
      <style>{`
        @keyframes typingPulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
