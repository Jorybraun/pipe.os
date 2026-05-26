interface TextInputProps {
  value?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  onBlur?: (() => void) | undefined;
  placeholder?: string | undefined;
  id?: string | undefined;
  name?: string | undefined;
  ariaLabel?: string | undefined;
}

const inputStyle = {
  width: '100%',
  padding: '12px 16px',
  background: 'var(--pipe-surface-solid)',
  border: '1px solid var(--pipe-border)',
  color: 'var(--pipe-text)',
  fontSize: 12,
  fontFamily: '"Space Mono", monospace',
  outline: 'none',
};

/**
 * TextInput - Single-line text input with consistent styling
 */
export function TextInput({ value, onChange, onBlur, placeholder, id, name, ariaLabel }: TextInputProps): JSX.Element {
  return (
    <input
      type="text"
      id={id}
      name={name}
      aria-label={ariaLabel}
      value={value || ''}
      onChange={(e) => onChange?.(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      style={inputStyle}
    />
  );
}
