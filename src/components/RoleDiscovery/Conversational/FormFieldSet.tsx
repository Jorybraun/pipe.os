import { ReactNode } from 'react';

interface FormFieldSetProps {
  isActive: boolean;
  children: ReactNode;
  order: number;
  currentOrder: number;
}

/**
 * FormFieldSet - A semantic section of a multi-phase form.
 * 
 * Uses grid-area stacking to allow horizontal transitions without
 * absolute positioning mess.
 */
export function FormFieldSet({ isActive, children, order, currentOrder }: FormFieldSetProps) {
  const isPast = order < currentOrder;

  return (
    <fieldset
      style={{
        gridArea: '1 / 1', // Stacks all fieldsets in the same grid cell
        border: 'none',
        padding: 0,
        margin: 0,
        width: '100%',
        transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        opacity: isActive ? 1 : 0,
        transform: isActive 
          ? 'translateX(0)' 
          : isPast 
            ? 'translateX(-40px)' 
            : 'translateX(40px)',
        pointerEvents: isActive ? 'auto' : 'none',
        zIndex: isActive ? 1 : 0,
        visibility: isActive ? 'visible' : 'hidden',
      }}
      aria-hidden={!isActive}
    >
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 32,
      }}>
        {children}
      </div>
    </fieldset>
  );
}
