import { Minus, Plus } from 'lucide-react';

/**
 * Props for the NumberInput component.
 */
export interface NumberInputProps {
  /**
   * Current numeric value.
   */
  value: number;

  /**
   * Callback fired when the value changes.
   * Optional - if not provided, component is display-only.
   */
  onChange?: (value: number) => void;

  /**
   * Minimum allowed value.
   * @default 0
   */
  min?: number;

  /**
   * Maximum allowed value.
   * @default 100
   */
  max?: number;

  /**
   * Increment/decrement step.
   * @default 1
   */
  step?: number;

  /**
   * Unit label to display after the number (e.g., "MIN", "SEC").
   */
  unit?: string;

  /**
   * Whether the input is disabled.
   * @default false
   */
  disabled?: boolean;
}

/**
 * Number input component with increment/decrement buttons.
 *
 * A stateless component for numeric input with +/- controls.
 * Can be used in display-only mode by omitting the onChange handler.
 *
 * @example
 * ```tsx
 * <NumberInput
 *   value={timeLimit}
 *   onChange={(val) => setTimeLimit(val)}
 *   min={1}
 *   max={60}
 *   unit="MIN"
 * />
 * ```
 */
export function NumberInput({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  disabled = false,
}: NumberInputProps): JSX.Element {
  const handleDecrement = (): void => {
    if (!disabled && onChange && value > min) {
      onChange(Math.max(min, value - step));
    }
  };

  const handleIncrement = (): void => {
    if (!disabled && onChange && value < max) {
      onChange(Math.min(max, value + step));
    }
  };

  const canDecrement = !disabled && !!onChange && value > min;
  const canIncrement = !disabled && !!onChange && value < max;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        type="button"
        onClick={handleDecrement}
        disabled={!canDecrement}
        aria-label="Decrease value"
        style={{
          width: 36,
          height: 36,
          background: 'var(--pipe-surface)',
          border: '1px solid var(--pipe-border)',
          color: 'var(--pipe-text-muted)',
          cursor: canDecrement ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: canDecrement ? 1 : 0.3,
        }}
      >
        <Minus size={14} />
      </button>

      <div
        style={{
          flex: 1,
          height: 48,
          background: 'var(--pipe-surface)',
          border: '1px solid var(--pipe-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--pipe-text, #fff)' }}>{value}</span>
        {unit && (
          <span style={{ fontSize: 10, color: 'var(--pipe-text-dim)', letterSpacing: '0.1em' }}>
            {unit}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={handleIncrement}
        disabled={!canIncrement}
        aria-label="Increase value"
        style={{
          width: 36,
          height: 36,
          background: 'var(--pipe-surface)',
          border: '1px solid var(--pipe-border)',
          color: 'var(--pipe-text-muted)',
          cursor: canIncrement ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: canIncrement ? 1 : 0.3,
        }}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
