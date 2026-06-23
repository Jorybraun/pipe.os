import type { ReactNode } from "react";
import {
  Activity,
  Bot,
  Box,
  Briefcase,
  Calendar,
  Database,
  Mail,
  Phone,
  Settings,
  Users,
} from "lucide-react";

interface SidebarNavProps {
  activeSection?: string;
  onInterviewsClick?: () => void;
  onRolesClick?: () => void;
  onPeopleClick?: () => void;
  onSettingsClick?: () => void;
  onCallsClick?: () => void;
  onAgentClick?: () => void;
  onOutreachClick?: () => void;
  onRepoAdminClick?: () => void;
  onAiUsageClick?: () => void;
  onSandboxClick?: () => void;
}

interface NavButtonProps {
  activeSection: string;
  section: string;
  title: string;
  icon: ReactNode;
  onClick?: (() => void) | undefined;
  accent?: boolean;
}

function NavButton({
  activeSection,
  section,
  title,
  icon,
  onClick,
  accent = false,
}: NavButtonProps): JSX.Element | null {
  if (!onClick) return null;

  const active = activeSection === section;
  const activeBackground = accent
    ? "linear-gradient(135deg, var(--pipe-accent-surface), var(--pipe-accent-surface))"
    : "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))";
  const activeColor = accent ? "var(--pipe-accent)" : "var(--pipe-text, #fff)";
  const activeBorder = accent ? "1px solid var(--pipe-accent-border)" : "none";

  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 48,
        height: 48,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: active ? activeBackground : "transparent",
        border: activeBorder,
        borderRadius: 12,
        color: active ? activeColor : "var(--pipe-text-dim)",
        cursor: "pointer",
        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        position: "relative",
        backdropFilter: active ? "blur(20px)" : "none",
        boxShadow: active
          ? "0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)"
          : "none",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = accent
            ? "var(--pipe-accent-surface)"
            : "var(--pipe-surface-hover)";
          e.currentTarget.style.color = accent
            ? "var(--pipe-accent)"
            : "var(--pipe-text-muted)";
          e.currentTarget.style.transform = "translateX(4px)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--pipe-text-dim)";
          e.currentTarget.style.transform = "translateX(0)";
        }
      }}
    >
      {icon}
      {active && (
        <div
          style={{
            position: "absolute",
            left: -12,
            width: 3,
            height: 24,
            background: accent
              ? "linear-gradient(180deg, rgba(255,255,255,0.45), rgba(255,255,255,0.25))"
              : "linear-gradient(180deg, rgba(255,255,255,0.8), rgba(200,200,220,0.6))",
            borderRadius: "0 2px 2px 0",
            boxShadow: accent
              ? "0 0 12px rgba(255,255,255,0.2)"
              : "0 0 12px rgba(255,255,255,0.4)",
          }}
        />
      )}
    </button>
  );
}

export function SidebarNav({
  activeSection = "interviews",
  onInterviewsClick,
  onRolesClick,
  onPeopleClick,
  onSettingsClick,
  onCallsClick,
  onAgentClick,
  onOutreachClick,
  onRepoAdminClick,
  onAiUsageClick,
  onSandboxClick,
}: SidebarNavProps): JSX.Element {
  return (
    <nav
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "16px 0",
      }}
    >
      <NavButton
        activeSection={activeSection}
        section="interviews"
        title="Interviews"
        icon={<Calendar size={20} />}
        onClick={onInterviewsClick}
      />
      <NavButton
        activeSection={activeSection}
        section="roles"
        title="Interview plans"
        icon={<Briefcase size={20} />}
        onClick={onRolesClick}
      />
      <NavButton
        activeSection={activeSection}
        section="people"
        title="People"
        icon={<Users size={20} />}
        onClick={onPeopleClick}
      />

      <div style={{ height: 12 }} />

      <NavButton
        activeSection={activeSection}
        section="calls"
        title="Calls"
        icon={<Phone size={20} />}
        onClick={onCallsClick}
      />
      <NavButton
        activeSection={activeSection}
        section="outreach"
        title="Outreach"
        icon={<Mail size={20} />}
        onClick={onOutreachClick}
      />
      <NavButton
        activeSection={activeSection}
        section="repo-admin"
        title="Repo Catalog"
        icon={<Database size={20} />}
        onClick={onRepoAdminClick}
      />
      <NavButton
        activeSection={activeSection}
        section="ai-usage"
        title="AI Usage"
        icon={<Activity size={20} />}
        onClick={onAiUsageClick}
      />
      <NavButton
        activeSection={activeSection}
        section="sandbox"
        title="Dev Container Sandbox"
        icon={<Box size={20} />}
        onClick={onSandboxClick}
        accent
      />
      <NavButton
        activeSection={activeSection}
        section="agent"
        title="Copilot"
        icon={<Bot size={20} />}
        onClick={onAgentClick}
        accent
      />
      <NavButton
        activeSection={activeSection}
        section="settings"
        title="Settings"
        icon={<Settings size={20} />}
        onClick={onSettingsClick}
      />
    </nav>
  );
}
