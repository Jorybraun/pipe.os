interface TextareaPanelProps {
  question: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
}

/**
 * TextareaPanel - Short-answer challenge renderer.
 */
export function TextareaPanel({
  question,
  value,
  onChange,
  placeholder = "Type your response here...",
  maxLength
}: TextareaPanelProps): JSX.Element {
  const currentLength = value.length;
  
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', width: '100%', padding: '60px 20px', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h2 style={{ 
        fontSize: 24, 
        fontWeight: 700, 
        color: 'var(--pipe-text, #fff)', 
        marginBottom: 40, 
        lineHeight: 1.4,
        letterSpacing: '-0.01em'
      }}>
        {question}
      </h2>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          style={{
            flex: 1,
            width: '100%',
            background: 'var(--pipe-surface)',
            border: '1px solid var(--pipe-border)',
            borderRadius: 8,
            padding: 32,
            color: 'var(--pipe-text, #fff)',
            fontSize: 16,
            lineHeight: 1.6,
            outline: 'none',
            resize: 'none',
            fontFamily: 'inherit',
            transition: 'border-color 0.2s',
          }}
          onFocus={(e) => e.currentTarget.style.borderColor = 'rgba(96, 165, 250, 0.4)'}
          onBlur={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'}
        />

        {maxLength && (
          <div style={{ 
            position: 'absolute', 
            bottom: 16, 
            right: 24, 
            fontSize: 10, 
            color: currentLength >= maxLength ? '#f87171' : 'rgba(255,255,255,0.2)',
            fontFamily: 'Space Mono',
            letterSpacing: '0.1em'
          }}>
            {currentLength} / {maxLength}_CHARS
          </div>
        )}
      </div>
    </div>
  );
}
