import { ReactNode } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { useSidebarPortal } from "../contexts/SidebarPortalContext";

interface ProfileLayoutProps {
  header: ReactNode;
  children: ReactNode;
  sidebar?: ReactNode;
  showSidebar?: boolean;
  agentPanel?: ReactNode;
  isAgentOpen?: boolean;
}

export function Layout({
  header,
  children,
  sidebar,
  showSidebar = true,
  agentPanel,
  isAgentOpen = false,
}: ProfileLayoutProps) {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const overlayAlpha = theme.background.overlay;
  const { setPortalNode, isPortalOpen } = useSidebarPortal();

  // The aside is open if either the agentPanel has content OR a portal is active
  const asideOpen = isAgentOpen || isPortalOpen;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: isDark ? `rgba(12, 12, 14, ${overlayAlpha})` : `rgba(245, 245, 247, ${overlayAlpha})`,
        fontFamily: '"Space Mono", monospace',
        color: "var(--pipe-text, #fff)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Header — fixed to top */}
      <div style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 20,
        background: isDark ? `rgba(12, 12, 14, ${overlayAlpha})` : `rgba(245, 245, 247, ${overlayAlpha})`,
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--pipe-border-light, rgba(255,255,255,0.04))",
      }}>
        {header}
      </div>
      {/* Layout with sidebar and agent panel */}
      <div
        style={{
          display: "flex",
          position: "relative",
          zIndex: 1,
          paddingTop: 100,
        }}
      >
        {/* Sidebar */}
        {showSidebar && (
          <aside
            style={{
              width: "80px",
              position: "fixed",
              left: 0,
              top: 100,
              height: "calc(100vh - 120px)",
              padding: "0 16px",
              zIndex: 10,
              flexShrink: 0,
            }}
          >
            {sidebar}
          </aside>
        )}

        {/* Agent Panel / Portal Target */}
        {asideOpen && (
          <aside
            style={{
              width: "400px",
              position: "fixed",
              left: "80px",
              top: 100,
              height: "calc(100vh - 120px)",
              background: isDark ? `rgba(12, 12, 14, ${overlayAlpha})` : `rgba(245, 245, 247, ${overlayAlpha})`,
              backdropFilter: "blur(12px)",
              borderRight: "1px solid var(--pipe-border, rgba(255,255,255,0.06))",
              boxShadow: `4px 0 24px var(--pipe-shadow, rgba(0,0,0,0.3))`,
              zIndex: 9,
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            {agentPanel}
            <div ref={setPortalNode} style={{ height: agentPanel ? 0 : '100%' }} />
          </aside>
        )}

        {/* Main content */}
        <main
          style={{
            flex: 1,
            minWidth: 0,
            maxWidth: 1400,
            margin: "0 auto",
            marginLeft: showSidebar ? (asideOpen ? "480px" : "80px") : "auto",
            padding: "24px 20px",
            position: "relative",
            transition: "margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          {children}
        </main>
      </div>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');

        * {
          box-sizing: border-box;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.95); }
        }

        button:hover {
          filter: brightness(1.1);
        }

      `}</style>
    </div>
  );
}
