import { useState } from 'react';
import { X } from 'lucide-react';

interface TagsInputProps {
  value?: string[];
  onChange?: (value: string[]) => void;
  placeholder?: string;
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
 * TagsInput - Multi-value input that creates tags from user input
 *
 * Features:
 * - Add tags by pressing Enter
 * - Remove tags by clicking X
 * - Visual tag display with gradient background
 * - Keyboard-accessible
 *
 * @example
 * ```tsx
 * <TagsInput
 *   value={techStack}
 *   onChange={setTechStack}
 *   placeholder="Press Enter to add technologies"
 * />
 * ```
 */
export function TagsInput({
  value = [],
  onChange,
  placeholder,
}: TagsInputProps): JSX.Element {
  const [input, setInput] = useState('');

  const handleAdd = (): void => {
    if (input.trim() && onChange) {
      onChange([...value, input.trim()]);
      setInput('');
    }
  };

  const handleRemove = (index: number): void => {
    if (onChange) {
      onChange(value.filter((_, i) => i !== index));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div>
      {value.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 12,
          }}
        >
          {value.map((tag, i) => (
            <span
              key={i}
              style={{
                padding: '6px 12px',
                background:
                  'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(59, 130, 246, 0.15))',
                border: '1px solid rgba(139, 92, 246, 0.3)',
                fontSize: 10,
                color: 'rgba(139, 92, 246, 0.9)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {tag}
              <button
                type="button"
                onClick={() => handleRemove(i)}
                aria-label={`Remove ${tag}`}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  opacity: 0.6,
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  color: 'inherit',
                }}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  );
}
