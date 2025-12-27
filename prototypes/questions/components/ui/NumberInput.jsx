import React from 'react';
import { Minus, Plus } from 'lucide-react';

/**
 * Number input with increment/decrement buttons.
 * Stateless - value controlled by parent.
 */
export function NumberInput({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  disabled = false
}) {
  const handleDecrement = () => {
    if (!disabled && value > min) {
      onChange(Math.max(min, value - step));
    }
  };

  const handleIncrement = () => {
    if (!disabled && value < max) {
      onChange(Math.min(max, value + step));
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        onClick={handleDecrement}
        disabled={disabled || value <= min}
        style={{
          width: 36,
          height: 36,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: 'rgba(255,255,255,0.5)',
          cursor: disabled || value <= min ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled || value <= min ? 0.3 : 1,
        }}
      >
        <Minus size={14} />
      </button>

      <div style={{
        flex: 1,
        height: 48,
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: '#fff' }}>{value}</span>
        {unit && (
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em' }}>
            {unit}
          </span>
        )}
      </div>

      <button
        onClick={handleIncrement}
        disabled={disabled || value >= max}
        style={{
          width: 36,
          height: 36,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: 'rgba(255,255,255,0.5)',
          cursor: disabled || value >= max ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled || value >= max ? 0.3 : 1,
        }}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
