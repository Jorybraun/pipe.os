import { useState, useRef, useEffect } from "react";
import {
  Building,
  MapPin,
  Calendar,
  ChevronRight,
  MoreHorizontal,
  Activity,
  Users,
  Target,
  Trophy,
  Check,
  Trash2,
} from "lucide-react";
import { LiquidMetalCard } from "./ui/LiquidMetalCard";

export type RoleStatus = "active" | "draft" | "closed";

interface RoleCardProps {
  id: string;
  title: string;
  department: string;
  location: string;
  status: RoleStatus;
  candidates: number;
  avgScore?: number | null;
  stagesConfigured: number;
  totalStages: number;
  createdAt: string;
  isSelected?: boolean;
  onSelect?: (selected: boolean) => void;
  onClick?: () => void;
  onDelete?: () => void;
  style?: React.CSSProperties;
  className?: string;
}

export function RoleCard({
  id,
  title,
  department,
  location,
  status,
  candidates,
  avgScore,
  stagesConfigured,
  totalStages,
  createdAt,
  isSelected = false,
  onSelect,
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
  const isComplete = stagesConfigured === totalStages;

  const formattedDate = new Date(createdAt)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();

  return (
    <div style={{ marginBottom: 12, ...style }} className={className}>
      <LiquidMetalCard
        variant="chrome"
        {...(onClick ? { onClick } : {})}
        style={{
          padding: 0,
          borderRadius: 8,
          cursor: onClick ? "pointer" : "default",
          border: "1px solid var(--pipe-border-light)",
        }}
      >
        <div style={{ display: "flex", alignItems: "stretch" }}>
          {/* Multi-select Checkbox */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(!isSelected);
            }}
            style={{
              width: 48,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: isSelected ? "rgba(139, 92, 246, 0.1)" : "transparent",
              borderRight: "1px solid var(--pipe-border-light)",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            <div style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              border: `2px solid ${isSelected ? "#8b5cf6" : "var(--pipe-border)"}`,
              background: isSelected ? "#8b5cf6" : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.15s ease",
            }}>
              {isSelected && <Check size={14} color="#fff" strokeWidth={3} />}
            </div>
          </div>

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
                  <Building size={12} color="var(--pipe-text-dim)" />
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--pipe-text-dim)",
                      fontFamily: "Space Mono",
                    }}
                  >
                    {department.toUpperCase()}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <MapPin size={12} color="var(--pipe-text-dim)" />
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--pipe-text-dim)",
                      fontFamily: "Space Mono",
                    }}
                  >
                    {location.toUpperCase()}
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
                    CANDIDATES
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Trophy size={14} color="var(--pipe-text-dim)" />
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: avgScore ? "var(--pipe-text, #fff)" : "var(--pipe-text-dim)",
                      fontFamily: "Space Mono",
                    }}
                  >
                    {avgScore ? String(avgScore).padStart(2, "0") : "—"}
                  </div>
                  <div
                    style={{
                      fontSize: 7,
                      color: "var(--pipe-text-dim)",
                      letterSpacing: "0.1em",
                    }}
                  >
                    AVG SCORE
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Target size={14} color="var(--pipe-text-dim)" />
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: isComplete ? "#10b981" : "var(--pipe-text)",
                      fontFamily: "Space Mono",
                    }}
                  >
                    {stagesConfigured}/{totalStages}
                  </div>
                  <div
                    style={{
                      fontSize: 7,
                      color: "var(--pipe-text-dim)",
                      letterSpacing: "0.1em",
                    }}
                  >
                    STAGES
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
              aria-label="Pipeline actions"
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
                  background: "var(--pipe-bg)",
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
