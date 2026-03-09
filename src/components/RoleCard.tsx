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
} from "lucide-react";
import { LiquidMetalCard } from "./ui/LiquidMetalCard";

export type RoleStatus = "active" | "draft" | "closed";

interface RoleCardProps {
  title: string;
  department: string;
  location: string;
  status: RoleStatus;
  candidates: number;
  avgScore?: number | null;
  stagesConfigured: number;
  totalStages: number;
  createdAt: string;
  onClick?: () => void;
  style?: React.CSSProperties;
  className?: string;
}

export function RoleCard({
  title,
  department,
  location,
  status,
  candidates,
  avgScore,
  stagesConfigured,
  totalStages,
  createdAt,
  onClick,
  style = {},
  className = "",
}: RoleCardProps) {
  const getStatusStyle = (status: RoleStatus) => {
    switch (status) {
      case "active":
        return {
          color: "#34d399",
          bg: "rgba(16, 185, 129, 0.1)",
          border: "rgba(16, 185, 129, 0.2)",
          label: "ACTIVE",
        };
      case "draft":
        return {
          color: "#fbbf24",
          bg: "rgba(245, 158, 11, 0.1)",
          border: "rgba(245, 158, 11, 0.2)",
          label: "DRAFT",
        };
      case "closed":
        return {
          color: "rgba(255,255,255,0.4)",
          bg: "rgba(255,255,255,0.05)",
          border: "rgba(255,255,255,0.1)",
          label: "CLOSED",
        };
    }
  };

  const statusStyle = getStatusStyle(status);
  const isComplete = stagesConfigured === totalStages;
  const progressPercent = (stagesConfigured / totalStages) * 100;

  const formattedDate = new Date(createdAt)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();

  return (
    <div style={{ marginBottom: 12, ...style }} className={className}>
      <LiquidMetalCard
        variant="default"
        onClick={onClick}
        style={{
          padding: 0,
          borderRadius: 8,
          cursor: onClick ? "pointer" : "default",
        }}
      >
        <div style={{ display: "flex", alignItems: "stretch" }}>
          {/* Status Indicator Bar */}
          <div
            style={{
              width: 4,
              background: statusStyle.color,
              opacity: status === "active" ? 0.8 : 0.3,
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
                  color: "#fff",
                  margin: 0,
                  letterSpacing: "0.01em",
                }}
              >
                {title}
              </h3>

              <div style={{ marginLeft: "auto", display: "flex", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Building size={12} color="rgba(255,255,255,0.2)" />
                  <span
                    style={{
                      fontSize: 10,
                      color: "rgba(255,255,255,0.4)",
                      fontFamily: "Space Mono",
                    }}
                  >
                    {department.toUpperCase()}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <MapPin size={12} color="rgba(255,255,255,0.2)" />
                  <span
                    style={{
                      fontSize: 10,
                      color: "rgba(255,255,255,0.4)",
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
                <Users size={14} color="rgba(255,255,255,0.2)" />
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: "#fff",
                      fontFamily: "Space Mono",
                    }}
                  >
                    {String(candidates).padStart(2, "0")}
                  </div>
                  <div
                    style={{
                      fontSize: 7,
                      color: "rgba(255,255,255,0.3)",
                      letterSpacing: "0.1em",
                    }}
                  >
                    CANDIDATES
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Trophy size={14} color="rgba(255,255,255,0.2)" />
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: avgScore ? "#fff" : "rgba(255,255,255,0.2)",
                      fontFamily: "Space Mono",
                    }}
                  >
                    {avgScore ? String(avgScore).padStart(2, "0") : "—"}
                  </div>
                  <div
                    style={{
                      fontSize: 7,
                      color: "rgba(255,255,255,0.3)",
                      letterSpacing: "0.1em",
                    }}
                  >
                    AVG SCORE
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Target size={14} color="rgba(255,255,255,0.2)" />
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: isComplete ? "#34d399" : "#fff",
                      fontFamily: "Space Mono",
                    }}
                  >
                    {stagesConfigured}/{totalStages}
                  </div>
                  <div
                    style={{
                      fontSize: 7,
                      color: "rgba(255,255,255,0.3)",
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
                  <Calendar size={12} color="rgba(255,255,255,0.2)" />
                  <span
                    style={{
                      fontSize: 9,
                      color: "rgba(255,255,255,0.3)",
                      fontFamily: "Space Mono",
                    }}
                  >
                    {formattedDate}
                  </span>
                </div>
                <ChevronRight size={16} color="rgba(255,255,255,0.2)" />
              </div>
            </div>
          </div>

          {/* Action Area */}
          <div
            style={{
              width: 48,
              borderLeft: "1px solid rgba(255,255,255,0.05)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <button
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(255,255,255,0.2)",
                cursor: "pointer",
                padding: 8,
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <MoreHorizontal size={16} />
            </button>
          </div>
        </div>

        {/* Mini progress bar at the very bottom */}
        <div style={{ height: 1, background: "rgba(255,255,255,0.03)" }}>
          <div
            style={{
              width: `${progressPercent}%`,
              height: "100%",
              background: isComplete ? "#34d399" : "rgba(255,255,255,0.2)",
              transition: "width 0.6s ease-out",
            }}
          />
        </div>
      </LiquidMetalCard>
    </div>
  );
}
