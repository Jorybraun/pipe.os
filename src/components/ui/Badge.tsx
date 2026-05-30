import type { HTMLAttributes, ReactNode } from 'react';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';
export type BadgeSize = 'sm' | 'md' | 'lg';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: ReactNode;
  dot?: boolean;
  removable?: boolean;
  onRemove?: () => void;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: [
    'bg-[var(--color-surface)]',
    'text-[var(--color-text-muted)]',
    'border border-[var(--color-border)]',
  ].join(' '),
  success: [
    'bg-success-50/10 text-success-400',
    'border border-success-400/30',
  ].join(' '),
  warning: [
    'bg-warning-50/10 text-warning-400',
    'border border-warning-400/30',
  ].join(' '),
  error: [
    'bg-error-50/10 text-error-400',
    'border border-error-400/30',
  ].join(' '),
  info: [
    'bg-primary-50/10 text-primary-400',
    'border border-primary-400/30',
  ].join(' '),
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-tiny gap-1',
  md: 'px-3 py-1 text-caption gap-1.5',
  lg: 'px-3.5 py-1.5 text-sm gap-2',
};

const dotColorClasses: Record<BadgeVariant, string> = {
  default: 'bg-[var(--color-text-dim)]',
  success: 'bg-success-400',
  warning: 'bg-warning-400',
  error: 'bg-error-400',
  info: 'bg-primary-400',
};

export function Badge({
  variant = 'default',
  size = 'md',
  icon,
  dot = false,
  removable = false,
  onRemove,
  className = '',
  children,
  ...rest
}: BadgeProps): JSX.Element {
  return (
    <span
      className={[
        'inline-flex items-center',
        'font-sans font-medium',
        'rounded-sm whitespace-nowrap select-none',
        'transition-colors duration-fast',
        variantClasses[variant],
        sizeClasses[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {dot && (
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColorClasses[variant]}`}
        />
      )}
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {children}
      {removable && (
        <button
          type="button"
          aria-label="Remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          className={[
            'ml-0.5 -mr-1',
            'inline-flex items-center justify-center',
            'w-4 h-4 rounded-sm',
            'opacity-60 hover:opacity-100',
            'transition-opacity duration-fast',
            'cursor-pointer bg-transparent border-none',
            'text-current',
          ].join(' ')}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" />
          </svg>
        </button>
      )}
    </span>
  );
}
