import { type ReactNode } from 'react';
import { FieldLabel } from './FieldLabel';

interface FieldGroupProps {
  label: string;
  required?: boolean;
  children: ReactNode;
}

/**
 * FieldGroup - Combines a field label with its input control
 *
 * Provides consistent spacing and layout for form fields.
 * Automatically handles required field indicator.
 *
 * @example
 * ```tsx
 * <FieldGroup label="Job Title" required>
 *   <TextInput value={title} onChange={setTitle} placeholder="e.g., Senior Engineer" />
 * </FieldGroup>
 * ```
 */
export function FieldGroup({
  label,
  required = false,
  children,
}: FieldGroupProps): JSX.Element {
  return (
    <div style={{ marginBottom: 20 }}>
      <FieldLabel required={required}>{label}</FieldLabel>
      {children}
    </div>
  );
}
