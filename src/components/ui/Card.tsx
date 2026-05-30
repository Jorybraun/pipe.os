import { type HTMLAttributes, forwardRef, type ReactNode } from 'react';

export type CardVariant = 'default' | 'elevated' | 'glass' | 'outlined';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  header?: ReactNode;
  footer?: ReactNode;
  hoverable?: boolean;
}

const variantClasses: Record<CardVariant, string> = {
  default: [
    'bg-[var(--color-surface-solid)]',
    'border border-[var(--color-border)]',
  ].join(' '),
  elevated: [
    'bg-[var(--color-surface-elevated)]',
    'border border-[var(--color-border)]',
    'shadow-medium',
  ].join(' '),
  glass: [
    'bg-[rgba(220,220,230,0.15)]',
    'border border-[rgba(255,255,255,0.12)]',
    'backdrop-blur-glass',
    'shadow-glass',
  ].join(' '),
  outlined: [
    'bg-transparent',
    'border border-[var(--color-border)]',
  ].join(' '),
};

const paddingClasses: Record<'none' | 'sm' | 'md' | 'lg', string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  function Card(
    {
      variant = 'default',
      padding = 'md',
      header,
      footer,
      hoverable = false,
      className = '',
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={[
          'rounded-lg',
          'transition-all duration-normal ease-[var(--ease-standard)]',
          variantClasses[variant],
          hoverable
            ? 'hover:-translate-y-0.5 hover:shadow-large cursor-pointer'
            : '',
          // Apply padding to the wrapper if no header/footer, else to content section
          !header && !footer ? paddingClasses[padding] : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      >
        {header && (
          <div className="px-4 py-3 border-b border-[var(--color-border)]">
            {header}
          </div>
        )}
        {(header || footer) ? (
          <div className={paddingClasses[padding]}>{children}</div>
        ) : (
          children
        )}
        {footer && (
          <div className="px-4 py-3 border-t border-[var(--color-border)]">
            {footer}
          </div>
        )}
      </div>
    );
  },
);
