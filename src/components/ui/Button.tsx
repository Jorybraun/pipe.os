import { type ButtonHTMLAttributes, forwardRef } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: [
    'bg-primary-500 text-white',
    'hover:bg-primary-600 active:bg-primary-700',
    'border border-transparent',
    'shadow-subtle hover:shadow-medium',
  ].join(' '),
  secondary: [
    'bg-transparent',
    'text-[var(--color-text)]',
    'border border-[var(--color-border)]',
    'hover:bg-[var(--color-surface-hover)]',
    'hover:border-[var(--color-accent-border)]',
  ].join(' '),
  ghost: [
    'bg-transparent border-none',
    'text-[var(--color-text-muted)]',
    'hover:text-[var(--color-text)]',
    'hover:bg-[var(--color-surface-hover)]',
  ].join(' '),
  danger: [
    'bg-error-400 text-white',
    'hover:bg-error-500 active:bg-error-600',
    'border border-transparent',
    'shadow-subtle hover:shadow-medium',
  ].join(' '),
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-caption gap-1.5 rounded-sm',
  md: 'px-4 py-2 text-sm gap-2 rounded-md',
  lg: 'px-6 py-3 text-body gap-2.5 rounded-md',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'primary',
      size = 'md',
      icon,
      iconRight,
      loading = false,
      fullWidth = false,
      disabled,
      className = '',
      children,
      ...rest
    },
    ref,
  ) {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={[
          'inline-flex items-center justify-center',
          'font-sans font-medium',
          'transition-all duration-normal ease-[var(--ease-standard)]',
          'select-none whitespace-nowrap',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500',
          variantClasses[variant],
          sizeClasses[size],
          fullWidth ? 'w-full' : '',
          isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      >
        {loading ? (
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
        ) : icon ? (
          <span className="flex-shrink-0">{icon}</span>
        ) : null}
        {children && <span>{children}</span>}
        {iconRight && <span className="flex-shrink-0">{iconRight}</span>}
      </button>
    );
  },
);
