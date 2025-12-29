interface FieldLabelProps {
  children: string;
  required?: boolean;
}

/**
 * FieldLabel - Label for form fields with optional required indicator
 */
export function FieldLabel({ children, required = false }: FieldLabelProps): JSX.Element {
  return (
    <div
      style={{
        fontSize: 8,
        letterSpacing: '0.2em',
        color: 'rgba(255,255,255,0.3)',
        marginBottom: 10,
        textTransform: 'uppercase',
      }}
    >
      {children} {required && <span style={{ color: 'rgba(255,100,100,0.6)' }}>*</span>}
    </div>
  );
}
