import React from 'react';

/**
 * Toggle switch component.
 * Stateless - value controlled by parent.
 */
export function Toggle({ value, onChange, disabled = false }) {
  return (
    <button
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      style={{
        width: 56,
        height: 28,
        background: value ? 'rgba(150,255,150,0.3)' : 'rgba(255,255,255,0.1)',
        border: `1px solid ${value ? 'rgba(150,255,150,0.5)' : 'rgba(255,255,255,0.15)'}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative',
        padding: 2,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{
        width: 22,
        height: 22,
        background: value ? 'rgba(150,255,150,0.9)' : 'rgba(255,255,255,0.4)',
        position: 'absolute',
        left: value ? 'calc(100% - 24px)' : '2px',
        transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      }} />
    </button>
  );
}
