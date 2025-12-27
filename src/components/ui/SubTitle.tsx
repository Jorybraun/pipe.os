import { type ReactNode } from 'react';

/**
 * Props for the SubTitle component.
 */
export interface SubTitleProps {
  /**
   * Content to display as the subtitle.
   */
  children: ReactNode;
}

/**
 * Section subtitle component with consistent styling.
 *
 * Displays a small indicator dot followed by uppercase text,
 * used for section headings throughout the application.
 *
 * @example
 * ```tsx
 * <SubTitle>QUESTION_CONTENT</SubTitle>
 * ```
 */
export function SubTitle({ children }: SubTitleProps): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 6, height: 6, background: 'rgba(255,255,255,0.4)' }} />
      <span
        style={{
          fontSize: 9,
          letterSpacing: '0.3em',
          color: 'rgba(255,255,255,0.4)',
          textTransform: 'uppercase',
        }}
      >
        {children}
      </span>
    </div>
  );
}
