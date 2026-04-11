interface SelectInputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  options: string[];
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
 * SelectInput - Dropdown select input with options
 */
export function SelectInput({
  value,
  onChange,
  placeholder,
  options,
}: SelectInputProps): JSX.Element {
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange?.(e.target.value)}
      style={{
        ...inputStyle,
        cursor: 'pointer',
        color: value ? 'var(--pipe-text)' : 'var(--pipe-text-dim)',
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
