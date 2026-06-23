import { type ReactNode, type CSSProperties } from 'react';

/**
 * Visual variants for the LiquidMetalCard component.
 */
export type LiquidMetalCardVariant = 'default' | 'chrome' | 'mercury' | 'dark' | 'solid';

/**
 * Props for the LiquidMetalCard component.
 */
export interface LiquidMetalCardProps {
  /**
   * Content to be rendered inside the card.
   */
  children: ReactNode;

  /**
   * Visual variant of the card.
   * @default 'default'
   */
  variant?: LiquidMetalCardVariant;

  /**
   * Additional CSS styles to apply to the card.
   */
  style?: CSSProperties;

  /**
   * Optional CSS class name.
   */
  className?: string;

  /**
   * Optional click handler.
   */
  onClick?: (() => void) | undefined;
}

/**
 * Liquid metal glass card component with glassmorphic visual effects.
 *
 * A stateless component that renders a card with various visual variants
 * featuring gradient backgrounds, backdrop filters, and subtle borders.
 *
 * @example
 * ```tsx
 * <LiquidMetalCard variant="mercury">
 *   <p>Card content</p>
 * </LiquidMetalCard>
 * ```
 */
export function LiquidMetalCard({
  children,
  variant = 'default',
  style = {},
  className = '',
  onClick,
}: LiquidMetalCardProps): JSX.Element {
  const variants: Record<LiquidMetalCardVariant, { background: string; border: string; backdropFilter?: string }> = {
    default: {
      background: `linear-gradient(135deg,
        var(--pipe-surface-solid) 0%,
        var(--pipe-surface-elevated) 48%,
        var(--pipe-surface-solid-hover) 100%
      )`,
      border: '1px solid var(--pipe-border)',
      backdropFilter: 'blur(20px) saturate(115%)',
    },
    chrome: {
      background: `linear-gradient(135deg,
        var(--pipe-surface-solid-hover) 0%,
        var(--pipe-surface-elevated) 42%,
        var(--pipe-surface-solid) 100%
      )`,
      border: '1px solid var(--pipe-border)',
      backdropFilter: 'blur(22px) saturate(120%)',
    },
    mercury: {
      background: `linear-gradient(160deg,
        var(--pipe-surface-elevated) 0%,
        var(--pipe-surface-solid) 52%,
        var(--pipe-surface-hover) 100%
      )`,
      border: '1px solid var(--pipe-border)',
      backdropFilter: 'blur(22px) saturate(120%)',
    },
    dark: {
      background: `linear-gradient(135deg,
        rgba(40, 40, 50, 0.6) 0%,
        rgba(60, 60, 80, 0.5) 50%,
        rgba(30, 30, 40, 0.7) 100%
      )`,
      border: '1px solid var(--pipe-border)',
      backdropFilter: 'blur(40px) saturate(150%)',
    },
    solid: {
      background: 'var(--pipe-surface-elevated)',
      border: '1px solid var(--pipe-border)',
    },
  };

  const v = variants[variant];

  return (
    <div
      onClick={onClick}
      className={className}
      style={{
        background: v.background,
        border: v.border,
        color: 'var(--pipe-text)',
        position: 'relative',
        transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        boxShadow: '0 18px 52px var(--pipe-shadow)',
        cursor: onClick ? 'pointer' : 'default',
        ...(v.backdropFilter ? {
          backdropFilter: v.backdropFilter,
          WebkitBackdropFilter: v.backdropFilter,
        } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
