import { CSSProperties } from 'react';
import { COMPONENT_VARIANTS, SPACING, TYPOGRAPHY, EFFECTS } from '@/lib/designTokens';

/**
 * Status badge variant type
 */
export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

/**
 * Status badge size type
 */
export type BadgeSize = 'sm' | 'md' | 'lg';

/**
 * Props for the StatusBadge component
 */
export interface StatusBadgeProps {
  /**
   * Status variant controlling color scheme
   * @default 'info'
   */
  status?: BadgeVariant;

  /**
   * Size of the badge
   * @default 'md'
   */
  size?: BadgeSize;

  /**
   * Custom label to display instead of status text
   */
  label?: string;

  /**
   * Icon element to display before text
   */
  icon?: React.ReactNode;

  /**
   * Whether the badge can be dismissed
   * @default false
   */
  dismissible?: boolean;

  /**
   * Callback fired when dismiss button is clicked
   */
  onDismiss?: () => void;

  /**
   * Accessible label for the badge
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

  /**
   * Optional click handler
   */
  onClick?: () => void;
}

/**
 * Gets the display text for a status
 */
function getStatusText(status: BadgeVariant): string {
  const statusMap: Record<BadgeVariant, string> = {
    success: 'Success',
    warning: 'Warning',
    error: 'Error',
    info: 'Info',
    neutral: 'Status',
  };
  return statusMap[status];
}

/**
 * Gets the variant styles for a status
 */
function getVariantStyles(status: BadgeVariant): CSSProperties {
  const variants = {
    success: COMPONENT_VARIANTS.BADGE.SUCCESS,
    warning: COMPONENT_VARIANTS.BADGE.WARNING,
    error: COMPONENT_VARIANTS.BADGE.ERROR,
    info: COMPONENT_VARIANTS.BADGE.INFO,
    neutral: COMPONENT_VARIANTS.BADGE.NEUTRAL,
  };

  const variant = variants[status];
  return {
    color: variant.color as string,
    backgroundColor: variant.background as string,
    borderColor: variant.border as string,
  };
}

/**
 * Gets size-specific styles
 */
function getSizeStyles(size: BadgeSize): CSSProperties {
  const sizeMap = {
    sm: {
      fontSize: TYPOGRAPHY.SIZES.TINY,
      padding: `${4}px ${8}px`,
      height: '20px',
    },
    md: {
      fontSize: TYPOGRAPHY.SIZES.SMALL,
      padding: `${6}px ${12}px`,
      height: '28px',
    },
    lg: {
      fontSize: TYPOGRAPHY.SIZES.BODY,
      padding: `${8}px ${16}px`,
      height: '36px',
    },
  };

  return sizeMap[size];
}

/**
 * StatusBadge component for displaying status indicators
 *
 * Displays a status badge with optional icon, dismissible button, and accessibility support.
 * Supports 5 status variants (success, warning, error, info, neutral) and 3 sizes (sm, md, lg).
 *
 * @example
 * ```tsx
 * <StatusBadge status="success" label="Approved" />
 * <StatusBadge status="error" label="Failed" dismissible onDismiss={() => {}} />
 * <StatusBadge status="warning" icon={<AlertIcon />} size="sm" />
 * ```
 */
export function StatusBadge({
  status = 'info',
  size = 'md',
  label,
  icon,
  dismissible = false,
  onDismiss,
  ariaLabel,
  className,
  style,
  onClick,
}: StatusBadgeProps): JSX.Element {
  const displayText = label || getStatusText(status);
  const variantStyles = getVariantStyles(status);
  const sizeStyles = getSizeStyles(size);

  const badgeStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: SPACING.sm,
    border: `1px solid ${variantStyles.borderColor}`,
    borderRadius: EFFECTS.BORDER.RADIUS_SM,
    backgroundColor: variantStyles.backgroundColor,
    color: variantStyles.color,
    fontFamily: TYPOGRAPHY.FONT_FAMILY.PRIMARY,
    fontWeight: TYPOGRAPHY.WEIGHT.REGULAR,
    whiteSpace: 'nowrap',
    userSelect: 'none',
    ...sizeStyles,
    ...style,
  };

  return (
    <span
      role="status"
      data-testid={`badge-${status}`}
      aria-label={ariaLabel || `${status} status: ${displayText}`}
      style={badgeStyle}
      className={className}
      onClick={onClick}
    >
      {icon && <span data-testid="badge-icon">{icon}</span>}
      <span>{displayText}</span>
      {dismissible && (
        <button
          type="button"
          aria-label={`Dismiss ${displayText}`}
          onClick={(e) => {
            e.stopPropagation();
            onDismiss?.();
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer',
            padding: '0',
            display: 'flex',
            alignItems: 'center',
            marginLeft: '4px',
            fontSize: 'inherit',
            opacity: 0.7,
            transition: `opacity ${EFFECTS.TRANSITION.NORMAL}`,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.opacity = '1';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.opacity = '0.7';
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}

export default StatusBadge;
