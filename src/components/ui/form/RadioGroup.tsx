interface RadioGroupProps {
  value?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  options: string[];
}

/**
 * RadioGroup - Radio button group with custom styling
 */
export function RadioGroup({ value, onChange, options }: RadioGroupProps): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 20 }}>
      {options.map((opt) => (
        <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <div
            style={{
              width: 16,
              height: 16,
              border: `2px solid ${
                value === opt ? 'rgba(255, 255, 255, 0.45)' : 'var(--pipe-border)'
              }`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {value === opt && <div style={{ width: 8, height: 8, background: 'rgba(255, 255, 255, 0.45)' }} />}
          </div>
          <input
            type="radio"
            checked={value === opt}
            onChange={() => onChange?.(opt)}
            style={{ display: 'none' }}
          />
          <span style={{ fontSize: 11, color: value === opt ? 'var(--pipe-text)' : 'var(--pipe-text-muted)' }}>
            {opt}
          </span>
        </label>
      ))}
    </div>
  );
}
