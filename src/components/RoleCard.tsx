import { useState, useRef, useEffect } from "react";
import {
  Calendar,
  ChevronRight,
  MoreHorizontal,
  Activity,
  Users,
  Trash2,
  ClipboardList,
} from "lucide-react";
import { LiquidMetalCard } from "./ui/LiquidMetalCard";

export type RoleStatus = "active" | "draft" | "closed";

interface RoleCardProps {
  id: string;
  title: string;
  interviewSummary: string;
  contextSummary: string;
  status: RoleStatus;
  candidates: number;
  createdAt: string;
  onClick?: () => void;
  onDelete?: () => void;
  style?: React.CSSProperties;
  className?: string;
}

export function RoleCard({
  id,
  title,
  interviewSummary,
  contextSummary,
  status,
  candidates,
  createdAt,
  onClick,
  onDelete,
  style = {},
  className = "",
}: RoleCardProps) {
  const getStatusStyle = (status: RoleStatus) => {
    switch (status) {
      case "active":
        return {
          color: "#10b981",
          bg: "rgba(16, 185, 129, 0.12)",
          border: "rgba(16, 185, 129, 0.28)",
          label: "ACTIVE",
        };
      case "draft":
        return {
          color: "#d97706",
          bg: "rgba(245, 158, 11, 0.12)",
          border: "rgba(245, 158, 11, 0.28)",
          label: "DRAFT",
        };
      case "closed":
        return {
          color: "var(--pipe-text-dim)",
          bg: "var(--pipe-surface)",
          border: "var(--pipe-border)",
          label: "CLOSED",
        };
    }
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const statusStyle = getStatusStyle(status);

  const formattedDate = new Date(createdAt)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();

  return (
    <div
      style={{ marginBottom: 12, ...style }}
      className={className}
      data-testid={`pipeline-card-${id}`}
    >
      <LiquidMetalCard
        variant="solid"
        {...(onClick ? { onClick } : {})}
        style={{
          padding: 0,
          borderRadius: 8,
          cursor: onClick ? "pointer" : "default",
          border: "1px solid var(--pipe-border-light)",
        }}
      >
        <div style={{ display: "flex", alignItems: "stretch" }}>
          {/* Status Indicator Bar */}
          <div
            style={{
              width: 3,
              background: statusStyle.color,
              opacity: 0.6,
            }}
          />

          {/* Main Content */}
          <div style={{ flex: 1, padding: "16px 20px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: 8,
                  fontWeight: 800,
                  letterSpacing: "0.15em",
                  padding: "4px 8px",
                  background: statusStyle.bg,
                  border: `1px solid ${statusStyle.border}`,
                  color: statusStyle.color,
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {status === "active" && (
                  <Activity
                    size={10}
                    style={{ animation: "pulse 1.5s ease-in-out infinite" }}
                  />
                )}
                {statusStyle.label}
              </div>
              <h3
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--pipe-text)",
                  margin: 0,
                  letterSpacing: "0.01em",
                }}
              >
                {title}
              </h3>

              <div style={{ marginLeft: "auto", display: "flex", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <ClipboardList size={12} color="var(--pipe-text-dim)" />
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--pipe-text-dim)",
                      fontFamily: "Space Mono",
                    }}
                  >
                    {interviewSummary.toUpperCase()}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Activity size={12} color="var(--pipe-text-dim)" />
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--pipe-text-dim)",
                      fontFamily: "Space Mono",
                    }}
                  >
                    {contextSummary.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Stats Row */}
            <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Users size={14} color="var(--pipe-text-dim)" />
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: "var(--pipe-text)",
                      fontFamily: "Space Mono",
                    }}
                  >
                    {String(candidates).padStart(2, "0")}
                  </div>
                  <div
                    style={{
                      fontSize: 7,
                      color: "var(--pipe-text-dim)",
                      letterSpacing: "0.1em",
                    }}
                  >
                    PEOPLE
                  </div>
                </div>
              </div>

              <div
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Calendar size={12} color="var(--pipe-text-dim)" />
                  <span
                    style={{
                      fontSize: 9,
                      color: "var(--pipe-text-dim)",
                      fontFamily: "Space Mono",
                    }}
                  >
                    {formattedDate}
                  </span>
                </div>
                <ChevronRight size={16} color="var(--pipe-text-dim)" />
              </div>
            </div>
          </div>

          {/* Action Area */}
          <div
            ref={menuRef}
            style={{
              width: 48,
              borderLeft: "1px solid var(--pipe-border-light)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
            }}
          >
            <button
              aria-label="Role context actions"
              data-testid={`pipeline-card-${id}-actions`}
              style={{
                background: menuOpen ? "var(--pipe-surface-hover)" : "transparent",
                border: "none",
                color: menuOpen ? "var(--pipe-text)" : "var(--pipe-text-dim)",
                cursor: "pointer",
                padding: 8,
                borderRadius: 4,
                transition: "all 0.15s ease",
              }}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(!menuOpen);
              }}
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  zIndex: 50,
                  minWidth: 160,
                  background: "var(--pipe-surface-solid)",
                  border: "1px solid var(--pipe-border)",
                  borderRadius: 8,
                  boxShadow: "0 8px 32px var(--pipe-shadow)",
                  overflow: "hidden",
                  marginTop: 4,
                }}
              >
                {onDelete && (
                  <button
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onDelete();
                    }}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      background: "transparent",
                      border: "none",
                      color: "#f87171",
                      fontSize: 11,
                      fontFamily: "Space Mono",
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      transition: "background 0.15s ease",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(248,113,113,0.1)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <Trash2 size={14} />
                    DELETE
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </LiquidMetalCard>
    </div>
  );
}
