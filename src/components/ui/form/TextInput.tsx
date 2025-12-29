interface TextInputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
}

const inputStyle = {
  width: '100%',
  padding: '12px 16px',
  background: 'rgba(0,0,0,0.2)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#fff',
  fontSize: 12,
  fontFamily: '"Space Mono", monospace',
  outline: 'none',
};

/**
 * TextInput - Single-line text input with consistent styling
 */
export function TextInput({ value, onChange, placeholder }: TextInputProps): JSX.Element {
  return (
    <input
      type="text"
      value={value || ''}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      style={inputStyle}
    />
  );
}
