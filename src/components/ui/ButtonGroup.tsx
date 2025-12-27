/**
 * Option for ButtonGroup.
 */
export interface ButtonGroupOption {
  /**
   * Unique value for the option.
   */
  value: string;

  /**
   * Display label for the option.
   */
  label: string;
}

/**
 * Props for the ButtonGroup component.
 */
export interface ButtonGroupProps {
  /**
   * Available options to choose from.
   */
  options: ButtonGroupOption[];

  /**
   * Currently selected value(s).
   * Can be a single string or array of strings for multi-select.
   */
  selected: string | string[];

  /**
   * Callback fired when selection changes.
   * Optional - if not provided, component is display-only.
   */
  onChange?: (value: string) => void;

  /**
   * Whether the button group is disabled.
   * @default false
   */
  disabled?: boolean;
}

/**
 * Button group component for selecting options.
 *
 * A stateless component that displays a group of buttons for option selection.
 * Can be used in display-only mode by omitting the onChange handler.
 *
 * @example
 * ```tsx
 * const options = [
 *   { value: 'technical', label: 'TECHNICAL' },
 *   { value: 'behavioral', label: 'BEHAVIORAL' },
 * ];
 *
 * <ButtonGroup
 *   options={options}
 *   selected="technical"
 *   onChange={(value) => setQuestionType(value)}
 * />
 * ```
 */
export function ButtonGroup({
  options,
  selected,
  onChange,
  disabled = false,
}: ButtonGroupProps): JSX.Element {
  const isSelected = (value: string): boolean => {
    if (Array.isArray(selected)) {
      return selected.includes(value);
    }
    return selected === value;
  };

  const handleClick = (value: string): void => {
    if (!disabled && onChange) {
      onChange(value);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map((option) => {
        const selected = isSelected(option.value);

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => handleClick(option.value)}
            disabled={disabled}
            aria-pressed={selected}
            style={{
              padding: '8px 14px',
              background: selected ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${selected ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)'}`,
              color: selected ? '#fff' : 'rgba(255,255,255,0.5)',
              fontSize: 9,
              letterSpacing: '0.1em',
              cursor: disabled ? 'not-allowed' : onChange ? 'pointer' : 'default',
              textTransform: 'uppercase',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
