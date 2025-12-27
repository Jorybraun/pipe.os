import React from 'react';

/**
 * Section subtitle component with consistent styling.
 */
export function SubTitle({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 6, height: 6, background: 'rgba(255,255,255,0.4)' }} />
      <span style={{
        fontSize: 9,
        letterSpacing: '0.3em',
        color: 'rgba(255,255,255,0.4)',
        textTransform: 'uppercase'
      }}>
        {children}
      </span>
    </div>
  );
}
