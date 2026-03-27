import type { ReactNode } from 'react';

interface FullBleedLayoutProps {
  slots?: Record<string, ReactNode>;
  children?: ReactNode;
}

/**
 * FullBleedLayout - Single-column layout for non-workspace challenge types
 * (MCQ, Short Answer, Follow-Up). Centers the content panel.
 */
export function FullBleedLayout({ slots, children }: FullBleedLayoutProps): JSX.Element {
  const content = slots?.center ?? children ?? null;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 'calc(100vh - 200px)',
      padding: '40px 24px',
    }}>
      <div style={{ width: '100%', maxWidth: 720 }}>
        {content}
      </div>
    </div>
  );
}
