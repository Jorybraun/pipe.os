// ---------------------------------------------------------------------------
// ModeSelector — backend / frontend mode toggle
// ---------------------------------------------------------------------------

import { Terminal, Globe } from 'lucide-react';

interface ModeSelectorProps {
  mode: 'backend' | 'frontend';
  onChange: (mode: 'backend' | 'frontend') => void;
}

export function ModeSelector({ mode, onChange }: ModeSelectorProps): JSX.Element {
  const btn = (value: 'backend' | 'frontend', label: string, Icon: typeof Terminal): JSX.Element => {
    const isActive = mode === value;
    return (
      <button
        onClick={() => onChange(value)}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '10px 12px',
          background: isActive ? 'var(--pipe-accent-surface)' : 'rgba(255,255,255,0.03)',
          border: isActive ? '1px solid var(--pipe-accent-border)' : '1px solid rgba(255,255,255,0.08)',
          color: isActive ? 'var(--pipe-accent)' : 'rgba(255,255,255,0.4)',
          fontSize: 10,
          fontWeight: 800,
          fontFamily: 'Space Mono',
          letterSpacing: '0.05em',
          cursor: 'pointer',
          transition: 'all 150ms ease',
        }}
      >
        <Icon size={14} />
        {label}
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', gap: 1 }}>
      {btn('backend', 'BACKEND', Terminal)}
      {btn('frontend', 'FRONTEND', Globe)}
    </div>
  );
}
