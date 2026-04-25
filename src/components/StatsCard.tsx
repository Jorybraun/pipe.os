import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";
import { LiquidMetalCard } from "./LiquidMetalCard";

interface StatsCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: string;
    direction: "up" | "down";
  };
  style?: React.CSSProperties;
  className?: string;
}

export function StatsCard({
  label,
  value,
  icon: Icon,
  trend,
  style = {},
  className = "",
}: StatsCardProps) {
  return (
    <LiquidMetalCard
      variant="dark"
      style={{ padding: 24, ...style }}
      className={className}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 8,
              letterSpacing: "0.2em",
              color: "var(--pipe-text-dim)",
              marginBottom: 12,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontSize: 36,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              background:
                "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {value}
          </div>
          {trend && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                marginTop: 8,
              }}
            >
              {trend.direction === "up" ? (
                <TrendingUp size={10} color="rgba(150,255,150,0.8)" />
              ) : (
                <TrendingDown size={10} color="rgba(255,100,100,0.8)" />
              )}
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: "0.1em",
                  color:
                    trend.direction === "up"
                      ? "rgba(150,255,150,0.8)"
                      : "rgba(255,100,100,0.8)",
                }}
              >
                {trend.value}
              </span>
            </div>
          )}
        </div>
        <div
          style={{
            width: 48,
            height: 48,
            background: "var(--pipe-surface)",
            border: "1px solid var(--pipe-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon size={20} color="var(--pipe-text-dim)" />
        </div>
      </div>
    </LiquidMetalCard>
  );
}
