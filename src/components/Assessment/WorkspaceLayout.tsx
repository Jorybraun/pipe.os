import { ReactNode } from 'react';

interface WorkspaceLayoutProps {
  leftPanel: ReactNode | null;
  centerPanel: ReactNode;
  rightPanel: ReactNode | null;
}

/**
 * WorkspaceLayout - Responsive grid container for challenge panels.
 * Adapts to 1, 2, or 3 column layouts based on panel presence.
 */
export function WorkspaceLayout({
  leftPanel,
  centerPanel,
  rightPanel,
}: WorkspaceLayoutProps): JSX.Element {
  // Determine grid template based on active panels
  let gridTemplate = '1fr';
  if (leftPanel && rightPanel) {
    gridTemplate = '28% 47% 25%';
  } else if (leftPanel) {
    gridTemplate = '35% 65%';
  } else if (rightPanel) {
    gridTemplate = '65% 35%';
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: gridTemplate,
      gap: '1px',
      background: 'rgba(255,255,255,0.06)', // Border color between panels
      height: 'calc(100vh - 200px)', // Account for header/footer
      minHeight: '600px',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '8px',
      overflow: 'hidden',
      backgroundClip: 'padding-box'
    }}>
      {leftPanel && (
        <div style={{ 
          background: 'rgba(12, 12, 14, 0.4)', 
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {leftPanel}
        </div>
      )}
      
      <div style={{ 
        background: 'rgba(12, 12, 14, 0.2)', 
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {centerPanel}
      </div>

      {rightPanel && (
        <div style={{ 
          background: 'rgba(12, 12, 14, 0.4)', 
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {rightPanel}
        </div>
      )}
    </div>
  );
}
