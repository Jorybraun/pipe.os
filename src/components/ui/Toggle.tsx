/**
 * Props for the Toggle component.
 */
export interface ToggleProps {
  /**
   * Current checked state of the toggle.
   */
  checked: boolean;

  /**
   * Callback fired when the toggle state changes.
   * Optional - if not provided, toggle is display-only.
   */
  onChange?: (checked: boolean) => void;

  /**
   * Whether the toggle is disabled.
   * @default false
   */
  disabled?: boolean;

  /**
   * Accessible label for the toggle.
   */
  ariaLabel: string;
}

/**
 * Toggle switch component with accessible markup.
 *
 * A stateless toggle component that can be used for binary on/off states.
 * Supports keyboard interaction and screen readers.
 *
 * @example
 * ```tsx
 * <Toggle
 *   checked={isEnabled}
 *   onChange={(checked) => setIsEnabled(checked)}
 *   ariaLabel="Enable feature"
 * />
 * ```
 */
export function Toggle({ checked, onChange, disabled = false, ariaLabel }: ToggleProps): JSX.Element {
  const handleClick = (): void => {
    if (!disabled && onChange) {
      onChange(!checked);
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={handleClick}
      disabled={disabled}
      style={{
        width: 56,
        height: 28,
        background: checked ? 'rgba(150,255,150,0.3)' : 'rgba(255,255,255,0.1)',
        border: `1px solid ${checked ? 'rgba(150,255,150,0.5)' : 'rgba(255,255,255,0.15)'}`,
        cursor: disabled ? 'not-allowed' : onChange ? 'pointer' : 'default',
        position: 'relative',
        padding: 2,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          background: checked ? 'rgba(150,255,150,0.9)' : 'rgba(255,255,255,0.4)',
          position: 'absolute',
          left: checked ? 'calc(100% - 24px)' : '2px',
          transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
    </button>
  );
}
