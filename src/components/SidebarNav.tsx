import {
  Calendar,
  Box,
  LayoutDashboard,
  Settings,
  Phone,
  Bot,
  Mail,
  Database,
  Activity,
} from "lucide-react";

interface SidebarNavProps {
  activeSection?: string;
  /** Called when the user clicks the Schedule nav item */
  onScheduleClick?: () => void;
  /** Called when the user clicks the Sandbox nav item */
  onSandboxClick?: () => void;
  /** Called when the user clicks the Roles nav item */
  onRolesClick?: () => void;
  /** Called when the user clicks the Settings nav item */
  onSettingsClick?: () => void;
  /** Called when the user clicks the Calls nav item */
  onCallsClick?: () => void;
  /** Called when the user clicks the Agent (copilot) nav item */
  onAgentClick?: () => void;
  /** Called when the user clicks the Outreach nav item */
  onOutreachClick?: () => void;
  /** Called when the user clicks the Repo Admin nav item */
  onRepoAdminClick?: () => void;
  /** Called when the user clicks the AI Usage nav item */
  onAiUsageClick?: () => void;
}

export function SidebarNav({
  activeSection = "roles",
  onScheduleClick,
  onSandboxClick,
  onSettingsClick,
  onCallsClick,
  onAgentClick,
  onRolesClick,
  onOutreachClick,
  onRepoAdminClick,
  onAiUsageClick,
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
          color: activeSection === "roles" ? "var(--pipe-text, #fff)" : "var(--pipe-text-dim)",
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
            e.currentTarget.style.background = "var(--pipe-surface-hover)";
            e.currentTarget.style.color = "var(--pipe-text-muted)";
            e.currentTarget.style.transform = "translateX(4px)";
          }
        }}
        onMouseLeave={(e) => {
          if (activeSection !== "roles") {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--pipe-text-dim)";
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
            color: activeSection === "schedule" ? "var(--pipe-text, #fff)" : "var(--pipe-text-dim)",
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
              e.currentTarget.style.background = "var(--pipe-surface-hover)";
              e.currentTarget.style.color = "var(--pipe-text-muted)";
              e.currentTarget.style.transform = "translateX(4px)";
            }
          }}
          onMouseLeave={(e) => {
            if (activeSection !== "schedule") {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--pipe-text-dim)";
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

      {/* Calls nav item */}
      {onCallsClick && (
        <button
          onClick={onCallsClick}
          title="Calls"
          style={{
            width: 48,
            height: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: activeSection === "calls"
              ? "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))"
              : "transparent",
            border: "none",
            borderRadius: "12px",
            color: activeSection === "calls" ? "var(--pipe-text, #fff)" : "var(--pipe-text-dim)",
            cursor: "pointer",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            position: "relative",
            backdropFilter: activeSection === "calls" ? "blur(20px)" : "none",
            boxShadow: activeSection === "calls"
              ? "0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)"
              : "none",
          }}
          onMouseEnter={(e) => {
            if (activeSection !== "calls") {
              e.currentTarget.style.background = "var(--pipe-surface-hover)";
              e.currentTarget.style.color = "var(--pipe-text-muted)";
              e.currentTarget.style.transform = "translateX(4px)";
            }
          }}
          onMouseLeave={(e) => {
            if (activeSection !== "calls") {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--pipe-text-dim)";
              e.currentTarget.style.transform = "translateX(0)";
            }
          }}
        >
          <Phone size={20} />
          {activeSection === "calls" && (
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

      {/* Outreach nav item */}
      {onOutreachClick && (
        <button
          onClick={onOutreachClick}
          title="Outreach"
          style={{
            width: 48,
            height: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: activeSection === "outreach"
              ? "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))"
              : "transparent",
            border: "none",
            borderRadius: "12px",
            color: activeSection === "outreach" ? "var(--pipe-text, #fff)" : "var(--pipe-text-dim)",
            cursor: "pointer",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            position: "relative",
            backdropFilter: activeSection === "outreach" ? "blur(20px)" : "none",
            boxShadow: activeSection === "outreach"
              ? "0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)"
              : "none",
          }}
          onMouseEnter={(e) => {
            if (activeSection !== "outreach") {
              e.currentTarget.style.background = "var(--pipe-surface-hover)";
              e.currentTarget.style.color = "var(--pipe-text-muted)";
              e.currentTarget.style.transform = "translateX(4px)";
            }
          }}
          onMouseLeave={(e) => {
            if (activeSection !== "outreach") {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--pipe-text-dim)";
              e.currentTarget.style.transform = "translateX(0)";
            }
          }}
        >
          <Mail size={20} />
          {activeSection === "outreach" && (
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

      {/* Repo admin nav item */}
      {onRepoAdminClick && (
        <button
          onClick={onRepoAdminClick}
          title="Repo Catalog"
          style={{
            width: 48,
            height: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: activeSection === "repo-admin"
              ? "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))"
              : "transparent",
            border: "none",
            borderRadius: "12px",
            color: activeSection === "repo-admin" ? "var(--pipe-text, #fff)" : "var(--pipe-text-dim)",
            cursor: "pointer",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            position: "relative",
            backdropFilter: activeSection === "repo-admin" ? "blur(20px)" : "none",
            boxShadow: activeSection === "repo-admin"
              ? "0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)"
              : "none",
          }}
          onMouseEnter={(e) => {
            if (activeSection !== "repo-admin") {
              e.currentTarget.style.background = "var(--pipe-surface-hover)";
              e.currentTarget.style.color = "var(--pipe-text-muted)";
              e.currentTarget.style.transform = "translateX(4px)";
            }
          }}
          onMouseLeave={(e) => {
            if (activeSection !== "repo-admin") {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--pipe-text-dim)";
              e.currentTarget.style.transform = "translateX(0)";
            }
          }}
        >
          <Database size={20} />
          {activeSection === "repo-admin" && (
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

      {/* AI Usage nav item */}
      {onAiUsageClick && (
        <button
          onClick={onAiUsageClick}
          title="AI Usage"
          style={{
            width: 48,
            height: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: activeSection === "ai-usage"
              ? "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))"
              : "transparent",
            border: "none",
            borderRadius: "12px",
            color: activeSection === "ai-usage" ? "var(--pipe-text, #fff)" : "var(--pipe-text-dim)",
            cursor: "pointer",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            position: "relative",
            backdropFilter: activeSection === "ai-usage" ? "blur(20px)" : "none",
            boxShadow: activeSection === "ai-usage"
              ? "0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)"
              : "none",
          }}
          onMouseEnter={(e) => {
            if (activeSection !== "ai-usage") {
              e.currentTarget.style.background = "var(--pipe-surface-hover)";
              e.currentTarget.style.color = "var(--pipe-text-muted)";
              e.currentTarget.style.transform = "translateX(4px)";
            }
          }}
          onMouseLeave={(e) => {
            if (activeSection !== "ai-usage") {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--pipe-text-dim)";
              e.currentTarget.style.transform = "translateX(0)";
            }
          }}
        >
          <Activity size={20} />
          {activeSection === "ai-usage" && (
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
              ? "linear-gradient(135deg, var(--pipe-accent-surface), var(--pipe-accent-surface))"
              : "transparent",
            border: activeSection === "sandbox" ? "1px solid var(--pipe-accent-border)" : "none",
            borderRadius: "12px",
            color: activeSection === "sandbox" ? "var(--pipe-accent)" : "var(--pipe-text-dim)",
            cursor: "pointer",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            position: "relative",
            backdropFilter: activeSection === "sandbox" ? "blur(20px)" : "none",
            boxShadow: activeSection === "sandbox"
              ? "0 4px 16px rgba(255, 255, 255, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.09)"
              : "none",
          }}
          onMouseEnter={(e) => {
            if (activeSection !== "sandbox") {
              e.currentTarget.style.background = "var(--pipe-accent-surface)";
              e.currentTarget.style.color = "var(--pipe-accent-surface)";
              e.currentTarget.style.transform = "translateX(4px)";
            }
          }}
          onMouseLeave={(e) => {
            if (activeSection !== "sandbox") {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--pipe-text-dim)";
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
                  "linear-gradient(180deg, rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0.25))",
                borderRadius: "0 2px 2px 0",
                boxShadow: "0 0 12px rgba(255, 255, 255, 0.20)",
              }}
            />
          )}
        </button>
      )}

      {/* Agent copilot */}
      {onAgentClick && (
        <button
          onClick={onAgentClick}
          title="Copilot"
          style={{
            width: 48,
            height: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: activeSection === "agent"
              ? "linear-gradient(135deg, var(--pipe-accent-surface), var(--pipe-accent-surface))"
              : "transparent",
            border: activeSection === "agent" ? "1px solid var(--pipe-accent-border)" : "none",
            borderRadius: "12px",
            color: activeSection === "agent" ? "var(--pipe-accent)" : "var(--pipe-text-dim)",
            cursor: "pointer",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            position: "relative",
            backdropFilter: activeSection === "agent" ? "blur(20px)" : "none",
            boxShadow: activeSection === "agent"
              ? "0 4px 16px rgba(255, 255, 255, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.09)"
              : "none",
          }}
          onMouseEnter={(e) => {
            if (activeSection !== "agent") {
              e.currentTarget.style.background = "var(--pipe-accent-surface)";
              e.currentTarget.style.color = "var(--pipe-accent-surface)";
              e.currentTarget.style.transform = "translateX(4px)";
            }
          }}
          onMouseLeave={(e) => {
            if (activeSection !== "agent") {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--pipe-text-dim)";
              e.currentTarget.style.transform = "translateX(0)";
            }
          }}
        >
          <Bot size={20} />
          {activeSection === "agent" && (
            <div
              style={{
                position: "absolute",
                left: -12,
                width: 3,
                height: 24,
                background:
                  "linear-gradient(180deg, rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0.25))",
                borderRadius: "0 2px 2px 0",
                boxShadow: "0 0 12px rgba(255, 255, 255, 0.20)",
              }}
            />
          )}
        </button>
      )}

      {/* Settings */}
      {onSettingsClick && (
        <button
          onClick={onSettingsClick}
          title="Settings"
          style={{
            width: 48,
            height: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: activeSection === "settings"
              ? "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))"
              : "transparent",
            border: "none",
            borderRadius: "12px",
            color: activeSection === "settings" ? "var(--pipe-text, #fff)" : "var(--pipe-text-dim)",
            cursor: "pointer",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            position: "relative",
          }}
          onMouseEnter={(e) => {
            if (activeSection !== "settings") {
              e.currentTarget.style.background = "var(--pipe-surface-hover)";
              e.currentTarget.style.color = "var(--pipe-text-muted)";
            }
          }}
          onMouseLeave={(e) => {
            if (activeSection !== "settings") {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--pipe-text-dim)";
            }
          }}
        >
          <Settings size={20} />
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
            color: "var(--pipe-text)",
            letterSpacing: "0.05em",
          }}
        >
          88
        </div>
        <div
          style={{
            fontSize: 7,
            color: "var(--pipe-text-dim)",
            letterSpacing: "0.1em",
          }}
        >
          AVG
        </div>
      </div>
    </nav>
  );
}
