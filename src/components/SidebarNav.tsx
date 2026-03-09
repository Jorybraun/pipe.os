import {
  Sparkles,
  Calendar,
  Box,
  LayoutDashboard,
} from "lucide-react";

interface SidebarNavProps {
  activeSection?: string;
  isAgentOpen?: boolean;
  onAgentToggle?: () => void;
  /** Called when the user clicks the Schedule nav item */
  onScheduleClick?: () => void;
  /** Called when the user clicks the Sandbox nav item */
  onSandboxClick?: () => void;
  /** Called when the user clicks the Roles nav item */
  onRolesClick?: () => void;
}

export function SidebarNav({
  activeSection = "roles",
  isAgentOpen = false,
  onAgentToggle,
  onScheduleClick,
  onSandboxClick,
  onRolesClick,
}: SidebarNavProps) {
  return (
    <nav
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "16px 0",
      }}
    >
      {/* Agent Toggle Button */}
      <button
        onClick={onAgentToggle}
        title="AI Agent"
        style={{
          width: 48,
          height: 48,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: isAgentOpen
            ? "linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.2))"
            : "transparent",
          border: isAgentOpen ? "1px solid rgba(139, 92, 246, 0.4)" : "none",
          borderRadius: "12px",
          color: isAgentOpen ? "#a78bfa" : "rgba(255,255,255,0.4)",
          cursor: "pointer",
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          position: "relative",
          backdropFilter: isAgentOpen ? "blur(20px)" : "none",
          boxShadow: isAgentOpen
            ? "0 4px 16px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(139, 92, 246, 0.2)"
            : "none",
        }}
        onMouseEnter={(e) => {
          if (!isAgentOpen) {
            e.currentTarget.style.background = "rgba(139, 92, 246, 0.1)";
            e.currentTarget.style.color = "rgba(167, 139, 250, 0.8)";
            e.currentTarget.style.transform = "translateX(4px)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isAgentOpen) {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "rgba(255,255,255,0.4)";
            e.currentTarget.style.transform = "translateX(0)";
          }
        }}
      >
        <Sparkles size={20} />
        {isAgentOpen && (
          <div
            style={{
              position: "absolute",
              left: -12,
              width: 3,
              height: 24,
              background:
                "linear-gradient(180deg, rgba(139, 92, 246, 0.8), rgba(167, 139, 250, 0.6))",
              borderRadius: "0 2px 2px 0",
              boxShadow: "0 0 12px rgba(139, 92, 246, 0.6)",
            }}
          />
        )}
        {/* Pulsing indicator */}
        {!isAgentOpen && (
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "rgba(139, 92, 246, 0.8)",
              boxShadow: "0 0 8px rgba(139, 92, 246, 0.6)",
              animation: "pulse 2s ease-in-out infinite",
            }}
          />
        )}
      </button>

      {/* Divider */}
      <div
        style={{
          height: 1,
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)",
          margin: "8px 0",
        }}
      />

      {/* Roles nav item */}
      <button
        onClick={onRolesClick}
        title="Roles"
        style={{
          width: 48,
          height: 48,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: activeSection === "roles"
            ? "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))"
            : "transparent",
          border: "none",
          borderRadius: "12px",
          color: activeSection === "roles" ? "#fff" : "rgba(255,255,255,0.4)",
          cursor: "pointer",
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          position: "relative",
          backdropFilter: activeSection === "roles" ? "blur(20px)" : "none",
          boxShadow: activeSection === "roles"
            ? "0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)"
            : "none",
        }}
        onMouseEnter={(e) => {
          if (activeSection !== "roles") {
            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            e.currentTarget.style.color = "rgba(255,255,255,0.7)";
            e.currentTarget.style.transform = "translateX(4px)";
          }
        }}
        onMouseLeave={(e) => {
          if (activeSection !== "roles") {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "rgba(255,255,255,0.4)";
            e.currentTarget.style.transform = "translateX(0)";
          }
        }}
      >
        <LayoutDashboard size={20} />
        {activeSection === "roles" && (
          <div
            style={{
              position: "absolute",
              left: -12,
              width: 3,
              height: 24,
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.8), rgba(200,200,220,0.6))",
              borderRadius: "0 2px 2px 0",
              boxShadow: "0 0 12px rgba(255,255,255,0.4)",
            }}
          />
        )}
      </button>

      {/* Schedule nav item */}
      {onScheduleClick && (
        <button
          onClick={onScheduleClick}
          title="Schedule"
          style={{
            width: 48,
            height: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: activeSection === "schedule"
              ? "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))"
              : "transparent",
            border: "none",
            borderRadius: "12px",
            color: activeSection === "schedule" ? "#fff" : "rgba(255,255,255,0.4)",
            cursor: "pointer",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            position: "relative",
            backdropFilter: activeSection === "schedule" ? "blur(20px)" : "none",
            boxShadow: activeSection === "schedule"
              ? "0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)"
              : "none",
          }}
          onMouseEnter={(e) => {
            if (activeSection !== "schedule") {
              e.currentTarget.style.background = "rgba(255,255,255,0.08)";
              e.currentTarget.style.color = "rgba(255,255,255,0.7)";
              e.currentTarget.style.transform = "translateX(4px)";
            }
          }}
          onMouseLeave={(e) => {
            if (activeSection !== "schedule") {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255,255,255,0.4)";
              e.currentTarget.style.transform = "translateX(0)";
            }
          }}
        >
          <Calendar size={20} />
          {activeSection === "schedule" && (
            <div
              style={{
                position: "absolute",
                left: -12,
                width: 3,
                height: 24,
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.8), rgba(200,200,220,0.6))",
                borderRadius: "0 2px 2px 0",
                boxShadow: "0 0 12px rgba(255,255,255,0.4)",
              }}
            />
          )}
        </button>
      )}

      {/* Sandbox nav item */}
      {onSandboxClick && (
        <button
          onClick={onSandboxClick}
          title="Dev Container Sandbox"
          style={{
            width: 48,
            height: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: activeSection === "sandbox"
              ? "linear-gradient(135deg, rgba(167,139,250,0.2), rgba(139,92,246,0.15))"
              : "transparent",
            border: activeSection === "sandbox" ? "1px solid rgba(167,139,250,0.4)" : "none",
            borderRadius: "12px",
            color: activeSection === "sandbox" ? "#a78bfa" : "rgba(255,255,255,0.4)",
            cursor: "pointer",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            position: "relative",
            backdropFilter: activeSection === "sandbox" ? "blur(20px)" : "none",
            boxShadow: activeSection === "sandbox"
              ? "0 4px 16px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(139, 92, 246, 0.2)"
              : "none",
          }}
          onMouseEnter={(e) => {
            if (activeSection !== "sandbox") {
              e.currentTarget.style.background = "rgba(167,139,250,0.1)";
              e.currentTarget.style.color = "rgba(167,139,250,0.8)";
              e.currentTarget.style.transform = "translateX(4px)";
            }
          }}
          onMouseLeave={(e) => {
            if (activeSection !== "sandbox") {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255,255,255,0.4)";
              e.currentTarget.style.transform = "translateX(0)";
            }
          }}
        >
          <Box size={20} />
          {activeSection === "sandbox" && (
            <div
              style={{
                position: "absolute",
                left: -12,
                width: 3,
                height: 24,
                background:
                  "linear-gradient(180deg, rgba(139, 92, 246, 0.8), rgba(167, 139, 250, 0.6))",
                borderRadius: "0 2px 2px 0",
                boxShadow: "0 0 12px rgba(139, 92, 246, 0.6)",
              }}
            />
          )}
        </button>
      )}

      {/* Quick indicator */}
      <div
        style={{
          width: 48,
          padding: "12px 0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
        }}
      >
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#10b981",
            boxShadow: "0 0 8px rgba(16, 185, 129, 0.6)",
          }}
        />
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "#10b981",
            letterSpacing: "0.05em",
          }}
        >
          88
        </div>
        <div
          style={{
            fontSize: 7,
            color: "rgba(255,255,255,0.4)",
            letterSpacing: "0.1em",
          }}
        >
          AVG
        </div>
      </div>
    </nav>
  );
}
