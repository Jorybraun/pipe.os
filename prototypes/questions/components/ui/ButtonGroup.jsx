import React from 'react';

/**
 * Button group for selecting one option from many.
 * Stateless - selection controlled by parent.
 */
export function ButtonGroup({ options, value, onChange, disabled = false }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map(option => (
        <button
          key={option}
          onClick={() => !disabled && onChange(option)}
          disabled={disabled}
          style={{
            padding: '8px 14px',
            background: value === option ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${value === option ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)'}`,
            color: value === option ? '#fff' : 'rgba(255,255,255,0.5)',
            fontSize: 9,
            letterSpacing: '0.1em',
            cursor: disabled ? 'not-allowed' : 'pointer',
            textTransform: 'uppercase',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
