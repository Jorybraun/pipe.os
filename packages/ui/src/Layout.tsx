import { ReactNode } from "react";

interface LayoutProps {
  header?: ReactNode;
  children: ReactNode;
  sidebar?: ReactNode;
  showSidebar?: boolean;
  rightPanel?: ReactNode;
  rightPanelOpen?: boolean;
  rightPanelWidth?: number;
}

export function Layout({
  header,
  children,
  sidebar,
  showSidebar = true,
  rightPanel,
  rightPanelOpen = false,
  rightPanelWidth = 400,
}: LayoutProps) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: 'var(--pipe-bg, #0c0c0e)',
        fontFamily: '"Space Mono", monospace',
        color: "var(--pipe-text, #fff)",
        position: "relative",
        overflow: "clip",
      }}
    >
      {/* Header — fixed to top */}
      {header && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          background: 'var(--pipe-bg, #0c0c0e)',
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid var(--pipe-border-light, rgba(255,255,255,0.04))",
        }}>
          {header}
        </div>
      )}
      
      {/* Layout with sidebar */}
      <div
        style={{
          display: "flex",
          position: "relative",
          zIndex: 1,
          paddingTop: header ? 100 : 0,
          transition: "margin-right 0.3s ease",
          marginRight: rightPanelOpen ? rightPanelWidth : 0,
        }}
      >
        {/* Sidebar */}
        {showSidebar && (
          <aside
            style={{
              width: "80px",
              position: "fixed",
              left: 0,
              top: header ? 100 : 0,
              height: header ? "calc(100vh - 120px)" : "100vh",
              padding: "0 16px",
              zIndex: 10,
              flexShrink: 0,
            }}
          >
            {sidebar}
          </aside>
        )}

        {/* Main content */}
        <main
          style={{
            flex: 1,
            minWidth: 0,
            maxWidth: 1400,
            margin: "0 auto",
            marginLeft: showSidebar ? "80px" : "auto",
            padding: "24px 20px",
            position: "relative",
          }}
        >
          {children}
        </main>
      </div>

      {/* Right panel */}
      {rightPanel && (
        <div
          style={{
            position: "fixed",
            right: rightPanelOpen ? 0 : -rightPanelWidth,
            top: header ? 100 : 0,
            width: rightPanelWidth,
            height: header ? "calc(100vh - 120px)" : "100vh",
            background: 'rgba(12, 12, 14, 0.98)',
            borderLeft: "1px solid rgba(255,255,255,0.1)",
            zIndex: 15,
            transition: "right 0.3s ease",
            backdropFilter: "blur(20px)",
          }}
        >
          {rightPanel}
        </div>
      )}
    </div>
  );
}
