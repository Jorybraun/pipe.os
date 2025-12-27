import React from "react";
import { LucideIcon, CheckCircle, Activity } from "lucide-react";
import { LiquidMetalCard } from "./LiquidMetalCard";

export type StageStatus = "completed" | "in_progress" | "pending";

interface StageCardProps {
  name: string;
  icon: LucideIcon;
  status: StageStatus;
  score?: number | null;
  onClick?: () => void;
  style?: React.CSSProperties;
  className?: string;
}

export function StageCard({
  name,
  icon: Icon,
  status,
  score,
  onClick,
  style = {},
  className = "",
}: StageCardProps) {
  const isComplete = status === "completed";
  const isActive = status === "in_progress";
  const isPending = status === "pending";

  return (
    <LiquidMetalCard
      variant={isActive ? "chrome" : "default"}
      hover
      onClick={onClick}
      style={{
        padding: 24,
        opacity: isPending ? 0.4 : 1,
        cursor: onClick ? "pointer" : "default",
        ...style,
      }}
      className={className}
    >
      {/* Top row: Icon + Status indicator */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <Icon size={16} color={isActive ? "#fff" : "rgba(255,255,255,0.4)"} />
        {isComplete && <CheckCircle size={12} color="rgba(150,255,150,0.8)" />}
        {isActive && (
          <Activity
            size={12}
            color="rgba(255,255,255,0.8)"
            style={{
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
        )}
      </div>

      {/* Stage name */}
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.2em",
          color: isActive ? "#fff" : "rgba(255,255,255,0.5)",
          marginBottom: 8,
        }}
      >
        {name}
      </div>

      {/* Score */}
      {isComplete && score !== null && score !== undefined && (
        <div
          style={{
            fontSize: 28,
            fontWeight: 800,
            background:
              "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {score}
        </div>
      )}
    </LiquidMetalCard>
  );
}

interface StageCardLargeProps extends StageCardProps {
  showProgressBar?: boolean;
  progressValue?: number;
}

/**
 * Large variant of StageCard used in pipeline builder and overview
 * Features larger score display and optional progress bar
 */
export function StageCardLarge({
  name,
  icon: Icon,
  status,
  score,
  onClick,
  showProgressBar = false,
  progressValue,
  style = {},
  className = "",
}: StageCardLargeProps) {
  const isComplete = status === "completed";
  const isActive = status === "in_progress";
  const isPending = status === "pending";

  return (
    <LiquidMetalCard
      variant={isActive ? "chrome" : "default"}
      hover
      onClick={onClick}
      style={{
        padding: 24,
        opacity: isPending ? 0.4 : 1,
        cursor: onClick ? "pointer" : "default",
        ...style,
      }}
      className={className}
    >
      {/* Top row: Icon + Status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <Icon size={20} color={isActive ? "#fff" : "rgba(255,255,255,0.4)"} />
        {isComplete && <CheckCircle size={16} color="rgba(150,255,150,0.8)" />}
        {isActive && !isComplete && (
          <Activity
            size={16}
            color="rgba(255,255,255,0.8)"
            style={{
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
        )}
      </div>

      {/* Stage name */}
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.2em",
          color: isActive ? "#fff" : "rgba(255,255,255,0.5)",
          marginBottom: 12,
        }}
      >
        {name}
      </div>

      {/* Score (large, matching profile scores) */}
      {score !== null && score !== undefined ? (
        <div
          style={{
            fontSize: 42,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1,
            background: isComplete
              ? "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)"
              : "linear-gradient(180deg, rgba(255,255,255,0.3) 0%, rgba(200,210,230,0.15) 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {score}
        </div>
      ) : (
        <div
          style={{
            fontSize: 42,
            fontWeight: 800,
            color: "rgba(255,255,255,0.15)",
          }}
        >
          —
        </div>
      )}

      {/* Progress bar */}
      {showProgressBar && (
        <div
          style={{
            marginTop: 16,
            height: 2,
            background: "rgba(255,255,255,0.06)",
          }}
        >
          {(progressValue !== undefined || isComplete) && (
            <div
              style={{
                width: `${progressValue ?? (isComplete ? 100 : 0)}%`,
                height: "100%",
                background: isComplete
                  ? "linear-gradient(90deg, rgba(150,255,150,0.4), rgba(150,255,150,0.8))"
                  : "linear-gradient(90deg, rgba(255,255,255,0.3), rgba(255,255,255,0.7))",
                boxShadow: isComplete
                  ? "0 0 10px rgba(150,255,150,0.3)"
                  : "0 0 10px rgba(255,255,255,0.2)",
              }}
            />
          )}
        </div>
      )}
    </LiquidMetalCard>
  );
}
