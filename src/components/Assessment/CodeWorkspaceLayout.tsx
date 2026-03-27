// ---------------------------------------------------------------------------
// CodeWorkspaceLayout — candidate-facing layout for backend CODE_IMPLEMENTATION
//
// 2-column resizable: Problem (left) | Code + Console (right)
// Console docked at bottom of right column.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';

interface CodeWorkspaceLayoutProps {
  slots: {
    left?: ReactNode;
    center: ReactNode;
    bottom?: ReactNode;
  };
}

export function CodeWorkspaceLayout({ slots }: CodeWorkspaceLayoutProps): JSX.Element {
  return (
    <div style={{
      height: 'calc(100vh - 160px)',
      width: '100%',
      overflow: 'hidden',
    }} className="pipe-allotment">
      <style>{`
        .pipe-allotment .sash-container .sash {
          background: rgba(255, 255, 255, 0.06);
          transition: background 150ms ease;
        }
        .pipe-allotment .sash-container .sash:hover,
        .pipe-allotment .sash-container .sash.active {
          background: rgba(255, 255, 255, 0.14);
        }
      `}</style>

      <Allotment defaultSizes={[35, 65]}>
        {/* Left: Problem description */}
        {slots.left && (
          <Allotment.Pane minSize={250}>
            <div style={{
              height: '100%',
              overflow: 'auto',
              borderRight: '1px solid rgba(255,255,255,0.06)',
              background: '#0c0c0e',
            }}>
              {slots.left}
            </div>
          </Allotment.Pane>
        )}

        {/* Right: Code editor + Console */}
        <Allotment.Pane minSize={400}>
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0c0c0e' }}>
            {slots.bottom ? (
              <Allotment vertical defaultSizes={[70, 30]}>
                <Allotment.Pane minSize={200}>
                  <div style={{ height: '100%' }}>
                    {slots.center}
                  </div>
                </Allotment.Pane>
                <Allotment.Pane minSize={80}>
                  {slots.bottom}
                </Allotment.Pane>
              </Allotment>
            ) : (
              <div style={{ flex: 1 }}>
                {slots.center}
              </div>
            )}
          </div>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}
