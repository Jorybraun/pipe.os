import { Check } from 'lucide-react';

interface OptionsPanelProps {
  question: string;
  options: Array<{ id: string; text: string }>;
  selectedId: string | null;
  selectedIds?: string[];
  selectionMode?: 'single' | 'multi';
  onSelect: (id: string) => void;
  locked?: boolean;
}

/**
 * OptionsPanel - Multiple-choice question renderer.
 *
 * Supports single-select (radio) and multi-select (checkbox) modes.
 * Default mode is single-select for backward compatibility.
 */
export function OptionsPanel({
  question,
  options,
  selectedId,
  selectedIds,
  selectionMode = 'single',
  onSelect,
  locked = false
}: OptionsPanelProps): JSX.Element {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto', width: '100%', padding: '60px 20px' }}>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {options.map((option) => {
          const isSelected = selectionMode === 'multi'
            ? (selectedIds ?? []).includes(option.id)
            : selectedId === option.id;

          return (
            <button
              key={option.id}
              onClick={() => !locked && onSelect(option.id)}
              disabled={locked}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                padding: '24px 32px',
                background: isSelected ? 'rgba(96, 165, 250, 0.1)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isSelected ? 'rgba(96, 165, 250, 0.4)' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: 8,
                textAlign: 'left',
                cursor: locked ? 'default' : 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                width: '100%',
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              {selectionMode === 'multi' ? (
                <div
                  data-testid="checkbox-indicator"
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    border: `2px solid ${isSelected ? '#60a5fa' : 'rgba(255,255,255,0.1)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: isSelected ? '#60a5fa' : 'transparent',
                    transition: 'all 0.2s',
                    flexShrink: 0
                  }}
                >
                  {isSelected && <Check size={14} color="#000" strokeWidth={3} />}
                </div>
              ) : (
                <div style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  border: `2px solid ${isSelected ? '#60a5fa' : 'rgba(255,255,255,0.1)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: isSelected ? '#60a5fa' : 'transparent',
                  transition: 'all 0.2s',
                  flexShrink: 0
                }}>
                  {isSelected && <Check size={14} color="#000" strokeWidth={3} />}
                </div>
              )}

              <span style={{
                fontSize: 16,
                fontWeight: 500,
                color: isSelected ? '#fff' : 'rgba(255,255,255,0.6)',
                transition: 'all 0.2s'
              }}>
                {option.text}
              </span>

              {isSelected && (
                <div style={{
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: 4,
                  background: '#60a5fa'
                }} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
