import { useState, useEffect } from "react";
import { Building, MapPin, ChevronRight, Activity, Target } from "lucide-react";
import { LiquidMetalCard } from "./ui/LiquidMetalCard";

export type CandidateSignal = "strong" | "yes" | "maybe" | "no";

interface CandidateCardProps {
  initials: string;
  name: string;
  company: string;
  location: string;
  score: number;
  signal: CandidateSignal;
  onClick?: () => void;
  animationDelay?: number;
  style?: React.CSSProperties;
  className?: string;
}

export function CandidateCard({
  initials,
  name,
  company,
  location,
  score,
  signal,
  onClick,
  animationDelay = 0,
  style = {},
  className = "",
}: CandidateCardProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), animationDelay);
    return () => clearTimeout(timer);
  }, [animationDelay]);

  const signalColors: Record<CandidateSignal, { color: string; bg: string; border: string }> = {
    strong: {
      color: "#34d399",
      bg: "rgba(52, 211, 153, 0.1)",
      border: "rgba(52, 211, 153, 0.2)",
    },
    yes: {
      color: "#60a5fa",
      bg: "rgba(96, 165, 250, 0.1)",
      border: "rgba(96, 165, 250, 0.2)",
    },
    maybe: {
      color: "#fbbf24",
      bg: "rgba(251, 191, 36, 0.1)",
      border: "rgba(251, 191, 36, 0.2)",
    },
    no: {
      color: "#f87171",
      bg: "rgba(248, 113, 113, 0.1)",
      border: "rgba(248, 113, 113, 0.2)",
    },
  };

  const signalStyle = signalColors[signal];

  return (
    <div
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0)" : "translateY(15px)",
        transition: "all 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
        marginBottom: 12,
        ...style
      }}
      className={className}
    >
      <LiquidMetalCard
        variant="dark"
        onClick={onClick}
        style={{
          padding: 0,
          borderRadius: 8,
          cursor: onClick ? "pointer" : "default",
          overflow: 'hidden'
        }}
      >
        <div style={{ display: "flex", alignItems: "stretch" }}>
          {/* Status Indicator Bar */}
          <div
            style={{
              width: 4,
              background: signalStyle.color,
              opacity: 0.8,
            }}
          />

          {/* Initials block */}
          <div
            style={{
              width: 80,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: 'var(--pipe-surface)',
              borderRight: '1px solid rgba(255,255,255,0.05)'
            }}
          >
            <span
              style={{
                fontSize: 24,
                fontWeight: 800,
                letterSpacing: "-0.02em",
                color: 'var(--pipe-text, #fff)',
                opacity: 0.9
              }}
            >
              {initials}
            </span>
          </div>

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
                  background: signalStyle.bg,
                  border: `1px solid ${signalStyle.border}`,
                  color: signalStyle.color,
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Activity
                  size={10}
                  style={signal === 'strong' ? { animation: "pulse 1.5s ease-in-out infinite" } : {}}
                />
                {signal.toUpperCase()}
              </div>
              
              <h3
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "var(--pipe-text, #fff)",
                  margin: 0,
                  letterSpacing: "0.01em",
                }}
              >
                {name.toUpperCase()}
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
                    {company.toUpperCase()}
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

            {/* Bottom Row */}
            <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                 <Target size={14} color="var(--pipe-text-dim)" />
                 <div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 800,
                        color: "var(--pipe-text, #fff)",
                        fontFamily: "Space Mono",
                      }}
                    >
                      {String(score).padStart(2, "0")}
                    </div>
                    <div
                      style={{
                        fontSize: 7,
                        color: "var(--pipe-text-dim)",
                        letterSpacing: "0.1em",
                      }}
                    >
                      OVERALL_SCORE
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
                <ChevronRight size={16} color="var(--pipe-text-dim)" />
              </div>
            </div>
          </div>
        </div>
      </LiquidMetalCard>
    </div>
  );
}
