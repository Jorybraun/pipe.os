import { type ReactNode } from 'react';
import { FieldLabel } from './FieldLabel';

interface FieldGroupProps {
  label: string;
  required?: boolean;
  /** Helper text displayed below the input */
  hint?: string;
  /** Validation error message displayed below the input */
  error?: string;
  children: ReactNode;
}

/**
 * FieldGroup - Combines a field label with its input control
 *
 * Provides consistent spacing and layout for form fields.
 * Handles required indicators, hint text, and validation errors.
 *
 * @example
 * ```tsx
 * <FieldGroup label="Job Title" required error={fieldErrors.title}>
 *   <TextInput value={title} onChange={setTitle} placeholder="e.g., Senior Engineer" />
 * </FieldGroup>
 *
 * <FieldGroup label="Tech Stack" hint="Press Enter to add each technology">
 *   <TagsInput value={stack} onChange={setStack} placeholder="React, TypeScript..." />
 * </FieldGroup>
 * ```
 */
export function FieldGroup({
  label,
  required = false,
  hint,
  error,
  children,
}: FieldGroupProps): JSX.Element {
  return (
    <div style={{ marginBottom: 24 }}>
      <FieldLabel required={required}>{label}</FieldLabel>
      {children}
      {error && (
        <p
          role="alert"
          style={{
            marginTop: 6,
            fontSize: 10,
            fontFamily: '"Space Mono", monospace',
            color: 'rgba(252, 165, 165, 0.85)',
            letterSpacing: '0.05em',
          }}
        >
          {error}
        </p>
      )}
      {hint && !error && (
        <p
          style={{
            marginTop: 6,
            fontSize: 10,
            fontFamily: '"Space Mono", monospace',
            color: 'rgba(255,255,255,0.25)',
            letterSpacing: '0.05em',
          }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
