import React, { useState, useEffect } from "react";
import {
  Building,
  MapPin,
  Calendar,
  ChevronRight,
  MoreHorizontal,
  Activity,
} from "lucide-react";
import { LiquidMetalCard } from "./LiquidMetalCard";

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
  animationDelay?: number;
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
  animationDelay = 0,
  style = {},
  className = "",
}: RoleCardProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), animationDelay);
    return () => clearTimeout(timer);
  }, [animationDelay]);

  const getStatusStyle = (status: RoleStatus) => {
    switch (status) {
      case "active":
        return {
          color: "rgba(150,255,150,0.8)",
          bg: "rgba(150,255,150,0.1)",
          label: "ACTIVE",
        };
      case "draft":
        return {
          color: "rgba(255,200,100,0.8)",
          bg: "rgba(255,200,100,0.1)",
          label: "DRAFT",
        };
      case "closed":
        return {
          color: "rgba(255,255,255,0.4)",
          bg: "rgba(255,255,255,0.05)",
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
    <div
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0)" : "translateY(20px)",
        transition: "all 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <LiquidMetalCard
        variant={status === "active" ? "chrome" : "default"}
        hover
        onClick={onClick}
        style={{
          cursor: onClick ? "pointer" : "default",
          ...style,
        }}
        className={className}
      >
        {/* Header */}
        <div
          style={{
            padding: "24px 24px 20px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              marginBottom: 16,
            }}
          >
            {/* Status badge */}
            <div
              style={{
                fontSize: 8,
                letterSpacing: "0.2em",
                padding: "4px 10px",
                background: statusStyle.bg,
                color: statusStyle.color,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {status === "active" && (
                <Activity
                  size={8}
                  style={{ animation: "pulse 1.5s ease-in-out infinite" }}
                />
              )}
              {statusStyle.label}
            </div>

            {/* More options */}
            <button
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(255,255,255,0.3)",
                cursor: "pointer",
                padding: 4,
              }}
              onClick={(e) => {
                e.stopPropagation();
                // Handle menu open
              }}
            >
              <MoreHorizontal size={16} />
            </button>
          </div>

          {/* Title */}
          <h3
            style={{
              fontSize: 18,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              margin: "0 0 12px",
              background:
                "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.8) 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {title}
          </h3>

          {/* Meta info */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Building size={10} color="rgba(255,255,255,0.25)" />
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: "0.1em",
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                {department}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <MapPin size={10} color="rgba(255,255,255,0.25)" />
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: "0.1em",
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                {location}
              </span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {/* Candidates */}
          <div
            style={{
              padding: 20,
              borderRight: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div
              style={{
                fontSize: 8,
                letterSpacing: "0.2em",
                color: "rgba(255,255,255,0.3)",
                marginBottom: 8,
              }}
            >
              CANDIDATES
            </div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: "-0.02em",
                background:
                  "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {candidates}
            </div>
          </div>

          {/* Avg Score */}
          <div
            style={{
              padding: 20,
              borderRight: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div
              style={{
                fontSize: 8,
                letterSpacing: "0.2em",
                color: "rgba(255,255,255,0.3)",
                marginBottom: 8,
              }}
            >
              AVG SCORE
            </div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: "-0.02em",
                background: avgScore
                  ? "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)"
                  : "linear-gradient(180deg, rgba(255,255,255,0.3) 0%, rgba(200,210,230,0.15) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {avgScore ?? "—"}
            </div>
          </div>

          {/* Stages */}
          <div style={{ padding: 20 }}>
            <div
              style={{
                fontSize: 8,
                letterSpacing: "0.2em",
                color: "rgba(255,255,255,0.3)",
                marginBottom: 8,
              }}
            >
              STAGES
            </div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: "-0.02em",
                background: isComplete
                  ? "linear-gradient(180deg, rgba(150,255,150,0.9) 0%, rgba(150,255,150,0.6) 100%)"
                  : "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {stagesConfigured}/{totalStages}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Calendar size={10} color="rgba(255,255,255,0.25)" />
            <span
              style={{
                fontSize: 9,
                letterSpacing: "0.1em",
                color: "rgba(255,255,255,0.4)",
              }}
            >
              CREATED {formattedDate}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "rgba(255,255,255,0.5)",
            }}
          >
            <span style={{ fontSize: 9, letterSpacing: "0.1em" }}>
              VIEW PIPELINE
            </span>
            <ChevronRight size={12} />
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 2, background: "rgba(255,255,255,0.06)" }}>
          <div
            style={{
              width: `${progressPercent}%`,
              height: "100%",
              background: isComplete
                ? "linear-gradient(90deg, rgba(150,255,150,0.4), rgba(150,255,150,0.8))"
                : "linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.7))",
              boxShadow: isComplete
                ? "0 0 10px rgba(150,255,150,0.3)"
                : "0 0 10px rgba(255,255,255,0.2)",
            }}
          />
        </div>
      </LiquidMetalCard>
    </div>
  );
}
