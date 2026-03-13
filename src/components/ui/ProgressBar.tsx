import { useMemo, CSSProperties } from 'react';
import { TYPOGRAPHY, EFFECTS, COLORS } from '@/lib/designTokens';

/**
 * Progress bar status variant
 */
export type ProgressStatus = 'success' | 'warning' | 'error' | 'info';

/**
 * Progress bar size type
 */
export type ProgressSize = 'sm' | 'md' | 'lg';

/**
 * Props for the ProgressBar component
 */
export interface ProgressBarProps {
  /**
   * Current progress value (0-100)
   * If null, shows indeterminate state
   * @default 0
   */
  value?: number | null;

  /**
   * Maximum progress value
   * @default 100
   */
  max?: number;

  /**
   * Custom label to display
   */
  label?: string;

  /**
   * Whether to show percentage text
   * @default true
   */
  showPercentage?: boolean;

  /**
   * Status variant controlling color
   * @default 'info'
   */
  status?: ProgressStatus;

  /**
   * Size of the progress bar
   * @default 'md'
   */
  size?: ProgressSize;

  /**
   * Whether to show animated fill (shimmer)
   * @default false
   */
  animated?: boolean;

  /**
   * Whether to show diagonal stripes pattern
   * @default false
   */
  striped?: boolean;

  /**
   * Accessible label for the progress bar
   */
  ariaLabel?: string;

  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Additional inline styles
   */
  style?: CSSProperties;
}

/**
 * Gets the variant styles for a status
 */
function getStatusColor(status: ProgressStatus): string {
  const statusMap = {
    success: COLORS.STATUS.SUCCESS,
    warning: COLORS.STATUS.WARNING,
    error: COLORS.STATUS.ERROR,
    info: COLORS.STATUS.INFO,
  };
  return statusMap[status];
}

/**
 * Gets size-specific height
 */
function getSizeHeight(size: ProgressSize): number {
  const sizeMap = {
    sm: 4,
    md: 6,
    lg: 8,
  };
  return sizeMap[size];
}

/**
 * ProgressBar component for showing progress or activity
 *
 * Displays a linear progress indicator with support for determinate/indeterminate states,
 * animations, and multiple status variants. Fully accessible with ARIA attributes.
 *
 * @example
 * ```tsx
 * <ProgressBar value={65} label="Uploading" />
 * <ProgressBar value={null} label="Loading..." /> // Indeterminate
 * <ProgressBar value={100} status="success" animated />
 * ```
 */
export function ProgressBar({
  value = 0,
  max = 100,
  label,
  showPercentage = true,
  status = 'info',
  size = 'md',
  animated = false,
  striped = false,
  ariaLabel,
  className,
  style,
}: ProgressBarProps): JSX.Element {
  // Clamp value to [0, max]
  const clampedValue = useMemo(() => {
    if (value === null) return null;
    return Math.max(0, Math.min(value, max));
  }, [value, max]);

  // Calculate percentage (0-100)
  const percentage = useMemo(() => {
    if (clampedValue === null) return 0;
    return (clampedValue / max) * 100;
  }, [clampedValue, max]);

  // Determine if indeterminate
  const isIndeterminate = value === null;

  // Get visual styles
  const statusColor = getStatusColor(status);
  const height = getSizeHeight(size);

  // Keyframe animations
  const shimmerAnimation = `
    @keyframes shimmer {
      0%   { background-position: -200% 0; }
      100% { background-position:  200% 0; }
    }
  `;

  const indeterminateAnimation = `
    @keyframes indeterminate {
      0%   { left: -50%; width: 50%; }
      100% { left: 100%;  width: 50%; }
    }
  `;

  // Bar fill styles
  const barFillStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '100%',
    backgroundColor: statusColor,
    transition: isIndeterminate ? 'none' : `width ${EFFECTS.TRANSITION.NORMAL} ${EFFECTS.EASING.SMOOTH}`,
    width: isIndeterminate ? '50%' : `${percentage}%`,
    ...(striped && {
      backgroundImage: `repeating-linear-gradient(
        45deg,
        transparent,
        transparent 10px,
        rgba(255,255,255,0.1) 10px,
        rgba(255,255,255,0.1) 20px
      )`,
    }),
    ...(animated && {
      backgroundSize: '200% 100%',
      animation: `shimmer ${EFFECTS.TRANSITION.SLOW} linear infinite`,
    }),
    ...(isIndeterminate && {
      animation: `indeterminate ${EFFECTS.TRANSITION.SLOWER} linear infinite`,
    }),
  };

  // Container styles
  const containerStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: `${height}px`,
    backgroundColor: 'rgba(255,255,255,0.05)',
    border: `1px solid rgba(255,255,255,0.1)`,
    borderRadius: '4px',
    overflow: 'hidden',
    ...style,
  };

  // Percentage text
  const percentageText = showPercentage && !isIndeterminate ? `${Math.round(percentage)}%` : '';
  const displayLabel = label || (percentageText ? percentageText : undefined);

  return (
    <div style={{ width: '100%' }}>
      {/* CSS Animations */}
      <style>{shimmerAnimation}{indeterminateAnimation}</style>

      {/* Progress Bar Container */}
      <div
        role="progressbar"
        data-testid="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={ariaLabel || displayLabel || 'Progress'}
        aria-busy={isIndeterminate}
        style={containerStyle}
        className={className}
        {...(!isIndeterminate && { 'aria-valuenow': clampedValue as number })}
      >
        {/* Fill Bar */}
        <div style={barFillStyle} data-testid="progressbar-fill" />
      </div>

      {/* Label (if provided or showing percentage) */}
      {displayLabel && (
        <div
          style={{
            marginTop: '4px',
            fontSize: TYPOGRAPHY.SIZES.SMALL,
            color: 'rgba(255,255,255,0.6)',
            textAlign: 'right',
          }}
          data-testid="progressbar-label"
        >
          {displayLabel}
        </div>
      )}
    </div>
  );
}

export default ProgressBar;
