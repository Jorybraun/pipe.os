import { type InputHTMLAttributes, type TextareaHTMLAttributes, forwardRef, type ReactNode } from 'react';

export type InputSize = 'sm' | 'md' | 'lg';

interface BaseInputProps {
  label?: string;
  hint?: string;
  error?: string;
  inputSize?: InputSize;
  icon?: ReactNode;
  fullWidth?: boolean;
}

export interface TextInputProps
  extends BaseInputProps,
    Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  multiline?: false;
}

export interface TextareaInputProps
  extends BaseInputProps,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> {
  multiline: true;
  rows?: number;
}

export type InputProps = TextInputProps | TextareaInputProps;

const sizeClasses: Record<InputSize, string> = {
  sm: 'px-3 py-1.5 text-caption',
  md: 'px-3 py-2 text-body',
  lg: 'px-4 py-3 text-body',
};

const fieldClasses = [
  'w-full font-sans',
  'bg-transparent',
  'text-[var(--color-text)]',
  'placeholder:text-[var(--color-text-dim)]',
  'border border-[var(--color-border)]',
  'rounded-md',
  'transition-all duration-normal ease-[var(--ease-standard)]',
  'focus:outline-none focus:border-[var(--color-accent-border)]',
  'focus:ring-2 focus:ring-[var(--color-accent-surface)]',
  'disabled:opacity-50 disabled:cursor-not-allowed',
].join(' ');

export const Input = forwardRef<
  HTMLInputElement | HTMLTextAreaElement,
  InputProps
>(function Input(props, ref) {
  const {
    label,
    hint,
    error,
    inputSize = 'md',
    icon,
    fullWidth = true,
    className = '',
    ...rest
  } = props;

  const widthClass = fullWidth ? 'w-full' : '';

  return (
    <div className={`flex flex-col gap-1.5 ${widthClass}`}>
      {label && (
        <label className="text-caption font-medium tracking-wide uppercase text-[var(--color-text-muted)]">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-dim)] pointer-events-none">
            {icon}
          </span>
        )}
        {props.multiline ? (
          <textarea
            ref={ref as React.Ref<HTMLTextAreaElement>}
            rows={props.rows ?? 3}
            className={[
              fieldClasses,
              sizeClasses[inputSize],
              'resize-y',
              error ? 'border-error-400 focus:border-error-400 focus:ring-error-50' : '',
              icon ? 'pl-10' : '',
              className,
            ]
              .filter(Boolean)
              .join(' ')}
            {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
          />
        ) : (
          <input
            ref={ref as React.Ref<HTMLInputElement>}
            className={[
              fieldClasses,
              sizeClasses[inputSize],
              error ? 'border-error-400 focus:border-error-400 focus:ring-error-50' : '',
              icon ? 'pl-10' : '',
              className,
            ]
              .filter(Boolean)
              .join(' ')}
            {...(rest as InputHTMLAttributes<HTMLInputElement>)}
          />
        )}
      </div>
      {hint && !error && (
        <p className="text-caption text-[var(--color-text-dim)]">{hint}</p>
      )}
      {error && (
        <p className="text-caption text-error-400">{error}</p>
      )}
    </div>
  );
});
