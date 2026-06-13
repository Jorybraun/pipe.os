import { Users, Calendar, Settings } from "lucide-react";

interface SidebarNavProps {
  activeSection?: string;
  onContactsClick?: () => void;
  onMeetingsClick?: () => void;
  onSettingsClick?: () => void;
}

export function SidebarNav({
  activeSection = "contacts",
  onContactsClick,
  onMeetingsClick,
  onSettingsClick,
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
      {/* Contacts nav item */}
      {onContactsClick && (
        <button
          onClick={onContactsClick}
          title="Contacts"
          style={{
            width: 48,
            height: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: activeSection === "contacts"
              ? "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))"
              : "transparent",
            border: "none",
            borderRadius: "12px",
            color: activeSection === "contacts" ? "#fff" : "rgba(255,255,255,0.45)",
            cursor: "pointer",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            position: "relative",
            backdropFilter: activeSection === "contacts" ? "blur(20px)" : "none",
            boxShadow: activeSection === "contacts"
              ? "0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)"
              : "none",
          }}
          onMouseEnter={(e) => {
            if (activeSection !== "contacts") {
              e.currentTarget.style.background = "rgba(255,255,255,0.08)";
              e.currentTarget.style.color = "rgba(255,255,255,0.65)";
              e.currentTarget.style.transform = "translateX(4px)";
            }
          }}
          onMouseLeave={(e) => {
            if (activeSection !== "contacts") {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255,255,255,0.45)";
              e.currentTarget.style.transform = "translateX(0)";
            }
          }}
        >
          <Users size={20} />
          {activeSection === "contacts" && (
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

      {/* Meetings nav item */}
      {onMeetingsClick && (
        <button
          onClick={onMeetingsClick}
          title="Meetings"
          style={{
            width: 48,
            height: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: activeSection === "meetings"
              ? "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))"
              : "transparent",
            border: "none",
            borderRadius: "12px",
            color: activeSection === "meetings" ? "#fff" : "rgba(255,255,255,0.45)",
            cursor: "pointer",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            position: "relative",
            backdropFilter: activeSection === "meetings" ? "blur(20px)" : "none",
            boxShadow: activeSection === "meetings"
              ? "0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)"
              : "none",
          }}
          onMouseEnter={(e) => {
            if (activeSection !== "meetings") {
              e.currentTarget.style.background = "rgba(255,255,255,0.08)";
              e.currentTarget.style.color = "rgba(255,255,255,0.65)";
              e.currentTarget.style.transform = "translateX(4px)";
            }
          }}
          onMouseLeave={(e) => {
            if (activeSection !== "meetings") {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255,255,255,0.45)";
              e.currentTarget.style.transform = "translateX(0)";
            }
          }}
        >
          <Calendar size={20} />
          {activeSection === "meetings" && (
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

      {/* Settings nav item */}
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
            color: activeSection === "settings" ? "#fff" : "rgba(255,255,255,0.45)",
            cursor: "pointer",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            position: "relative",
            backdropFilter: activeSection === "settings" ? "blur(20px)" : "none",
            boxShadow: activeSection === "settings"
              ? "0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)"
              : "none",
          }}
          onMouseEnter={(e) => {
            if (activeSection !== "settings") {
              e.currentTarget.style.background = "rgba(255,255,255,0.08)";
              e.currentTarget.style.color = "rgba(255,255,255,0.65)";
              e.currentTarget.style.transform = "translateX(4px)";
            }
          }}
          onMouseLeave={(e) => {
            if (activeSection !== "settings") {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255,255,255,0.45)";
              e.currentTarget.style.transform = "translateX(0)";
            }
          }}
        >
          <Settings size={20} />
          {activeSection === "settings" && (
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
    </nav>
  );
}
