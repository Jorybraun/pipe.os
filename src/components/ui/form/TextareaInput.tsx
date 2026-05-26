interface TextareaInputProps {
  value?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  placeholder?: string | undefined;
  rows?: number | undefined;
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
  resize: 'vertical' as const,
  minHeight: 80,
  lineHeight: 1.7,
};

/**
 * TextareaInput - Multi-line text input with consistent styling
 *
 * Features:
 * - Vertically resizable
 * - Configurable number of rows
 * - Monospace font for consistency
 *
 * @example
 * ```tsx
 * <TextareaInput
 *   value={description}
 *   onChange={setDescription}
 *   placeholder="Describe the role..."
 *   rows={4}
 * />
 * ```
 */
export function TextareaInput({
  value,
  onChange,
  placeholder,
  rows = 3,
  id,
  name,
  ariaLabel,
}: TextareaInputProps): JSX.Element {
  return (
    <textarea
      id={id}
      name={name}
      aria-label={ariaLabel}
      value={value || ''}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={inputStyle}
    />
  );
}
