import { useState, useEffect } from "react";
import { Building, MapPin, User } from "lucide-react";
import { LiquidMetalCard } from "./LiquidMetalCard";

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

  const signalColors: Record<CandidateSignal, { bg: string; text: string }> = {
    strong: {
      bg: "rgba(150,255,150,0.15)",
      text: "rgba(150,255,150,0.8)",
    },
    yes: {
      bg: "rgba(100,200,255,0.15)",
      text: "rgba(100,200,255,0.8)",
    },
    maybe: {
      bg: "rgba(255,200,100,0.15)",
      text: "rgba(255,200,100,0.8)",
    },
    no: {
      bg: "rgba(255,100,100,0.15)",
      text: "rgba(255,100,100,0.8)",
    },
  };

  const signalStyle = signalColors[signal];

  return (
    <div
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0)" : "translateY(15px)",
        transition: "all 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <LiquidMetalCard
        variant="dark"
        hover
        onClick={onClick}
        style={{
          marginBottom: 8,
          cursor: onClick ? "pointer" : "default",
          ...style,
        }}
        className={className}
      >
        <div style={{ display: "flex" }}>
          {/* Initials block */}
          <div
            style={{
              width: 90,
              padding: 24,
              borderRight: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                fontSize: 32,
                fontWeight: 800,
                letterSpacing: "-0.02em",
                background:
                  "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.6) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {initials}
            </span>
          </div>

          {/* Info section */}
          <div style={{ flex: 1, padding: "20px 24px" }}>
            {/* Company */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <Building size={12} color="rgba(255,255,255,0.25)" />
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                {company.toUpperCase()}
              </span>
            </div>

            {/* Location */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <MapPin size={12} color="rgba(255,255,255,0.25)" />
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                {location.toUpperCase()}
              </span>
            </div>

            {/* Name */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <User size={12} color="rgba(255,255,255,0.25)" />
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: "0.05em",
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                {name.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Score section */}
          <div
            style={{
              width: 80,
              padding: 20,
              borderLeft: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255,255,255,0.02)",
            }}
          >
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
              {score}
            </div>
            <span
              style={{
                fontSize: 7,
                letterSpacing: "0.15em",
                marginTop: 6,
                padding: "3px 8px",
                background: signalStyle.bg,
                color: signalStyle.text,
              }}
            >
              {signal.toUpperCase()}
            </span>
          </div>
        </div>
      </LiquidMetalCard>
    </div>
  );
}
