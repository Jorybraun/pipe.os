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
        rgba(180, 180, 190, 0.06) 0%,
        rgba(120, 120, 140, 0.03) 25%,
        rgba(200, 200, 210, 0.06) 50%,
        rgba(100, 100, 120, 0.03) 75%,
        rgba(160, 160, 180, 0.06) 100%
      )`,
      border: '1px solid var(--pipe-border)',
      backdropFilter: 'blur(40px) saturate(150%)',
    },
    chrome: {
      background: `linear-gradient(135deg,
        rgba(220, 220, 230, 0.10) 0%,
        rgba(180, 180, 200, 0.05) 20%,
        rgba(255, 255, 255, 0.12) 40%,
        rgba(160, 160, 180, 0.05) 60%,
        rgba(200, 200, 220, 0.08) 80%,
        rgba(140, 140, 160, 0.05) 100%
      )`,
      border: '1px solid var(--pipe-border)',
      backdropFilter: 'blur(40px) saturate(150%)',
    },
    mercury: {
      background: `linear-gradient(160deg,
        rgba(200, 210, 230, 0.08) 0%,
        rgba(180, 190, 220, 0.04) 30%,
        rgba(220, 225, 240, 0.10) 50%,
        rgba(170, 180, 210, 0.05) 70%,
        rgba(190, 200, 225, 0.07) 100%
      )`,
      border: '1px solid var(--pipe-border)',
      backdropFilter: 'blur(40px) saturate(150%)',
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
        position: 'relative',
        transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        boxShadow: 'none',
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
