import { ReactNode } from "react";
import { LiquidMetal } from "@paper-design/shaders-react";

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
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0c0c0e",
        fontFamily: '"Space Mono", monospace',
        color: "#fff",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Animated liquid metal background */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: 0.4,
        }}
      >
        <LiquidMetal
          width={1920}
          height={1080}
          image="/mario-pipe.svg"
          colorBack="#aaaaac"
          colorTint="#ffffff"
          shape="diamond"
          repetition={2}
          softness={0.1}
          shiftRed={0.3}
          shiftBlue={0.3}
          distortion={0.07}
          contour={0.4}
          angle={70}
          speed={0.3}
          scale={0.6}
          fit="cover"
        />
      </div>

      {/* Chrome mesh grid */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: `
          linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)
        `,
          backgroundSize: "80px 80px",
          pointerEvents: "none",
        }}
      />

      {/* Floating chrome orbs */}
      {/* <FloatingOrbs /> */}

      {/* Header */}
      <div style={{ position: "relative", zIndex: 1 }}>
        {header}
      </div>

      {/* Layout with sidebar and agent panel */}
      <div
        style={{
          display: "flex",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Sidebar */}
        {showSidebar && (
          <aside
            style={{
              width: "80px",
              position: "fixed",
              left: 0,
              top: "100px",
              height: "calc(100vh - 100px)",
              padding: "0 16px",
              zIndex: 10,
              flexShrink: 0,
            }}
          >
            {sidebar}
          </aside>
        )}

        {/* Agent Panel */}
        {isAgentOpen && (
          <aside
            style={{
              width: "400px",
              position: "fixed",
              left: "80px",
              top: "100px",
              height: "calc(100vh - 100px)",
              background:
                "linear-gradient(135deg, rgba(20,20,30,0.95), rgba(15,15,25,0.98))",
              backdropFilter: "blur(40px) saturate(150%)",
              borderRight: "1px solid rgba(139, 92, 246, 0.2)",
              boxShadow: "4px 0 24px rgba(0,0,0,0.3)",
              zIndex: 9,
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            {agentPanel}
          </aside>
        )}

        {/* Main content */}
        <main
          style={{
            flex: 1,
            maxWidth: 1400,
            margin: "0 auto",
            marginLeft: showSidebar ? (isAgentOpen ? "480px" : "80px") : "auto",
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
