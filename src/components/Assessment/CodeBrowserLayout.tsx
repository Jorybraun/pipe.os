// ---------------------------------------------------------------------------
// CodeBrowserLayout — candidate-facing layout for frontend CODE_IMPLEMENTATION
//
// 3-column resizable: Problem (left) | Code + Console (center) | Preview (right)
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';

interface CodeBrowserLayoutProps {
  slots: {
    left?: ReactNode;
    center: ReactNode;
    right?: ReactNode;
    bottom?: ReactNode;
  };
}

export function CodeBrowserLayout({ slots }: CodeBrowserLayoutProps): JSX.Element {
  return (
    <div
      data-testid="code-browser-layout"
      style={{
        height: 'calc(100vh - 160px)',
        width: '100%',
        overflow: 'hidden',
      }}
      className="pipe-allotment"
    >
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

      <Allotment defaultSizes={[25, 40, 35]}>
        {/* Left: Problem description */}
        {slots.left && (
          <Allotment.Pane minSize={200}>
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

        {/* Center: Code editor + Console */}
        <Allotment.Pane minSize={300}>
          <div style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: '#0c0c0e',
            borderRight: '1px solid rgba(255,255,255,0.06)',
          }}>
            {slots.bottom ? (
              <Allotment vertical defaultSizes={[70, 30]}>
                <Allotment.Pane minSize={200}>
                  <div style={{ height: '100%' }}>
                    {slots.center}
                  </div>
                </Allotment.Pane>
                <Allotment.Pane minSize={60}>
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

        {/* Right: Live preview */}
        {slots.right && (
          <Allotment.Pane minSize={250}>
            <div style={{
              height: '100%',
              overflow: 'hidden',
              background: '#0c0c0e',
            }}>
              {slots.right}
            </div>
          </Allotment.Pane>
        )}
      </Allotment>
    </div>
  );
}
